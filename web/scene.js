// 3D floor. Built from the same store spec the simulator scores, so what you orbit around
// and what the numbers describe are the same object.
import * as THREE from 'three';

let renderer, scene, camera, store, root, promoGroup, raf = 0;

const C = {
  floor: 0xe4e1db, wall: 0xf7f5f2, fixture: 0xd3cec5, fixtureTop: 0xa9a299,
  cool: 0xa9c0c9, produce: 0x7f9154, ink: 0x15161a, accent: 0x1c6f5a,
  checkout: 0xc9c3b8, shelf: 0xefece6, pad: 0xdbd7d0,
};

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
  const S = store.size;

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf7f5f2);
  scene.fog = new THREE.Fog(0xf7f5f2, 46, 96);

  camera = new THREE.PerspectiveCamera(42, 2, 0.1, 400);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc9bf, 1.55));
  const key = new THREE.DirectionalLight(0xfff6e8, 2.1);
  key.position.set(-18, 30, 16);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const ext = Math.max(S.w, S.d);
  Object.assign(key.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 90 });
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35);
  fill.position.set(20, 14, -12);
  scene.add(fill);

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
  const wh = 1.5;
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
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(z.w + 1.1, z.d + 1.1),
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

  for (const p of store.posters || []) {
    const m = poster(p.text, p.w, p.h);
    m.position.set(p.x, 2.0, p.z);
    if (p.x < 1.5) m.rotation.y = Math.PI / 2;
    else if (p.x > store.size.w - 1.5) m.rotation.y = -Math.PI / 2;
    root.add(m);
  }

  promoGroup = new THREE.Group();
  root.add(promoGroup);
}

/** Redraw just the contested positions: what is stacked where, and how hot it is. */
export function updateScene(plan, sc) {
  if (!promoGroup) return;
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

// --------------------------------------------------------- camera control
let th = -0.58, ph = 0.78, dist = 31, drag = null, target;
function orbit(canvas) {
  target = new THREE.Vector3(0, 0.9, 0);
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

function loop() {
  raf = requestAnimationFrame(loop);
  if (!drag) th += 0.0009;
  camera.position.set(
    target.x + dist * Math.sin(ph) * Math.sin(th),
    target.y + dist * Math.cos(ph),
    target.z + dist * Math.sin(ph) * Math.cos(th));
  camera.lookAt(target);
  renderer.render(scene, camera);
}
