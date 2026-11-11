"""
Simon-1 training + validation pipeline.

A decision row is one product a shopper could have picked up on one real visit. The
placement attached to it is the placement that shopper actually walked past, because the
store they shopped that week decides it.

That matters for identification: the same product in the same week sits on an endcap in
one store and on plain shelf in another, so the promotion effect is measured within a
product-week across stores. Seasonality, price moves and national advertising are common
to the cell and drop out.

  weeks  1-26  history   behavioural features only, never a label source
  weeks 27-47  train
  weeks 48-53  test      never seen in fitting or calibration

Run:  python model/pipeline.py
"""
import json, pathlib, sys
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import log_loss, brier_score_loss, roc_auc_score

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA, OUT = ROOT / "data", ROOT / "web" / "data"
OUT.mkdir(parents=True, exist_ok=True)

HIST_END, TRAIN_END, TEST_END = 26, 47, 53
N_PRODUCTS = 70
VOL_BAND = (60, 900)   # buyer-weeks across the whole chain
SEED = 7

DISPLAY_GRP = {"0": 0,
               "7": 1, "A": 1, "9": 1, "2": 1,
               "1": 2, "3": 2, "4": 2, "5": 2, "6": 2}
MAILER_GRP = {"0": 0,
              "A": 1, "C": 1, "P": 1, "X": 1, "J": 1,
              "D": 2, "F": 2, "H": 2, "L": 2, "Z": 2}
DISPLAY_LBL = ["No display", "Secondary display", "Front endcap"]
MAILER_LBL = ["Not in flyer", "Flyer interior", "Flyer front page"]
LEVERS = ["Secondary display", "Front endcap", "Flyer interior", "Flyer front page"]
# How each lever's effect can be measured: displays vary between stores in a week,
# the flyer is chain-wide so it only varies across weeks.
LEVER_SPECS = [("secondary_display", "display_grp", 1, "store"),
               ("front_endcap", "display_grp", 2, "store"),
               ("flyer_interior", "mailer_grp", 1, "week"),
               ("flyer_front", "mailer_grp", 2, "week")]


def log(m): print(m, flush=True)


# ------------------------------------------------------------------- load
def load():
    tx = pd.read_parquet(DATA / "transactions.parquet")
    pr = pd.read_parquet(DATA / "products.parquet")
    pl = pd.read_parquet(DATA / "promotions.parquet")

    pl["display_grp"] = pl["display_location"].astype(str).map(DISPLAY_GRP).fillna(0).astype(np.int8)
    pl["mailer_grp"] = pl["mailer_location"].astype(str).map(MAILER_GRP).fillna(0).astype(np.int8)
    pl = pl.groupby(["product_id", "store_id", "week"], as_index=False)[["display_grp", "mailer_grp"]].max()

    tx["unit_price"] = (tx["sales_value"] + tx["retail_disc"]) / tx["quantity"].replace(0, np.nan)
    return tx, pr, pl


# -------------------------------------------------------------- the visits
def visits_table(tx, promo_stores):
    """One row per shopper per week, carrying the store whose shelves they saw.

    A household that did not shop has no decision to make, so it contributes no rows.
    Where someone split a week across stores we take the one they spent most in.
    """
    t = tx[tx.store_id.isin(promo_stores)]
    spend = t.groupby(["household_id", "week", "store_id"], observed=True)["sales_value"].sum().reset_index()
    spend = spend.sort_values("sales_value", ascending=False)
    v = spend.drop_duplicates(["household_id", "week"])[["household_id", "week", "store_id"]]
    return v.reset_index(drop=True)


