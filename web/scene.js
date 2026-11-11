// 3D floor. Built from the same store spec the simulator scores, so what you orbit around
// and what the numbers describe are the same object.
//
// The look is a bright isometric illustration: an orthographic camera, a cream floor slab,
// grey room walls that hide themselves when they face the viewer, white shelving stocked
// with small colourful packs, and little people with legs and baskets. Everything is still
// procedural, so a floor read from a photograph gets the exact same treatment as the demo.
import * as THREE from 'three';

let renderer, scene, camera, store, root, promoGroup, shopperGroup, raf = 0;

const C = {
  floor: 0xe9dec6, slab: 0xd7d1c2, wall: 0xb3b7ba, pad: 0xded2b8,
  fixture: 0xf2f2ef, fixtureBase: 0x9ba0a4, fixtureTop: 0xd9dbdc, shelf: 0xffffff,
  cool: 0xbfdce8, coolBody: 0xeef1f2, coolBack: 0x51575e,
  checkout: 0xece6d8, belt: 0x4a4e55, screen: 0x23262b,
  wood: 0xc08a4d, woodDark: 0x96682f,
  ink: 0x2b2e33, accent: 0x1c6f5a,
};
const BASE_C = { ...C };

// Packaging colours by what the category actually is, so soft drinks read as bottles and
// bakery reads as bread, even though every one of them is a little box on a shelf.
const PALETTES = {
  drink: [0xd94436, 0x2e7dd1, 0xf29c38, 0x53b36a, 0x8a4db3, 0xf0eee8, 0x36a8a0],
  snack: [0xf2b53a, 0xd94436, 0x67a845, 0xf28c38, 0xe8d49e, 0x2e7dd1],
  bake: [0xc08a4d, 0xa9743a, 0xe0b36a, 0xd9985f, 0xeed9ab],
  dairy: [0xf2efe6, 0x79b8d4, 0xf2b53a, 0xe29ab0, 0xffffff],
  meat: [0xc24040, 0x8e3030, 0xe08a6a, 0xf2efe6, 0xa85858],
  produce: [0x4f9e4f, 0x7cc24b, 0xd94436, 0xf2b53a, 0xf28c38],
  frozen: [0xd94436, 0xf2b53a, 0x79b8d4, 0xf0eee8, 0x2e7dd1],
  mixed: [0xd94436, 0xf2b53a, 0x2e7dd1, 0x53b36a, 0xf28c38, 0x8a4db3, 0xf0eee8, 0x79b8d4],
};

function familyOf(cat = '') {
  const c = String(cat).toUpperCase();
  if (/BREAD|BAKE|ROLL|BUN/.test(c)) return PALETTES.bake;
  if (/FROZEN|PIZZA/.test(c)) return PALETTES.frozen;
  if (/DRINK|SODA|JUICE|WATER|ISOTONIC/.test(c)) return PALETTES.drink;
  if (/SNACK|CHIP|CRACKER|COOKIE|CANDY|BKD/.test(c)) return PALETTES.snack;
  if (/CHEESE|YOGURT|DAIRY|MILK/.test(c)) return PALETTES.dairy;
  if (/MEAT|BACON|SAUSAGE|DELI/.test(c)) return PALETTES.meat;
  if (/PRODUCE|FRUIT|VEG/.test(c)) return PALETTES.produce;
  return PALETTES.mixed;
}

/** Deterministic per-fixture randomness, so the stock does not reshuffle on every render. */
function rng(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0) / 4294967296);
}

