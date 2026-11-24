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
  { name: 'Six',         size: [6, 6, 6], fill: 0.93, minLen: 3, maxLen: 8,  twist: 0.8, straight: 0.4, seed: 6, tag: 'Hard' },
  { name: 'Big Tangle',  size: [7, 7, 7], fill: 0.95, minLen: 3, maxLen: 9,  twist: 0.9, straight: 0.4, seed: 2026, tag: 'Super hard' },
  bigLevel('Ten',     10,  1010),
  bigLevel('Sixteen', 16,  1616),
  bigLevel('Quarter', 25,  2525),
  bigLevel('Forty',   40,  4040, 'Huge'),
  bigLevel('Sixty-four', 64, 6464, 'Huge'),
  bigLevel('Hundred', 100, 100100, 'Colossal'),
];

// Settings for an n x n x n cube. Arrows get longer as the cube grows so big
// cubes aren't a slog of tiny ones: the shortest arrow is half the cube's
// width at 25, a third at 50 and a quarter at 100, i.e. n / (1 + log2(n / 12.5)),
// and never more than half. You also get more hearts on big cubes.
function minLength(n) {
  return Math.max(3, Math.round(n * Math.min(0.5, 1 / (1 + Math.log2(n / 12.5)))));
}

function bigLevel(name, n, seed, tag) {
  const minLen = minLength(n);
  return {
    name, seed, tag,
    size: [n, n, n],
    fill: 0.92,
    minLen,
    maxLen: Math.max(minLen + 4, Math.round(minLen * 2)),
    strictMin: true,
    twist: 0.8,
    straight: 0.45,
    samples: Math.min(24, 4 + Math.floor(n / 6)),
    lives: n < 10 ? 3 : Math.min(10, 3 + Math.floor(n / 14)),
  };
}

const LINE = 0.17;        // arrow line width, in cells
const LIFT = 0.012;       // how far arrows float above the cube surface
const CURVE = 0.5;        // radius of the bends, in cells
const ARC_STEPS = 6;

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

// Orbit controls only turn the cube. Zoom is handled below as a height above
// the surface, so you can get right up close even on a 100-wide cube.
const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.enableZoom = false;
controls.enableDamping = true;
controls.dampingFactor = 0.12;

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

// ---------------------------------------------------------------------------
// Arrow paths. The chain of cell centres is turned into a smooth curve: each
// bend becomes a quarter circle, and where an arrow wraps over an edge it
// folds flat around it. The same curve, extended straight out past the head,
// is what the arrow slides along when it leaves.
// ---------------------------------------------------------------------------
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

