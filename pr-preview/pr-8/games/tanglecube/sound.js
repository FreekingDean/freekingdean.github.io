// Sound effects, synthesised with the Web Audio API so there are no audio
// files to load. Browsers only allow audio after a tap or click, so the
// audio context is created on the first one (see unlock()).

let ctx = null;
let master = null;
let noise = null;
let muted = false;

// Each arrow that escapes plays the next note of a song, so clearing a cube
// plays the tune through. All of these are public-domain melodies. Apart
// from the Canon, each is the complete piece with its repeats, taken from
// the scores in the music21 corpus (the top line of the melody part).
//
// Notes are written as name + octave (C5 is the C above middle C), with a
// "-" on the end for each extra beat a note should ring, or a "." for a
// quick half-beat note.
const SONGS = {
  canon: {
    name: 'Canon in D (Pachelbel, arranged)',
    // Variations over the ground bass D A Bm F#m G D G A, each one busier
    // than the last, then back down to a slow close.
    notes: `F#5- E5- D5- C#5- B4- A4- B4- C#5-
            D5- C#5- B4- A4- G4- F#4- G4- E4-
            D4 F#4 A4 G4 F#4 D4 F#4 E4 D4 B3 D4 A4 G4 B4 A4 G4
            F#4 D4 E4 C#5 D5 F#5 A5 A4 B4 G4 A4 F#4 D4 D5 D5- C#5-
            D5. C#5. D5. D4. C#4. A4. E4. F#4. D4. D5. C#5. B4. C#5. F#5. A5. B5.
            G5. F#5. E5. G5. F#5. E5. D5. C#5. B4. A4. G4. F#4. E4. G4. F#4. E4.
            D5. F#5. E5. D5. C#5. E5. D5. C#5. B4. D5. C#5. B4. A4. C#5. B4. A4.
            G4. B4. A4. G4. F#4. A4. G4. F#4. G4. B4. A4. G4. A4. C#5. B4. A4.
            F#5. E5. D5. E5. F#5. G5. A5. F#5. E5. C#5. A4. C#5. E5. F#5. G5. E5.
            D5. B4. F#4. B4. D5. E5. F#5. D5. C#5. A4. F#4. A4. C#5. D5. E5. C#5.
            B4. G4. D4. G4. B4. C#5. D5. B4. A4. F#4. D4. F#4. A4. B4. C#5. A4.
            B4. D5. G5. D5. B4. G4. B4. D5. C#5. E5. A5. E5. C#5. A4. B4. C#5.
            D4 F#4 A4 G4 F#4 D4 F#4 E4 D4 B3 D4 A4 G4 B4 A4 G4
            F#5- E5- D5- C#5- B4- A4- B4- C#5- D5---`,
  },
  mapleLeaf: {
    name: 'Maple Leaf Rag (Scott Joplin, 1899)',
    notes: `Ab4. Eb5. Ab4. C5. Eb5 G4. Eb5. G4. Bb4. Eb5-- Ab4. Eb5. Ab4. C5. Eb5
            G4. Eb5. G4. Bb4. Eb5- Eb5 Ab4. B4. E5 Eb5 Eb5 Ab4. B4. E5 Eb5--- Ab4.
            B4. Ab5 Ab5. B5. Ab6. Ab6 Ab6 Ab6 Ab6. Ab6 Eb6. F6. C6. Eb6. F6 Ab5 Bb5.
            B5. Ab5. Bb5. C6 Ab5. C6. Ab5. Bb5 Ab5 Ab5 Ab5 Ab5 Ab5. Ab5 Eb5. F5. C5.
            Eb5. F5 Ab4 Bb4. B4. Ab4. Bb4. C5 Ab4. C5. Ab4. Bb4 Ab4- C5. Ab4. Bb4
            Ab4- G5. Eb6. G5. Bb5. D6 G5. C#6. G5. Bb5. C6 Eb5. Bb5. Eb5 C5. Ab5.
            C5. Eb5. F5 C5. Ab5. C5. Eb5. F5 C5. F5 Eb5. G5. Bb4. C#5. F5 Eb5. G5.
            Bb4. C#5. F5 C#5. F5 C5. Ab5. C5. Eb5. F5 C5. Ab5. C5. Eb5. F5 C5. F5
            G5. Eb6. G5. Bb5. D6 G5. C#6. G5. Bb5. C6 Eb5. Bb5. Eb5 C5. Ab5. C5.
            Eb5. F5 C5. Ab5 Ab5 G5 F#5 F4. A4. C5. F5. C5. A4. F4 F4. Bb4. C#5. F5
            C#5 C5 C5 Bb4 Eb4. Ab4 Eb5 Eb5 Eb5 G5. Eb6. G5. Bb5. D6 G5. C#6. G5.
            Bb5. C6 Eb5. Bb5. Eb5 C5. Ab5. C5. Eb5. F5 C5. Ab5. C5. Eb5. F5 C5. F5
            Eb5. G5. Bb4. C#5. F5 Eb5. G5. Bb4. C#5. F5 C#5. F5 C5. Ab5. C5. Eb5. F5
            C5. Ab5. C5. Eb5. F5 C5. F5 G5. Eb6. G5. Bb5. D6 G5. C#6. G5. Bb5. C6
            Eb5. Bb5. Eb5 C5. Ab5. C5. Eb5. F5 C5. Ab5 Ab5 G5 F#5 F4. A4. C5. F5.
            C5. A4. F4 F4. Bb4. C#5. F5 C#5 C5 C5 Bb4 Eb4 Ab4. C5. Eb5. Ab5- Ab4.
            Eb5. Ab4. C5. Eb5 G4. Eb5. G4. Bb4. Eb5-- Ab4. Eb5. Ab4. C5. Eb5 G4.
            Eb5. G4. Bb4. Eb5- Eb5 Ab4. B4. E5 Eb5 Eb5 Ab4. B4. E5 Eb5--- Ab4. B4.
            Ab5 Ab5. B5. Ab6. Ab6 Ab6 Ab6 Ab6. Ab6 Eb6. F6. C6. Eb6. F6 Ab5 Bb5. B5.
            Ab5. Bb5. C6 Ab5. C6. Ab5. Bb5 Ab5 Ab5 Ab5 Ab5 Ab5. Ab5 Eb5. F5. C5.
            Eb5. F5 Ab4 Bb4. B4. Ab4. Bb4. C5 Ab4. C5. Ab4. Bb4 Ab4 Ab5 Ab5 Ab5 Eb5.
            Bb4 Ab5 Ab5 Eb5. Bb4. Eb5. Ab4. C#5. Bb4. C#5. F5. Ab4. C#5. F5. Bb4.
            C#5. F5. Ab4 F5. Bb4. F5. Ab5 Ab5 Eb5. Bb4 Ab5 Ab5 Eb5. Bb4. Eb5. Ab4.
            C#5. Bb4. C#5. F5. Ab4. C#5. F5. Bb4. C#5. F5. Ab4 F5. A4. F5. Bb5 Bb5
            F5. C5 Bb5 Bb5 F5. C5. F5 Eb5. Bb5. Eb5. F#5. C6 Eb5. Bb5. Eb5. F#5. C6
            Eb5. Bb5 C#6 C#6 C6 Bb5 F5. C#5. Eb5. F#5 Bb4. F5 F5. C#5. Eb5. F5 C5.
            Eb5. C#5 Ab5 F5. Ab5. F5. Ab5. F5. Ab5 Ab5 Eb5. Bb4 Ab5 Ab5 Eb5. Bb4.
            Eb5. Ab4. C#5. Bb4. C#5. F5. Ab4. C#5. F5. Bb4. C#5. F5. Ab4 F5. Bb4.
            F5. Ab5 Ab5 Eb5. Bb4 Ab5 Ab5 Eb5. Bb4. Eb5. Ab4. C#5. Bb4. C#5. F5. Ab4.
            C#5. F5. Bb4. C#5. F5. Ab4 F5. A4. F5. Bb5 Bb5 F5. C5 Bb5 Bb5 F5. C5. F5
            Eb5. Bb5. Eb5. F#5. C6 Eb5. Bb5. Eb5. F#5. C6 Eb5. Bb5 C#6 C#6 C6 Bb5
            F5. C#5. Eb5. F#5 Bb4. F5 F5. C#5. Eb5. F5 C5. Eb5. C#5 C#5. F5. Ab5.
            C#6- Ab5 F5 Ab5 F5 Ab5 Bb5. C6 Bb5. Ab5. F5. Eb5. F5 C5-- Eb5. F5. C5.
            Eb5. F5 C5. Eb5 F5. Bb4-- C#5. F5. Bb4. C#5. F5 C5 Eb5. F5. C5. Eb5. F5
            C5 Eb5. F5. C5. Eb5. F5 Eb5. Ab5 F5 Ab5 F5 Ab5 Bb5. C6 Bb5. Ab5. F5. Ab5
            F5 Eb5. Ab5 C5 Eb5. F5. C5. Eb5. F5 Ab4 Bb4. Ab4 Ab4 Bb4. Ab4 Bb4. C5.
            Ab4. Bb4. C5 Ab4 Bb4. C5. Ab4 Bb4 Eb4. Ab4 Eb5 Eb5 Eb5 Ab5 F5 Ab5 F5 Ab5
            Bb5. C6 Bb5. Ab5. F5. Eb5. F5 C5-- Eb5. F5. C5. Eb5. F5 C5. Eb5 F5.
            Bb4-- C#5. F5. Bb4. C#5. F5 C5 Eb5. F5. C5. Eb5. F5 C5 Eb5. F5. C5. Eb5.
            F5 Eb5. Ab5 F5 Ab5 F5 Ab5 Bb5. C6 Bb5. Ab5. F5. Ab5 F5 Eb5. Ab5 C5 Eb5.
            F5. C5. Eb5. F5 Ab4 Bb4. Ab4 Ab4 Bb4. Ab4 Bb4. C5. Ab4. Bb4. C5 Ab4 Bb4.
            C5. Ab4 Bb4 Eb4. Ab4 Eb5 Ab5`,
  },
  laDonna: {
    name: 'La donna è mobile (Verdi, 1851)',
    notes: `D5. D5. D5. F5. Eb5. C5 C5. C5. C5. Eb5. D5. Bb4 D5. C5. Bb4. C5. A4. A4
            C5. Bb4. G4. A4. F4. F4 D5. D5. D5. F5. Eb5. C5 C5. C5. C5. Eb5. D5. Bb4
            D5. C5. Bb4. C5. A4. A4 C5. Bb4. G4. A4. F4. F4 C5. D5. C5. C5. F5. C5
            D5. Eb5. D5. D5. G5. D5 F5. G5. F5. F5. G5 F5. Eb5. F5. Eb5. D5. C5. Bb4
            F5. F6. F6 F5. F6. F6 F5. F6. Eb6. F6. Eb6. D6. C6. Bb5 F5. F6. Eb6. A5.
            F6. Eb6. F5. F6. D6. F5. F6. D6. F5. F6. Eb6. A5. F6. Eb6. A5. F6. Eb6.
            A5. F6. Bb5 F#5. A5. G5. F5. Eb5. D5. C5. Bb4. Bb5- D5. D5. D5. F5. Eb5.
            C5 C5. C5. C5. Eb5. D5. Bb4 D5. C5. Bb4. C5. A4. A4 C5. Bb4. G4. A4. F4.
            F4 D5. D5. D5. F5. Eb5. C5 C5. C5. C5. Eb5. D5. Bb4 D5. C5. Bb4. C5. A4.
            A4 C5. Bb4. G4. A4. F4. F4 C5. D5. C5. C5. F5. C5 D5. Eb5. D5. D5. G5.
            D5 F5. G5. F5. F5. G5 F5. Eb5. F5. Eb5. D5. C5. Bb4 F5. F6. F6 F5. F6.
            F6 F5. F6. Eb6. F6. Eb6. D6. C6. Bb5 F5. F6. Eb6. A5. F6. Eb6. F5. F6.
            D6. F5. F6. D6. F5. F6. Eb6. A5. F6. Eb6. A5. F6. Eb6. A5. F6. Bb5 F#5.
            A5. G5. F5. Eb5. D5. C5. Bb4. Bb5.`,
  },
  alexander: {
    name: "Alexander's Ragtime Band (Irving Berlin, 1911)",
    notes: `Ab4. A4. Ab4. A4- Ab4 A4. Ab4. A4-- A4. Ab4. A4 G4 E4 C4 F4- C#5 D5.
            C#5. D5- C#5 D5. C#5. D5-- D5. C#5. D5 Bb4 F4 Bb4 D5-- A4. Bb4. C5. C5.
            D5. A4. C5 D5. A4. C5. C5. D5. A4. C5- F4 A4. C4. F4 A4. C4. F4. F4. A4.
            C4. F4- G4 G4- A4 B4 G4 A4 B4 C5--- Bb4. A4. G4 Ab4. A4. Ab4. A4- Ab4
            A4. Ab4. A4-- A4. Ab4. A4 G4 E4 C4 F4- C#5 D5. C#5. D5- C#5 D5. C#5.
            D5-- D5. C#5. D5 Bb4 F4 Bb4 D5- A4 Bb4. Bb4. C5 C5 C5 A4 G4 F4 A4 G4 F4-
            F5- D5 F5 B4 C5. B4. C5- B4 C5. B4. C5- D5 C#5 D5 C5 A4 G4 F4- Ab4 A4.
            Ab4. A4- Ab4 A4. Ab4. A4-- A4. Ab4. A4 G4 E4 C4 F4- C#5 D5. C#5. D5- C#5
            D5. C#5. D5-- D5. C#5. D5 Bb4 F4 Bb4 D5-- A4. Bb4. C5. C5. D5. A4. C5
            D5. A4. C5. C5. D5. A4. C5- F4 A4. C4. F4 A4. C4. F4. F4. A4. C4. F4- G4
            G4- A4 B4 G4 A4 B4 C5--- Bb4. A4. G4 Ab4. A4. Ab4. A4- Ab4 A4. Ab4. A4--
            A4. Ab4. A4 G4 E4 C4 F4- C#5 D5. C#5. D5- C#5 D5. C#5. D5-- D5. C#5. D5
            Bb4 F4 Bb4 D5- A4 Bb4. Bb4. C5 C5 C5 A4 G4 F4 A4 G4 F4- F5- D5 F5 B4 C5.
            B4. C5- B4 C5. B4. C5- D5 C#5 D5 C5 A4 G4 F4- F5.`,
  },
  jeanie: {
    name: 'Jeanie with the Light Brown Hair (Stephen Foster, 1854)',
    notes: `D5- C5-- A4 Bb4 A4 G4 F4 A4- C4 D4 F4--- F4- G4 A4 F5- D5- C5 A4. G4 F4
            G4-- D5 C5-- A4 Bb4 A4 G4 F4 A4- C4 D4 F4--- G4 B4 C5 D5 E5 F5 A4 D5 C5-
            B4 B4 C5- G4 A4 G4 F4 G4- A4 G4 F4 E4 F4 A4 C5--- D5 C5 D5 F5 C5- A4 G4
            F4- D4 D4. C4-- D5 C5-- A4 Bb4 A4 G4 F4 A4- C4 D4 F4--- G4 A4 F5 D5. C5
            D5 F4 G4. A4- A4 G4 F4-- D5 C5-- A4 Bb4 A4 G4 F4 A4- C4 D4 F4--- F4- G4
            A4 F5- D5- C5 A4. G4 F4 G4-- D5 C5-- A4 Bb4 A4 G4 F4 A4- C4 D4 F4--- G4
            B4 C5 D5 E5 F5 A4 D5 C5- B4 B4 C5- G4 A4 G4 F4 G4- A4 G4 F4 E4 F4 A4
            C5--- D5 C5 D5 F5 C5- A4 G4 F4- D4 D4. C4-- D5 C5-- A4 Bb4 A4 G4 F4 A4-
            C4 D4 F4--- G4 A4 F5 D5. C5 D5 F4 G4. A4- A4 G4 F4-`,
  },
  lindenbaum: {
    name: 'Der Lindenbaum (Schubert, 1827)',
    notes: `B4. B4 Ab4. Ab4. Ab4. Ab4 E4 E4. F#4 Ab4. A4. Ab4. F#4. E4- B4. B4 Ab4.
            Ab4. Ab4. Ab4 E4 E4. F#4 Ab4. A4. Ab4. F#4. E4- E4. F#4 F#4. F#4. F#4.
            Ab4 A4. B4 B4. C#5 B4. Ab4. E4. F#4- F#4. F#4 F#4. F#4. F#4. Ab4 A4. B4
            B4. E5 B4. Ab4. A4 F#4. E4- B4. B4 G4. G4 G4. G4 E4 E4. F#4 G4. A4. G4.
            F#4. E4- B4. B4 G4. G4. G4. G4 E4 E4. F#4 G4. A4. G4. F#4. E4- E4. F#4
            F#4. F#4. F#4. Ab4 A4. B4 B4. C#5 B4. Ab4. E4. F#4- F#4. F#4 F#4. F#4.
            F#4. Ab4 A4. B4 B4. E5 B4. Ab4. A4 F#4. E4- F#4. F#4 F#4. F#4. A4. Ab4
            E4 E4. F#4 F#4. B4 A4. G4- B4. C5 B4. C5. B4. C5 C4 C4. C#4 C#4. C#4.
            C#4. B3- B4. B4 Ab4. Ab4. Ab4. Ab4 E4 E4. F#4 Ab4. A4. Ab4. F#4. E4- B4.
            B4 Ab4. Ab4. Ab4. Ab4 E4 E4. F#4 Ab4. A4. Ab4. F#4. E4- E4. F#4 F#4.
            F#4. F#4. Ab4 A4. B4 B4. C#5 B4. Ab4. E4. F#4- F#4. F#4 F#4. F#4. F#4.
            Ab4 A4. B4 B4. E5 B4. Ab4. A4. F#4. B4- B4. E5 B4. Ab4. B4. A4. F#4. E4-`,
  },
};
// Only full-length pieces (100+ notes) are kept, no excerpts, so the tune
// doesn't loop every few seconds on a big cube.
const PLAYLIST = Object.keys(SONGS);

