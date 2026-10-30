// Transcripts and source pages: expand/collapse all folds, jump to message #n, and hash fix-ups.
// A #m-<n> (message) or #L<n> (source line) hash that is not on this page is forwarded to the
// transcript page that holds it, using the page ranges in the pager's data-ranges attribute.
(function () {
  "use strict";
  const pager = document.querySelector(".pager[data-ranges]");
  const ranges = pager ? pager.dataset.ranges.split(" ").map((r, i) => {
    const m = /^(\d+)-(\d+):(\d+)$/.exec(r);
    return m ? { page: i + 1, from: +m[1], to: +m[2], line: +m[3] } : null;
  }).filter(Boolean) : [];
  const here = pager ? +pager.dataset.here : 1;

  function pageHref(k) {
    const a = pager && pager.querySelector(`a[data-page="${k}"]`);
    return a ? a.getAttribute("href") : null;
  }

  function reveal(el) {
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (p.tagName === "DETAILS" && !p.open) p.open = true;
    }
    el.scrollIntoView();
    if (el.classList) {
      el.classList.add("is-target");
      setTimeout(() => el.classList.remove("is-target"), 2000);
    }
  }

  function goMessage(n, replace) {
    const el = document.getElementById("m-" + n);
    if (el) { if (location.hash !== "#m-" + n) history.replaceState(null, "", "#m-" + n); reveal(el); return true; }
    const r = ranges.find((x) => n >= x.from && n <= x.to);
    const href = r && r.page !== here ? pageHref(r.page) : null;
    if (!href) { console.warn("transcripts: no message #" + n); return false; }
    const url = href + "#m-" + n;
    if (replace) location.replace(url); else location.href = url;
    return true;
  }

  function goLine(n) {
    // source pages: the line has its own id; transcript pages: the message that contains the line
    const el = document.getElementById("L" + n);
    if (el) { reveal(el); return; }
    const msgs = Array.from(document.querySelectorAll("article.msg[data-line]"));
    if (!msgs.length) return;
    const r = ranges.length ? ranges.filter((x) => x.line <= n).pop() : null;
    if (r && r.page !== here) {
      const href = pageHref(r.page);
      if (href) { location.replace(href + "#L" + n); return; }
    }
    let best = null;
    for (const m of msgs) if (+m.dataset.line <= n) best = m;
    if (best) reveal(best);
  }

  function onHash(replace) {
    const h = decodeURIComponent(location.hash.slice(1));
    let m;
    if ((m = /^m-(\d+)$/.exec(h))) goMessage(+m[1], replace);
    else if ((m = /^L(\d+)$/.exec(h))) goLine(+m[1]);
    else if (h) { const el = document.getElementById(h); if (el) reveal(el); }
  }

  // A table or code block that scrolls but holds nothing focusable gets tabindex="0" and a name,
  // so keyboard users can scroll it (axe: scrollable-region-focusable). Checked on load, on resize
  // and whenever a fold opens, because folded content has no size until then.
  const FOCUSABLE = "a[href], button, input, select, textarea, summary, [tabindex]";
  function markScrollables(root) {
    root.querySelectorAll(".table-wrap, pre").forEach((el) => {
      if (el.hasAttribute("tabindex") || !el.offsetParent) return;
      const scrolls = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
      if (!scrolls || el.querySelector(FOCUSABLE)) return;
      el.tabIndex = 0;
      if (!el.hasAttribute("role")) el.setAttribute("role", "region");
      if (!el.hasAttribute("aria-label")) el.setAttribute("aria-label", el.tagName === "PRE" ? "Scrollable code" : "Scrollable table");
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    const main = document.querySelector("main");
    if (main) {
      markScrollables(main);
      main.addEventListener("toggle", (e) => { if (e.target.open) markScrollables(e.target); }, true);
      let t = 0;
      window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => markScrollables(main), 200); });
    }
    const tools = document.querySelector("[data-tx-tools]");
    if (tools) {
      tools.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-fold]");
        if (!b) return;
        const open = b.dataset.fold === "open";
        document.querySelectorAll("main details.fold").forEach((d) => { d.open = open; });
      });
      const form = tools.querySelector("[data-tx-jump]");
      if (form) {
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          const n = parseInt(form.querySelector("input").value, 10);
          if (n > 0) goMessage(n, false);
        });
      }
    }
    if (location.hash) onHash(true);
    window.addEventListener("hashchange", () => onHash(false));
  });
})();
