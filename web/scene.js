// 3D floor. Built from the same store spec the simulator scores, so what you orbit around
// and what the numbers describe are the same object.
import * as THREE from 'three';

let renderer, scene, camera, store, root, promoGroup, shopperGroup, raf = 0;

const C = {
  floor: 0xe4e1db, wall: 0xf7f5f2, fixture: 0xd3cec5, fixtureTop: 0xa9a299,
  cool: 0xa9c0c9, produce: 0x7f9154, ink: 0x15161a, accent: 0x1c6f5a,
  checkout: 0xc9c3b8, shelf: 0xefece6, pad: 0xdbd7d0,
};
const BASE_C = { ...C };

const hexInt = h => parseInt(String(h).replace('#', ''), 16);
const isHex = h => typeof h === 'string' && /^#?[0-9a-f]{6}$/i.test(h);
/** Nudge a colour lighter (f > 1) or darker (f < 1), to derive shelves and caps. */
function shade(hex, f) {
  const n = hexInt(hex), ch = s => Math.min(255, Math.round(((n >> s) & 255) * f));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Blend toward a photo colour without handing the whole room over to it. */
function toward(hex, base, t = 0.6) {
  const n = hexInt(hex);
  const ch = s => Math.round((((n >> s) & 255) * t) + (((base >> s) & 255) * (1 - t)));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/**
 * Take the room's colours from the photo, with two limits.
 *
 * The accent never moves: green here means a position is responding, so it is data
 * and not decor, and a store whose walls happen to be red must not end up colouring
 * its own results. And every colour is only blended part of the way, because a photo
 * read off a grey shop at dusk will otherwise flatten the whole floor into slabs.
 */
function applyPalette(p = {}) {
  Object.assign(C, BASE_C);
  if (isHex(p.floor)) {
    C.floor = toward(p.floor, BASE_C.floor);
    C.pad = shade('#' + C.floor.toString(16).padStart(6, '0'), 0.95);
  }
  if (isHex(p.wall)) C.wall = toward(p.wall, BASE_C.wall);
  if (isHex(p.fixture)) {
    C.fixture = toward(p.fixture, BASE_C.fixture);
    const fh = '#' + C.fixture.toString(16).padStart(6, '0');
    C.fixtureTop = shade(fh, 0.78);
    C.shelf = shade(fh, 1.14);
    C.checkout = shade(fh, 0.94);
  }
  if (isHex(p.cool)) C.cool = toward(p.cool, BASE_C.cool);
  if (isHex(p.produce)) C.produce = toward(p.produce, BASE_C.produce, 0.75);
}

function box(w, h, d, color, opts = {}) {
  const g = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.MeshStandardMaterial({
    color, roughness: opts.rough ?? 0.82, metalness: opts.metal ?? 0.02,
    transparent: opts.opacity !== undefined, opacity: opts.opacity ?? 1,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

/** A flyer-style poster: bold word on a flat colour, the kind taped above a promo run. */
function poster(text, w, h, accent = '#1c6f5a') {
  const cv = document.createElement('canvas');
  cv.width = 384; cv.height = Math.round(384 * h / w);
  const g = cv.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = accent; g.fillRect(0, 0, cv.width, Math.round(cv.height * 0.22));
  g.fillStyle = accent;
  g.fillRect(16, cv.height - 22, cv.width - 32, 6);
  g.fillStyle = '#15161a';
  g.font = `700 ${Math.round(cv.height * 0.26)}px ui-sans-serif,system-ui,sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(text).slice(0, 12), cv.width / 2, cv.height * 0.56);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  return mesh;
}

/** A gondola run: carcass plus shelf slabs, so it reads as shelving and not a slab. */
function gondola(w, d, h, color) {
  const g = new THREE.Group();
  const body = box(w, h, d, color);
  body.position.y = h / 2;
  g.add(body);
  const shelves = 4;
  for (let i = 1; i <= shelves; i++) {
    const s = box(w * 1.06, 0.045, d * 1.1, C.shelf, { rough: 0.7 });
    s.position.y = (h / (shelves + 1)) * i;
    g.add(s);
  }
  const cap = box(w * 1.02, 0.06, d * 1.02, C.fixtureTop);
  cap.position.y = h;
  g.add(cap);
  return g;
}

function cooler(w, d, h) {
  const g = new THREE.Group();
  const body = box(w, h, d, 0xe4e7e8);
  body.position.y = h / 2; g.add(body);
  const glass = box(w * 0.94, h * 0.62, 0.05, C.cool, { opacity: 0.45, rough: 0.15, metal: 0.1 });
  glass.position.set(0, h * 0.56, -d / 2 - 0.03);
  g.add(glass);
  const glass2 = glass.clone(); glass2.position.z = d / 2 + 0.03; g.add(glass2);
  return g;
}

export function mountScene(canvas, spec) {
  store = spec;
  cancelAnimationFrame(raf);
  applyPalette(store.palette);
  const S = store.size;

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  const air = shade('#' + C.wall.toString(16).padStart(6, '0'), 1.02);
  scene.background = new THREE.Color(air);
  scene.fog = new THREE.Fog(air, Math.max(S.w, S.d) * 1.4, Math.max(S.w, S.d) * 2.9);

  camera = new THREE.PerspectiveCamera(42, 2, 0.1, 400);

  // Most of the light is ambient and most of the rest comes back off the fill, so the
  // single shadow-casting lamp only has to shape things. Shadows read as a soft drop
  // rather than a hole, which matters once there are people to see inside them.
  scene.add(new THREE.HemisphereLight(0xffffff, 0xdcd6cc, 2.25));
  const key = new THREE.DirectionalLight(0xfff6e8, 1.05);
  key.position.set(-18, 30, 16);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 2.4;
  key.shadow.bias = -0.0008;
  const ext = Math.max(S.w, S.d);
  Object.assign(key.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 90 });
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.62);
  fill.position.set(20, 14, -12);
  scene.add(fill);
  const back = new THREE.DirectionalLight(0xffffff, 0.3);
  back.position.set(4, 9, -22);
  scene.add(back);

  root = new THREE.Group();
  root.position.set(-S.w / 2, 0, -S.d / 2);
  scene.add(root);
  build();
  orbit(canvas);
  resize(canvas);
  addEventListener('resize', () => resize(canvas));
  loop();
}

function build() {
  const S = store.size;
  while (root.children.length) root.remove(root.children[0]);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(S.w, S.d),
    new THREE.MeshStandardMaterial({ color: C.floor, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(S.w / 2, 0, S.d / 2);
  floor.receiveShadow = true;
  root.add(floor);

  // Low walls on three sides, so the floor reads as a room but stays open to the camera.
  // Kept proportional, or a small shop looks like it is sitting in a bunker.
  const wh = Math.min(1.5, Math.max(0.75, Math.min(S.w, S.d) * 0.07));
  const mk = (w, d, x, z) => { const b = box(w, wh, d, C.wall); b.position.set(x, wh / 2, z); root.add(b); };
  mk(S.w, 0.18, S.w / 2, S.d);
  mk(0.18, S.d, 0, S.d / 2);
  mk(0.18, S.d, S.w, S.d / 2);
  const e = store.entrance;
  mk(e.x - e.w / 2, 0.18, (e.x - e.w / 2) / 2, 0);
  const rightStart = e.x + e.w / 2;
  mk(S.w - rightStart, 0.18, rightStart + (S.w - rightStart) / 2, 0);

  for (const z of store.zones) {
    let g;
    if (z.kind === 'cooler') g = cooler(z.w, z.d, 2.0);
    else if (z.kind === 'island') {
      g = new THREE.Group();
      const b = box(z.w, 0.85, z.d, C.produce, { rough: 0.9 });
      b.position.y = 0.42; g.add(b);
      const rim = box(z.w * 1.04, 0.09, z.d * 1.04, C.fixtureTop);
      rim.position.y = 0.88; g.add(rim);
    } else if (z.kind === 'wall') {
      g = gondola(z.w, z.d, 2.3, C.fixture);
    } else {
      g = gondola(z.w, z.d, 2.1, C.fixture);
    }
    // The scuff margin around a fixture is a share of the floor, not a fixed metre.
    // On a corner-shop floor a flat 1.1m of it would swallow the aisles.
    const pm = Math.min(1.1, Math.max(0.26, Math.min(S.w, S.d) * 0.045));
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(z.w + pm, z.d + pm),
      new THREE.MeshStandardMaterial({ color: C.pad, roughness: 0.98 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(z.x, 0.012, z.z);
    pad.receiveShadow = true;
    root.add(pad);
    g.position.set(z.x, 0, z.z);
    g.userData.zone = z.category;
    root.add(g);
  }

  for (const c of store.checkouts) {
    const b = box(c.w, 1.0, c.d, C.checkout);
    b.position.set(c.x, 0.5, c.z);
    root.add(b);
    const screen = box(0.34, 0.26, 0.05, C.ink);
    screen.position.set(c.x, 1.22, c.z - c.d / 2 + 0.3);
    root.add(screen);
  }

  // Signage hangs off whichever wall it is nearest, at a height that wall can carry.
  const py = Math.max(1.2, wh + 0.5);
  for (const p of store.posters || []) {
    const m = poster(p.text, p.w, p.h);
    m.position.set(p.x, py, p.z);
    if (p.x < 1.5) m.rotation.y = Math.PI / 2;
    else if (p.x > S.w - 1.5) m.rotation.y = -Math.PI / 2;
    else if (p.z > S.d - 1.5) m.rotation.y = Math.PI;
    root.add(m);
  }

  promoGroup = new THREE.Group();
  root.add(promoGroup);
  // The floor was just emptied, so every body on it went with it.
  people = []; pops = []; crowd = null;
  shopperGroup = new THREE.Group();
  root.add(shopperGroup);
}

/** Redraw just the contested positions: what is stacked where, and how hot it is. */
export function updateScene(plan, sc) {
  if (!promoGroup) return;
  setCrowd(plan, sc);
  while (promoGroup.children.length) promoGroup.remove(promoGroup.children[0]);
  const byCat = Object.fromEntries((sc?.rows || []).map(r => [r.category, r]));

  for (const s of store.slots.filter(x => x.kind === 'display')) {
    const cat = plan[s.id];
    const h = s.level === 2 ? 1.25 : 0.95;
    const base = box(s.w, 0.12, s.d, C.fixtureTop);
    base.position.set(s.x, 0.06, s.z);
    promoGroup.add(base);
    if (!cat) continue;
    const r = byCat[cat];
    const hot = r && r.lift > 1.3;
    const stack = box(s.w * 0.86, h, s.d * 0.86, hot ? C.accent : 0xbfc7c2, { rough: 0.75 });
    stack.position.set(s.x, 0.12 + h / 2, s.z);
    promoGroup.add(stack);
    const crown = box(s.w * 0.92, 0.07, s.d * 0.92, C.fixtureTop);
    crown.position.set(s.x, 0.12 + h + 0.04, s.z);
    promoGroup.add(crown);
    const z = store.zones.find(x => x.category === cat);
    const sign = poster(z ? z.title : cat, Math.max(s.w, 1.1), 0.46, hot ? '#1c6f5a' : '#8d8a84');
    sign.position.set(s.x, 0.12 + h + 0.42, s.z - s.d / 2 - 0.02);
    promoGroup.add(sign);
    const back = sign.clone();
    back.position.z = s.z + s.d / 2 + 0.02;
    back.rotation.y = Math.PI;
    promoGroup.add(back);
  }
}

// --------------------------------------------------------------- shoppers
//
// What varies, and what does not.
//
// How many people are on the floor comes from the store: the weekly visits the archetype
// carries, so a corner shop is quiet and a supermarket is busy. A merchandising plan does
// not change how many people walk in, and pretending otherwise would be a lie told in
// pictures.
//
// What the plan does change is what they do once inside. Where a shopper chooses to stop,
// how long they linger and how often that ends in a purchase are all drawn from the
// scored purchase probability of the category in front of them. Move a category onto a
// prime endcap and you see more people stop there and more of them buy. That is the model
// speaking, which is the only thing on this floor allowed to.
//
// The rates are relative, not literal. A real per-visit probability is a fraction of a
// percent and would show as an empty shop, so stopping is scaled against the best zone on
// the floor. Differences between zones are honest; the absolute rate is not.

const WALK = 1.05;                 // metres per second
const SKIN = [0xd8b89a, 0xbb9170, 0x8d6748, 0xeccfb4, 0x6f4f38];
const WEAR = [0x4a5568, 0x7b8794, 0x8f6b5d, 0x5c6b58, 0x9a8a78, 0x3f4a5a, 0xa8907c];

let crowd = null, people = [], pops = [], prevT = 0;

function person(i) {
  const g = new THREE.Group();
  const tone = WEAR[i % WEAR.length];
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.2, 0.92, 4, 10),
    new THREE.MeshStandardMaterial({ color: tone, roughness: 0.88 }));
  body.position.y = 0.66;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.145, 14, 11),
    new THREE.MeshStandardMaterial({ color: SKIN[i % SKIN.length], roughness: 0.78 }));
  head.position.y = 1.4;
  body.castShadow = head.castShadow = true;
  g.add(body, head);
  return g;
}

/** A purchase: one accent chip that rises off the shopper and fades. */
function pop(x, z) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 10, 8),
    new THREE.MeshStandardMaterial({
      color: C.accent, roughness: 0.4, transparent: true, opacity: 1, emissive: C.accent,
      emissiveIntensity: 0.35,
    }));
  m.position.set(x, 1.62, z);
  root.add(m);
  pops.push({ m, t: 0 });
}

const inBox = (x, z, b, pad) =>
  Math.abs(x - b.x) < b.w / 2 + pad && Math.abs(z - b.z) < b.d / 2 + pad;

function blocked(x, z) {
  const S = store.size;
  if (x < 0.45 || z < 0.45 || x > S.w - 0.45 || z > S.d - 0.45) return true;
  return crowd.walls.some(b => inBox(x, z, b, 0.3));
}

/** Any walkable spot, for putting a body down without dropping it inside a shelf. */
function freeSpot() {
  const S = store.size;
  for (let k = 0; k < 80; k++) {
    const x = 0.7 + Math.random() * (S.w - 1.4), z = 0.7 + Math.random() * (S.d - 1.4);
    if (!blocked(x, z)) return { x, z };
  }
  return { x: store.entrance.x, z: 1.0 };
}

/**
 * A spot to stand at a fixture, rather than inside it.
 *
 * Alongside the long face, offset just clear of the short one. A radius around the
 * centre would be wrong for the shape these actually are: a gondola is 2m by 13m, so
 * "7 metres from the middle" is somewhere else entirely, usually inside its neighbour.
 */
function approach(d) {
  const horiz = d.w >= d.d;
  for (let k = 0; k < 14; k++) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const along = (Math.random() - 0.5) * 0.85;
    const x = horiz ? d.x + along * d.w : d.x + side * (d.w / 2 + 0.72);
    const z = horiz ? d.z + side * (d.d / 2 + 0.72) : d.z + along * d.d;
    if (!blocked(x, z)) return { x, z, d };
  }
  return { ...freeSpot(), d };
}

function pick() {
  let r = Math.random() * crowd.sum;
  for (const d of crowd.dest) if ((r -= d.weight) <= 0) return d;
  return crowd.dest[crowd.dest.length - 1];
}

/**
 * Rebuild the crowd for the plan on screen.
 * Headcount follows the store, destination weights follow the score.
 */
function setCrowd(plan = {}, sc = null) {
  const S = store.size;
  const rows = Object.fromEntries((sc?.rows || []).map(r => [r.category, r]));

  const dest = store.zones.map(z => ({
    x: z.x, z: z.z, w: z.w, d: z.d, p: rows[z.category]?.p ?? 0.004,
  }));
  for (const s of store.slots || []) {
    if (s.kind !== 'display') continue;
    const r = rows[plan[s.id]];
    if (!r) continue;
    // A promo stack out on the floor pulls harder than the home shelf does.
    dest.push({ x: s.x, z: s.z, w: s.w, d: s.d, p: r.p * 1.7 });
  }
  if (!dest.length) dest.push({ x: S.w / 2, z: S.d / 2, w: 1, d: 1, p: 0.01 });

  const top = Math.max(...dest.map(d => d.p)) || 1;
  for (const d of dest) {
    d.weight = d.p;
    d.buy = 0.22 + 0.68 * (d.p / top);      // relative, see the note above
    d.dwell = 1.1 + 2.6 * (d.p / top);
  }

  const walls = [
    ...store.zones.map(z => ({ x: z.x, z: z.z, w: z.w, d: z.d })),
    ...(store.checkouts || []).map(c => ({ x: c.x, z: c.z, w: c.w, d: c.d })),
    ...(store.slots || []).filter(s => s.kind === 'display' && plan[s.id])
      .map(s => ({ x: s.x, z: s.z, w: s.w, d: s.d })),
  ];
  crowd = { dest, walls, sum: dest.reduce((a, b) => a + b.weight, 0) };

  // One body per so many modelled weekly visits, held to what reads on screen.
  const want = Math.max(3, Math.min(34, Math.round((store.visits_per_week || 8000) / 820)));
  while (people.length > want) shopperGroup.remove(people.pop().g);
  while (people.length < want) {
    const g = person(people.length);
    shopperGroup.add(g);
    // Scattered across the floor rather than queued at the door, so the shop is already
    // open when you first look at it.
    const s = freeSpot();
    people.push({
      g, x: s.x, z: s.z, to: null, state: 'walk', t: 0, face: 0, bob: Math.random() * 6.3,
    });
  }
  for (const p of people) p.to = approach(pick());
}

function stepCrowd(dt) {
  if (!crowd || !shopperGroup) return;
  const S = store.size;
  for (const p of people) {
    if (p.state === 'stop') {
      p.t -= dt;
      if (p.t <= 0) {
        if (Math.random() < p.to.d.buy) pop(p.x, p.z);
        p.state = 'walk';
        p.to = Math.random() < 0.16
          ? { x: store.entrance.x, z: 0.7, d: { buy: 0, dwell: 0 }, exit: true }
          : approach(pick());
      }
      p.g.position.set(p.x, 0, p.z);
      p.g.rotation.y = p.face;
      continue;
    }

    let dx = p.to.x - p.x, dz = p.to.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.34) {
      if (p.to.exit) {                       // left the shop, comes back as someone else
        const e = store.entrance;
        p.x = e.x + (Math.random() - 0.5) * e.w; p.z = 0.6;
        p.to = approach(pick());
      } else {
        p.state = 'stop';
        p.t = p.to.d.dwell * (0.6 + Math.random() * 0.8);
      }
      continue;
    }
    const step = WALK * dt;
    dx = dx / dist * step; dz = dz / dist * step;
    if (!blocked(p.x + dx, p.z + dz)) { p.x += dx; p.z += dz; }
    else if (!blocked(p.x + dx, p.z)) p.x += dx;      // slide along the shelf
    else if (!blocked(p.x, p.z + dz)) p.z += dz;
    else {
      const sx = p.x + dz * 1.5, sz = p.z - dx * 1.5; // step around the end of it
      if (!blocked(sx, sz)) { p.x = sx; p.z = sz; } else p.to = approach(pick());
    }
    p.x = Math.min(S.w - 0.4, Math.max(0.4, p.x));
    p.z = Math.min(S.d - 0.4, Math.max(0.4, p.z));
    p.face = Math.atan2(dx, dz);
    p.bob += dt * 9;
    p.g.position.set(p.x, Math.abs(Math.sin(p.bob)) * 0.035, p.z);
    p.g.rotation.y = p.face;
  }

  for (let i = pops.length - 1; i >= 0; i--) {
    const q = pops[i];
    q.t += dt;
    q.m.position.y += dt * 0.75;
    q.m.material.opacity = Math.max(0, 1 - q.t / 1.1);
    if (q.t > 1.1) { root.remove(q.m); q.m.material.dispose(); pops.splice(i, 1); }
  }
}

// --------------------------------------------------------- camera control
let th = -0.58, ph = 0.78, dist = 31, drag = null, target;
function orbit(canvas) {
  target = new THREE.Vector3(0, 0.9, 0);
  // Frame whatever floor we were handed: a corner shop and a supermarket are not the
  // same distance away.
  const S = store.size;
  // Far enough back that the whole diagonal fits, whatever shape the room is.
  dist = Math.min(84, Math.max(13, Math.hypot(S.w, S.d) * 1.02));
  canvas.style.cursor = 'grab';
  canvas.onpointerdown = e => {
    drag = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  };
  canvas.onpointermove = e => {
    if (!drag) return;
    th -= (e.clientX - drag.x) * 0.006;
    ph = Math.min(1.42, Math.max(0.18, ph - (e.clientY - drag.y) * 0.005));
    drag = { x: e.clientX, y: e.clientY };
  };
  const stop = () => { drag = null; canvas.style.cursor = 'grab'; };
  canvas.onpointerup = stop;
  canvas.onpointercancel = stop;
  canvas.onwheel = e => {
    e.preventDefault();
    dist = Math.min(80, Math.max(12, dist + Math.sign(e.deltaY) * 2.2));
  };
}

function resize(canvas) {
  if (!renderer) return;
  const w = canvas.clientWidth || 800, h = canvas.clientHeight || 440;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function loop(now) {
  raf = requestAnimationFrame(loop);
  const dt = prevT && now ? Math.min(0.05, (now - prevT) / 1000) : 0.016;
  if (now) prevT = now;
  stepCrowd(dt);
  if (!drag) th += 0.0009;
  camera.position.set(
    target.x + dist * Math.sin(ph) * Math.sin(th),
    target.y + dist * Math.cos(ph),
    target.z + dist * Math.sin(ph) * Math.cos(th));
  camera.lookAt(target);
  renderer.render(scene, camera);
}
