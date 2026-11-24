// Sound effects, synthesised with the Web Audio API so there are no audio
// files to load. Browsers only allow audio after a tap or click, so the
// audio context is created on the first one (see unlock()).

let ctx = null;
let master = null;
let noise = null;
let muted = false;

// Each arrow that escapes in quick succession plays the next note up a
// pentatonic scale, so a good run sounds like a little tune.
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33, 36];
const ROOT = 392; // G4
let combo = 0;
let lastSlide = 0;

const note = (semitones) => ROOT * Math.pow(2, semitones / 12);

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.55;
    // A gentle compressor keeps quick runs of sounds from clipping.
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    // One second of white noise, reused for whooshes and thuds.
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.setTargetAtTime(m ? 0 : 0.55, ctx.currentTime, 0.02);
}

const ready = () => ctx && !muted && ctx.state === 'running';

function tone(freq, start, { type = 'triangle', gain = 0.3, attack = 0.005, decay = 0.4, slideTo = null } = {}) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + decay);
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
  osc.connect(g).connect(master);
  osc.start(start);
  osc.stop(start + attack + decay + 0.05);
}

function hiss(start, { from, to, q = 1.2, gain = 0.08, duration = 0.3, type = 'bandpass' }) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(from, start);
  filter.frequency.exponentialRampToValueAtTime(to, start + duration);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + duration * 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  src.connect(filter).connect(g).connect(master);
  src.start(start, Math.random() * 0.5);
  src.stop(start + duration + 0.05);
}

// An arrow slides off: a plucked note plus a soft whoosh.
export function slide() {
  if (!ready()) return;
  const now = ctx.currentTime;
  const t = performance.now();
  combo = t - lastSlide < 2200 ? Math.min(combo + 1, SCALE.length - 1) : 0;
  lastSlide = t;
  const f = note(SCALE[combo]);
  tone(f, now, { gain: 0.22, decay: 0.45 });
  tone(f * 2, now, { type: 'sine', gain: 0.06, decay: 0.25 });
  hiss(now + 0.03, { from: 500, to: 3200, duration: 0.32, gain: 0.06 });
}

// Bumped into another arrow: a low, soft thud.
export function bonk() {
  if (!ready()) return;
  const now = ctx.currentTime;
  combo = 0;
  tone(170, now, { type: 'sine', gain: 0.5, decay: 0.22, slideTo: 60 });
  hiss(now, { from: 900, to: 200, type: 'lowpass', q: 0.7, duration: 0.12, gain: 0.25 });
}

// Cube cleared: a rising arpeggio.
export function win() {
  if (!ready()) return;
  const now = ctx.currentTime + 0.05;
  [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => {
    tone(note(s + 5), now + i * 0.075, { gain: 0.18, decay: 0.9 });
  });
  tone(note(5), now + 0.5, { type: 'sine', gain: 0.12, attack: 0.05, decay: 1.6 });
  tone(note(9), now + 0.5, { type: 'sine', gain: 0.1, attack: 0.05, decay: 1.6 });
}

// Hint: two light pings.
export function hint() {
  if (!ready()) return;
  const now = ctx.currentTime;
  tone(note(24), now, { type: 'sine', gain: 0.12, decay: 0.25 });
  tone(note(31), now + 0.09, { type: 'sine', gain: 0.1, decay: 0.35 });
}

// Out of hearts: a sad little fall.
export function lose() {
  if (!ready()) return;
  const now = ctx.currentTime;
  [7, 3, 0].forEach((s, i) => tone(note(s - 5), now + i * 0.16, { gain: 0.18, decay: 0.5 }));
}
