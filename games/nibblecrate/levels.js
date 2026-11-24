// Pictures and crate generation.
//
// Each picture is drawn as rows of letters, one letter per pixel ("." is
// empty). The letters map to colours in PALETTE. Every picture here was drawn
// for this game.

export const PALETTE = {
  R: '#e5484d', // red
  P: '#f59fb8', // pink
  O: '#f28c28', // orange
  Y: '#f7c948', // yellow
  G: '#46a758', // green
  L: '#8ed1f5', // light blue
  B: '#2f7fd8', // blue
  V: '#8e5bd8', // purple
  T: '#2bb3a3', // teal
  N: '#a0643a', // brown
  D: '#5a3418', // dark brown
  S: '#e8c79a', // tan
  K: '#2b2730', // ink
  W: '#fdfdfd', // white
};

export const COLOR_NAMES = {
  R: 'red', P: 'pink', O: 'orange', Y: 'yellow', G: 'green', L: 'sky', B: 'blue',
  V: 'purple', T: 'teal', N: 'brown', D: 'cocoa', S: 'tan', K: 'ink', W: 'white',
};

export const LEVELS = [
  {
    name: 'Heart',
    art: `
      ..RR..RR..
      .RRRRRRRR.
      RRWRRRRRRR
      RWWRRRRRRR
      RRRRRRRRRR
      .RRRRRRRR.
      ..RRRRRR..
      ...RRRR...
      ....RR....`,
  },
  {
    name: 'Mushroom',
    art: `
      ....RRRR....
      ..RRRRWWRR..
      .RRWWRRWWRR.
      .RWWWWRRRRR.
      RRWWWRRRWWRR
      RRRRRRRWWWRR
      RRRRRRRRRRRR
      ..SSSSSSSS..
      ...SKSSKSS..
      ...SSSSSS...
      ...SSSSSS...
      ....SSSS....`,
  },
  {
    name: 'Strawberry',
    art: `
      .....G.G.....
      ..GGGGGGGGG..
      .RRRGGRGGRRR.
      RRYRRRRRRRYRR
      RRRRYRRRYRRRR
      RYRRRRRRRRRYR
      RRRYRRYRRYRRR
      .RRRRRRRRRRR.
      .RYRRRYRRRYR.
      ..RRRRRRRRR..
      ...RRYRYRR...
      ....RRRRR....
      .....RRR.....
      ......R......`,
  },
  {
    name: 'Rocket',
    art: `
      .....RR.....
      ....RRRR....
      ...RRRRRR...
      ...WWWWWW...
      ...WWBBWW...
      ...WBLLBW...
      ...WBBBBW...
      ...WWBBWW...
      ...WWWWWW...
      ...WWWWWW...
      ..RWWWWWWR..
      .RRWWWWWWRR.
      .RR.WWWW.RR.
      ....OYYO....
      ....OYYO....
      .....OO.....`,
  },
  {
    name: 'Cat',
    art: `
      .KK........KK.
      .KOK......KOK.
      .KOOKKKKKKOOK.
      KOOOOOOOOOOOOK
      KOOKKOOOOKKOOK
      KOOKWOOOOKWOOK
      KOOOOOOOOOOOOK
      KPPOOOPPOOOPPK
      KOOOOKOOKOOOOK
      .KOOOOKKOOOOK.
      ..KKOOOOOOKK..
      ....KKKKKK....`,
  },
  {
    name: 'Fish',
    art: `
      .....BBBBBB.....
      ...BBLLLLLLBB.YY
      ..BLKWLLLLLLLBYY
      .BLLKKLLLLLLLBYY
      BLLLLLLLYLLLLBYY
      BLLLLLLYYLLLLBYY
      .BLLLLLLLLLLLBYY
      ..BLLLLLLLLLB.YY
      ...BBLLLLLLBB.YY
      .....BBBBBB.....`,
  },
  {
    name: 'Sunflower',
    art: `
      ......YYY......
      ..YY.YYYYY.YY..
      .YYYYNNNNNYYYY.
      ..YYNNDNDNNYY..
      .YYNNDNDNDNNYY.
      YYYNDNDNDNDNYYY
      .YYNNDNDNDNNYY.
      ..YYNNDNDNNYY..
      .YYYYNNNNNYYYY.
      ..YY.YYYYY.YY..
      .......G.......
      .GG....G.......
      .GGG...G...GG..
      ..GGG..G..GGG..
      ...GGG.G.GGG...
      .....GGGGG.....`,
  },
  {
    name: 'Frog',
    art: `
      ..WWW......WWW..
      .WKKWG....GWKKW.
      .WKKWGGGGGGWKKW.
      ..WWGGGGGGGGWW..
      .GGGGGGGGGGGGGG.
      GGGGGGGGGGGGGGGG
      GGPGGGGGGGGGGPGG
      GGGRRRRRRRRRRGGG
      .GGGRRRRRRRRGGG.
      ..GGGGGGGGGGGG..
      .TTGGGGGGGGGGTT.
      TTTTGG....GGTTTT`,
  },
];

