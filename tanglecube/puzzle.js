// Puzzle model for Tanglecube. Pure logic, no rendering, so it can be tested
// on its own.
//
// The board is the outside surface of a box of A x B x C unit voxels. A
// surface cell is one voxel face that touches the outside: a voxel position
// v (integers) plus an outward normal n (one of the six axis directions).
//
// An arrow is a chain of neighbouring surface cells, tail first, head last.
// Chains can bend inside a face and wrap over the box's edges. When tapped,
// an arrow slides forward head first, straight along its head's face. It
// escapes only if every cell in front of its head, up to that face's edge,
// is empty.

export const AXES = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

export const dirIndex = (d) => AXES.findIndex((a) => a[0] === d[0] && a[1] === d[1] && a[2] === d[2]);
export const cellKey = (v, n) => `${v[0]},${v[1]},${v[2]},${n}`;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const neg = (a) => [-a[0], -a[1], -a[2]];

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Board {
  constructor(size) {
    this.size = size;
    this.cells = new Map(); // key -> { key, v, n }
    const [A, B, C] = size;
    for (let x = 0; x < A; x++)
      for (let y = 0; y < B; y++)
        for (let z = 0; z < C; z++)
          for (let n = 0; n < 6; n++) {
            const v = [x, y, z];
            if (!this.inside(add(v, AXES[n]))) {
              const key = cellKey(v, n);
              this.cells.set(key, { key, v, n });
            }
          }
  }

  inside(v) {
    return v[0] >= 0 && v[1] >= 0 && v[2] >= 0 &&
      v[0] < this.size[0] && v[1] < this.size[1] && v[2] < this.size[2];
  }

  // Step from a cell in tangent direction t (an AXES index perpendicular to
  // the cell's normal). Returns { cell, dir } where dir is the direction of
  // travel on arrival; crossing an edge turns the direction downward.
  step(cell, t) {
    const v2 = add(cell.v, AXES[t]);
    if (this.inside(v2)) return { cell: this.cells.get(cellKey(v2, cell.n)), dir: t };
    return { cell: this.cells.get(cellKey(cell.v, t)), dir: dirIndex(neg(AXES[cell.n])) };
  }

  tangents(cell) {
    return [0, 1, 2, 3, 4, 5].filter((t) => (t >> 1) !== (cell.n >> 1));
  }

  // Cells in front of a head travelling in direction d, up to its face's edge.
  ray(cell, d) {
    const out = [];
    let v = add(cell.v, AXES[d]);
    while (this.inside(v)) {
      out.push(cellKey(v, cell.n));
      v = add(v, AXES[d]);
    }
    return out;
  }

  // World-space point at the centre of a cell, in voxel coordinates.
  center(cell) {
    const n = AXES[cell.n];
    return [cell.v[0] + n[0] / 2, cell.v[1] + n[1] / 2, cell.v[2] + n[2] / 2];
  }
}

// Head direction: the direction of travel into the head cell.
export function headDir(board, cells) {
  const a = cells[cells.length - 2], b = cells[cells.length - 1];
  for (const t of board.tangents(a)) {
    const s = board.step(a, t);
    if (s.cell === b) return s.dir;
  }
  throw new Error('arrow cells are not connected');
}

