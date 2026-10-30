/**
 * rankings.js — sorting, filters and heatmap for the judge × candidate matrix (#rank-matrix).
 *
 * View state lives in location.hash, written with history.replaceState and restored on load
 * and on hashchange. Format (URLSearchParams; every key optional, omitted = default):
 *
 *   #sort=<col>-<asc|desc>&prompt=<version>&judges=<static|browser>&heat=on
 *
 *   sort    <col> is a header button's data-col: "standing", "name", "j-<judge id>", "mean",
 *           "spread", "r-<review type id>". Default: standing-asc (= the server-rendered order).
 *   prompt  show only candidates built from that prompt (e.g. v0). Default: all.
 *   judges  show only judge columns of that material; Mean and Spread are then recomputed over
 *           the shown judges. Default: all.
 *   heat    "on" colours rank and score cells (numbers stay visible). Default: off.
 *
 * Sorting is stable: ties, and every comparison in either direction, fall back to the default
 * order (data-order). Empty cells (data-sort="") always sort last.
 */
(() => {
  "use strict";
  const table = document.getElementById("rank-matrix");
  if (!table) return;
  const tbody = table.tBodies[0];
  const rows = Array.from(tbody.rows);
  const buttons = Array.from(table.tHead.querySelectorAll("button[data-col]"));
  const cols = new Map(buttons.map((b) => [b.dataset.col, b]));
  const judgeThs = Array.from(table.tHead.querySelectorAll("th[data-material]"));
  const status = document.getElementById("rank-status");
  const heatBtn = document.getElementById("rank-heat");
  const resetBtn = document.getElementById("rank-reset");
  const legend = document.getElementById("heat-legend");
  const nmax = Number(table.dataset.nmax) || 1;
  const DEFAULT = { sort: "standing", dir: "asc", prompt: "all", judges: "all", heat: false };
  let state = { ...DEFAULT };

  const cell = (row, key) => row.querySelector(`:scope > [data-col="${CSS.escape(key)}"]`);
  const radios = (name) => Array.from(document.querySelectorAll(`input[type=radio][name="${name}"]`));
  const label = (key) => {
    const b = cols.get(key);
    const sub = b.querySelector(".rk-l-sub");
    return sub && !sub.hidden ? sub.textContent.trim() : b.dataset.label;
  };

  // Server-rendered Mean/Spread values, restored when all judges are shown.
  const orig = new Map(rows.map((r) => {
    const mean = cell(r, "mean"), spread = cell(r, "spread");
    return [r, { mean: (mean.querySelector(".rk-mv") || mean).textContent, meanSort: mean.dataset.sort, sp: spread.querySelector(".rk-sp").textContent, spSort: spread.dataset.sort }];
  }));

  function parse(hash) {
    const p = new URLSearchParams(hash.replace(/^#/, ""));
    const s = { ...DEFAULT };
    const sort = p.get("sort");
    if (sort) {
      const i = sort.lastIndexOf("-");
      const key = sort.slice(0, i), dir = sort.slice(i + 1);
      if (cols.has(key) && (dir === "asc" || dir === "desc")) { s.sort = key; s.dir = dir; }
      else console.warn(`rankings: ignoring unknown sort "${sort}"`);
    }
    for (const k of ["prompt", "judges"]) {
      const v = p.get(k);
      if (v === null) continue;
      if (radios(k).some((r) => r.value === v)) s[k] = v;
      else console.warn(`rankings: ignoring unknown ${k} "${v}"`);
    }
    s.heat = p.get("heat") === "on";
    return s;
  }

  function serialize(s) {
    const p = new URLSearchParams();
    if (s.sort !== DEFAULT.sort || s.dir !== DEFAULT.dir) p.set("sort", `${s.sort}-${s.dir}`);
    if (s.prompt !== "all") p.set("prompt", s.prompt);
    if (s.judges !== "all") p.set("judges", s.judges);
    if (s.heat) p.set("heat", "on");
    const q = p.toString();
    return q ? `#${q}` : "";
  }

  function writeHash() {
    const h = serialize(state);
    if (h !== location.hash && !(h === "" && location.hash === "")) {
      history.replaceState(history.state, "", location.pathname + location.search + h);
    }
  }

  // Python's f"{sum/n:.1f}" (round half to even on exact ties, e.g. 1.25 -> "1.2").
  function fmtMean(sum, n) {
    const t = sum * 10, f = Math.floor(t / n), r = t - f * n;
    const k = 2 * r > n ? f + 1 : 2 * r < n ? f : (f % 2 ? f + 1 : f);
    return (k / 10).toFixed(1);
  }
  // mirrors rankings.py GLYPH_W / GLYPH_PAD
  const GLYPH_W = 136, GLYPH_PAD = 6;
  const gx = (r) => (GLYPH_PAD + (r - 1) * (GLYPH_W - 2 * GLYPH_PAD) / Math.max(1, nmax - 1)).toFixed(1);

  function applyJudges() {
    const shown = new Set();
    for (const th of judgeThs) {
      const vis = state.judges === "all" || th.dataset.material === state.judges;
      th.hidden = !vis;
      if (vis) shown.add(th.dataset.col);
      for (const r of rows) cell(r, th.dataset.col).hidden = !vis;
    }
    const all = state.judges === "all";
    for (const key of ["mean", "spread"]) {
      const b = cols.get(key);
      b.querySelector(".rk-l-all").hidden = !all;
      b.querySelector(".rk-l-sub").hidden = all;
    }
    for (const r of rows) {
      const mean = cell(r, "mean"), spread = cell(r, "spread"), o = orig.get(r);
      const meanTxt = mean.querySelector(".rk-mv") || mean;
      const txt = spread.querySelector(".rk-sp");
      const glyph = spread.querySelector("svg");
      const ranks = [];
      for (const key of shown) {
        const v = cell(r, key).dataset.sort;
        if (v !== "") ranks.push(Number(v));
      }
      if (glyph) {
        for (const d of glyph.querySelectorAll("circle[data-col]")) d.style.display = shown.has(d.dataset.col) ? "" : "none";
      }
      if (all) {
        meanTxt.textContent = o.mean; mean.dataset.sort = o.meanSort;
        txt.textContent = o.sp; spread.dataset.sort = o.spSort;
      } else if (!ranks.length) {
        meanTxt.textContent = "–"; mean.dataset.sort = "";
        txt.textContent = "–"; spread.dataset.sort = "";
      } else {
        const n = ranks.length, sum = ranks.reduce((a, b) => a + b, 0), mu = sum / n;
        const sd = Math.sqrt(ranks.reduce((a, x) => a + (x - mu) ** 2, 0) / n);
        const lo = Math.min(...ranks), hi = Math.max(...ranks);
        meanTxt.textContent = fmtMean(sum, n); mean.dataset.sort = mu.toFixed(4);
        txt.textContent = `${lo === hi ? lo : `${lo}–${hi}`} · σ ${sd.toFixed(2)}`;
        spread.dataset.sort = sd.toFixed(4);
      }
      if (glyph) {
        const vis = Array.from(glyph.querySelectorAll("circle[data-col]")).filter((d) => d.style.display !== "none").map((d) => Number(d.dataset.r));
        const rng = glyph.querySelector(".rng"), mu = glyph.querySelector(".mu");
        glyph.style.visibility = vis.length ? "" : "hidden";
        if (vis.length) {
          rng.setAttribute("x1", gx(Math.min(...vis))); rng.setAttribute("x2", gx(Math.max(...vis)));
          if (mu) { const m = gx(vis.reduce((a, b) => a + b, 0) / vis.length); mu.setAttribute("x1", m); mu.setAttribute("x2", m); }
        }
      }
    }
    return shown.size;
  }

  function applySort() {
    const b = cols.get(state.sort);
    const text = b.dataset.type === "text";
    const sign = state.dir === "asc" ? 1 : -1;
    const keyed = rows.map((row) => {
      const c = cell(row, state.sort);
      const raw = c ? c.dataset.sort : "";
      const empty = raw === undefined || raw === "";
      return { row, empty, v: empty ? null : text ? raw : Number(raw), order: Number(row.dataset.order) };
    });
    keyed.sort((x, y) => {
      if (x.empty !== y.empty) return x.empty ? 1 : -1;
      if (!x.empty) {
        const d = text ? x.v.localeCompare(y.v, "en") : x.v - y.v;
        if (d) return sign * d;
      }
      return x.order - y.order;
    });
    for (const k of keyed) tbody.appendChild(k.row);
    for (const [key, btn] of cols) {
      const th = btn.closest("th");
      if (key === state.sort) th.setAttribute("aria-sort", state.dir === "asc" ? "ascending" : "descending");
      else th.removeAttribute("aria-sort");
    }
  }

  function apply(announce) {
    const nJudges = applyJudges();
    // a hidden judge column cannot stay the sort key
    const sortTh = cols.get(state.sort).closest("th");
    if (sortTh.hidden) { state.sort = DEFAULT.sort; state.dir = DEFAULT.dir; }
    let nRows = 0;
    for (const r of rows) {
      r.hidden = state.prompt !== "all" && r.dataset.prompt !== state.prompt;
      if (!r.hidden) nRows++;
    }
    applySort();
    table.classList.toggle("heat-on", state.heat);
    if (heatBtn) heatBtn.setAttribute("aria-pressed", String(state.heat));
    if (legend) legend.hidden = !state.heat;
    for (const k of ["prompt", "judges"]) for (const r of radios(k)) r.checked = r.value === state[k];
    if (status) {
      const msg = `Sorted by ${label(state.sort)}, ${state.dir === "asc" ? "ascending" : "descending"}. `
        + `Showing ${nRows} of ${rows.length} candidates and ${nJudges} of ${judgeThs.length} judges`
        + `${state.heat ? "; heatmap on" : ""}.`;
      if (announce || status.textContent !== msg) status.textContent = msg;
    }
  }

  // Scroll cue: a right-edge fade while columns are hidden to the right, and the "scroll sideways"
  // hint only while the table is wider than its frame.
  const scroller = document.getElementById("rank-scroller");
  const wrap = table.closest(".table-wrap");
  const hint = document.getElementById("rank-scroll-hint");
  function overflow() {
    if (!scroller || !wrap) return;
    const extra = wrap.scrollWidth - wrap.clientWidth;
    scroller.classList.toggle("more-right", extra - wrap.scrollLeft > 2);
    if (hint) hint.hidden = extra <= 2;
  }
  if (hint) hint.classList.add("live");
  if (wrap) wrap.addEventListener("scroll", overflow, { passive: true });
  window.addEventListener("resize", overflow);

  function update() { apply(true); writeHash(); overflow(); }

  for (const [key, btn] of cols) {
    btn.addEventListener("click", () => {
      if (state.sort === key) state.dir = state.dir === "asc" ? "desc" : "asc";
      else { state.sort = key; state.dir = btn.dataset.first === "desc" ? "desc" : "asc"; }
      update();
    });
  }
  for (const k of ["prompt", "judges"]) {
    for (const r of radios(k)) r.addEventListener("change", () => { if (r.checked) { state[k] = r.value; update(); } });
  }
  if (heatBtn) heatBtn.addEventListener("click", () => { state.heat = !state.heat; update(); });
  if (resetBtn) resetBtn.addEventListener("click", () => { state = { ...DEFAULT }; update(); });
  window.addEventListener("hashchange", () => { state = parse(location.hash); apply(true); writeHash(); overflow(); });

  state = parse(location.hash);
  apply(false);
  writeHash();
  overflow();
})();