def pick_products(tx, pl):
    """Mid-tail products the chain genuinely moved around.

    Staples sell the same wherever you put them, so the response lives below the head of
    the distribution. A product only earns a place if some store ran it on an endcap in a
    week when another store did not, which is the variation the estimate is built on.
    """
    endcap = pl[pl.display_grp == 2]
    plain = pl[pl.display_grp == 0]
    cells_on = set(map(tuple, endcap[["product_id", "week"]].drop_duplicates().to_numpy()))
    cells_off = set(map(tuple, plain[["product_id", "week"]].drop_duplicates().to_numpy()))
    contested = cells_on & cells_off
    n_cells = pd.Series([p for p, _ in contested]).value_counts()

    buyer_weeks = tx.groupby(["product_id", "week"], observed=True)["household_id"].nunique() \
                    .groupby("product_id", observed=True).sum()
    lo, hi = VOL_BAND
    band = buyer_weeks[(buyer_weeks >= lo) & (buyer_weeks <= hi)].index
    ok = n_cells[(n_cells >= 8)].index.intersection(band)
    chosen = buyer_weeks.loc[ok].sort_values(ascending=False).head(N_PRODUCTS).index.to_numpy()
    log(f"  {len(contested):,} contested product-weeks; {len(band):,} products in the "
        f"{lo}-{hi} buyer-week band; {len(chosen)} selected")
    return chosen


def build(tx, pr, pl):
    promo_stores = set(pl.store_id.unique())
    products = pick_products(tx, pl)
    v = visits_table(tx, promo_stores)
    v = v[(v.week > HIST_END) & (v.week <= TEST_END)]
    log(f"  {len(v):,} shopping visits in weeks {HIST_END+1}-{TEST_END}")

    grid = v.merge(pd.DataFrame({"product_id": products}), how="cross")
    log(f"  {len(grid):,} decision rows")

    bought = tx[tx.product_id.isin(products)][["household_id", "week", "product_id"]].drop_duplicates()
    bought["y"] = np.int8(1)
    grid = grid.merge(bought, on=["household_id", "week", "product_id"], how="left")
    grid["y"] = grid["y"].fillna(0).astype(np.int8)

    grid = grid.merge(pl, on=["product_id", "store_id", "week"], how="left")
    grid[["display_grp", "mailer_grp"]] = grid[["display_grp", "mailer_grp"]].fillna(0).astype(np.int8)

    # --- behaviour from weeks 1-26 only, so no feature can carry a label from the test window
    hist = tx[tx.week <= HIST_END]
    meta = pr.set_index("product_id")
    cat = meta["product_category"]
    hw = HIST_END

    hh_visits = hist.groupby("household_id", observed=True)["basket_id"].nunique().div(hw).rename("hh_visits")
    hh_spend = hist.groupby("household_id", observed=True)["sales_value"].sum().div(hw).rename("hh_spend")
    hh_basket = (hist.groupby(["household_id", "basket_id"], observed=True)["sales_value"].sum()
                     .groupby("household_id", observed=True).mean().rename("hh_basket"))
    hh_prod = (hist.groupby(["household_id", "product_id"], observed=True)["week"].nunique().div(hw)
                   .rename("hh_prod_rate").reset_index())
    hist_cat = hist.assign(category=hist["product_id"].map(cat))
    hh_cat = (hist_cat.groupby(["household_id", "category"], observed=True)["week"].nunique().div(hw)
                      .rename("hh_cat_rate").reset_index())
    n_hh = tx.household_id.nunique()
    prod_rate = (hist.groupby("product_id", observed=True)["household_id"].nunique()
                     .div(n_hh * hw).rename("prod_base_rate"))
    price = hist.groupby("product_id", observed=True)["unit_price"].median().rename("price")
    store_size = hist.groupby("store_id", observed=True)["basket_id"].nunique().rename("store_size")

    grid["category"] = grid["product_id"].map(cat)
    grid = (grid.merge(hh_prod, on=["household_id", "product_id"], how="left")
                .merge(hh_cat, on=["household_id", "category"], how="left"))
    grid["hh_visits"] = grid["household_id"].map(hh_visits)
    grid["hh_spend"] = grid["household_id"].map(hh_spend)
    grid["hh_basket"] = grid["household_id"].map(hh_basket)
    grid["prod_base_rate"] = grid["product_id"].map(prod_rate)
    grid["price"] = grid["product_id"].map(price)
    grid["store_size"] = grid["store_id"].map(store_size)
    grid["private_label"] = (grid["product_id"].map(meta["brand"]) == "Private").astype(np.int8)
    # Seasonality as one chain-wide number per week, taken over every modelled product, so
    # it carries the shape of the year without identifying any product's promotion.
    wk_rate = grid.groupby("week", observed=True)["y"].transform("mean")
    grid["week_factor"] = (wk_rate / max(grid["y"].mean(), 1e-12)).astype(np.float32)
    grid["cat_code"] = grid["category"].astype("category").cat.codes

    for c in ["hh_prod_rate", "hh_cat_rate", "hh_visits", "hh_spend", "hh_basket",
              "prod_base_rate", "store_size", "week_factor"]:
        grid[c] = grid[c].fillna(0.0).astype(np.float32)
    grid["price"] = grid["price"].fillna(grid["price"].median()).astype(np.float32)
    return grid, products


