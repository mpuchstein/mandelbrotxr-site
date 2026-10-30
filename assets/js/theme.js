// Colour theme. Follows prefers-color-scheme until the visitor presses the "Dark theme" toggle
// (a <button aria-pressed>); the choice is then stored per browser. Loaded synchronously in <head>
// (external file, CSP-safe) so a stored choice applies before first paint.
(function () {
  "use strict";
  var KEY = "mxr-theme", root = document.documentElement;
  root.classList.add("js"); // JS-only controls are styled visible via html.js before first paint (no layout shift)
  var media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function stored() { try { var v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : null; } catch (e) { return null; } }
  function store(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* storage blocked: choice lasts for this page only */ } }
  function apply(v) { if (v) root.setAttribute("data-theme", v); else root.removeAttribute("data-theme"); }
  function isDark() { var v = root.getAttribute("data-theme"); return v ? v === "dark" : !!(media && media.matches); }
  apply(stored());
  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("theme-toggle");
    if (!btn) return;
    var state = btn.querySelector(".theme-state");
    function sync() {
      btn.setAttribute("aria-pressed", isDark() ? "true" : "false");
      if (state) state.textContent = isDark() ? ": on" : ": off";
    }
    sync();
    btn.addEventListener("click", function () { var v = isDark() ? "light" : "dark"; apply(v); store(v); sync(); });
    if (media && media.addEventListener) media.addEventListener("change", sync);
    var cur = document.querySelector('.site-nav [aria-current="page"]');
    if (cur && cur.scrollIntoView && window.innerWidth < 640) cur.scrollIntoView({ inline: "nearest", block: "nearest" });
  });
})();
