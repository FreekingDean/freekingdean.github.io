// Nibblecrate: tap a crate, its critter rides the belt round the picture and
// nibbles every pixel of its own colour it can see from the belt. Critters
// that still have an appetite after a lap wait on the dock. Fill the dock
// and the belt jams.

import { PALETTE, LEVELS, parseArt, randomPicture, makeCrates, exposedCells } from './levels.js';
import * as sfx from './sound.js';

const canvas = document.getElementById('board');
const g = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

const SPEED = 11;          // belt speed, cells per second
const SPACING = 1.3;       // min gap between critters on the belt, in cells
const DOCK_SIZE = 5;
const FLY_TIME = 0.28;

let W = 0, H = 0, DPR = 1;
let L = null;              // layout
let S = null;              // game state
let last = performance.now();
let time = 0;
let timeScale = 1;   // tests speed this up

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
  const m = location.hash.match(/(level|seed)=(\d+)/);
  if (!m) return { index: Math.min(load('level', 0), LEVELS.length - 1) };
  if (m[1] === 'seed') return { seed: +m[2] };
  return { index: Math.max(0, Math.min(LEVELS.length - 1, +m[2] - 1)) };
}

function start(which) {
  let pic, name, seed;
  if (which.seed != null) {
    seed = which.seed;
    pic = randomPicture(seed);
    name = 'Critter #' + seed;
    history.replaceState(null, '', '#seed=' + seed);
  } else {
    const lv = LEVELS[which.index];
    pic = parseArt(lv.art);
    name = lv.name;
    seed = which.index + 1;
    save('level', which.index);
    history.replaceState(null, '', '#level=' + (which.index + 1));
  }
  let total = 0;
  for (const r of pic.grid) for (const c of r) if (c) total++;
  S = {
    which, name, seed,
    w: pic.w, h: pic.h,
    grid: pic.grid,
    original: pic.grid.map((r) => r.slice()),
    total, left: total,
    columns: makeCrates(pic.grid, seed),
    dock: Array(DOCK_SIZE).fill(null),
    critters: [],
    queue: [],
    bites: [],
    bits: [],
    combo: 0, comboT: 0, bestCombo: 0,
    squeezed: false,
    paused: false,
    over: false, won: false, winT: 0,
    started: 0, elapsed: 0,
    shake: 0,
  };
  $('levelName').textContent = name;
  hideOverlays();
  layout();
  updateHud();
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
  const pad = 16;
  const cols = S.columns.length;
  const cw = Math.min(92, (W - pad * 2 - (cols - 1) * 12) / cols);
  const crateH = cw * 0.78;
  const crateArea = crateH * 2.1 + 14;
  const nSlots = S.dock.length;
  const ds = Math.min(54, (Math.min(W, 520) - pad * 2 - (nSlots - 1) * 8) / nSlots);
  const dockArea = ds + 18;
  const bottomLimit = H - safeB - 8;
  const availH = Math.max(140, bottomLimit - top - crateArea - dockArea);
  const availW = W - pad * 2;
  const cs = Math.max(8, Math.min(34, availW / (S.w + 4), availH / (S.h + 4)));
  const bw = S.w * cs, bh = S.h * cs;
  const m = cs * 2;                        // panel margin around the picture
  const panelH = bh + m * 2;
  const content = panelH + dockArea + crateArea;
  const startY = top + Math.max(0, (bottomLimit - top - content) * 0.4);
  const bx = Math.round((W - bw) / 2);
  const by = Math.round(startY + m);
  const boardBottom = startY + panelH;
  const off = cs * 1.05;

  // Track segments, starting at the bottom-left, running right along the
  // bottom, up the right side, left along the top and down the left side.
  const segs = [];
  let s0 = 0;
  const seg = (kind, len) => { segs.push({ kind, s0, len }); s0 += len; };
  seg('bottom', S.w); seg('br', 1); seg('right', S.h); seg('tr', 1);
  seg('top', S.w); seg('tl', 1); seg('left', S.h); seg('bl', 1);

  const eats = [];
  for (const sg of segs) {
    const n = sg.kind === 'bottom' || sg.kind === 'top' ? S.w : sg.kind === 'left' || sg.kind === 'right' ? S.h : 0;
    for (let i = 0; i < n; i++) eats.push({ s: sg.s0 + i + 0.5, kind: sg.kind, i });
  }

  const dockY = boardBottom + 8 + ds / 2;
  const dockW = nSlots * ds + (nSlots - 1) * 8;
  const slots = [];
  for (let i = 0; i < nSlots; i++) {
    slots.push({ x: (W - dockW) / 2 + i * (ds + 8) + ds / 2, y: dockY, size: ds });
  }

  const cratesTop = boardBottom + dockArea + crateH * 0.2 + 4;
  const totalCW = cols * cw + (cols - 1) * 12;
  const crates = [];
  for (let i = 0; i < cols; i++) {
    crates.push({ x: (W - totalCW) / 2 + i * (cw + 12), y: cratesTop, w: cw, h: crateH });
  }

  L = { cs, bx, by, bw, bh, off, segs, len: s0, eats, slots, ds, crates, cw, crateH };
  for (const c of S.critters) {
    if (c.state === 'dock') { const sl = L.slots[c.slot]; c.x = sl.x; c.y = sl.y; }
  }
}

