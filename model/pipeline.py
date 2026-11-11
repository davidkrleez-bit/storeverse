"""
Simon-1 training + validation pipeline.

Builds household x product x week decision rows from one year of store records,
trains a calibrated purchase-probability model, and scores it against two
baselines on a strict time holdout.

Windows:
  weeks  1-26  history   -> behavioural features only (never a label source)
  weeks 27-47  train
  weeks 48-53  test      (never seen during fit or calibration)

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
N_PRODUCTS = 400
# Staples sell the same however you merchandise them; the response lives in the mid-tail,
# so model products with enough buyer-weeks to estimate but not so many they are saturated.
VOL_BAND = (5, 40)
SEED = 7

# Placement codes -> the three states a merchandiser can actually choose.
DISPLAY_GRP = {  # in-store position
    "0": 0,                                      # not on display
    "7": 1, "A": 1, "9": 1, "2": 1,              # in-aisle / in-shelf / secondary / rear
    "1": 2, "3": 2, "4": 2, "5": 2, "6": 2,      # store front and end caps
}
MAILER_GRP = {  # flyer position
    "0": 0,                                      # not in the flyer
    "A": 1, "C": 1, "P": 1, "X": 1, "J": 1,      # interior page / coupon
    "D": 2, "F": 2, "H": 2, "L": 2, "Z": 2,      # front, back and wrap features
}
DISPLAY_LBL = ["No display", "Secondary display", "Front endcap"]
MAILER_LBL = ["Not in flyer", "Flyer interior", "Flyer front page"]


def log(m): print(m, flush=True)


# ---------------------------------------------------------------- load
def load():
    tx = pd.read_csv(DATA / "transactions.csv")
    pr = pd.read_csv(DATA / "products.csv")
    pl = pd.read_csv(DATA / "placements.csv")

    tx["datetime"] = pd.to_datetime(tx["datetime"])
    day0 = tx["datetime"].min().normalize()
    # Align receipts to the same 1-53 week index the placement records use.
    tx["week"] = ((tx["datetime"] - day0).dt.days // 7 + 1).clip(1, TEST_END)
    tx["unit_price"] = (tx["paid_total"] + tx["discount_amt"]) / tx["qty"].replace(0, np.nan)

    pl["display_grp"] = pl["display_location"].astype(str).map(DISPLAY_GRP).fillna(0).astype(int)
    pl["mailer_grp"] = pl["mailer_location"].astype(str).map(MAILER_GRP).fillna(0).astype(int)
    pl = pl.groupby(["product_id", "week"], as_index=False)[["display_grp", "mailer_grp"]].max()
    return tx, pr, pl


# ------------------------------------------------------- decision rows
def build(tx, pr, pl):
    """Every (household, product, week) a shopper could have acted on."""
    # Keep only products the store actually varied: promoted some weeks, not others.
    # A product-week missing from the placement file simply was not promoted, so count
    # promoted weeks against the full 53-week calendar rather than the rows on hand.
    on_weeks = (pl[(pl.display_grp > 0) | (pl.mailer_grp > 0)]
                .groupby("product_id")["week"].nunique())
    varied = on_weeks[(on_weeks > 0) & (on_weeks < TEST_END)].index.astype("int64")
    buyer_weeks = (tx.groupby(["item_code", "week"])["member_id"].nunique()
                     .groupby("item_code").sum())
    buyer_weeks.index = buyer_weeks.index.astype("int64")
    lo, hi = VOL_BAND
    band = buyer_weeks[(buyer_weeks >= lo) & (buyer_weeks <= hi)].index.intersection(varied)
    products = (buyer_weeks.loc[band].sort_values(ascending=False)
                .head(N_PRODUCTS).index.to_numpy())
    log(f"  {len(varied):,} products were varied; {len(band):,} sit in the {lo}-{hi} buyer-week band")

    households = np.sort(tx["member_id"].unique())
    weeks = np.arange(HIST_END + 1, TEST_END + 1)
    log(f"  grid: {len(households)} households x {len(products)} products x {len(weeks)} weeks")

    grid = pd.MultiIndex.from_product([households, products, weeks],
                                      names=["member_id", "product_id", "week"]).to_frame(index=False)

    bought = (tx[tx["item_code"].isin(products)]
              .groupby(["member_id", "item_code", "week"]).size().rename("n").reset_index()
              .rename(columns={"item_code": "product_id"}))
    grid = grid.merge(bought, on=["member_id", "product_id", "week"], how="left")
    grid["y"] = (grid["n"].fillna(0) > 0).astype(np.int8)
    grid = grid.drop(columns="n")

    grid = grid.merge(pl, on=["product_id", "week"], how="left")
    grid[["display_grp", "mailer_grp"]] = grid[["display_grp", "mailer_grp"]].fillna(0).astype(int)

    # --- features from the history window only (weeks 1-26): no label leakage
    hist = tx[tx["week"] <= HIST_END]
    meta = pr.set_index("product_id")
    cat = meta["product_category"]
    hist_cat = hist.assign(category=hist["item_code"].map(cat))

    hw = HIST_END
    hh_visits = hist.groupby("member_id")["receipt_no"].nunique().div(hw).rename("hh_visits")
    hh_spend = hist.groupby("member_id")["paid_total"].sum().div(hw).rename("hh_spend")
    hh_prod = (hist.groupby(["member_id", "item_code"])["week"].nunique().div(hw)
               .rename("hh_prod_rate").reset_index().rename(columns={"item_code": "product_id"}))
    hh_cat = (hist_cat.groupby(["member_id", "category"])["week"].nunique().div(hw)
              .rename("hh_cat_rate").reset_index())
    prod_rate = (hist.groupby("item_code")["member_id"].nunique()
                 .div(len(households) * hw).rename("prod_base_rate"))
    price = hist.groupby("item_code")["unit_price"].median().rename("price")

    grid["category"] = grid["product_id"].map(cat)
    grid = (grid.merge(hh_prod, on=["member_id", "product_id"], how="left")
                .merge(hh_cat, on=["member_id", "category"], how="left"))
    grid["hh_visits"] = grid["member_id"].map(hh_visits)
    grid["hh_spend"] = grid["member_id"].map(hh_spend)
    grid["prod_base_rate"] = grid["product_id"].map(prod_rate)
    grid["price"] = grid["product_id"].map(price)
    grid["private_label"] = (grid["product_id"].map(meta["brand"]) == "Private").astype(int)
    grid["cat_code"] = grid["category"].astype("category").cat.codes

    for c in ["hh_prod_rate", "hh_cat_rate", "hh_visits", "hh_spend", "prod_base_rate"]:
        grid[c] = grid[c].fillna(0.0)
    grid["price"] = grid["price"].fillna(grid["price"].median())
    return grid, products


# The baseline model answers "who buys this anyway". It is deliberately blind to the
# levers, so the response layer below cannot hide a promotion effect inside household habit.
BASE_FEATS = ["hh_prod_rate", "hh_cat_rate", "hh_visits", "hh_spend", "prod_base_rate",
              "price", "private_label", "cat_code", "week"]
FEATS = BASE_FEATS + ["display_grp", "mailer_grp"]


def design(rows):
    """Promotion dummies: secondary display, front endcap, flyer interior, flyer front."""
    d, m = rows["display_grp"].to_numpy(), rows["mailer_grp"].to_numpy()
    return np.column_stack([d == 1, d == 2, m == 1, m == 2]).astype(float)


LEVERS = ["Secondary display", "Front endcap", "Flyer interior", "Flyer front page"]


def logit(p, eps=1e-9):
    p = np.clip(p, eps, 1 - eps)
    return np.log(p / (1 - p))


def fit_uplift(y, p_base, X, ridge=1.0, prior=None):
    """Offset logistic regression: how much do the levers move the odds, given baseline demand?

    Fitting on the offset log-odds of the baseline is what separates promotion response
    from who-shops-what. Newton steps; only four parameters, so this converges fast.
    """
    off = logit(p_base)
    b = np.zeros(X.shape[1]) if prior is None else prior.copy()
    centre = np.zeros_like(b) if prior is None else prior.copy()
    for _ in range(60):
        p = 1 / (1 + np.exp(-(off + X @ b)))
        w = np.clip(p * (1 - p), 1e-12, None)
        g = X.T @ (p - y) + ridge * (b - centre)
        H = (X * w[:, None]).T @ X + ridge * np.eye(X.shape[1])
        step = np.linalg.solve(H, g)
        b -= step
        if np.max(np.abs(step)) < 1e-9:
            break
    return b


def apply_uplift(p_base, X, b):
    return 1 / (1 + np.exp(-(logit(p_base) + X @ b)))


# ------------------------------------------------------------- engines
def fit(train):
    """Simon-1 = baseline demand model + calibrated promotion-response layer.

    The last four training weeks are held back from the booster so the isotonic step
    and the response layer are both fitted on rows the booster never saw.
    """
    cut = TRAIN_END - 4
    fit_rows, cal_rows = train[train.week <= cut], train[train.week > cut]

    base = HistGradientBoostingClassifier(
        max_iter=260, learning_rate=0.06, max_leaf_nodes=24,
        min_samples_leaf=60, l2_regularization=1.0, random_state=SEED)
    base.fit(fit_rows[BASE_FEATS], fit_rows["y"])

    # Response layer, fitted on the whole training window against baseline predictions.
    p_base_tr = base.predict_proba(train[BASE_FEATS])[:, 1]
    y_tr = train["y"].to_numpy()
    X_tr = design(train)
    beta = fit_uplift(y_tr, p_base_tr, X_tr, ridge=1.0)

    # Per-category response, shrunk toward the global effect so thin categories
    # borrow strength instead of inventing one.
    cat_beta, codes = {}, train["cat_code"].to_numpy()
    for c in np.unique(codes):
        s_ = codes == c
        n_on = int(((X_tr[s_].sum(1) > 0) & (y_tr[s_] == 1)).sum())
        cat_beta[int(c)] = fit_uplift(y_tr[s_], p_base_tr[s_], X_tr[s_],
                                      ridge=max(8.0, 60.0 / max(n_on, 1)), prior=beta).tolist()

    # Isotonic calibration on the held-back weeks, after the response layer is applied.
    p_cal_in = apply_uplift(base.predict_proba(cal_rows[BASE_FEATS])[:, 1],
                            design(cal_rows), beta)
    iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
    iso.fit(p_cal_in, cal_rows["y"])
    return {"base": base, "beta": beta, "cat_beta": cat_beta, "iso": iso}


def score(model, rows, d=None, m=None, calibrate=True, promo=True):
    """Probability each household buys each product that week, optionally counterfactual."""
    r = rows
    if d is not None or m is not None:
        r = rows.copy()
        if d is not None: r["display_grp"] = d
        if m is not None: r["mailer_grp"] = m
    p_base = model["base"].predict_proba(r[BASE_FEATS])[:, 1]
    if not promo:
        return model["iso"].predict(p_base) if calibrate else p_base
    X = design(r)
    B = np.array([model["cat_beta"].get(int(c), model["beta"]) for c in r["cat_code"]])
    p = 1 / (1 + np.exp(-(logit(p_base) + np.einsum("ij,ij->i", X, B))))
    return model["iso"].predict(p) if calibrate else p


def ece(y, p, bins=8):
    """Expected calibration error over equal-count bins."""
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
            "reliability": [{"q": int(r["q"]), "y": round(r["y"], 6),
                             "p": round(r["p"], 6), "n": int(r["n"])} for r in rel]}


def counterfactual(model, rows, d, m):
    """Score rows as if every product sat at display state d and flyer state m."""
    return score(model, rows, d=d, m=m)


def main():
    log("1/5  loading records")
    tx, pr, pl = load()
    log(f"     {len(tx):,} line items  {len(pr):,} products  {len(pl):,} placement rows")

    log("2/5  building decision rows")
    grid, products = build(tx, pr, pl)
    train = grid[grid.week <= TRAIN_END]
    test = grid[grid.week > TRAIN_END]
    log(f"     train {len(train):,} rows / {int(train.y.sum()):,} buys"
        f"   test {len(test):,} rows / {int(test.y.sum()):,} buys")

    log("3/5  fitting Simon-1 (gradient boosting + isotonic calibration)")
    model = fit(train)

    log(f"     lever log-odds: " + "  ".join(
        f"{n} {b:+.2f}" for n, b in zip(LEVERS, model["beta"])))

    y = test["y"].to_numpy()
    p_cal = score(model, test)
    p_none = score(model, test, promo=False)

    # Baseline 2: one average lift applied to every promotion, the usual planning rule of thumb.
    tr_on = train[(train.display_grp > 0) | (train.mailer_grp > 0)]["y"].mean()
    tr_off = train[(train.display_grp == 0) & (train.mailer_grp == 0)]["y"].mean()
    avg_lift = float(tr_on / tr_off)
    promoted = ((test.display_grp > 0) | (test.mailer_grp > 0)).to_numpy()
    p_avg = np.clip(p_none * np.where(promoted, avg_lift, 1.0), 1e-9, 1 - 1e-9)
    log(f"     average observed lift when promoted: {avg_lift:.2f}x")

    log("4/5  scoring on the holdout")
    engines = {
        "simon1": {"label": "Simon-1", "note": "calibrated on this store's own records", **metrics(y, p_cal)},
        "no_promo": {"label": "As-usual", "note": "ignores promotion entirely", **metrics(y, p_none)},
        "avg_lift": {"label": "Average lift", "note": "one blanket multiplier for every promotion", **metrics(y, p_avg)},
    }
    for k, v in engines.items():
        log(f"     {v['label']:<14} auc {v['auc']:.4f}  logloss {v['log_loss']:.5f}  "
            f"brier {v['brier']:.7f}  ece {v['ece']:.6f}")

    # --- effect recovery: the claim this product lives or dies on.
    # Can the model predict how much a merchandising change moves units?
    # One store, so a product-week has a single placement state: compare each product
    # against itself across weeks, and bootstrap over products for the interval.
    LEVER_SPECS = [("secondary_display", "display_grp", 1), ("front_endcap", "display_grp", 2),
                   ("flyer_interior", "mailer_grp", 1), ("flyer_front", "mailer_grp", 2)]
    effects, errs = {}, {k: [] for k in ("simon1", "no_promo", "avg_lift")}
    for name, col, lvl in LEVER_SPECS:
        cells = test[test[col].isin([0, lvl])]
        pw = cells.groupby(["product_id", col])["y"].mean().unstack().dropna()
        if len(pw) > 5 and pw[0].mean() > 0:
            actual = float(pw[lvl].mean() / pw[0].mean())
            boot = [float(x[lvl].mean() / x[0].mean())
                    for x in (pw.sample(len(pw), replace=True, random_state=i) for i in range(500))
                    if x[0].mean() > 0]
            lo_, hi_ = float(np.percentile(boot, 5)), float(np.percentile(boot, 95))
        else:
            actual = lo_ = hi_ = None
        rows = test[test.product_id.isin(pw.index)] if len(pw) else test
        kw = {"d": lvl, "m": 0} if col == "display_grp" else {"d": 0, "m": lvl}
        off = {"d": 0, "m": 0}
        sim = float(score(model, rows, **kw).mean() / score(model, rows, **off).mean())
        cand = {"simon1": sim, "no_promo": 1.0, "avg_lift": avg_lift}
        label = (DISPLAY_LBL if col == "display_grp" else MAILER_LBL)[lvl]
        effects[name] = {
            "label": label, "products": int(len(pw)),
            "actual": None if actual is None else {"lift": actual, "lo": lo_, "hi": hi_},
            "simulated": cand,
            "in_range": {k: (actual is not None and lo_ <= v <= hi_) for k, v in cand.items()},
            "abs_error": None if actual is None else {k: abs(v - actual) for k, v in cand.items()},
        }
        if actual is not None:
            for k, v in cand.items():
                errs[k].append(abs(v - actual))
        m_ = "n/a" if actual is None else f"{actual:.2f} [{lo_:.2f}, {hi_:.2f}]"
        log(f"     {label:<18} measured {m_:<22} simon1 {sim:.2f}  avg_lift {avg_lift:.2f}")

    lift_mae = {k: float(np.mean(v)) for k, v in errs.items() if v}
    log("     mean absolute lift error: " + "  ".join(f"{k} {v:.3f}" for k, v in lift_mae.items()))
    for e in engines:
        engines[e]["lift_mae"] = lift_mae.get(e)

    log("5/5  exporting the 3x3 response surface per category")
    meta = pr.set_index("product_id")
    cats = []
    for c, rows in test.groupby("category"):
        if len(rows) < 400:
            continue
        surface = [[float(counterfactual(model, rows, d, m).mean()) for m in range(3)] for d in range(3)]
        pids = rows["product_id"].unique()
        cats.append({
            "category": c,
            "title": c.title().replace("/", " / "),
            "products": int(len(pids)),
            "price": round(float(grid[grid.category == c]["price"].median()), 2),
            "base_rate": surface[0][0],
            "surface": surface,
            "observed_mix": [int((rows.display_grp == d).sum()) for d in range(3)],
        })
    cats.sort(key=lambda r: -r["base_rate"])
    log(f"     {len(cats)} categories exported")

    (OUT / "validation.json").write_text(json.dumps({
        "holdout": {"weeks": [TRAIN_END + 1, TEST_END], "rows": int(len(test)),
                    "buys": int(test.y.sum()), "households": int(test.member_id.nunique()),
                    "products": int(len(products)), "store": "store_367"},
        "training": {"weeks": [HIST_END + 1, TRAIN_END], "rows": int(len(train)),
                     "buys": int(train.y.sum()), "history_weeks": [1, HIST_END]},
        "engines": engines, "effects": effects, "avg_lift": avg_lift, "lift_mae": lift_mae,
    }, indent=1), encoding="utf-8")

    (OUT / "surface.json").write_text(json.dumps({
        "display_labels": DISPLAY_LBL, "mailer_labels": MAILER_LBL,
        "levers": LEVERS, "beta": [float(b) for b in model["beta"]],
        "categories": cats, "auc": engines["simon1"]["auc"],
        "store": "store_367", "holdout_weeks": [TRAIN_END + 1, TEST_END],
    }, indent=1), encoding="utf-8")
    log(f"\nwrote {OUT/'validation.json'}\nwrote {OUT/'surface.json'}")


if __name__ == "__main__":
    main()
