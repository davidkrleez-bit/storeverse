# StoreVerse

Decide where things go in a store before you move them.

StoreVerse learns how in-store placement and flyer position change what people buy, from a year
of real grocery receipts across a chain, then scores any floor plan you give it. Ask "what
if bacon took the entrance endcap", and the answer comes from a measured causal effect
rather than a rule of thumb.

**Live demo:** https://davidkrleez-bit.github.io/planomix/ &nbsp;·&nbsp; no install, runs in
the browser. Reading a store from photographs is the one part that needs the local server
below; everything else on that page is the real thing.

```
python model/prepare_data.py    # fetch and convert the chain's records  (~1 min)
python model/pipeline.py        # train and validate                     (~4 min)
python model/llm_baseline.py    # score language models on the same task (~2 min)
python model/make_store.py      # build the demo floor
python server.py                # then open localhost:8000
```

---

## The headline

On a holdout of **559,090 decisions** the chain never showed the model, StoreVerse-1 estimates the
effect of a merchandising change with a mean absolute error of **0.032**. The next best engine
of any kind is **4.7x worse**, and StoreVerse-1 is the only one whose estimate lands inside the
measured interval on all four levers.

| Engine | Secondary display | Front endcap | Flyer interior | Flyer front page | Mean error | In CI |
| --- | --- | --- | --- | --- | --- | --- |
| **Measured** (stratified) | 1.32 [1.23, 1.43] | 1.34 [1.23, 1.48] | 1.60 [1.33, 1.90] | 1.72 [1.32, 2.22] | | |
| **StoreVerse-1** | **1.34** ✓ | **1.31** ✓ | **1.53** ✓ | **1.70** ✓ | **0.032** | **4 / 4** |
| GPT-5.6 Luna Pro | 1.35 ✓ | 1.64 | 1.39 ✓ | 1.79 ✓ | 0.151 | 3 / 4 |
| Claude | 1.58 | 2.40 | 1.36 ✓ | 1.82 ✓ | 0.413 | 2 / 4 |
| Jev (TypeSafe decision model) | 1.49 | 2.58 | 1.20 | 1.60 ✓ | 0.481 | 1 / 4 |
| Llama 3.3 70B | 1.56 | 2.50 | 1.72 ✓ | 3.12 | 0.727 | 1 / 4 |
| Gemini 2.5 Pro | 1.80 | 3.80 | 1.84 ✓ | 3.50 | 1.237 | 1 / 4 |
| As-usual | 1.00 | 1.00 | 1.00 | 1.00 | 0.498 | 0 / 4 |
| Average lift | 2.07 | 2.07 | 2.07 | 2.07 ✓ | 0.574 | 1 / 4 |

Two things stand out. **Jev, a decision model purpose-built for exactly this kind of typed
estimate, does worse than a general-purpose LLM** and 15x worse than StoreVerse-1 — and it gave the
widest spread of any model on the endcap question, ±0.40 across five runs. And **Gemini is off
by a factor of nearly three** on the front endcap while sounding exactly as confident as
everyone else.

And on ordinary predictive accuracy over the same holdout:

| Engine | AUC | Log loss | AUC, promoted rows | Log loss, promoted |
| --- | --- | --- | --- | --- |
| **StoreVerse-1** | **0.7674** | **0.03975** | **0.7397** | **0.05607** |
| As-usual | 0.7486 | 0.04065 | 0.7326 | 0.05860 |
| Average lift | 0.7674 | 0.04039 | 0.7326 | 0.05833 |

The promoted-row columns matter: on the 359,097 decisions where nothing was being promoted all
three engines are identical by construction, so the full-sample figures understate the gap.

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
that has not done the stratification lands on the folk number.** StoreVerse-1 is built on the
contrast and lands on the measurement.

Getting this wrong is not academic. A planner who believes an endcap doubles sales will spend
prime space on the wrong categories and then be unable to explain why the quarter missed.

---

## The model

**StoreVerse-1** predicts whether a given shopper picks up a given product on a given visit, and
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
because they sell the same however you merchandise them. StoreVerse-1 trains on the 70 mid-tail
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
they cannot see. That spread is wide and it is not symmetric across models: Gemini moved ±1.40
on the flyer front page between runs, Jev ±0.40 on the endcap, GPT ±0.40, Claude ±0.10.

Claude runs through the local `claude` CLI, so no key is needed. The rest go through OpenRouter:

```
OPENROUTER_API_KEY=sk-or-... python model/llm_baseline.py --repeats 5
```

Models reached: `typesafe/jev-router`, `openai/gpt-5.6-luna-pro`, `google/gemini-2.5-pro`,
`meta-llama/llama-3.3-70b-instruct`. Edit `OPENROUTER_MODELS` to change the list, and check
`/api/v1/models` first — a version string that does not exist fails validation rather than
being coerced to the nearest one.

If no key is set the script says which models went unscored and the app shows that note,
rather than quietly leaving the column blank.

## Live demo

https://davidkrleez-bit.github.io/planomix/