function posAt(s) {
  const { cs, bx, by, off } = L;
  const w = S.w, h = S.h;
  s = Math.max(0, Math.min(L.len - 1e-6, s));
  let sg = L.segs[0];
  for (const x of L.segs) if (s >= x.s0) sg = x;
  const u = s - sg.s0;
  const arc = (cx, cy, a0) => {
    const a = a0 - u * Math.PI / 2;
    return { x: cx + off * Math.cos(a), y: cy + off * Math.sin(a), dx: -Math.cos(a), dy: -Math.sin(a) };
  };
  switch (sg.kind) {
    case 'bottom': return { x: bx + u * cs, y: by + h * cs + off, dx: 0, dy: -1 };
    case 'br': return arc(bx + w * cs, by + h * cs, Math.PI / 2);
    case 'right': return { x: bx + w * cs + off, y: by + h * cs - u * cs, dx: -1, dy: 0 };
    case 'tr': return arc(bx + w * cs, by, 0);
    case 'top': return { x: bx + w * cs - u * cs, y: by - off, dx: 0, dy: 1 };
    case 'tl': return arc(bx, by, -Math.PI / 2);
    case 'left': return { x: bx - off, y: by + u * cs, dx: 1, dy: 0 };
    default: return arc(bx, by + h * cs, Math.PI);
  }
}

function gatePos() { return posAt(0); }

// --- Actions -------------------------------------------------------------

let nextId = 1;

function launchFromColumn(ci) {
  if (!canAct()) return;
  const col = S.columns[ci];
  if (!col || !col.length) { sfx.nope(); return; }
  const crate = col.shift();
  const r = L.crates[ci];
  const c = {
    id: nextId++, color: crate.color, count: crate.count,
    x: r.x + r.w / 2, y: r.y + r.h * 0.3,
    state: 'fly', s: 0, nextEat: 0, chomp: 0, bounce: 1, slot: -1, ate: 0,
  };
  S.critters.push(c);
  flyTo(c, gatePos(), 'wait');
  S.queue.push(c);
  r.kick = 1;
  startClock();
  sfx.launch();
  haptic(8);
}

function launchFromDock(i) {
  if (!canAct()) return;
  const c = S.dock[i];
  if (!c || c.state !== 'dock') return;
  S.dock[i] = null;
  c.slot = -1;
  flyTo(c, gatePos(), 'wait');
  S.queue.push(c);
  sfx.launch();
  haptic(8);
}

function canAct() { return S && !S.paused && !S.over && !S.won; }

function flyTo(c, p, then) {
  c.state = 'fly';
  c.fly = { fx: c.x, fy: c.y, tx: p.x, ty: p.y, t: 0, then };
}

function startClock() { if (!S.started) S.started = performance.now(); }

function haptic(ms) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ }
}

