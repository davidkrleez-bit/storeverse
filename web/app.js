// StoreVerse - store simulation.
// Every number on screen comes from the response surface the model exported, so a figure
// here traces back to a fitted purchase probability rather than a planning rule of thumb.
import { mountScene, updateScene } from './scene.js';
import { ARCHETYPES, DEFAULT_ARCHETYPE, archetypeCatalog } from './archetypes.js';

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
let BASE_ZONES = null; // every trained category with its fitted surface, kept pristine
let GOAL = null;      // the written goal, once it has been turned into search parameters

// The example goal. A real one: a shopkeeper with a new line coming in, who wants it to
// sell and to be understood, and who has not read a word about merchandising.
const SAMPLE_GOAL = "I have a new product collaboration coming in and want to sell this "
  + "product as much as possible in the next coming weeks. How should I display this product "
  + "and promote it for maximum revenue from this product (make it clear what it is, this new "
  + "chip snack)";
let VISION = null;    // last photo read, so the match can stay on screen

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

/**
 * What the search is trying to make big.
 *
 * With no goal that is the store's whole takings. With one, it is the takings of the
 * category the goal is about - which is a different plan, and usually a worse one for
 * the store overall. Both numbers are reported, because a shopkeeper pushing one line
 * deserves to see what it costs the rest of the shop.
 */