// ---------------------------------------------------------------------------
// Level generation.
//
// Arrows are added one at a time, and each new arrow's head must have a clear
// run over cells that are empty *at the time it is added*. Later arrows may
// then be laid across that run. Removing arrows newest-first always works, so
// every level is solvable, and since removing an arrow never blocks another,
// no sequence of moves can make a level unsolvable.
// ---------------------------------------------------------------------------
export function generate(level) {
  const rng = mulberry32(level.seed);
  const board = new Board(level.size);
  const occupied = new Map(); // cellKey -> arrow index
  const arrows = [];
  const total = board.cells.size;
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  // Cells that could still become a head. Occupying cells only ever removes
  // options, so once a cell can't host a head it never will again and is
  // dropped from the pool. Keeps generation fast on 100-wide cubes.
  const pool = [...board.cells.values()];
  const poolIndex = new Map(pool.map((c, i) => [c.key, i]));
  const dropFromPool = (key) => {
    const i = poolIndex.get(key);
    if (i === undefined) return;
    const last = pool.pop();
    if (i < pool.length) { pool[i] = last; poolIndex.set(last.key, i); }
    poolIndex.delete(key);
  };

  // Cells that lie in front of an existing arrow's head. Laying a new arrow
  // over them makes that arrow wait for it, which is where difficulty comes from.
  const blocking = new Map(); // cellKey -> array of arrow indices

  // Heads deep inside a face go first, so the runs of later, outer arrows
  // are still clear when they are placed. Sampling a few cells and keeping
  // the deepest gives that order loosely, with plenty of randomness.
  const depth = (c) => {
    let m = Infinity;
    for (let i = 0; i < 3; i++) if (i !== c.n >> 1) m = Math.min(m, c.v[i], board.size[i] - 1 - c.v[i]);
    return m;
  };
  const samples = level.samples || 4;
  function pickHead() {
    let best = pick(pool), bd = depth(best);
    for (let i = 1; i < samples; i++) {
      const c = pick(pool), cd = depth(c);
      if (cd > bd) { best = c; bd = cd; }
    }
    return best;
  }

  function candidate() {
    const head = pickHead();

    // Choose a head direction whose run is clear right now.
    let options = [];
    for (const d of board.tangents(head)) {
      const ray = board.ray(head, d);
      if (ray.every((k) => !occupied.has(k))) options.push({ d, ray });
    }
    if (!options.length) { dropFromPool(head.key); return null; }
    if (rng() < level.twist) {
      const longest = Math.max(...options.map((o) => o.ray.length));
      options = options.filter((o) => o.ray.length === longest);
    }
    const { d, ray } = pick(options);
    const rayKeys = new Set(ray);

    // Grow the body backwards from the head.
    const back = d ^ 1; // opposite direction index
    const target = level.minLen + Math.floor(rng() * (level.maxLen - level.minLen + 1));
    const body = [head];
    const used = new Set([head.key]);
    let cur = head, curBack = back;
    while (body.length < target) {
      const choices = [];
      for (const t of board.tangents(cur)) {
        const s = board.step(cur, t);
        if (s.cell && !occupied.has(s.cell.key) && !used.has(s.cell.key) && !rayKeys.has(s.cell.key)) choices.push({ t, s });
      }
      // The first step must continue straight back so the head points along its face.
      const allowed = body.length === 1 ? choices.filter((c) => c.t === back) : choices;
      if (!allowed.length) break;
      const straight = allowed.find((c) => c.t === curBack);
      const choice = straight && rng() < level.straight ? straight : pick(allowed);
      body.push(choice.s.cell);
      used.add(choice.s.cell.key);
      cur = choice.s.cell;
      curBack = choice.s.dir;
    }
    if (body.length < 2) return null;

    const blocks = new Set();
    for (const c of body) for (const i of blocking.get(c.key) || []) blocks.add(i);
    const score = blocks.size * 3 + ray.length * 0.4 + body.length * 0.3 + rng();
    return { cells: body.reverse(), ray, score }; // cells: tail ... head
  }

  const tries = 1 + Math.round(level.twist * 10);
  let misses = 0;
  while (pool.length && occupied.size < total * level.fill && misses < 200) {
    let best = null;
    for (let i = 0; i < tries && pool.length; i++) {
      const c = candidate();
      if (c && (!best || c.score > best.score)) best = c;
    }
    if (!best) { misses++; continue; }
    misses = 0;
    const index = arrows.length;
    for (const c of best.cells) { occupied.set(c.key, index); dropFromPool(c.key); }
    for (const k of best.ray) {
      if (!blocking.has(k)) blocking.set(k, []);
      blocking.get(k).push(index);
    }
    arrows.push({ cells: best.cells, dir: headDir(board, best.cells) });
  }
  return { board, arrows };
}

// Check that a set of arrows can be fully cleared (used by tests).
export function solveOrder(board, arrows) {
  const occ = new Map();
  arrows.forEach((a, i) => a.cells.forEach((c) => occ.set(c.key, i)));
  const left = new Set(arrows.keys());
  const order = [];
  let progress = true;
  while (left.size && progress) {
    progress = false;
    for (const i of [...left]) {
      const a = arrows[i];
      const head = a.cells[a.cells.length - 1];
      if (board.ray(head, a.dir).every((k) => !occ.has(k))) {
        a.cells.forEach((c) => occ.delete(c.key));
        left.delete(i);
        order.push(i);
        progress = true;
      }
    }
  }
  return left.size ? null : order;
}
