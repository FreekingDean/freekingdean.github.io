// Nibblecrate: move crates of hungry critters into the active row. A crate in
// the row sends its critters out to nibble any pixel of its colour that
// touches the open air around the picture. If the row is full and none of
// its crates can reach anything, you're stuck.

import { PALETTE, LEVELS, parseArt, randomPicture, makeCrates, airMap, floodAir, touchesAir } from './levels.js';
import { loadImage, loremUrl, pixelate } from './photo.js';
import * as sfx from './sound.js';

const canvas = document.getElementById('board');
const g = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

const CRATE_FLY = 0.22;
const PHOTO_SIZES = { s: 24, m: 36, l: 52 };
const PHOTO_COLORS = { s: 6, m: 7, l: 8 };

let W = 0, H = 0, DPR = 1;
let L = null;                // layout
let S = null;                // game state
let last = performance.now();
let time = 0;
let timeScale = 1;           // tests speed this up
let loadToken = 0;

// --- Persistence ---------------------------------------------------------

function load(key, fallback) {
  try { const v = localStorage.getItem('nibblecrate:' + key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
}
function save(key, v) {
  try { localStorage.setItem('nibblecrate:' + key, JSON.stringify(v)); } catch (e) { /* ignore */ }
}
const cleared = new Set(load('cleared', []));

// --- Level setup ---------------------------------------------------------

function levelFromHash() {
  const h = location.hash;
  let m = h.match(/photo=(\d+)(?:&size=([sml]))?/);
  if (m) return { photo: +m[1], size: m[2] || 'm' };
  m = h.match(/seed=(\d+)/);
  if (m) return { seed: +m[1] };
  m = h.match(/level=(\d+)/);
  if (m) return { index: Math.max(0, Math.min(LEVELS.length - 1, +m[1] - 1)) };
  return { index: Math.min(load('level', 0), LEVELS.length - 1) };
}

function setHash(hash) {
  if (location.hash !== hash) history.replaceState(null, '', hash);
}

async function start(which) {
  const token = ++loadToken;
  if (which.photo != null || which.upload) {
    showLoading(which.upload ? 'Pixelating your picture…' : 'Fetching a photo…');
    try {
      let img;
      if (which.upload) img = which.img;
      else img = await loadImage(loremUrl(which.photo), true);
      const size = which.size || 'm';
      const pic = pixelate(img, PHOTO_SIZES[size], PHOTO_COLORS[size]);
      if (token !== loadToken) return;
      hideLoading();
      if (which.upload) setHash('#upload');
      else setHash(`#photo=${which.photo}&size=${size}`);
      begin(which, pic, which.upload ? 'Your picture' : 'Photo #' + which.photo, pic.palette);
    } catch (err) {
      if (token !== loadToken) return;
      hideLoading();
      toast(which.upload ? 'Could not read that image.' : 'Could not fetch a photo. Here is a critter instead.');
      if (!S) start({ seed: 1 + Math.floor(Math.random() * 99999) });
    }
    return;
  }
  hideLoading();
  if (which.seed != null) {
    setHash('#seed=' + which.seed);
    begin(which, randomPicture(which.seed), 'Critter #' + which.seed, PALETTE);
  } else {
    const lv = LEVELS[which.index];
    save('level', which.index);
    setHash('#level=' + (which.index + 1));
    begin(which, parseArt(lv.art), lv.name, PALETTE);
  }
}

function begin(which, pic, name, palette) {
  let total = 0;
  for (const r of pic.grid) for (const c of r) if (c) total++;
  const seed = which.seed ?? which.photo ?? (which.index != null ? which.index + 1 : 99);
  S = {
    which, name, palette,
    w: pic.w, h: pic.h,
    grid: pic.grid,
    original: pic.grid.map((r) => r.slice()),
    air: airMap(pic.grid),
    claimed: new Uint8Array(pic.w * pic.h),
    total, left: total,
    columns: makeCrates(pic.grid, seed),
    row: Array(rowSize(pic.grid)).fill(null),
    critters: [],
    bites: [],
    bits: [],
    perCrate: Math.max(2, Math.min(7, Math.round(total / 160) + 2)),
    combo: 0, comboT: 0, bestCombo: 0,
    squeezed: false, stuck: false, stuckCheck: 0,
    paused: false, won: false, winT: 0,
    started: 0, elapsed: 0,
    shake: 0,
  };
  $('levelName').textContent = name;
  hideOverlays();
  layout();
  updateHud();
}

// Fewer colours, fewer slots, so there's always a little planning to do.
function rowSize(grid) {
  const colors = new Set();
  for (const r of grid) for (const c of r) if (c) colors.add(c);
  return Math.min(5, Math.max(3, colors.size));
}

// --- Layout --------------------------------------------------------------

function layout() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  if (!S) return;

  const safeB = $('safe').offsetHeight || 0;
  const top = 68;
  const pad = 12;
  const cols = S.columns.length;
  const width = Math.min(W, 560) - pad * 2;

  // Active row
  const n = S.row.length;
  const slot = Math.min(84, (width - (n - 1) * 8) / n);
  const slotH = slot * 0.95;
  // Waiting crates
  const cw = Math.min(84, (width - (cols - 1) * 10) / cols);
  const ch = cw * 0.7;
  const queueH = ch * 2.05 + 22;

  const bottomLimit = H - safeB - 10;
  const rowArea = slotH + slot * 0.25 + 22;  // crate + peeking critter + label
  const availH = Math.max(120, bottomLimit - top - rowArea - queueH - 16);
  const availW = Math.min(W - pad * 2, 900);
  const cs = Math.max(4, Math.min(44, availW / (S.w + 1), availH / (S.h + 1)));
  const bw = S.w * cs, bh = S.h * cs;
  const m = Math.max(10, cs * 0.5);
  const content = bh + m * 2 + rowArea + queueH + 16;
  const startY = top + Math.max(0, (bottomLimit - top - content) * 0.45);
  const bx = Math.round((W - bw) / 2);
  const by = Math.round(startY + m);

  const rowY = by + bh + m + 12 + slot * 0.25;
  const rowW = n * slot + (n - 1) * 8;
  const slots = [];
  for (let i = 0; i < n; i++) slots.push({ x: (W - rowW) / 2 + i * (slot + 8), y: rowY, w: slot, h: slotH });

  const qy = rowY + slotH + 22 + ch * 0.2;
  const qw = cols * cw + (cols - 1) * 10;
  const queue = [];
  for (let i = 0; i < cols; i++) queue.push({ x: (W - qw) / 2 + i * (cw + 10), y: qy, w: cw, h: ch });

  L = { cs, bx, by, bw, bh, m, slots, queue, rowLabelY: rowY + slotH + 13 };
  for (const cr of S.row) if (cr && !cr.fly) placeInSlot(cr);
}

function placeInSlot(cr) {
  const s = L.slots[cr.slot];
  cr.x = s.x; cr.y = s.y;
}

// --- Actions -------------------------------------------------------------

let nextId = 1;

function moveToRow(ci) {
  if (!canAct()) return;
  const col = S.columns[ci];
  if (!col || !col.length) { sfx.nope(); return; }
  const free = S.row.findIndex((c) => c === null);
  if (free < 0) {
    sfx.nope();
    S.shake = 0.6;
    toast('The row is full. Wait for a crate to empty.');
    return;
  }
  const crate = col.shift();
  const q = L.queue[ci];
  const cr = {
    id: nextId++, color: crate.color, count: crate.count,
    pending: 0, out: 0, cooldown: 0.05, slot: free,
    x: q.x, y: q.y, w: q.w, h: q.h,
    fly: { fx: q.x, fy: q.y, fw: q.w, fh: q.h, t: 0 },
    bounce: 1, done: false, doneT: 0, sleepy: false,
  };
  S.row[free] = cr;
  q.kick = 1;
  S.stuck = false;
  startClock();
  sfx.launch();
  haptic(8);
}

function canAct() { return S && !S.paused && !S.won; }
function startClock() { if (!S.started) S.started = performance.now(); }
function haptic(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ } }

