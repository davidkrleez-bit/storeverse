# Demo script

Four minutes. One store, one decision, one number that holds up.

**Before you start**

```
python server.py
```

Open `http://localhost:8000`, leave it on **The space**, and have one photo of a shop
interior on the desktop if you want to show the vision path.

---

### 0:00 — The problem (20s)

> Every grocery store has two or three positions that sell, and everything else is shelf.
> Entrance endcap, the flyer front page, the mid-floor island. Deciding what goes there is
> worth millions a year, and it is almost always decided by whoever shouts loudest. Simon
> decides it with the receipts.

### 0:20 — The space (40s)

On screen 1. Orbit the 3D floor once, then hit **Plan**.

> This is a neighbourhood supermarket. Ten category zones, five display positions worth
> fighting over, five flyer slots. The 3D and the plan are the same object the simulator
> scores, so nothing here is decoration.

Optional, if the room is warm: drop a photo on **Build from photos**. It reads the fixtures,
the poster style and the product zones and rebuilds the floor. If it is slow or the laptop
is offline, say so and move on. The demo floor carries the rest.

### 1:00 — Today (40s)

Screen 2.

> Here is what the store sells this week at its current layout. Look at the bottom panel.

Read it out.

> Soft drinks holds an entrance endcap and only moves 1.18x when you promote it. Juice holds
> the other one and moves 1.02x, which is nothing. Meanwhile cold cereal, the strongest
> responder on this floor at 2.34x, is sitting on plain shelf and is not in the flyer.
> Both prime positions are being spent on categories that do not respond.

### 1:40 — One scenario (40s)

Screen 3. Set **Entrance endcap (left)** to Cold cereal. Set **Flyer interior A** to Cold cereal.

> One move. Simon rescores the whole floor against the same shoppers, so the only thing that
> changed is the plan.

Point at the delta.

> That is the model doing the thing it was built for: estimating the effect of a change
> before anyone touches a shelf.

### 2:20 — Let it search (50s)

Screen 4. Click **Run 1,000 scenarios**.

> Now stop guessing. Simon builds a thousand complete plans, respects the real constraint
> that there are only five display positions and five flyer slots, scores every one against
> the same shoppers, and keeps the best.

Point at the three numbers, then the histogram.

> Best plan found is about 31% ahead of today. The red line is the store as it stands, and
> it sits near the bottom of the distribution. 98% of randomly generated plans beat the
> layout this store is actually running.

Point at **What the winner changes**.

> Cold cereal and bag snacks take the two entrance endcaps. Juice drops to a secondary
> position. Nine moves, no new stock, no price changes, same footfall.

### 3:10 — Why believe it (50s)

**Model check** in the sidebar. This is the part that wins or loses the judging.

> Simon-1 never sees the last six weeks. It is then scored on all 492,000
> household-product-week decisions in them, against two baselines a planner would otherwise
> use: ignore promotion, or apply one average lift to everything. Best AUC, best log loss.

Scroll to the effect table.

> This is the one that matters. The measured column is the lift read straight off receipts,
> each product compared against itself in weeks it did and did not hold that position.
> Front endcap measures 1.34. Simon-1 says 1.28. Ignore-promotion says 1.00, average-lift
> says 1.11.

Then, deliberately, read the honest paragraph.

> And it is not a clean sweep. With 205 households the front endcap is the only lever this
> data can resolve. The other three have intervals wide enough to contain no effect at all,
> and Simon-1 reports close to none for them rather than inventing one. Across all four
> levers the blunt average-lift rule actually edges us on mean error, because guessing the
> middle of a noisy set is hard to beat. More households fixes that. More model does not.

### 4:00 — Close (10s)

> Simon gets the lever that matters right, refuses to make up the ones it cannot see, and
> turns that into a floor plan you can hand to a store manager on Monday.

---

## Questions you will get

**"Did you just fit the promotion coefficient to the thing you are testing?"**
No. The coefficients are fitted on weeks 27 to 47. The measured lifts come from weeks 48 to
53, which the model never sees in any form. The behavioural features come from weeks 1 to 26,
so they cannot leak labels either.

**"Why is the AUC gap so small?"**
Because most of the predictive signal in grocery is household habit, and all three engines
have it. The gap between them is exactly the part placement explains, which is the only part
Simon-1 is claiming. A big AUC gap here would mean the baselines were strawmen.

**"Why those products and not the whole catalogue?"**
Staples do not respond to merchandising: the top 147 products by volume show a lift of about
1.0. Fitting on them produces a null result. Simon trains on the mid-tail, where the store
actually varied placement and where the response is. That is a finding, not a convenience.

**"Revenue numbers look small."**
They are the promotable items Simon models in ten categories, not the store's whole basket,
scaled to 12,000 weekly visits. The percentage change is the number to read.

**"Can it do my store?"**
The floor comes from photos. The response surface needs that chain's own receipts, and the
whole pipeline retrains in about two minutes.
