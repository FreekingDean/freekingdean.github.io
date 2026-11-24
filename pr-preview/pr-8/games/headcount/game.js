// Headcount: an auto-runner where a crowd passes math gates, shoots, fights and
// faces a boss. Plain canvas 2D with a simple perspective projection.
(() => {
  "use strict";

  // ---------- tiny helpers ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const fmt = (n) => {
    n = Math.round(n);
    const a = Math.abs(n);
    if (a < 10000) return n.toLocaleString();
    if (a < 1e6) return (n / 1000).toFixed(a < 1e5 ? 1 : 0) + "k";
    if (a < 1e9) return (n / 1e6).toFixed(a < 1e7 ? 2 : 1) + "M";
    return (n / 1e9).toFixed(1) + "B";
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem("headcount." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("headcount." + k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  // ---------- sound ----------
  const sound = {
    ctx: null, on: store.get("sound", true), lastShot: 0,
    init() {
      if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { this.ctx = null; }
    },
    tone(freq, dur, type = "square", vol = 0.08, slide = 0, delay = 0) {
      if (!this.on || !this.ctx) return;
      const c = this.ctx, t = c.currentTime + delay;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(c.destination);
      o.start(t); o.stop(t + dur + 0.02);
    },
    noise(dur, vol = 0.15, delay = 0) {
      if (!this.on || !this.ctx) return;
      const c = this.ctx, t = c.currentTime + delay;
      const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const s = c.createBufferSource(), g = c.createGain();
      s.buffer = buf; g.gain.value = vol;
      s.connect(g).connect(c.destination); s.start(t);
    },
    good() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.12, "square", 0.06, 0, i * 0.05)); },
    bad() { [392, 311, 233].forEach((f, i) => this.tone(f, 0.16, "sawtooth", 0.06, 0, i * 0.07)); },
    shot(now) { if (now - this.lastShot < 0.11) return; this.lastShot = now; this.tone(1400, 0.03, "square", 0.012, 0.5); },
    tick() { this.tone(880 + Math.random() * 300, 0.04, "triangle", 0.05); },
    pop() { this.tone(300 + Math.random() * 200, 0.08, "triangle", 0.07, 2); },
    crack() { this.noise(0.25, 0.2); this.tone(160, 0.2, "square", 0.06, 0.4); },
    power() { [660, 880, 1320].forEach((f, i) => this.tone(f, 0.1, "triangle", 0.08, 0, i * 0.06)); },
    thud() { this.noise(0.35, 0.35); this.tone(90, 0.35, "sine", 0.25, 0.5); },
    win() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, 0.18, "square", 0.06, 0, i * 0.1)); },
    lose() { [440, 370, 311, 262].forEach((f, i) => this.tone(f, 0.25, "triangle", 0.08, 0, i * 0.15)); },
  };
  const buzz = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* ignore */ } };

  // ---------- canvas & projection ----------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, DPR = 1, F = 1, HOR = 0;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    F = Math.min(H * 0.9, W * 1.6);
    HOR = H * 0.24;
  }
  window.addEventListener("resize", resize);
  resize();

  const CAM_BACK = 5.2, CAM_Y = 3.3;
  let camZ = 0, camX = 0;
  function proj(x, y, z) {
    const dz = z - camZ;
    if (dz < 0.35) return null;
    const s = F / dz;
    return { x: W / 2 + (x - camX) * s, y: HOR + (CAM_Y - y) * s, s };
  }

  // ---------- game state ----------
  const ROAD = 1; // road half-width in world units
  const CAP = 180; // max crowd members drawn; the count can go far higher
  const SPACING = 0.058;
  const BASE_SPEED = 8;

  let level = store.get("level", 1);
  let best = store.get("best", 0);
  let state = "menu"; // menu | run | boss | won | lost
  let time = 0;

  const crowd = { x: 0, targetX: 0, z: 0, count: 0, members: [], R: 0, shownCount: 0, labelBump: 0, speed: BASE_SPEED };
  const power = { rapid: 0, spread: 0, shield: 0 };
  let fireTimer = 0;
  let shake = 0, flash = 0, flashColor = "#fff";
  let clashTimer = 0;
  let statsBump = 0;
  let L = 200;
  let gates = [], crates = [], mobs = [], saws = [], pickups = [], bullets = [], particles = [], popups = [], confetti = [];
  let boss = null;
  let minis = [];
  const gun = { dmg: 1, rate: 1, guns: 0 };
  let deco = [];

  const ui = {
    levelName: document.getElementById("levelName"),
    progress: document.getElementById("progressFill"),
    sound: document.getElementById("btnSound"),
    start: document.getElementById("startOverlay"),
    win: document.getElementById("winOverlay"),
    lose: document.getElementById("loseOverlay"),
    stats: document.getElementById("stats"),
  };
  function show(el, on) { el.classList.toggle("show", on); }
  function updateSoundBtn() {
    ui.sound.textContent = sound.on ? "🔊" : "🔇";
    ui.sound.setAttribute("aria-label", sound.on ? "Turn sound off" : "Turn sound on");
  }
  updateSoundBtn();
  function updateStats() {
    ui.stats.textContent = best > 0 ? `Best headcount at a finish: ${best.toLocaleString()} · Level ${level}` : `Level ${level}`;
  }
  updateStats();

  // ---------- gates ----------
  // Math ops: "+" (val may be negative), "x", "/". Upgrade ops: "dmg", "dmgx", "rate", "gun".
  const UPGRADE_OPS = new Set(["dmg", "dmgx", "rate", "gun"]);
  function applyOp(op, val, n) {
    if (op === "+") return Math.max(0, n + val);
    if (op === "x") return n * val;
    if (op === "/") return Math.floor(n / val);
    return n;
  }
  function opLabel(op, val) {
    if (op === "+") return val >= 0 ? "+" + fmt(val) : "−" + fmt(Math.abs(val));
    if (op === "x") return "×" + val;
    if (op === "/") return "÷" + val;
    if (op === "dmg") return "💥+" + fmt(val);
    if (op === "dmgx") return "💥×" + val;
    if (op === "rate") return "🔥+" + val + "%";
    return "🎯+" + val;
  }
  const isUpgrade = (side) => UPGRADE_OPS.has(side.op);
  const isGood = (side) => isUpgrade(side) ? !(side.lock > 0) : (side.op === "+" && side.val > 0) || side.op === "x";
  function sideAt(g, x) {
    for (let i = 0; i < g.sides.length; i++) if (x < g.sides[i].x1) return i;
    return g.sides.length - 1;
  }
  function makeRow(z, sides, small = false) {
    const n = sides.length, w = (ROAD * 2) / n;
    sides.forEach((sd, i) => { sd.x0 = -ROAD + i * w; sd.x1 = -ROAD + (i + 1) * w; sd.prog = 0; sd.bump = 0; sd.lockMax = sd.lock || 0; });
    gates.push({ z, sides, small, passed: false, chosen: -1, t: 0 });
  }
  const mathSide = (op, val, shoot = false) => ({ op, val, shoot });

  // ---------- level generation ----------
  function buildLevel() {
    gates = []; crates = []; mobs = []; saws = []; pickups = []; bullets = []; particles = []; popups = []; confetti = []; minis = [];
    L = 230 + Math.min(level, 12) * 25;
    const lv = level;
    let est = 6; // rough guess of how big the crowd is at this point
    let pow = 1; // rough guess of how hard it hits (damage × fire rate × guns)
    let z = 16;
    let i = 0;
    const miniAt = [0.36, 0.7].concat(lv >= 4 ? [0.53] : []).map((f) => f * L).sort((a, b) => a - b);
    while (z < L - 26) {
      if (miniAt.length && z >= miniAt[0]) {
        miniAt.shift();
        const hp = Math.round((22 + est * 1.6 + lv * 10) * pow);
        minis.push(makeMini(z + 6, hp, lv));
        est *= 0.85; pow *= 1.35;
        z += 20;
        continue;
      }
      const roll = Math.random();
      let kind;
      if (i < 2) kind = "gate";
      else if (i === 2) kind = "gauntlet";
      else if (roll < 0.2) kind = "gate";
      else if (roll < 0.34) kind = "gauntlet";
      else if (roll < 0.46) kind = "upgrade";
      else if (roll < 0.68) kind = "mob";
      else if (roll < 0.8) kind = "crate";
      else if (roll < 0.9) kind = "saw";
      else kind = "pickup";

      if (kind === "gate") {
        const good = makeGoodGate(est, lv);
        const bad = makeBadGate(est, lv);
        makeRow(z, Math.random() < 0.5 ? [good, bad] : [bad, good]);
        est = Math.max(3, applyOp(good.op, good.val, est) * 0.8 + applyOp(bad.op, Math.max(bad.val, 0), est) * 0.2);
        z += rand(12, 15);
      } else if (kind === "gauntlet") {
        // a quick run of small gates, one after another
        const rows = randi(4, 6 + Math.min(4, lv));
        const lanes = pick([2, 3, 3, 4]);
        const big = Math.max(2, Math.round(2 + est * 0.12));
        for (let r = 0; r < rows; r++) {
          const sides = [];
          for (let k = 0; k < lanes; k++) {
            const q = Math.random();
            if (q < 0.12 && r > 0) sides.push(mathSide("x", 2));
            else if (q < 0.6) sides.push(mathSide("+", randi(1, big)));
            else sides.push(mathSide("+", -randi(1, Math.max(1, Math.round(big * 0.8))), true));
          }
          if (!sides.some((sd) => isGood(sd))) sides[randi(0, lanes - 1)] = mathSide("+", randi(1, big));
          makeRow(z, sides, true);
          const vals = sides.map((sd) => applyOp(sd.op, sd.val, est));
          est = Math.max(3, Math.max(...vals) * 0.7 + (vals.reduce((a, b) => a + b, 0) / lanes) * 0.3);
          z += 3.2;
        }
        z += rand(9, 12);
      } else if (kind === "upgrade") {
        const up = makeUpgrade(pow, lv, true);
        const other = Math.random() < 0.5 ? makeGoodGate(est, lv) : makeUpgrade(pow, lv, false);
        makeRow(z, Math.random() < 0.5 ? [up, other] : [other, up]);
        pow *= 1.25;
        if (!isUpgrade(other)) est = Math.max(3, applyOp(other.op, other.val, est) * 0.5 + est * 0.5);
        z += rand(13, 16);
      } else if (kind === "mob") {
        const pattern = Math.random();
        if (pattern < 0.3) {
          // rushing wave: several small crowds sprinting in quick succession
          const waves = randi(3, 4 + Math.min(2, Math.floor(lv / 3)));
          for (let k = 0; k < waves; k++) {
            const count = Math.max(2, Math.round(est * rand(0.1, 0.2) * Math.sqrt(pow) + lv));
            mobs.push(makeMob(rand(-0.5, 0.5), z + 5 + k * 3.5, count, 4.5));
            est = Math.max(3, est - count * 0.4);
          }
          z += 14 + waves * 3.5;
        } else if (pattern < 0.55) {
          // two crowds side by side
          for (const x of [-0.5, 0.5]) {
            const count = Math.max(2, Math.round(est * rand(0.3, 0.5) * Math.sqrt(pow) + lv * 2));
            mobs.push(makeMob(x, z + 5, count));
          }
          est = Math.max(3, est * 0.75);
          z += rand(16, 19);
        } else {
          const count = Math.max(3, Math.round(est * rand(0.4, 0.75) * Math.sqrt(pow) + lv * 2));
          mobs.push(makeMob(Math.random() < 0.5 ? 0 : rand(-0.5, 0.5), z + 5, count));
          est = Math.max(3, est - count * 0.5);
          z += rand(15, 18);
        }
      } else if (kind === "crate") {
        const n = Math.random() < 0.5 ? 1 : 2;
        const xs = n === 1 ? [rand(-0.6, 0.6)] : [-0.55, 0.55];
        for (const x of xs) {
          const hp = Math.max(3, Math.round((5 + est * 0.1 + lv * 2) * pow));
          crates.push({ x, z: z + 2, hp, max: hp, w: 0.3, hit: 0, drop: pick(["rapid", "spread", "shield", "plus", "dmg", "rate", "gun", "dmg"]) });
        }
        pow *= 1.1;
        z += rand(11, 14);
      } else if (kind === "saw") {
        const n = Math.random() < 0.35 + lv * 0.03 ? 2 : 1;
        for (let k = 0; k < n; k++) {
          saws.push({ z: z + 2 + k * 4, amp: rand(0.45, 0.8), freq: rand(1.1, 1.8) + lv * 0.05, phase: rand(0, 6.28), r: 0.2, x: 0 });
        }
        z += 11 + n * 3;
      } else {
        pickups.push({ x: rand(-0.6, 0.6), z: z + 2, type: pick(["rapid", "spread", "shield", "plus", "dmg"]), t: rand(0, 6) });
        z += rand(8, 11);
      }
      i++;
    }
    const hp = Math.round((70 + est * 4 + lv * 30) * pow);
    boss = { z: L + 3, hp, max: hp, hit: 0, t: 0, nextSlam: 2.2, slam: null, dead: false, deadT: 0, wobble: 0 };

    deco = [];
    for (let k = 0; k < L / 3; k++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      deco.push({ x: side * rand(1.6, 5), z: rand(0, L + 12), type: Math.random() < 0.65 ? "tree" : "rock", s: rand(0.7, 1.3) });
    }
  }
  function makeGoodGate(est, lv) {
    const r = Math.random();
    if (r < 0.4 && est > 3) {
      const opts = [2, 2, 3];
      if (lv >= 2 || est > 40) opts.push(3, 4);
      if (lv >= 4) opts.push(5);
      return mathSide("x", pick(opts));
    }
    return mathSide("+", Math.max(3, Math.round(est * rand(0.6, 1.3) + rand(3, 8) + lv * 2)));
  }
  function makeBadGate(est, lv) {
    const r = Math.random();
    // Shootable red gate: starts negative, climbs as you shoot it.
    if (r < 0.5) return mathSide("+", -Math.max(3, Math.round(est * rand(0.25, 0.5) + lv)), true);
    if (r < 0.75 && est > 8) return mathSide("/", pick([2, 2, 3, lv >= 3 ? 4 : 2]));
    return mathSide("+", -Math.max(2, Math.round(est * rand(0.3, 0.6))));
  }
  function makeUpgrade(pow, lv, locked) {
    const r = Math.random();
    let sd;
    if (r < 0.35) sd = { op: "dmg", val: Math.max(1, Math.round(pow * rand(0.6, 1.2))) };
    else if (r < 0.5) sd = { op: "dmgx", val: 2 };
    else if (r < 0.75) sd = { op: "rate", val: pick([25, 30, 40, 50]) };
    else sd = { op: "gun", val: pick([1, 1, 2]) };
    if (locked) sd.lock = Math.round((8 + lv * 3) * pow * rand(0.8, 1.2));
    return sd;
  }
  function makeMob(x, z, count, speed = 1.6) {
    const m = { x, z, count, members: [], R: 0, alive: true, walking: false, speed };
    syncMembers(m.members, Math.min(count, 120), true);
    return m;
  }
  function makeMini(z, hp, lv) {
    const kinds = [
      { name: "BRUTE", c1: "#ff9d5c", c2: "#d9481f", horn: "#fff2d6" },
      { name: "BULK", c1: "#7fe08a", c2: "#2f9a4a", horn: "#f6f1d0" },
      { name: "SPIKE", c1: "#ff7aa8", c2: "#c2306b", horn: "#ffe7f0" },
    ];
    return { x: 0, z, hp, max: hp, R: 0.55, alive: true, hit: 0, walking: false, kind: pick(kinds), acc: 0, deadT: 0 };
  }

  // ---------- crowd members ----------
  function formationSlot(i) {
    const r = SPACING * Math.sqrt(i + 0.3);
    const a = i * 2.39996;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r * 1.25 };
  }
  function syncMembers(arr, n, instant) {
    while (arr.length < n) {
      const s = formationSlot(arr.length);
      arr.push({ x: instant ? s.x : rand(-0.03, 0.03), z: instant ? s.z : rand(-0.03, 0.03), ph: rand(0, 6.28), pop: instant ? 0 : 1 });
    }
    if (arr.length > n) arr.length = n;
  }
  function radiusFor(n) { return SPACING * Math.sqrt(Math.min(n, CAP) + 0.3) + 0.05; }
  function setCount(n) {
    n = Math.max(0, Math.round(n));
    crowd.count = n;
    syncMembers(crowd.members, Math.min(n, CAP), false);
    crowd.labelBump = 1;
  }
  // Remove a specific shown member (killed by a hazard). Keeps count authoritative.
  function killMember(idx, color = "#3d7bf2") {
    const m = crowd.members[idx];
    if (!m) return;
    burst(crowd.x + m.x, 0.15, crowd.z + m.z, color, 6, 1.6);
    crowd.members.splice(idx, 1);
    crowd.count = Math.max(0, crowd.count - 1);
    if (crowd.count > crowd.members.length) syncMembers(crowd.members, Math.min(crowd.count, CAP), false);
  }
  function loseMembers(n, color) {
    n = Math.min(n, crowd.count);
    for (let k = 0; k < n; k++) {
      if (crowd.count > crowd.members.length) { crowd.count--; continue; }
      killMember(crowd.members.length - 1 - Math.floor(Math.random() * Math.min(8, crowd.members.length)), color);
    }
  }

  // ---------- particles & popups ----------
  function burst(x, y, z, color, n = 10, speed = 2.5) {
    for (let k = 0; k < n; k++) {
      particles.push({ x, y, z, vx: rand(-1, 1) * speed, vy: rand(0.5, 1.5) * speed, vz: rand(-1, 1) * speed, life: rand(0.4, 0.8), max: 0.8, color, size: rand(0.025, 0.05) });
    }
    if (particles.length > 900) particles.splice(0, particles.length - 900);
  }
  function popup(x, y, z, text, color, size = 1) {
    popups.push({ x, y, z, text, color, life: 1, size });
  }

  // ---------- input ----------
  let dragging = false, lastPX = 0;
  const keys = {};
  canvas.addEventListener("pointerdown", (e) => { dragging = true; lastPX = e.clientX; canvas.setPointerCapture(e.pointerId); sound.init(); });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastPX; lastPX = e.clientX;
    const roadPx = Math.max(140, F / CAM_BACK); // pixels per world unit near the crowd
    crowd.targetX += (dx / roadPx) * 1.15;
  });
  const endDrag = () => { dragging = false; };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  window.addEventListener("keydown", (e) => {
    keys[e.key] = true;
    if ((e.key === " " || e.key === "Enter") && state === "menu") startRun();
  });
  window.addEventListener("keyup", (e) => { keys[e.key] = false; });

  ui.sound.addEventListener("click", () => { sound.on = !sound.on; store.set("sound", sound.on); sound.init(); updateSoundBtn(); });
  document.getElementById("btnStart").addEventListener("click", startRun);
  document.getElementById("btnRetry").addEventListener("click", startRun);
  document.getElementById("btnReplay").addEventListener("click", startRun);
  document.getElementById("btnNext").addEventListener("click", () => { level++; store.set("level", level); startRun(); });

  function startRun() {
    sound.init();
    show(ui.start, false); show(ui.win, false); show(ui.lose, false);
    buildLevel();
    crowd.x = 0; crowd.targetX = 0; crowd.z = 0; crowd.members = []; crowd.speed = BASE_SPEED;
    power.rapid = power.spread = power.shield = 0;
    gun.dmg = 1; gun.rate = 1; gun.guns = 0;
    setCount(5);
    for (const m of crowd.members) { const s = formationSlot(crowd.members.indexOf(m)); m.x = s.x; m.z = s.z; m.pop = 0; }
    state = "run";
    ui.levelName.textContent = "Level " + level;
  }

  // ---------- update ----------
  function update(dt) {
    time += dt;
    shake = Math.max(0, shake - dt * 3);
    flash = Math.max(0, flash - dt * 2.5);
    crowd.labelBump = Math.max(0, crowd.labelBump - dt * 4);
    statsBump = Math.max(0, statsBump - dt * 3);

    updateParticles(dt);
    if (state === "menu") { camZ = -CAM_BACK + Math.sin(time * 0.3) * 0.5; return; }

    if (state === "run" || state === "boss") {
      // steering
      const kdir = (keys.ArrowRight || keys.d || keys.D ? 1 : 0) - (keys.ArrowLeft || keys.a || keys.A ? 1 : 0);
      crowd.targetX += kdir * dt * 2.6;
      crowd.R = radiusFor(crowd.count);
      const lim = Math.max(0.35, ROAD - crowd.R * 0.75);
      crowd.targetX = clamp(crowd.targetX, -lim, lim);
      crowd.x = lerp(crowd.x, crowd.targetX, 1 - Math.exp(-dt * 14));

      for (const k in power) power[k] = Math.max(0, power[k] - dt);

      // forward motion
      let speed = BASE_SPEED;
      if (clashTimer > 0) { speed *= 0.12; clashTimer -= dt; }
      if (state === "boss") speed = 0;
      crowd.speed = lerp(crowd.speed, speed, 1 - Math.exp(-dt * 8));
      const prevZ = crowd.z;
      crowd.z += crowd.speed * dt;
      if (state === "run" && crowd.z >= L - 4) {
        crowd.z = L - 4; state = "boss"; boss.t = 0; sound.thud(); shake = 0.6;
        // the grump bulks up to match you, so the finale is always a real fight
        const dps = (gunsPerVolley() * dmgNow() * gun.rate) / 0.13;
        boss.hp = boss.max = Math.round(Math.max(boss.hp, boss.hp * 0.3 + dps * 5));
        popup(0, 2.6, boss.z, "GRUMP " + fmt(boss.hp), "#b07cff", 1.3);
      }

      // members settle into formation
      const ms = crowd.members;
      const k = 1 - Math.exp(-dt * 9);
      for (let i = 0; i < ms.length; i++) {
        const s = formationSlot(i), m = ms[i];
        m.x = lerp(m.x, s.x, k); m.z = lerp(m.z, s.z, k);
        m.pop = Math.max(0, m.pop - dt * 4);
      }

      shoot(dt);
      updateBullets(dt);
      updateGates(prevZ);
      updateCrates();
      updateMobs(dt);
      updateMinis(dt);
      updateSaws(dt);
      updatePickups(dt);
      if (state === "boss") updateBoss(dt);

      if (crowd.count <= 0 && state !== "won") lose();
    } else if (state === "won") {
      if (boss) boss.deadT += dt;
      const ms = crowd.members;
      for (let i = 0; i < ms.length; i++) { const s = formationSlot(i); ms[i].x = lerp(ms[i].x, s.x, 0.1); ms[i].z = lerp(ms[i].z, s.z, 0.1); }
    }

    camZ = lerp(camZ, crowd.z - CAM_BACK, 1 - Math.exp(-dt * 10));
    camX = lerp(camX, crowd.x * 0.35, 1 - Math.exp(-dt * 6));
    ui.progress.style.width = clamp(crowd.z / (L - 4), 0, 1) * 100 + "%";
  }

  const dmgNow = () => Math.max(1, Math.round(gun.dmg * (1 + crowd.count / 500)));
  const gunsPerVolley = () => Math.min(1 + Math.floor(Math.sqrt(crowd.count) * 0.9), 11) + gun.guns;
  function shoot(dt) {
    fireTimer -= dt;
    if (fireTimer > 0 || crowd.count <= 0) return;
    fireTimer += (power.rapid > 0 ? 0.065 : 0.13) / gun.rate;
    if (fireTimer < 0) fireTimer = 0;
    const n = gunsPerVolley();
    const dmg = dmgNow();
    const spread = power.spread > 0;
    const w = Math.max(0.02, crowd.R * 0.75 + Math.min(0.25, gun.guns * 0.03));
    const front = crowd.z + crowd.R * 1.2;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1) - 0.5;
      bullets.push({ x: crowd.x + t * 2 * w + rand(-0.02, 0.02), z: front, vx: spread ? t * 1.2 : 0, life: 0.75, dmg });
      if (spread) {
        bullets.push({ x: crowd.x + t * 2 * w, z: front, vx: -1.4 + t, life: 0.7, dmg });
        bullets.push({ x: crowd.x + t * 2 * w, z: front, vx: 1.4 + t, life: 0.7, dmg });
      }
    }
    if (bullets.length > 700) bullets.splice(0, bullets.length - 700);
    sound.shot(time);
  }
  function bulletsPerVolley() { return gunsPerVolley() * (power.spread > 0 ? 3 : 1) * (power.rapid > 0 ? 2 : 1) * gun.rate; }

  function updateBullets(dt) {
    const hitCost = Math.max(1, bulletsPerVolley() * 0.45);
    const step = Math.max(1, Math.round(Math.sqrt(dmgNow())));
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      const z0 = b.z;
      b.z += 30 * dt; b.x += b.vx * dt; b.life -= dt;
      let hit = false;
      if (Math.abs(b.x) > ROAD + 0.15 || b.life <= 0) { bullets.splice(i, 1); continue; }
      // gates (unpassed) absorb bullets
      for (const g of gates) {
        if (g.passed || g.z < z0 || g.z > b.z) continue;
        const idx = sideAt(g, b.x), side = g.sides[idx];
        const mid = (side.x0 + side.x1) / 2;
        if (side.lock > 0) {
          side.lock -= b.dmg; side.bump = 0.6;
          if (side.lock <= 0) { side.lock = 0; sound.power(); popup(mid, 1.6, g.z, "unlocked!", "#ffd23f", 0.9); burst(mid, 0.8, g.z, "#ffd23f", 20, 3); }
          else if (Math.random() < 0.15) sound.tick();
        } else if (side.shoot && side.op === "+") {
          side.prog += 1 / hitCost;
          while (side.prog >= 1) {
            side.prog -= 1;
            const was = side.val;
            side.val += step; side.bump = 1;
            if (was <= 0 && side.val > 0) { sound.good(); popup(mid, 1.6, g.z, "flipped!", "#2f7cf6", 0.8); }
            else if (Math.random() < 0.5) sound.tick();
          }
        }
        burst(b.x, g.small ? 0.4 : 0.7, g.z - 0.05, side.shoot || side.lock ? "#ffe066" : "#ffffff", 2, 1.2);
        hit = true; break;
      }
      if (!hit) for (const c of crates) {
        if (c.hp <= 0 || Math.abs(b.x - c.x) > c.w || b.z < c.z - c.w || z0 > c.z + c.w) continue;
        c.hp = Math.max(0, c.hp - b.dmg); c.hit = 1;
        burst(b.x, 0.4, c.z - c.w, "#c98a4b", 2, 1.5);
        if (c.hp <= 0) breakCrate(c);
        hit = true; break;
      }
      if (!hit) for (const m of minis) {
        if (!m.alive || Math.abs(b.x - m.x) > m.R || b.z < m.z - m.R * 0.6 || z0 > m.z + m.R) continue;
        m.hp -= b.dmg; m.hit = 1; m.walking = true;
        burst(b.x, rand(0.3, 1), m.z - m.R * 0.6, "#ffd23f", 2, 2);
        if (m.hp <= 0) killMini(m);
        hit = true; break;
      }
      if (!hit) for (const m of mobs) {
        if (!m.alive || m.count <= 0) continue;
        const front = m.z - m.R * 1.25;
        if (b.z < front || z0 > m.z + m.R || Math.abs(b.x - m.x) > m.R + 0.04) continue;
        const k = Math.min(m.count, b.dmg);
        m.count -= k; m.walking = true;
        for (let q = 0; q < k && m.members.length > m.count; q++) {
          const mm = m.members.pop();
          if (mm && q < 3) burst(m.x + mm.x, 0.15, m.z + mm.z, "#e5484d", 5, 1.5);
        }
        if (Math.random() < 0.3) sound.pop();
        if (m.count <= 0) { m.alive = false; popup(m.x, 0.8, m.z, "cleared", "#ffffff", 0.8); }
        hit = true; break;
      }
      if (!hit && boss && !boss.dead && state === "boss" && b.z >= boss.z - 0.9) {
        boss.hp -= b.dmg; boss.hit = 1;
        burst(b.x, rand(0.4, 1.6), boss.z - 0.8, "#ffd23f", 2, 2);
        if (boss.hp <= 0) win();
        hit = true;
      }
      if (hit) bullets.splice(i, 1);
    }
  }

  function applyUpgrade(op, val, x, z) {
    let text;
    if (op === "dmg") { gun.dmg += val; text = `💥 Damage +${val}`; }
    else if (op === "dmgx") { gun.dmg *= val; text = `💥 Damage ×${val}`; }
    else if (op === "rate") { gun.rate = Math.min(5, gun.rate * (1 + val / 100)); text = `🔥 Fire rate +${val}%`; }
    else { gun.guns = Math.min(12, gun.guns + val); text = `🎯 +${val} gun${val > 1 ? "s" : ""}`; }
    popup(x, 1.5, z, text, "#ffd23f", 1.1);
    sound.power(); buzz(20);
    flash = 0.3; flashColor = "rgba(255,210,63,0.5)";
    statsBump = 1;
  }

  function updateGates(prevZ) {
    const front = crowd.z;
    for (const g of gates) {
      for (const s of g.sides) s.bump = Math.max(0, s.bump - 0.08);
      if (g.passed) { g.t += 1 / 60; continue; }
      if (prevZ < g.z && front >= g.z) {
        g.passed = true;
        const idx = sideAt(g, crowd.x);
        g.chosen = idx;
        const side = g.sides[idx];
        const mid = (side.x0 + side.x1) / 2;
        if (isUpgrade(side)) {
          if (side.lock > 0) { popup(crowd.x, 1.3, crowd.z + 0.6, "🔒 still locked", "#ffffff", 0.9); sound.bad(); }
          else applyUpgrade(side.op, side.val, crowd.x, crowd.z + 0.6);
          burst(mid, 0.9, g.z, "#ffd23f", 20, 3);
          continue;
        }
        const before = crowd.count;
        const after = applyOp(side.op, side.val, before);
        setCount(after);
        const diff = after - before;
        const good = diff >= 0;
        popup(crowd.x, g.small ? 1.0 : 1.3, crowd.z + 0.6, (good ? "+" : "−") + fmt(Math.abs(diff)), good ? "#2f7cf6" : "#e5484d", g.small ? 1 : 1.4);
        flash = g.small ? 0.15 : 0.35; flashColor = good ? "rgba(80,150,255,0.6)" : "rgba(229,72,77,0.6)";
        if (good) { if (g.small) sound.tick(); else sound.good(); buzz(10); }
        else { if (g.small) sound.pop(); else sound.bad(); shake = g.small ? 0.2 : 0.5; buzz(g.small ? 15 : [30, 30, 30]); }
        burst(mid, g.small ? 0.5 : 0.9, g.z, good ? "#7fb2ff" : "#ff8a8d", g.small ? 10 : 26, 3);
      }
    }
  }

  function killMini(m) {
    m.alive = false; m.hp = 0;
    sound.thud(); sound.win(); shake = 0.8; buzz([40, 30, 60]);
    burst(m.x, 0.8, m.z, m.kind.c1, 50, 5);
    burst(m.x, 0.8, m.z, "#ffd23f", 30, 4);
    popup(m.x, 1.8, m.z, m.kind.name + " DOWN!", "#ffd23f", 1.4);
    const drops = ["dmg", pick(["rate", "gun"]), pick(["plus", "spread", "rapid"])];
    drops.forEach((t, k) => pickups.push({ x: (k - 1) * 0.5, z: m.z - 0.5, type: t, t: 0 }));
  }
  function updateMinis(dt) {
    for (const m of minis) {
      if (!m.alive) { m.deadT += dt; continue; }
      m.hit = Math.max(0, m.hit - dt * 6);
      const dist = m.z - crowd.z;
      if (dist < 22) m.walking = true;
      const gap = (m.z - m.R * 0.6) - (crowd.z + crowd.R * 1.25);
      if (m.walking && gap > 0) m.z -= 1.3 * dt;
      m.x = lerp(m.x, clamp(crowd.x, -0.4, 0.4), dt * 0.8);
      if (gap < 0.05) {
        clashTimer = 0.15;
        if (crowd.z > m.z - m.R * 0.6 - crowd.R * 1.25) crowd.z = Math.max(crowd.z - 0.02, m.z - m.R * 0.6 - crowd.R * 1.25);
        m.acc += dt * (6 + level * 1.5 + crowd.count * 0.04);
        if (power.shield > 0) m.acc = 0;
        while (m.acc >= 1 && crowd.count > 0) { m.acc -= 1; loseMembers(1, "#3d7bf2"); if (Math.random() < 0.3) sound.pop(); }
        shake = Math.max(shake, 0.2);
      }
    }
  }

  function breakCrate(c) {
    sound.crack(); shake = Math.max(shake, 0.25); buzz(20);
    burst(c.x, 0.3, c.z, "#c98a4b", 18, 3);
    burst(c.x, 0.3, c.z, "#8b5a2b", 10, 2.5);
    pickups.push({ x: c.x, z: c.z, type: c.drop, t: 0, fromCrate: true });
  }
  function updateCrates() {
    for (const c of crates) {
      c.hit = Math.max(0, c.hit - 0.12);
      if (c.hp <= 0) continue;
      if (Math.abs(c.z - crowd.z) > crowd.R * 1.3 + c.w + 0.1) continue;
      // members that touch the crate get absorbed by it
      const ms = crowd.members;
      for (let i = ms.length - 1; i >= 0 && c.hp > 0; i--) {
        const wx = crowd.x + ms[i].x, wz = crowd.z + ms[i].z;
        if (Math.abs(wx - c.x) < c.w + 0.03 && Math.abs(wz - c.z) < c.w + 0.03) {
          if (power.shield > 0) { c.hp--; c.hit = 1; continue; }
          killMember(i, "#3d7bf2"); c.hp--; c.hit = 1;
          if (Math.random() < 0.4) sound.pop();
        }
      }
      if (c.hp <= 0) breakCrate(c);
    }
  }

  function updateMobs(dt) {
    for (const m of mobs) {
      if (!m.alive) continue;
      m.R = radiusFor(m.count) * 0.95;
      const dist = m.z - crowd.z;
      if (dist < 24) m.walking = true;
      if (m.walking) m.z -= m.speed * dt;
      syncMembers(m.members, Math.min(m.count, 120), true);
      for (let i = 0; i < m.members.length; i++) {
        const s = formationSlot(i), mm = m.members[i];
        mm.x = lerp(mm.x, s.x, 0.15); mm.z = lerp(mm.z, s.z, 0.15);
      }
      // clash
      const gap = (m.z - m.R * 1.25) - (crowd.z + crowd.R * 1.25);
      if (gap < 0.05 && Math.abs(m.x - crowd.x) < m.R + crowd.R && m.z > crowd.z - 1) {
        clashTimer = 0.15;
        m.clashAcc = (m.clashAcc || 0) + dt * (30 + Math.sqrt(m.count + crowd.count) * 6);
        while (m.clashAcc >= 1 && m.count > 0 && crowd.count > 0) {
          m.clashAcc -= 1;
          m.count--;
          const mm = m.members.pop();
          if (mm) burst(m.x + mm.x, 0.15, m.z + mm.z, "#e5484d", 4, 1.6);
          if (power.shield <= 0) loseMembers(1, "#3d7bf2");
          if (Math.random() < 0.25) sound.pop();
        }
        shake = Math.max(shake, 0.18);
        if (m.count <= 0) { m.alive = false; popup(m.x, 0.8, m.z, "won the scrap", "#ffffff", 0.8); sound.good(); }
      }
      if (m.z < crowd.z - 6) m.alive = false;
    }
  }

  function updateSaws(dt) {
    for (const s of saws) {
      s.x = Math.sin(time * s.freq + s.phase) * s.amp;
      if (Math.abs(s.z - crowd.z) > crowd.R * 1.3 + s.r + 0.1) continue;
      const ms = crowd.members;
      for (let i = ms.length - 1; i >= 0; i--) {
        const dx = crowd.x + ms[i].x - s.x, dz = crowd.z + ms[i].z - s.z;
        if (dx * dx + dz * dz < (s.r + 0.035) ** 2) {
          if (power.shield > 0) continue;
          killMember(i, "#3d7bf2");
          s.splat = 1;
          if (Math.random() < 0.5) sound.pop();
          shake = Math.max(shake, 0.15);
        }
      }
    }
  }

  const POWER_INFO = {
    rapid: { icon: "⚡", name: "Rapid fire", dur: 6, color: "#ffd23f" },
    spread: { icon: "🔱", name: "Spread shot", dur: 6, color: "#b46cff" },
    shield: { icon: "🛡️", name: "Shield", dur: 5, color: "#43d9a3" },
    plus: { icon: "➕", name: "", dur: 0, color: "#2f7cf6" },
    dmg: { icon: "💥", name: "", dur: 0, color: "#ff8a3d" },
    rate: { icon: "🔥", name: "", dur: 0, color: "#ff5a36" },
    gun: { icon: "🎯", name: "", dur: 0, color: "#e4572e" },
  };
  function updatePickups(dt) {
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      p.t += dt;
      const dz = p.z - crowd.z;
      if (Math.abs(dz) < crowd.R * 1.3 + 0.2 && Math.abs(p.x - crowd.x) < crowd.R + 0.18) {
        pickups.splice(i, 1);
        const info = POWER_INFO[p.type];
        if (p.type === "plus") {
          const add = Math.max(5, Math.round(crowd.count * 0.25));
          setCount(crowd.count + add);
          popup(crowd.x, 1.3, crowd.z + 0.6, "+" + add, "#2f7cf6", 1.2);
          sound.good();
        } else if (p.type === "dmg") applyUpgrade("dmg", Math.max(1, Math.round(gun.dmg * 0.5)), crowd.x, crowd.z + 0.6);
        else if (p.type === "rate") applyUpgrade("rate", 25, crowd.x, crowd.z + 0.6);
        else if (p.type === "gun") applyUpgrade("gun", 1, crowd.x, crowd.z + 0.6);
        else {
          power[p.type] = info.dur;
          popup(crowd.x, 1.4, crowd.z + 0.6, info.icon + " " + info.name, info.color, 1);
          sound.power();
        }
        burst(p.x, 0.5, p.z, info.color, 20, 2.5);
        flash = 0.25; flashColor = "rgba(255,255,255,0.5)";
        buzz(15);
      } else if (dz < -1) pickups.splice(i, 1);
    }
  }

  function updateBoss(dt) {
    if (boss.dead) return;
    boss.t += dt;
    boss.hit = Math.max(0, boss.hit - dt * 6);
    boss.nextSlam -= dt;
    if (!boss.slam && boss.nextSlam <= 0) {
      // aim at the crowd, telegraph, then stomp
      const x = clamp(crowd.x + rand(-0.25, 0.25), -0.6, 0.6);
      boss.slam = { x, w: 0.42, t: 0, tele: Math.max(0.55, 1.0 - level * 0.03), hit: false };
    }
    if (boss.slam) {
      const s = boss.slam;
      s.t += dt;
      if (!s.hit && s.t >= s.tele) {
        s.hit = true;
        sound.thud(); shake = 0.9; buzz(60);
        const ms = crowd.members;
        let killed = 0;
        const maxKill = Math.max(3, Math.ceil(crowd.count * 0.35));
        for (let i = ms.length - 1; i >= 0 && killed < maxKill; i--) {
          if (Math.abs(crowd.x + ms[i].x - s.x) < s.w) {
            if (power.shield > 0) continue;
            killMember(i, "#3d7bf2"); killed++;
          }
        }
        // when the crowd is bigger than what's drawn, hidden folks get squashed too
        if (power.shield <= 0 && crowd.count > crowd.members.length && killed > 0) {
          const extra = Math.round((crowd.count - crowd.members.length) * 0.15);
          crowd.count -= extra;
        }
        if (killed) popup(s.x, 1.2, crowd.z, "−" + killed, "#e5484d", 1.2);
        burst(s.x, 0.1, crowd.z + 0.3, "#9b8a7a", 30, 3.5);
      }
      if (s.t >= s.tele + 0.45) { boss.slam = null; boss.nextSlam = rand(1.2, 2.0) - Math.min(0.5, level * 0.04); }
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy -= 9 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.life -= dt;
      if (p.y < 0) { p.y = 0; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i]; p.life -= dt * 0.9; p.y += dt * 0.9;
      if (p.life <= 0) popups.splice(i, 1);
    }
    for (let i = confetti.length - 1; i >= 0; i--) {
      const c = confetti[i];
      c.vy += 300 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.r += c.vr * dt; c.vx *= 0.99;
      if (c.y > H + 20) confetti.splice(i, 1);
    }
  }

  function win() {
    boss.dead = true; boss.hp = 0; state = "won";
    sound.win(); shake = 1; buzz([40, 40, 80]);
    burst(0, 1.2, boss.z, "#b46cff", 60, 5);
    burst(0, 1.2, boss.z, "#ffd23f", 40, 4);
    for (let k = 0; k < 160; k++) {
      confetti.push({ x: rand(0, W), y: rand(-H * 0.6, 0), vx: rand(-60, 60), vy: rand(0, 120), r: rand(0, 6), vr: rand(-8, 8), c: pick(["#e4572e", "#2f7cf6", "#ffd23f", "#43d9a3", "#b46cff"]), s: rand(5, 10) });
    }
    const n = crowd.count;
    const newBest = n > best;
    if (newBest) { best = n; store.set("best", best); }
    store.set("level", level + 1);
    document.getElementById("winCount").textContent = n.toLocaleString();
    document.getElementById("winText").textContent = newBest ? "made it to the end. New best!" : `made it to the end. Best: ${best.toLocaleString()}`;
    document.getElementById("winTitle").textContent = `Level ${level} clear!`;
    updateStats();
    setTimeout(() => show(ui.win, true), 1100);
  }
  function lose() {
    state = "lost";
    sound.lose(); buzz(120);
    const pct = Math.round(clamp(crowd.z / (L - 4), 0, 1) * 100);
    document.getElementById("loseText").textContent = state === "lost" && boss && crowd.z >= L - 4.5
      ? `The grump had ${fmt(Math.max(0, Math.ceil(boss.hp)))} HP left. Pick up more people on the way.`
      : `Everybody's gone, ${pct}% of the way there.`;
    setTimeout(() => show(ui.lose, true), 700);
  }

  // ---------- drawing ----------
  const COLORS = {
    sky1: "#6ec6ff", sky2: "#d9f1ff",
    grass1: "#7ccf5b", grass2: "#6fc24f",
    road1: "#f0e6d6", road2: "#e7dbc7",
    curb1: "#ffffff", curb2: "#e4572e",
    blue: "#3d7bf2", blueDark: "#2a5bc0",
    red: "#e5484d", redDark: "#b02a30",
  };

  function quad(a, b, c, d, color) {
    if (!a || !b || !c || !d) return;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath(); ctx.fill();
  }

  function drawWorld() {
    // sky
    const g = ctx.createLinearGradient(0, 0, 0, HOR + 10);
    g.addColorStop(0, COLORS.sky1); g.addColorStop(1, COLORS.sky2);
    ctx.fillStyle = g; ctx.fillRect(-50, -50, W + 100, HOR + 60);
    // distant hills
    ctx.fillStyle = "#a7dc8c";
    ctx.beginPath(); ctx.moveTo(-50, HOR + 2);
    for (let x = -50; x <= W + 50; x += 30) ctx.lineTo(x, HOR - 14 - Math.sin(x * 0.013 + 1) * 10 - Math.sin(x * 0.031) * 5);
    ctx.lineTo(W + 50, HOR + 2); ctx.fill();
    ctx.fillStyle = COLORS.grass2; ctx.fillRect(-50, HOR, W + 100, H - HOR + 50);

    const seg = 2;
    const start = Math.floor((camZ + 0.4) / seg) * seg;
    for (let z = start + 60; z >= start; z -= seg) {
      const z0 = Math.max(z, camZ + 0.4), z1 = z + seg;
      const stripe = Math.floor(z / seg) % 2 === 0;
      quad(proj(-30, 0, z0), proj(30, 0, z0), proj(30, 0, z1), proj(-30, 0, z1), stripe ? COLORS.grass1 : COLORS.grass2);
      quad(proj(-ROAD - 0.12, 0, z0), proj(ROAD + 0.12, 0, z0), proj(ROAD + 0.12, 0, z1), proj(-ROAD - 0.12, 0, z1), stripe ? COLORS.curb1 : COLORS.curb2);
      quad(proj(-ROAD, 0, z0), proj(ROAD, 0, z0), proj(ROAD, 0, z1), proj(-ROAD, 0, z1), stripe ? COLORS.road1 : COLORS.road2);
    }
    // finish line
    const fz = L - 2.5;
    if (fz > camZ + 0.4) {
      for (let i = 0; i < 10; i++) for (let j = 0; j < 2; j++) {
        const x0 = -ROAD + i * 0.2, zz = fz + j * 0.2;
        quad(proj(x0, 0.002, zz), proj(x0 + 0.2, 0.002, zz), proj(x0 + 0.2, 0.002, zz + 0.2), proj(x0, 0.002, zz + 0.2), (i + j) % 2 ? "#222" : "#fff");
      }
    }
  }

  function drawPerson(x, z, color, dark, bob, scaleMul = 1) {
    const p = proj(x, 0, z);
    if (!p) return;
    const r = 0.05 * p.s * scaleMul;
    if (r < 0.4) return;
    const y = p.y - bob * p.s;
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath(); ctx.ellipse(p.x, p.y, r * 1.1, r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.ellipse(p.x, y - r * 1.2, r * 0.95, r * 1.25, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.ellipse(p.x - r * 0.12, y - r * 1.3, r * 0.75, r * 1.05, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(p.x, y - r * 2.85, r * 0.72, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath(); ctx.arc(p.x - r * 0.25, y - r * 3.05, r * 0.22, 0, Math.PI * 2); ctx.fill();
  }

  const PALETTE = {
    good: ["rgba(90,160,255,0.95)", "rgba(47,124,246,0.55)", "#1e5ed6", "#163f91"],
    bad: ["rgba(255,95,100,0.95)", "rgba(229,72,77,0.55)", "#a8262c", "#7a1a1e"],
    gold: ["rgba(255,214,80,0.97)", "rgba(240,160,30,0.6)", "#b7791f", "#7a4a0c"],
    locked: ["rgba(150,150,160,0.95)", "rgba(90,90,100,0.6)", "#55555f", "#2d2d35"],
  };
  function drawGate(g) {
    const fade = g.passed ? Math.max(0, 1 - g.t * 3) : 1;
    if (fade <= 0) return;
    const H0 = g.small ? 0.62 : 1.25;
    for (let i = 0; i < g.sides.length; i++) {
      const s = g.sides[i];
      const x0 = s.x0 + 0.04, x1 = s.x1 - 0.04;
      const bump = s.bump * 0.08;
      const top = H0 + bump, bot = 0.05;
      const a = proj(x0 - bump, top, g.z), b = proj(x1 + bump, top, g.z), c = proj(x1 + bump, bot, g.z);
      if (!a || !c) continue;
      const up = isUpgrade(s);
      const pal = up ? (s.lock > 0 ? PALETTE.locked : PALETTE.gold) : isGood(s) ? PALETTE.good : PALETTE.bad;
      const chosen = g.passed && g.chosen === i;
      ctx.globalAlpha = fade * (chosen ? 0.9 : 0.66);
      const grad = ctx.createLinearGradient(0, a.y, 0, c.y);
      grad.addColorStop(0, pal[0]); grad.addColorStop(1, pal[1]);
      ctx.fillStyle = grad;
      ctx.fillRect(a.x, a.y, b.x - a.x, c.y - a.y);
      ctx.globalAlpha = fade;
      ctx.strokeStyle = pal[2];
      ctx.lineWidth = Math.max(1.5, 0.035 * a.s);
      ctx.strokeRect(a.x, a.y, b.x - a.x, c.y - a.y);
      const pw = b.x - a.x;
      // progress meter: shoot-to-climb gates and locked upgrades
      const meter = !g.passed && ((s.shoot && s.val <= 0) ? s.prog : s.lock > 0 ? 1 - s.lock / s.lockMax : -1);
      if (meter !== false && meter >= 0 && pw > 20) {
        const mh = Math.max(3, 0.05 * a.s);
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.fillRect(a.x + 5, c.y - mh - 5, pw - 10, mh);
        ctx.fillStyle = "#ffe066";
        ctx.fillRect(a.x + 5, c.y - mh - 5, (pw - 10) * meter, mh);
      }
      // label, shrunk to fit its panel
      const label = opLabel(s.op, s.val);
      let fs = Math.max(7, (g.small ? 0.3 : 0.42) * a.s * (1 + s.bump * 0.25));
      ctx.font = `900 ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      const tw = ctx.measureText(label).width;
      if (tw > pw * 0.86) { fs *= (pw * 0.86) / tw; ctx.font = `900 ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`; }
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const tx = (a.x + b.x) / 2, ty = (a.y + c.y) / 2 - fs * (s.lock > 0 ? 0.3 : 0.05);
      ctx.lineWidth = Math.max(2, fs * 0.12);
      ctx.strokeStyle = pal[3];
      ctx.strokeText(label, tx, ty);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, tx, ty);
      const sub = s.lock > 0 && !g.passed ? "🔒 " + fmt(Math.ceil(s.lock)) : s.shoot && s.val <= 0 && !g.passed && !g.small ? "shoot me" : "";
      if (sub && fs > 11) {
        ctx.font = `800 ${fs * (s.lock > 0 ? 0.5 : 0.3)}px system-ui, sans-serif`;
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fillText(sub, tx, ty + fs * (s.lock > 0 ? 0.8 : 0.62));
      }
      ctx.globalAlpha = 1;
    }
    // posts
    for (let k = 0; k <= g.sides.length; k++) {
      const x = k === g.sides.length ? ROAD : g.sides[k].x0;
      const a = proj(x - 0.04, H0 + 0.1, g.z), c = proj(x + 0.04, 0, g.z);
      if (!a || !c) continue;
      ctx.globalAlpha = fade;
      ctx.fillStyle = "#f6f2ea"; ctx.fillRect(a.x, a.y, c.x - a.x, c.y - a.y);
      ctx.fillStyle = "#c9bfae"; ctx.fillRect(a.x + (c.x - a.x) * 0.6, a.y, (c.x - a.x) * 0.4, c.y - a.y);
      ctx.globalAlpha = 1;
    }
  }

  function drawCrate(c) {
    if (c.hp <= 0) return;
    const j = c.hit * 0.03;
    const a = proj(c.x - c.w + rand(-j, j), c.w * 2, c.z - c.w), b = proj(c.x + c.w, 0, c.z - c.w);
    const t = proj(c.x - c.w, c.w * 2, c.z + c.w), t2 = proj(c.x + c.w, c.w * 2, c.z + c.w);
    if (!a || !b) return;
    // top face
    if (t && t2) quad(a, { x: b.x, y: a.y }, t2, t, "#d9a066");
    ctx.fillStyle = c.hit > 0.5 ? "#fff1d6" : "#c98a4b";
    ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.strokeStyle = "#7a4d24"; ctx.lineWidth = Math.max(1.5, 0.03 * a.s);
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.moveTo(b.x, a.y); ctx.lineTo(a.x, b.y); ctx.stroke();
    const fs = Math.max(8, 0.28 * a.s);
    ctx.font = `900 ${fs}px system-ui, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineWidth = fs * 0.14; ctx.strokeStyle = "#4a2d12";
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    ctx.strokeText(fmt(Math.ceil(c.hp)), mx, my); ctx.fillStyle = "#fff"; ctx.fillText(fmt(Math.ceil(c.hp)), mx, my);
    // what's inside
    const icon = POWER_INFO[c.drop].icon;
    ctx.font = `${fs * 0.75}px system-ui, sans-serif`;
    ctx.fillText(icon, mx, a.y - fs * 0.55);
  }

  function drawSaw(s) {
    const p = proj(s.x, s.r, s.z);
    if (!p) return;
    const r = s.r * p.s;
    const g = proj(s.x, 0, s.z);
    // slot in the road
    const l = proj(-s.amp - s.r, 0.001, s.z - 0.03), rr = proj(s.amp + s.r, 0.001, s.z + 0.03);
    if (l && rr) { ctx.fillStyle = "rgba(60,40,30,0.45)"; ctx.fillRect(l.x, rr.y - 2, rr.x - l.x, Math.max(3, l.y - rr.y + 2)); }
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.beginPath(); ctx.ellipse(g.x, g.y, r, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(time * 14);
    ctx.fillStyle = "#c9ced6";
    ctx.beginPath();
    const teeth = 12;
    for (let i = 0; i < teeth * 2; i++) {
      const a = (i / (teeth * 2)) * Math.PI * 2;
      const rad = i % 2 ? r : r * 0.78;
      ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#6b7380"; ctx.lineWidth = Math.max(1, r * 0.06); ctx.stroke();
    ctx.fillStyle = "#7d8594"; ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawPickup(p) {
    const bob = Math.sin(p.t * 4) * 0.06 + 0.35;
    const q = proj(p.x, bob, p.z), g = proj(p.x, 0, p.z);
    if (!q) return;
    const info = POWER_INFO[p.type];
    const r = 0.17 * q.s;
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath(); ctx.ellipse(g.x, g.y, r * 0.8, r * 0.25, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = info.color;
    ctx.globalAlpha = 0.35 + Math.sin(p.t * 6) * 0.1;
    ctx.beginPath(); ctx.arc(q.x, q.y, r * 1.35, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = info.color; ctx.lineWidth = Math.max(2, r * 0.18); ctx.stroke();
    ctx.font = `${r * 1.1}px system-ui, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(info.icon, q.x, q.y + r * 0.05);
  }

  function drawDeco(d) {
    const p = proj(d.x, 0, d.z);
    if (!p) return;
    const s = p.s * d.s;
    if (d.type === "tree") {
      ctx.fillStyle = "rgba(0,0,0,0.15)";
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 0.35 * s, 0.1 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#8b5a2b"; ctx.fillRect(p.x - 0.05 * s, p.y - 0.5 * s, 0.1 * s, 0.5 * s);
      ctx.fillStyle = "#3f9b3a";
      ctx.beginPath(); ctx.arc(p.x, p.y - 0.75 * s, 0.38 * s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#53b84b";
      ctx.beginPath(); ctx.arc(p.x - 0.1 * s, p.y - 0.85 * s, 0.24 * s, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = "#a59c90";
      ctx.beginPath(); ctx.ellipse(p.x, p.y - 0.08 * s, 0.22 * s, 0.14 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#c2bab0";
      ctx.beginPath(); ctx.ellipse(p.x - 0.05 * s, p.y - 0.12 * s, 0.12 * s, 0.07 * s, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  // A round horned grump. Used for the boss and, smaller and recoloured, the mini bosses.
  function drawCreature(x, z, size, look, hit, angry) {
    const breathe = Math.sin(time * 3 + z) * 0.04;
    const p = proj(x, size + breathe, z), g = proj(x, 0, z);
    if (!p) return null;
    const r = size * p.s;
    const j = hit * 0.03 * p.s;
    const cx = p.x + rand(-j, j), cy = p.y;
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath(); ctx.ellipse(g.x, g.y, r * 1.1, r * 0.25, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = look.horn;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * r * 0.45, cy - r * 0.75);
      ctx.quadraticCurveTo(cx + s * r * 0.95, cy - r * 1.25, cx + s * r * 0.8, cy - r * 1.5);
      ctx.quadraticCurveTo(cx + s * r * 0.7, cy - r * 1.05, cx + s * r * 0.2, cy - r * 0.85);
      ctx.fill();
    }
    const body = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.4, r * 0.1, cx, cy, r);
    body.addColorStop(0, hit > 0.4 ? "#ffffff" : look.c1);
    body.addColorStop(1, hit > 0.4 ? "#eeeeee" : look.c2);
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 0.95, 0, 0, Math.PI * 2); ctx.fill();
    for (const s of [-1, 1]) {
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.ellipse(cx + s * r * 0.32, cy - r * 0.18, r * 0.2, r * 0.17, 0, 0, Math.PI * 2); ctx.fill();
      const lookX = clamp((crowd.x - x) * 0.08, -0.06, 0.06) * r * 5;
      ctx.fillStyle = "#1c1d24";
      ctx.beginPath(); ctx.arc(cx + s * r * 0.32 + lookX, cy - r * 0.14, r * 0.09, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(20,10,40,0.75)"; ctx.lineWidth = r * 0.07; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(cx + s * r * 0.12, cy - r * 0.38); ctx.lineTo(cx + s * r * 0.52, cy - r * 0.46 + (angry ? r * 0.08 : 0)); ctx.stroke();
    }
    ctx.fillStyle = "rgba(20,10,40,0.8)";
    ctx.beginPath(); ctx.ellipse(cx, cy + r * 0.35, r * 0.3, (angry ? 0.16 : 0.08) * r, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillRect(cx - r * 0.18, cy + r * 0.28, r * 0.09, r * 0.08); ctx.fillRect(cx + r * 0.09, cy + r * 0.28, r * 0.09, r * 0.08);
    return { cx, cy, r };
  }
  const BOSS_LOOK = { c1: "#b07cff", c2: "#6a35c9", horn: "#f3e6c8" };
  function drawBoss() {
    if (!boss) return;
    const b = boss;
    const sink = b.dead ? Math.min(1, b.deadT * 1.5) : 0;
    if (b.dead && sink >= 1) return;
    drawCreature(0, b.z, 1.05 * (1 - sink * 0.9), BOSS_LOOK, b.hit, !!b.slam);
  }
  function drawMini(m) {
    if (!m.alive) return;
    const o = drawCreature(m.x, m.z, m.R, m.kind, m.hit, m.walking);
    if (!o || o.r < 6) return;
    // HP bar and name over its head
    const bw = Math.max(50, o.r * 2), bx = o.cx - bw / 2, by = o.cy - o.r * 1.75;
    ctx.fillStyle = "rgba(0,0,0,0.4)"; roundRect(bx - 2, by - 2, bw + 4, 14, 7); ctx.fill();
    ctx.fillStyle = m.kind.c1; roundRect(bx, by, bw * clamp(m.hp / m.max, 0, 1), 10, 5); ctx.fill();
    ctx.font = `800 ${Math.max(10, Math.min(14, o.r * 0.25))}px system-ui, sans-serif`;
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText(`${m.kind.name} ${fmt(Math.ceil(m.hp))}`, o.cx, by - 4);
  }

  function drawBossBar() {
    const b = boss;
    if (!b || state !== "boss") return;
    if (!b.dead) {
      const bw = Math.min(W * 0.7, 320), bx = W / 2 - bw / 2, by = 68;
      ctx.fillStyle = "rgba(0,0,0,0.35)"; roundRect(bx - 3, by - 3, bw + 6, 20, 10); ctx.fill();
      ctx.fillStyle = "#b07cff"; roundRect(bx, by, bw * clamp(b.hp / b.max, 0, 1), 14, 7); ctx.fill();
      ctx.font = "800 12px system-ui, sans-serif"; ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(`GRUMP  ${fmt(Math.max(0, Math.ceil(b.hp)))}`, W / 2, by + 7);
    }
  }

  function drawSlam() {
    const s = boss && boss.slam;
    if (!s || state !== "boss") return;
    const z0 = crowd.z - 1.2, z1 = crowd.z + 1.6;
    const t = clamp(s.t / s.tele, 0, 1);
    const alpha = s.hit ? Math.max(0, 1 - (s.t - s.tele) / 0.45) : 0.25 + 0.35 * Math.abs(Math.sin(s.t * 14));
    ctx.globalAlpha = alpha;
    quad(proj(s.x - s.w, 0.003, z0), proj(s.x + s.w, 0.003, z0), proj(s.x + s.w, 0.003, z1), proj(s.x - s.w, 0.003, z1), "#e5484d");
    ctx.globalAlpha = 1;
    // falling fist
    const fy = s.hit ? 0.25 : lerp(3.2, 0.25, t * t);
    const p = proj(s.x, fy, crowd.z + 0.2);
    if (p) {
      const r = s.w * p.s * 0.95;
      ctx.fillStyle = "#7c46d8";
      ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#9d6cf0";
      for (let k = -1.5; k <= 1.5; k++) { ctx.beginPath(); ctx.arc(p.x + k * r * 0.42, p.y - r * 0.45, r * 0.24, 0, Math.PI * 2); ctx.fill(); }
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function drawLabel(x, z, y, text, bg, bump) {
    const p = proj(x, y, z);
    if (!p) return;
    const fs = Math.max(13, Math.min(30, 0.24 * p.s)) * (1 + bump * 0.35);
    ctx.font = `900 ${fs}px system-ui, sans-serif`;
    const w = ctx.measureText(text).width + fs * 0.9;
    ctx.fillStyle = bg;
    roundRect(p.x - w / 2, p.y - fs * 0.75, w, fs * 1.5, fs * 0.75); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, p.x, p.y + fs * 0.03);
  }

  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.save();
    if (shake > 0) ctx.translate(rand(-1, 1) * shake * 10, rand(-1, 1) * shake * 10);
    drawWorld();

    // collect everything with a depth and paint far to near
    const items = [];
    const near = camZ + 0.4, far = camZ + 60;
    const inView = (z) => z > near && z < far;
    for (const d of deco) if (inView(d.z)) items.push([d.z, drawDeco, d]);
    for (const g of gates) if (inView(g.z)) items.push([g.z, drawGate, g]);
    for (const c of crates) if (c.hp > 0 && inView(c.z)) items.push([c.z - c.w, drawCrate, c]);
    for (const s of saws) if (inView(s.z)) items.push([s.z, drawSaw, s]);
    for (const p of pickups) if (inView(p.z)) items.push([p.z, drawPickup, p]);
    if (boss && inView(boss.z)) items.push([boss.z, drawBoss, null]);
    for (const m of minis) if (m.alive && inView(m.z)) items.push([m.z, drawMini, m]);
    for (const m of mobs) {
      if (!m.alive || !inView(m.z)) continue;
      for (const mm of m.members) items.push([m.z + mm.z, drawMobMember, [m, mm]]);
      items.push([m.z - m.R * 1.3 - 0.01, drawMobLabel, m]);
    }
    if (state !== "menu") {
      for (const mm of crowd.members) items.push([crowd.z + mm.z, drawCrowdMember, mm]);
    }
    for (const b of bullets) if (inView(b.z)) items.push([b.z, drawBullet, b]);
    for (const p of particles) if (inView(p.z)) items.push([p.z, drawParticle, p]);
    items.sort((a, b) => b[0] - a[0]);
    for (const it of items) it[1](it[2]);
    drawSlam();
    drawBossBar();

    if (state !== "menu" && crowd.count > 0) {
      if (power.shield > 0) {
        const p = proj(crowd.x, 0.25, crowd.z);
        if (p) {
          ctx.strokeStyle = `rgba(67,217,163,${0.5 + Math.sin(time * 10) * 0.2})`;
          ctx.lineWidth = 3; ctx.fillStyle = "rgba(67,217,163,0.12)";
          ctx.beginPath(); ctx.ellipse(p.x, p.y - 0.1 * p.s, (crowd.R + 0.1) * p.s, (crowd.R * 0.8 + 0.15) * p.s, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
      }
      drawLabel(crowd.x, crowd.z - crowd.R * 0.2, 0.5 + crowd.R * 0.6, fmt(crowd.count), "#2f7cf6", crowd.labelBump);
    }
    for (const p of popups) {
      const q = proj(p.x, p.y, p.z);
      if (!q) continue;
      let fs = Math.max(14, Math.min(44, 0.32 * q.s)) * p.size * (1 + Math.max(0, p.life - 0.8) * 2);
      ctx.globalAlpha = clamp(p.life * 2, 0, 1);
      ctx.font = `900 ${fs}px system-ui, sans-serif`;
      const tw = ctx.measureText(p.text).width;
      if (tw > W * 0.86) { fs *= (W * 0.86) / tw; ctx.font = `900 ${fs}px system-ui, sans-serif`; }
      const qx = clamp(q.x, Math.min(W / 2, tw / 2 + 8), Math.max(W / 2, W - tw / 2 - 8));
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineWidth = fs * 0.14; ctx.strokeStyle = "rgba(0,0,0,0.45)";
      const qy = Math.min(q.y, H - 120);
      ctx.strokeText(p.text, qx, qy); ctx.fillStyle = p.color; ctx.fillText(p.text, qx, qy);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    if (flash > 0) { ctx.globalAlpha = flash; ctx.fillStyle = flashColor; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }

    // active power-ups
    let px = 16;
    const py = H - Math.max(16, 16) - 40;
    for (const k of ["rapid", "spread", "shield"]) {
      if (power[k] <= 0) continue;
      const info = POWER_INFO[k];
      ctx.fillStyle = "rgba(0,0,0,0.35)"; roundRect(px, py, 108, 34, 17); ctx.fill();
      ctx.fillStyle = info.color; roundRect(px + 3, py + 3, 102 * (power[k] / info.dur), 28, 14); ctx.fill();
      ctx.font = "700 14px system-ui, sans-serif"; ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(info.icon + " " + info.name.split(" ")[0], px + 12, py + 17);
      px += 116;
    }

    // weapon stats
    if (state === "run" || state === "boss") {
      const text = `💥 ${fmt(dmgNow())}   🔥 ${gun.rate.toFixed(1)}×   🎯 ${gunsPerVolley()}`;
      const fsz = 14 * (1 + statsBump * 0.3);
      ctx.font = `800 ${fsz}px system-ui, sans-serif`;
      const w = ctx.measureText(text).width + 24;
      const sy = py - 42;
      ctx.fillStyle = statsBump > 0.1 ? "rgba(183,121,31,0.85)" : "rgba(0,0,0,0.35)";
      roundRect(16, sy, w, 34, 17); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(text, 28, sy + 17);
    }

    for (const c of confetti) {
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.r); ctx.fillStyle = c.c; ctx.fillRect(-c.s / 2, -c.s / 4, c.s, c.s / 2); ctx.restore();
    }
  }
  function drawCrowdMember(mm) {
    const bob = Math.abs(Math.sin(time * 13 + mm.ph)) * 0.035 * (crowd.speed > 1 ? 1 : 0.3);
    drawPerson(crowd.x + mm.x, crowd.z + mm.z, COLORS.blue, COLORS.blueDark, bob, 1 + mm.pop * 0.6);
  }
  function drawMobMember([m, mm]) {
    const bob = m.walking ? Math.abs(Math.sin(time * 11 + mm.ph)) * 0.03 : 0;
    drawPerson(m.x + mm.x, m.z + mm.z, COLORS.red, COLORS.redDark, bob);
  }
  function drawMobLabel(m) { drawLabel(m.x, m.z - m.R * 0.2, 0.5 + m.R * 0.6, fmt(m.count), "#e5484d", 0); }
  function drawBullet(b) {
    const a = proj(b.x, 0.22, b.z), c = proj(b.x - b.vx * 0.02, 0.22, b.z - 0.35);
    if (!a || !c) return;
    ctx.strokeStyle = "#ffd23f"; ctx.lineCap = "round";
    ctx.lineWidth = Math.max(2, 0.035 * a.s);
    ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(a.x, a.y); ctx.stroke();
  }
  function drawParticle(p) {
    const q = proj(p.x, p.y, p.z);
    if (!q) return;
    ctx.globalAlpha = clamp(p.life / 0.4, 0, 1);
    ctx.fillStyle = p.color;
    const s = Math.max(1.5, p.size * q.s);
    ctx.fillRect(q.x - s / 2, q.y - s / 2, s, s);
    ctx.globalAlpha = 1;
  }

  // ---------- menu backdrop ----------
  buildLevel();
  camZ = -CAM_BACK;

  // ---------- loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // test hook for automated checks
  window.__headcount = { get state() { return state; }, get count() { return crowd.count; }, get z() { return crowd.z; }, get L() { return L; }, crowd, gun, boss: () => boss, gates: () => gates, minis: () => minis, setCount, applyOp, isUpgrade };
})();
