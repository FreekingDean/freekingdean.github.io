import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ---------------------------------------------------------------------------
// Directions: each block slides along one of the six axis directions.
// ---------------------------------------------------------------------------
const DIRS = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];
// One color per direction, so opposite arrows are easy to tell apart.
const DIR_COLORS = ['#e4572e', '#f2a541', '#4ea5d9', '#2a6f97', '#57b77d', '#8c6bc8'];

// ---------------------------------------------------------------------------
// Levels. Each one is generated from a seed, so it is the same every time.
//   size: grid dimensions, mask: which cells are part of the shape,
//   twist: 0..1, how often blocks point inward (higher = more tangled).
// ---------------------------------------------------------------------------
const all = () => true;
const LEVELS = [
  { name: 'Pebble',   size: [2, 2, 2], twist: 0.2,  seed: 11, mask: all },
  { name: 'Brick',    size: [3, 2, 2], twist: 0.35, seed: 23, mask: all },
  { name: 'Slab',     size: [4, 1, 4], twist: 0.5,  seed: 5,  mask: all },
  { name: 'Cube',     size: [3, 3, 3], twist: 0.45, seed: 42, mask: all },
  { name: 'Jack',     size: [5, 5, 5], twist: 0.6,  seed: 99,
    mask: (x, y, z) => Math.abs(x - 2) + Math.abs(y - 2) + Math.abs(z - 2) <= 2 },
  { name: 'Tower',    size: [2, 5, 2], twist: 0.6,  seed: 7,  mask: all },
  { name: 'Arch',     size: [5, 4, 3], twist: 0.7,  seed: 8,
    mask: (x, y) => !(y < 2 && x >= 1 && x <= 3) },
  { name: 'Ziggurat', size: [5, 3, 5], twist: 0.65, seed: 31,
    mask: (x, y, z) => Math.abs(x - 2) <= 2 - y && Math.abs(z - 2) <= 2 - y },
  { name: 'Big Cube', size: [4, 4, 4], twist: 0.6,  seed: 17, mask: all },
  { name: 'Ring',     size: [6, 2, 6], twist: 0.75, seed: 64,
    mask: (x, y, z) => !(x >= 2 && x <= 3 && z >= 2 && z <= 3) },
  { name: 'Hive',     size: [4, 4, 4], twist: 0.85, seed: 77, mask: all },
  { name: 'Monolith', size: [5, 5, 5], twist: 0.85, seed: 2026, mask: all },
];

const MAX_LIVES = 3;

// ---------------------------------------------------------------------------
// Puzzle generation. We fill cells in random order and only give a cell a
// direction whose path to the edge is clear of cells placed *before* it.
// Removing blocks in reverse placement order then always works, so every
// level is solvable, and since removing a block never blocks anything,
// you can never paint yourself into a corner.
// ---------------------------------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const key = (x, y, z) => `${x},${y},${z}`;

function inBounds(size, x, y, z) {
  return x >= 0 && y >= 0 && z >= 0 && x < size[0] && y < size[1] && z < size[2];
}

function rayCells(size, x, y, z, d) {
  const out = [];
  let cx = x + DIRS[d][0], cy = y + DIRS[d][1], cz = z + DIRS[d][2];
  while (inBounds(size, cx, cy, cz)) {
    out.push(key(cx, cy, cz));
    cx += DIRS[d][0]; cy += DIRS[d][1]; cz += DIRS[d][2];
  }
  return out;
}

function generate(level) {
  const rng = mulberry32(level.seed);
  const { size, mask } = level;
  const cells = [];
  for (let x = 0; x < size[0]; x++)
    for (let y = 0; y < size[1]; y++)
      for (let z = 0; z < size[2]; z++)
        if (mask(x, y, z)) cells.push([x, y, z]);
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  const placed = new Map();
  for (const [x, y, z] of cells) {
    const options = [];
    for (let d = 0; d < 6; d++) {
      const ray = rayCells(size, x, y, z, d);
      if (ray.every((k) => !placed.has(k))) options.push({ d, len: ray.length });
    }
    if (!options.length) continue; // fully boxed in: leave a hidden hole
    let pick;
    if (rng() < level.twist) {
      const longest = Math.max(...options.map((o) => o.len));
      const best = options.filter((o) => o.len === longest);
      pick = best[Math.floor(rng() * best.length)];
    } else {
      pick = options[Math.floor(rng() * options.length)];
    }
    placed.set(key(x, y, z), { x, y, z, d: pick.d });
  }
  return [...placed.values()];
}