# The baseline model answers "who buys this anyway". It is blind to the levers, and also to
# the calendar: given the week number a booster learns which products the chain promoted in
# which week, which is the promotion effect wearing a disguise. With `week` among the
# features it read a measured 1.84x endcap effect as 1.26x. Seasonality still enters, but
# only as the chain's overall rate that week, a single number that cannot single out one
# product's promotion. Every other feature is fixed at week 26 and cannot move with a promo.
BASE_FEATS = ["hh_prod_rate", "hh_cat_rate", "hh_visits", "hh_spend", "hh_basket",
              "prod_base_rate", "price", "private_label", "cat_code", "week_factor",
              "store_size"]

# What the causal layer is allowed to control for. Household-product history is excluded on
# purpose: how often a shopper already buys a product partly reflects how often their usual
# store put it on an endcap last year, so holding it fixed subtracts part of the very effect
# being measured. It attenuated a measured 1.84x to 1.27x. Visit frequency, basket size and
# store traffic stay, because none of them is downstream of where one product sat this week.
EXPO_FEATS = ["hh_visits", "hh_spend", "hh_basket", "store_size", "prod_base_rate",
              "cat_code", "price", "private_label"]


def design(rows):
    d, m = rows["display_grp"].to_numpy(), rows["mailer_grp"].to_numpy()
    return np.column_stack([d == 1, d == 2, m == 1, m == 2]).astype(np.float64)


def logit(p, eps=1e-9):
    p = np.clip(p, eps, 1 - eps)
    return np.log(p / (1 - p))


def _codes(*cols):
    return pd.MultiIndex.from_arrays(cols).factorize()[0]


def fit_lever_block(y, mu0, X, cell, prior=None, shrink=0.0, rounds=40):
    """Estimate lever effects on a log link, with each cell's level solved in closed form.

    Why a log link and not the logistic used elsewhere: with tens of thousands of cells and
    a handful of purchases in each, fixed-effects logistic regression is biased toward zero
    (the incidental parameters problem), and it was reading a measured 1.64x as 1.26x. Under
    a log link the cell effect is just observed over expected within the cell, so it can be
    divided out exactly instead of estimated, and what is left is unbiased.

    Only cells containing both a promoted and an unpromoted row are used. A cell where
    everything got the same treatment carries no contrast and would only add noise.
    """
    keep = np.zeros(len(y), bool)
    on_any = X.sum(1) > 0
    n_cell = int(cell.max()) + 1 if len(cell) else 0
    has_on = np.bincount(cell, weights=on_any, minlength=n_cell) > 0
    has_off = np.bincount(cell, weights=~on_any, minlength=n_cell) > 0
    contested = has_on & has_off
    keep = contested[cell]
    if keep.sum() < 500 or y[keep].sum() < 30:
        return np.zeros(X.shape[1]) if prior is None else np.asarray(prior, float)

    y, mu0, X, cell = y[keep], mu0[keep], X[keep], pd.factorize(cell[keep])[0]
    n_cell = int(cell.max()) + 1
    b = np.zeros(X.shape[1]) if prior is None else np.asarray(prior, float).copy()
    target = np.zeros_like(b) if prior is None else np.asarray(prior, float).copy()

    for _ in range(rounds):
        mu = mu0 * np.exp(X @ b)
        num = np.bincount(cell, weights=y, minlength=n_cell)
        den = np.bincount(cell, weights=mu, minlength=n_cell)
        mu = mu * np.where(den > 0, num / np.maximum(den, 1e-12), 0.0)[cell]
        prev = b.copy()
        for j in range(X.shape[1]):
            sel = X[:, j] > 0
            if not sel.any():
                continue
            den_j = mu[sel].sum()
            if den_j <= 0:
                continue
            b[j] += np.log(max(y[sel].sum(), 0.5) / den_j)
        if shrink > 0 and prior is not None:
            b = (b + shrink * target) / (1 + shrink)
        if np.max(np.abs(b - prev)) < 1e-7:
            break
    return b