function crateCenter(cr) {
  const s = L.slots[cr.slot];
  return { x: s.x + s.w / 2, y: s.y + s.h * 0.1 };
}

// The nearest free pixel of this crate's colour that touches open air.
function findTarget(cr) {
  const { w, h, grid, air, claimed } = S;
  const c = crateCenter(cr);
  // in grid units, from the crate
  const gx = (c.x - L.bx) / L.cs, gy = (c.y - L.by) / L.cs;
  let best = -1, bd = Infinity;
  for (let y = 0; y < h; y++) {
    const row = grid[y];
    for (let x = 0; x < w; x++) {
      if (row[x] !== cr.color || claimed[y * w + x]) continue;
      if (!touchesAir(grid, air, x, y)) continue;
      const d = (x + 0.5 - gx) ** 2 + (y + 0.5 - gy) ** 2 * 0.6;
      if (d < bd) { bd = d; best = y * w + x; }
    }
  }
  return best;
}

function spawn(cr) {
  const i = findTarget(cr);
  if (i < 0) { cr.sleepy = true; return false; }
  cr.sleepy = false;
  S.claimed[i] = 1;
  cr.pending++;
  cr.out++;
  const x = i % S.w, y = (i - x) / S.w;
  const from = crateCenter(cr);
  const tx = L.bx + (x + 0.5) * L.cs, ty = L.by + (y + 0.5) * L.cs;
  const d = Math.hypot(tx - from.x, ty - from.y);
  S.critters.push({
    id: nextId++, crate: cr, cx: x, cy: y, phase: 'go', t: 0,
    dur: Math.min(0.45, 0.14 + d / 1400),
    fx: from.x, fy: from.y, tx, ty, x: from.x, y: from.y, chomp: 0,
  });
  return true;
}