export function parseArt(art) {
  const rows = art.trim().split('\n').map((r) => r.trim());
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const grid = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) {
      const c = rows[y][x] || '.';
      row.push(c === '.' ? null : c);
    }
    grid.push(row);
  }
  return { w, h, grid };
}

// --- Seeded randomness, so a random picture can be replayed ---------------

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// A random, mirrored critter-ish sprite: blobby body, a dark outline, a few
// patches of colour and a pair of eyes.
const SCHEMES = [
  ['K', 'V', 'P', 'Y'],
  ['K', 'G', 'Y', 'T'],
  ['D', 'O', 'Y', 'R'],
  ['K', 'B', 'L', 'W'],
  ['D', 'R', 'P', 'Y'],
  ['K', 'T', 'L', 'Y'],
  ['N', 'S', 'O', 'W'],
];

export function randomPicture(seed) {
  const rand = rng(seed * 2654435761);
  const w = 16;
  const h = 14 + Math.floor(rand() * 3);
  const half = w / 2;
  let cells = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < half; x++) {
      // Fuller near the middle, sparse at the edges.
      const dx = (half - 0.5 - x) / half;
      const dy = (y - (h - 1) / 2) / (h / 2);
      const d = Math.sqrt(dx * dx * 0.9 + dy * dy);
      row.push(rand() < 1.3 - d * 0.85);
    }
    cells.push(row);
  }
  // Smooth with a couple of cellular automaton passes.
  for (let pass = 0; pass < 3; pass++) {
    const next = cells.map((r) => r.slice());
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < half; x++) {
        let n = 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            const yy = y + oy;
            let xx = x + ox;
            if (xx >= half) xx = w - 1 - xx; // mirror
            if (yy >= 0 && yy < h && xx >= 0 && cells[yy][xx]) n++;
          }
        }
        next[y][x] = n >= 5 || (cells[y][x] && n >= 4);
      }
    }
    cells = next;
  }
  const full = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) row.push(cells[y][x < half ? x : w - 1 - x]);
    full.push(row);
  }
  // Keep only the largest connected blob.
  const seen = full.map((r) => r.map(() => false));
  let best = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!full[y][x] || seen[y][x]) continue;
      const blob = [];
      const stack = [[x, y]];
      seen[y][x] = true;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        blob.push([cx, cy]);
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + ox, ny = cy + oy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && full[ny][nx] && !seen[ny][nx]) {
            seen[ny][nx] = true;
            stack.push([nx, ny]);
          }
        }
      }
      if (blob.length > best.length) best = blob;
    }
  }
  if (best.length < 60) return randomPicture(seed + 7919);

  const [outline, body, patch, accent] = SCHEMES[Math.floor(rand() * SCHEMES.length)];
  const grid = full.map((r) => r.map(() => null));
  for (const [x, y] of best) grid[y][x] = body;
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && grid[y][x];

  // Patches: a few mirrored circles.
  const spots = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < spots; i++) {
    const [sx, sy] = best[Math.floor(rand() * best.length)];
    const r = 1 + rand() * 1.8;
    const col = i === 0 ? accent : patch;
    for (const [x, y] of best) {
      const mx = x < half ? x : w - 1 - x;
      const msx = sx < half ? sx : w - 1 - sx;
      if ((mx - msx) ** 2 + (y - sy) ** 2 <= r * r) grid[y][x] = col;
    }
  }
  // Outline: any body pixel touching empty space.
  const edge = [];
  for (const [x, y] of best) {
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!inside(x + ox, y + oy)) { edge.push([x, y]); break; }
    }
  }
  for (const [x, y] of edge) grid[y][x] = outline;
  // Eyes in the upper middle, if there's room.
  const ey = Math.floor(h * 0.35);
  for (let ex = 4; ex <= 6; ex++) {
    const a = grid[ey][ex], b = grid[ey + 1] && grid[ey + 1][ex];
    if (a && b && a !== outline && b !== outline) {
      for (const xx of [ex, w - 1 - ex]) {
        grid[ey][xx] = 'W';
        grid[ey + 1][xx] = outline === 'K' || outline === 'D' ? outline : 'K';
      }
      break;
    }
  }
  return { w, h, grid };
}

