// Simon - store simulation.
// Every number on screen comes from the response surface the model exported, so a figure
// here traces back to a fitted purchase probability rather than a planning rule of thumb.
import { mountScene, updateScene } from './scene.js';

const $ = s => document.querySelector(s);
const view = $('#view');
const n0 = n => Math.round(n).toLocaleString();
const n1 = n => n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const money = n => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString();
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pctd = n => (n >= 0 ? '+' : '') + n.toFixed(1) + '%';

let STORE = null, VALID = null;
let plan = {};        // slot id -> category: the plan currently on screen
let baseline = null;  // the store as found, scored once at boot
let sweep = null;     // last optimisation run

// ------------------------------------------------------------------ scoring
/** Resolve a slot assignment into a display level and a flyer level per category. */
function levels(assign) {
  const d = {}, m = {};
  for (const z of STORE.zones) { d[z.category] = 0; m[z.category] = 0; }
  for (const s of STORE.slots) {
    const c = assign[s.id];
    if (!c || !(c in d)) continue;
    if (s.kind === 'display') d[c] = Math.max(d[c], s.level);
    else m[c] = Math.max(m[c], s.level);
  }
  return { d, m };
}

/** Expected weekly units and revenue for a plan, category by category. */
function score(assign) {
  const { d, m } = levels(assign);
  const visits = STORE.visits_per_week;
  let units = 0, revenue = 0;
  const rows = STORE.zones.map(z => {
    const p = z.surface[d[z.category]][m[z.category]];
    const u = p * visits, r = u * z.price;
    units += u; revenue += r;
    return { ...z, d: d[z.category], m: m[z.category], p, units: u, revenue: r, lift: p / z.base };
  });
  return { units, revenue, rows, d, m };
}

const emptyPlan = () => Object.fromEntries(STORE.slots.map(s => [s.id, null]));
const zoneOf = c => STORE.zones.find(z => z.category === c);
const titleOf = c => (zoneOf(c) || {}).title || c || '—';

// ------------------------------------------------------------------ views
const VIEWS = {};

VIEWS.space = () => {
  const s = STORE.size;
  view.innerHTML = `
  <div class="head">
    <div class="eyebrow">Step 1</div>
    <h1>The space</h1>
    <p class="sub">${esc(STORE.name)}. ${esc(STORE.note)} Ten category zones, five contested display
    positions, five flyer slots. Drop in photos to rebuild the floor from a real store, or work
    from the demo plan.</p>
  </div>
  <div class="grid2">
    <div>
      <div class="stage">
        <div class="stagebar">
          <button class="chip on" id="t3d">3D</button>
          <button class="chip" id="t2d">Plan</button>
        </div>
        <canvas id="three"></canvas>
        <canvas id="plan" hidden></canvas>
      </div>
      <p class="hint mt8">Drag to orbit, scroll to zoom. Filled markers are display positions in use.</p>
    </div>
    <div>
      <div class="card">
        <h2>Build from photos</h2>
        <p class="hint">Upload shots of a store. Simon reads the fixtures, the poster style and the
        product zones, then rebuilds the floor to match.</p>
        <div class="drop" id="drop">
          <input type="file" id="file" accept="image/*" multiple hidden>
          <b>Drop photos here</b><br><span>or <u id="browse" style="cursor:pointer">browse</u></span>
        </div>
        <div id="vstat" class="note mt8"></div>
      </div>
      <div class="card mt">
        <h2>Floor</h2>
        <table>
          <tr><td>Sales floor</td><td class="num">${n0(s.w * s.d)} m&sup2;</td></tr>
          <tr><td>Weekly visits modelled</td><td class="num">${n0(STORE.visits_per_week)}</td></tr>
          <tr><td>Category zones</td><td class="num">${STORE.zones.length}</td></tr>
          <tr><td>Display positions</td><td class="num">${STORE.slots.filter(x => x.kind === 'display').length}</td></tr>
          <tr><td>Flyer slots</td><td class="num">${STORE.slots.filter(x => x.kind === 'mailer').length}</td></tr>
        </table>
      </div>
    </div>
  </div>`;
  mountScene($('#three'), STORE);
  updateScene(plan, score(plan));
  $('#t3d').onclick = () => stageMode(true);
  $('#t2d').onclick = () => stageMode(false);
  wireUpload();
};