function eat(k) {
  const { w, grid, air } = S;
  const cr = k.crate;
  const x = k.cx, y = k.cy;
  grid[y][x] = null;
  S.claimed[y * w + x] = 0;
  // The eaten pixel is now open air, and so is any hollow it opened up.
  air[y * w + x] = 1;
  floodAir(grid, air, [y * w + x]);
  cr.count--;
  cr.pending--;
  S.left--;
  S.combo++;
  S.comboT = 0.5;
  S.bestCombo = Math.max(S.bestCombo, S.combo);
  const col = S.palette[cr.color];
  const n = L.cs > 10 ? 4 : 2;
  for (let j = 0; j < n; j++) {
    const a = Math.random() * Math.PI * 2, v = 30 + Math.random() * 80;
    S.bits.push({ x: k.tx, y: k.ty, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 50, life: 0.45, max: 0.45, color: col, size: Math.max(2, L.cs * 0.25) });
  }
  sfx.bite(S.combo);
  updateHud();
  if (S.left <= 0) win();
}

function burst(x, y, color, n) {
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 160;
    S.bits.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, life: 0.8, max: 0.8, color, size: 3 + Math.random() * 3, star: true });
  }
}

function checkStuck() {
  if (S.won || S.stuck) return;
  if (S.row.some((c) => c === null || c.done || c.fly || c.out > 0)) return;
  if (S.critters.length) return;
  // Full row and nobody can reach anything.
  for (const cr of S.row) if (findTarget(cr) >= 0) return;
  S.stuck = true;
  S.paused = true;
  S.shake = 1;
  sfx.lose();
  haptic([30, 40, 30]);
  $('squeeze').hidden = S.squeezed;
  $('loseText').textContent = S.squeezed
    ? 'Stuck again: every crate in the row is waiting for a colour it can\'t reach.'
    : 'Every crate in the row is waiting for a colour it can\'t reach, and there\'s no room for another.';
  setTimeout(() => $('loseOverlay').classList.add('show'), 450);
}

function squeeze() {
  S.squeezed = true;
  S.stuck = false;
  S.row.push(null);
  S.paused = false;
  layout();
  hideOverlays();
}

function win() {
  S.won = true;
  S.winT = 0;
  S.elapsed = S.started ? (performance.now() - S.started) / 1000 : 0;
  if (S.which.index != null && S.which.seed == null && S.which.photo == null) {
    cleared.add(S.which.index);
    save('cleared', [...cleared]);
  }
  setTimeout(() => {
    sfx.win();
    haptic([20, 30, 20, 30, 40]);
    const cx = L.bx + L.bw / 2, cy = L.by + L.bh / 2;
    for (const col of Object.values(S.palette).slice(0, 10)) burst(cx, cy, col, 14);
  }, 250);
  setTimeout(() => {
    const secs = Math.round(S.elapsed);
    $('winTitle').textContent = S.name + ', eaten!';
    $('winText').textContent = `${S.total} pixels in ${secs}s. Longest nibble streak: ${S.bestCombo}.`;
    drawThumb($('winThumb'), S.original, S.palette, 140);
    $('btnNext').textContent = nextLabel();
    $('winOverlay').classList.add('show');
  }, 1300);
}

