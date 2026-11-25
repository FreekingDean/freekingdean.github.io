(function () {
  "use strict";

  var P = BOC.PICKUPS;
  var QCOLORS = ["var(--q0)", "var(--q1)", "var(--q2)", "var(--q3)", "var(--q4)"];
  var GROUPS = ["Hearts", "Coins", "Keys", "Bombs", "Batteries", "Other"];
  var STORE_KEY = "boc-settings-v1";

  var state = {
    version: "repplus",
    seed: null,
    seedText: "",
    opts: {},
    bag: [],
    have: new Array(30).fill(0)
  };

  // ---- persistence (per-viewer convenience only) ----
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      if (s.version === "rep" || s.version === "repplus") state.version = s.version;
      if (typeof s.seedText === "string") state.seedText = s.seedText;
      if (s.opts && typeof s.opts === "object") state.opts = s.opts;
      if (Array.isArray(s.bag)) state.bag = s.bag.filter(function (x) { return x >= 1 && x <= 29; }).slice(0, 8);
      if (Array.isArray(s.have) && s.have.length === 30) state.have = s.have.map(function (x) { return Math.max(0, Math.min(8, x | 0)); });
    } catch (e) { /* storage blocked: start fresh */ }
  }
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        version: state.version, seedText: state.seedText, opts: state.opts, bag: state.bag, have: state.have
      }));
    } catch (e) { /* ignore */ }
  }

  // ---- helpers ----
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "class") n.className = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function data() { return window.BOC_DATA[state.version]; }
  var ctxCache = {};
  function ctx() {
    var key = state.version + JSON.stringify(state.opts);
    if (!ctxCache[key]) ctxCache[key] = BOC.makeContext(data(), state.opts);
    return ctxCache[key];
  }
  function item(id) { return data().items[id]; }
  function itemName(id) { var it = item(id); return it ? it.n : "Item " + id; }
  function wikiUrl(id) {
    return "https://bindingofisaacrebirth.wiki.gg/wiki/" + encodeURIComponent(itemName(id).replace(/ /g, "_"));
  }
  function qualityBadge(id) {
    var it = item(id);
    var q = it ? it.q : 0;
    var b = el("span", { class: "chip qbadge q" + Math.max(0, q), text: "Quality " + q });
    if (it && it.cq !== it.q && it.cq >= 0) b.title = "Counts as quality " + it.cq + " for crafting";
    return b;
  }
  function pct(x) { var v = Math.round(x * 100); return (v === 0 && x > 0 ? "<1" : v) + "%"; }
  function glyphs(comp) { return comp.map(function (c) { return P[c].glyph; }).join(""); }
  function names(comp) {
    var counts = {};
    comp.forEach(function (c) { counts[c] = (counts[c] || 0) + 1; });
    return Object.keys(counts).map(function (c) { return counts[c] + "× " + P[c].name; }).join(", ");
  }

  // ---- settings ----
  function initSettings() {
    document.querySelectorAll('input[name="version"]').forEach(function (r) {
      r.checked = r.value === state.version;
      r.addEventListener("change", function () {
        state.version = r.value; save(); renderCraft(); clearFinder(); fillItemList();
      });
    });
    var seed = $("seed");
    seed.value = state.seedText;
    seed.addEventListener("input", function () {
      var v = seed.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
      var pretty = v.length > 4 ? v.slice(0, 4) + " " + v.slice(4) : v;
      if (pretty !== seed.value) seed.value = pretty;
      state.seedText = pretty; save(); checkSeed(); renderCraft(); clearFinder();
    });
    document.querySelectorAll("[data-opt]").forEach(function (cb) {
      var k = cb.getAttribute("data-opt");
      cb.checked = !!state.opts[k];
      cb.addEventListener("change", function () {
        if (cb.checked) state.opts[k] = true; else delete state.opts[k];
        save(); renderCraft(); clearFinder();
      });
    });
    checkSeed();
  }
  function checkSeed() {
    var st = $("seed-status"), inp = $("seed");
    st.className = "hint"; inp.classList.remove("bad");
    state.seed = null;
    var raw = state.seedText.replace(/\s/g, "");
    if (!raw) { st.textContent = "Find it on the pause screen. Every recipe depends on it."; return; }
    if (raw.length < 8) { st.textContent = (8 - raw.length) + " more character" + (raw.length === 7 ? "" : "s") + "."; return; }
    var r = BOC.parseSeed(raw);
    if (r.error) { st.textContent = r.error; st.className = "hint bad"; inp.classList.add("bad"); return; }
    state.seed = r.seed;
    st.textContent = "Valid seed.";
    st.className = "hint ok";
  }

  // ---- tabs ----
  function initTabs() {
    var tabs = [["tab-craft", "view-craft"], ["tab-find", "view-find"]];
    tabs.forEach(function (t) {
      $(t[0]).addEventListener("click", function () { showTab(t[0]); });
    });
  }
  function showTab(id) {
    [["tab-craft", "view-craft"], ["tab-find", "view-find"]].forEach(function (t) {
      var on = t[0] === id;
      $(t[0]).setAttribute("aria-selected", on ? "true" : "false");
      $(t[1]).hidden = !on;
    });
  }

  // ---- craft view ----
  function initPalette() {
    var pal = $("palette");
    GROUPS.forEach(function (g) {
      var row = el("div", { class: "pgroup-items" });
      P.forEach(function (p) {
        if (!p || p.group !== g) return;
        row.appendChild(el("button", {
          class: "pick", type: "button", "data-id": p.id, title: p.name + " (worth " + p.value + ")",
          onclick: function () { if (state.bag.length < 8) { state.bag.push(p.id); save(); renderCraft(); } }
        }, [el("span", { "aria-hidden": "true", text: p.glyph }), p.name, el("span", { class: "v", text: String(p.value) })]));
      });
      pal.appendChild(el("div", { class: "pgroup" }, [el("h3", { text: g }), row]));
    });
    $("clear-bag").addEventListener("click", function () { state.bag = []; save(); renderCraft(); });
  }

  function renderSlots() {
    var ol = $("slots");
    ol.textContent = "";
    for (var i = 0; i < 8; i++) {
      var id = state.bag[i];
      var li = el("li");
      if (id) {
        (function (idx) {
          li.appendChild(el("button", {
            class: "slot filled", type: "button", "aria-label": "Remove " + P[id].name,
            onclick: function () { state.bag.splice(idx, 1); save(); renderCraft(); }
          }, [el("span", { "aria-hidden": "true", text: P[id].glyph }), el("span", { class: "lbl", text: P[id].short })]));
        })(i);
      } else {
        li.appendChild(el("div", { class: "slot", "aria-label": "Empty slot" }));
      }
      ol.appendChild(li);
    }
    var full = state.bag.length >= 8;
    document.querySelectorAll(".pick").forEach(function (b) { b.disabled = full; });
  }

  function renderCraft() {
    renderSlots();
    var box = $("result");
    box.textContent = "";
    var qsum = state.bag.reduce(function (a, c) { return a + P[c].value; }, 0);
    if (state.bag.length < 8) {
      box.appendChild(el("p", { class: "result-empty", text: "Fill all 8 slots to see the result. " +
        (state.bag.length ? "(" + state.bag.length + "/8, worth " + qsum + " so far)" : "") }));
      return;
    }
    if (state.seed === null) {
      box.appendChild(el("p", { class: "result-empty", text: "Enter your run's seed above. The same bag crafts different items on different seeds." }));
      return;
    }
    var r = BOC.craft(ctx(), state.bag, state.seed);
    var id = r.result;
    box.appendChild(el("p", { class: "kicker", text: r.fixed !== null && r.result === r.fixed ? "Fixed recipe · every seed" : "You'll craft" }));
    box.appendChild(el("h2", { class: "item-name" }, [el("a", { href: wikiUrl(id), target: "_blank", rel: "noopener", text: itemName(id) })]));
    var meta = el("div", { class: "meta-row" }, [qualityBadge(id), el("span", { class: "chip", text: "Bag worth " + r.qualitySum }), el("span", { class: "chip", text: "Item #" + id })]);
    if (item(id) && item(id).act) meta.appendChild(el("span", { class: "chip", text: "Active" }));
    box.appendChild(meta);

    if (r.rolls.length) {
      box.appendChild(el("p", { class: "note" }, [el("strong", { text: "Rerolled: " }),
        r.rolls.map(itemName).join(", ") + " can't appear with your run options, so the bag rolled again."]));
    }
    if (r.fixed !== null && r.result !== r.fixed) {
      box.appendChild(el("p", { class: "note", text: "This is the fixed recipe for " + itemName(r.fixed) + ", but your run options block it, so a random item is crafted instead." }));
    }
    var needsUnlock = item(id) && item(id).a;
    if (needsUnlock) {
      var alt = r.ifLocked.slice(1);
      var txt = itemName(id) + " needs an unlock. If you haven't unlocked it, you get ";
      if (r.fixed !== null && r.result === r.fixed) {
        // Fixed recipe falls through to the random roll.
        var chain = r.ifLocked;
        txt += chain.length ? itemName(chain[0]) + (chain.length > 1 ? " (or " + chain.slice(1).map(itemName).join(", then ") + " if that's locked too)" : "") : "Breakfast";
      } else {
        txt += alt.length ? itemName(alt[0]) + (alt.length > 1 ? " (or " + alt.slice(1).map(itemName).join(", then ") + " if that's locked too)" : "") : "Breakfast";
      }
      box.appendChild(el("p", { class: "note" }, [el("strong", { text: "Unlock check: " }), txt + "."]));
    }

    // Odds for this mix of pickups regardless of seed.
    var odds = el("div", { class: "odds" }, [el("h3", { text: "What this mix can make (any seed)" })]);
    var bar = el("div", { class: "odds-bar", role: "img", "aria-label": "Quality odds" });
    var legend = el("div", { class: "odds-legend" });
    r.qualityOdds.forEach(function (p, q) {
      if (p <= 0) return;
      bar.appendChild(el("span", { style: "width:" + (p * 100) + "%;background:" + QCOLORS[q] }));
      legend.appendChild(el("span", {}, [el("i", { style: "background:" + QCOLORS[q] }), "Q" + q + " " + Math.round(p * 100) + "%"]));
    });
    odds.appendChild(bar); odds.appendChild(legend);
    var pools = el("ul", { class: "pool-list" });
    r.pools.forEach(function (p) {
      if (p.weight <= 0) return;
      pools.appendChild(el("li", {}, [el("span", { text: p.name + " pool" }), el("span", { text: pct(p.weight / r.total) + " · Q" + p.qmin + "–" + p.qmax })]));
    });
    odds.appendChild(pools);
    odds.appendChild(el("p", { class: "hint", text: r.candidates + " different items are possible with these pickups." }));
    box.appendChild(odds);
  }

  // ---- finder ----
  var worker = null, jobId = 0, lastFound = null, qFilter = -1;

  function initFinder() {
    var grid = $("have-grid");
    P.forEach(function (p) {
      if (!p) return;
      var out = el("output", { text: String(state.have[p.id]) });
      var box = el("div", { class: "have" + (state.have[p.id] ? " on" : ""), title: p.name });
      function set(v) {
        state.have[p.id] = Math.max(0, Math.min(8, v));
        out.textContent = String(state.have[p.id]);
        box.classList.toggle("on", state.have[p.id] > 0);
        save(); updateCount();
      }
      box.appendChild(el("span", { "aria-hidden": "true", text: p.glyph }));
      box.appendChild(el("span", { class: "nm", text: p.name }));
      box.appendChild(el("span", { class: "stepper" }, [
        el("button", { type: "button", "aria-label": "One fewer " + p.name, text: "−", onclick: function () { set(state.have[p.id] - 1); } }),
        out,
        el("button", { type: "button", "aria-label": "One more " + p.name, text: "+", onclick: function () { set(state.have[p.id] + 1); } })
      ]));
      box._set = set;
      grid.appendChild(box);
    });
    $("have-all").addEventListener("click", function () { setAllHave(8); });
    $("have-clear").addEventListener("click", function () { setAllHave(0); });
    $("find-go").addEventListener("click", runFinder);
    fillItemList();
    updateCount();
  }
  function setAllHave(v) {
    for (var i = 1; i <= 29; i++) state.have[i] = v;
    document.querySelectorAll(".have").forEach(function (b, i) {
      b.querySelector("output").textContent = String(v);
      b.classList.toggle("on", v > 0);
    });
    save(); updateCount();
  }
  function updateCount() {
    var n = BOC.countBags(state.have);
    $("find-count").textContent = n ? n.toLocaleString() + " possible bag" + (n === 1 ? "" : "s") : "You need at least 8 pickups.";
    $("find-go").disabled = !n;
  }
  function fillItemList() {
    var dl = $("item-list");
    dl.textContent = "";
    var seen = {};
    var d = data();
    Object.keys(d.pools).forEach(function (pid) {
      d.pools[pid].items.forEach(function (x) { seen[x[0]] = 1; });
    });
    Object.keys(d.recipes).forEach(function (k) { seen[d.recipes[k]] = 1; });
    Object.keys(seen).map(Number).sort(function (a, b) { return itemName(a).localeCompare(itemName(b)); })
      .forEach(function (id) { dl.appendChild(el("option", { value: itemName(id) })); });
  }
  function findItemByName(text) {
    var t = text.trim().toLowerCase();
    if (!t) return 0;
    var items = data().items, best = -1;
    for (var id in items) if (items[id].n.toLowerCase() === t) return +id;
    for (id in items) if (items[id].n.toLowerCase().indexOf(t) >= 0) { best = +id; break; }
    return best;
  }
  function clearFinder() {
    if (worker) { worker.terminate(); worker = null; }
    $("progress").hidden = true;
    $("find-go").textContent = "Find recipes";
    $("find-results").textContent = "";
    lastFound = null;
    updateCount();
  }

  function runFinder() {
    if (worker) { clearFinder(); return; } // acts as Cancel
    var res = $("find-results");
    res.textContent = "";
    if (state.seed === null) {
      res.appendChild(el("p", { class: "panel", text: "Enter a valid seed first. Recipes are different on every seed." }));
      return;
    }
    var target = findItemByName($("target").value);
    if (target < 0) {
      res.appendChild(el("p", { class: "panel", text: "No item matches “" + $("target").value + "”." }));
      return;
    }
    jobId++;
    try {
      worker = new Worker("finder-worker.js");
    } catch (e) {
      res.appendChild(el("p", { class: "panel", text: "Your browser blocked the background search. Try opening the page over http(s)." }));
      return;
    }
    $("progress").hidden = false;
    $("bar").style.width = "0%";
    $("find-go").textContent = "Cancel";
    var started = Date.now();
    worker.onerror = function (e) {
      clearFinder();
      $("find-results").appendChild(el("p", { class: "panel", text: "The search crashed: " + (e.message || "unknown error") + "." }));
    };
    worker.onmessage = function (e) {
      var m = e.data;
      if (m.type === "progress") {
        $("bar").style.width = (m.total ? m.done / m.total * 100 : 0) + "%";
      } else if (m.type === "done") {
        worker.terminate(); worker = null;
        $("find-go").textContent = "Find recipes";
        $("progress").hidden = true;
        lastFound = { found: m.found, target: target, ms: Date.now() - started };
        qFilter = -1;
        renderFound();
      }
    };
    worker.postMessage({ id: jobId, version: state.version, opts: state.opts, seed: state.seed, have: state.have, target: target });
  }

  function renderFound() {
    var res = $("find-results");
    res.textContent = "";
    if (!lastFound) return;
    var found = lastFound.found;
    var ids = Object.keys(found).map(Number);
    if (lastFound.target && !ids.length) {
      res.appendChild(el("p", { class: "panel", text: "You can't make " + itemName(lastFound.target) + " from these pickups on this seed. Try adding more pickup types." }));
      return;
    }
    ids.sort(function (a, b) {
      var qa = item(a) ? item(a).q : 0, qb = item(b) ? item(b).q : 0;
      return qb - qa || itemName(a).localeCompare(itemName(b));
    });
    var byQ = [0, 0, 0, 0, 0];
    ids.forEach(function (id) { var q = item(id) ? item(id).q : 0; if (q >= 0) byQ[q]++; });
    res.appendChild(el("p", { class: "fr-summary", text: ids.length + " different item" + (ids.length === 1 ? "" : "s") + " craftable · searched in " + (lastFound.ms / 1000).toFixed(1) + "s. Showing the cheapest recipes for each." }));

    var filter = el("div", { class: "fr-filter", role: "group", "aria-label": "Filter by quality" });
    [-1, 4, 3, 2, 1, 0].forEach(function (q) {
      if (q >= 0 && !byQ[q]) return;
      filter.appendChild(el("button", {
        type: "button", "aria-pressed": qFilter === q ? "true" : "false",
        text: q < 0 ? "All" : "Quality " + q + " (" + byQ[q] + ")",
        onclick: function () { qFilter = q; renderFound(); }
      }));
    });
    res.appendChild(filter);

    var list = el("ul", { class: "fr-list" });
    var shown = 0;
    ids.forEach(function (id) {
      var q = item(id) ? item(id).q : 0;
      if (qFilter >= 0 && q !== qFilter) return;
      if (shown++ > 400) return;
      var f = found[id];
      var recipes = el("ul", { class: "fr-recipes" });
      f.recipes.forEach(function (r) {
        recipes.appendChild(el("li", {}, [
          el("span", { class: "glyphs", "aria-hidden": "true", text: glyphs(r.c) }),
          el("span", { class: "hint", text: names(r.c) }),
          el("button", { class: "ghost", type: "button", text: "Put in bag", onclick: function () {
            state.bag = r.c.slice(); save(); renderCraft(); showTab("tab-craft"); window.scrollTo({ top: $("view-craft").offsetTop - 16, behavior: "smooth" });
          } })
        ]));
      });
      var det = el("details", {}, [
        el("summary", {}, [qualityBadge(id), el("span", { class: "nm", text: itemName(id) }), el("span", { class: "cnt", text: f.count.toLocaleString() + " recipe" + (f.count === 1 ? "" : "s") })]),
        recipes
      ]);
      if (lastFound.target) det.open = true;
      list.appendChild(el("li", { class: "fr-item" }, [det]));
    });
    res.appendChild(list);
    if (shown > 400) res.appendChild(el("p", { class: "hint", text: "Showing the first 400. Use the quality filter to see the rest." }));
  }

  // ---- boot ----
  load();
  initSettings();
  initTabs();
  initPalette();
  initFinder();
  renderCraft();
})();