const hexInt = h => parseInt(String(h).replace('#', ''), 16);
const isHex = h => typeof h === 'string' && /^#?[0-9a-f]{6}$/i.test(h);
/** Nudge a colour lighter (f > 1) or darker (f < 1). */
function shade(hex, f) {
  const n = typeof hex === 'number' ? hex : hexInt(hex);
  const ch = s => Math.min(255, Math.round(((n >> s) & 255) * f));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Blend toward a photo colour without handing the whole room over to it. */
function toward(hex, base, t = 0.55) {
  const n = hexInt(hex);
  const ch = s => Math.round((((n >> s) & 255) * t) + (((base >> s) & 255) * (1 - t)));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/**
 * Take the room's colours from the photo, with two limits.
 *
 * The accent never moves: green here means a position is responding, so it is data
 * and not decor. And every colour is only blended part of the way, because a photo
 * read off a grey shop at dusk would otherwise flatten the whole illustration.
 * Packaging colours never come from the photo at all; they belong to the categories.
 */
function applyPalette(p = {}) {
  Object.assign(C, BASE_C);
  if (isHex(p.floor)) {
    C.floor = toward(p.floor, BASE_C.floor);
    C.pad = shade(C.floor, 0.94);
    C.slab = shade(C.floor, 0.9);
  }
  if (isHex(p.wall)) C.wall = toward(p.wall, BASE_C.wall);
  if (isHex(p.fixture)) {
    C.fixture = toward(p.fixture, BASE_C.fixture, 0.4);
    C.fixtureTop = shade(C.fixture, 0.88);
    C.shelf = shade(C.fixture, 1.06);
  }
  if (isHex(p.cool)) C.cool = toward(p.cool, BASE_C.cool, 0.4);
}

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: opts.rough ?? 0.85, metalness: opts.metal ?? 0.02,
    transparent: opts.opacity !== undefined, opacity: opts.opacity ?? 1,
  });
}

