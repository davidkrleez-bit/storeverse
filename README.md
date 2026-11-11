# Simon

Decide where things go in a store before you move them.

Simon learns how in-store placement and flyer position change what people buy, from a year
of real grocery receipts across a chain, then scores any floor plan you give it. Ask "what
if bacon took the entrance endcap", and the answer comes from a measured causal effect
rather than a rule of thumb.

```
python model/prepare_data.py    # fetch and convert the chain's records  (~1 min)
python model/pipeline.py        # train and validate                     (~4 min)
python model/llm_baseline.py    # score language models on the same task (~2 min)
python model/make_store.py      # build the demo floor
python server.py                # then open localhost:8000
```

---

## The headline

On a holdout of **559,090 decisions** the chain never showed the model, Simon-1 estimates the
effect of a merchandising change with a mean absolute error of **0.032**, against 0.383 for a
language model, 0.498 for ignoring promotion and 0.574 for the usual average-lift rule. It is
the only engine whose estimate lands inside the measured confidence interval on all four
levers.

| Change | Measured | Simon-1 | As-usual | Average lift | Claude |
| --- | --- | --- | --- | --- | --- |
| Secondary display | 1.32 [1.23, 1.43] | **1.34** ✓ | 1.00 | 2.07 | 1.56 |
| Front endcap | 1.34 [1.23, 1.48] | **1.31** ✓ | 1.00 | 2.07 | 2.34 |
| Flyer interior | 1.60 [1.33, 1.90] | **1.53** ✓ | 1.00 | 2.07 | 1.35 ✓ |
| Flyer front page | 1.72 [1.32, 2.22] | **1.70** ✓ | 1.00 | 2.07 ✓ | 1.77 ✓ |
| **Mean error** | | **0.032** | 0.498 | 0.574 | 0.383 |
| **Inside the interval** | | **4 / 4** | 0 / 4 | 1 / 4 | 2 / 4 |

And on ordinary predictive accuracy over the same holdout:

| Engine | AUC | Log loss | AUC, promoted rows | Log loss, promoted |
| --- | --- | --- | --- | --- |
| **Simon-1** | **0.7674** | **0.03975** | **0.7397** | **0.05607** |
| As-usual | 0.7486 | 0.04065 | 0.7326 | 0.05860 |
| Average lift | 0.7674 | 0.04039 | 0.7326 | 0.05833 |

The promoted-row columns matter: on the 359,097 decisions where nothing was being promoted
all three engines are identical by construction, so the full-sample figures understate the gap.

---

## Why everything else is wrong in the same direction

This is the interesting part, and it is the reason the baselines are not strawmen.

**Stores promote what was already selling.** Take every product-week where some store ran an
endcap, add up sales on the promoted side and the unpromoted side, and divide. That sum says
a front endcap is worth **1.95x**. It is the number a spreadsheet produces, and it is wrong,
because the promoted side carries the weeks that were going to be good anyway.

Stratify the same comparison, so that a product-week is only ever compared against itself
across stores that merchandised it differently, and the answer is **1.34x**.

Now look at what each engine says. The average-lift rule measures 2.07x. Claude, asked what a
front endcap is worth, says 2.34x. Both land on the naive figure, because it is the figure the
trade press and the textbooks quote and the one a pooled analysis reproduces. **Every engine
that has not done the stratification lands on the folk number.** Simon-1 is built on the
contrast and lands on the measurement.

Getting this wrong is not academic. A planner who believes an endcap doubles sales will spend
prime space on the wrong categories and then be unable to explain why the quarter missed.

---

## The model

**Simon-1** predicts whether a given shopper picks up a given product on a given visit, and
what changes when you move that product.

A decision row is one product a shopper could have picked up on one real visit. The placement
attached to it is the placement that shopper actually walked past, because the store they
shopped that week decides it.

Three structural choices do the work.

**1. The baseline is blind to the levers, and to the calendar.** A single gradient-boosted
classifier handed the placement columns ignores them: household purchase history is so much
more predictive that the booster spends all its capacity there. Worse, given the week number
it learns which products the chain promoted in which week, which is the promotion effect
wearing a disguise. So the baseline sees household and product features and one chain-wide
seasonality number, and nothing else.

**2. The causal layer is fitted within product-week, across stores.** The same product in the
same week sits on an endcap in one store and on plain shelf in another. Comparing those stores
makes seasonality, price moves and national advertising common to the cell, so they cancel.
The flyer is a chain-wide decision with no cross-store contrast at all, so it is identified
within a product across weeks instead, with the chain's weekly rate divided out.