function tryEat(c, e) {
  const { w, h, grid } = S;
  let x = -1, y = -1;
  if (e.kind === 'bottom') { x = e.i; for (let yy = h - 1; yy >= 0; yy--) if (grid[yy][x]) { y = yy; break; } }
  else if (e.kind === 'top') { x = w - 1 - e.i; for (let yy = 0; yy < h; yy++) if (grid[yy][x]) { y = yy; break; } }
  else if (e.kind === 'right') { y = h - 1 - e.i; for (let xx = w - 1; xx >= 0; xx--) if (grid[y][xx]) { x = xx; break; } }
  else { y = e.i; for (let xx = 0; xx < w; xx++) if (grid[y][xx]) { x = xx; break; } }
  if (x < 0 || y < 0 || grid[y][x] !== c.color) return;

  grid[y][x] = null;
  c.count--;
  c.ate++;
  c.chomp = 1;
  S.left--;
  S.combo++;
  S.comboT = 0.7;
  S.bestCombo = Math.max(S.bestCombo, S.combo);
  const px = L.bx + (x + 0.5) * L.cs, py = L.by + (y + 0.5) * L.cs;
  S.bites.push({ x: px, y: py, color: PALETTE[c.color], t: 0, c });
  for (let k = 0; k < 4; k++) {
    const a = Math.random() * Math.PI * 2, v = 30 + Math.random() * 70;
    S.bits.push({ x: px, y: py, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life: 0.5, max: 0.5, color: PALETTE[c.color], size: L.cs * 0.22 });
  }
  sfx.bite(S.combo);
  updateHud();
  if (c.count <= 0) {
    c.state = 'pop';
    c.popT = 0;
    sfx.done();
    haptic(14);
    burst(c.x, c.y, PALETTE[c.color], 10);
  }
  if (S.left <= 0) win();
}

function burst(x, y, color, n) {
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 140;
    S.bits.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: 0.7, max: 0.7, color, size: 3 + Math.random() * 3, star: true });
  }
}

function lapDone(c) {
  const free = S.dock.findIndex((d) => d === null);
  if (free < 0) { jam(c); return; }
  S.dock[free] = c;
  c.slot = free;
  flyTo(c, L.slots[free], 'dock');
  const used = S.dock.filter(Boolean).length;
  if (used >= S.dock.length - 1) sfx.warn(); else sfx.dock();
}

function jam(c) {
  c.state = 'limbo';
  S.jammed = c;
  S.paused = true;
  S.shake = 1;
  sfx.lose();
  haptic([30, 40, 30]);
  $('squeeze').hidden = S.squeezed;
  $('loseText').textContent = S.squeezed
    ? 'The dock overflowed again. Every critter on it was still hungry.'
    : 'A hungry critter came round and found no room on the dock.';
  setTimeout(() => $('loseOverlay').classList.add('show'), 450);
}

function squeeze() {
  if (!S.jammed) return;
  S.squeezed = true;
  S.dock.push(null);
  layout();
  const c = S.jammed;
  S.jammed = null;
  const i = S.dock.length - 1;
  S.dock[i] = c;
  c.slot = i;
  flyTo(c, L.slots[i], 'dock');
  S.paused = false;
  hideOverlays();
}

function win() {
  S.won = true;
  S.winT = 0;
  S.elapsed = S.started ? (performance.now() - S.started) / 1000 : 0;
  const key = S.which.seed != null ? null : S.which.index;
  if (key != null) { cleared.add(key); save('cleared', [...cleared]); }
  setTimeout(() => {
    sfx.win();
    haptic([20, 30, 20, 30, 40]);
    const colors = new Set();
    for (const r of S.original) for (const c of r) if (c) colors.add(PALETTE[c]);
    const cx = L.bx + L.bw / 2, cy = L.by + L.bh / 2;
    for (const col of colors) burst(cx, cy, col, 18);
  }, 250);
  setTimeout(() => {
    const secs = Math.round(S.elapsed);
    $('winTitle').textContent = S.name + ', eaten!';
    $('winText').textContent = `${S.total} pixels in ${secs}s. Longest nibble streak: ${S.bestCombo}.`;
    drawThumb($('winThumb'), S.original, 120);
    const isLast = S.which.seed == null && S.which.index === LEVELS.length - 1;
    $('btnNext').textContent = S.which.seed != null || isLast ? 'Random critter' : 'Next picture';
    $('winOverlay').classList.add('show');
  }, 1300);
}