function box(w, h, d, color, opts = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
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

// ------------------------------------------------------------------ stocked fixtures
//
// Every fixture builds its merchandise as one InstancedMesh: a thousand packs is one
// draw call, so the floor can afford to actually be stocked.

const PACK_GEO = new THREE.BoxGeometry(1, 1, 1); PACK_GEO.translate(0, 0.5, 0);
const LOAF_GEO = new THREE.SphereGeometry(0.5, 10, 7); LOAF_GEO.translate(0, 0.5, 0);
const BOTTLE_GEO = new THREE.CylinderGeometry(0.5, 0.5, 1, 8); BOTTLE_GEO.translate(0, 0.5, 0);
const FRUIT_GEO = new THREE.SphereGeometry(0.5, 9, 7); FRUIT_GEO.translate(0, 0.5, 0);

function instanced(geo, items) {
  const im = new THREE.InstancedMesh(geo, mat(0xffffff, { rough: 0.8 }), items.length);
  const M = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(),
    S = new THREE.Vector3(), col = new THREE.Color();
  items.forEach((it, i) => {
    M.compose(P.set(it.x, it.y, it.z), Q, S.set(it.sx, it.sy, it.sz));
    im.setMatrixAt(i, M);
    im.setColorAt(i, col.setHex(it.c));
  });
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.castShadow = im.receiveShadow = true;
  return im;
}

/** Rows of packs along a shelf, with gaps where someone already shopped it. */
function stockRow(items, r, fam, x0, x1, y, z, depth, loaf) {
  const step = loaf ? 0.3 : 0.3;
  for (let x = x0 + 0.16; x < x1 - 0.12; x += step) {
    if (r() < 0.12) continue;
    const c = fam[Math.floor(r() * fam.length)];
    if (loaf) items.push({ x: x + (r() - 0.5) * 0.04, y, z, sx: 0.3, sy: 0.17 + r() * 0.05, sz: Math.min(0.26, depth), c, loaf: true });
    else items.push({ x: x + (r() - 0.5) * 0.05, y, z, sx: 0.24, sy: 0.2 + r() * 0.15, sz: Math.min(0.32, depth * 0.8), c });
  }
}

/**
 * A gondola run: grey plinth, white carcass, and every shelf actually stocked.
 * Double-sided for aisle units; one-sided (against a wall) when asked.
 */
function gondola(L, D, h, zone, opts = {}) {
  const g = new THREE.Group();
  const r = rng('g' + (zone?.category || '') + L.toFixed(1) + D.toFixed(1));
  const fam = familyOf(zone?.category);
  const loaf = fam === PALETTES.bake;
  const wood = loaf;

  const plinth = box(L, 0.14, D, C.fixtureBase); plinth.position.y = 0.07; g.add(plinth);
  const spineD = opts.oneSided ? 0.1 : 0.14;
  const spineZ = opts.oneSided ? D / 2 - spineD / 2 : 0;
  const spine = box(L, h - 0.14, spineD, wood ? C.wood : C.fixture);
  spine.position.set(0, (h - 0.14) / 2 + 0.14, spineZ); g.add(spine);
  // No lid. The camera is orthographic and mostly overhead, so a cap would hide the
  // stock; in the reference illustration you read a gondola by its top shelf.
  const rail = box(L * 1.01, 0.05, spineD + 0.06, wood ? C.woodDark : C.fixtureTop);
  rail.position.set(0, h + 0.025, spineZ); g.add(rail);

  const levels = h > 1.6 ? 4 : 3;
  const sideD = opts.oneSided ? D - spineD - 0.04 : (D - spineD) / 2 - 0.02;
  const sides = opts.oneSided ? [-1] : [-1, 1];
  const items = [];
  for (const s of sides) {
    const zc = opts.oneSided ? spineZ - spineD / 2 - sideD / 2 : s * (spineD / 2 + sideD / 2);
    for (let i = 0; i < levels; i++) {
      const y = 0.22 + i * ((h - 0.62) / (levels - 1));
      const slab = box(L * 1.01, 0.045, sideD + 0.04, wood ? C.wood : C.shelf, { rough: 0.7 });
      slab.position.set(0, y, zc); g.add(slab);
      stockRow(items, r, fam, -L / 2, L / 2, y + 0.025, zc, sideD, loaf);
    }
  }
  if (items.length) {
    g.add(instanced(PACK_GEO, items.filter(i => !i.loaf)));
    const loaves = items.filter(i => i.loaf);
    if (loaves.length) g.add(instanced(LOAF_GEO, loaves));
  }
  return g;
}

/** A glass-door cooler: pale case, dark inside, rows of bright bottles, brand band on top. */
function cooler(L, D, h, zone) {
  const g = new THREE.Group();
  const r = rng('c' + (zone?.category || '') + L.toFixed(1));
  const fam = familyOf(zone?.category || 'DRINK');

  const body = box(L, h, D, C.coolBody); body.position.y = h / 2; g.add(body);
  const back = box(L * 0.94, h * 0.74, D * 0.5, C.coolBack);
  back.position.set(0, h * 0.46, D * 0.12); g.add(back);

  const items = [];
  const rows = 3, innerD = Math.min(0.3, D * 0.5);
  for (let i = 0; i < rows; i++) {
    const y = h * 0.14 + i * (h * 0.62 / (rows - 1));
    const slab = box(L * 0.94, 0.03, innerD + 0.06, C.fixtureTop);
    slab.position.set(0, y, -D * 0.14); g.add(slab);
    for (let x = -L / 2 + 0.2; x < L / 2 - 0.14; x += 0.17) {
      if (r() < 0.1) continue;
      items.push({ x: x + (r() - 0.5) * 0.03, y: y + 0.015, z: -D * 0.14,
        sx: 0.11, sy: 0.26 + r() * 0.08, sz: 0.11, c: fam[Math.floor(r() * fam.length)] });
    }
  }
  if (items.length) g.add(instanced(BOTTLE_GEO, items));

  const glass = box(L * 0.96, h * 0.72, 0.04, C.cool, { opacity: 0.32, rough: 0.12, metal: 0.1 });
  glass.position.set(0, h * 0.47, -D / 2 - 0.02);
  glass.castShadow = false; g.add(glass);
  for (let i = 1; i < Math.max(2, Math.round(L / 0.9)); i++) {
    const mull = box(0.04, h * 0.72, 0.05, C.coolBody);
    mull.position.set(-L / 2 + i * (L / Math.max(2, Math.round(L / 0.9))), h * 0.47, -D / 2 - 0.02);
    g.add(mull);
  }
  const band = box(L, 0.26, D * 1.02, fam[1] ?? 0x2e7dd1);
  band.position.y = h + 0.13; g.add(band);
  return g;
}

/** A produce island: a wood crate table with mounded colour patches on top. */
function island(L, D, zone) {
  const g = new THREE.Group();
  const r = rng('i' + (zone?.category || '') + L.toFixed(1));
  const fam = familyOf(zone?.category || 'PRODUCE');
  const body = box(L, 0.72, D, C.wood, { rough: 0.9 }); body.position.y = 0.36; g.add(body);
  const rim = box(L * 1.05, 0.1, D * 1.05, C.woodDark); rim.position.y = 0.76; g.add(rim);

  const items = [];
  const patches = Math.max(2, Math.round(L / 0.9));
  for (let pz = 0; pz < 2; pz++) for (let px = 0; px < patches; px++) {
    const c = fam[Math.floor(r() * fam.length)];
    const cx = -L / 2 + (px + 0.5) * (L / patches), cz = -D / 4 + pz * (D / 2);
    for (let k = 0; k < 7; k++) {
      items.push({ x: cx + (r() - 0.5) * (L / patches) * 0.7, y: 0.78 + r() * 0.06,
        z: cz + (r() - 0.5) * D * 0.34, sx: 0.16, sy: 0.14, sz: 0.16, c });
    }
  }
  g.add(instanced(FRUIT_GEO, items));
  return g;
}

/** A checkout lane: counter, dark belt, a screen on a pole, and someone working it. */
function checkoutUnit(c, i) {
  const g = new THREE.Group();
  const counter = box(c.w, 0.92, c.d, C.checkout); counter.position.y = 0.46; g.add(counter);
  const belt = box(c.w * 0.72, 0.035, c.d * 0.55, C.belt);
  belt.position.set(0, 0.94, c.d * 0.06); g.add(belt);
  const pole = box(0.05, 0.56, 0.05, C.ink); pole.position.set(0, 1.2, -c.d / 2 + 0.3); g.add(pole);
  const screen = box(0.36, 0.26, 0.05, C.screen);
  screen.position.set(0, 1.46, -c.d / 2 + 0.3); g.add(screen);
  const clerk = person(40 + i, { basket: false });
  clerk.position.set(c.w / 2 + 0.42, 0, -c.d * 0.1);
  clerk.rotation.y = -Math.PI / 2;
  g.add(clerk);
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
  scene.background = new THREE.Color(0xf6f1e8);

  // The illustration is isometric, so the camera is orthographic: nothing shrinks with
  // distance and the floor reads as a diagram you can walk.
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 600);
  viewHalf = Math.hypot(S.w, S.d) * 0.42;
  camDist = Math.max(S.w, S.d) * 2.4 + 20;

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d2c4, 2.25));
  const key = new THREE.DirectionalLight(0xfff6e8, 1.05);
  key.position.set(-18, 30, 16);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 2.4;
  key.shadow.bias = -0.0008;
  const ext = Math.max(S.w, S.d);
  Object.assign(key.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 140 });
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