function stageMode(three) {
  const a = $('#three'), b = $('#plan');
  if (!a || !b) return;
  a.hidden = !three; b.hidden = three;
  $('#t3d').classList.toggle('on', three);
  $('#t2d').classList.toggle('on', !three);
  if (!three) drawPlan();
}

// --------------------------------------------------------------- 2D plan
function drawPlan() {
  const cv = $('#plan'); if (!cv) return;
  const S = STORE.size, pad = 26, scale = 26;
  const W = S.w * scale + pad * 2, H = S.d * scale + pad * 2;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = W * dpr; cv.height = H * dpr;
  cv.style.width = '100%'; cv.style.height = 'auto';
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const X = x => pad + x * scale, Z = z => pad + (S.d - z) * scale;

  g.fillStyle = '#f7f5f2'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#fff'; g.strokeStyle = '#d9d5ce'; g.lineWidth = 1.5;
  g.beginPath(); g.rect(X(0), Z(S.d), S.w * scale, S.d * scale); g.fill(); g.stroke();

  const { d, m } = levels(plan);
  const byCat = Object.fromEntries(score(plan).rows.map(r => [r.category, r]));

  for (const z of STORE.zones) {
    const hot = d[z.category] > 0 || m[z.category] > 0;
    g.fillStyle = hot ? '#e6f0ec' : '#efece7';
    g.strokeStyle = hot ? '#1c6f5a' : '#cfcac2';
    g.lineWidth = hot ? 1.6 : 1;
    const x = X(z.x - z.w / 2), y = Z(z.z + z.d / 2);
    g.beginPath(); g.roundRect(x, y, z.w * scale, z.d * scale, 4); g.fill(); g.stroke();
    g.save();
    g.translate(x + z.w * scale / 2, y + z.d * scale / 2);
    if (z.d > z.w * 1.2) g.rotate(-Math.PI / 2);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#15161a'; g.font = '600 11px ui-sans-serif,system-ui';
    g.fillText(z.title, 0, -5);
    g.fillStyle = '#5b5f68'; g.font = '500 10px ui-sans-serif,system-ui';
    g.fillText(n1(byCat[z.category].units) + '/wk', 0, 7);
    g.restore();
  }
  for (const s of STORE.slots.filter(x => x.kind === 'display')) {
    const taken = plan[s.id];
    g.fillStyle = taken ? '#1c6f5a' : '#fff';
    g.strokeStyle = taken ? '#1c6f5a' : '#b9b4ab';
    g.lineWidth = 1.4; g.setLineDash(taken ? [] : [4, 3]);
    const x = X(s.x - s.w / 2), y = Z(s.z + s.d / 2);
    g.beginPath(); g.roundRect(x, y, s.w * scale, s.d * scale, 3); g.fill(); g.stroke();
    g.setLineDash([]);
    if (taken) {
      g.fillStyle = '#fff'; g.font = '650 9px ui-sans-serif,system-ui';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(titleOf(taken).slice(0, 12), x + s.w * scale / 2, y + s.d * scale / 2);
    }
  }
  for (const c of STORE.checkouts) {
    g.fillStyle = '#e4e0d9'; g.strokeStyle = '#cfcac2'; g.lineWidth = 1;
    const x = X(c.x - c.w / 2), y = Z(c.z + c.d / 2);
    g.beginPath(); g.roundRect(x, y, c.w * scale, c.d * scale, 3); g.fill(); g.stroke();
  }
  const e = STORE.entrance;
  g.strokeStyle = '#15161a'; g.lineWidth = 3.5;
  g.beginPath(); g.moveTo(X(e.x - e.w / 2), Z(0)); g.lineTo(X(e.x + e.w / 2), Z(0)); g.stroke();
  g.fillStyle = '#5b5f68'; g.font = '600 10px ui-sans-serif,system-ui'; g.textAlign = 'center';
  g.fillText('ENTRANCE', X(e.x), Z(0) + 15);
}

