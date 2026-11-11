# Demo script

Four minutes. One store, one decision, and a number that survives a statistician.

**Before you start**

```
python server.py
```

Open `http://localhost:8000`, leave it on **The space**, and have a photo of a shop interior
on the desktop if you want to show the vision path.

---

### 0:00 — The problem (20s)

> Every grocery store has two or three positions that actually sell. Entrance endcap, the
> flyer front page, the mid-floor island. Deciding what goes there is worth millions a year
> and it is almost always decided by whoever shouts loudest. Simon decides it from receipts.

### 0:20 — The space (40s)

Orbit the 3D floor once, then hit **Plan**.

> A neighbourhood supermarket. Ten category zones, five display positions worth fighting
> over, five flyer slots. The 3D and the plan are the same object the simulator scores, so
> nothing here is decoration.

Optional: drop a photo on **Build from photos**. It reads the fixtures, the poster style and
the product zones and rebuilds the floor. If it is slow or you are offline, say so and move
on. The demo floor carries the rest.

### 1:00 — Today (40s)

Screen 2.

> This is the store as it stands. The prime positions have gone to crackers, soft drinks and
> cheese, which are the three biggest sellers on this floor. That is how these decisions
> normally get made, and it is a perfectly reasonable-looking plan.

Pause.

> It is also wrong, because selling the most and responding the most are different things.
> Bacon on this floor responds nearly five times over when you promote it, and right now it
> is on plain shelf and not in the flyer.

### 1:40 — One scenario (40s)

Screen 3. Put **Bacon** on **Entrance endcap (left)** and into **Flyer interior A**.

> One move. Simon rescores the whole floor against the same shoppers, so the only thing that
> changed is the plan.

Point at the delta.

> That is the model doing the thing it exists for: estimating the effect of a change before
> anyone touches a shelf.

### 2:20 — Let it search (40s)

Screen 4. Click **Run 1,000 scenarios**.

> A thousand complete plans, each respecting the real constraint that there are only five
> display positions and five flyer slots, all scored against the same shoppers.

Point at the three numbers, then the histogram.

> Best plan found is about 35% ahead, roughly seven hundred dollars a week on this floor.
> And notice: only 395 of the thousand random plans beat today. Today's plan is genuinely
> decent, around the sixtieth percentile. The model still finds a third more.

### 3:00 — Why believe it (60s)

**Model check**. This is the part that wins or loses the judging. Go slowly.

> Simon-1 never sees the last six weeks. It is then scored on all 559,090 decisions in them.
> Best AUC, best log loss. But look at the second table, because that is the real claim.

Point at the lift table.

> Measured is the lift read off holdout receipts with a confidence interval. Simon-1 is
> inside the interval on all four levers, mean error 0.032. Ignore-promotion: zero out of
> four. The average-lift rule: one out of four. Claude, asked the same question in words:
> two out of four, mean error twelve times ours.

Then the third card, deliberately.

> And here is why they all fail the same way. Stores promote what was already selling. If
> you pool every product-week and divide, you get 1.95x for an endcap. That is the number a
> spreadsheet produces. Stratify it, so a product-week is only ever compared against itself
> across stores, and it is 1.34x.
>
> The average-lift rule says 2.07. Claude says 2.34. Both land on the naive figure, because
> that is the number the textbooks quote. Everything that has not done the stratification
> lands on the folk number. We're built on the contrast, so we land on the measurement.

### 4:00 — Close (10s)

> Simon tells a store manager which three things to move on Monday, and it is the only engine
> in that table that can tell you how much it will be worth without being out by a factor of
> two.

---

## Questions you will get

**"Did you fit the coefficient to the thing you are testing?"**
No. Coefficients are fitted on weeks 27–47. The measured lifts come from weeks 48–53, which
the model never sees in any form. Behavioural features come from weeks 1–26, so they cannot
leak labels either.

**"How do you know 1.34 is right and 1.95 is wrong?"**
Three independent identification strategies agree: between stores within a product-week,
within a store across weeks, and within a store-week across products all land in the same
place once stratified. The pooled number is the only one that disagrees, and it disagrees in
exactly the direction selection bias predicts.

**"Why is the AUC gap small?"**
Most of the predictive signal in grocery is household habit, and all three engines have it.
The gap between them is exactly the part placement explains, which is all Simon-1 claims. The
promoted-rows columns isolate it: on the 360,000 decisions where nothing was promoted, the
engines are identical by construction.

**"Did you test Jev?"**
Not yet, and the app says so on the Model check screen. Jev is a proprietary decision model
with no free endpoint and no local weights, so it needs an OpenRouter key we do not have. The
harness is written and the column is wired through; set `OPENROUTER_API_KEY` and re-run one
script and it fills in. Same for GPT, Gemini and Llama.

**"Why those 70 products?"**
Staples do not respond to merchandising — the top products by volume show a lift of about 1.0.
Fitting on them produces a null result. Simon trains on the mid-tail, where the chain actually
varied placement. That is a finding, not a convenience.

**"Revenue numbers look small."**
They cover the promotable items Simon models in ten categories, not the store's whole basket,
scaled to 12,000 weekly visits. Read the percentage.

**"Can it do my store?"**
The floor comes from photos. The response surface needs that chain's own receipts, and the
whole pipeline retrains in about four minutes.