/** One room wall: a single-sided plane facing the inside, so it hides itself whenever the
 * camera comes around behind it and the room opens up like a dollhouse. */
function wallPlane(w, h, x, z, ry) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat(C.wall, { rough: 0.96 }));
  m.position.set(x, h / 2, z);
  m.rotation.y = ry;
  m.receiveShadow = true;
  root.add(m);
  const trim = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.18), mat(shade(C.wall, 0.82)));
  trim.position.set(x, 0.09, z); trim.rotation.y = ry;
  trim.position.x += Math.sin(ry) * 0.01; trim.position.z += Math.cos(ry) * 0.01;
  root.add(trim);
}

function build() {
  const S = store.size;
  while (root.children.length) root.remove(root.children[0]);

  // The ground is a slab, not an infinite plane: the whole store sits on a tile you
  // could pick up, which is most of what makes it read as an illustration.
  const slab = box(S.w + 0.6, 0.3, S.d + 0.6, C.slab);
  slab.position.set(S.w / 2, -0.16, S.d / 2);
  slab.castShadow = false;
  root.add(slab);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(S.w, S.d), mat(C.floor, { rough: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(S.w / 2, 0.001, S.d / 2);
  floor.receiveShadow = true;
  root.add(floor);

  const WH = Math.min(3.2, Math.max(2.4, (S.h || 3) * 0.92));
  wallPlane(S.w, WH, S.w / 2, S.d, Math.PI);                       // back
  wallPlane(S.d, WH, 0, S.d / 2, Math.PI / 2);                     // left
  wallPlane(S.d, WH, S.w, S.d / 2, -Math.PI / 2);                  // right
  const e = store.entrance;
  const lw = e.x - e.w / 2, rw = S.w - (e.x + e.w / 2);
  if (lw > 0.2) wallPlane(lw, WH, lw / 2, 0, 0);                   // front, beside the door
  if (rw > 0.2) wallPlane(rw, WH, e.x + e.w / 2 + rw / 2, 0, 0);
  const mat1 = new THREE.Mesh(new THREE.PlaneGeometry(e.w, 1.6), mat(shade(C.floor, 0.82)));
  mat1.rotation.x = -Math.PI / 2;
  mat1.position.set(e.x, 0.004, 0.8);
  mat1.receiveShadow = true;
  root.add(mat1);

  for (const z of store.zones) {
    // Build in a local frame whose length runs along x, then turn the group so the long
    // face meets its aisle; a fixture read from a photo can arrive in either orientation.
    const along = z.w >= z.d;
    const L = along ? z.w : z.d, D = along ? z.d : z.w;
    let g, rot = along ? 0 : Math.PI / 2;
    if (z.kind === 'cooler') {
      g = cooler(L, Math.max(D, 0.7), 2.0, z);
      // Glass faces local -z; face the centre of the room.
      const facing = along ? (z.z > S.d / 2 ? 0 : Math.PI) : (z.x > S.w / 2 ? Math.PI / 2 : -Math.PI / 2);
      rot = facing;
    } else if (z.kind === 'island') {
      g = island(L, D, z);
    } else if (z.kind === 'wall') {
      g = gondola(L, Math.max(D, 0.6), 2.25, z, { oneSided: true });
      const facing = along ? (z.z > S.d / 2 ? 0 : Math.PI) : (z.x > S.w / 2 ? Math.PI / 2 : -Math.PI / 2);
      rot = facing;
    } else {
      g = gondola(L, Math.max(D, 0.9), 2.05, z);
    }
    const pm = Math.min(1.1, Math.max(0.26, Math.min(S.w, S.d) * 0.045));
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(z.w + pm, z.d + pm), mat(C.pad, { rough: 0.98 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(z.x, 0.012, z.z);
    pad.receiveShadow = true;
    root.add(pad);
    g.position.set(z.x, 0, z.z);
    g.rotation.y = rot;
    g.userData.zone = z.category;
    root.add(g);
  }

  (store.checkouts || []).forEach((c, i) => {
    const g = checkoutUnit(c, i);
    g.position.set(c.x, 0, c.z);
    root.add(g);
  });

  const py = Math.max(1.4, Math.min(2.2, (Math.min(3.2, Math.max(2.4, (S.h || 3) * 0.92))) - 0.7));
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
  while (promoGroup.children.length) {
    const ch = promoGroup.children[0];
    promoGroup.remove(ch);
    // Materials and sign textures are per-stack, so they go; geometry is shared between
    // every stocked fixture on the floor and must survive the stack that borrowed it.
    ch.traverse(o => { if (o.material?.map) o.material.map.dispose(); o.material?.dispose?.(); });
  }
  const byCat = Object.fromEntries((sc?.rows || []).map(r => [r.category, r]));

  for (const s of store.slots.filter(x => x.kind === 'display')) {
    const cat = plan[s.id];
    const pallet = box(s.w, 0.1, s.d, C.woodDark, { rough: 0.95 });
    pallet.position.set(s.x, 0.05, s.z);
    promoGroup.add(pallet);
    if (!cat) continue;
    const r = byCat[cat];
    const hot = r && r.lift > 1.3;
    const fam = familyOf(cat);
    const rr = rng('p' + s.id + cat);

    // A stacked display: layers of real packs, shrinking as they go up, like a pallet
    // someone has been shopping from.
    const layers = s.level === 2 ? 4 : 3;
    const items = [];
    for (let l = 0; l < layers; l++) {
      const f = 1 - l * 0.16;
      const nx = Math.max(1, Math.floor((s.w * f) / 0.28));
      const nz = Math.max(1, Math.floor((s.d * f) / 0.28));
      for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
        if (l === layers - 1 && rr() < 0.3) continue;
        items.push({
          x: s.x - (nx - 1) * 0.14 + ix * 0.28, y: 0.1 + l * 0.23,
          z: s.z - (nz - 1) * 0.14 + iz * 0.28,
          sx: 0.25, sy: 0.22, sz: 0.25, c: fam[Math.floor(rr() * fam.length)],
        });
      }
    }
    promoGroup.add(instanced(PACK_GEO, items));

    const top = 0.1 + layers * 0.23;
    const z = store.zones.find(x => x.category === cat);
    const sign = poster(z ? z.title : cat, Math.max(s.w, 1.1), 0.46, hot ? '#1c6f5a' : '#8d8a84');
    sign.position.set(s.x, top + 0.42, s.z - s.d / 2 - 0.02);
    promoGroup.add(sign);
    const backSign = sign.clone();
    backSign.position.z = s.z + s.d / 2 + 0.02;
    backSign.rotation.y = Math.PI;
    promoGroup.add(backSign);
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
const WEAR = [0xd94436, 0x2e7dd1, 0xf2b53a, 0x53b36a, 0xf0eee8, 0x8a4db3, 0xf28c38, 0x3b4a5a];
const PANTS = [0x3b4252, 0x5b6470, 0x7a5b43, 0x2b2e33, 0x4668a0];
const HAIR = [0x2b2017, 0x4a3320, 0x8a5a2b, 0xd9c29a, 0x50565e];

let crowd = null, people = [], pops = [], prevT = 0;

/** A small illustrated figure: legs, torso, arms, head and hair, sometimes a basket. */
function person(i, { basket = true } = {}) {
  const g = new THREE.Group();
  const r = rng('person' + i);
  const skin = SKIN[Math.floor(r() * SKIN.length)];
  const wear = WEAR[Math.floor(r() * WEAR.length)];
  const pants = PANTS[Math.floor(r() * PANTS.length)];
  const hair = HAIR[Math.floor(r() * HAIR.length)];

  const legL = box(0.12, 0.55, 0.14, pants); legL.position.set(-0.08, 0.275, 0);
  const legR = legL.clone(); legR.position.x = 0.08;
  const torso = box(0.36, 0.56, 0.2, wear); torso.position.y = 0.55 + 0.28;
  const armL = box(0.09, 0.44, 0.1, wear); armL.position.set(-0.235, 0.86, 0);
  const armR = armL.clone(); armR.position.x = 0.235;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), mat(skin, { rough: 0.75 }));
  head.position.y = 1.28; head.castShadow = true;
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2), mat(hair, { rough: 0.9 }));
  cap.position.y = 1.29; cap.castShadow = true;
  g.add(legL, legR, torso, armL, armR, head, cap);

  if (basket && r() < 0.4) {
    const basket = box(0.3, 0.17, 0.2, r() < 0.5 ? 0xd94436 : 0x2e7dd1, { rough: 0.8 });
    basket.position.set(0.31, 0.5, 0.02);
    const handle = box(0.03, 0.1, 0.16, C.ink);
    handle.position.set(0.31, 0.63, 0.02);
    g.add(basket, handle);
  }
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
    ...(store.checkouts || []).map(c => ({ x: c.x, z: c.z, w: c.w + 0.8, d: c.d })),
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
let th = 0.79, ph = 0.96, zoom = 1, viewHalf = 20, camDist = 80, drag = null, target;
function orbit(canvas) {
  target = new THREE.Vector3(0, 0.9, 0);
  zoom = 1;
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
    zoom = Math.min(3, Math.max(0.55, zoom * (e.deltaY > 0 ? 0.92 : 1.09)));
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
  };
}

function resize(canvas) {
  if (!renderer) return;
  const w = canvas.clientWidth || 800, h = canvas.clientHeight || 440;
  renderer.setSize(w, h, false);
  const aspect = w / h;
  camera.left = -viewHalf * aspect;
  camera.right = viewHalf * aspect;
  camera.top = viewHalf;
  camera.bottom = -viewHalf;
  camera.zoom = zoom;
  camera.updateProjectionMatrix();
}

function loop(now) {
  raf = requestAnimationFrame(loop);
  const dt = prevT && now ? Math.min(0.05, (now - prevT) / 1000) : 0.016;
  if (now) prevT = now;
  stepCrowd(dt);
  camera.position.set(
    target.x + camDist * Math.sin(ph) * Math.sin(th),
    target.y + camDist * Math.cos(ph),
    target.z + camDist * Math.sin(ph) * Math.cos(th));
  camera.lookAt(target);
  renderer.render(scene, camera);
}
