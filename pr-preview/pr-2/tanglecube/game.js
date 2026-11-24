import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AXES, cellKey, generate } from './puzzle.js';

// ---------------------------------------------------------------------------
// Levels. Each is generated from a fixed seed, so everyone gets the same
// puzzles. fill: how much of the surface is covered, minLen/maxLen: arrow
// length in cells, twist: how often heads point across their face (longer
// runs, more tangles), straight: how often bodies keep going straight.
// ---------------------------------------------------------------------------
const LEVELS = [
  { name: 'Warm-up',     size: [3, 3, 3], fill: 0.45, minLen: 2, maxLen: 3,  twist: 0.2, straight: 0.6, seed: 3 },
  { name: 'Corners',     size: [3, 3, 3], fill: 0.75, minLen: 2, maxLen: 4,  twist: 0.4, straight: 0.5, seed: 8 },
  { name: 'Brick',       size: [4, 2, 3], fill: 0.8,  minLen: 2, maxLen: 5,  twist: 0.5, straight: 0.5, seed: 21 },
  { name: 'Four',        size: [4, 4, 4], fill: 0.8,  minLen: 2, maxLen: 5,  twist: 0.5, straight: 0.5, seed: 4 },
  { name: 'Tower',       size: [3, 6, 3], fill: 0.85, minLen: 3, maxLen: 6,  twist: 0.6, straight: 0.5, seed: 36 },
  { name: 'Wraparound',  size: [4, 4, 4], fill: 0.9,  minLen: 3, maxLen: 7,  twist: 0.7, straight: 0.4, seed: 12 },
  { name: 'Five',        size: [5, 5, 5], fill: 0.88, minLen: 3, maxLen: 7,  twist: 0.6, straight: 0.5, seed: 55 },
  { name: 'Slab',        size: [6, 2, 6], fill: 0.9,  minLen: 3, maxLen: 8,  twist: 0.7, straight: 0.5, seed: 62 },
  { name: 'Knotwork',    size: [5, 5, 5], fill: 0.92, minLen: 4, maxLen: 9,  twist: 0.8, straight: 0.4, seed: 91, tag: 'Hard' },
  { name: 'Crate',       size: [6, 4, 5], fill: 0.92, minLen: 4, maxLen: 9,  twist: 0.75, straight: 0.45, seed: 404 },
  { name: 'Six',         size: [6, 6, 6], fill: 0.93, minLen: 3, maxLen: 8, twist: 0.8, straight: 0.4, seed: 6, tag: 'Hard' },
  { name: 'Big Tangle',  size: [7, 7, 7], fill: 0.95, minLen: 3, maxLen: 9, twist: 0.9, straight: 0.4, seed: 2026, tag: 'Super hard' },
];

const MAX_LIVES = 3;
const LINE = 0.17;        // arrow line width, in cells
const LIFT = 0.012;       // how far arrows float above the cube surface

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
const css = getComputedStyle(document.documentElement);
const INK = new THREE.Color(css.getPropertyValue('--ink').trim() || '#1c1d24');
const HINT = new THREE.Color(css.getPropertyValue('--accent').trim() || '#e4572e');
const BONK = new THREE.Color('#d62f2f');

const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 300);
scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa3b5, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(4, 9, 6);
camera.add(sun); // light follows the view so every face stays readable
scene.add(camera);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.rotateSpeed = 0.85;

const world = new THREE.Group();
scene.add(world);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// One cell of the cube's surface: a soft tile with a dot in the middle.
const tileTexture = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#f3f5fa';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#e6e9f1';
  g.lineWidth = 2;
  g.strokeRect(1, 1, 62, 62);
  g.fillStyle = '#c3cad8';
  g.beginPath(); g.arc(32, 32, 3, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
})();

// ---------------------------------------------------------------------------
// Arrow paths. Each arrow is drawn as a flat ribbon through its cell centres,
// with an extra point where it folds over an edge. The same path, extended
// straight out past the head, is what the arrow slides along when it leaves.
// ---------------------------------------------------------------------------
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