def fit_uplift(rows, y, p_base, prior=None, shrink=0.0):
    """Fit all four levers the way each one is actually identified in the data.

    Displays vary between stores inside a single product-week, so they are identified there.
    The flyer is a chain-wide decision and in any given week every store shows the same page,
    so it has no cross-store contrast and must be identified within a product across weeks,
    with the chain's weekly rate divided out so seasonality does not read as flyer effect.
    """
    X = design(rows)
    prod = rows["product_id"].to_numpy()
    week = rows["week"].to_numpy()
    b = np.zeros(4) if prior is None else np.asarray(prior, float).copy()

    disp = fit_lever_block(y, p_base, X[:, :2], _codes(prod, week),
                           prior=None if prior is None else b[:2], shrink=shrink)
    b[:2] = disp

    # Hold the display effect fixed, then read the flyer off what is left.
    mu_after = p_base * np.exp(X[:, :2] @ b[:2])
    wk_adj = pd.Series(y).groupby(week).transform("mean").to_numpy() / max(y.mean(), 1e-12)
    mu_after = mu_after * np.clip(wk_adj, 0.2, 5.0)
    mail = fit_lever_block(y, mu_after, X[:, 2:], _codes(prod),
                           prior=None if prior is None else b[2:], shrink=shrink)
    b[2:] = mail
    return b


def fit(train):
    """Simon-1 = baseline demand model + calibrated promotion-response layer."""
    cut = TRAIN_END - 4
    fit_rows, cal_rows = train[train.week <= cut], train[train.week > cut]

    base = HistGradientBoostingClassifier(
        max_iter=320, learning_rate=0.06, max_leaf_nodes=31,
        min_samples_leaf=80, l2_regularization=1.0, random_state=SEED)
    base.fit(fit_rows[BASE_FEATS], fit_rows["y"])

    # A second, deliberately blinkered model supplies the exposure the causal layer is
    # fitted against (see EXPO_FEATS). It never scores anything the user sees.
    expo = HistGradientBoostingClassifier(
        max_iter=160, learning_rate=0.08, max_leaf_nodes=16,
        min_samples_leaf=120, l2_regularization=1.0, random_state=SEED)
    expo.fit(fit_rows[EXPO_FEATS], fit_rows["y"])

    p_base_tr = base.predict_proba(train[BASE_FEATS])[:, 1]
    p_expo_tr = expo.predict_proba(train[EXPO_FEATS])[:, 1]
    y_tr = train["y"].to_numpy()
    X_tr = design(train)
    beta = fit_uplift(train, y_tr, p_expo_tr)

    # Per-category response, shrunk toward the global effect so a thin category borrows
    # strength rather than inventing one.
    cat_beta, codes = {}, train["cat_code"].to_numpy()
    for c in np.unique(codes):
        sel = codes == c
        n_on = int(((X_tr[sel].sum(1) > 0) & (y_tr[sel] == 1)).sum())
        cat_beta[int(c)] = fit_uplift(train[sel], y_tr[sel], p_expo_tr[sel],
                                      prior=beta, shrink=max(0.3, 120.0 / max(n_on, 1))).tolist()

    p_cal_in = apply_beta(base.predict_proba(cal_rows[BASE_FEATS])[:, 1], design(cal_rows),
                          np.array([cat_beta.get(int(c), beta) for c in cal_rows["cat_code"]]))
    iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
    iso.fit(p_cal_in, cal_rows["y"])
    return {"base": base, "beta": beta, "cat_beta": cat_beta, "iso": iso}


