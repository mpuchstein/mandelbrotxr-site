// Blind/Reveal toggle for judge and review pages.
// The server renders both labels (.blind-label / .reveal-label) inside a [data-reveal-scope] container;
// this script only toggles .is-revealed on it, keeps every [data-reveal-toggle] button's aria-pressed
// in sync, and stores the state in the URL hash (#reveal) so a revealed view can be linked.
// The button is .js-only (visible from first paint when JS runs). While blind, CSS hides .reveal-only content
// (html.js); without JavaScript the blind view and the server-rendered mapping stay visible.
(() => {
  "use strict";
  const scopes = document.querySelectorAll("[data-reveal-scope]");
  const buttons = document.querySelectorAll("[data-reveal-toggle]");
  if (!scopes.length || !buttons.length) return;
  const statuses = document.querySelectorAll("[data-reveal-status]");
  const HASH = "#reveal";
  let state = null;

  function apply(on, updateUrl) {
    if (on === state) return;
    state = on;
    scopes.forEach((s) => s.classList.toggle("is-revealed", on));
    // the label stays "Reveal names"; aria-pressed carries the state (a toggle must not rename itself)
    buttons.forEach((b) => b.setAttribute("aria-pressed", on ? "true" : "false"));
    statuses.forEach((s) => {
      const text = on ? s.dataset.on : s.dataset.off;
      if (text && s.textContent !== text) s.textContent = text;
    });
    if (updateUrl) {
      const keep = location.pathname + location.search;
      if (on) history.replaceState(null, "", keep + HASH);
      else if (location.hash === HASH) history.replaceState(null, "", keep);
    }
  }

  buttons.forEach((b) => {
    b.addEventListener("click", () => apply(b.getAttribute("aria-pressed") !== "true", true));
  });
  window.addEventListener("hashchange", () => {
    if (location.hash === HASH) apply(true, false);
    else if (!location.hash) apply(false, false);
  });
  apply(location.hash === HASH, false);
})();