function buildPath(board, arrow) {
  const pts = [];
  arrow.cells.forEach((cell, i) => {
    if (i > 0) {
      const prev = arrow.cells[i - 1];
      if (prev.n !== cell.n) {
        // Fold over the shared edge.
        const p = v3(prev.v).addScaledVector(v3(AXES[prev.n]), 0.5).addScaledVector(v3(AXES[cell.n]), 0.5);
        pts.push({ p, n: cell.n, edge: true });
      }
    }
    pts.push({ p: v3(board.center(cell)), n: cell.n, edge: false });
  });
  // Segment i runs from pts[i] to pts[i+1]; its face normal is that of the
  // cell end (an edge point belongs to both faces).
  const segN = [];
  for (let i = 0; i < pts.length - 1; i++) segN.push(pts[i].edge ? pts[i + 1].n : pts[i].n);
  const lengths = [0];
  for (let i = 1; i < pts.length; i++) lengths.push(lengths[i - 1] + pts[i].p.distanceTo(pts[i - 1].p));
  const bodyLen = lengths[lengths.length - 1];
  const head = pts[pts.length - 1];
  const far = 40;
  pts.push({ p: head.p.clone().addScaledVector(v3(AXES[arrow.dir]), far), n: head.n, edge: false });
  segN.push(head.n);
  lengths.push(bodyLen + far);
  return { pts, segN, lengths, bodyLen };
}

// Points of the path between arc lengths s0 and s1.
function slice(path, s0, s1) {
  const { pts, segN, lengths } = path;
  const at = (s) => {
    let i = 0;
    while (i < lengths.length - 2 && lengths[i + 1] < s) i++;
    const t = (s - lengths[i]) / Math.max(1e-9, lengths[i + 1] - lengths[i]);
    return { p: pts[i].p.clone().lerp(pts[i + 1].p, Math.min(1, Math.max(0, t))), seg: i };
  };
  const a = at(s0), b = at(s1);
  const out = [{ p: a.p, edge: false }];
  const normals = [];
  for (let i = a.seg + 1; i <= b.seg; i++) {
    out.push({ p: pts[i].p.clone(), edge: pts[i].edge });
    normals.push(segN[i - 1]);
  }
  out.push({ p: b.p, edge: false });
  normals.push(segN[b.seg]);
  return { out, normals };
}