function next() {
  if (S.which.seed == null && S.which.index < LEVELS.length - 1) start({ index: S.which.index + 1 });
  else start({ seed: 1 + Math.floor(Math.random() * 99999) });
}

// --- Update --------------------------------------------------------------

const ease = (t) => 1 - Math.pow(1 - t, 3);

function update(dt) {
  if (!S || !L) return;
  for (const r of L.crates) if (r.kick) r.kick = Math.max(0, r.kick - dt * 4);
  S.shake = Math.max(0, S.shake - dt * 2.5);

  if (!S.paused) {
    S.comboT -= dt;
    if (S.comboT <= 0) S.combo = 0;

    // Flights
    for (const c of S.critters) {
      if (c.state !== 'fly') continue;
      c.fly.t += dt / FLY_TIME;
      const t = Math.min(1, c.fly.t);
      const e = ease(t);
      c.x = c.fly.fx + (c.fly.tx - c.fly.fx) * e;
      c.y = c.fly.fy + (c.fly.ty - c.fly.fy) * e - Math.sin(t * Math.PI) * 40;
      if (t >= 1) {
        c.state = c.fly.then;
        c.bounce = 1.35;
        if (c.state === 'dock') { const sl = L.slots[c.slot]; c.x = sl.x; c.y = sl.y; }
      }
    }

    // Gate: let the next waiting critter onto the belt when there's room.
    if (S.queue.length && S.queue[0].state === 'wait') {
      const clear = !S.critters.some((o) => o.state === 'track' && o.s < SPACING);
      if (clear) {
        const c = S.queue.shift();
        c.state = 'track';
        c.s = 0;
        c.nextEat = 0;
        c.ate = 0;
      }
    }

    // Belt
    for (const c of S.critters) {
      if (c.state !== 'track') continue;
      c.s += SPEED * dt;
      while (c.state === 'track' && c.nextEat < L.eats.length && c.s >= L.eats[c.nextEat].s) {
        tryEat(c, L.eats[c.nextEat]);
        c.nextEat++;
      }
      if (c.state === 'track') {
        const p = posAt(c.s);
        c.x = p.x; c.y = p.y; c.dx = p.dx; c.dy = p.dy;
        if (c.s >= L.len) lapDone(c);
      }
    }
  }

  for (const c of S.critters) {
    c.chomp = Math.max(0, c.chomp - dt * 7);
    c.bounce += (1 - c.bounce) * Math.min(1, dt * 12);
    if (c.state === 'pop') c.popT += dt;
  }
  S.critters = S.critters.filter((c) => !(c.state === 'pop' && c.popT > 0.45));

  for (const b of S.bites) b.t += dt / 0.22;
  S.bites = S.bites.filter((b) => b.t < 1);
  for (const p of S.bits) {
    p.life -= dt;
    p.vy += 300 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  S.bits = S.bits.filter((p) => p.life > 0);
}

// --- Drawing -------------------------------------------------------------

function rr(x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
  const f = (v) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  return `rgb(${f(r)},${f(gg)},${f(b)})`;
}

function isDark(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
  return r * 0.299 + gg * 0.587 + b * 0.114 < 110;
}

function drawCritter(x, y, r, colorKey, count, look, opts = {}) {
  const col = PALETTE[colorKey];
  const chomp = opts.chomp || 0;
  const sq = opts.scale || 1;
  g.save();
  g.translate(x, y);
  g.scale(sq * (1 + chomp * 0.12), sq * (1 - chomp * 0.12));
  if (opts.alpha != null) g.globalAlpha = opts.alpha;
  // shadow
  g.fillStyle = 'rgb(0 0 0 / 0.18)';
  g.beginPath(); g.ellipse(0, r * 0.82, r * 0.8, r * 0.22, 0, 0, Math.PI * 2); g.fill();
  // ears
  g.fillStyle = shade(col, -0.2);
  for (const sx of [-1, 1]) {
    g.beginPath(); g.ellipse(sx * r * 0.55, -r * 0.78, r * 0.24, r * 0.3, sx * 0.4, 0, Math.PI * 2); g.fill();
  }
  // body
  const grad = g.createRadialGradient(-r * 0.3, -r * 0.4, r * 0.1, 0, 0, r * 1.1);
  grad.addColorStop(0, shade(col, 0.35));
  grad.addColorStop(1, shade(col, -0.12));
  g.fillStyle = grad;
  g.beginPath(); g.ellipse(0, 0, r, r * 0.92, 0, 0, Math.PI * 2); g.fill();
  g.lineWidth = Math.max(1, r * 0.09);
  g.strokeStyle = shade(col, -0.45);
  g.stroke();
  // eyes
  const lx = (look && look.dx) || 0, ly = (look && look.dy) || -1;
  const er = r * 0.24;
  for (const sx of [-1, 1]) {
    const ex = sx * r * 0.36, ey = -r * 0.32;
    g.fillStyle = '#fff';
    g.beginPath(); g.ellipse(ex, ey, er, chomp > 0.4 ? er * 0.35 : er, 0, 0, Math.PI * 2); g.fill();
    if (chomp <= 0.4) {
      g.fillStyle = '#1c1b22';
      g.beginPath(); g.arc(ex + lx * er * 0.4, ey + ly * er * 0.4, er * 0.55, 0, Math.PI * 2); g.fill();
    }
  }
  // count
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

function drawTrack() {
  const { bx, by, bw, bh, off, cs } = L;
  // panel behind everything
  const m = cs * 2;
  g.fillStyle = getVar('--panel');
  rr(bx - m, by - m, bw + m * 2, bh + m * 2, m);
  g.fill();
  g.strokeStyle = getVar('--border');
  g.lineWidth = 1;
  g.stroke();
  // belt
  g.save();
  rr(bx - off, by - off, bw + off * 2, bh + off * 2, off);
  g.lineWidth = cs * 1.3;
  g.strokeStyle = getVar('--belt');
  g.stroke();
  g.setLineDash([cs * 0.25, cs * 0.75]);
  g.lineDashOffset = (-time * SPEED * cs) % cs;
  g.lineWidth = cs * 0.9;
  g.strokeStyle = getVar('--belt-tick');
  g.stroke();
  g.restore();
  // gate marker
  const p = gatePos();
  g.fillStyle = getVar('--accent');
  g.beginPath();
  g.moveTo(p.x + cs * 0.35, p.y);
  g.lineTo(p.x - cs * 0.15, p.y - cs * 0.3);
  g.lineTo(p.x - cs * 0.15, p.y + cs * 0.3);
  g.closePath();
  g.globalAlpha = 0.5;
  g.fill();
  g.globalAlpha = 1;
}

function drawPixels() {
  const { bx, by, cs } = L;
  g.fillStyle = getVar('--board');
  g.fillRect(bx, by, L.bw, L.bh);
  for (let y = 0; y < S.h; y++) {
    for (let x = 0; x < S.w; x++) {
      const px = bx + x * cs, py = by + y * cs;
      const c = S.grid[y][x];
      if (c) {
        g.fillStyle = PALETTE[c];
        g.fillRect(px, py, cs + 0.5, cs + 0.5);
        g.fillStyle = 'rgb(255 255 255 / 0.16)';
        g.fillRect(px, py, cs, Math.max(1, cs * 0.14));
        g.fillStyle = 'rgb(0 0 0 / 0.12)';
        g.fillRect(px, py + cs - Math.max(1, cs * 0.12), cs, Math.max(1, cs * 0.12));
      } else if ((x + y) % 2) {
        g.fillStyle = getVar('--board2');
        g.fillRect(px, py, cs + 0.5, cs + 0.5);
      }
    }
  }
  // win: picture glows back in
  if (S.won) {
    const a = Math.min(1, Math.max(0, (S.winT - 0.3) / 0.6));
    if (a > 0) {
      g.globalAlpha = a;
      for (let y = 0; y < S.h; y++) for (let x = 0; x < S.w; x++) {
        const c = S.original[y][x];
        if (c) { g.fillStyle = PALETTE[c]; g.fillRect(bx + x * cs, by + y * cs, cs + 0.5, cs + 0.5); }
      }
      g.globalAlpha = 1;
    }
  }
}

function drawDock() {
  const used = S.dock.filter(Boolean).length;
  const danger = used >= S.dock.length - 1 && !S.won;
  L.slots.forEach((sl, i) => {
    const s = sl.size;
    rr(sl.x - s / 2, sl.y - s / 2, s, s, s * 0.28);
    g.fillStyle = danger ? `rgb(229 72 77 / ${0.1 + 0.08 * Math.sin(time * 8)})` : getVar('--slot');
    g.fill();
    g.setLineDash([4, 4]);
    g.strokeStyle = danger ? '#e5484d' : getVar('--border');
    g.lineWidth = 1.5;
    g.stroke();
    g.setLineDash([]);
  });
}

function drawCrates() {
  S.columns.forEach((col, i) => {
    const r = L.crates[i];
    const kick = r.kick || 0;
    // the ones behind, peeking out below
    for (let k = Math.min(col.length - 1, 2); k >= 1; k--) {
      const cr = col[k];
      const sc = 1 - k * 0.14;
      const w = r.w * sc, h = r.h * 0.4;
      const x = r.x + (r.w - w) / 2, y = r.y + r.h + 5 + (k - 1) * (h + 4);
      g.globalAlpha = 0.9 - k * 0.2;
      drawBox(x, y, w, h, cr.color, cr.count, true);
      g.globalAlpha = 1;
    }
    if (col.length > 3) {
      g.fillStyle = getVar('--muted');
      g.font = '600 11px system-ui, sans-serif';
      g.textAlign = 'right';
      g.textBaseline = 'alphabetic';
      g.fillText('+' + (col.length - 3) + ' more', r.x + r.w, r.y + r.h * 2.05 + 6);
    }
    if (!col.length) {
      rr(r.x, r.y, r.w, r.h, 10);
      g.setLineDash([5, 5]);
      g.strokeStyle = getVar('--border');
      g.lineWidth = 1.5;
      g.stroke();
      g.setLineDash([]);
      return;
    }
    const c = col[0];
    const y = r.y + kick * 6;
    // critter peeking over the top
    drawCritter(r.x + r.w / 2, y + r.h * 0.12, r.w * 0.24, c.color, null, { dx: 0, dy: -1 }, { scale: 1 + Math.sin(time * 3 + i) * 0.03 });
    drawBox(r.x, y + r.h * 0.18, r.w, r.h * 0.82, c.color, c.count, false);
  });
}

function drawBox(x, y, w, h, colorKey, count, small) {
  const col = PALETTE[colorKey];
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
  // colour label
  const lw = small ? w * 0.62 : w * 0.66, lh = small ? h * 0.62 : h * 0.56;
  const lx = x + (w - lw) / 2, ly = y + (h - lh) / 2;
  rr(lx, ly, lw, lh, Math.min(8, lh * 0.3));
  g.fillStyle = col;
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = shade(col, -0.4);
  g.stroke();
  const fs = Math.max(10, lh * (small ? 0.72 : 0.66));
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
  const r = Math.max(10, L.cs * 0.66);
  // waiting at the gate: stack them a little so you can see the queue
  let k = 0;
  for (const c of S.queue) {
    if (c.state === 'wait') {
      const p = gatePos();
      c.x = p.x - k * r * 0.5;
      c.y = p.y + k * r * 0.25;
      k++;
    }
  }
  const order = [...S.critters].sort((a, b) => (a.state === 'fly') - (b.state === 'fly'));
  for (const c of order) {
    let scale = c.bounce;
    let alpha = null;
    if (c.state === 'pop') {
      scale = 1 + c.popT * 1.6;
      alpha = Math.max(0, 1 - c.popT / 0.45);
    }
    let rad = r;
    if (c.state === 'dock') rad = Math.min(r * 1.1, L.ds * 0.36);
    const look = c.state === 'track' ? { dx: c.dx, dy: c.dy } : { dx: 0, dy: -1 };
    const jy = c.state === 'track' ? Math.sin(time * 18 + c.id) * 1.2 : c.state === 'dock' ? Math.sin(time * 2.5 + c.id) * 1.5 : 0;
    drawCritter(c.x, c.y + jy, rad, c.color, c.state === 'pop' ? null : c.count, look, { chomp: c.chomp, scale, alpha });
  }
}

function drawEffects() {
  for (const b of S.bites) {
    const t = ease(Math.min(1, b.t));
    const tx = b.c.x, ty = b.c.y;
    const x = b.x + (tx - b.x) * t, y = b.y + (ty - b.y) * t;
    const s = L.cs * (1 - t * 0.75);
    g.fillStyle = b.color;
    g.fillRect(x - s / 2, y - s / 2, s, s);
  }
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
  drawTrack();
  drawPixels();
  drawDock();
  drawCrates();
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

function drawThumb(cv, grid, size) {
  const h = grid.length, w = grid[0].length;
  const cs = Math.floor(size / Math.max(w, h));
  cv.width = w * cs * 2; cv.height = h * cs * 2;
  cv.style.width = w * cs + 'px'; cv.style.height = h * cs + 'px';
  const c = cv.getContext('2d');
  c.scale(2, 2);
  grid.forEach((row, y) => row.forEach((k, x) => {
    if (k) { c.fillStyle = PALETTE[k]; c.fillRect(x * cs, y * cs, cs, cs); }
  }));
}

function openLevels() {
  const box = $('levelGrid');
  box.innerHTML = '';
  LEVELS.forEach((lv, i) => {
    const b = document.createElement('button');
    b.className = 'lv' + (cleared.has(i) ? ' done' : '') + (S.which.index === i && S.which.seed == null ? ' current' : '');
    const cv = document.createElement('canvas');
    drawThumb(cv, parseArt(lv.art).grid, 44);
    b.appendChild(cv);
    const span = document.createElement('span');
    span.textContent = (cleared.has(i) ? '✓ ' : '') + lv.name;
    b.appendChild(span);
    b.addEventListener('click', () => start({ index: i }));
    box.appendChild(b);
  });
  S.paused = true;
  $('levelsOverlay').classList.add('show');
}

function closeLevels() {
  $('levelsOverlay').classList.remove('show');
  if (!S.jammed) S.paused = false;
}

// --- Input ---------------------------------------------------------------

canvas.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  if (!S || !L) return;
  const x = e.clientX, y = e.clientY;
  for (let i = 0; i < L.crates.length; i++) {
    const r = L.crates[i];
    if (x >= r.x - 6 && x <= r.x + r.w + 6 && y >= r.y - r.h * 0.25 && y <= r.y + r.h * 1.5) {
      launchFromColumn(i);
      return;
    }
  }
  for (let i = 0; i < L.slots.length; i++) {
    const s = L.slots[i];
    if (Math.abs(x - s.x) <= s.size / 2 + 4 && Math.abs(y - s.y) <= s.size / 2 + 6) {
      launchFromDock(i);
      return;
    }
  }
});

window.addEventListener('keydown', (e) => {
  if (!S) return;
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= S.columns.length) { sfx.unlock(); launchFromColumn(n - 1); }
  if (e.key === 'r' && !e.metaKey && !e.ctrlKey) start(S.which);
});