The floor, the fitted surface, the scenario editor and the 1,000-plan search all run in
the browser, so the walkthrough stands up on a static host. Reading a store from
photographs does not: it calls a model through the local `claude` CLI, and needs
`server.py`. The page says so when asked there.

`./deploy.sh` pushes the current `web/` to it. Only `web/` goes up, because only `web/`
is served; the pipeline, the vision server and the model code stay here.

## Goals in plain words

Step 4 takes the goal written the way a shopkeeper would say it - "I have a new product
collaboration coming in... make it clear what it is, this new chip snack" - and turns it
into what the search should be making big. A model reads it when `server.py` is running;
a keyword match reads it otherwise, and the screen says which did.

The model never answers the merchandising question. It only names a target category and
an objective, and the fitted surface answers the rest. It is also where the honesty sits:
asked to make a product *understood*, it reports that signage, packaging and sampling are
outside what this simulator moves.

A goal aimed at one category changes what "best" means, so the search optimises that
category's revenue and reports what the rest of the shop gave up for it.

When the goal is about one category and a handful of positions - "the entrance display, an
aisle endcap, or the weekly flyer" - there is nothing to search. Each option is scored
exactly: today's floor with that one category moved, carrying the cost of taking the
position off whatever holds it. The verdict weighs that cost rather than reading off the
longest bar, so the option that wins the category by a tenth of a point and costs the rest
of the shop three times as much does not get recommended.

## The example store

`web/data/example.json` is Fortuna Super: an 8,600 sq ft neighbourhood supermarket with
550 customers a day, laid out from four overhead views of a public Matterport scan onto
the standard neighbourhood floorplan, so every trained category is on the floor and the
contested positions sit where they were defined. It is labelled a demo layout on screen,
because a photo upload reads a store the other way round and usually matches fewer.

## The nine

For one category the decision is small and exactly enumerable: three display positions
crossed with three flyer slots. A category holds at most one of each, so nine cells is
the whole thing rather than a sample of it, and every cell runs on screen with shoppers
walking it.

Each cell is then played out over a hundred simulated weeks. Weekly units for a category
are a count over the week's visits, so each week draws its own, and the same draws are
reused across all nine - the same shoppers, the same visits - which pairs the comparison
and strips out the luck common to all of them. Re-rolling rerolls it for all nine at once.

Because the weeks are paired, a plan with the higher mean wins nearly every one of them,
so the win count states the ranking rather than the size of the gap. The gap between the
means is reported separately, and when the top two are within 3% the page says they are
closer than the model can honestly separate.

## The thousand plans

The search is a random sweep, not a solver. One pass builds 1,000 complete plans from a
fixed seed, so the same floor always gives the same thousand. Each plan shuffles the
categories, deals them onto the display positions and the flyer slots, and leaves a slot
empty 12% of the time so "fill everything" has to earn its place. Each plan is then scored
in closed form against the fitted surface - no sampling, no noise - and the only thing
separating a good plan from a bad one is which category ended up on which position.

Every plan is kept, so the grid can show all thousand at once: one cell each, best in the
top-left, worst in the bottom-right, coloured by the gap to today's floor. Blue beats
today, red loses to it. Clicking a cell prints the layout behind it.

Underneath, the grid reports what separates the best tenth from the worst tenth - which
category holds which kind of position, and how often - which is the part a merchandiser
can act on without reading a single plan.

## The app

**1 · The space** A 2D plan and a 3D model of the floor, built from the same spec the
simulator scores. Drop in photos of a real store and StoreVerse rebuilds the floor from them.
Vision runs through the local `claude` CLI; if it is unavailable the demo floor stays
loaded and everything else still works.

Reading a store happens in two passes, because looking and matching fail differently.
The first pass only looks, with no schema and no category list in front of it, and
returns plain prose about the fixtures and what is on the shelves. That text goes on
screen as it lands. The second pass is handed the reading, the photos again, the ten
categories the model was actually fitted on, and the floor archetypes, and its only job
is to match one onto the other.

Two rules keep the result scoreable. A zone exists only if its category came back with a
fitted surface, so nothing lands on the floor that the model cannot score — and when a
product group has no home in the ten, it is reported as seen and left off rather than
forced onto the nearest survivor, because a wrong match would go on to be scored as if it
were real. The contested positions come from the archetype rather than the photo, so the
levers stay the ones the model was fitted on; what the store type changes is how many
there are. A corner shop has three positions and no circular at all, a supermarket has
seven and a front page, and that is a different optimisation problem, not a different
picture. What the photo does set is cosmetic: the room's dimensions, its colours, and
where each fixture sits. None of it reaches a number.

**2 · Today** The store as it stands, scored category by category over 12,000 weekly visits.
Volumes cover the promotable items StoreVerse models in each category, not total category sales.

**3 · Scenarios** Move a category onto a display position or into the flyer. StoreVerse rescores
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
  archetypes.js        floor archetypes: what each store type has to fight over
  data/                artifacts the training run writes
server.py              static host plus the two vision passes
```

`web/data/*.json` is generated. Delete it and re-run the pipeline; nothing is hand-maintained.