**3. The link is log, not logistic.** With tens of thousands of cells and a handful of
purchases in each, fixed-effects logistic regression is biased toward zero — the incidental
parameters problem — and it read a measured 1.34x as 1.26x. Under a log link the cell effect
is observed-over-expected within the cell, so it can be divided out exactly instead of
estimated. Isotonic calibration on held-back weeks puts the probabilities back on scale.

One more subtlety that cost a lot of the gap: the causal layer must **not** control for
household-product purchase history. How often a shopper already buys a product partly reflects
how often their usual store put it on an endcap last year, so holding it fixed subtracts part
of the effect being measured. A second, deliberately blinkered exposure model supplies what
the causal layer is allowed to condition on.

### Data

A year of loyalty-card records from a US grocery chain: **1,469,307 line items**, 92,331
products, **20,940,529 weekly placement records**, 2,469 households across 112 stores with
placement data. Each placement record carries the in-store display position and the flyer
position for a product in a store in a week.

Those codes collapse into the states a merchandiser picks between:

| Display | Flyer |
| --- | --- |
| No display | Not in flyer |
| Secondary display (in-aisle, in-shelf, rear) | Flyer interior / coupon |
| Front endcap (store front, end caps) | Flyer front page |

**Product selection matters more than any hyperparameter.** High-volume staples show no
promotion response: the top products by volume have a within-product lift of about 1.0,
because they sell the same however you merchandise them. Simon-1 trains on the 70 mid-tail
products that the chain genuinely moved around, where some store ran an endcap in a week when
another did not. Selecting on raw volume instead produces a null result.

### How it is validated

Weeks 1–26 build behavioural features and are never a label source. Weeks 27–47 train. Weeks
48–53 are held out completely: 559,090 decisions over 7,987 visits in 109 stores, carrying
4,241 actual purchases.

Baselines: **as-usual** ignores promotion; **average lift** applies one blanket multiplier;
**language models** are asked the same question in words and scored on the same scale.

---

## The language models

`model/llm_baseline.py` asks each model, for each lever, by what multiple weekly unit sales
change. That number goes into the same table and is marked against the same measurement.

Each model is asked five times, because a planner who asks once gets one draw from a spread
they cannot see. Claude's spread across runs is up to ±0.10.

Claude runs through the local `claude` CLI, so no API key is needed. **TypeSafe's Jev and the
other hosted models need `OPENROUTER_API_KEY`.** Jev has no free endpoint and no local
weights, so it cannot be run without one. The harness is written and the column is wired
through to the UI; set the key and re-run the script and it fills in, with nothing else to
change:

```
OPENROUTER_API_KEY=sk-or-... python model/llm_baseline.py
```

Models it will reach: `typesafe/jev-1.13`, `openai/gpt-5`, `google/gemini-2.5-pro`,
`meta-llama/llama-3.3-70b-instruct`. Edit `OPENROUTER_MODELS` to change the list.

---

## The app

**1 · The space** A 2D plan and a 3D model of the floor, built from the same spec the
simulator scores. Drop in photos of a real store and Simon reads the fixtures, the poster
style and the product zones, then rebuilds the floor. Vision runs through the local `claude`
CLI; if it is unavailable the demo floor stays loaded and everything else still works.

**2 · Today** The store as it stands, scored category by category over 12,000 weekly visits.
Volumes cover the promotable items Simon models in each category, not total category sales.

**3 · Scenarios** Move a category onto a display position or into the flyer. Simon rescores
the floor against the same visits, so only the plan changes.

**4 · Find the best** 1,000 complete plans, each respecting the real constraint of five
display positions and five flyer slots with one of each per category. On the demo store the
winner is **34.9% ahead**, about $712 a week, and only 395 of the 1,000 random plans beat the
current layout — so today's plan is decent, and the model still finds a third more.

**5 · Model check** Everything above, rendered from the artifacts the training run wrote.
Nothing on that screen is typed by hand.

Scoring and the whole search run in the browser against the exported response surface, so the
demo does not depend on the server staying up.

---

## Layout

```
data/
  raw/                 the chain's records as published
  *.parquet            converted, what the pipeline reads
model/
  prepare_data.py      fetch and convert
  pipeline.py          decision rows, training, validation, surface export
  llm_baseline.py      language models scored on the same task
  make_store.py        the demo floor, built from real category responses
web/
  index.html  app.js   the five screens, scoring, the scenario search
  scene.js             the 3D floor
  data/                artifacts the training run writes
server.py              static host plus the one vision endpoint
```

`web/data/*.json` is generated. Delete it and re-run the pipeline; nothing is hand-maintained.