function nextLabel() {
  const w = S.which;
  if (w.photo != null) return 'Another photo';
  if (w.upload) return 'Random photo';
  if (w.seed != null || w.index === LEVELS.length - 1) return 'Random critter';
  return 'Next picture';
}

function next() {
  const w = S.which;
  if (w.photo != null || w.upload) start({ photo: randSeed(), size: w.size || 'm' });
  else if (w.seed == null && w.index < LEVELS.length - 1) start({ index: w.index + 1 });
  else start({ seed: randSeed() });
}

const randSeed = () => 1 + Math.floor(Math.random() * 99999);

// --- Update --------------------------------------------------------------

const ease = (t) => 1 - Math.pow(1 - t, 3);

function update(dt) {
  if (!S || !L) return;
  for (const q of L.queue) if (q.kick) q.kick = Math.max(0, q.kick - dt * 4);
  S.shake = Math.max(0, S.shake - dt * 2.5);
  if (S.paused) return;

  S.comboT -= dt;
  if (S.comboT <= 0) S.combo = 0;

  // Crates flying into the row
  S.row.forEach((cr) => {
    if (!cr) return;
    cr.bounce += (1 - cr.bounce) * Math.min(1, dt * 12);
    if (cr.fly) {
      cr.fly.t += dt / CRATE_FLY;
      const t = Math.min(1, cr.fly.t), e = ease(t);
      const s = L.slots[cr.slot];
      cr.x = cr.fly.fx + (s.x - cr.fly.fx) * e;
      cr.y = cr.fly.fy + (s.y - cr.fly.fy) * e - Math.sin(t * Math.PI) * 30;
      cr.w = cr.fly.fw + (s.w - cr.fly.fw) * e;
      cr.h = cr.fly.fh + (s.h - cr.fly.fh) * e;
      if (t >= 1) { cr.fly = null; cr.bounce = 1.15; placeInSlot(cr); cr.w = s.w; cr.h = s.h; }
      return;
    }
    if (cr.done) {
      cr.doneT += dt;
      if (cr.doneT > 0.4) S.row[cr.slot] = null;
      return;
    }
    // Send critters out while there's appetite and something to reach.
    cr.cooldown -= dt;
    if (cr.cooldown <= 0 && cr.out < S.perCrate && cr.count - cr.pending > 0) {
      cr.cooldown = 0.06;
      spawn(cr);
    }
    if (cr.count <= 0 && cr.out === 0) {
      cr.done = true;
      cr.doneT = 0;
      sfx.done();
      haptic(12);
      const c = crateCenter(cr);
      burst(c.x, c.y, S.palette[cr.color], 10);
    }
  });

  // Critters
  for (const k of S.critters) {
    k.t += dt / k.dur;
    k.chomp = Math.max(0, k.chomp - dt * 6);
    const t = Math.min(1, k.t), e = ease(t);
    if (k.phase === 'go') {
      k.x = k.fx + (k.tx - k.fx) * e;
      k.y = k.fy + (k.ty - k.fy) * e - Math.sin(t * Math.PI) * 26;
      if (t >= 1) { eat(k); k.phase = 'back'; k.t = 0; k.chomp = 1; const c = crateCenter(k.crate); k.fx = k.tx; k.fy = k.ty; k.tx = c.x; k.ty = c.y; }
    } else {
      k.x = k.fx + (k.tx - k.fx) * e;
      k.y = k.fy + (k.ty - k.fy) * e - Math.sin(t * Math.PI) * 18;
      if (t >= 1) { k.gone = true; k.crate.out--; k.crate.bounce = 1.08; }
    }
  }
  S.critters = S.critters.filter((k) => !k.gone);

  for (const b of S.bites) b.t += dt / 0.22;
  S.bites = S.bites.filter((b) => b.t < 1);
  for (const p of S.bits) {
    p.life -= dt;
    p.vy += 320 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  S.bits = S.bits.filter((p) => p.life > 0);

  S.stuckCheck -= dt;
  if (S.stuckCheck <= 0) { S.stuckCheck = 0.3; checkStuck(); }
}

// --- Drawing -------------------------------------------------------------

function rr(x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
  const f = (v) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  return `rgb(${f(r)},${f(gg)},${f(b)})`;
}

function isDark(hex) {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 < 110;
}

function drawCritter(x, y, r, col, count, look, opts = {}) {
  const chomp = opts.chomp || 0;
  const sq = opts.scale || 1;
  g.save();
  g.translate(x, y);
  g.scale(sq * (1 + chomp * 0.15), sq * (1 - chomp * 0.15));
  if (opts.alpha != null) g.globalAlpha = opts.alpha;
  const simple = r < 8;
  if (!simple) {
    g.fillStyle = shade(col, -0.2);
    for (const sx of [-1, 1]) {
      g.beginPath(); g.ellipse(sx * r * 0.55, -r * 0.78, r * 0.24, r * 0.3, sx * 0.4, 0, Math.PI * 2); g.fill();
    }
  }
  if (simple) {
    g.fillStyle = col;
  } else {
    const grad = g.createRadialGradient(-r * 0.3, -r * 0.4, r * 0.1, 0, 0, r * 1.1);
    grad.addColorStop(0, shade(col, 0.35));
    grad.addColorStop(1, shade(col, -0.12));
    g.fillStyle = grad;
  }
  g.beginPath(); g.ellipse(0, 0, r, r * 0.92, 0, 0, Math.PI * 2); g.fill();
  g.lineWidth = Math.max(1, r * 0.1);
  g.strokeStyle = shade(col, -0.5);
  g.stroke();
  const lx = (look && look.dx) || 0, ly = (look && look.dy) || -1;
  const er = r * 0.26;
  const closed = opts.sleepy || chomp > 0.4;
  for (const sx of [-1, 1]) {
    const ex = sx * r * 0.36, ey = -r * 0.3;
    if (closed) {
      g.strokeStyle = '#1c1b22';
      g.lineWidth = Math.max(1, r * 0.1);
      g.beginPath(); g.moveTo(ex - er, ey); g.lineTo(ex + er, ey); g.stroke();
    } else {
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(ex, ey, er, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#1c1b22';
      g.beginPath(); g.arc(ex + lx * er * 0.4, ey + ly * er * 0.4, er * 0.55, 0, Math.PI * 2); g.fill();
    }
  }
  if (count != null) {
    const fs = Math.max(9, r * 0.95);
    g.font = `800 ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = Math.max(2, fs * 0.22);
    g.strokeStyle = isDark(col) ? 'rgb(255 255 255 / 0.25)' : 'rgb(0 0 0 / 0.45)';
    g.strokeText(count, 0, r * 0.34);
    g.fillStyle = '#fff';
    g.fillText(count, 0, r * 0.34);
  }
  g.restore();
}

function drawBoard() {
  const { bx, by, bw, bh, cs, m } = L;
  g.fillStyle = getVar('--panel');
  rr(bx - m, by - m, bw + m * 2, bh + m * 2, Math.min(24, m * 1.4));
  g.fill();
  g.strokeStyle = getVar('--border');
  g.lineWidth = 1;
  g.stroke();
  g.fillStyle = getVar('--board');
  g.fillRect(bx, by, bw, bh);
  const big = cs >= 9;
  for (let y = 0; y < S.h; y++) {
    for (let x = 0; x < S.w; x++) {
      const px = bx + x * cs, py = by + y * cs;
      const c = S.grid[y][x];
      if (c) {
        g.fillStyle = S.palette[c];
        g.fillRect(px, py, cs + 0.5, cs + 0.5);
        if (big) {
          g.fillStyle = 'rgb(255 255 255 / 0.16)';
          g.fillRect(px, py, cs, Math.max(1, cs * 0.12));
          g.fillStyle = 'rgb(0 0 0 / 0.12)';
          g.fillRect(px, py + cs - Math.max(1, cs * 0.1), cs, Math.max(1, cs * 0.1));
        }
      } else if ((x + y) % 2) {
        g.fillStyle = getVar('--board2');
        g.fillRect(px, py, cs + 0.5, cs + 0.5);
      }
    }
  }
  if (S.won) {
    const a = Math.min(1, Math.max(0, (S.winT - 0.3) / 0.6));
    if (a > 0) {
      g.globalAlpha = a;
      for (let y = 0; y < S.h; y++) for (let x = 0; x < S.w; x++) {
        const c = S.original[y][x];
        if (c) { g.fillStyle = S.palette[c]; g.fillRect(bx + x * cs, by + y * cs, cs + 0.5, cs + 0.5); }
      }
      g.globalAlpha = 1;
    }
  }
}

function drawRow() {
  const used = S.row.filter(Boolean).length;
  const full = used >= S.row.length && !S.won;
  const danger = full && S.row.every((c) => c && c.sleepy);
  L.slots.forEach((s) => {
    rr(s.x, s.y, s.w, s.h, Math.min(14, s.w * 0.18));
    g.fillStyle = danger ? `rgb(229 72 77 / ${0.08 + 0.06 * Math.sin(time * 6)})` : getVar('--slot');
    g.fill();
    g.setLineDash([4, 4]);
    g.strokeStyle = danger ? '#e5484d' : getVar('--border');
    g.lineWidth = 1.5;
    g.stroke();
    g.setLineDash([]);
  });
  g.fillStyle = getVar('--muted');
  g.font = '600 11px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(full ? 'Row full' : 'Tap a crate below to put it in the row', W / 2, L.rowLabelY);

  for (const cr of S.row) {
    if (!cr) continue;
    let alpha = 1, sc = cr.bounce;
    if (cr.done) { alpha = Math.max(0, 1 - cr.doneT / 0.4); sc = 1 + cr.doneT * 0.6; }
    g.save();
    g.globalAlpha = alpha;
    const cx = cr.x + cr.w / 2, cy = cr.y + cr.h / 2;
    g.translate(cx, cy); g.scale(sc, sc); g.translate(-cx, -cy);
    drawCrate(cr.x, cr.y, cr.w, cr.h, cr.color, Math.max(0, cr.count), { sleepy: cr.sleepy && !cr.fly && cr.out === 0, wobble: cr.id });
    g.restore();
  }
}

function drawQueue() {
  S.columns.forEach((col, i) => {
    const q = L.queue[i];
    const kick = q.kick || 0;
    for (let k = Math.min(col.length - 1, 2); k >= 1; k--) {
      const cr = col[k];
      const sc = 1 - k * 0.12;
      const w = q.w * sc, h = q.h * 0.42;
      const x = q.x + (q.w - w) / 2, y = q.y + q.h + 4 + (k - 1) * (h + 3);
      g.globalAlpha = 0.85 - k * 0.15;
      drawBox(x, y, w, h, cr.color, cr.count, true);
      g.globalAlpha = 1;
    }
    if (col.length > 3) {
      g.fillStyle = getVar('--muted');
      g.font = '600 10px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'top';
      g.fillText('+' + (col.length - 3) + ' more', q.x + q.w / 2, q.y + q.h * 1.9 + 8);
    }
    if (!col.length) {
      rr(q.x, q.y, q.w, q.h, 10);
      g.setLineDash([5, 5]);
      g.strokeStyle = getVar('--border');
      g.lineWidth = 1.5;
      g.stroke();
      g.setLineDash([]);
      return;
    }
    const c = col[0];
    drawCrate(q.x, q.y + kick * 6, q.w, q.h, c.color, c.count, { wobble: i });
  });
}

// A crate with its critter peeking over the top edge.
function drawCrate(x, y, w, h, colorKey, count, opts = {}) {
  const col = S.palette[colorKey];
  drawCritter(x + w / 2, y + h * 0.08, w * 0.22, col, null, { dx: 0, dy: -1 },
    { scale: 1 + Math.sin(time * 3 + (opts.wobble || 0)) * 0.03, sleepy: opts.sleepy });
  drawBox(x, y + h * 0.14, w, h * 0.86, colorKey, count, false);
  if (opts.sleepy) {
    g.fillStyle = getVar('--muted');
    g.font = `700 ${Math.max(9, w * 0.14)}px system-ui, sans-serif`;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    const b = Math.sin(time * 2) * 2;
    g.fillText('z', x + w * 0.72, y - h * 0.05 + b);
    g.fillText('z', x + w * 0.82, y - h * 0.22 + b);
  }
}

function drawBox(x, y, w, h, colorKey, count, small) {
  const col = S.palette[colorKey];
  rr(x, y, w, h, Math.min(10, h * 0.2));
  g.fillStyle = '#c98d4f';
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = '#7c4f26';
  g.stroke();
  if (!small) {
    g.strokeStyle = 'rgb(124 79 38 / 0.45)';
    g.lineWidth = 1;
    for (let k = 1; k < 3; k++) {
      g.beginPath(); g.moveTo(x + 4, y + (h * k) / 3); g.lineTo(x + w - 4, y + (h * k) / 3); g.stroke();
    }
  }
  const lw = small ? w * 0.62 : w * 0.68, lh = small ? h * 0.62 : h * 0.58;
  const lx = x + (w - lw) / 2, ly = y + (h - lh) / 2;
  rr(lx, ly, lw, lh, Math.min(8, lh * 0.3));
  g.fillStyle = col;
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = shade(col, -0.45);
  g.stroke();
  const fs = Math.max(9, Math.min(lh * (small ? 0.75 : 0.68), lw * 0.42));
  g.font = `800 ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = fs * 0.2;
  g.strokeStyle = isDark(col) ? 'rgb(255 255 255 / 0.2)' : 'rgb(0 0 0 / 0.4)';
  g.strokeText(count, lx + lw / 2, ly + lh / 2 + 1);
  g.fillStyle = '#fff';
  g.fillText(count, lx + lw / 2, ly + lh / 2 + 1);
}

function drawCritters() {
  const r = Math.max(5, Math.min(14, L.cs * 0.7));
  for (const k of S.critters) {
    const col = S.palette[k.crate.color];
    const look = k.phase === 'go' ? norm(k.tx - k.x, k.ty - k.y) : { dx: 0, dy: -1 };
    const sc = k.phase === 'back' ? 1 - Math.min(1, k.t) * 0.35 : 1;
    drawCritter(k.x, k.y, r, col, null, look, { chomp: k.chomp, scale: sc });
  }
}

function norm(x, y) {
  const d = Math.hypot(x, y) || 1;
  return { dx: x / d, dy: y / d };
}

function drawEffects() {
  for (const p of S.bits) {
    g.globalAlpha = Math.max(0, p.life / p.max);
    g.fillStyle = p.color;
    if (p.star) {
      g.save(); g.translate(p.x, p.y); g.rotate(p.life * 8);
      g.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      g.restore();
    } else {
      g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
  }
  g.globalAlpha = 1;
}

function draw() {
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.clearRect(0, 0, W, H);
  if (!S || !L) return;
  g.save();
  if (S.shake) g.translate(Math.sin(time * 60) * S.shake * 6, 0);
  drawBoard();
  drawQueue();
  drawRow();
  drawCritters();
  drawEffects();
  g.restore();
}

const varCache = {};
function getVar(name) {
  if (!varCache[name]) varCache[name] = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return varCache[name];
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { for (const k in varCache) delete varCache[k]; });

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  if (S && S.won) S.winT += dt;
  let rest = dt * timeScale;
  while (rest > 0) { const step = Math.min(0.03, rest); update(step); rest -= step; }
  draw();
  requestAnimationFrame(frame);
}

// --- HUD -----------------------------------------------------------------

function updateHud() {
  const pct = S.total ? Math.round((1 - S.left / S.total) * 100) : 0;
  $('progress').style.width = pct + '%';
  $('remaining').textContent = `${S.left} pixel${S.left === 1 ? '' : 's'} left`;
}

function hideOverlays() {
  for (const o of document.querySelectorAll('.overlay')) o.classList.remove('show');
}

let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function showLoading(msg) { $('loadingText').textContent = msg; $('loading').classList.add('show'); hideOverlays(); }
function hideLoading() { $('loading').classList.remove('show'); }

function drawThumb(cv, grid, palette, size) {
  const h = grid.length, w = grid[0].length;
  const cs = Math.max(1, Math.floor(size / Math.max(w, h)));
  cv.width = w * cs * 2; cv.height = h * cs * 2;
  cv.style.width = w * cs + 'px'; cv.style.height = h * cs + 'px';
  const c = cv.getContext('2d');
  c.scale(2, 2);
  grid.forEach((row, y) => row.forEach((k, x) => {
    if (k) { c.fillStyle = palette[k]; c.fillRect(x * cs, y * cs, cs, cs); }
  }));
}

function photoSize() { return document.querySelector('input[name="psize"]:checked')?.value || 'm'; }

function openMenu() {
  const box = $('levelGrid');
  box.innerHTML = '';
  LEVELS.forEach((lv, i) => {
    const b = document.createElement('button');
    const isCur = S && S.which.index === i && S.which.seed == null && S.which.photo == null && !S.which.upload;
    b.className = 'lv' + (cleared.has(i) ? ' done' : '') + (isCur ? ' current' : '');
    const cv = document.createElement('canvas');
    drawThumb(cv, parseArt(lv.art).grid, PALETTE, 44);
    b.appendChild(cv);
    const span = document.createElement('span');
    span.textContent = (cleared.has(i) ? '✓ ' : '') + lv.name;
    b.appendChild(span);
    b.addEventListener('click', () => start({ index: i }));
    box.appendChild(b);
  });
  if (S) S.paused = true;
  $('levelsOverlay').classList.add('show');
}

function closeMenu() {
  $('levelsOverlay').classList.remove('show');
  if (S && !S.stuck) S.paused = false;
}

// --- Input ---------------------------------------------------------------

canvas.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  if (!S || !L) return;
  const x = e.clientX, y = e.clientY;
  for (let i = 0; i < L.queue.length; i++) {
    const q = L.queue[i];
    if (x >= q.x - 5 && x <= q.x + q.w + 5 && y >= q.y - q.h * 0.3 && y <= q.y + q.h * 1.9) {
      moveToRow(i);
      return;
    }
  }
});

window.addEventListener('keydown', (e) => {
  if (!S || e.metaKey || e.ctrlKey || e.altKey) return;
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= S.columns.length) { sfx.unlock(); moveToRow(n - 1); }
  if (e.key === 'r') start(S.which);
});

