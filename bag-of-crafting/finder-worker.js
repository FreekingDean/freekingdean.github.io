/* Recipe finder: tries every bag of 8 you could build and reports what each crafts. */
importScripts("craft.js", "data/rep.js", "data/repplus.js");

var PER_ITEM = 6; // recipes kept per item (cheapest first)

self.onmessage = function (e) {
  var msg = e.data;
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