function objectiveOf(sc) {
  if (GOAL && GOAL.target && GOAL.objective === 'category_revenue') {
    const r = sc.rows.find(x => x.category === GOAL.target);
    return r ? r.revenue : 0;
  }
  return sc.revenue;
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
    <p class="sub">${esc(STORE.name)}. ${esc(STORE.note)} ${STORE.zones.length} category zones,
    ${STORE.slots.filter(x => x.kind === 'display').length} contested display
    positions, ${STORE.slots.filter(x => x.kind === 'mailer').length} flyer slots. Drop in photos to
    rebuild the floor from a real store, or work from the demo plan.</p>
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
      <p class="hint mt8">Drag to orbit, scroll to zoom. Filled markers are display positions in use.
      How many shoppers are on the floor comes from the store's modelled weekly visits; where they
      stop, how long they linger and when a green chip goes up all come from the scored purchase
      probability of the category in front of them. A plan does not change who walks in, so it
      changes what they do once inside. Stopping rates are relative to the best zone on this floor,
      not literal per-visit odds.</p>
    </div>
    <div>
      <div class="card">
        <h2>Build from photos</h2>
        <p class="hint">Upload shots of a store. StoreVerse looks first, in plain words, then matches what
        it saw onto the ${BASE_ZONES.length} categories it was actually trained on &mdash; and says
        what it had to leave out.</p>
        <div class="drop" id="drop">
          <input type="file" id="file" accept="image/*" multiple hidden>
          <b>Drop photos here</b><br><span>or <u id="browse" style="cursor:pointer">browse</u></span>
        </div>
        <div class="row mt8">
          <button class="ghost" id="useexample">Use the example store</button>
        </div>
        <p class="hint mt8">No photos to hand? The example is a real shop, read the same way:
        four views of a public scan of Fortuna Supermarket, through the same two passes.</p>
        <div id="vstat" class="mt8">${VISION ? visionHTML(VISION) : ''}</div>
      </div>
      <div class="card mt">
        <h2>Floor</h2>
        <table>
          <tr><td>Store type</td><td class="num">${esc(archetypeOf().title)}</td></tr>
          <tr><td>Sales floor</td><td class="num">${n0(s.w * s.d)} m&sup2;</td></tr>
          <tr><td>Weekly visits modelled</td><td class="num">${n0(STORE.visits_per_week)}</td></tr>
          <tr><td>Category zones</td><td class="num">${STORE.zones.length}</td></tr>
          <tr><td>Display positions</td><td class="num">${STORE.slots.filter(x => x.kind === 'display').length}</td></tr>
          <tr><td>Flyer slots</td><td class="num">${STORE.slots.filter(x => x.kind === 'mailer').length}</td></tr>
        </table>
      </div>
    </div>
  </div>`;
  const ux = $('#useexample');
  if (ux) ux.onclick = async () => {
    ux.disabled = true; ux.textContent = 'Loading…';
    const stat = $('#vstat');
    try {
      const spec = await fetch('data/example.json').then(r => r.json());
      stat.innerHTML = `<div class="note">Reading the example store…</div>`;
      applySpec(spec);
    } catch (e) {
      ux.disabled = false; ux.textContent = 'Use the example store';
      stat.innerHTML = `<div class="note"><b>Could not load the example.</b> ${esc(e.message)}</div>`;
    }
  };
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
    <p class="sub">StoreVerse scores the floor as it stands: every category at its current shelf
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
    <p class="hint">Units cover the promotable items StoreVerse models in each category, not the category's total sales.</p>
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
    <p class="sub">Move a category onto a display position or into the flyer. StoreVerse rescores the
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
// ------------------------------------------------------------------- goals
//
// A goal written in plain words becomes two things: which category the search should be
// making big, and which trade-off the reader is shown. The model never answers the
// merchandising question - that is the simulator's job, and the whole point is that the
// answer comes from fitted numbers rather than from a chat.

/**
 * The offline reader.
 *
 * A keyword match, not a model, and it says so on screen. It exists because the hosted
 * build has no server behind it, and a demo that cannot read "this new chip snack"
 * without one is not much of a demo.
 */
const CAT_WORDS = {
  'BAG SNACKS': ['chip', 'crisp', 'snack', 'tortilla', 'popcorn', 'pretzel', 'nacho'],
  'SOFT DRINKS': ['soft drink', 'soda', 'cola', 'fizzy', 'pop', 'lemonade', 'juice'],
  'ISOTONIC DRINKS': ['sports drink', 'isotonic', 'electrolyte', 'energy drink', 'gatorade'],
  'CRACKERS/MISC BKD FD': ['cracker', 'biscuit', 'cookie', 'wafer'],
  'CHEESE': ['cheese'],
  'YOGURT': ['yogurt', 'yoghurt', 'dairy'],
  'BACON': ['bacon', 'rasher'],
  'MEAT - SHELF STABLE': ['jerky', 'canned meat', 'tinned meat', 'spam', 'meat'],
  'FROZEN PIZZA': ['pizza', 'frozen'],
  'BAKED BREAD/BUNS/ROLLS': ['bread', 'bun', 'roll', 'bakery', 'loaf', 'baguette'],
};

function localGoal(text) {
  const s = String(text).toLowerCase();
  const here = new Set(BASE_ZONES.map(z => z.category));
  let hit = null, hitWord = '';
  for (const [cat, words] of Object.entries(CAT_WORDS)) {
    if (!here.has(cat)) continue;
    for (const w of words) {
      // Longest matching word wins, so "sports drink" beats "drink".
      if (s.includes(w) && w.length > hitWord.length) { hit = cat; hitWord = w; }
    }
  }
  const vis = /\bclear\b|explain|notice|noticed|understand|what it is|aware|discover/.test(s);
  const nodisc = /without (a )?discount|no discount|don'?t discount|without cutting|keep the price|full price/.test(s);
  return {
    target: hit,
    target_reason: hit
      ? `matched on "${hitWord}" - ${titleOf(hit)} is the nearest trained category, standing in for your product`
      : 'nothing in the goal matched a trained category, so the search optimises the whole store',
    objective: hit ? 'category_revenue' : 'store_revenue',
    visibility_first: vis, avoid_discounts: nodisc, horizon: null,
    restated: hit
      ? `Make ${titleOf(hit)} earn as much as possible, using display positions and flyer slots.`
      : 'Make the store earn as much as possible.',
    caveat: 'Read by keyword match, not by a model. The simulator moves display positions '
      + 'and flyer slots only: shelf-edge signs, packaging and price are outside it.',
    parsed_by: 'keywords',
  };
}

async function readGoal(text) {
  const slots = STORE.slots.map(s => `${s.label} (${s.kind}, level ${s.level})`);
  try {
    const r = await fetch('/api/goal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, categories: BASE_ZONES.map(z => z.category), slots }),
    });
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error('no server');
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    if (j.target && !BASE_ZONES.some(z => z.category === j.target)) j.target = null;
    return j;
  } catch {
    return localGoal(text);          // hosted build, or the CLI is not there
  }
}

function goalHTML(g) {
  if (!g) return '';
  const chips = [
    g.target ? `<span class="chipv on">Target &middot; ${esc(titleOf(g.target))}</span>` : '',
    `<span class="chipv">${g.objective === 'category_revenue' ? 'Maximise that category' : 'Maximise the whole store'}</span>`,
    g.visibility_first ? '<span class="chipv">Favour positions people see</span>' : '',
    g.avoid_discounts ? '<span class="chipv">No price cuts</span>' : '',
    g.horizon ? `<span class="chipv">${esc(g.horizon)}</span>` : '',
    `<span class="chipv quiet">read by ${g.parsed_by === 'model' ? 'the model' : 'keyword match'}</span>`,
  ].filter(Boolean).join('');
  return `<div class="goalread">
    <div class="grestate">&ldquo;${esc(g.restated)}&rdquo;</div>
    <div class="chips">${chips}</div>
    ${g.target_reason ? `<p class="note mt8">${esc(g.target_reason)}</p>` : ''}
    ${g.caveat ? `<p class="warn mt8"><b>What this cannot do.</b> ${esc(g.caveat)}</p>` : ''}
  </div>`;
}

VIEWS.optimise = () => {
  const g = GOAL;
  const forCat = g && g.target && g.objective === 'category_revenue';
  view.innerHTML = `
  <div class="head">
    <div class="eyebrow">Step 4</div>
    <h1>Let the model search</h1>
    <p class="sub">StoreVerse builds a thousand complete plans, scores each one against the same
    shoppers, and keeps the best. Every plan respects the real constraint: a category can hold
    one display position and one flyer slot, and there are only
    ${STORE.slots.filter(s => s.kind === 'display').length} and
    ${STORE.slots.filter(s => s.kind === 'mailer').length} of them.</p>
  </div>

  <div class="card">
    <div class="chead"><h2>What are you trying to do?</h2></div>
    <p class="hint">Write it the way you would say it out loud. StoreVerse turns it into what the
    search should be making big &mdash; it does not answer the question, because the answer comes
    from the fitted numbers and not from a chat.</p>
    <textarea id="goal" rows="3" spellcheck="false">${esc(g ? g.text || SAMPLE_GOAL : SAMPLE_GOAL)}</textarea>
    <div class="row mt8">
      <button id="readgoal">Read this goal</button>
      <button class="ghost" id="samplegoal">Reset to the example</button>
      ${g ? '<button class="ghost" id="cleargoal">Drop it, plan for the whole store</button>' : ''}
    </div>
    <div id="goalout">${goalHTML(g)}</div>
  </div>

  <div class="row mt">
    <button id="run">${forCat ? `Find the best plan for ${esc(titleOf(g.target))}` : 'Run 1,000 scenarios'}</button>
    <button class="ghost" id="apply" ${sweep ? '' : 'disabled'}>Apply the winner</button>
  </div>
  <div id="out" class="mt">${sweep ? sweepHTML() : '<p class="note">Not run yet.</p>'}</div>`;

  $('#run').onclick = runSweep;
  $('#samplegoal').onclick = () => { $('#goal').value = SAMPLE_GOAL; };
  const cg = $('#cleargoal');
  if (cg) cg.onclick = () => { GOAL = null; sweep = null; VIEWS.optimise(); };
  $('#readgoal').onclick = async () => {
    const btn = $('#readgoal'), text = $('#goal').value;
    btn.disabled = true; btn.textContent = 'Reading…';
    $('#goalout').innerHTML = '<p class="note mt8">Turning that into search parameters…</p>';
    const parsed = await readGoal(text);
    GOAL = { ...parsed, text };
    sweep = null;                     // a new goal means the old search answered a different question
    VIEWS.optimise();
  };
  const ap = $('#apply');
  if (ap && sweep) ap.onclick = () => { plan = { ...sweep.best.assign }; go('scenario'); };
  // The canvas is new every time this view is rebuilt, so it has to be redrawn here
  // rather than only on navigation, or the run leaves an empty box behind.
  if (sweep) drawHist();
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
  let best = null, bestObj = -Infinity;
  for (let i = 0; i < N; i++) {
    const assign = randomPlan(rnd);
    const sc = score(assign);
    const obj = objectiveOf(sc);
    results.push(obj);
    if (!best || obj > bestObj) { best = { assign, ...sc }; bestObj = obj; }
    running.push(bestObj);
  }
  sweep = { N, results, running, best, bestObj, goal: GOAL };
  VIEWS.optimise();
}

function sweepHTML() {
  const { N, results, best } = sweep;
  const g = sweep.goal;
  const forCat = g && g.target && g.objective === 'category_revenue';
  const b = forCat ? objectiveOf(baseline) : baseline.revenue;
  const bv = forCat ? objectiveOf(best) : best.revenue;
  // Pushing one line is not free. Whatever the search was told to maximise, the store's
  // own takings are reported beside it.
  const storeDelta = best.revenue - baseline.revenue;
  const better = results.filter(r => r > b).length;
  const sorted = [...results].sort((x, y) => x - y);
  const med = sorted[Math.floor(N / 2)];
  const bl = levels(best.assign), dl = levels(plan);
  const moves = STORE.slots.filter(s => (best.assign[s.id] || null) !== (STORE.current[s.id] || null));
  return `
  ${forCat ? `<div class="verdict"><div class="vmain">
    <div class="vnum">${pctd((bv - b) / b * 100)}</div>
    <div class="vcap"><b>Best weekly revenue for ${esc(titleOf(g.target))}: ${money(bv)},
    against ${money(b)} today.</b> That is what the search was told to make big, and this is
    the best of ${n0(N)} complete plans.
    ${storeDelta < -0.5 ? `The store as a whole gives up ${money(-storeDelta)} a week to get it:
    the positions this plan takes were earning more on something else.`
      : `The store as a whole is also ${money(storeDelta)} a week better off, so nothing was
    sacrificed to get it.`}</div></div></div>` : ''}
  <div class="grid3${forCat ? ' mt' : ''}">
    <div class="stat"><div class="l">${forCat ? esc(titleOf(g.target)) + ', best found' : 'Best plan found'}</div>
      <div class="v">${money(bv)}</div>
      <div class="d up">${pctd((bv - b) / b * 100)} against today</div></div>
    <div class="stat"><div class="l">Median of ${n0(N)}</div><div class="v">${money(med)}</div>
      <div class="d">${pctd((med - b) / b * 100)} against today</div></div>
    <div class="stat"><div class="l">Whole store, this plan</div>
      <div class="v">${money(best.revenue)}</div>
      <div class="d ${storeDelta >= 0 ? 'up' : 'down'}">${pctd(storeDelta / baseline.revenue * 100)} against today</div></div>
  </div>
  <div class="grid2 mt">
    <div class="card">
      <h2>Where the thousand plans landed</h2>
      <p class="hint">${forCat ? esc(titleOf(g.target)) + ' revenue' : 'Weekly revenue'} per plan.
      The line is the store as it stands today.</p>
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
  const base = sweep.goal && sweep.goal.target && sweep.goal.objective === 'category_revenue'
    ? objectiveOf(baseline) : baseline.revenue;
  const vals = sweep.results, lo = Math.min(...vals, base), hi = Math.max(...vals);
  const bins = 42, counts = new Array(bins).fill(0);
  for (const v of vals) counts[Math.min(bins - 1, Math.floor((v - lo) / (hi - lo) * bins))]++;
  const mx = Math.max(...counts), pad = 6, bw = (W - pad * 2) / bins;
  g.clearRect(0, 0, W, H);
  counts.forEach((c, i) => {
    const h = c / mx * (H - 26);
    g.fillStyle = '#cfe0d9';
    g.fillRect(pad + i * bw, H - 18 - h, Math.max(1, bw - 1.5), h);
  });
  const bx = pad + (base - lo) / (hi - lo) * (W - pad * 2);
  g.strokeStyle = '#b4472f'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(bx, 4); g.lineTo(bx, H - 18); g.stroke();
  const wx = pad + (sweep.bestObj - lo) / (hi - lo) * (W - pad * 2);
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
// ------------------------------------------------------------------ charts
//
// Palette: blue is StoreVerse-1 wherever it appears, orange As-usual, green Average
// lift. Validated against the white card surface for lightness, chroma, CVD separation
// and contrast. Green and red carry pass/fail nowhere on their own: that pair fails CVD
// separation outright, so every verdict also ships a glyph and a word.
const VIZ = {
  ours: '#2a78d6', nopromo: '#eb6834', avglift: '#199e70',
  quiet: '#b8b4ac', band: '#e7e4de', ink: '#2b2e33', ink2: '#6b6f76',
  grid: '#eeebe6', good: '#0ca30c', bad: '#d03b3b',
};
const sx = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = v => (v * 100).toFixed(1) + '%';

/** "Lower is better" / "Higher is better", said once so every chart is read correctly. */
const dir = (lower, what = '') =>
  `<span class="dir ${lower ? 'lo' : 'hi'}"><span class="ar">${lower ? '&darr;' : '&uarr;'}</span>${
    lower ? 'Lower is better' : 'Higher is better'}${what ? ` &middot; ${sx(what)}` : ''}</span>`;

/**
 * Ranked bars of how wrong each engine's revenue forecast would be, with the planner's
 * 10% tolerance drawn in. One hue for the engine that is the subject, grey for the rest:
 * the story is "this one is inside the line", which is emphasis, not eight identities.
 */
function barsRevenue(rows, tol = 0.10) {
  const W = 760, rowH = 34, padL = 168, padR = 86, top = 26;
  const H = top + rows.length * rowH + 30;
  const max = Math.max(tol * 1.35, ...rows.map(r => r.v)) * 1.06;
  const x = v => padL + (v / max) * (W - padL - padR);
  const tx = x(tol);

  const bars = rows.map((r, i) => {
    const y = top + i * rowH, h = 18, w = Math.max(3, x(r.v) - padL);
    const ok = r.v <= tol;
    return `<g class="bar-g">
      <title>${sx(r.label)}: revenue forecast off by ${pct(r.v)}${ok ? ' (inside the 10% tolerance)' : ' (outside the 10% tolerance)'}</title>
      <text x="${padL - 12}" y="${y + h / 2 + 4}" text-anchor="end" class="vz-lab${r.mark ? ' on' : ''}">${sx(r.label)}</text>
      <rect x="${padL}" y="${y}" width="${w}" height="${h}" rx="4"
            fill="${r.mark ? VIZ.ours : VIZ.quiet}"></rect>
      <text x="${padL + w + 9}" y="${y + h / 2 + 4}" class="vz-val${r.mark ? ' on' : ''}">${pct(r.v)}</text>
      <text x="${W - 4}" y="${y + h / 2 + 4}" text-anchor="end"
            class="vz-flag ${ok ? 'ok' : 'no'}">${ok ? '&#10003; within' : '&#10007; over'}</text>
    </g>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" class="vz" role="img"
      aria-label="Revenue forecast error by engine, against a 10 percent tolerance">
    <line x1="${padL}" y1="${top - 6}" x2="${padL}" y2="${H - 28}" stroke="${VIZ.grid}" stroke-width="1"/>
    <line x1="${tx}" y1="${top - 10}" x2="${tx}" y2="${H - 26}" stroke="${VIZ.bad}"
          stroke-width="2" stroke-dasharray="3 3"/>
    <text x="${tx + 6}" y="${H - 12}" class="vz-ax" fill="${VIZ.bad}">10% tolerance</text>
    <text x="${padL}" y="${H - 12}" class="vz-ax">0%</text>
    <text x="${x(max)}" y="${H - 12}" text-anchor="end" class="vz-ax">${pct(max)}</text>
    ${bars}
  </svg>`;
}

/**
 * One strip per merchandising lever: the measured lift with its interval behind, and
 * every engine's estimate dropped on top. Lanes keep the dots from sitting on each
 * other; the label is on ours and on whichever engine is furthest from the truth.
 */
function stripsLift(levers) {
  const W = 760, padL = 120, padR = 54, sH = 74;
  const lo = 0.85;
  const hi = Math.min(4.2, Math.max(...levers.flatMap(L => [L.hi, ...L.dots.map(d => d.v)])) * 1.06);
  const x = v => padL + ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (W - padL - padR);
  const H = levers.length * sH + 34;

  const ticks = [1, 1.5, 2, 2.5, 3, 3.5, 4].filter(t => t >= lo && t <= hi);
  const grid = ticks.map(t =>
    `<line x1="${x(t)}" y1="8" x2="${x(t)}" y2="${H - 26}" stroke="${VIZ.grid}" stroke-width="1"/>
     <text x="${x(t)}" y="${H - 10}" text-anchor="middle" class="vz-ax">${t}&times;</text>`).join('');

  const strips = levers.map((L, i) => {
    const y0 = 14 + i * sH, mid = y0 + 26;
    const far = L.dots.reduce((a, b) => (Math.abs(b.v - L.lift) > Math.abs(a.v - L.lift) ? b : a), L.dots[0]);
    const dots = L.dots.map((d, j) => {
      const lane = mid + ((j % 3) - 1) * 13;
      const mine = d.mark, show = mine || d === far;
      return `<g class="dot-g">
        <title>${sx(d.label)} says ${d.v.toFixed(2)}x &middot; measured ${L.lift.toFixed(2)}x [${L.lo.toFixed(2)}, ${L.hi.toFixed(2)}]</title>
        <circle cx="${x(d.v)}" cy="${lane}" r="${mine ? 6.5 : 5}"
                fill="${mine ? VIZ.ours : VIZ.quiet}" stroke="#fff" stroke-width="2"/>
        ${show ? `<text x="${x(d.v)}" y="${lane - 11}" text-anchor="middle"
          class="vz-dlab${mine ? ' on' : ''}">${sx(d.label)}</text>` : ''}
      </g>`;
    }).join('');
    return `<g>
      <text x="${padL - 12}" y="${mid - 4}" text-anchor="end" class="vz-lab">${sx(L.label)}</text>
      <text x="${padL - 12}" y="${mid + 11}" text-anchor="end" class="vz-ax">${n0(L.cells)} strata</text>
      <rect x="${x(L.lo)}" y="${y0 + 2}" width="${Math.max(2, x(L.hi) - x(L.lo))}" height="48"
            fill="${VIZ.band}" rx="3"><title>measured 90% interval</title></rect>
      <line x1="${x(L.lift)}" y1="${y0}" x2="${x(L.lift)}" y2="${y0 + 52}"
            stroke="${VIZ.ink}" stroke-width="2"/>
      ${dots}
    </g>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" class="vz" role="img"
      aria-label="Estimated lift per lever against the measured lift and its interval">
    ${grid}${strips}
  </svg>`;
}

/** Predicted against observed, ten bins. The diagonal is a model that means what it says. */
function chartReliability(series) {
  const W = 420, H = 330, p = 46;
  const max = Math.max(...series.flatMap(s => s.pts.flatMap(q => [q.p, q.y]))) * 1.08;
  const X = v => p + (v / max) * (W - p - 16);
  const Y = v => H - p - (v / max) * (H - p - 18);
  const t4 = [0, max / 3, (max * 2) / 3, max];

  // The origin carries one zero, not two stacked on each other.
  const axes = t4.map((t, i) => `
    <line x1="${p}" y1="${Y(t)}" x2="${W - 16}" y2="${Y(t)}" stroke="${VIZ.grid}" stroke-width="1"/>
    <text x="${p - 7}" y="${Y(t) + 3.5}" text-anchor="end" class="vz-ax">${(t * 100).toFixed(1)}%</text>
    ${i ? `<text x="${X(t)}" y="${H - p + 16}" text-anchor="middle" class="vz-ax">${(t * 100).toFixed(1)}%</text>` : ''}`).join('');

  const lines = series.map(s => {
    const d = s.pts.map((q, i) => `${i ? 'L' : 'M'}${X(q.p).toFixed(1)} ${Y(q.y).toFixed(1)}`).join(' ');
    const marks = s.pts.map(q => `<circle cx="${X(q.p)}" cy="${Y(q.y)}" r="4" fill="${s.c}"
      stroke="#fff" stroke-width="1.5"><title>${sx(s.label)}: predicted ${pct(q.p)}, actually ${pct(q.y)}</title></circle>`).join('');
    return `<path d="${d}" fill="none" stroke="${s.c}" stroke-width="2"
      stroke-linejoin="round" stroke-linecap="round"/>${marks}`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" class="vz" role="img"
      aria-label="Reliability: predicted purchase rate against observed">
    ${axes}
    <line x1="${X(0)}" y1="${Y(0)}" x2="${X(max)}" y2="${Y(max)}" stroke="${VIZ.ink2}"
          stroke-width="1.5" stroke-dasharray="4 4"/>
    <text x="${X(max) - 6}" y="${Y(max) + 16}" text-anchor="end" class="vz-ax">perfect</text>
    ${lines}
    <text x="6" y="${(H - p) / 2}" class="vz-axt" transform="rotate(-90 6 ${(H - p) / 2})"
          text-anchor="middle">what actually happened</text>
    <text x="${(W + p) / 2}" y="${H - 6}" text-anchor="middle" class="vz-axt">what it predicted</text>
  </svg>`;
}

VIEWS.model = () => {
  const V = VALID, E = V.engines;
  const order = ['simon1', 'no_promo', 'avg_lift'];
  const LK = ['secondary_display', 'front_endcap', 'flyer_interior', 'flyer_front'];
  const llm = (V.llm && V.llm.engines) || {};
  const llmKeys = Object.keys(llm);

  // Every engine that put a number on a lever, ours and the language models alike.
  const engines = [
    { label: 'StoreVerse-1', note: 'this model', mark: true,
      get: k => V.effects[k].simulated.simon1, inr: k => V.effects[k].in_range.simon1,
      mae: V.lift_mae.simon1 },
    { label: 'As-usual', note: 'ignores promotion entirely',
      get: k => V.effects[k].simulated.no_promo, inr: k => V.effects[k].in_range.no_promo,
      mae: V.lift_mae.no_promo },
    { label: 'Average lift', note: 'one blanket multiplier',
      get: k => V.effects[k].simulated.avg_lift, inr: k => V.effects[k].in_range.avg_lift,
      mae: V.lift_mae.avg_lift },
    ...llmKeys.map(n => ({
      label: llm[n].label, note: llm[n].note, llm: true, kind: llm[n].kind || 'LLM',
      get: k => llm[n].estimate[k], inr: k => llm[n].in_range[k], mae: llm[n].lift_mae,
      spread: k => llm[n].spread[k] })),
  ];

  /**
   * What believing an engine would cost you.
   *
   * Revenue from a promoted category moves with its lift, so an engine that thinks a
   * lever is worth 2.4x when the receipts say 1.34x overstates that category's takings
   * by the same proportion. Averaged over the four levers, weighted by how much evidence
   * each one rests on. Prices and footfall are held still, so this is the error the
   * engine contributes and not a forecast of the business.
   */
  const revErr = get => {
    let num = 0, den = 0;
    for (const k of LK) {
      const a = V.effects[k].actual, p = get(k);
      if (!Number.isFinite(p) || !a) continue;
      num += Math.abs(p / a.lift - 1) * a.cells;
      den += a.cells;
    }
    return den ? num / den : null;
  };
  const revRows = engines.map(e => ({ label: e.label, mark: e.mark, v: revErr(e.get) }))
    .filter(r => Number.isFinite(r.v)).sort((a, b) => a.v - b.v);
  const mine = revRows.find(r => r.mark);
  const nextBest = revRows.find(r => !r.mark);
  const overTol = revRows.filter(r => r.v > 0.10).length;

  const levers = LK.map(k => {
    const a = V.effects[k].actual;
    return { label: V.effects[k].label, lift: a.lift, lo: a.lo, hi: a.hi, cells: a.cells,
      dots: engines.map(e => ({ label: e.label, v: e.get(k), mark: e.mark })).filter(d => Number.isFinite(d.v)) };
  });

  const rel = [
    { label: 'StoreVerse-1', c: VIZ.ours, pts: E.simon1.promoted.reliability },
    { label: 'As-usual', c: VIZ.nopromo, pts: E.no_promo.promoted.reliability },
    { label: 'Average lift', c: VIZ.avglift, pts: E.avg_lift.promoted.reliability },
  ];

  const best = (keys, get, lower = true) => {
    const vals = keys.map(get).filter(Number.isFinite);
    return vals.length ? (lower ? Math.min(...vals) : Math.max(...vals)) : null;
  };
  const bAuc = best(order, k => E[k].promoted.auc, false);
  const bEce = best(order, k => E[k].promoted.ece);
  const bLL = best(order, k => E[k].promoted.log_loss);
  const w = c => c ? ' class="win"' : '';
  const fe = V.effects.front_endcap.actual;
  const inCI = e => LK.filter(k => e.inr(k)).length;

  view.innerHTML = `
  <div class="head">
    <div class="eyebrow">Model check</div>
    <h1>Does the model tell the truth?</h1>
    <p class="sub">StoreVerse-1 never sees the last ${V.holdout.weeks[1] - V.holdout.weeks[0] + 1}
    weeks of the chain's records. It is then scored on all ${n0(V.holdout.rows)} decisions inside
    them, against the two rules a planner would otherwise use and against language models asked
    the same question.</p>
  </div>

  <div class="verdict">
    <div class="vmain">
      <div class="vnum">${pct(mine.v)}</div>
      <div class="vcap"><b>StoreVerse-1 forecasts promoted revenue to within ${pct(mine.v)}.</b>
      The next best engine, ${sx(nextBest.label)}, is off by ${pct(nextBest.v)} &mdash;
      ${(nextBest.v / mine.v).toFixed(0)}&times; further from the receipts.
      ${overTol} of the ${revRows.length} engines miss by more than 10%.</div>
    </div>
  </div>

  <div class="card mt">
    <div class="chead"><h2>What believing each engine would cost you</h2>${dir(true, 'revenue forecast error')}</div>
    <p class="hint">Revenue from a promoted category moves with its lift, so an engine that
    thinks a front endcap is worth ${(llmKeys.length ? llm[llmKeys[0]].estimate.front_endcap : 2.4).toFixed(1)}&times;
    when the receipts say ${fe.lift.toFixed(2)}&times; overstates that category's takings by the
    same proportion. Averaged over the four levers, weighted by the evidence behind each.</p>
    ${barsRevenue(revRows)}
    <p class="note mt8">Ten per cent is the line because it is roughly the margin a planner can
    absorb: past it, the plan you chose and the plan you should have chosen are different plans.
    Prices and footfall are held still here, so this is the error the engine contributes, not a
    forecast of the business.</p>
  </div>

  <div class="card mt">
    <div class="chead"><h2>Can it predict the effect of a change?</h2>${dir(true, 'distance from measured')}</div>
    <p class="hint">The question the product turns on. The dark line is the lift read off holdout
    receipts, the grey band its 90% bootstrap interval, and each dot is one engine's estimate.
    Hover any dot for its figure. Shared scale, so the panels compare.</p>
    ${stripsLift(levers)}
    <div class="legend">
      <span><i style="background:${VIZ.ours}"></i>StoreVerse-1</span>
      <span><i style="background:${VIZ.quiet}"></i>Other engines</span>
      <span><i class="bandi"></i>Measured 90% interval</span>
      <span><i class="tick"></i>Measured lift</span>
    </div>
  </div>

  <div class="grid2 mt">
    <div class="card">
      <div class="chead"><h2>Do its probabilities mean what they say?</h2></div>
      <p class="hint">Each engine's predictions on promoted decisions, sorted into ten bins:
      what it promised against what happened. On the dashed line, a 2% prediction buys 2% of
      the time. ${dir(false, 'closer to the line')}</p>
      ${chartReliability(rel)}
      <div class="legend">${rel.map(s =>
        `<span><i style="background:${s.c}"></i>${sx(s.label)}</span>`).join('')}</div>
    </div>
    <div class="card">
      <div class="chead"><h2>Scored on the holdout</h2></div>
      <p class="hint">The ${n0(V.holdout.promoted_rows)} decisions where something was actually
      being promoted, which is where these engines can differ at all.</p>
      <table>
        <thead><tr><th>Engine</th>
          <th class="num">AUC<br><span class="hdir">&uarr; higher</span></th>
          <th class="num">Calibration<br><span class="hdir">&darr; lower</span></th>
          <th class="num">Log loss<br><span class="hdir">&darr; lower</span></th></tr></thead>
        <tbody>${order.map(o => `<tr${o === 'simon1' ? ' class="win"' : ''}>
          <td><b>${sx(E[o].label)}</b><br><span class="note">${sx(E[o].note)}</span></td>
          <td class="num"${w(E[o].promoted.auc === bAuc)}>${E[o].promoted.auc.toFixed(3)}</td>
          <td class="num"${w(E[o].promoted.ece === bEce)}>${E[o].promoted.ece.toFixed(4)}</td>
          <td class="num"${w(E[o].promoted.log_loss === bLL)}>${E[o].promoted.log_loss.toFixed(4)}</td>
        </tr>`).join('')}</tbody>
      </table>
      <p class="note mt8">AUC is whether it ranks the right decisions first. Calibration is
      whether the number on the tin is the number you get. Log loss punishes both at once.
      StoreVerse-1 leads all three on the decisions that matter.</p>
    </div>
  </div>

  <div class="card mt">
    <div class="chead"><h2>Every estimate, in full</h2>${dir(true, 'mean error')}</div>
    <p class="hint">A tick means the estimate falls inside the measured interval. The &plusmn;
    figure is half the spread across ${V.llm ? V.llm.repeats : 5} runs, which is the part a
    planner asking a chatbot once never gets to see.</p>
    <table>
      <thead><tr><th>Engine</th>
        ${LK.map(k => `<th class="num">${sx(V.effects[k].label)}</th>`).join('')}
        <th class="num">Mean error</th><th class="num">In interval</th></tr></thead>
      <tbody>
        <tr class="measured"><td><b>Measured</b><br><span class="note">stratified, from receipts</span></td>
          ${LK.map(k => { const a = V.effects[k].actual;
            return `<td class="num"><b>${a.lift.toFixed(2)}</b><br><span class="note">[${a.lo.toFixed(2)}, ${a.hi.toFixed(2)}]</span></td>`;
          }).join('')}
          <td class="num">&mdash;</td><td class="num">&mdash;</td></tr>
        ${engines.map(e => `<tr${e.mark ? ' class="win"' : ''}>
          <td><b>${sx(e.label)}</b>${e.llm ? ` <span class="tag">${sx(e.kind)}</span>` : ''}<br>
            <span class="note">${sx(e.note)}</span></td>
          ${LK.map(k => `<td class="num">${e.get(k).toFixed(2)}${
            e.inr(k) ? ' <span class="ok" title="inside the measured interval">&#10003;</span>' : ''}${
            e.spread ? `<br><span class="note">&plusmn;${(e.spread(k) / 2).toFixed(2)}</span>` : ''}</td>`).join('')}
          <td class="num"${w(e.mae === V.lift_mae.simon1)}>${e.mae.toFixed(3)}</td>
          <td class="num">${inCI(e)} / ${LK.length}</td></tr>`).join('')}
      </tbody>
    </table>
  </div>

  <div class="card mt">
    <div class="chead"><h2>Why every other engine is wrong in the same direction</h2></div>
    <p class="note">Stores promote what was already selling. Take every product-week where some
    store ran an endcap, add up sales on both sides and divide, and the promoted side carries the
    weeks that were going to be good anyway. That sum says the endcap is worth
    <b>${fe.naive.toFixed(2)}&times;</b>. Stratifying it, so a product-week is only ever compared
    with itself across stores, says <b>${fe.lift.toFixed(2)}&times;</b>. The gap is the confound,
    and it is the whole disagreement.</p>
    <table><thead><tr><th>Change</th><th>Measured between</th>
      <th class="num">Naive, pooled</th><th class="num">Stratified</th>
      <th class="num">StoreVerse-1</th><th class="num">Strata</th></tr></thead>
      <tbody>${LK.map(k => { const a = V.effects[k].actual; return `<tr>
        <td><b>${sx(V.effects[k].label)}</b></td>
        <td class="note">${sx(a.basis)}</td>
        <td class="num">${a.naive.toFixed(2)}</td>
        <td class="num"><b>${a.lift.toFixed(2)}</b></td>
        <td class="num win">${V.effects[k].simulated.simon1.toFixed(2)}</td>
        <td class="num">${n0(a.cells)}</td></tr>`; }).join('')}</tbody></table>
    <p class="note mt8">The average-lift rule measures <b>${V.avg_lift.toFixed(2)}&times;</b>,
    which is the naive figure almost exactly.${llmKeys.length ? ` The language models land there
    too: asked what a front endcap is worth they answer around
    <b>${(llmKeys.reduce((a, n) => a + llm[n].estimate.front_endcap, 0) / llmKeys.length).toFixed(2)}&times;</b>,
    because that is the number the trade press and the textbooks quote.` : ''} Everything that has
    not done the stratification lands on the folk number. StoreVerse-1 is built on the contrast
    and lands on the measurement.</p>
  </div>

  ${llmKeys.length ? `<div class="card mt">
    <div class="chead"><h2>What the language models were asked</h2></div>
    <p class="hint">Each model answered ${V.llm.repeats} times, at the same temperature, with no
    access to the chain's records &mdash; the position a planner is in when they ask one.</p>
    <pre class="prompt">${sx(V.llm.prompt)}</pre>
  </div>` : ''}`;
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

  // Two passes, so the looking and the matching can be judged separately. The reading
  // from pass one goes on screen the moment it lands, which is also what makes the wait
  // for pass two bearable.
  async function send(files) {
    if (!files.length) return;
    drop.classList.add('busy');
    const n = Math.min(files.length, 4);
    stat.innerHTML = `<div class="note">Looking at ${n} photo${n === 1 ? '' : 's'}. This calls the
      vision model and takes up to a minute.</div>`;
    try {
      const photos = await Promise.all([...files].slice(0, 4).map(f => new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => rej(new Error('could not read ' + f.name));
        fr.readAsDataURL(f);
      })));

      const look = await post('/api/vision/look', { photos });
      stat.innerHTML = `
        <div class="reading">${esc(look.reading)}</div>
        <div class="note mt8">Matching what it saw onto the ${BASE_ZONES.length} trained
        categories&hellip;</div>`;

      const spec = await post('/api/vision/map', {
        session: look.session,
        categories: BASE_ZONES.map(z => z.category),
        archetypes: archetypeCatalog(),
      });
      applySpec(spec);
    } catch (e) {
      stat.innerHTML = `<div class="note"><b>Could not read the photos.</b> ${esc(e.message)}<br>
        The demo floor is still loaded, so the rest of the walkthrough works.</div>`;
    } finally {
      drop.classList.remove('busy');
    }
  }

  async function post(url, body) {
    let r;
    try {
      r = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error(OFFLINE);
    }
    // A static host has no vision endpoint and answers with its own 404 page, so parsing
    // that as JSON would surface a syntax error instead of the actual reason.
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) {
      throw new Error(OFFLINE);
    }
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j;
  }
}

const OFFLINE = 'reading photos needs the local server, so run python server.py and open '
  + 'localhost:8000. Everything else on this page runs in the browser and works here.';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v)));

/**
 * Push overlapping fixtures apart.
 *
 * One photograph cannot give a floor plan. What the vision pass actually sees is shelf
 * rows within a fixture, so it tends to return several zones stacked at nearly the same
 * spot, which renders as one grey mass. Relaxing them apart costs nothing: the scoring
 * never reads a coordinate, so this moves the picture and not a single number.
 */
function separate(zones, size) {
  const gap = Math.min(0.8, Math.max(0.25, Math.min(size.w, size.d) * 0.05));
  const fit = z => {
    z.x = clamp(z.x, z.w / 2 + 0.2, Math.max(z.w / 2 + 0.2, size.w - z.w / 2 - 0.2));
    z.z = clamp(z.z, z.d / 2 + 0.2, Math.max(z.d / 2 + 0.2, size.d - z.d / 2 - 0.2));
  };
  for (let round = 0; round < 80; round++) {
    let moved = false;
    for (let i = 0; i < zones.length; i++) {
      for (let j = i + 1; j < zones.length; j++) {
        const a = zones[i], b = zones[j];
        const ox = (a.w + b.w) / 2 + gap - Math.abs(a.x - b.x);
        const oz = (a.d + b.d) / 2 + gap - Math.abs(a.z - b.z);
        if (ox <= 0 || oz <= 0) continue;      // already clear on one axis
        moved = true;
        const push = (k, by) => {
          const s = (a[k] <= b[k] ? -1 : 1) * by / 2;
          a[k] += s; b[k] -= s;
        };
        if (ox < oz) push('x', ox); else push('z', oz);
      }
    }
    zones.forEach(fit);
    if (!moved) break;
  }
  return zones;
}

/** The rail footer names the store on screen, so it has to follow a rebuild. */
function railFoot() {
  $('#rf-store').textContent = STORE.name;
  $('#rf-zones').textContent = STORE.zones.length;
}

const archetypeOf = () => ARCHETYPES[STORE.archetype] || ARCHETYPES[DEFAULT_ARCHETYPE];

/**
 * Fold a vision result into the live store.
 *
 * Two rules hold the whole thing together. A zone may only exist if its category came
 * back from the model with a fitted surface, so nothing on the floor is unscoreable.
 * And the contested positions come from the archetype, not from the photo, so the
 * levers stay the ones the model was fitted on.
 */
function applySpec(spec) {
  const arch = ARCHETYPES[spec.store_type] || ARCHETYPES[DEFAULT_ARCHETYPE];

  // Floor. The archetype sets the shape, the photo may resize it within reason.
  const size = { ...arch.size };
  if (spec.size && isFinite(spec.size.w) && isFinite(spec.size.d)) {
    size.w = clamp(spec.size.w, 4, 80);
    size.d = clamp(spec.size.d, 4, 90);
    if (isFinite(spec.size.h)) size.h = clamp(spec.size.h, 2.2, 8);
  }
  const fx = size.w / arch.size.w, fz = size.d / arch.size.d;
  const sx = o => ({ ...o, x: o.x * fx, z: o.z * fz, w: (o.w ?? 0) * fx, d: (o.d ?? 0) * fz });

  // Zones: one per matched category, deduped on the best-supported observation.
  const best = new Map();
  for (const o of spec.observations || []) {
    if (!o.match || !BASE_ZONES.some(z => z.category === o.match)) continue;
    const prior = best.get(o.match);
    if (!prior || (o.confidence ?? 0) > (prior.confidence ?? 0)) best.set(o.match, o);
  }
  const zones = [...best.values()].map(o => {
    const base = BASE_ZONES.find(z => z.category === o.match);
    const w = clamp(o.w ?? base.w, 0.6, size.w - 1), d = clamp(o.d ?? base.d, 0.6, size.d - 1);
    return {
      ...base, kind: ['gondola', 'cooler', 'island', 'wall'].includes(o.fixture) ? o.fixture : base.kind,
      w, d,
      x: clamp(o.x ?? base.x, w / 2 + 0.3, size.w - w / 2 - 0.3),
      z: clamp(o.z ?? base.z, d / 2 + 0.3, size.d - d / 2 - 0.3),
    };
  });

  // A floor with nothing on it cannot be scored, so keep the demo zones and say so.
  const thin = zones.length < 2;
  if (!thin) STORE.zones = separate(zones, size);

  STORE.archetype = arch.key;
  STORE.size = size;
  STORE.entrance = { ...arch.entrance, x: arch.entrance.x * fx, w: arch.entrance.w * fx };
  STORE.checkouts = arch.checkouts.map(sx);
  STORE.slots = arch.slots.map(s => (s.kind === 'display' ? sx(s) : { ...s }));
  STORE.visits_per_week = arch.visits_per_week;
  STORE.note = arch.note;
  if (spec.name) STORE.name = spec.name;
  if (spec.palette) STORE.palette = { ...STORE.palette, ...spec.palette };
  if (Array.isArray(spec.posters) && spec.posters.length) {
    STORE.posters = spec.posters.filter(p => isFinite(p.x) && isFinite(p.z) && p.text);
  }

  // The store as found. Only slots this archetype has, only categories on this floor.
  const found = Object.fromEntries(STORE.slots.map(s => [s.id, null]));
  for (const [id, cat] of Object.entries(spec.current || {})) {
    if (id in found && STORE.zones.some(z => z.category === cat)) found[id] = cat;
  }
  STORE.current = found;
  plan = { ...found };

  VISION = { ...spec, archetype: arch, thin, matched: [...best.values()] };
  baseline = score(STORE.current);
  sweep = null;
  railFoot();
  if (location.hash !== '#space') go('space'); else render();
}

/** What the photo gave us, including what it refused to match. */
function visionHTML(v) {
  const conf = c => (c == null ? '' : `<span class="cf">${Math.round(c * 100)}%</span>`);
  const miss = (v.observations || []).filter(o => !o.match);
  const bad = (v.matched || []).filter(o => (o.confidence ?? 1) < 0.5).length;
  return `
    ${v.source ? `<div class="srcline"><b>${esc(v.source.label)}</b> &middot; ${esc(v.source.how)}
      <a href="${esc(v.source.url)}" target="_blank" rel="noopener noreferrer">the scan</a></div>` : ''}
    <details class="reading-wrap"><summary>What StoreVerse saw</summary>
      <div class="reading">${esc(v.reading || '')}</div></details>
    <div class="vrow mt8">
      <b>${esc(v.archetype.title)}</b> ${conf(v.store_type_confidence)}
      <span class="note">${esc(v.store_type_reason || '')}</span>
    </div>
    <div class="note mt8">${esc(v.summary || '')}</div>
    ${v.thin ? `<div class="warn mt8">Only ${v.matched.length} trained category matched, so the
      demo floor is still in place. The store type and its positions did change.</div>` : ''}
    ${!v.thin && miss.length > v.matched.length ? `<div class="warn mt8">This store is mostly
      outside what the model was trained on: ${v.matched.length} of ${miss.length + v.matched.length}
      product groups matched. The floor below is real but partial, and anything it cannot score
      it has left off rather than guessed at. Widening the trained categories, not the photo, is
      what fixes this.</div>` : ''}
    <h3 class="vh">Matched to trained categories</h3>
    ${(v.matched || []).length ? `<ul class="obs">${v.matched.map(o => `
      <li><span class="ok">&#10003;</span>
        <div><b>${esc(o.seen || '')}</b> ${conf(o.confidence)}
        <span class="note">&rarr; ${esc(titleOf(o.match))}. ${esc(o.reason || '')}</span></div></li>`).join('')}
    </ul>` : '<p class="note">Nothing in the photos matched a trained category.</p>'}
    ${miss.length ? `<h3 class="vh">Seen, but not scoreable</h3>
    <ul class="obs">${miss.map(o => `
      <li><span class="no">&times;</span>
        <div><b>${esc(o.seen || '')}</b>
        <span class="note">${esc(o.reason || 'no trained category')}</span></div></li>`).join('')}
    </ul>` : ''}
    <p class="note mt8">Excluded groups are left off the floor rather than forced onto the nearest
    category, because a wrong match would go on to be scored as if it were real.
    ${bad ? `${bad} match${bad === 1 ? '' : 'es'} below 50% confidence &mdash; worth a look.` : ''}</p>`;
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
  // The trained table. Every category the model fitted a surface for, kept untouched so a
  // photo can only ever select from it, never add to it.
  BASE_ZONES = s.zones.map(z => ({ ...z }));
  STORE.archetype = STORE.archetype || DEFAULT_ARCHETYPE;
  plan = { ...STORE.current };
  baseline = score(STORE.current);
  railFoot();
  addEventListener('hashchange', render);
  addEventListener('resize', () => { if (location.hash === '#optimise' && sweep) drawHist(); });
  render();
}

boot().catch(e => {
  view.innerHTML = `<div class="card"><h2>Could not start</h2>
    <p class="note">${esc(e.message)}. Serve this folder over HTTP: <code>python server.py</code></p></div>`;
});