// ---------------------------------------------------------------------------
// Textures: arrows drawn on the four side faces, a target on the front face.
// ---------------------------------------------------------------------------
const TEX = 128;
const texCache = new Map();

function faceCanvas(color) {
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, TEX, TEX);
  g.strokeStyle = 'rgba(0,0,0,0.18)';
  g.lineWidth = 6;
  g.strokeRect(3, 3, TEX - 6, TEX - 6);
  return { c, g };
}

function makeTexture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// angle: direction of the arrow in canvas space (radians, 0 = right).
function arrowTexture(color, angle) {
  const k = `a|${color}|${angle.toFixed(2)}`;
  if (texCache.has(k)) return texCache.get(k);
  const { c, g } = faceCanvas(color);
  g.translate(TEX / 2, TEX / 2);
  g.rotate(angle);
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(40, 0);
  g.lineTo(6, -30);
  g.lineTo(6, -12);
  g.lineTo(-38, -12);
  g.lineTo(-38, 12);
  g.lineTo(6, 12);
  g.lineTo(6, 30);
  g.closePath();
  g.fill();
  const t = makeTexture(c);
  texCache.set(k, t);
  return t;
}

function frontTexture(color) {
  const k = `f|${color}`;
  if (texCache.has(k)) return texCache.get(k);
  const { c, g } = faceCanvas(color);
  g.strokeStyle = '#fff';
  g.lineWidth = 10;
  g.beginPath(); g.arc(TEX / 2, TEX / 2, 34, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(TEX / 2, TEX / 2, 13, 0, Math.PI * 2); g.fill();
  const t = makeTexture(c);
  texCache.set(k, t);
  return t;
}

function backTexture(color) {
  const k = `b|${color}`;
  if (texCache.has(k)) return texCache.get(k);
  const { c, g } = faceCanvas(color);
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 8;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(44, 44); g.lineTo(84, 84);
  g.moveTo(84, 44); g.lineTo(44, 84);
  g.stroke();
  const t = makeTexture(c);
  texCache.set(k, t);
  return t;
}

// Work out, for each face of a BoxGeometry, its normal and which world
// directions its texture's u and v axes run along.
const BLOCK = 0.9;
const boxGeo = new THREE.BoxGeometry(BLOCK, BLOCK, BLOCK);
const FACE_FRAMES = (() => {
  const pos = boxGeo.attributes.position;
  const uv = boxGeo.attributes.uv;
  const frames = [];
  for (let f = 0; f < 6; f++) {
    const verts = [];
    for (let i = 0; i < 4; i++) {
      const vi = f * 4 + i;
      verts.push({
        p: new THREE.Vector3().fromBufferAttribute(pos, vi),
        u: uv.getX(vi), v: uv.getY(vi),
      });
    }
    const find = (u, v) => verts.find((q) => Math.abs(q.u - u) < 1e-6 && Math.abs(q.v - v) < 1e-6).p;
    const o = find(0, 0);
    const uDir = find(1, 0).clone().sub(o).normalize();
    const vDir = find(0, 1).clone().sub(o).normalize();
    const normal = new THREE.Vector3().crossVectors(uDir, vDir).normalize();
    frames.push({ uDir, vDir, normal });
  }
  return frames;
})();

const matCache = new Map();
function materialsFor(d) {
  if (matCache.has(d)) return matCache.get(d);
  const color = DIR_COLORS[d];
  const dv = new THREE.Vector3(...DIRS[d]);
  const mats = FACE_FRAMES.map(({ uDir, vDir, normal }) => {
    let map;
    const n = normal.dot(dv);
    if (n > 0.5) map = frontTexture(color);
    else if (n < -0.5) map = backTexture(color);
    else {
      const a = dv.dot(uDir);
      const b = dv.dot(vDir);
      // Canvas y points down while texture v points up.
      map = arrowTexture(color, Math.atan2(-b, a));
    }
    return new THREE.MeshStandardMaterial({ map, roughness: 0.55, metalness: 0.05 });
  });
  matCache.set(d, mats);
  return mats;
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a6a, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(5, 9, 7);
scene.add(sun);
const fill = new THREE.DirectionalLight(0xffffff, 0.5);
fill.position.set(-6, -3, -5);
scene.add(fill);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.rotateSpeed = 0.9;

const world = new THREE.Group();
scene.add(world);

// Back the camera off far enough that the whole stack fits on screen,
// whichever of width or height is tighter.
function fitDistance() {
  const size = state ? state.size : [3, 3, 3];
  const radius = 0.5 * Math.hypot(...size) + 0.3;
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  return radius / Math.sin(Math.min(vfov, hfov) / 2) * 1.08;
}

function fitCamera() {
  const dist = fitDistance();
  camera.position.set(0.62, 0.5, 0.78).normalize().multiplyScalar(dist);
  controls.minDistance = dist * 0.45;
  controls.maxDistance = dist * 2;
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------------------
// Tiny tween helper
// ---------------------------------------------------------------------------
const tweens = new Set();
function tween(duration, update, done) {
  tweens.add({ start: performance.now(), duration, update, done });
}
const easeIn = (t) => t * t * t;
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
    try { const v = localStorage.getItem('slipstack.' + k); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(k, v) { try { localStorage.setItem('slipstack.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

let state = null;
let solved = new Set(store.get('solved', []));

function loadLevel(index) {
  index = Math.max(0, Math.min(LEVELS.length - 1, index));
  if (state) for (const b of state.blocks.values()) world.remove(b.mesh);
  tweens.clear();
  world.clear();
  const level = LEVELS[index];
  const size = level.size;
  const offset = size.map((n) => (n - 1) / 2);
  const blocks = new Map();
  for (const cell of generate(level)) {
    const mesh = new THREE.Mesh(boxGeo, materialsFor(cell.d));
    mesh.position.set(cell.x - offset[0], cell.y - offset[1], cell.z - offset[2]);
    const block = { ...cell, mesh, busy: false };
    mesh.userData.block = block;
    world.add(mesh);
    blocks.set(key(cell.x, cell.y, cell.z), block);
  }
  state = { index, level, size, blocks, lives: MAX_LIVES, moves: 0, mistakes: 0, flying: 0, over: false, hint: null };

  fitCamera();
  controls.target.set(0, 0, 0);
  controls.update();

  store.set('current', index);
  ui.win.classList.remove('show');
  ui.lose.classList.remove('show');
  updateHud();
}

function updateHud() {
  ui.levelName.textContent = `${state.index + 1}. ${state.level.name}`;
  ui.remaining.textContent = `${state.blocks.size} block${state.blocks.size === 1 ? '' : 's'} left`;
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

// Returns the number of free cells before the first blocker, or -1 if the path is clear.
function blockerDistance(block) {
  const ray = rayCells(state.size, block.x, block.y, block.z, block.d);
  for (let i = 0; i < ray.length; i++) if (state.blocks.has(ray[i])) return i;
  return -1;
}

function clearHint() {
  if (!state.hint) return;
  state.hint.mesh.material = state.hint.original;
  state.hint.mesh.scale.setScalar(1);
  state.hint = null;
}

function tapBlock(block) {
  if (state.over || block.busy) return;
  clearHint();
  const dv = new THREE.Vector3(...DIRS[block.d]);
  const start = block.mesh.position.clone();
  const gap = blockerDistance(block);

  if (gap === -1) {
    // Clear path: fly away.
    state.blocks.delete(key(block.x, block.y, block.z));
    block.busy = true;
    state.flying++;
    state.moves++;
    updateHud();
    const travel = 18;
    tween(520, (t) => {
      const e = easeIn(t);
      block.mesh.position.copy(start).addScaledVector(dv, e * travel);
      block.mesh.scale.setScalar(1 - 0.6 * e);
    }, () => {
      world.remove(block.mesh);
      state.flying--;
      checkWin();
    });
    return;
  }

  // Blocked: slide up to the blocker, bonk, and come back.
  block.busy = true;
  state.mistakes++;
  state.lives--;
  updateHud();
  try { navigator.vibrate && navigator.vibrate(40); } catch { /* ignore */ }
  const reach = gap + 0.12;
  tween(Math.max(140, gap * 70), (t) => {
    block.mesh.position.copy(start).addScaledVector(dv, easeOut(t) * reach);
  }, () => {
    tween(260, (t) => {
      const wobble = Math.sin(t * Math.PI * 4) * 0.06 * (1 - t);
      block.mesh.position.copy(start).addScaledVector(dv, (1 - easeOut(t)) * reach + wobble);
    }, () => {
      block.mesh.position.copy(start);
      block.busy = false;
      if (state.lives <= 0) {
        state.over = true;
        ui.lose.classList.add('show');
      }
    });
  });
  if (state.lives > 0) toast('Bonk! Something is in the way.');
}

function checkWin() {
  if (state.over || state.blocks.size || state.flying) return;
  state.over = true;
  solved.add(state.index);
  store.set('solved', [...solved]);
  const last = state.index === LEVELS.length - 1;
  const perfect = state.mistakes === 0 ? ' Flawless, no bonks.' : '';
  ui.winText.textContent = last
    ? `That was the last one. You cleared all ${LEVELS.length} stacks!${perfect}`
    : `${state.moves} blocks out.${perfect}`;
  ui.next.textContent = last ? 'Back to level 1' : 'Next level';
  setTimeout(() => ui.win.classList.add('show'), 250);
}

function showHint() {
  if (state.over) return;
  clearHint();
  const free = [...state.blocks.values()].filter((b) => !b.busy && blockerDistance(b) === -1);
  if (!free.length) return;
  // Prefer blocks facing the camera so the hint is visible.
  const camDir = camera.position.clone().normalize();
  free.sort((a, b) => b.mesh.position.dot(camDir) - a.mesh.position.dot(camDir));
  const block = free[0];
  // Give the hinted block its own glowing copy of its materials.
  const original = block.mesh.material;
  const glowing = original.map((m) => { const c = m.clone(); c.emissive = new THREE.Color(0xffffff); return c; });
  block.mesh.material = glowing;
  state.hint = { mesh: block.mesh, original, glowing };
}

// ---------------------------------------------------------------------------
// Input: a short press without much movement is a tap; anything else orbits.
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const downs = new Map();

renderer.domElement.addEventListener('pointerdown', (e) => {
  downs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), multi: downs.size > 0 });
  if (downs.size > 1) for (const d of downs.values()) d.multi = true;
});
renderer.domElement.addEventListener('pointercancel', (e) => downs.delete(e.pointerId));
renderer.domElement.addEventListener('pointerup', (e) => {
  const d = downs.get(e.pointerId);
  downs.delete(e.pointerId);
  if (!d || d.multi) return;
  const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
  if (moved > 8 || performance.now() - d.t > 500) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const meshes = [...state.blocks.values()].map((b) => b.mesh);
  const hit = raycaster.intersectObjects(meshes, false)[0];
  if (hit) tapBlock(hit.object.userData.block);
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
    b.title = lvl.name;
    b.disabled = i > unlocked;
    if (solved.has(i)) b.classList.add('done');
    if (state && i === state.index) b.classList.add('current');
    b.addEventListener('click', () => { ui.levels.classList.remove('show'); loadLevel(i); });
    ui.levelGrid.appendChild(b);
  });
}

document.getElementById('btnLevels').addEventListener('click', () => { renderLevelGrid(); ui.levels.classList.add('show'); });
document.getElementById('btnCloseLevels').addEventListener('click', () => ui.levels.classList.remove('show'));
document.getElementById('btnRestart').addEventListener('click', () => loadLevel(state.index));
document.getElementById('btnHint').addEventListener('click', showHint);
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
  if (state && state.hint) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 150);
    for (const m of state.hint.glowing) m.emissiveIntensity = 0.15 + 0.35 * pulse;
    state.hint.mesh.scale.setScalar(1 + 0.06 * pulse);
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

// Handy for testing in the console: finds a visible block (free or blocked)
// and returns where it sits on screen.
function findTappable(free = true) {
  const meshes = [...state.blocks.values()].map((b) => b.mesh);
  for (const b of state.blocks.values()) {
    if (b.busy || (blockerDistance(b) === -1) !== free) continue;
    const p = b.mesh.getWorldPosition(new THREE.Vector3()).project(camera);
    raycaster.setFromCamera(new THREE.Vector2(p.x, p.y), camera);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    if (hit && hit.object === b.mesh) {
      return { x: (p.x + 1) / 2 * window.innerWidth, y: (1 - p.y) / 2 * window.innerHeight };
    }
  }
  return null;
}
window.slipstack = { get state() { return state; }, loadLevel, LEVELS, findTappable, camera, controls };