// --------------------------------------------------------------- step 2
VIEWS.baseline = () => {
  const sc = baseline;
  const rows = [...sc.rows].sort((a, b) => b.revenue - a.revenue);
  const max = Math.max(...rows.map(r => r.revenue));
  view.innerHTML = `
  <div class="head">
    <div class="eyebrow">Step 2</div>
    <h1>What the store sells today</h1>
    <p class="sub">Simon scores the floor as it stands: every category at its current shelf
    position and its current flyer treatment, over ${n0(STORE.visits_per_week)} weekly visits.
    This is the number every scenario is measured against.</p>
  </div>
  <div class="grid3">
    <div class="stat"><div class="l">Units per week</div><div class="v">${n1(sc.units)}</div>
      <div class="d">promotable items in ${STORE.zones.length} categories</div></div>
    <div class="stat"><div class="l">Revenue per week</div><div class="v">${money(sc.revenue)}</div>
      <div class="d">at shelf price</div></div>
    <div class="stat"><div class="l">Promoted positions used</div>
      <div class="v">${Object.values(plan).filter(Boolean).length}<span style="font-size:15px;color:var(--ink2)"> / ${STORE.slots.length}</span></div>
      <div class="d">display and flyer slots filled</div></div>
  </div>
  <div class="card mt">
    <h2>Category breakdown</h2>
    <p class="hint">Units cover the promotable items Simon models in each category, not the category's total sales.</p>
    <table>
      <thead><tr><th>Category</th><th>Position</th><th>Flyer</th>
        <th class="num">Units/wk</th><th class="num">Revenue</th><th style="width:150px"></th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td><b>${esc(r.title)}</b></td>
        <td><span class="tag${r.d ? ' hot' : ''}">${esc(STORE.display_labels[r.d])}</span></td>
        <td><span class="tag${r.m ? ' hot' : ''}">${esc(STORE.mailer_labels[r.m])}</span></td>
        <td class="num">${n1(r.units)}</td>
        <td class="num">${money(r.revenue)}</td>
        <td><span class="bartrack"><span class="bar" style="width:${(r.revenue / max * 100).toFixed(1)}%"></span></span></td>
      </tr>`).join('')}</tbody>
    </table>
  </div>
  <div class="card mt">
    <h2>Where the money is going</h2>
    <p class="note">${esc(worstSpend())}</p>
  </div>`;
};

/** Point at the prime positions currently given to categories that barely respond. */
function worstSpend() {
  const taken = STORE.slots.filter(s => s.kind === 'display' && s.level === 2 && plan[s.id]);
  if (!taken.length) return 'Both entrance endcaps are empty.';
  const bits = taken.map(s => {
    const z = zoneOf(plan[s.id]);
    const best = z.surface[2][1] / z.base;
    return `${z.title} holds ${s.label.toLowerCase()} but only moves ${best.toFixed(2)}x when promoted`;
  });
  const bestCat = [...STORE.zones].sort((a, b) =>
    (b.surface[2][1] / b.base) - (a.surface[2][1] / a.base))[0];
  return bits.join('. ') + `. The strongest responder on this floor is ${bestCat.title}, at ` +
    `${(bestCat.surface[2][1] / bestCat.base).toFixed(2)}x on an entrance endcap with flyer support.`;
}

// --------------------------------------------------------------- step 3
VIEWS.scenario = () => {
  const sc = score(plan);
  const dU = sc.units - baseline.units, dR = sc.revenue - baseline.revenue;
  const cls = v => v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'flat';
  view.innerHTML = `
  <div class="head">
    <div class="eyebrow">Step 3</div>
    <h1>Run a scenario</h1>
    <p class="sub">Move a category onto a display position or into the flyer. Simon rescores the
    whole floor against the same ${n0(STORE.visits_per_week)} visits, so only the plan changes.</p>
  </div>
  <div class="grid2">
    <div>
      <div class="card">
        <h2>Display positions</h2>
        <p class="hint">Five positions, ten categories. Prime space is the scarce thing.</p>
        ${STORE.slots.filter(s => s.kind === 'display').map(slotRow).join('')}
      </div>
      <div class="card mt">
        <h2>Flyer</h2>
        <p class="hint">Two front-page slots, three interior slots.</p>
        ${STORE.slots.filter(s => s.kind === 'mailer').map(slotRow).join('')}
      </div>
      <div class="row mt">
        <button class="ghost" id="reset">Back to today</button>
        <button class="ghost" id="clear">Empty every slot</button>
        <button id="tobest" ${sweep ? '' : 'disabled'}>Load the best found plan</button>
      </div>
    </div>
    <div>
      <div class="stat"><div class="l">Units per week</div>
        <div class="v">${n1(sc.units)}</div>
        <div class="d ${cls(dU)}">${pctd(dU / baseline.units * 100)} against today</div></div>
      <div class="stat mt8"><div class="l">Revenue per week</div>
        <div class="v">${money(sc.revenue)}</div>
        <div class="d ${cls(dR)}">${money(dR)} against today</div></div>
      <div class="card mt">
        <h2>Change by category</h2>
        <table><tbody>${[...sc.rows]
          .map((r, i) => ({ r, b: baseline.rows[i] }))
          .filter(x => Math.abs(x.r.units - x.b.units) > 0.005)
          .sort((a, b) => (b.r.units - b.b.units) - (a.r.units - a.b.units))
          .map(({ r, b }) => {
            const dv = r.units - b.units;
            return `<tr><td>${esc(r.title)}</td>
              <td class="num ${cls(dv)}">${(dv >= 0 ? '+' : '') + n1(dv)} u</td>
              <td class="num ${cls(dv)}">${money(r.revenue - b.revenue)}</td></tr>`;
          }).join('') || '<tr><td class="note">Same as today.</td></tr>'}</tbody></table>
      </div>
    </div>
  </div>`;
  for (const sel of view.querySelectorAll('select')) {
    sel.onchange = () => { plan[sel.dataset.slot] = sel.value || null; VIEWS.scenario(); };
  }
  $('#reset').onclick = () => { plan = { ...STORE.current }; VIEWS.scenario(); };
  $('#clear').onclick = () => { plan = emptyPlan(); VIEWS.scenario(); };
  const tb = $('#tobest');
  if (tb && sweep) tb.onclick = () => { plan = { ...sweep.best.assign }; VIEWS.scenario(); };
};

function slotRow(s) {
  const opts = STORE.zones.map(z =>
    `<option value="${esc(z.category)}"${plan[s.id] === z.category ? ' selected' : ''}>${esc(z.title)}</option>`).join('');
  return `<div class="slot">
    <div class="sl"><b>${esc(s.label)}</b>
      <span>${esc(s.kind === 'display' ? STORE.display_labels[s.level] : STORE.mailer_labels[s.level])}</span></div>
    <select data-slot="${s.id}"><option value="">Empty</option>${opts}</select>
  </div>`;
}

// --------------------------------------------------------------- step 4
VIEWS.optimise = () => {
  view.innerHTML = `
  <div class="head">
    <div class="eyebrow">Step 4</div>
    <h1>Let the model search</h1>
    <p class="sub">Simon builds a thousand complete plans, scores each one against the same
    shoppers, and keeps the best. Every plan respects the real constraint: a category can hold
    one display position and one flyer slot, and there are only five of each.</p>
  </div>
  <div class="row">
    <button id="run">Run 1,000 scenarios</button>
    <button class="ghost" id="apply" ${sweep ? '' : 'disabled'}>Apply the winner</button>
  </div>
  <div id="out" class="mt">${sweep ? sweepHTML() : '<p class="note">Not run yet.</p>'}</div>`;
  $('#run').onclick = runSweep;
  const ap = $('#apply');
  if (ap && sweep) ap.onclick = () => { plan = { ...sweep.best.assign }; go('scenario'); };
};

/** Sample complete plans at random, keeping slot scarcity and one-slot-per-category honest. */
function randomPlan(rnd) {
  const a = emptyPlan();
  for (const kind of ['display', 'mailer']) {
    const slots = STORE.slots.filter(s => s.kind === kind);
    const pool = STORE.zones.map(z => z.category);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    let k = 0;
    for (const s of slots) {
      // Leave a slot empty now and then, so "use everything" has to earn its place.
      a[s.id] = rnd() < 0.12 ? null : pool[k++];
    }
  }
  return a;
}

function runSweep() {
  let seed = 20261111;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const N = 1000, results = [], running = [];
  let best = null;
  for (let i = 0; i < N; i++) {
    const assign = randomPlan(rnd);
    const sc = score(assign);
    results.push(sc.revenue);
    if (!best || sc.revenue > best.revenue) best = { assign, ...sc };
    running.push(best.revenue);
  }
  sweep = { N, results, running, best };
  VIEWS.optimise();
}

function sweepHTML() {
  const { N, results, best } = sweep;
  const b = baseline.revenue;
  const better = results.filter(r => r > b).length;
  const sorted = [...results].sort((x, y) => x - y);
  const med = sorted[Math.floor(N / 2)];
  const bl = levels(best.assign), dl = levels(plan);
  const moves = STORE.slots.filter(s => (best.assign[s.id] || null) !== (STORE.current[s.id] || null));
  return `
  <div class="grid3">
    <div class="stat"><div class="l">Best plan found</div><div class="v">${money(best.revenue)}</div>
      <div class="d up">${pctd((best.revenue - b) / b * 100)} against today</div></div>
    <div class="stat"><div class="l">Median of ${n0(N)}</div><div class="v">${money(med)}</div>
      <div class="d">${pctd((med - b) / b * 100)} against today</div></div>
    <div class="stat"><div class="l">Plans beating today</div><div class="v">${n0(better)}</div>
      <div class="d">${(better / N * 100).toFixed(1)}% of the search</div></div>
  </div>
  <div class="grid2 mt">
    <div class="card">
      <h2>Where the thousand plans landed</h2>
      <p class="hint">Weekly revenue per plan. The line is the store as it stands today.</p>
      <canvas id="hist"></canvas>
    </div>
    <div class="card">
      <h2>What the winner changes</h2>
      <p class="hint">${moves.length} move${moves.length === 1 ? '' : 's'} from today's plan.</p>
      <table><tbody>${moves.map(s => `<tr>
        <td><b>${esc(s.label)}</b></td>
        <td class="note">${esc(titleOf(STORE.current[s.id]))} &rarr; </td>
        <td><b>${esc(titleOf(best.assign[s.id]))}</b></td></tr>`).join('')}</tbody></table>
      <div class="lead mt">
        <b>${money(best.revenue - b)} more per week</b>
        <span>${money((best.revenue - b) * 52)} a year, on the same visits and the same prices.</span>
      </div>
    </div>
  </div>
  <div class="card mt">
    <h2>The winning plan, category by category</h2>
    <table>
      <thead><tr><th>Category</th><th>Position</th><th>Flyer</th>
        <th class="num">Units/wk</th><th class="num">vs today</th></tr></thead>
      <tbody>${best.rows.map((r, i) => {
        const dv = r.units - baseline.rows[i].units;
        const cl = dv > 0.05 ? 'up' : dv < -0.05 ? 'down' : 'flat';
        return `<tr${dv > 0.05 ? ' class="win"' : ''}>
          <td><b>${esc(r.title)}</b></td>
          <td><span class="tag${r.d ? ' hot' : ''}">${esc(STORE.display_labels[r.d])}</span></td>
          <td><span class="tag${r.m ? ' hot' : ''}">${esc(STORE.mailer_labels[r.m])}</span></td>
          <td class="num">${n1(r.units)}</td>
          <td class="num ${cl}">${(dv >= 0 ? '+' : '') + n1(dv)}</td></tr>`;
      }).join('')}</tbody>
    </table>
  </div>`;
}

function drawHist() {
  const cv = $('#hist'); if (!cv || !sweep) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = cv.clientWidth || 500, H = 150;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const vals = sweep.results, lo = Math.min(...vals, baseline.revenue), hi = Math.max(...vals);
  const bins = 42, counts = new Array(bins).fill(0);
  for (const v of vals) counts[Math.min(bins - 1, Math.floor((v - lo) / (hi - lo) * bins))]++;
  const mx = Math.max(...counts), pad = 6, bw = (W - pad * 2) / bins;
  g.clearRect(0, 0, W, H);
  counts.forEach((c, i) => {
    const h = c / mx * (H - 26);
    g.fillStyle = '#cfe0d9';
    g.fillRect(pad + i * bw, H - 18 - h, Math.max(1, bw - 1.5), h);
  });
  const bx = pad + (baseline.revenue - lo) / (hi - lo) * (W - pad * 2);
  g.strokeStyle = '#b4472f'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(bx, 4); g.lineTo(bx, H - 18); g.stroke();
  const wx = pad + (sweep.best.revenue - lo) / (hi - lo) * (W - pad * 2);
  g.strokeStyle = '#1c6f5a'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(wx, 4); g.lineTo(wx, H - 18); g.stroke();
  g.font = '600 10px ui-sans-serif,system-ui'; g.textBaseline = 'alphabetic';
  g.fillStyle = '#b4472f'; g.textAlign = bx > W / 2 ? 'right' : 'left';
  g.fillText('today', bx + (bx > W / 2 ? -4 : 4), 12);
  g.fillStyle = '#1c6f5a'; g.textAlign = 'right';
  g.fillText('best found', wx - 4, 12);
  g.fillStyle = '#8d8a84'; g.font = '500 10px ui-sans-serif,system-ui';
  g.textAlign = 'left'; g.fillText(money(lo), pad, H - 5);
  g.textAlign = 'right'; g.fillText(money(hi), W - pad, H - 5);
}

// --------------------------------------------------------------- model check
VIEWS.model = () => {
  const V = VALID, E = V.engines;
  const order = ['simon1', 'no_promo', 'avg_lift'];
  const bestOf = k => Math.min(...order.map(o => k === 'auc' ? -E[o].auc : E[o][k]));
  const mark = (o, k) => (k === 'auc' ? -E[o].auc : E[o][k]) === bestOf(k) ? ' class="win"' : '';
  view.innerHTML = `
  <div class="head">
    <div class="eyebrow">Model check</div>
    <h1>Is the model actually better?</h1>
    <p class="sub">Simon-1 is held out of the last ${V.holdout.weeks[1] - V.holdout.weeks[0] + 1} weeks
    entirely, then scored on every one of ${n0(V.holdout.rows)} household-product-week decisions
    against two baselines a planner would otherwise use.</p>
  </div>
  <div class="grid3">
    <div class="stat"><div class="l">Holdout decisions</div><div class="v">${n0(V.holdout.rows)}</div>
      <div class="d">weeks ${V.holdout.weeks[0]}&ndash;${V.holdout.weeks[1]}, never seen in training</div></div>
    <div class="stat"><div class="l">Actual purchases</div><div class="v">${n0(V.holdout.buys)}</div>
      <div class="d">${V.holdout.households} households, ${V.holdout.products} products</div></div>
    <div class="stat"><div class="l">Simon-1 AUC</div><div class="v">${E.simon1.auc.toFixed(4)}</div>
      <div class="d up">best of the three engines</div></div>
  </div>
  <div class="card mt">
    <h2>Scored on the holdout</h2>
    <p class="hint">Lower is better except AUC. The winning cell in each column is shaded.</p>
    <table>
      <thead><tr><th>Engine</th><th>What it assumes</th><th class="num">AUC</th>
        <th class="num">Log loss</th><th class="num">Brier</th><th class="num">Calibration error</th></tr></thead>
      <tbody>${order.map(o => `<tr>
        <td><b>${esc(E[o].label)}</b></td>
        <td class="note">${esc(E[o].note)}</td>
        <td class="num"${mark(o, 'auc')}>${E[o].auc.toFixed(4)}</td>
        <td class="num"${mark(o, 'log_loss')}>${E[o].log_loss.toFixed(5)}</td>
        <td class="num"${mark(o, 'brier')}>${E[o].brier.toFixed(7)}</td>
        <td class="num"${mark(o, 'ece')}>${E[o].ece.toFixed(6)}</td>
      </tr>`).join('')}</tbody>
    </table>
  </div>
  <div class="card mt">
    <h2>Can it predict the effect of a change?</h2>
    <p class="hint">The measured column is the lift read straight off receipts: each product compared
    against itself in weeks it did and did not hold that position, with a 90% bootstrap interval.</p>
    <table>
      <thead><tr><th>Change</th><th class="num">Measured</th><th class="num">Simon-1</th>
        <th class="num">As-usual</th><th class="num">Average lift</th><th>Products</th></tr></thead>
      <tbody>${Object.values(V.effects).map(e => {
        const a = e.actual;
        // Shade whichever engine lands closest to the measured lift; mark the ones
        // whose interval still contains the measurement.
        const errs = e.abs_error || {};
        const bestK = a ? Object.keys(errs).sort((x, y) => errs[x] - errs[y])[0] : null;
        const cell = k => {
          const v = e.simulated[k];
          return `<td class="num${k === bestK ? ' win' : ''}">${v.toFixed(2)}` +
                 `${a && e.in_range[k] ? ' <span class="ok">&#10003;</span>' : ''}</td>`;
        };
        return `<tr>
          <td><b>${esc(e.label)}</b></td>
          <td class="num">${a ? a.lift.toFixed(2) + ' <span class="note">[' + a.lo.toFixed(2) + ', ' + a.hi.toFixed(2) + ']</span>' : '&mdash;'}</td>
          ${cell('simon1')}${cell('no_promo')}${cell('avg_lift')}
          <td>${e.products}</td></tr>`;
      }).join('')}</tbody>
    </table>
    <p class="note mt8"><b>Read this honestly.</b> Simon-1 wins on AUC and log loss, and it is the only
    engine that recovers the front-endcap effect (${V.effects.front_endcap.simulated.simon1.toFixed(2)}x
    against a measured ${V.effects.front_endcap.actual.lift.toFixed(2)}x, where as-usual says 1.00 and the
    average-lift rule says ${V.avg_lift.toFixed(2)}). With only ${V.holdout.households} households, the
    front endcap is the one lever the data can resolve: the other three have intervals wide enough to
    contain no effect at all, and Simon-1 reports close to none for them rather than inventing one.
    Across all four levers the blunt average-lift rule has slightly lower mean error
    (${V.lift_mae.avg_lift.toFixed(3)} against ${V.lift_mae.simon1.toFixed(3)}) precisely because
    guessing the middle of a noisy set is hard to beat. More households is the fix, not more model.</p>
  </div>
  <div class="card mt">
    <h2>What the model learned</h2>
    <table><tbody>${STORE.levers.map((l, i) => `<tr><td>${esc(l)}</td>
      <td class="num">${STORE.beta[i] >= 0 ? '+' : ''}${STORE.beta[i].toFixed(3)} log-odds</td>
      <td class="num">${Math.exp(STORE.beta[i]).toFixed(2)}x odds</td></tr>`).join('')}</tbody></table>
    <p class="note mt8">Fitted on the baseline model's own log-odds, so these are the movement a
    position causes, not the popularity of whatever already sits there.</p>
  </div>`;
};

// --------------------------------------------------------------- photos
function wireUpload() {
  const drop = $('#drop'), file = $('#file'), stat = $('#vstat');
  if (!drop) return;
  $('#browse').onclick = () => file.click();
  file.onchange = () => send([...file.files]);
  ['dragenter', 'dragover'].forEach(e => drop.addEventListener(e, ev => {
    ev.preventDefault(); drop.classList.add('busy');
  }));
  ['dragleave', 'drop'].forEach(e => drop.addEventListener(e, ev => {
    ev.preventDefault(); drop.classList.remove('busy');
  }));
  drop.addEventListener('drop', ev => send([...ev.dataTransfer.files].filter(f => f.type.startsWith('image/'))));

  async function send(files) {
    if (!files.length) return;
    drop.classList.add('busy');
    stat.textContent = `Reading ${files.length} photo${files.length === 1 ? '' : 's'}. This calls the vision model and takes up to a minute.`;
    try {
      const photos = await Promise.all(files.slice(0, 4).map(f => new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => rej(new Error('could not read ' + f.name));
        fr.readAsDataURL(f);
      })));
      const r = await fetch('/api/vision', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photos, categories: STORE.zones.map(z => z.category) }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      applySpec(j);
      stat.innerHTML = `<b>Rebuilt from your photos.</b> ${esc(j.summary || '')}`;
    } catch (e) {
      stat.innerHTML = `<b>Could not read the photos.</b> ${esc(e.message)}<br>
        The demo floor is still loaded, so the rest of the walkthrough works.`;
    } finally {
      drop.classList.remove('busy');
    }
  }
}

/** Fold a vision result into the live store, keeping every modelled number intact. */
function applySpec(spec) {
  if (spec.size) STORE.size = { ...STORE.size, ...spec.size };
  if (spec.palette) STORE.palette = { ...STORE.palette, ...spec.palette };
  if (Array.isArray(spec.posters) && spec.posters.length) STORE.posters = spec.posters;
  if (Array.isArray(spec.zones)) {
    for (const z of spec.zones) {
      const t = STORE.zones.find(x => x.category === z.category);
      if (t) Object.assign(t, { x: z.x ?? t.x, z: z.z ?? t.z, w: z.w ?? t.w, d: z.d ?? t.d, kind: z.kind || t.kind });
    }
  }
  if (spec.name) STORE.name = spec.name;
  baseline = score(STORE.current);
  go('space');
}

// --------------------------------------------------------------- router
function go(v) {
  location.hash = '#' + v;
}

function render() {
  const v = (location.hash || '#space').slice(1);
  const fn = VIEWS[v] || VIEWS.space;
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('on', a.dataset.v === v);
  fn();
  view.focus();
  if (v === 'optimise' && sweep) drawHist();
}

async function boot() {
  const [s, v] = await Promise.all([
    fetch('data/store.json').then(r => r.json()),
    fetch('data/validation.json').then(r => r.json()),
  ]);
  STORE = s; VALID = v;
  plan = { ...STORE.current };
  baseline = score(STORE.current);
  $('#rf-store').textContent = STORE.name;
  $('#rf-zones').textContent = STORE.zones.length;
  addEventListener('hashchange', render);
  addEventListener('resize', () => { if (location.hash === '#optimise' && sweep) drawHist(); });
  render();
}

boot().catch(e => {
  view.innerHTML = `<div class="card"><h2>Could not start</h2>
    <p class="note">${esc(e.message)}. Serve this folder over HTTP: <code>python server.py</code></p></div>`;
});