def apply_beta(p_base, X, B):
    """Multiply baseline demand by the fitted lever effect, matching how it was estimated."""
    return np.clip(p_base * np.exp(np.einsum("ij,ij->i", X, B)), 1e-9, 1 - 1e-9)


def score(model, rows, d=None, m=None, promo=True):
    """Probability each shopper picks up each product on that visit, optionally counterfactual."""
    r = rows
    if d is not None or m is not None:
        r = rows.copy()
        if d is not None: r["display_grp"] = np.int8(d)
        if m is not None: r["mailer_grp"] = np.int8(m)
    p_base = model["base"].predict_proba(r[BASE_FEATS])[:, 1]
    if not promo:
        return model["iso"].predict(p_base)
    B = np.array([model["cat_beta"].get(int(c), model["beta"]) for c in r["cat_code"]])
    return model["iso"].predict(apply_beta(p_base, design(r), B))


# ------------------------------------------------------------------ metrics
def ece(y, p, bins=10):
    q = pd.qcut(pd.Series(p).rank(method="first"), bins, labels=False)
    d = pd.DataFrame({"y": y, "p": p, "q": q})
    g = d.groupby("q").agg(y=("y", "mean"), p=("p", "mean"), n=("y", "size"))
    return float((g["n"] / len(d) * (g["y"] - g["p"]).abs()).sum()), g.reset_index().to_dict("records")


def metrics(y, p):
    e, rel = ece(y, p)
    return {"log_loss": float(log_loss(y, p, labels=[0, 1])),
            "brier": float(brier_score_loss(y, p)),
            "auc": float(roc_auc_score(y, p)),
            "ece": e, "mean_p": float(np.mean(p)), "actual_rate": float(np.mean(y)),
            "n": int(len(y)), "buys": int(y.sum()),
            "reliability": [{"q": int(r["q"]), "y": round(r["y"], 6),
                             "p": round(r["p"], 6), "n": int(r["n"])} for r in rel]}


def measured_lift(test, col, lvl, by, iters=400):
    """Lift read straight off receipts, stratified.

    by="store": the position varies between stores in the same product-week, so each
        product-week is a stratum and the comparison is between stores inside it.
    by="week": the flyer is chain-wide, so in a given week every store shows the same page.
        There is no cross-store contrast; the stratum is the product and the comparison is
        between weeks, with the chain's weekly rate divided out.

    The estimator is Mantel-Haenszel, which averages the within-stratum rate ratios with
    their proper weights. Simply summing buys across strata and dividing is NOT the same
    number and is badly biased here: a stratum where most stores ran the endcap is usually a
    product-week that was already selling, so pooling lets that cell's high demand land on
    the promoted side of the ratio. On this data pooling reads 1.65x where the stratified
    estimate is 1.28x. The naive figure is reported alongside, because it is what a
    spreadsheet produces and it is the number the average-lift rule reproduces.
    """
    d = test[test[col].isin([0, lvl])]
    if not len(d):
        return None
    strata = ["product_id", "week"] if by == "store" else ["product_id"]
    adj_keys = ["store_id", "week"] if by == "store" else ["week"]

    adj = test.groupby(adj_keys, observed=True)["y"].agg(["sum", "size"])
    fac = ((adj["sum"] / adj["size"]) / max(test["y"].mean(), 1e-12)).clip(0.2, 5.0).rename("fac")

    keys = strata + ["store_id"] if by == "store" else strata + ["week"]
    g = d.groupby(keys + [col], observed=True)["y"].agg(obs="sum", vis="size").reset_index()
    g = g.join(fac, on=adj_keys)
    g["fac"] = g["fac"].fillna(1.0)
    g["expo"] = g["vis"] * g["fac"]
    g["on"] = (g[col] == lvl).astype(int)

    cells = g.groupby(strata + ["on"], observed=True)[["obs", "expo"]].sum().unstack("on")
    cells = cells.dropna()
    if len(cells) < 15:
        return None
    o_on = cells[("obs", 1)].to_numpy(float); e_on = cells[("expo", 1)].to_numpy(float)
    o_off = cells[("obs", 0)].to_numpy(float); e_off = cells[("expo", 0)].to_numpy(float)
    ok = (e_on > 0) & (e_off > 0)
    o_on, e_on, o_off, e_off = o_on[ok], e_on[ok], o_off[ok], e_off[ok]
    n = len(o_on)
    if n < 15:
        return None

    def mh(idx):
        T = e_on[idx] + e_off[idx]
        num = (o_on[idx] * e_off[idx] / T).sum()
        den = (o_off[idx] * e_on[idx] / T).sum()
        return num / den if den > 0 else np.nan

    point = mh(np.arange(n))
    naive = (o_on.sum() / e_on.sum()) / (o_off.sum() / e_off.sum()) if o_off.sum() > 0 else np.nan
    rng = np.random.default_rng(SEED)
    boot = [mh(rng.integers(0, n, n)) for _ in range(iters)]
    boot = [b for b in boot if np.isfinite(b)]
    if not np.isfinite(point) or len(boot) < 50:
        return None
    return {"lift": float(point), "lo": float(np.percentile(boot, 5)),
            "hi": float(np.percentile(boot, 95)), "cells": int(n),
            "naive": float(naive),
            "basis": "between stores, same product-week" if by == "store"
                     else "same product, flyer weeks against other weeks",
            "buys_on": int(o_on.sum()), "buys_off": int(o_off.sum())}


