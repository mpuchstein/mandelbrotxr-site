// Client-side full-text search over the index written by site/sitelib/searchindex.py.
// Normalisation must match searchindex.tokenize(): NFKD, drop combining marks (\p{M}),
// casefold (toLowerCase, then fold() for the letters where casefold differs: ß, ς, Cyrillic
// U+1C80-1C88 and Cherokee small letters), split on non-[\p{L}\p{N}], keep tokens of >= 2 code
// points or pure ASCII digits, drop meta.json "stop" words.
// Query: words are AND-ed, the last word is prefix-matched while typing, "quoted phrases" are
// verified against the passage text. Only the shards a query needs are fetched.
(() => {
  "use strict";
  const form = document.getElementById("search-form");
  if (!form) return;
  const $ = (id) => document.getElementById(id);
  const input = $("q"), kindsBox = $("search-kinds"), status = $("search-status"), list = $("search-results");
  const indexBase = form.dataset.index || "search-index/";
  const root = form.dataset.root || "";
  const PAGE = 50, K1 = 1.2, B = 0.75, MAX_EXPANSIONS = 64, VERIFY_SHARDS = 4, EAGER = 12;
  const cache = new Map(), postingsCache = new Map(), titleCache = new Map();
  let meta, docs, lens, same, avgdl, stop = new Set(), gen = 0, state = null, timer = 0;

  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const fetchJSON = (file) => {
    if (!cache.has(file)) {
      const p = fetch(new URL(indexBase + file, location.href)).then((r) => {
        if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
        return r.json();
      });
      p.catch(() => cache.delete(file));
      cache.set(file, p);
    }
    return cache.get(file);
  };

  const FOLD = { "ß": "ss", "ς": "σ", "ᲀ": "в", "ᲁ": "д", "ᲂ": "о", "ᲃ": "с", "ᲄ": "т", "ᲅ": "т", "ᲆ": "ъ", "ᲇ": "ѣ", "ᲈ": "ꙋ" };
  const fold = (c) => FOLD[c] || String.fromCharCode(c.charCodeAt(0) - (c < "\uAB70" ? 8 : 0x97d0));
  const norm = (s) => s.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[ßςᲀ-ᲈ\u13f8-\u13fd\uab70-\uabbf]/g, fold);
  const words = (s) => norm(s).match(/[\p{L}\p{N}]+/gu) || [];
  const keep = (t) => ([...t].length >= 2 || /^[0-9]+$/.test(t)) && !stop.has(t);
  const tokenize = (s) => words(s).filter(keep);

  let ready = null;
  const loadBase = () => (ready ||= Promise.all([fetchJSON("meta.json"), fetchJSON("p.json")]).then(([m, p]) => {
    meta = m; docs = p.docs; lens = p.len; same = new Map(p.same || []);
    stop = new Set(m.stop);
    avgdl = lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length) || 1;
  }).catch((err) => { ready = null; throw err; }));

  function parse(q) {
    const groups = new Map(), phrases = [];
    const chunks = [...q.matchAll(/"([^"]*)"?|[^\s"]+/g)];
    chunks.forEach((m, i) => {
      const quoted = m[1] !== undefined, raw = quoted ? m[1] : m[0], w = words(raw);
      if (quoted && w.length > 1) phrases.push(w);
      for (const t of w.filter(keep)) if (!groups.has(t)) groups.set(t, { term: t, prefix: false });
      const last = w[w.length - 1];
      if (i === chunks.length - 1 && !quoted && !/\s$/.test(q) && last && [...last].length >= 2) {
        groups.delete(last);
        groups.set(last, { term: last, prefix: true });
      }
    });
    return { groups: [...groups.values()], phrases };
  }

  function keyFor(t) {
    for (let k = t; k; k = k.slice(0, -1)) if (has(meta.shards, k)) return k;
    return null;
  }

  function decode(term, s) {
    if (!postingsCache.has(term)) {
      const out = [];
      let id = 0;
      for (const part of s.split(",")) {
        const [d, tf] = part.split(":");
        id += parseInt(d, 36);
        out.push(id, tf ? parseInt(tf, 36) : 1);
      }
      postingsCache.set(term, out);
    }
    return postingsCache.get(term);
  }

  async function resolve(g) {
    const files = new Set(), k = keyFor(g.term);
    if (k) files.add(meta.shards[k]);
    if (g.prefix) for (const key of Object.keys(meta.shards)) {
      if (key.length > g.term.length && key.startsWith(g.term)) files.add(meta.shards[key]);
    }
    const shards = await Promise.all([...files].map(fetchJSON));
    let terms = [];
    for (const sh of shards) {
      if (!g.prefix) { if (has(sh, g.term)) terms.push([g.term, sh[g.term]]); continue; }
      for (const t of Object.keys(sh)) if (t.startsWith(g.term)) terms.push([t, sh[t]]);
    }
    terms.sort((a, b) => (b[0] === g.term) - (a[0] === g.term) || b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));
    terms = terms.slice(0, MAX_EXPANSIONS);
    const tf = new Map();
    for (const [t, s] of terms) {
      const p = decode(t, s);
      for (let i = 0; i < p.length; i += 2) tf.set(p[i], (tf.get(p[i]) || 0) + p[i + 1]);
    }
    return { terms: terms.map((x) => x[0]), tf, idf: Math.log(1 + (meta.n - tf.size + 0.5) / (tf.size + 0.5)) };
  }

  function docOf(id) {
    let lo = 0, hi = docs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (docs[mid][4] <= id) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  function titleTerms(d) {
    if (!titleCache.has(d)) titleCache.set(d, new Set(tokenize(docs[d][1])));
    return titleCache.get(d);
  }

  const passage = async (id) => (await fetchJSON(`d-${Math.floor(id / meta.docshard_size)}.json`))[id % meta.docshard_size];
  const shardOf = (id) => Math.floor(id / meta.docshard_size);

  function hasPhrase(text, phrases) {
    const w = words(text);
    return phrases.every((p) => {
      outer: for (let i = 0; i + p.length <= w.length; i++) {
        for (let j = 0; j < p.length; j++) if (w[i + j] !== p[j]) continue outer;
        return true;
      }
      return false;
    });
  }

  function checkedKinds() {
    return [...kindsBox.querySelectorAll('input[name="kind"]:checked')].map((el) => el.value);
  }

  function syncURL(q, kinds) {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    for (const k of kinds) p.append("kind", k);
    const s = p.toString();
    history.replaceState(history.state, "", (s ? `?${s}` : location.pathname) + location.hash);
  }

  async function search() {
    const my = ++gen, q = input.value, kinds = checkedKinds();
    syncURL(q.trim(), kinds);
    const { groups, phrases } = parse(q);
    if (observer) observer.disconnect();
    list.replaceChildren();
    more.hidden = true;
    state = null;
    if (!groups.length) {
      status.textContent = q.trim() ? "Those words are too common to search for; try more specific terms." : "";
      return;
    }
    status.textContent = "Searching…";
    try {
      await loadBase();
      const res = await Promise.all(groups.map(resolve));
      if (my !== gen) return;
      const allow = kinds.length ? new Set(kinds) : null;
      res.sort((a, b) => a.tf.size - b.tf.size);
      const ranked = [];
      for (const [id] of res[0].tf) {
        if (!res.every((r) => r.tf.has(id))) continue;
        const d = docOf(id);
        if (allow && !allow.has(docs[d][2])) continue;
        const lenNorm = K1 * (1 - B + (B * lens[id]) / avgdl);
        let score = 0;
        for (const r of res) {
          const tf = r.tf.get(id);
          score += (r.idf * tf * (K1 + 1)) / (tf + lenNorm);
          if (r.terms.some((t) => titleTerms(d).has(t))) score += r.idf * 0.75;
        }
        ranked.push({ id, d, score });
      }
      ranked.sort((a, b) => b.score - a.score || a.id - b.id);
      // An original transcript and its anonymized copy hold the same passage: collapse passages with
      // identical text (marked at build time in p.json "same") into one result that links to both.
      const seen = new Map(), unique = [];
      for (const r of ranked) {
        const key = same.get(r.id) ?? r.id;
        const first = seen.get(key);
        if (first) { if (r.d !== first.d && !first.also.includes(r.d)) first.also.push(r.d); continue; }
        r.also = [];
        seen.set(key, r);
        unique.push(r);
      }
      ranked.length = 0;
      ranked.push(...unique);
      const marks = new Set(res.flatMap((r) => r.terms));
      state = { my, phrases, marks, pending: phrases.length ? ranked : [], accepted: [], byDoc: new Map(), shown: 0 };
      if (!phrases.length) for (const r of ranked) accept(state, r);
      await showMore();
    } catch (err) {
      if (my !== gen) return;
      console.warn("search: index could not be loaded", err);
      status.textContent = "Search is unavailable right now: the search index could not be loaded.";
    }
  }

  // One result per document: further matching passages of the same document (a long message split into
  // passages) are counted on the first, best-scoring one instead of being listed again.
  function accept(s, r) {
    const first = s.byDoc.get(r.d);
    if (first) { first.more = (first.more || 0) + 1; if (first.moreEl) { first.moreEl.textContent = moreText(first.more); first.moreEl.hidden = false; } return; }
    r.more = 0;
    s.byDoc.set(r.d, r);
    s.accepted.push(r);
  }
  const moreText = (n) => `+${n} more matching passage${n === 1 ? "" : "s"} in this document`;

  async function verifyMore(s) {
    for (let loaded = 0; s.pending.length && s.accepted.length < s.shown + PAGE && loaded < VERIFY_SHARDS; loaded++) {
      const shard = shardOf(s.pending[0].id), rows = await fetchJSON(`d-${shard}.json`);
      if (s.my !== gen) return;
      const batch = s.pending.filter((r) => shardOf(r.id) === shard);
      s.pending = s.pending.filter((r) => shardOf(r.id) !== shard);
      for (const r of batch) if (hasPhrase(rows[r.id % meta.docshard_size][4], s.phrases)) accept(s, r);
      const tail = s.accepted.splice(s.shown).sort((a, b) => b.score - a.score || a.id - b.id);
      s.accepted.push(...tail);
    }
  }

  async function showMore() {
    const s = state;
    if (!s) return;
    if (s.pending.length) {
      status.textContent = "Checking phrase matches…";
      try {
        await verifyMore(s);
      } catch (err) {
        if (s.my !== gen) return;
        console.warn("search: passages could not be loaded", err);
        status.textContent = "Some passages could not be loaded; press the button to try again.";
        more.textContent = "Check more passages";
        more.hidden = false;
        return;
      }
      if (s.my !== gen) return;
    }
    const page = s.accepted.slice(s.shown, s.shown + PAGE);
    list.append(...page.map((r, i) => result(r, s, s.shown + i < EAGER)));
    s.shown += page.length;
    const total = s.accepted.length;
    if (!total && !s.pending.length) status.textContent = `No results for “${input.value.trim()}”.`;
    else if (!s.shown) status.textContent = "No phrase matches in the passages checked so far; more remain to be checked.";
    else if (s.pending.length) status.textContent = `Showing ${s.shown} phrase match${s.shown === 1 ? "" : "es"} so far; more passages remain to be checked.`;
    else status.textContent = `Showing ${s.shown} of ${total} result${total === 1 ? "" : "s"}.`;
    more.textContent = s.shown < total ? "Show more results" : "Check more passages";
    more.hidden = !(s.pending.length || s.shown < total);
  }

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  // The first EAGER results load their excerpt at once; the rest when they come near the viewport
  // (or once the reader has scrolled past them), so a phone only fetches the passages it shows.
  function result(r, s, eager) {
    const [url, title, kind, context] = docs[r.d];
    // keep a dash with the word before it (NBSP), so a wrapped title never starts a line with "—"
    const li = el("li", "search-result"), head = el("p", "search-result-head"), a = el("a", "search-result-title", title.replace(/ ([—–]) /g, "\u00a0$1 "));
    a.href = root + url.replace(/^\/+/, "");
    head.append(a);
    const snip = el("p", "search-snippet is-loading", "Loading excerpt…");
    snip.dataset.id = String(r.id);
    const ctx = el("p", "search-context");
    ctx.append(el("span", "search-badge", kind));
    // one span per " · " item, so a separator wraps with the item it introduces (drawn by CSS); timestamps
    // stay on one line (ISO, or the "29 Oct 2026, 14:22 UTC" form transcripts use)
    context.split(" · ").forEach((item, k) => {
      const it = el("span", "search-ci");
      item.split(/(\d{4}-\d{2}-\d{2}T[\d:.]+Z?|\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}(?: UTC)?)/).forEach((part, i) => {
        if (part) it.append(i % 2 ? el("span", "search-time", part) : part);
      });
      ctx.append(k ? " " : "", it);
    });
    li.append(head, ctx, snip);
    r.moreEl = el("p", "search-also", r.more ? moreText(r.more) : "");
    r.moreEl.hidden = !r.more;
    li.append(r.moreEl);
    if (r.also && r.also.length) {
      const also = el("p", "search-also", "Same passage also in: ");
      r.also.forEach((d, i) => {
        const x = el("a", "", docs[d][1]);
        x.href = root + docs[d][0].replace(/^\/+/, "");
        also.append(i ? ", " : "", x);
      });
      li.append(also);
    }
    if (eager || !observer) fill(snip, s); else observer.observe(snip);
    return li;
  }

  async function fill(snip, s = state) {
    if (!s || snip.dataset.done) return;
    snip.dataset.done = "1";
    try {
      // excerpts are plain text: drop Markdown emphasis and code markers (** __ `) the passage carries
      const text = (await passage(Number(snip.dataset.id)))[4].replace(/\*\*|__|`+/g, "");
      snip.replaceChildren(snippet(text, s.marks));
      snip.classList.remove("is-loading");
    } catch (err) {
      console.warn("search: snippet unavailable", err);
      snip.textContent = "(excerpt unavailable)";
      snip.classList.remove("is-loading");
    }
  }

  // A window of about WIN characters around the first matched word (whole words at both ends);
  // every match inside it is marked. If no indexed word is found in the text (e.g. the passage
  // matched on its title), the passage start is shown.
  const WIN = 220, LEAD = 70;
  function snippet(text, marks) {
    const hits = [];
    for (const m of text.matchAll(/[\p{L}\p{N}\p{M}]+/gu)) {
      if (words(m[0]).some((t) => marks.has(t))) hits.push([m.index, m.index + m[0].length]);
    }
    let from = 0;
    if (hits.length && hits[0][0] > LEAD) {
      from = hits[0][0] - LEAD;
      const sp = text.slice(from, hits[0][0]).search(/\s/);
      from = sp < 0 ? hits[0][0] : from + sp + 1;
    }
    let to = Math.min(text.length, Math.max(from + WIN, hits.length ? hits[0][1] : 0));
    if (to < text.length) {
      const sp = text.slice(to - 60, to).search(/\s\S*$/);
      if (sp >= 0 && to - 60 + sp > (hits.length ? hits[0][1] : from)) to = to - 60 + sp;
    }
    const frag = document.createDocumentFragment();
    let pos = from;
    if (from > 0) frag.append("… ");
    for (const [a, b] of hits) {
      if (a < pos || b > to) continue;
      frag.append(text.slice(pos, a), el("mark", "", text.slice(a, b)));
      pos = b;
    }
    const tail = text.slice(pos, Math.max(pos, to)).replace(/\s*…\s*$/, "");
    frag.append(tail);
    if (to < text.length || /…\s*$/.test(text)) frag.append(" …");
    return frag;
  }

  const observer = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { observer.unobserve(e.target); fill(e.target); }
  }, { rootMargin: "600px 0px" }) : null;
  let scrollT = 0;
  window.addEventListener("scroll", () => {
    clearTimeout(scrollT);
    scrollT = setTimeout(() => {
      for (const snip of list.querySelectorAll(".search-snippet:not([data-done])")) {
        if (snip.getBoundingClientRect().top > innerHeight + 600) break;
        if (observer) observer.unobserve(snip);
        fill(snip);
      }
    }, 120);
  }, { passive: true });

  const more = el("button", "search-more", "Show more results");
  more.type = "button";
  more.hidden = true;
  more.addEventListener("click", () => { more.disabled = true; showMore().finally(() => { more.disabled = false; }); });
  list.after(more);

  form.addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(timer); search(); });
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(search, 150); });
  kindsBox.addEventListener("change", () => { clearTimeout(timer); search(); });
  document.addEventListener("keydown", (e) => {
    const t = e.target;
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    e.preventDefault();
    input.focus();
    input.select();
  });

  const params = new URLSearchParams(location.search);
  input.value = params.get("q") || "";
  loadBase().then(() => {
    const wanted = new Set(params.getAll("kind"));
    kindsBox.replaceChildren(...meta.kinds.map((k) => {
      const label = el("label", "search-kind"), box = el("input");
      box.type = "checkbox";
      box.name = "kind";
      box.value = k;
      box.checked = wanted.has(k);
      label.append(box, " ", k);
      return label;
    }));
    if (input.value.trim()) search();
  }).catch((err) => {
    console.warn("search: index could not be loaded", err);
    status.textContent = "Search is unavailable right now: the search index could not be loaded.";
  });
})();
