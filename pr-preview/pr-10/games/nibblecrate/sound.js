// Little synthesised sounds (Web Audio, no files). The audio context starts
// on the first tap, since browsers block sound before that.

let ctx = null;
let master = null;
let muted = false;
let lastBite = 0;

try { muted = localStorage.getItem('nibblecrate:muted') === '1'; } catch (e) { /* storage blocked */ }

export function unlock() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.5;
  master.connect(ctx.destination);
}

export function isMuted() { return muted; }

export function setMuted(m) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.5;
  try { localStorage.setItem('nibblecrate:muted', m ? '1' : '0'); } catch (e) { /* ignore */ }
}

function tone({ freq, to = freq, type = 'sine', dur = 0.1, vol = 0.3, at = 0 }) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// Major pentatonic steps, so a long run of bites climbs a happy scale.
const STEPS = [0, 2, 4, 7, 9];
function scale(i) {
  const oct = Math.floor(i / STEPS.length);
  return 440 * Math.pow(2, (STEPS[i % STEPS.length] + 12 * oct - 9) / 12);
}

export function bite(combo) {
  if (!ctx) return;
  const now = ctx.currentTime;
  if (now - lastBite < 0.035) return; // don't machine-gun
  lastBite = now;
  const f = scale(Math.min(combo, 14));
  tone({ freq: f * 2, to: f, type: 'square', dur: 0.06, vol: 0.08 });
  tone({ freq: f, to: f * 0.7, type: 'triangle', dur: 0.09, vol: 0.18 });
}

export function launch() {
  tone({ freq: 220, to: 660, type: 'triangle', dur: 0.14, vol: 0.18 });
}

export function dock() {
  tone({ freq: 180, to: 120, type: 'sine', dur: 0.12, vol: 0.25 });
}

export function done() {
  tone({ freq: 523, to: 1046, type: 'sine', dur: 0.12, vol: 0.2 });
  tone({ freq: 784, to: 1568, type: 'triangle', dur: 0.14, vol: 0.12, at: 0.06 });
}

export function warn() {
  tone({ freq: 330, to: 300, type: 'square', dur: 0.12, vol: 0.06 });
  tone({ freq: 330, to: 300, type: 'square', dur: 0.12, vol: 0.06, at: 0.16 });
}

export function win() {
  [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => {
    tone({ freq: 523 * Math.pow(2, s / 12), type: 'triangle', dur: 0.22, vol: 0.18, at: i * 0.07 });
  });
}

export function lose() {
  [7, 4, 0, -5].forEach((s, i) => {
    tone({ freq: 392 * Math.pow(2, s / 12), to: 392 * Math.pow(2, (s - 1) / 12), type: 'triangle', dur: 0.25, vol: 0.18, at: i * 0.14 });
  });
}

export function nope() {
  tone({ freq: 160, to: 110, type: 'square', dur: 0.08, vol: 0.06 });
}