def main():
    log("1/6  loading chain records")
    tx, pr, pl = load()
    log(f"     {len(tx):,} line items  {len(pr):,} products  {len(pl):,} placement rows  "
        f"{tx.household_id.nunique():,} households  {pl.store_id.nunique()} stores")

    log("2/6  building decision rows")
    grid, products = build(tx, pr, pl)
    train = grid[grid.week <= TRAIN_END]
    test = grid[grid.week > TRAIN_END]
    promoted = ((test.display_grp > 0) | (test.mailer_grp > 0)).to_numpy()
    log(f"     train {len(train):,} rows / {int(train.y.sum()):,} buys")
    log(f"     test  {len(test):,} rows / {int(test.y.sum()):,} buys  "
        f"({promoted.sum():,} promoted, {int(test.y.to_numpy()[promoted].sum()):,} buys)")

    log("3/6  fitting Simon-1")
    model = fit(train)
    log("     lever log-odds: " + "  ".join(f"{n} {b:+.3f}" for n, b in zip(LEVERS, model["beta"])))

    y = test["y"].to_numpy()
    p_cal = score(model, test)
    p_none = score(model, test, promo=False)

    tr_on = train[(train.display_grp > 0) | (train.mailer_grp > 0)]["y"].mean()
    tr_off = train[(train.display_grp == 0) & (train.mailer_grp == 0)]["y"].mean()
    avg_lift = float(tr_on / tr_off)
    p_avg = np.clip(p_none * np.where(promoted, avg_lift, 1.0), 1e-9, 1 - 1e-9)
    log(f"     average observed lift when promoted: {avg_lift:.2f}x")

    log("4/6  scoring on the holdout")
    preds = {"simon1": p_cal, "no_promo": p_none, "avg_lift": p_avg}
    labels = {"simon1": ("Simon-1", "calibrated on the chain's own records"),
              "no_promo": ("As-usual", "ignores promotion entirely"),
              "avg_lift": ("Average lift", "one blanket multiplier for every promotion")}
    engines = {}
    for k, p in preds.items():
        engines[k] = {"label": labels[k][0], "note": labels[k][1], **metrics(y, p),
                      "promoted": metrics(y[promoted], p[promoted])}
    for k, v in engines.items():
        log(f"     {v['label']:<14} all: auc {v['auc']:.4f} ll {v['log_loss']:.5f}   "
            f"promoted: auc {v['promoted']['auc']:.4f} ll {v['promoted']['log_loss']:.5f}")

    log("5/6  recovering measured effects (within product-week, across stores)")
    effects, errs = {}, {k: [] for k in preds}
    for name, col, lvl, by in LEVER_SPECS:
        a = measured_lift(test, col, lvl, by)
        kw = {"d": lvl, "m": 0} if col == "display_grp" else {"d": 0, "m": lvl}
        rows = test
        sim = float(score(model, rows, **kw).mean() / score(model, rows, d=0, m=0).mean())
        cand = {"simon1": sim, "no_promo": 1.0, "avg_lift": avg_lift}
        effects[name] = {
            "label": (DISPLAY_LBL if col == "display_grp" else MAILER_LBL)[lvl],
            "actual": a, "simulated": cand,
            "cells": a["cells"] if a else 0,
            "basis": a["basis"] if a else None,
            "in_range": {k: (a is not None and a["lo"] <= v <= a["hi"]) for k, v in cand.items()},
            "abs_error": None if a is None else {k: abs(v - a["lift"]) for k, v in cand.items()},
        }
        if a:
            for k, v in cand.items():
                errs[k].append(abs(v - a["lift"]))
        m_ = "n/a" if not a else f"{a['lift']:.2f} [{a['lo']:.2f}, {a['hi']:.2f}]"
        nv = "" if not a else f"  (naive {a['naive']:.2f})"
        log(f"     {effects[name]['label']:<18} measured {m_:<20}{nv:<16} simon1 {sim:.2f}")
    lift_mae = {k: float(np.mean(v)) for k, v in errs.items() if v}
    log("     mean absolute lift error: " + "  ".join(f"{k} {v:.3f}" for k, v in lift_mae.items()))
    for e in engines:
        engines[e]["lift_mae"] = lift_mae.get(e)

    log("6/6  exporting the response surface per category")
    cats = []
    for c, rows in test.groupby("category", observed=True):
        if len(rows) < 3000:
            continue
        surface = [[float(score(model, rows, d=d, m=m).mean()) for m in range(3)] for d in range(3)]
        cats.append({
            "category": c, "title": str(c).title().replace("/", " / "),
            "products": int(rows["product_id"].nunique()),
            "price": round(float(rows["price"].median()), 2),
            "base_rate": surface[0][0], "surface": surface,
        })
    cats.sort(key=lambda r: -r["base_rate"])
    log(f"     {len(cats)} categories exported")

    (OUT / "validation.json").write_text(json.dumps({
        "holdout": {"weeks": [TRAIN_END + 1, TEST_END], "rows": int(len(test)),
                    "buys": int(test.y.sum()), "households": int(test.household_id.nunique()),
                    "products": int(len(products)), "stores": int(test.store_id.nunique()),
                    "visits": int(test[["household_id", "week"]].drop_duplicates().shape[0]),
                    "promoted_rows": int(promoted.sum())},
        "training": {"weeks": [HIST_END + 1, TRAIN_END], "rows": int(len(train)),
                     "buys": int(train.y.sum()), "history_weeks": [1, HIST_END]},
        "engines": engines, "effects": effects, "avg_lift": avg_lift, "lift_mae": lift_mae,
        "levers": LEVERS, "beta": [float(b) for b in model["beta"]],
    }, indent=1), encoding="utf-8")

    (OUT / "surface.json").write_text(json.dumps({
        "display_labels": DISPLAY_LBL, "mailer_labels": MAILER_LBL,
        "levers": LEVERS, "beta": [float(b) for b in model["beta"]],
        "categories": cats, "auc": engines["simon1"]["auc"],
        "holdout_weeks": [TRAIN_END + 1, TEST_END],
    }, indent=1), encoding="utf-8")

    test[["household_id", "store_id", "week", "product_id", "category", "y",
          "display_grp", "mailer_grp", "hh_prod_rate", "hh_cat_rate", "hh_visits",
          "price", "prod_base_rate"]].assign(p_simon1=p_cal, p_none=p_none) \
        .to_parquet(DATA / "holdout_scored.parquet", index=False)
    log(f"\nwrote {OUT/'validation.json'}\nwrote {OUT/'surface.json'}\n"
        f"wrote {DATA/'holdout_scored.parquet'} (for the LLM comparison)")


if __name__ == "__main__":
    main()