window.addEventListener('resize', layout);
window.addEventListener('hashchange', () => start(levelFromHash()));

$('btnLevels').addEventListener('click', openLevels);
$('btnCloseLevels').addEventListener('click', closeLevels);
$('btnRandom').addEventListener('click', () => start({ seed: 1 + Math.floor(Math.random() * 99999) }));
$('btnRestart').addEventListener('click', () => start(S.which));
$('btnRetry').addEventListener('click', () => start(S.which));
$('squeeze').addEventListener('click', squeeze);
$('btnAgain').addEventListener('click', () => start(S.which));
$('btnNext').addEventListener('click', next);
const sb = $('btnSound');
const syncSound = () => { sb.textContent = sfx.isMuted() ? '🔇' : '🔊'; sb.setAttribute('aria-label', sfx.isMuted() ? 'Turn sound on' : 'Turn sound off'); };
sb.addEventListener('click', () => { sfx.unlock(); sfx.setMuted(!sfx.isMuted()); syncSound(); });
syncSound();

// Debug/testing hook: lets a headless browser check the game is solvable.
window.__nibble = { set timeScale(v) { timeScale = v; }, get state() { return S; }, get layout() { return L; }, launchFromColumn, launchFromDock, exposedCells };

start(levelFromHash());
if (!load('seenHelp', false)) { save('seenHelp', true); openLevels(); }
requestAnimationFrame(frame);
