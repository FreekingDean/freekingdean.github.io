// Sound effects, synthesised with the Web Audio API so there are no audio
// files to load. Browsers only allow audio after a tap or click, so the
// audio context is created on the first one (see unlock()).

let ctx = null;
let master = null;
let noise = null;
let muted = false;

// Each arrow that escapes plays the next note of a song, so clearing the
// cube plays it through, looping at the end. Notes are semitones above C5;
// a second value of 2 marks a held note at the end of a phrase.
const ROOT = 523.25; // C5
const note = (semitones) => ROOT * Math.pow(2, semitones / 12);

const C = 0, D = 2, E = 4, F = 5, G = 7, A = 9;
const SONG = [
  // Twinkle, twinkle, little star, how I wonder what you are
  [C], [C], [G], [G], [A], [A], [G, 2], [F], [F], [E], [E], [D], [D], [C, 2],
  // Up above the world so high, like a diamond in the sky
  [G], [G], [F], [F], [E], [E], [D, 2], [G], [G], [F], [F], [E], [E], [D, 2],
  // Twinkle, twinkle, little star, how I wonder what you are
  [C], [C], [G], [G], [A], [A], [G, 2], [F], [F], [E], [E], [D], [D], [C, 2],
];

let songPos = 0;
try { songPos = Number(localStorage.getItem('tanglecube.songPos')) % SONG.length || 0; } catch { /* ignore */ }
function nextNote() {
  const n = SONG[songPos];
  songPos = (songPos + 1) % SONG.length;
  try { localStorage.setItem('tanglecube.songPos', String(songPos)); } catch { /* ignore */ }
  return n;
}

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

// An arrow slides off: the next note of the song, plus a soft whoosh.
export function slide() {
  if (!ready()) return;
  const now = ctx.currentTime;
  const [semitones, hold = 1] = nextNote();
  const f = note(semitones);
  tone(f, now, { gain: 0.22, decay: 0.5 * hold });
  tone(f * 2, now, { type: 'sine', gain: 0.05, decay: 0.3 * hold });
  tone(f / 2, now, { type: 'sine', gain: 0.08, decay: 0.4 * hold });
  hiss(now + 0.03, { from: 500, to: 3200, duration: 0.3, gain: 0.04 });
}

// Bumped into another arrow: a low, soft thud.
export function bonk() {
  if (!ready()) return;
  const now = ctx.currentTime;
  tone(170, now, { type: 'sine', gain: 0.5, decay: 0.22, slideTo: 60 });
  hiss(now, { from: 900, to: 200, type: 'lowpass', q: 0.7, duration: 0.12, gain: 0.25 });
}

// Cube cleared: a rising arpeggio.
export function win() {
  if (!ready()) return;
  const now = ctx.currentTime + 0.05;
  [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => {
    tone(note(s - 12), now + i * 0.075, { gain: 0.18, decay: 0.9 });
  });
  tone(note(-12), now + 0.5, { type: 'sine', gain: 0.12, attack: 0.05, decay: 1.6 });
  tone(note(-8), now + 0.5, { type: 'sine', gain: 0.1, attack: 0.05, decay: 1.6 });
}

// Hint: two light pings.
export function hint() {
  if (!ready()) return;
  const now = ctx.currentTime;
  tone(note(12), now, { type: 'sine', gain: 0.12, decay: 0.25 });
  tone(note(19), now + 0.09, { type: 'sine', gain: 0.1, decay: 0.35 });
}

// Out of hearts: a sad little fall.
export function lose() {
  if (!ready()) return;
  const now = ctx.currentTime;
  [7, 3, 0].forEach((s, i) => tone(note(s - 12), now + i * 0.16, { gain: 0.18, decay: 0.5 }));
}