window.addEventListener('resize', layout);
window.addEventListener('hashchange', () => { if (location.hash !== '#upload') start(levelFromHash()); });

$('btnLevels').addEventListener('click', openMenu);
$('btnCloseLevels').addEventListener('click', closeMenu);
$('btnRandom').addEventListener('click', () => start({ seed: randSeed() }));
$('btnPhoto').addEventListener('click', () => start({ photo: randSeed(), size: photoSize() }));
$('btnUpload').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const url = URL.createObjectURL(f);
  try {
    const img = await loadImage(url, false);
    await start({ upload: true, img, size: photoSize() });
  } catch (err) {
    toast('Could not read that image.');
  } finally {
    URL.revokeObjectURL(url);
  }
});
$('btnRestart').addEventListener('click', () => start(S.which));
$('btnRetry').addEventListener('click', () => start(S.which));
$('squeeze').addEventListener('click', squeeze);
$('btnAgain').addEventListener('click', () => start(S.which));
$('btnNext').addEventListener('click', next);
const sb = $('btnSound');
const syncSound = () => { sb.textContent = sfx.isMuted() ? '🔇' : '🔊'; sb.setAttribute('aria-label', sfx.isMuted() ? 'Turn sound on' : 'Turn sound off'); };
sb.addEventListener('click', () => { sfx.unlock(); sfx.setMuted(!sfx.isMuted()); syncSound(); });
syncSound();

// Test hook: lets a headless browser play the game.
window.__nibble = {
  set timeScale(v) { timeScale = v; }, get state() { return S; }, get layout() { return L; },
  moveToRow, findTarget, start,
};

const first = levelFromHash();
start(first.upload ? { index: 0 } : first);
if (!load('seenHelp2', false)) { save('seenHelp2', true); openMenu(); }
requestAnimationFrame(frame);
