/* Recipe finder: tries every bag of 8 you could build and reports what each crafts. */
importScripts("craft.js", "data/rep.js", "data/repplus.js");

var PER_ITEM = 6; // recipes kept per item (cheapest first)

function keep(map, item, comp, qsum, limit) {
  var f = map[item];
  if (!f) f = map[item] = { count: 0, recipes: [] };
  f.count++;
  var r = f.recipes;
  if (r.length < limit || qsum < r[r.length - 1].q) {
    var i = r.length;
    while (i > 0 && r[i - 1].q > qsum) i--;
    r.splice(i, 0, { c: comp.slice(), q: qsum });
    if (r.length > limit) r.pop();
  }
}

function runBreak(msg) {
  var ctx = BOC.makeContext(self.BOC_DATA[msg.version], msg.opts);
  var tiers = msg.tiers;
  var now = {}, next = {}, anyNow = false, total = 0, lastPost = 0;
  total = BOC.enumerateWithOneMore(ctx, msg.have, msg.seed, function (item, comp, qsum, extra) {
    if (!extra) anyNow = true;
    if (!tiers[item]) return;
    if (!extra) keep(now, item, comp, qsum, PER_ITEM);
    else keep(next[extra] || (next[extra] = {}), item, comp, qsum, 3);
  }, function (done, all) {
    var t = Date.now();
    if (t - lastPost > 150 || done === all) { lastPost = t; self.postMessage({ type: "progress", done: done, total: all }); }
  });
  // "Grab one more" only lists items you can't already make.
  for (var p in next) for (var id in next[p]) if (now[id]) delete next[p][id];
  self.postMessage({ type: "break-done", now: now, next: next, anyNow: anyNow, total: total });
}

self.onmessage = function (e) {
  var msg = e.data;
  if (msg.mode === "break") return runBreak(msg);
  var data = self.BOC_DATA[msg.version];
  var ctx = BOC.makeContext(data, msg.opts);
  var target = msg.target || 0;
  var found = {}; // itemId -> { count, recipes: [{ c, q }] }
  var lastPost = 0;

  BOC.enumerate(ctx, msg.have, msg.seed, function (item, comp, qsum) {
    if (target && item !== target) return;
    var f = found[item];
    if (!f) f = found[item] = { count: 0, recipes: [] };
    f.count++;
    var r = f.recipes;
    if (r.length < PER_ITEM || qsum < r[r.length - 1].q) {
      var entry = { c: comp.slice(), q: qsum };
      var i = r.length;
      while (i > 0 && r[i - 1].q > qsum) i--;
      r.splice(i, 0, entry);
      if (r.length > PER_ITEM) r.pop();
    }
  }, function (done, total) {
    var now = Date.now();
    if (now - lastPost > 150 || done === total) {
      lastPost = now;
      self.postMessage({ type: "progress", done: done, total: total });
    }
  });

  self.postMessage({ type: "done", found: found, id: msg.id });
};