function buildPath(board, arrow) {
  // Raw points: cell centres, plus a point on the edge wherever it folds.
  const raw = [];
  arrow.cells.forEach((cell, i) => {
    const prev = arrow.cells[i - 1];
    if (prev && prev.n !== cell.n) {
      const p = v3(prev.v).addScaledVector(v3(AXES[prev.n]), 0.5).addScaledVector(v3(AXES[cell.n]), 0.5);
      raw.push({ p, edge: true, n: cell.n });
    }
    raw.push({ p: v3(board.center(cell)), edge: false, n: cell.n });
  });
  // A segment lies on the face of its cell-centre end.
  const rawN = [];
  for (let i = 0; i < raw.length - 1; i++) rawN.push(raw[i].edge ? raw[i + 1].n : raw[i].n);

  const pts = [raw[0].p.clone()];
  const segN = [];
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    const next = raw[i + 1];
    if (next && !r.edge) {
      const a = r.p.clone().sub(raw[i - 1].p).normalize();
      const b = next.p.clone().sub(r.p).normalize();
      if (a.dot(b) < 0.5) {
        // Round the corner with a quarter circle.
        const c = r.p.clone().addScaledVector(a, -CURVE).addScaledVector(b, CURVE);
        for (let k = 0; k <= ARC_STEPS; k++) {
          const t = (k / ARC_STEPS) * Math.PI / 2;
          pts.push(c.clone().addScaledVector(b, -CURVE * Math.cos(t)).addScaledVector(a, CURVE * Math.sin(t)));
          segN.push(k === 0 ? rawN[i - 1] : r.n);
        }
        continue;
      }
    }
    pts.push(r.p.clone());
    segN.push(rawN[i - 1]);
  }
  const lengths = [0];
  for (let i = 1; i < pts.length; i++) lengths.push(lengths[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const bodyLen = lengths[lengths.length - 1];
  const head = pts[pts.length - 1];
  const far = 60 + Math.max(...board.size);
  pts.push(head.clone().addScaledVector(v3(AXES[arrow.dir]), far));
  segN.push(arrow.cells[arrow.cells.length - 1].n);
  lengths.push(bodyLen + far);
  return { pts, segN, lengths, bodyLen };
}

// Points of the path between arc lengths s0 and s1, with segment normals.
function slice(path, s0, s1) {
  const { pts, segN, lengths } = path;
  const seek = (s) => {
    let lo = 0, hi = lengths.length - 2;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lengths[mid] <= s) lo = mid; else hi = mid - 1; }
    const t = (s - lengths[lo]) / Math.max(1e-9, lengths[lo + 1] - lengths[lo]);
    return { p: pts[lo].clone().lerp(pts[lo + 1], Math.min(1, Math.max(0, t))), seg: lo };
  };
  const a = seek(s0), b = seek(s1);
  const out = [a.p];
  const normals = [];
  for (let i = a.seg + 1; i <= b.seg; i++) {
    if (pts[i].distanceToSquared(out[out.length - 1]) > 1e-10) { out.push(pts[i].clone()); normals.push(segN[i - 1]); }
  }
  if (b.p.distanceToSquared(out[out.length - 1]) > 1e-10) { out.push(b.p); normals.push(segN[b.seg]); }
  return { out, normals };
}

// Triangles for a flat ribbon with an arrow head, pushed onto `pos`.
const NORMALS = AXES.map(v3);
function ribbon(path, s, pos) {
  const { out, normals } = slice(path, s, s + path.bodyLen);
  if (out.length < 2) return;
  const hw = LINE / 2;
  const dirs = [], sides = [];
  for (let i = 0; i < out.length - 1; i++) {
    const d = out[i + 1].clone().sub(out[i]).normalize();
    dirs.push(d);
    sides.push(new THREE.Vector3().crossVectors(NORMALS[normals[i]], d).normalize());
  }
  const left = [], right = [];
  for (let i = 0; i < out.length; i++) {
    const sa = sides[Math.max(0, i - 1)], sb = sides[Math.min(sides.length - 1, i)];
    const side = sa.clone().add(sb).normalize();
    const scale = hw / Math.max(0.4, side.dot(sb));
    const na = NORMALS[normals[Math.max(0, i - 1)]], nb = NORMALS[normals[Math.min(normals.length - 1, i)]];
    const lift = na.clone().add(nb).normalize().multiplyScalar(LIFT * (na === nb ? 1 : 1.4));
    const p = out[i].clone().add(lift);
    if (i === 0) p.addScaledVector(dirs[0], -hw); // square tail
    left.push(p.clone().addScaledVector(side, scale));
    right.push(p.clone().addScaledVector(side, -scale));
  }
  for (let i = 0; i < out.length - 1; i++) {
    const a = left[i], b = right[i], c = right[i + 1], d = left[i + 1];
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
  }
  // Arrow head.
  const last = out.length - 1;
  const dir = dirs[dirs.length - 1], n = NORMALS[normals[normals.length - 1]];
  const h = out[last].clone().addScaledVector(n, LIFT * 1.5);
  const side = sides[sides.length - 1].clone().multiplyScalar(0.27);
  const tip = h.clone().addScaledVector(dir, 0.36);
  const base = h.clone().addScaledVector(dir, -0.08);
  const b1 = base.clone().add(side), b2 = base.clone().sub(side);
  pos.push(tip.x, tip.y, tip.z, b1.x, b1.y, b1.z, b2.x, b2.y, b2.z);
}