// --- Crates --------------------------------------------------------------

// "Onion peel" depth of every pixel: 0 for pixels a critter can reach right
// away (first in their row or column from any side), 1 for the ones exposed
// once those are gone, and so on.
export function peelDepths(grid) {
  const h = grid.length, w = grid[0].length;
  const g = grid.map((r) => r.slice());
  const depth = grid.map((r) => r.map(() => -1));
  let left = 0;
  for (const r of g) for (const c of r) if (c) left++;
  let d = 0;
  while (left > 0) {
    const hit = exposedCells(g);
    for (const [x, y] of hit) {
      depth[y][x] = d;
      g[y][x] = null;
      left--;
    }
    d++;
  }
  return depth;
}

export function exposedCells(g) {
  const h = g.length, w = g[0].length;
  const out = new Set();
  const add = (x, y) => out.add(y * w + x);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (g[y][x]) { add(x, y); break; }
    for (let x = w - 1; x >= 0; x--) if (g[y][x]) { add(x, y); break; }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) if (g[y][x]) { add(x, y); break; }
    for (let y = h - 1; y >= 0; y--) if (g[y][x]) { add(x, y); break; }
  }
  return [...out].map((i) => [i % w, Math.floor(i / w)]);
}

// Split each colour's pixels into crates (outermost pixels first), then
// order every crate by how deep its pixels sit, with a little shuffle, and
// deal them into columns. Crate counts add up exactly to the pixel counts,
// so a cleared picture always empties every crate.
export function makeCrates(grid, seed) {
  const rand = rng(seed * 40503 + 17);
  const depth = peelDepths(grid);
  const byColor = {};
  grid.forEach((row, y) => row.forEach((c, x) => {
    if (c) (byColor[c] = byColor[c] || []).push(depth[y][x]);
  }));
  let total = 0;
  for (const k in byColor) total += byColor[k].length;
  const lo = total < 110 ? 5 : 8;
  const hi = total < 110 ? 12 : 20;

  const crates = [];
  for (const color of Object.keys(byColor)) {
    const ds = byColor[color].sort((a, b) => a - b);
    let i = 0;
    while (i < ds.length) {
      let size = lo + Math.floor(rand() * (hi - lo + 1));
      if (ds.length - (i + size) < lo) size = ds.length - i;
      const chunk = ds.slice(i, i + size);
      const mean = chunk.reduce((a, b) => a + b, 0) / chunk.length;
      crates.push({ color, count: chunk.length, key: chunk[0] * 0.6 + mean * 0.4 + rand() * 1.2 });
      i += size;
    }
  }
  crates.sort((a, b) => a.key - b.key);
  const cols = crates.length > 14 ? 4 : 3;
  const columns = Array.from({ length: cols }, () => []);
  crates.forEach((c, i) => columns[i % cols].push({ color: c.color, count: c.count }));
  return columns;
}
