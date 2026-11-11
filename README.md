# Simon

Decide where things go in a store before you move them.

Simon learns how in-store placement and flyer position change what people buy, from a year
of real grocery receipts, then scores any floor plan you give it. Point it at a store, ask
"what if cold cereal took the entrance endcap", and it answers with a number that came from
a fitted purchase probability rather than a rule of thumb.

```
python model/pipeline.py     # train and validate       (~2 min)
python model/make_store.py   # build the demo floor
python server.py             # then open localhost:8000
```

---

## The model

**Simon-1** predicts whether a given household buys a given product in a given week, and
what changes when you move that product.

The structure matters more than the algorithm. A single gradient-boosted classifier handed
the placement columns ignores them: household purchase history is so much more predictive
that the booster spends all its capacity there and treats merchandising as noise. Fed the
same data, it recovers a 1.04x front-endcap effect where the receipts say 1.34x. So Simon-1
splits the problem in two:

1. **Baseline demand.** A gradient-boosted classifier over household and product features,
   deliberately blind to the levers. It answers "who buys this anyway".
2. **Promotion response.** An offset logistic regression fitted on the baseline model's own
   log-odds, with one coefficient per lever. Because the baseline is an offset rather than a
   feature, this layer can only explain what the baseline could not, which is what isolates
   the placement effect from the popularity of whatever already sits there.
3. **Isotonic calibration** on weeks the booster never saw, so the probabilities are usable
   as probabilities and not just as a ranking.

Per-category coefficients are shrunk toward the global effect, so a thin category borrows
strength instead of inventing a response.

### Data

A year of records from one grocery store: 41,334 line items, 13,286 products and 54,415
weekly placement records covering 205 households. Each placement record carries the
in-store display position and the flyer position for a product in a week, which is what
makes a causal read possible at all.

Those codes collapse into the three states a merchandiser actually picks between:

| Display | Flyer |
| --- | --- |
| No display | Not in flyer |
| Secondary display (in-aisle, in-shelf, rear) | Flyer interior / coupon |
| Front endcap (store front, end caps) | Flyer front page |

**Product selection is the single biggest modelling decision.** High-volume staples show no
promotion response at all: the top 147 products by volume have a within-product lift of
about 1.0, because they sell the same however you merchandise them. The response lives in
the mid-tail. Simon-1 trains on the 400 products with 5 to 40 buyer-weeks that the store
both promoted and did not promote at some point. Selecting on raw volume instead produces a
null result, which is the trap this problem sets.

### How it is validated

Weeks 1-26 build behavioural features and are never a label source. Weeks 27-47 train.
Weeks 48-53 are held out completely, and every household-product-week decision in them is
scored: 492,000 rows carrying 618 actual purchases.

Two baselines stand in for what a planner would otherwise do:

- **As-usual** ignores promotion entirely.
- **Average lift** applies one blanket multiplier to every promotion.

| Engine | AUC | Log loss | Brier | Calibration error |
| --- | --- | --- | --- | --- |
| **Simon-1** | **0.9062** | **0.00699** | 0.0012039 | 0.000271 |
| As-usual | 0.9044 | 0.00705 | **0.0012002** | **0.000236** |
| Average lift | 0.9058 | 0.00703 | 0.0012033 | 0.000255 |

Then the question the product actually turns on: can it predict the effect of a change? The
measured column reads the lift straight off receipts, comparing each product against itself
in weeks it did and did not hold that position, with a 90% bootstrap interval over products.

| Change | Measured | Simon-1 | As-usual | Average lift |
| --- | --- | --- | --- | --- |
| Front endcap | 1.34 [0.90, 2.11] | **1.28** | 1.00 | 1.11 |
| Secondary display | 1.41 [0.98, 2.04] | 0.99 | 1.00 | 1.11 |
| Flyer interior | 0.91 [0.67, 1.22] | 1.10 | 1.00 | 1.11 |
| Flyer front page | 1.15 [0.78, 1.57] | 0.96 | 1.00 | 1.11 |

### What this does and does not show

Simon-1 wins on AUC and log loss, and it is the only engine that recovers the front-endcap
effect. That is the lever with the most data behind it and the one a merchandiser fights
over, so it is the right thing to get right.

It is not a clean sweep, and the app says so on the Model check screen. With 205 households
the front endcap is the only lever the data can resolve: the other three have intervals wide
enough to contain no effect at all. Simon-1 reports close to no effect for those rather than
inventing one, which is the correct behaviour and also why the blunt average-lift rule edges
it on mean absolute lift error across all four levers (0.195 against 0.217). Guessing the
middle of a noisy set is hard to beat when the set is noisy enough. More households fixes
that, not more model.

The two baselines also sit closer than the headline suggests, because most of the predictive
signal in this problem is household habit, which all three engines share. The gap between
them is exactly the part that placement explains, which is the part Simon-1 exists to model.

---

## The app

Five screens, in the order you would actually use them.

**1 · The space** A 2D plan and a 3D model of the floor, built from the same spec the
simulator scores. Drop in photos of a real store and Simon reads the fixtures, the poster
style and the product zones, then rebuilds the floor to match. Vision runs through the local
`claude` CLI, so no API key lives in this repo; if it is unavailable the demo floor stays
loaded and everything else still works.

**2 · Today** The store as it stands, scored category by category over 12,000 weekly visits.
Volumes cover the promotable items Simon models in each category, not total category sales.

**3 · Scenarios** Move a category onto a display position or into the flyer. Simon rescores
the whole floor against the same visits, so only the plan changes.

**4 · Find the best** Simon builds 1,000 complete plans, scores each, and keeps the winner.
Every plan respects the real constraint: five display positions, five flyer slots, and a
category can hold one of each. The histogram shows where the thousand landed against today.

**5 · Model check** Everything in the validation section above, rendered from the artifact
the training run wrote. Nothing on that screen is typed by hand.

Scoring and the whole 1,000-plan search run in the browser against the exported response
surface, so the demo does not depend on the server staying up.

---

## Layout

```
data/                  the store's records, as CSV
model/
  pipeline.py          decision rows, training, validation, surface export
  make_store.py        the demo floor, built from real category responses
web/
  index.html  app.js   the five screens, scoring, the scenario search
  scene.js             the 3D floor
  data/                artifacts the training run writes
server.py              static host plus the one vision endpoint
```

`web/data/validation.json` and `web/data/surface.json` are generated. Delete them and
re-run the pipeline; nothing is hand-maintained.