const ROOT = 523.25; // C5
const note = (semitones) => ROOT * Math.pow(2, semitones / 12);
const NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// "D#5--" -> [semitones above C5, beats held]
function parse(text) {
  return text.trim().split(/\s+/).map((tok) => {
    const m = /^([A-G])([#b]?)(\d)(-*|\.)$/.exec(tok);
    if (!m) throw new Error(`bad note ${tok}`);
    const semis = NAMES[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) - 5) * 12;
    return [semis, m[4] === '.' ? 0.5 : 1 + m[4].length];
  });
}
for (const song of Object.values(SONGS)) song.parsed = parse(song.notes);

export const songs = [
  ...(PLAYLIST.length > 1 ? [{ id: 'all', name: 'All of them, one after another' }] : []),
  ...PLAYLIST.map((id) => ({ id, name: SONGS[id].name })),
];

const saved = (k, d) => { try { return localStorage.getItem('tanglecube.' + k) ?? d; } catch { return d; } };
const keep = (k, v) => { try { localStorage.setItem('tanglecube.' + k, String(v)); } catch { /* ignore */ } };

const savedSong = saved('song', 'all');
let songId = savedSong === 'all' || SONGS[savedSong] ? savedSong : 'all';
let current = songId === 'all' ? saved('songPlaying', PLAYLIST[0]) : songId;
if (!SONGS[current]) current = PLAYLIST[0];
let songPos = Number(saved('songPos', 0)) || 0;

export const currentSong = () => songId;

export function setSong(id) {
  songId = id === 'all' || SONGS[id] ? id : 'all';
  current = songId === 'all' ? PLAYLIST[0] : songId;
  songPos = 0;
  keep('song', songId); keep('songPlaying', current); keep('songPos', 0);
}

function nextNote() {
  const notes = SONGS[current].parsed;
  if (songPos >= notes.length) songPos = 0;
  const n = notes[songPos++];
  if (songPos >= notes.length) {
    songPos = 0;
    // In playlist mode, move on to the next tune.
    if (songId === 'all') current = PLAYLIST[(PLAYLIST.indexOf(current) + 1) % PLAYLIST.length];
  }
  keep('songPlaying', current); keep('songPos', songPos);
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

// Play one song note as a soft pluck plus a whoosh.
export function pluck([semitones, hold = 1]) {
  if (!ready()) return;
  const now = ctx.currentTime;
  const f = note(semitones);
  tone(f, now, { gain: 0.22, decay: 0.5 * hold });
  tone(f * 2, now, { type: 'sine', gain: 0.05, decay: 0.3 * hold });
  tone(f / 2, now, { type: 'sine', gain: 0.08, decay: 0.4 * hold });
  hiss(now + 0.03, { from: 500, to: 3200, duration: 0.3, gain: 0.04 });
}

// An arrow slides off: play the next note of the song. Returns the note so
// the clear can be replayed with the same tune.
export function slide() {
  const n = nextNote();
  pluck(n);
  return n;
}

// A whole side cleared: play the next few notes of the song as a quick run,
// with a little sparkle on top.
export function phrase(count = 6, beat = 0.17) {
  if (!ready()) return;
  let t = ctx.currentTime + 0.12;
  for (let i = 0; i < count; i++) {
    const [semitones, hold = 1] = nextNote();
    const f = note(semitones);
    tone(f, t, { gain: 0.2, decay: 0.45 * hold });
    tone(f / 2, t, { type: 'sine', gain: 0.07, decay: 0.4 * hold });
    t += beat * Math.min(hold, 2);
  }
  [24, 28, 31, 36].forEach((s, i) => tone(note(s), t + i * 0.05, { type: 'sine', gain: 0.05, decay: 0.5 }));
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
