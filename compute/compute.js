(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const fmtInt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const fmt1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
  const fmt2 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

  // Derived metrics. Each returns null when an input is missing.
  const derived = {
    per_gb: (d) => (d.price && d.mem_gb ? d.price / d.mem_gb : null),
    per_bw: (d) => (d.price && d.mem_bw ? d.price / d.mem_bw : null),
    bw_per_w: (d) => (d.mem_bw && d.power_w ? d.mem_bw / d.power_w : null),
  };
  // Which raw fields feed each derived one, so estimates propagate.
  const derivedFrom = { per_gb: ["price", "mem_gb"], per_bw: ["price", "mem_bw"], bw_per_w: ["mem_bw", "power_w"] };

  const money = (v) => "$" + fmtInt.format(v);
  const cols = [
    { key: "name", label: "Name", type: "text", sticky: true },
    { key: "price", label: "Price", unit: "USD", type: "num", fmt: money },
    { key: "mem_gb", label: "Memory", unit: "GB", type: "num", fmt: (v) => fmtInt.format(v) },
    { key: "mem_type", label: "Mem type", type: "text" },
    { key: "mem_bw", label: "Bandwidth", unit: "GB/s", type: "num", fmt: (v) => fmtInt.format(v) },
    { key: "per_gb", label: "$/GB", type: "num", fmt: money, derived: true, lowGood: true },
    { key: "per_bw", label: "$ per GB/s", type: "num", fmt: (v) => "$" + fmt2.format(v), derived: true, lowGood: true },
    { key: "fp16", label: "FP16", unit: "TFLOPS", type: "num", fmt: (v) => fmtInt.format(v) },
    { key: "fp8", label: "FP8", unit: "TFLOPS", type: "num", fmt: (v) => fmtInt.format(v) },
    { key: "int8", label: "INT8", unit: "TOPS", type: "num", fmt: (v) => fmtInt.format(v) },
    { key: "fp4", label: "FP4", unit: "TFLOPS", type: "num", fmt: (v) => fmtInt.format(v) },
    { key: "matrix", label: "Tensor / matrix units", type: "text" },
    { key: "power_w", label: "Power", unit: "W", type: "num", fmt: (v) => fmtInt.format(v) },
    { key: "bw_per_w", label: "GB/s per W", type: "num", fmt: (v) => fmt1.format(v), derived: true },
    { key: "interconnect", label: "Interconnect", type: "text" },
    { key: "year", label: "Year", type: "num", fmt: (v) => String(v) },
  ];

  const state = { sort: "per_bw", dir: 1, cats: new Set(), q: "", vendor: "", minmem: 0, maxprice: null, priced: false, open: new Set() };
  let data = null;
  let cats = {};

  const val = (d, key) => (derived[key] ? derived[key](d) : d[key]);
  const isEst = (d, key) => {
    const e = d.estimated || [];
    return derivedFrom[key] ? derivedFrom[key].some((k) => e.includes(k)) : e.includes(key);
  };

  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids) if (kid != null) n.append(kid);
    return n;
  }

  function readUrl() {
    const p = new URLSearchParams(location.hash.slice(1));
    if (p.get("sort") && cols.some((c) => c.key === p.get("sort"))) state.sort = p.get("sort");
    if (p.get("dir")) state.dir = p.get("dir") === "-1" ? -1 : 1;
    if (p.get("cat")) p.get("cat").split(",").forEach((c) => state.cats.add(c));
    state.q = p.get("q") || "";
    state.vendor = p.get("vendor") || "";
    state.minmem = +p.get("minmem") || 0;
    state.maxprice = p.get("maxprice") ? +p.get("maxprice") : null;
    state.priced = p.get("priced") === "1";
  }

  function writeUrl() {
    const p = new URLSearchParams();
    p.set("sort", state.sort);
    p.set("dir", state.dir);
    if (state.cats.size) p.set("cat", [...state.cats].join(","));
    if (state.q) p.set("q", state.q);
    if (state.vendor) p.set("vendor", state.vendor);
    if (state.minmem) p.set("minmem", state.minmem);
    if (state.maxprice) p.set("maxprice", state.maxprice);
    if (state.priced) p.set("priced", "1");
    history.replaceState(null, "", "#" + p.toString());
  }

  function buildControls() {
    const box = $("cats");
    for (const [key, label] of Object.entries(cats)) {
      const n = data.items.filter((d) => d.category === key).length;
      const b = el("button", { type: "button", class: "chip", "data-cat": key, "aria-pressed": String(state.cats.has(key)), onclick: () => {
        state.cats.has(key) ? state.cats.delete(key) : state.cats.add(key);
        b.setAttribute("aria-pressed", String(state.cats.has(key)));
        render();
      } }, el("span", { class: "dot cat-" + key }), label + " ", el("span", { class: "n", text: String(n) }));
      box.append(b);
    }
    const vendors = [...new Set(data.items.map((d) => d.vendor))].sort();
    for (const v of vendors) $("vendor").append(el("option", { value: v, text: v }));

    $("q").value = state.q;
    $("vendor").value = state.vendor;
    $("minmem").value = String(state.minmem);
    $("maxprice").value = state.maxprice ? String(state.maxprice) : "";
    $("priced").checked = state.priced;

    $("q").addEventListener("input", (e) => { state.q = e.target.value.trim(); render(); });
    $("vendor").addEventListener("change", (e) => { state.vendor = e.target.value; render(); });
    $("minmem").addEventListener("change", (e) => { state.minmem = +e.target.value; render(); });
    $("maxprice").addEventListener("change", (e) => { state.maxprice = e.target.value ? +e.target.value : null; render(); });
    $("priced").addEventListener("change", (e) => { state.priced = e.target.checked; render(); });
  }

  function buildHead() {
    const tr = $("head");
    tr.textContent = "";
    for (const c of cols) {
      const active = state.sort === c.key;
      const th = el("th", {
        scope: "col",
        class: [c.type === "num" ? "num" : "", c.sticky ? "sticky" : "", c.derived ? "derived" : ""].join(" ").trim() || null,
        "aria-sort": active ? (state.dir === 1 ? "ascending" : "descending") : null,
      });
      const btn = el("button", { type: "button", onclick: () => {
        if (state.sort === c.key) state.dir = -state.dir;
        else { state.sort = c.key; state.dir = c.type === "num" && !c.lowGood ? -1 : 1; }
        render();
      } }, c.label);
      if (c.unit) btn.append(el("small", { text: c.unit }));
      btn.append(el("span", { class: "arrow", "aria-hidden": "true", text: active ? (state.dir === 1 ? "▲" : "▼") : "↕" }));
      th.append(btn);
      tr.append(th);
    }
  }

  function filtered() {
    const q = state.q.toLowerCase();
    return data.items.filter((d) => {
      if (state.cats.size && !state.cats.has(d.category)) return false;
      if (state.vendor && d.vendor !== state.vendor) return false;
      if (state.minmem && !(d.mem_gb >= state.minmem)) return false;
      if (state.maxprice && !(d.price && d.price <= state.maxprice)) return false;
      if (state.priced && !d.price) return false;
      if (q) {
        const hay = [d.name, d.vendor, d.mem_type, d.matrix, d.interconnect, cats[d.category], d.notes].join(" ").toLowerCase();
        if (!q.split(/\s+/).every((t) => hay.includes(t))) return false;
      }
      return true;
    });
  }

  function sorted(rows) {
    const c = cols.find((x) => x.key === state.sort);
    return rows.slice().sort((a, b) => {
      let va = val(a, c.key), vb = val(b, c.key);
      // Missing values always sink to the bottom, whatever the direction.
      const ma = va == null || va === "", mb = vb == null || vb === "";
      if (ma || mb) return ma === mb ? a.name.localeCompare(b.name) : ma ? 1 : -1;
      if (c.type === "text") return state.dir * String(va).localeCompare(String(vb));
      return state.dir * (va - vb) || a.name.localeCompare(b.name);
    });
  }

  function cell(d, c) {
    if (c.key === "name") {
      const open = state.open.has(d.id);
      const td = el("th", { scope: "row", class: "sticky name" });
      td.append(
        el("button", { type: "button", class: "namebtn", "aria-expanded": String(open), onclick: () => {
          open ? state.open.delete(d.id) : state.open.add(d.id);
          render();
        } },
          el("span", { class: "dot cat-" + d.category, title: cats[d.category] }),
          el("span", { class: "nm", text: d.name }),
        ),
        el("span", { class: "sub", text: d.vendor + " · " + cats[d.category] }),
      );
      return td;
    }
    const v = val(d, c.key);
    const td = el("td", { class: c.type === "num" ? "num" : "txt" });
    if (v == null || v === "") {
      if (c.key === "price") td.append(el("span", { class: "na", text: d.price_basis === "cloud" ? "cloud only" : "n/a" }));
      else td.append(el("span", { class: "na", text: "—" }));
      return td;
    }
    const text = c.fmt ? c.fmt(v) : String(v);
    if (isEst(d, c.key)) td.append(el("span", { class: "est", title: "Estimate. Open the row for the basis.", text: "~" + text }));
    else td.append(text);
    if (c.key === "price" && d.price_basis === "used") td.append(el("span", { class: "tag", text: "used" }));
    if (c.key === "price" && d.price_basis === "list") td.append(el("span", { class: "tag", text: "list" }));
    return td;
  }

  function detailRow(d) {
    const td = el("td", { colspan: String(cols.length), class: "detail" });
    const inner = el("div", { class: "detail-in" });
    if (d.notes) inner.append(el("p", { text: d.notes }));
    const facts = [];
    if (d.msrp) facts.push("MSRP / launch price: " + money(d.msrp));
    if (d.price_basis) facts.push("Price basis: " + ({ new: "new street price", used: "used market average", list: "vendor list price", est: "estimate (range midpoint)", cloud: "cloud rental only" })[d.price_basis]);
    if (d.estimated && d.estimated.length) facts.push("Estimated fields: " + d.estimated.join(", "));
    if (facts.length) inner.append(el("p", { class: "facts", text: facts.join(" · ") }));
    if (d.sources && d.sources.length) {
      const ol = el("ol", { class: "srcs" });
      d.sources.forEach((u) => {
        let host = u;
        try { host = new URL(u).hostname.replace(/^www\./, ""); } catch (_) { /* keep raw */ }
        ol.append(el("li", {}, el("a", { href: u, target: "_blank", rel: "noopener", text: host })));
      });
      inner.append(el("p", { class: "facts", text: "Sources:" }), ol);
    }
    td.append(inner);
    return el("tr", { class: "detail-row" }, td);
  }

  function render() {
    buildHead();
    const rows = sorted(filtered());
    const body = $("body");
    body.textContent = "";
    for (const d of rows) {
      const tr = el("tr", { class: "cat-row-" + d.category });
      for (const c of cols) tr.append(cell(d, c));
      body.append(tr);
      if (state.open.has(d.id)) body.append(detailRow(d));
    }
    if (!rows.length) body.append(el("tr", {}, el("td", { colspan: String(cols.length), class: "empty", text: "Nothing matches those filters." })));
    $("count").textContent = `Showing ${rows.length} of ${data.items.length}`;
    writeUrl();
  }

  readUrl();
  fetch("data.json", { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((json) => {
      data = json;
      cats = json.categories;
      const when = new Date(json.updated + "T12:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      $("meta").textContent = `${json.items.length} entries · data last updated ${when} · prices in ${json.currency}`;
      buildControls();
      render();
    })
    .catch((err) => {
      $("meta").textContent = "Couldn't load data.json (" + err.message + ").";
    });
})();
