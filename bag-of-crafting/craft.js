/*
 * Bag of Crafting engine.
 *
 * A straight port of the game's crafting logic as reverse-engineered by the
 * External Item Descriptions mod (features/eid_bagofcrafting.lua), which is
 * checked against the real game through REPENTOGON. Works in the page, in the
 * Web Worker and in Node (for tests).
 */
(function (root) {
  "use strict";

  // Pickup ids 1..29 as the game numbers them, with their crafting value.
  // Glyphs are plain emoji so we ship no game art.
  var PICKUPS = [
    null,
    { id: 1, name: "Red Heart", short: "Red", value: 1, glyph: "❤️", group: "Hearts" },
    { id: 2, name: "Soul Heart", short: "Soul", value: 4, glyph: "💙", group: "Hearts" },
    { id: 3, name: "Black Heart", short: "Black", value: 5, glyph: "🖤", group: "Hearts" },
    { id: 4, name: "Eternal Heart", short: "Eternal", value: 5, glyph: "🤍", group: "Hearts" },
    { id: 5, name: "Gold Heart", short: "Gold", value: 5, glyph: "💛", group: "Hearts" },
    { id: 6, name: "Bone Heart", short: "Bone", value: 5, glyph: "🦴", group: "Hearts" },
    { id: 7, name: "Rotten Heart", short: "Rotten", value: 1, glyph: "🤎", group: "Hearts" },
    { id: 8, name: "Penny", short: "Penny", value: 1, glyph: "🪙", group: "Coins" },
    { id: 9, name: "Nickel", short: "Nickel", value: 3, glyph: "🥈", group: "Coins" },
    { id: 10, name: "Dime", short: "Dime", value: 5, glyph: "💿", group: "Coins" },
    { id: 11, name: "Lucky Penny", short: "Lucky", value: 8, glyph: "🍀", group: "Coins" },
    { id: 12, name: "Key", short: "Key", value: 2, glyph: "🔑", group: "Keys" },
    { id: 13, name: "Golden Key", short: "Gold Key", value: 7, glyph: "🗝️", group: "Keys" },
    { id: 14, name: "Charged Key", short: "Chg Key", value: 5, glyph: "⚡", group: "Keys" },
    { id: 15, name: "Bomb", short: "Bomb", value: 2, glyph: "💣", group: "Bombs" },
    { id: 16, name: "Golden Bomb", short: "Gold Bomb", value: 7, glyph: "🌟", group: "Bombs" },
    { id: 17, name: "Giga Bomb", short: "Giga", value: 10, glyph: "💥", group: "Bombs" },
    { id: 18, name: "Micro Battery", short: "Micro", value: 2, glyph: "🔋", group: "Batteries" },
    { id: 19, name: "Lil' Battery", short: "Lil'", value: 4, glyph: "🔌", group: "Batteries" },
    { id: 20, name: "Mega Battery", short: "Mega", value: 8, glyph: "🪫", group: "Batteries" },
    { id: 21, name: "Card", short: "Card", value: 2, glyph: "🃏", group: "Other" },
    { id: 22, name: "Pill", short: "Pill", value: 2, glyph: "💊", group: "Other" },
    { id: 23, name: "Rune", short: "Rune", value: 4, glyph: "🔮", group: "Other" },
    { id: 24, name: "Dice Shard", short: "Shard", value: 4, glyph: "🎲", group: "Other" },
    { id: 25, name: "Cracked Key", short: "Cracked", value: 2, glyph: "🦷", group: "Keys" },
    { id: 26, name: "Golden Penny", short: "Gold Penny", value: 7, glyph: "🏅", group: "Coins" },
    { id: 27, name: "Golden Pill", short: "Gold Pill", value: 7, glyph: "✨", group: "Other" },
    { id: 28, name: "Golden Battery", short: "Gold Batt", value: 7, glyph: "🔆", group: "Batteries" },
    { id: 29, name: "Poop Nugget", short: "Poop", value: 0, glyph: "💩", group: "Other" }
  ];
  var PICKUP_COUNT = 29;

  // xorshift triples; pickup N shifts the RNG with row N, every roll uses row 6.
  var SHIFTS = [
    [1, 5, 16], [1, 5, 19], [1, 9, 29], [1, 11, 6], [1, 11, 16], [1, 19, 3], [1, 21, 20],
    [1, 27, 27], [2, 5, 15], [2, 5, 21], [2, 7, 7], [2, 7, 9], [2, 7, 25], [2, 9, 15],
    [2, 15, 17], [2, 15, 25], [2, 21, 9], [3, 1, 14], [3, 3, 26], [3, 3, 28], [3, 3, 29],
    [3, 5, 20], [3, 5, 22], [3, 5, 25], [3, 7, 29], [3, 13, 7], [3, 23, 25], [3, 25, 24],
    [3, 27, 11], [4, 3, 17]
  ];
  var ROLL_SHIFT = SHIFTS[6];
  var FLOAT_MULT = 2.3283061589829401e-10;

  var POOL_NAMES = {
    0: "Treasure", 1: "Shop", 2: "Boss", 3: "Devil", 4: "Angel", 5: "Secret",
    7: "Shell Game", 8: "Golden Chest", 9: "Red Chest", 12: "Curse", 26: "Planetarium"
  };

  function rngNext(s, sh) {
    s = (s ^ (s >>> sh[0])) >>> 0;
    s = (s ^ (s << sh[1])) >>> 0;
    s = (s ^ (s >>> sh[2])) >>> 0;
    return s;
  }

  // ---- Seeds -------------------------------------------------------------
  var SEED_CHARS = "ABCDEFGHJKLMNPQRSTWXYZ01234V6789";

  function seedChecksum(num) {
    var v8 = 0, j = num >>> 0;
    while (j !== 0) {
      var v10 = ((j & 0xff) + v8) & 0xff;
      j = j >>> 5;
      v8 = ((v10 >>> 7) + 2 * v10) & 0xff;
    }
    return v8;
  }

  // "ABCD EFGH" -> { seed: uint32 } or { error }
  function parseSeed(text) {
    var s = String(text || "").toUpperCase().replace(/[\s-]/g, "");
    // Common lookalikes people type from the pause screen.
    s = s.replace(/O/g, "0").replace(/I/g, "1");
    if (s.length !== 8) return { error: "A seed is 8 characters, like ABCD EFGH." };
    var n = [];
    for (var i = 0; i < 8; i++) {
      var k = SEED_CHARS.indexOf(s[i]);
      if (k < 0) return { error: "“" + s[i] + "” never appears in an Isaac seed." };
      n.push(k);
    }
    var raw = (n[0] * Math.pow(2, 27) + n[1] * Math.pow(2, 22) + n[2] * Math.pow(2, 17) +
      n[3] * 4096 + n[4] * 128 + n[5] * 4 + (n[6] >>> 3));
    var seed = (raw ^ 0xfef7ffd) >>> 0;
    var check = (n[7] | ((n[6] << 5) & 0xff)) & 0xff;
    if (seedChecksum(seed) !== check) {
      return { error: "That isn't a valid seed. Double-check it on the pause screen.", seed: seed };
    }
    return { seed: seed, text: s.slice(0, 4) + " " + s.slice(4) };
  }

  function seedToString(seed) {
    var raw = ((seed >>> 0) ^ 0xfef7ffd) >>> 0;
    var check = seedChecksum(seed >>> 0);
    // 40 bits: raw (32) then checksum (8), read as eight 5-bit groups.
    var bits = "", out = [], i;
    for (i = 31; i >= 0; i--) bits += (raw >>> i) & 1;
    for (i = 7; i >= 0; i--) bits += (check >>> i) & 1;
    for (i = 0; i < 8; i++) out.push(SEED_CHARS[parseInt(bits.substr(i * 5, 5), 2)]);
    return out.slice(0, 4).join("") + " " + out.slice(4).join("");
  }

  // ---- Options -----------------------------------------------------------
  // Weighting step (item never enters the draw): greed, challenge.
  // Generating step (rolled, then rerolled): Keeper, Tainted Lost, Lost+Birthright, NO!, locked items.
  function makeContext(data, opts) {
    opts = opts || {};
    var items = data.items;
    var max = data.maxItemId;
    var quality = new Int8Array(max + 1).fill(-1);
    var allowed = new Uint8Array(max + 1);
    var available = new Uint8Array(max + 1);
    var locked = opts.locked || {};
    for (var id = 1; id <= max; id++) {
      var it = items[id];
      if (!it) continue;
      quality[id] = it.cq;
      var t = it.t || [];
      allowed[id] = 1;
      if (opts.greed && t.indexOf("nogreed") >= 0) allowed[id] = 0;
      if (opts.challenge && t.indexOf("nochallenge") >= 0) allowed[id] = 0;
      available[id] = 1;
      if (opts.keeper && t.indexOf("nokeeper") >= 0) available[id] = 0;
      if (opts.lostBirthright && t.indexOf("nolostbr") >= 0) available[id] = 0;
      if (opts.taintedLost && t.indexOf("offensive") < 0) available[id] = 0;
      if (opts.noTrinket && it.act) available[id] = 0;
      if (locked[id]) available[id] = 0;
    }
    // Quality sums of the fixed recipes, so the finder can skip the string lookup.
    var recipeSums = new Set();
    Object.keys(data.recipes).forEach(function (k) {
      recipeSums.add(k.split(",").reduce(function (a, c) { return a + PICKUPS[+c].value; }, 0));
    });
    return {
      data: data, opts: opts, quality: quality, allowed: allowed, available: available,
      tables: new Map(), recipeSums: recipeSums
    };
  }

  function qualityRange(n) {
    if (n > 34) return [4, 4];
    if (n > 26) return [3, 4];
    if (n > 22) return [2, 4];
    if (n > 18) return [2, 3];
    if (n > 14) return [1, 2];
    if (n > 8) return [0, 2];
    return [0, 1];
  }

  function poolWeightsFor(counts) {
    var pw = [
      [0, 1], [1, 2], [2, 2],
      [3, counts[3] * 10], [4, counts[4] * 10], [5, counts[6] * 5],
      [7, counts[29] * 10], [8, counts[5] * 10], [9, counts[25] * 10], [12, counts[7] * 10]
    ];
    if (counts[8] + counts[1] + counts[12] + counts[15] === 0) pw.push([26, counts[23] * 10]);
    return pw;
  }

  // Build the weighted list for one (quality sum, pool weights) combination.
  // Order of float additions mirrors the Lua so totals match bit for bit.
  function buildTable(ctx, qsum, pw) {
    var data = ctx.data, max = data.maxItemId;
    var weights = new Float64Array(max + 1);
    var total = 0;
    var poolInfo = [];
    for (var p = 0; p < pw.length; p++) {
      var idx = pw[p][0], w = pw[p][1];
      if (w <= 0) continue;
      var n = qsum;
      if (idx >= 3 && idx <= 5) n -= 5;
      var qr = qualityRange(n);
      var pool = data.pools[idx].items;
      var poolTotal = 0;
      for (var i = 0; i < pool.length; i++) {
        var id = pool[i][0];
        var q = ctx.quality[id];
        if (ctx.allowed[id] && q >= qr[0] && q <= qr[1]) {
          var iw = pool[i][1] * w;
          weights[id] += iw;
          total += iw;
          poolTotal += iw;
        }
      }
      poolInfo.push({ pool: idx, name: POOL_NAMES[idx], mult: w, qmin: qr[0], qmax: qr[1], weight: poolTotal });
    }
    var ids = [], ws = [], cum = [];
    var acc = 0;
    for (var k = 1; k <= max; k++) {
      if (weights[k] > 0) { ids.push(k); ws.push(weights[k]); acc += weights[k]; cum.push(acc); }
    }
    return { ids: ids, ws: ws, cum: cum, total: total, pools: poolInfo };
  }

  function tableKey(qsum, counts) {
    var planet = (counts[8] + counts[1] + counts[12] + counts[15] === 0) ? counts[23] : 0;
    return ((((((((qsum * 9 + counts[3]) * 9 + counts[4]) * 9 + counts[6]) * 9 + counts[29]) * 9 +
      counts[5]) * 9 + counts[25]) * 9 + counts[7]) * 9 + planet);
  }

  function getTable(ctx, qsum, counts) {
    var key = tableKey(qsum, counts);
    var t = ctx.tables.get(key);
    if (!t) { t = buildTable(ctx, qsum, poolWeightsFor(counts)); ctx.tables.set(key, t); }
    return t;
  }

  // Exactly the Lua loop: subtract weights in id order until below zero.
  function pickLinear(t, target) {
    for (var i = 0; i < t.ids.length; i++) {
      target -= t.ws[i];
      if (target < 0) return i;
    }
    return -1;
  }

  // Fast path: binary search on the running sum, falling back to the exact
  // loop when the target sits close enough to a boundary for rounding to matter.
  function pick(t, target) {
    var cum = t.cum, lo = 0, hi = cum.length - 1;
    if (hi < 0 || target >= cum[hi]) return pickLinear(t, target);
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (cum[mid] > target) hi = mid; else lo = mid + 1;
    }
    var eps = t.total * 1e-9;
    if (Math.abs(cum[lo] - target) < eps || (lo > 0 && Math.abs(cum[lo - 1] - target) < eps)) {
      return pickLinear(t, target);
    }
    return lo;
  }

  function countsOf(components) {
    var counts = new Array(PICKUP_COUNT + 2).fill(0);
    for (var i = 0; i < components.length; i++) counts[components[i]]++;
    return counts;
  }

  // Fast result for the recipe finder: components must be sorted ascending.
  function craftFast(ctx, sorted, seed, counts, qsum, rng) {
    if (ctx.recipeSums.has(qsum)) {
      var fixed = ctx.data.recipes[sorted.join(",")];
      if (fixed !== undefined && ctx.available[fixed]) return fixed;
    }
    var t = getTable(ctx, qsum, counts);
    for (var r = 0; r < 20; r++) {
      rng = rngNext(rng, ROLL_SHIFT);
      var i = pick(t, rng * FLOAT_MULT * t.total);
      if (i < 0) break;
      var id = t.ids[i];
      if (ctx.available[id]) return id;
    }
    return 25; // Breakfast
  }

  // Full explanation for the calculator view.
  //   result   - item you get
  //   rolls    - every item rolled before it (rerolled because unavailable)
  //   ifLocked - the chain you would walk if each achievement-locked roll were still locked
  function craft(ctx, components, seed) {
    var sorted = components.slice().sort(function (a, b) { return a - b; });
    var counts = countsOf(sorted);
    var qsum = 0;
    var rng = seed >>> 0;
    for (var i = 0; i < sorted.length; i++) {
      qsum += PICKUPS[sorted[i]].value;
      rng = rngNext(rng, SHIFTS[sorted[i]]);
    }
    var t = getTable(ctx, qsum, counts);
    var out = { qualitySum: qsum, pools: t.pools, total: t.total, fixed: null, rolls: [], result: 25, ifLocked: [] };
    var items = ctx.data.items;

    var fixed = ctx.data.recipes[sorted.join(",")];
    if (fixed !== undefined) {
      out.fixed = fixed;
      if (ctx.available[fixed]) {
        out.result = fixed;
        if (items[fixed] && items[fixed].a) out.fixedNeedsUnlock = true;
      }
    }

    // Walk all 20 rolls once so we can show the locked-item fallback chain too.
    var resultFound = out.fixed !== null && out.result === out.fixed;
    var chainDone = false;
    for (var r = 0; r < 20; r++) {
      rng = rngNext(rng, ROLL_SHIFT);
      var k = pickLinear(t, rng * FLOAT_MULT * t.total);
      if (k < 0) break;
      var id = t.ids[k];
      if (!resultFound) {
        if (ctx.available[id]) { out.result = id; resultFound = true; }
        else out.rolls.push(id);
      }
      if (!chainDone && ctx.available[id]) {
        out.ifLocked.push(id);
        if (!(items[id] && items[id].a)) chainDone = true;
      }
      if (resultFound && chainDone) break;
    }
    if (!chainDone) out.ifLocked.push(25);
    // Odds of each quality tier and pool for this bag, ignoring the seed.
    var qOdds = [0, 0, 0, 0, 0];
    for (i = 0; i < t.ids.length; i++) {
      var q = ctx.quality[t.ids[i]];
      if (q >= 0 && q <= 4) qOdds[q] += t.ws[i];
    }
    out.qualityOdds = qOdds.map(function (w) { return t.total ? w / t.total : 0; });
    out.candidates = t.ids.length;
    return out;
  }

  // Enumerate every bag of 8 drawn from `have` (have[id] = how many you hold).
  // onResult(itemId, sortedComponents) is called for every bag.
  function enumerate(ctx, have, seed, onResult, onProgress) {
    var types = [];
    for (var id = 1; id <= PICKUP_COUNT; id++) if (have[id] > 0) types.push(id);
    var comp = new Array(8);
    var counts = new Array(PICKUP_COUNT + 2).fill(0);
    var total = countBags(have), done = 0, nextReport = 50000;
    function rec(depth, start, rng, qsum) {
      if (depth === 8) {
        var item = craftFast(ctx, comp, seed, counts, qsum, rng);
        onResult(item, comp, qsum);
        done++;
        if (onProgress && done >= nextReport) { nextReport += 50000; onProgress(done, total); }
        return;
      }
      for (var ti = start; ti < types.length; ti++) {
        var p = types[ti];
        if (counts[p] >= have[p]) continue;
        counts[p]++;
        comp[depth] = p;
        rec(depth + 1, ti, rngNext(rng, SHIFTS[p]), qsum + PICKUPS[p].value);
        counts[p]--;
      }
    }
    rec(0, 0, seed >>> 0, 0);
    if (onProgress) onProgress(done, total);
    return done;
  }

  // Like enumerate, but also tries every bag that needs exactly one pickup more
  // than you hold. onResult(item, comp, qsum, extra) gets extra = that pickup's
  // id, or 0 when the bag only uses what you already have.
  function enumerateWithOneMore(ctx, have, seed, onResult, onProgress) {
    var comp = new Array(8);
    var counts = new Array(PICKUP_COUNT + 2).fill(0);
    var total = countBagsOneMore(have), done = 0, nextReport = 50000;
    function rec(depth, start, rng, qsum, extra) {
      if (depth === 8) {
        onResult(craftFast(ctx, comp, seed, counts, qsum, rng), comp, qsum, extra);
        done++;
        if (onProgress && done >= nextReport) { nextReport += 50000; onProgress(done, total); }
        return;
      }
      for (var p = start; p <= PICKUP_COUNT; p++) {
        var lim = have[p] || 0, ex = extra;
        if (counts[p] >= lim) {
          if (extra || counts[p] > lim || lim >= 8) continue;
          ex = p;
        }
        counts[p]++;
        comp[depth] = p;
        rec(depth + 1, p, rngNext(rng, SHIFTS[p]), qsum + PICKUPS[p].value, ex);
        counts[p]--;
      }
    }
    rec(0, 1, seed >>> 0, 0, 0);
    if (onProgress) onProgress(done, total);
    return done;
  }

  function countBagsOneMore(have) {
    // ways[used extra?][size]
    var w0 = [1, 0, 0, 0, 0, 0, 0, 0, 0], w1 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (var id = 1; id <= PICKUP_COUNT; id++) {
      var m = Math.min(have[id] || 0, 8);
      var n0 = [0, 0, 0, 0, 0, 0, 0, 0, 0], n1 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (var s = 0; s <= 8; s++) {
        for (var c = 0; c <= m && s + c <= 8; c++) { n0[s + c] += w0[s]; n1[s + c] += w1[s]; }
        if (m < 8 && s + m + 1 <= 8) n1[s + m + 1] += w0[s];
      }
      w0 = n0; w1 = n1;
    }
    return w0[8] + w1[8];
  }

  // Number of distinct bags of 8 from the given holdings (bounded multisets).
  function countBags(have) {
    var ways = [1, 0, 0, 0, 0, 0, 0, 0, 0];
    for (var id = 1; id <= PICKUP_COUNT; id++) {
      var m = Math.min(have[id] || 0, 8);
      if (!m) continue;
      var next = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (var s = 0; s <= 8; s++) {
        if (!ways[s]) continue;
        for (var c = 0; c <= m && s + c <= 8; c++) next[s + c] += ways[s];
      }
      ways = next;
    }
    return ways[8];
  }

  var api = {
    PICKUPS: PICKUPS, PICKUP_COUNT: PICKUP_COUNT, POOL_NAMES: POOL_NAMES,
    parseSeed: parseSeed, seedToString: seedToString,
    makeContext: makeContext, craft: craft, craftFast: craftFast,
    enumerate: enumerate, enumerateWithOneMore: enumerateWithOneMore, countBags: countBags, countBagsOneMore: countBagsOneMore, qualityRange: qualityRange
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BOC = api;
})(typeof self !== "undefined" ? self : this);