const _d = new THREE.Vector3(), _s = new THREE.Vector3(), _n = new THREE.Vector3();
function ribbonGeometry(path, s, geometry) {
  const { out, normals } = slice(path, s, s + path.bodyLen);
  const pos = [];
  const hw = LINE / 2;
  const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  let lastDir = null, lastN = null;
  for (let i = 0; i < out.length - 1; i++) {
    const A = out[i], B = out[i + 1];
    _d.subVectors(B.p, A.p);
    const len = _d.length();
    if (len < 1e-6) continue;
    _d.divideScalar(len);
    _n.copy(v3(AXES[normals[i]]));
    _s.crossVectors(_n, _d).multiplyScalar(hw);
    const lift = _n.clone().multiplyScalar(LIFT);
    const a = A.p.clone().addScaledVector(_d, A.edge ? 0 : -hw).add(lift);
    const b = B.p.clone().addScaledVector(_d, B.edge ? 0 : (i === out.length - 2 ? 0 : hw)).add(lift);
    quad(
      a.clone().add(_s).toArray(), a.clone().sub(_s).toArray(),
      b.clone().sub(_s).toArray(), b.clone().add(_s).toArray(),
    );
    lastDir = _d.clone(); lastN = _n.clone();
  }
  if (lastDir) {
    // Arrow head.
    const h = out[out.length - 1].p.clone().addScaledVector(lastN, LIFT * 1.5);
    const side = new THREE.Vector3().crossVectors(lastN, lastDir).multiplyScalar(0.27);
    const tip = h.clone().addScaledVector(lastDir, 0.36);
    const base = h.clone().addScaledVector(lastDir, -0.08);
    pos.push(...tip.toArray(), ...base.clone().add(side).toArray(), ...base.clone().sub(side).toArray());
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

// ---------------------------------------------------------------------------
// Tiny tween helper
// ---------------------------------------------------------------------------
const tweens = new Set();
function tween(duration, update, done) {
  tweens.add({ start: performance.now(), duration, update, done });
}
const easeIn = (t) => t * t;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
const ui = {
  levelName: document.getElementById('levelName'),
  remaining: document.getElementById('remaining'),
  hearts: document.getElementById('hearts'),
  toast: document.getElementById('toast'),
  win: document.getElementById('winOverlay'),
  winText: document.getElementById('winText'),
  lose: document.getElementById('loseOverlay'),
  levels: document.getElementById('levelsOverlay'),
  levelGrid: document.getElementById('levelGrid'),
  next: document.getElementById('btnNext'),
};

const store = {
  get(k, fallback) {
    try { const v = localStorage.getItem('tanglecube.' + k); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(k, v) { try { localStorage.setItem('tanglecube.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

let state = null;
const solved = new Set(store.get('solved', []));
let cubeMesh = null;

function loadLevel(index) {
  index = Math.max(0, Math.min(LEVELS.length - 1, index));
  tweens.clear();
  world.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  world.clear();

  const level = LEVELS[index];
  const { board, arrows } = generate(level);
  const [A, B, C] = level.size;
  world.position.set(-(A - 1) / 2, -(B - 1) / 2, -(C - 1) / 2);

  // The cube itself, one tile per surface cell.
  const repeats = [[C, B], [C, B], [A, C], [A, C], [A, B], [A, B]];
  const mats = repeats.map(([u, v]) => {
    const map = tileTexture.clone();
    map.repeat.set(u, v);
    map.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map, roughness: 0.85, metalness: 0 });
  });
  cubeMesh = new THREE.Mesh(new THREE.BoxGeometry(A, B, C), mats);
  cubeMesh.position.set((A - 1) / 2, (B - 1) / 2, (C - 1) / 2);
  world.add(cubeMesh);

  const occ = new Map();
  const list = arrows.map((a, i) => {
    const path = buildPath(board, a);
    const material = new THREE.MeshBasicMaterial({
      color: INK.clone(), side: THREE.DoubleSide, transparent: true,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(ribbonGeometry(path, 0, new THREE.BufferGeometry()), material);
    world.add(mesh);
    const arrow = { id: i, cells: a.cells, dir: a.dir, path, mesh, busy: false, gone: false };
    a.cells.forEach((c) => occ.set(c.key, arrow));
    return arrow;
  });

  state = { index, level, board, arrows: list, occ, lives: MAX_LIVES, bonks: 0, flying: 0, over: false, hint: null };
  fitCamera();
  store.set('current', index);
  ui.win.classList.remove('show');
  ui.lose.classList.remove('show');
  updateHud();
}

function fitCamera() {
  const size = state.level.size;
  const radius = 0.5 * Math.hypot(...size) + 0.4;
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const dist = radius / Math.sin(Math.min(vfov, hfov) / 2) * 1.05;
  camera.position.set(0.55, 0.5, 0.75).normalize().multiplyScalar(dist);
  controls.target.set(0, 0, 0);
  controls.minDistance = dist * 0.4;
  controls.maxDistance = dist * 2;
  controls.update();
}

const remainingArrows = () => state.arrows.filter((a) => !a.gone);

function updateHud() {
  const tag = state.level.tag ? ` · ${state.level.tag}` : '';
  ui.levelName.textContent = `${state.index + 1}. ${state.level.name}`;
  const n = remainingArrows().length;
  ui.remaining.textContent = `${n} arrow${n === 1 ? '' : 's'} left${tag}`;
  ui.hearts.innerHTML = Array.from({ length: MAX_LIVES }, (_, i) =>
    `<span class="${i < state.lives ? '' : 'lost'}">♥</span>`).join('');
}

let toastTimer = 0;
function toast(text) {
  ui.toast.textContent = text;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 1400);
}

// Free cells in front of the head before the first other arrow, or -1 if clear.
function blocker(arrow) {
  const head = arrow.cells[arrow.cells.length - 1];
  const ray = state.board.ray(head, arrow.dir);
  for (let i = 0; i < ray.length; i++) {
    const other = state.occ.get(ray[i]);
    if (other && other !== arrow) return { gap: i, other };
  }
  return null;
}

function setColor(arrow, color) { arrow.mesh.material.color.copy(color); }

function clearHint() {
  if (!state.hint) return;
  if (!state.hint.gone) setColor(state.hint, INK);
  state.hint = null;
}

function tapArrow(arrow) {
  if (state.over || arrow.busy || arrow.gone) return;
  clearHint();
  const block = blocker(arrow);

  if (!block) {
    // Clear run: slither off the face and away.
    arrow.gone = true;
    arrow.busy = true;
    arrow.cells.forEach((c) => state.occ.delete(c.key));
    state.flying++;
    updateHud();
    const distance = arrow.path.bodyLen + 14;
    const duration = 380 + distance * 28;
    tween(duration, (t) => {
      ribbonGeometry(arrow.path, easeIn(t) * distance, arrow.mesh.geometry);
      arrow.mesh.material.opacity = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    }, () => {
      world.remove(arrow.mesh);
      arrow.mesh.geometry.dispose();
      state.flying--;
      checkWin();
    });
    return;
  }

  // Blocked: creep up to the arrow in the way, bonk, and slide back.
  arrow.busy = true;
  state.bonks++;
  state.lives--;
  updateHud();
  try { navigator.vibrate && navigator.vibrate(40); } catch { /* ignore */ }
  setColor(arrow, BONK);
  setColor(block.other, BONK);
  const reach = block.gap + 0.22;
  tween(Math.max(140, block.gap * 70 + 120), (t) => {
    ribbonGeometry(arrow.path, easeOut(t) * reach, arrow.mesh.geometry);
  }, () => {
    tween(280, (t) => {
      ribbonGeometry(arrow.path, (1 - easeOut(t)) * reach, arrow.mesh.geometry);
    }, () => {
      ribbonGeometry(arrow.path, 0, arrow.mesh.geometry);
      arrow.busy = false;
      setColor(arrow, INK);
      if (!block.other.gone) setColor(block.other, INK);
      if (state.lives <= 0) {
        state.over = true;
        ui.lose.classList.add('show');
      }
    });
  });
  if (state.lives > 0) toast('Bonk! Something is in the way.');
}

function checkWin() {
  if (state.over || remainingArrows().length || state.flying) return;
  state.over = true;
  solved.add(state.index);
  store.set('solved', [...solved]);
  const last = state.index === LEVELS.length - 1;
  const flawless = state.bonks === 0 ? ' Flawless, no bonks.' : '';
  ui.winText.textContent = last
    ? `That was the last one. You untangled all ${LEVELS.length} cubes!${flawless}`
    : `${state.arrows.length} arrows untangled.${flawless}`;
  ui.next.textContent = last ? 'Back to level 1' : 'Next level';
  const won = state;
  setTimeout(() => { if (state === won) ui.win.classList.add('show'); }, 250);
}

function headNormalWorld(arrow) {
  return v3(AXES[arrow.cells[arrow.cells.length - 1].n]);
}

function showHint() {
  if (state.over) return;
  clearHint();
  const free = remainingArrows().filter((a) => !a.busy && !blocker(a));
  if (!free.length) return;
  // Prefer arrows on faces turned toward the camera.
  const view = camera.position.clone().normalize();
  free.sort((a, b) => headNormalWorld(b).dot(view) - headNormalWorld(a).dot(view));
  state.hint = free[0];
  if (headNormalWorld(free[0]).dot(view) < 0.2) toast('Try turning the cube.');
}

// ---------------------------------------------------------------------------
// Input: a short press without much movement is a tap; anything else turns
// the cube. A tap picks the surface cell under the finger, or the nearest
// arrow cell next to it, since arrows are thin.
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function arrowAt(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObject(cubeMesh, false)[0];
  if (!hit) return null;
  const p = world.worldToLocal(hit.point.clone());
  const fn = hit.face.normal;
  const n = AXES.findIndex((a) => a[0] === Math.round(fn.x) && a[1] === Math.round(fn.y) && a[2] === Math.round(fn.z));
  const size = state.level.size;
  const v = [0, 1, 2].map((i) => Math.min(size[i] - 1, Math.max(0, Math.round(p.getComponent(i) - AXES[n][i] * 0.5))));
  const direct = state.occ.get(cellKey(v, n));
  if (direct) return direct;
  // Look at the neighbouring cells on the same face for a close miss.
  let best = null, bestDist = 0.85;
  for (const t of [0, 1, 2, 3, 4, 5]) {
    if ((t >> 1) === (n >> 1)) continue;
    const v2 = v.map((x, i) => x + AXES[t][i]);
    const a = state.occ.get(cellKey(v2, n));
    if (!a) continue;
    const c = new THREE.Vector3(...v2).addScaledVector(v3(AXES[n]), 0.5);
    const dist = c.distanceTo(p);
    if (dist < bestDist) { best = a; bestDist = dist; }
  }
  return best;
}

const downs = new Map();
renderer.domElement.addEventListener('pointerdown', (e) => {
  downs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), multi: downs.size > 0 });
  if (downs.size > 1) for (const d of downs.values()) d.multi = true;
});
renderer.domElement.addEventListener('pointercancel', (e) => downs.delete(e.pointerId));
renderer.domElement.addEventListener('pointerup', (e) => {
  const d = downs.get(e.pointerId);
  downs.delete(e.pointerId);
  if (!d || d.multi || !state) return;
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || performance.now() - d.t > 500) return;
  const arrow = arrowAt(e.clientX, e.clientY);
  if (arrow) tapArrow(arrow);
});

// ---------------------------------------------------------------------------
// Buttons and level picker
// ---------------------------------------------------------------------------
function renderLevelGrid() {
  const unlocked = Math.max(0, ...[...solved].map((i) => i + 1));
  ui.levelGrid.innerHTML = '';
  LEVELS.forEach((lvl, i) => {
    const b = document.createElement('button');
    b.textContent = String(i + 1);
    b.title = lvl.name + (lvl.tag ? ` (${lvl.tag})` : '');
    b.disabled = i > unlocked;
    if (solved.has(i)) b.classList.add('done');
    if (state && i === state.index) b.classList.add('current');
    b.addEventListener('click', () => { ui.levels.classList.remove('show'); loadLevel(i); });
    ui.levelGrid.appendChild(b);
  });
}

function zoomBy(factor) {
  const dist = camera.position.length() * factor;
  camera.position.setLength(Math.min(controls.maxDistance, Math.max(controls.minDistance, dist)));
}

document.getElementById('btnLevels').addEventListener('click', () => { renderLevelGrid(); ui.levels.classList.add('show'); });
document.getElementById('btnCloseLevels').addEventListener('click', () => ui.levels.classList.remove('show'));
document.getElementById('btnRestart').addEventListener('click', () => loadLevel(state.index));
document.getElementById('btnHint').addEventListener('click', showHint);
document.getElementById('btnView').addEventListener('click', fitCamera);
document.getElementById('btnZoomIn').addEventListener('click', () => zoomBy(0.85));
document.getElementById('btnZoomOut').addEventListener('click', () => zoomBy(1 / 0.85));
document.getElementById('btnRetry').addEventListener('click', () => loadLevel(state.index));
document.getElementById('btnReplay').addEventListener('click', () => loadLevel(state.index));
ui.next.addEventListener('click', () => loadLevel(state.index === LEVELS.length - 1 ? 0 : state.index + 1));
ui.levels.addEventListener('click', (e) => { if (e.target === ui.levels) ui.levels.classList.remove('show'); });

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
function frame(now) {
  for (const tw of [...tweens]) {
    const t = Math.min(1, (now - tw.start) / tw.duration);
    tw.update(t);
    if (t >= 1) { tweens.delete(tw); tw.done && tw.done(); }
  }
  if (state && state.hint && !state.hint.gone) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 140);
    state.hint.mesh.material.color.copy(INK).lerp(HINT, 0.35 + 0.65 * pulse);
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

loadLevel(store.get('current', 0));
if (!store.get('seenHelp', false)) {
  store.set('seenHelp', true);
  renderLevelGrid();
  ui.levels.classList.add('show');
}
requestAnimationFrame(frame);

// Handy for testing from the console: screen position of a visible arrow
// that can (free = true) or cannot (free = false) leave right now.
function findTappable(free = true) {
  for (const a of remainingArrows()) {
    if (a.busy || !blocker(a) !== free) continue;
    for (const c of a.cells) {
      const p = world.localToWorld(v3(state.board.center(c))).project(camera);
      const x = (p.x + 1) / 2 * window.innerWidth, y = (1 - p.y) / 2 * window.innerHeight;
      if (p.z < 1 && arrowAt(x, y) === a) return { x, y };
    }
  }
  return null;
}
window.tanglecube = { get state() { return state; }, LEVELS, loadLevel, findTappable, camera, controls };