// ---------------------------------------------------------------------------
// All resting arrows share one big mesh, so even thousands of them draw in a
// single call. An arrow that is moving is hidden there and drawn on its own.
// ---------------------------------------------------------------------------
const arrowMaterial = new THREE.MeshBasicMaterial({
  vertexColors: true, side: THREE.DoubleSide,
  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
});

function buildBatch(list) {
  const chunks = list.map((a) => { const pos = []; ribbon(a.path, 0, pos); return pos; });
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const positions = new Float32Array(total);
  const colors = new Float32Array(total);
  let offset = 0;
  list.forEach((a, i) => {
    positions.set(chunks[i], offset);
    a.range = { start: offset, count: chunks[i].length };
    a.rest = Float32Array.from(chunks[i]);
    offset += chunks[i].length;
  });
  for (let i = 0; i < total; i += 3) { colors[i] = INK.r; colors[i + 1] = INK.g; colors[i + 2] = INK.b; }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, arrowMaterial);
  mesh.frustumCulled = false;
  return mesh;
}

function touch(attr, range) {
  if (attr.addUpdateRange) attr.addUpdateRange(range.start, range.count);
  attr.needsUpdate = true;
}

function setVisible(arrow, visible) {
  const attr = state.batch.geometry.attributes.position;
  if (visible) attr.array.set(arrow.rest, arrow.range.start);
  else attr.array.fill(0, arrow.range.start, arrow.range.start + arrow.range.count);
  touch(attr, arrow.range);
}

function setColor(arrow, color) {
  const attr = state.batch.geometry.attributes.color;
  const arr = attr.array;
  for (let i = arrow.range.start; i < arrow.range.start + arrow.range.count; i += 3) {
    arr[i] = color.r; arr[i + 1] = color.g; arr[i + 2] = color.b;
  }
  touch(attr, arrow.range);
}

// A standalone mesh for an arrow in motion.
function movingMesh(arrow, color) {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
    color, side: THREE.DoubleSide, transparent: true,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  }));
  mesh.frustumCulled = false;
  mesh.userData.place = (s) => {
    const pos = [];
    ribbon(arrow.path, s, pos);
    mesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  };
  mesh.userData.place(0);
  world.add(mesh);
  return mesh;
}

function dropMesh(mesh) {
  world.remove(mesh);
  mesh.geometry.dispose();
  mesh.material.dispose();
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
const $ = (id) => document.getElementById(id);
const ui = {
  levelName: $('levelName'), remaining: $('remaining'), hearts: $('hearts'), toast: $('toast'),
  win: $('winOverlay'), winText: $('winText'), lose: $('loseOverlay'),
  levels: $('levelsOverlay'), levelGrid: $('levelGrid'), next: $('btnNext'),
  loading: $('loading'), loadingText: $('loadingText'),
  customSize: $('customSize'), customOut: $('customOut'),
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

// index: a level number, or -1 for a custom cube described by `custom`.
function loadLevel(index, custom) {
  const level = custom || LEVELS[Math.max(0, Math.min(LEVELS.length - 1, index))];
  if (!custom) index = LEVELS.indexOf(level);
  const n = level.size[0] * level.size[1] * level.size[2];
  if (n > 3000) {
    // Big cubes take a moment to build; say so before the page stalls.
    ui.loadingText.textContent = `Building a ${level.size.join('×')} cube…`;
    ui.loading.classList.add('show');
    requestAnimationFrame(() => requestAnimationFrame(() => { build(index, level); ui.loading.classList.remove('show'); }));
  } else {
    build(index, level);
  }
}

function build(index, level) {
  tweens.clear();
  world.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  world.clear();

  const { board, arrows } = generate(level);
  const [A, B, C] = level.size;
  world.position.set(-(A - 1) / 2, -(B - 1) / 2, -(C - 1) / 2);

  cubeMesh = new THREE.Mesh(
    new THREE.BoxGeometry(A, B, C),
    new THREE.MeshStandardMaterial({ color: 0xf1f3f8, roughness: 0.9, metalness: 0 }),
  );
  cubeMesh.position.set((A - 1) / 2, (B - 1) / 2, (C - 1) / 2);
  world.add(cubeMesh);

  const occ = new Map();
  const list = arrows.map((a, i) => {
    const arrow = { id: i, cells: a.cells, dir: a.dir, path: buildPath(board, a), busy: false, gone: false };
    a.cells.forEach((c) => occ.set(c.key, arrow));
    return arrow;
  });
  const lives = level.lives || 3;
  state = { index, level, board, arrows: list, left: list.length, occ, lives, maxLives: lives, bonks: 0, flying: 0, over: false, hint: null };
  state.batch = buildBatch(list);
  world.add(state.batch);

  view.half = level.size.map((s) => s / 2);
  fitCamera();
  if (index >= 0) store.set('current', index);
  ui.win.classList.remove('show');
  ui.lose.classList.remove('show');
  updateHud();
}

// ---------------------------------------------------------------------------
// Camera: the orbit controls pick the direction; we keep the camera a set
// height above the cube's surface in that direction.
// ---------------------------------------------------------------------------
const view = { half: [1.5, 1.5, 1.5], alt: 5, fitAlt: 5 };

function surfaceDist(dir) {
  let t = Infinity;
  for (let i = 0; i < 3; i++) {
    const c = Math.abs(dir.getComponent(i));
    if (c > 1e-6) t = Math.min(t, view.half[i] / c);
  }
  return t;
}

function fitCamera() {
  const radius = Math.hypot(...view.half) + 0.4;
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const dist = radius / Math.sin(Math.min(vfov, hfov) / 2) * 1.05;
  const dir = new THREE.Vector3(0.55, 0.5, 0.75).normalize();
  view.fitAlt = view.alt = dist - surfaceDist(dir);
  camera.position.copy(dir).multiplyScalar(dist);
  controls.target.set(0, 0, 0);
  controls.update();
}

function zoom(factor) {
  view.alt = Math.min(view.fitAlt * 2.5, Math.max(1.2, view.alt * factor));
}

function placeCamera() {
  const dir = camera.position.clone().normalize();
  const surface = surfaceDist(dir);
  camera.position.copy(dir).multiplyScalar(surface + view.alt);
  const near = Math.max(0.02, view.alt * 0.2);
  const far = surface * 2 + view.alt + 10;
  if (camera.near !== near || camera.far !== far) {
    camera.near = near; camera.far = far;
    camera.updateProjectionMatrix();
  }
  // Turn slower when close, so a drag moves the surface about the same amount.
  controls.rotateSpeed = 0.85 * Math.min(1, Math.max(0.01, view.alt / view.fitAlt));
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
function updateHud() {
  const tag = state.level.tag ? ` · ${state.level.tag}` : '';
  ui.levelName.textContent = state.index >= 0 ? `${state.index + 1}. ${state.level.name}` : state.level.name;
  ui.remaining.textContent = `${state.left} arrow${state.left === 1 ? '' : 's'} left${tag}`;
  ui.hearts.innerHTML = state.maxLives <= 3
    ? Array.from({ length: state.maxLives }, (_, i) => `<span class="${i < state.lives ? '' : 'lost'}">♥</span>`).join('')
    : `♥ ${state.lives}/${state.maxLives}`;
}

let toastTimer = 0;
function toast(text) {
  ui.toast.textContent = text;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 1400);
}

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------
// The first other arrow in front of the head, and how many free cells come
// before it; null if the run is clear.
function blocker(arrow) {
  const head = arrow.cells[arrow.cells.length - 1];
  const ray = state.board.ray(head, arrow.dir);
  for (let i = 0; i < ray.length; i++) {
    const other = state.occ.get(ray[i]);
    if (other && other !== arrow) return { gap: i, other };
  }
  return null;
}

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
    state.left--;
    state.flying++;
    updateHud();
    setVisible(arrow, false);
    const mesh = movingMesh(arrow, INK);
    const distance = arrow.path.bodyLen + 14;
    const duration = Math.min(1600, 380 + distance * 28);
    tween(duration, (t) => {
      mesh.userData.place(easeIn(t) * distance);
      mesh.material.opacity = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    }, () => {
      dropMesh(mesh);
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
  setVisible(arrow, false);
  setColor(block.other, BONK);
  const mesh = movingMesh(arrow, BONK);
  const reach = block.gap + 0.22;
  tween(Math.min(900, Math.max(140, block.gap * 60 + 120)), (t) => {
    mesh.userData.place(easeOut(t) * reach);
  }, () => {
    tween(280, (t) => {
      mesh.userData.place((1 - easeOut(t)) * reach);
    }, () => {
      dropMesh(mesh);
      setVisible(arrow, true);
      arrow.busy = false;
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
  if (state.over || state.left || state.flying) return;
  state.over = true;
  if (state.index >= 0) {
    solved.add(state.index);
    store.set('solved', [...solved]);
  }
  const last = state.index === LEVELS.length - 1;
  const flawless = state.bonks === 0 ? ' Flawless, no bonks.' : '';
  ui.winText.textContent = last
    ? `That was the last one. You untangled all ${LEVELS.length} cubes!${flawless}`
    : `${state.arrows.length} arrows untangled.${flawless}`;
  ui.next.textContent = state.index < 0 ? 'Another one' : last ? 'Back to level 1' : 'Next level';
  const won = state;
  setTimeout(() => { if (state === won) ui.win.classList.add('show'); }, 250);
}

const headCell = (a) => a.cells[a.cells.length - 1];

function showHint() {
  if (state.over) return;
  clearHint();
  // The free arrow closest to where the camera is looking, measured from the
  // middle of the cube. If it is off screen, swing the camera round to it.
  const camDir = camera.position.clone().normalize();
  let best = null, bestScore = -Infinity;
  for (const a of state.arrows) {
    if (a.gone || a.busy) continue;
    const h = headCell(a);
    const p = world.localToWorld(v3(state.board.center(h)));
    const score = p.normalize().dot(camDir) + NORMALS[h.n].dot(camDir) * 0.3;
    if (score > bestScore && !blocker(a)) { best = a; bestScore = score; }
  }
  if (!best) return;
  state.hint = best;
  const h = headCell(best);
  const target = world.localToWorld(v3(state.board.center(h)));
  const onScreen = target.clone().project(camera);
  const facing = NORMALS[h.n].dot(camera.position.clone().sub(target).normalize());
  if (Math.abs(onScreen.x) < 0.8 && Math.abs(onScreen.y) < 0.75 && facing > 0.2) return;
  // The camera always faces the cube's centre, so look along the line
  // through the arrow's head to bring it to the middle of the screen.
  const to = target.clone().normalize();
  const from = camDir.clone();
  const q = new THREE.Quaternion().setFromUnitVectors(from, to);
  const q0 = new THREE.Quaternion();
  tween(650, (t) => {
    const qt = q0.clone().slerp(q, easeOut(t));
    camera.position.copy(from).applyQuaternion(qt).multiplyScalar(camera.position.length());
  });
}

// ---------------------------------------------------------------------------
// Input: a short press without much movement is a tap; a drag turns the
// cube; two fingers pinch to zoom. A tap picks the surface cell under the
// finger, or the nearest arrow cell next to it, since arrows are thin.
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
  let best = null, bestDist = 0.85;
  for (const t of [0, 1, 2, 3, 4, 5]) {
    if ((t >> 1) === (n >> 1)) continue;
    const v2 = v.map((x, i) => x + AXES[t][i]);
    const a = state.occ.get(cellKey(v2, n));
    if (!a) continue;
    const dist = new THREE.Vector3(...v2).addScaledVector(NORMALS[n], 0.5).distanceTo(p);
    if (dist < bestDist) { best = a; bestDist = dist; }
  }
  return best;
}

const pointers = new Map();
let pinch = 0;
const pinchDistance = () => {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
};
const canvas = renderer.domElement;
canvas.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: performance.now(), multi: pointers.size > 0 });
  if (pointers.size > 1) for (const d of pointers.values()) d.multi = true;
  pinch = pointers.size === 2 ? pinchDistance() : 0;
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  p.x = e.clientX; p.y = e.clientY;
  if (pointers.size === 2 && pinch) {
    const d = pinchDistance();
    if (d > 0) zoom(pinch / d);
    pinch = d;
  }
});
const lift = (e) => { pointers.delete(e.pointerId); pinch = 0; };
canvas.addEventListener('pointercancel', lift);
canvas.addEventListener('pointerup', (e) => {
  const d = pointers.get(e.pointerId);
  lift(e);
  if (!d || d.multi || !state) return;
  if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 8 || performance.now() - d.t > 500) return;
  const arrow = arrowAt(e.clientX, e.clientY);
  if (arrow) tapArrow(arrow);
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoom(Math.exp(e.deltaY * 0.0012));
}, { passive: false });

// ---------------------------------------------------------------------------
// Buttons and level picker
// ---------------------------------------------------------------------------
function renderLevelGrid() {
  const unlocked = Math.max(0, ...[...solved].map((i) => i + 1));
  ui.levelGrid.innerHTML = '';
  LEVELS.forEach((lvl, i) => {
    const b = document.createElement('button');
    b.textContent = String(i + 1);
    b.title = `${lvl.name} (${lvl.size.join('×')})${lvl.tag ? ` · ${lvl.tag}` : ''}`;
    b.disabled = i > unlocked;
    if (solved.has(i)) b.classList.add('done');
    if (state && i === state.index) b.classList.add('current');
    b.addEventListener('click', () => { ui.levels.classList.remove('show'); loadLevel(i); });
    ui.levelGrid.appendChild(b);
  });
}

function customLevel(n) {
  const level = bigLevel(`${n}×${n}×${n}`, n, Math.floor(Math.random() * 1e9));
  if (n < 10) Object.assign(level, { minLen: 2, maxLen: Math.max(4, n + 2), strictMin: false, lives: 3 });
  return level;
}

const showCustom = () => { const n = ui.customSize.value; ui.customOut.textContent = `${n}×${n}×${n}`; };
ui.customSize.value = store.get('customSize', 20);
showCustom();
ui.customSize.addEventListener('input', showCustom);
$('btnCustom').addEventListener('click', () => {
  const n = Number(ui.customSize.value);
  store.set('customSize', n);
  ui.levels.classList.remove('show');
  loadLevel(-1, customLevel(n));
});

$('btnLevels').addEventListener('click', () => { renderLevelGrid(); ui.levels.classList.add('show'); });
$('btnCloseLevels').addEventListener('click', () => ui.levels.classList.remove('show'));
const replay = () => loadLevel(state.index, state.index < 0 ? state.level : undefined);
$('btnRestart').addEventListener('click', replay);
$('btnRetry').addEventListener('click', replay);
$('btnReplay').addEventListener('click', replay);
$('btnHint').addEventListener('click', showHint);
$('btnView').addEventListener('click', fitCamera);
$('btnZoomIn').addEventListener('click', () => zoom(0.7));
$('btnZoomOut').addEventListener('click', () => zoom(1 / 0.7));
ui.next.addEventListener('click', () => {
  if (state.index < 0) loadLevel(-1, customLevel(state.level.size[0]));
  else loadLevel(state.index === LEVELS.length - 1 ? 0 : state.index + 1);
});
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
  if (state && state.hint && !state.hint.gone && !state.hint.busy) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 140);
    setColor(state.hint, INK.clone().lerp(HINT, 0.35 + 0.65 * pulse));
  }
  controls.update();
  placeCamera();
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
  for (const a of state.arrows) {
    if (a.gone || a.busy || !blocker(a) !== free) continue;
    for (const c of a.cells) {
      const p = world.localToWorld(v3(state.board.center(c))).project(camera);
      if (p.z > 1 || Math.abs(p.x) > 0.8 || Math.abs(p.y) > 0.75) continue;
      const x = (p.x + 1) / 2 * window.innerWidth, y = (1 - p.y) / 2 * window.innerHeight;
      if (arrowAt(x, y) === a) return { x, y };
    }
  }
  return null;
}
window.tanglecube = { get state() { return state; }, LEVELS, loadLevel, findTappable, camera, controls, view, zoom };
