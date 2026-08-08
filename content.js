// content.js — inject style rules + add the body-template (title+body) button next to the description "Attach"
(function () {
  "use strict";

  // Registered on granted origins AND injected programmatically into already-open
  // tabs on a fresh grant. Guard so a second injection into the same page is a no-op.
  if (window.__peLoaded) return;
  window.__peLoaded = true;

  let settings = null;
  let syncCache = { bySource: {} }; // synced templates (chrome.storage.local)

  // styles
  let sheetObj = null;
  let fallbackStyleEl = null;
  let styleObserver = null;

  // template menu
  let menu = null;
  let menuOpen = false;
  let menuOwnerBtn = null;
  // The work item the copy menu was opened for, read once while the menu opens. A peek
  // panel over a list closes as soon as you mousedown outside it, and the menu is appended
  // to <body> — outside the panel — so by the time a format is clicked the panel, and its
  // #title-input, can already be gone. Reading the item up front is what lets the copy
  // survive the panel closing under it.
  let copyRef = null;

  // DOM watching (re-insert the toolbar button)
  let injectScheduled = false;

  const isActive = () => peIsActiveOn(settings, location.hostname);

  // Any template available to insert? (personal OR synced). injectAll runs on every
  // relevant DOM mutation, so this must be O(1) — rebuilding the sections here would
  // re-bucket every template (up to 10 sources x 200) on each mutation burst. Recomputed
  // only when settings or the sync cache actually change.
  let templatesAvailable = false;
  function recountTemplates() {
    try {
      templatesAvailable = peCountTemplates(peBuildTemplateSections(settings || {}, syncCache)) > 0;
    } catch (_) {
      templatesAvailable = false;
    }
  }
  const hasAnyTemplates = () => templatesAvailable;

  /* ================================================================== */
  /* 1. Inject user-defined style rules (adoptedStyleSheets)              */
  /* ================================================================== */
  function validSelector(sel) {
    if (!sel || /[{}]/.test(sel)) return false;
    try {
      document.createDocumentFragment().querySelector(sel);
      return true;
    } catch (_) {
      return false;
    }
  }

  function buildCss() {
    const css = peBuildRuleCss(settings.rules, validSelector);
    if (!focusOn) return css.always;
    return [css.always, css.focus].filter(Boolean).join("\n");
  }

  // Plane is a Next.js/React SPA, so a <style> node in <head>/<body> can be removed
  // during hydration; we use adoptedStyleSheets, which creates no DOM node.
  function applyStyles() {
    const css = isActive() ? buildCss() : "";
    if ("adoptedStyleSheets" in Document.prototype) {
      try {
        if (!sheetObj) sheetObj = new CSSStyleSheet();
        sheetObj.replaceSync(css);
        if (!document.adoptedStyleSheets.includes(sheetObj)) {
          document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheetObj];
        }
        return;
      } catch (_) {
        /* fall back */
      }
    }
    if (!fallbackStyleEl) {
      fallbackStyleEl = document.createElement("style");
      fallbackStyleEl.id = "pe-injected-style";
      document.documentElement.appendChild(fallbackStyleEl);
      styleObserver = new MutationObserver(() => {
        if (fallbackStyleEl && !fallbackStyleEl.isConnected) {
          document.documentElement.appendChild(fallbackStyleEl);
        }
      });
      styleObserver.observe(document.documentElement, { childList: true });
    }
    fallbackStyleEl.textContent = css;
  }

  /* ================================================================== */
  /* 1a. Rule health — did each selector actually match anything?         */
  /* ================================================================== */
  // The answer that was always one call away and never asked for. See peRuleHealthUpdate
  // in common.js for why this records "has it ever matched" rather than a per-page verdict.
  //
  // Timing is the whole difficulty: Plane is an SPA, so the URL changes before the list it
  // names has mounted, and a count taken at navigation time would score every route a miss.
  // The check is therefore keyed on the URL (once per route, however many mutation bursts
  // that route causes) and delayed past the mount.
  let healthUrl = null;
  let healthTimer = null;
  const PE_HEALTH_DELAY = 2500;

  function scheduleRuleHealth() {
    if (!settings || !isActive()) return;
    if (location.href === healthUrl) return; // already counted this route
    healthUrl = location.href;
    clearTimeout(healthTimer);
    healthTimer = setTimeout(() => {
      try {
        recordRuleHealth();
      } catch (_) {}
    }, PE_HEALTH_DELAY);
  }

  // A second sampling, taken after a click and counting hits only.
  //
  // The route-change sample assumes a rule points at something the page is already showing.
  // Plenty do not: the shipped "search dropdown width" rule selects a popover that exists
  // only while the dropdown is OPEN. Measured on self-hosted Plane 1.4, 2026-08-08 — closed:
  // 0 matches, open: 1 — so every routine sample missed it and the settings page eventually
  // called a working preset dead. Any rule aimed at a menu, a modal or a tooltip is the same
  // shape.
  //
  // The instance matters, and getting it wrong cost a round trip: the same preset was ALSO
  // reported dead on Plane Cloud, and this was assumed to be the same cause. It was not —
  // there the selector matched nothing open or closed, because Cloud had moved these
  // popovers to a different library. Two faults, one symptom. See PE_DROPDOWN_SELECTOR.
  //
  // Hits only, and that is what makes it safe: a click is when transient UI is on screen, so
  // this can rescue a rule, but it can never accuse one. Sampling more often would otherwise
  // make a route-specific rule reach the "never matched" threshold faster while telling us
  // nothing new — the same page looked at twice is not more evidence.
  let hitScanAt = 0;
  const PE_HIT_SCAN_EVERY = 4000;

  function scheduleHitScan() {
    if (!settings || !isActive()) return;
    const now = Date.now();
    if (now - hitScanAt < PE_HIT_SCAN_EVERY) return;
    hitScanAt = now;
    // Long enough for the thing the click opened to have mounted, short enough that it is
    // probably still open.
    setTimeout(() => {
      try {
        recordRuleHealth(true);
      } catch (_) {}
    }, 400);
  }

  function recordRuleHealth(hitsOnly) {
    if (!settings || !isActive()) return;
    const rules = Array.isArray(settings.rules) ? settings.rules : [];
    const counts = {};
    rules.forEach((r) => {
      // A disabled rule is not being applied, so counting it would be recording an
      // observation about CSS nobody asked for. A selector the browser cannot read is
      // already reported where it is typed, and is not this feature's news to break.
      if (!r || typeof r !== "object" || !r.id || r.enabled === false) return;
      const sel = String(r.selector == null ? "" : r.selector).trim();
      if (!sel || !validSelector(sel)) return;
      try {
        const n = document.querySelectorAll(sel).length;
        // Leaving a rule out of `counts` is what keeps a hit-only pass from recording a
        // miss: peRuleHealthUpdate only touches the ids it is given.
        if (n > 0 || !hitsOnly) counts[r.id] = n;
      } catch (_) {}
    });
    if (!Object.keys(counts).length) return;
    // Read-modify-write, and two tabs on two routes can interleave. The lost update costs
    // one observation — never a wrong claim, because nothing here is ever decremented and
    // the only direction a lost write moves the reader is toward "we do not know yet".
    peGetRuleHealth().then((prev) =>
      peSaveRuleHealth(peRuleHealthPrune(peRuleHealthUpdate(prev, counts, Date.now()), rules))
    );
  }

  /* ================================================================== */
  /* 1b. Focus mode — the rules marked "focus only", on for this tab      */
  /* ================================================================== */
  // Focus mode is a moment, not a setting, so it is deliberately not in chrome.storage.sync:
  // syncing it would hide the properties panel on a second machine the user never asked, and
  // they would have no idea what did it. sessionStorage is the shape the state actually has —
  // this tab, this origin, surviving a reload, gone when the tab closes.
  const PE_FOCUS_KEY = "pe-focus";
  let focusOn = false;
  let focusAnnounced = false;

  const readStoredFocus = () => {
    try {
      return sessionStorage.getItem(PE_FOCUS_KEY) === "1";
    } catch (_) {
      return false; // storage can be blocked; focus mode is not worth an exception
    }
  };

  function storeFocus(on) {
    try {
      if (on) sessionStorage.setItem(PE_FOCUS_KEY, "1");
      else sessionStorage.removeItem(PE_FOCUS_KEY);
    } catch (_) {}
  }

  // A class on <html> as well as the injected CSS: it is what a user's own rule can hang
  // off (`:root.pe-focus .foo`) before they ever tick the checkbox, and it is the one part
  // of the state a test can see from outside.
  function applyFocusClass() {
    try {
      document.documentElement.classList.toggle("pe-focus", focusOn && isActive());
    } catch (_) {}
  }

  function setFocus(on, announce) {
    focusOn = !!on;
    storeFocus(focusOn);
    applyFocusClass();
    applyStyles();
    syncFocusButtons();
    if (announce) toast(peMsg(focusOn ? "msgFocusOn" : "msgFocusOff"));
  }

  // The state has to be on the button, not only in the stylesheet: it is a toggle, and a
  // toggle that looks the same in both positions tells you nothing about which one it is in.
  function syncFocusButtons() {
    [...document.querySelectorAll(".pe-focus-btn")].forEach((b) => {
      b.setAttribute("aria-pressed", focusOn ? "true" : "false");
      b.setAttribute("title", peMsg(focusOn ? "focusBtnOnTitle" : "focusBtnTitle"));
      b.setAttribute("aria-label", peMsg(focusOn ? "focusBtnOnTitle" : "focusBtnTitle"));
      b.classList.toggle("on", focusOn);
    });
  }

  function makeFocusButton() {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pe-focus-btn";
    // Three columns: the frame is the window, and both outer columns are what goes away —
    // the panel on the right and the navigation on the left. A glyph with a bar down one side
    // only says half of what the button does.
    b.innerHTML =
      '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">' +
      '<rect x="2.2" y="3.4" width="11.6" height="9.2" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.2"/>' +
      '<path d="M5.9 3.6v8.8M10.1 3.6v8.8" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setFocus(!focusOn, true);
    });
    return b;
  }

  function removeFocusButtons() {
    [...document.querySelectorAll(".pe-focus-btn")].forEach((b) => b.remove());
  }

  // Beside the key, after the copy button — the same header, because that is where a reader
  // is already looking and the only anchor in this page we trust (a leaf button whose text is
  // a key). The fast path is the copy button's, for the same reason: findKeyEl scans every
  // button under up to ten ancestors, and injectAll runs on every mutation burst.
  function ensureFocusButton() {
    const existing = document.querySelector(".pe-focus-btn");
    if (existing) {
      const prev = existing.previousElementSibling;
      const placed =
        (isKeyButton(prev) && !isLinkedKeyButton(prev)) ||
        (prev && prev.classList && prev.classList.contains("pe-copy-ref-btn"));
      if (placed) {
        syncFocusButtons();
        return;
      }
      removeFocusButtons();
    }
    const keyEl = findKeyEl();
    if (!keyEl) {
      removeFocusButtons();
      return;
    }
    const row = keyEl.parentElement;
    if (!row || row.querySelector(":scope > .pe-focus-btn")) return;
    const after = row.querySelector(":scope > .pe-copy-ref-btn") || keyEl;
    after.insertAdjacentElement("afterend", makeFocusButton());
    syncFocusButtons();
  }

  // Landing in focus mode after a reload is the one way a user meets a hidden properties
  // panel without having just asked for it. Say so once, with the way back in the message.
  function announceFocusOnce() {
    if (focusAnnounced || !focusOn || !isActive()) return;
    focusAnnounced = true;
    toast(peMsg("msgFocusRestored"));
  }

  /* ================================================================== */
  /* 2. Body-template button (next to the description "Attach", same UI) */
  /* ================================================================== */
  // Text hint for the attach button (EN "attach" / KO "첨부"). This is only a
  // fallback — the primary signal is structural and language-independent.
  const ATTACH_RE = /attach|첨부/i;

  // The description toolbar's attach button wraps a hidden <input type="file">,
  // which is the same in every UI language — so we anchor on that, not on text.
  const hasFileInput = (b) => {
    try {
      return !!b.querySelector('input[type="file"]');
    } catch (_) {
      return false;
    }
  };
  // Not our own cloned button, and not nested inside another button (avoids duplicates).
  const isCandidateButton = (b) =>
    !b.classList.contains("pe-body-tmpl-btn") && !(b.parentElement && b.parentElement.closest("button"));

  // Find a given editor's toolbar attach button by walking up to the shared wrapper.
  // Primary: a button wrapping a file input (any language). Fallback: attach/첨부 text.
  function findToolbarAnchor(editor) {
    const scan = (pred) => {
      let n = editor;
      for (let i = 0; i < 8 && n; i++) {
        if (n.querySelectorAll) {
          const hit = [...n.querySelectorAll("button")].find(pred);
          if (hit) return hit;
        }
        n = n.parentElement;
      }
      return null;
    };
    return (
      scan((b) => isCandidateButton(b) && hasFileInput(b)) ||
      scan(
        (b) =>
          isCandidateButton(b) &&
          ATTACH_RE.test((b.textContent || "") + " " + (b.getAttribute("aria-label") || ""))
      )
    );
  }
  function isCommentArea(el) {
    try {
      return !!el.closest('[class*="comment" i]');
    } catch (_) {
      return false;
    }
  }

  // Clone the Attach button (= identical style) and swap only the label/icon for the template
  function relabel(btn, label) {
    const svg = btn.querySelector("svg");
    if (svg) {
      svg.setAttribute("viewBox", "0 0 16 16");
      svg.innerHTML =
        '<path d="M4.75 2h4.09a1 1 0 0 1 .7.29l2.17 2.17a1 1 0 0 1 .29.7V13.5a.5.5 0 0 1-.5.5H4.75a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5Z" fill="none" stroke="currentColor" stroke-width="1.1"/>' +
        '<path d="M9 2.2V5h2.8" fill="none" stroke="currentColor" stroke-width="1.1"/>' +
        '<path d="M6.2 8.4h3.6M6.2 10.6h3.6" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>';
    }
    const walker = document.createTreeWalker(btn, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (n.textContent.trim()) {
        n.textContent = label;
        break;
      }
    }
  }

  // Find the toolbar row (flex container) that holds Attach. Appending to the end of
  // that row keeps the inter-button gap consistent and places it to the right of Attach.
  function findToolbarRow(attach) {
    let el = attach.parentElement;
    for (let i = 0; i < 5 && el; i++) {
      const d = getComputedStyle(el).display;
      if (d === "flex" || d === "inline-flex") return el;
      el = el.parentElement;
    }
    return attach.parentElement;
  }

  function ensureButtonNear(attach) {
    const row = findToolbarRow(attach);
    if (!row) return;
    if (row.querySelector(":scope > .pe-body-tmpl-btn")) return; // already present
    const btn = attach.cloneNode(true);
    btn.classList.add("pe-body-tmpl-btn");
    btn.removeAttribute("id");
    // drop any cloned form controls (e.g. the attach button's hidden file input) so
    // our button carries no <input> and is never mistaken for an attach button.
    btn.querySelectorAll("input, textarea, select").forEach((n) => n.remove());
    btn.setAttribute("type", "button");
    btn.setAttribute("aria-label", peMsg("menuBtnAria"));
    btn.setAttribute("title", peMsg("menuBtnTitle"));
    relabel(btn, peMsg("menuBtnLabel"));
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleMenu(btn);
    });
    row.appendChild(btn); // end of the toolbar row (= right of Attach), keeps the gap
  }

  function removeTemplateButtons() {
    [...document.querySelectorAll(".pe-body-tmpl-btn")].forEach((b) => b.remove());
  }

  function removeCopyButtons() {
    [...document.querySelectorAll(".pe-copy-ref-btn")].forEach((b) => b.remove());
  }

  function removeButtons() {
    removeTemplateButtons();
    removeCopyButtons();
    removeFocusButtons();
    hideMenu();
  }

  function makeTemplateButton() {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pe-body-tmpl-btn";
    b.setAttribute("aria-label", peMsg("menuBtnAria"));
    b.setAttribute("title", peMsg("menuBtnTitle"));
    b.innerHTML =
      '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">' +
      '<path d="M4.75 2h4.09a1 1 0 0 1 .7.29l2.17 2.17a1 1 0 0 1 .29.7V13.5a.5.5 0 0 1-.5.5H4.75a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5Z" fill="none" stroke="currentColor" stroke-width="1.1"/>' +
      '<path d="M9 2.2V5h2.8" fill="none" stroke="currentColor" stroke-width="1.1"/>' +
      '<path d="M6.2 8.4h3.6M6.2 10.6h3.6" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>' +
      "<span></span>";
    b.querySelector("span:last-child").textContent = peMsg("menuBtnLabel");
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleMenu(b);
    });
    return b;
  }

  // Some description editors have no toolbar/attach button (e.g. the "Create work
  // item" modal). A template fills the whole item (title + body), so prefer the
  // modal's header row — next to the project selector — as an item-level spot;
  // otherwise fall back to a small floating button on the editor's box.
  function ensureFloatingButton(editor) {
    // 1) Modal header row: the top flex row with `justify-content: space-between`
    //    (holds the project selector). It has one child, so appending a second
    //    right-aligns our button. Language/class-independent (matched by layout).
    const dialog = editor.closest && editor.closest('[role="dialog"]');
    if (dialog) {
      const form = editor.closest("form") || dialog;
      const row = [...form.querySelectorAll("div")].find((d) => {
        if (d.querySelector(".ProseMirror, .tiptap")) return false; // not an editor wrapper
        const cs = getComputedStyle(d);
        return (
          cs.display === "flex" &&
          cs.justifyContent === "space-between" &&
          d.getBoundingClientRect().width > 300
        );
      });
      if (row) {
        if (row.querySelector(":scope > .pe-body-tmpl-btn")) return; // already there
        const b = makeTemplateButton();
        b.classList.add("pe-tmpl-header");
        row.appendChild(b);
        return;
      }
    }

    // 2) Fallback: small floating button on the editor's box (toolbar-less inline editors)
    let host = editor.parentElement;
    for (let i = 0; i < 6 && host; i++) {
      const pos = getComputedStyle(host).position;
      if (pos === "relative" || pos === "absolute" || pos === "fixed") break;
      host = host.parentElement;
    }
    if (!host) host = editor.parentElement;
    if (!host || host.querySelector(":scope > .pe-body-tmpl-btn")) return;
    const b = makeTemplateButton();
    b.classList.add("pe-tmpl-floating");
    host.appendChild(b);
  }

  /* ---- copy reference ---- */

  const hasCopyFormats = () => !!(settings && (settings.copyFormats || []).length);

  // Is this element a <button> whose visible text IS a work item key (see PE_ITEM_KEY_RE,
  // which also rules out a "2026-07" date chip)? The match is on the trimmed textContent
  // anchored end to end, so a button carrying extra text ("PROJ-1 · edit") is rejected — but
  // a button that wraps the key with an icon (<svg>, which contributes no text) still matches.
  // Not requiring a childless leaf is deliberate: a future Plane that puts an icon inside the
  // key button should not make the copy affordance silently vanish.
  const isKeyButton = (e) => !!e && e.tagName === "BUTTON" && PE_ITEM_KEY_RE.test((e.textContent || "").trim());

  // The key as printed above the title, or null. This element is both the value we copy
  // and the spot we hang the button on, so everything starts here.
  //
  // Found by shape, not by class name — Plane's Tailwind classes move between versions.
  // The search starts at #title-input and widens one ancestor at a time, so the first
  // block holding both the title and a key (see isKeyButton) is the item header; the
  // breadcrumb prints the same key higher up the page and is never reached.
  //
  // The peek panel a list opens has this identical structure — same title field, same key
  // button, same wrapper — which is why one function serves both.
  // A key button that links somewhere is a key belonging to some other item — you do not link
  // to the page you are already on. This is how the parent chip's key gives itself away, and it
  // is cheap enough to check on the injection fast path.
  const isLinkedKeyButton = (e) => isKeyButton(e) && !!(e.closest && e.closest("a[href]"));

  // Which of the keys on screen is *this* item's. An item with a parent shows the parent's key
  // above the title, in the same block, from the same component — so it is also a leaf button
  // whose text is a key, and it comes first in document order. Taking the first match put the
  // copy and focus buttons on the parent's chip, and made Copy reference hand over the parent.
  //
  // Ranked rather than filtered, so a Plane that changes one of these signals degrades to a
  // worse guess instead of to no button at all:
  //   * the URL. An item's own page is /{workspace}/browse/{KEY}, so a button whose text is that
  //     key is this item beyond doubt. A list route with a peek panel over it has no key to
  //     compare, which is why the other two signals exist.
  //   * a link. The parent's key is inside an <a href> to the parent, as are the keys of every
  //     sub-item, relation and sibling-menu entry. You do not link to the page you are on.
  //   * disabled. Plane makes this item's key click-to-copy and leaves every other one inert.
  //
  // Against Plane 1.4 the first two decide every case, and the harness fails if either is taken
  // away. `disabled` is the spare, and deliberately so: it costs one boolean and it is what would
  // carry this if a release ever rendered the parent chip as a div with an onClick instead of a
  // link. It has no case of its own, because Plane has no such DOM to write a case against.
  function rankKeyButton(el, urlKey) {
    let score = 0;
    if (urlKey && (el.textContent || "").trim() === urlKey) score += 4;
    if (!isLinkedKeyButton(el)) score += 2;
    if (!el.disabled) score += 1;
    return score;
  }

  function findKeyEl() {
    const title = document.querySelector("#title-input");
    if (!title) return null;
    const urlKey = peKeyFromPath(location.pathname);
    let scope = title.parentElement;
    for (let i = 0; i < 10 && scope; i++, scope = scope.parentElement) {
      const hits = [...scope.querySelectorAll("button")].filter(isKeyButton);
      if (!hits.length) continue;
      // Ties keep document order, which is what the single-key case has always done.
      let best = hits[0];
      let bestScore = rankKeyButton(hits[0], urlKey);
      for (const el of hits.slice(1)) {
        const score = rankKeyButton(el, urlKey);
        if (score > bestScore) {
          best = el;
          bestScore = score;
        }
      }
      return best;
    }
    return null;
  }

  // The work item that key belongs to: its key, title and link.
  function readItemRef(keyEl) {
    if (!keyEl) return null;
    const key = (keyEl.textContent || "").trim();
    if (!key) return null;
    const t = document.querySelector("#title-input");
    return {
      key,
      title: t && typeof t.value === "string" ? t.value.trim() : "",
      url: peItemUrl(location.origin, location.pathname, key)
    };
  }

  function makeCopyButton() {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pe-copy-ref-btn";
    b.setAttribute("aria-label", peMsg("copyBtnAria"));
    b.setAttribute("title", peMsg("copyBtnTitle"));
    // Two offset sheets — the copy glyph every UI uses for this, so the button needs no
    // label next to a key that is already short.
    b.innerHTML =
      '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">' +
      '<rect x="5.75" y="5.75" width="7.5" height="8.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2"/>' +
      '<path d="M10.5 3.75H3.9a1.15 1.15 0 0 0-1.15 1.15v6.6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleMenu(b, "copy");
    });
    return b;
  }

  function ensureCopyButton() {
    // Fast path: if our button is already sitting right after a key button, it is correctly
    // placed — leave it and skip findKeyEl. This spares the whole-page button scan on every
    // mutation-driven inject in the steady state, and reading the key's CURRENT text at copy
    // time means an in-place key change (a peek panel switching items) still copies the right
    // one. A stale button (its key gone) fails this check and is rebuilt below — and so does one
    // sitting on a linked key, which is never this item's (see rankKeyButton). Without that
    // second half the fast path would defend a button that landed on a parent chip.
    const existing = document.querySelector(".pe-copy-ref-btn");
    if (existing) {
      const prev = existing.previousElementSibling;
      if (isKeyButton(prev) && !isLinkedKeyButton(prev)) return;
      removeCopyButtons();
    }
    const keyEl = findKeyEl();
    if (!keyEl) {
      // No key on screen, no button. Nothing floats in from the side: a copy affordance
      // that is not beside the key it copies is a mystery button.
      removeCopyButtons();
      return;
    }
    const row = keyEl.parentElement;
    if (!row || row.querySelector(":scope > .pe-copy-ref-btn")) return;
    keyEl.insertAdjacentElement("afterend", makeCopyButton());
  }

  // The synchronous copy: select a throwaway textarea and execCommand. Deprecated, but it
  // is the only path that works without the async Clipboard API — and it MUST be called
  // straight from the click, inside the user-activation window, or the browser refuses it.
  function execCommandCopy(text) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (_) {
      return false;
    }
  }

  // Put text on the clipboard. Prefer the async Clipboard API. If it REJECTS (e.g. the
  // document is not focused), there is no sound recovery: an execCommand run from the
  // rejection handler fires a microtask after the click returned, outside the user
  // activation, so it would only fail too — reporting failure honestly beats pretending.
  // The execCommand path is kept for browsers with no async API at all, where it still
  // runs synchronously inside the click.
  function writeClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(
          () => true,
          () => false
        );
      }
    } catch (_) {}
    return Promise.resolve(execCommandCopy(text));
  }

  function copyReference(fmt) {
    // The snapshot taken when the menu opened — NOT a fresh read, which would fail once
    // the peek panel has closed under the menu.
    const ref = copyRef;
    hideMenu();
    if (!ref) {
      toast(peMsg("msgCopyNoItem"));
      return;
    }
    const text = peExpandCopyFormat(fmt.format, ref);
    const missing = peMissingItemFields(fmt.format, ref);
    writeClipboard(text).then((ok) => {
      if (!ok) toast(peMsg("msgCopyFailed"));
      // The unresolved token is on the clipboard verbatim, so say which one it was —
      // otherwise the user finds out when it is already pasted somewhere.
      else if (missing.length) toast(peMsg("msgCopiedMissing", [missing.join(", ")]));
      else toast(peMsg("msgCopied"));
    });
  }

  function injectAll() {
    if (!isActive()) {
      removeButtons();
      return;
    }
    // The two buttons are gated separately: a user with no templates can still copy a
    // reference, and a user who deleted every copy format still gets the template menu.
    if (hasAnyTemplates()) {
      // Anchor on the description editor (ProseMirror/tiptap) — language-independent.
      // Skip comment editors (comment templates are intentionally not supported).
      [...document.querySelectorAll(".ProseMirror, .tiptap")].forEach((ed) => {
        if (isCommentArea(ed)) return;
        const anchor = findToolbarAnchor(ed);
        if (anchor) ensureButtonNear(anchor);
        // Toolbar-less editors: only fall back inside a dialog (the "Create work item"
        // modal). Prevents spurious buttons on secondary editors in the detail view.
        else if (ed.closest && ed.closest('[role="dialog"]')) ensureFloatingButton(ed);
      });
    } else {
      removeTemplateButtons();
    }

    if (hasCopyFormats()) ensureCopyButton();
    else removeCopyButtons();

    // No gate of its own beyond having somewhere to put it: unlike the other two, focus mode
    // needs nothing configured. It is offered wherever an item header is, which is the surface
    // it is about — and it stays out of a page that has no work item on it.
    ensureFocusButton();

    // Last, and self-throttling: injectAll runs on every mutation burst, this runs once per
    // route. Hanging it here rather than on a navigation event is what makes it work on an
    // SPA that changes the URL without one.
    scheduleRuleHealth();
  }
  // setTimeout-based debounce (requestAnimationFrame pauses in background tabs, so it's avoided)
  function scheduleInject() {
    if (injectScheduled) return;
    injectScheduled = true;
    setTimeout(() => {
      injectScheduled = false;
      try {
        injectAll();
      } catch (_) {}
    }, 50);
  }

  /* ---- menu ---- */
  function ensureMenu() {
    if (menu) return;
    menu = document.createElement("div");
    menu.id = "pe-tmpl-menu";
    menu.addEventListener("mousedown", (e) => e.preventDefault());
    document.body.appendChild(menu);
  }

  function renderMenu() {
    menu.innerHTML = "";
    const sections = peBuildTemplateSections(settings || {}, syncCache);
    const total = peCountTemplates(sections);
    const hasSynced = sections.some((s) => s.kind === "synced");

    // Filter box — only worth showing once the list is long (a source can push many).
    let filterInput = null;
    if (total > 8) {
      const fwrap = document.createElement("div");
      fwrap.className = "pe-menu-filter";
      filterInput = document.createElement("input");
      filterInput.type = "text";
      filterInput.placeholder = peMsg("menuFilterPh");
      filterInput.className = "pe-menu-filter-input";
      filterInput.addEventListener("mousedown", (e) => e.stopPropagation());
      fwrap.appendChild(filterInput);
      menu.appendChild(fwrap);
    }

    const list = document.createElement("div");
    list.className = "pe-menu-list";

    // Build one wrap per group of items; `headerEl` is that group's own header (may be
    // null) and `ownerEl` is the source header the group belongs to (may be null).
    // The filter uses these to hide empty headers, and a source header once all of its
    // groups are filtered out.
    const wraps = []; // { wrap, headerEl, ownerEl }

    // One-line preview. The body is Markdown, so strip the syntax rather than showing
    // "## Environment - Version:" — the markers carry no meaning at a glance.
    function previewOf(t) {
      const parts = [];
      if (t.title && t.title.trim()) parts.push(peMsg("menuTitlePrefix", [t.title.trim()]));
      if (t.content && t.content.trim()) {
        const plain = String(t.content)
          .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
          .replace(/^\s*#{1,6}\s+/gm, "") // headings
          .replace(/^\s*[-*]\s+\[[ xX]\]\s+/gm, "") // task items
          .replace(/^\s*[-*]\s+/gm, "") // bullets
          .replace(/^\s*\d+\.\s+/gm, "") // ordered items
          .replace(/^\s*-{3,}\s*$/gm, " ") // rules
          .replace(/[*_`>]/g, "") // inline markers
          .replace(/\s+/g, " ")
          .trim();
        if (plain) parts.push(plain);
      }
      return parts.join(" · ").slice(0, 90);
    }

    function addItems(items, headerEl, ownerEl) {
      const wrap = document.createElement("div");
      wrap.className = "pe-menu-group";
      items.forEach((t) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "pe-menu-item";
        const title = document.createElement("div");
        title.className = "pe-menu-item-title";
        title.textContent = t.name || peMsg("menuUntitled");
        const preview = document.createElement("div");
        preview.className = "pe-menu-item-preview";
        preview.textContent = previewOf(t);
        item._haystack = ((t.name || "") + " " + (t.title || "") + " " + (t.content || "")).toLowerCase();
        item.appendChild(title);
        item.appendChild(preview);
        item.addEventListener("mousedown", (e) => e.preventDefault());
        item.addEventListener("click", (e) => {
          e.preventDefault();
          applyTemplate(t, menuOwnerBtn);
          hideMenu();
        });
        wrap.appendChild(item);
      });
      list.appendChild(wrap);
      wraps.push({ wrap, headerEl, ownerEl });
    }

    sections.forEach((section) => {
      if (section.kind === "personal") {
        let head = null;
        if (hasSynced) {
          // Only label your own templates when synced blocks follow them.
          head = document.createElement("div");
          head.className = "pe-menu-section";
          const label = document.createElement("span");
          label.className = "pe-menu-section-label";
          label.textContent = peMsg("menuYours");
          head.appendChild(label);
          list.appendChild(head);
        }
        addItems(section.items, head, null);
        return;
      }

      // Synced source: one header named after the source, then a sub-header per group.
      // No generic prefix (every synced block would carry it, so it identifies nothing)
      // and no lock (read-only only matters in Settings — here you can only insert).
      // The full URL rides along as a tooltip for provenance.
      const srcHead = document.createElement("div");
      srcHead.className = "pe-menu-section pe-menu-section-synced";
      const label = document.createElement("span");
      label.className = "pe-menu-section-label";
      label.textContent = section.source || peMsg("menuSynced");
      srcHead.appendChild(label);
      if (section.url) srcHead.title = section.url;
      list.appendChild(srcHead);

      section.groups.forEach((g) => {
        let sub = null;
        if (g.label) {
          sub = document.createElement("div");
          sub.className = "pe-menu-subsection";
          sub.textContent = g.label;
          list.appendChild(sub);
        }
        addItems(g.items, sub, srcHead);
      });
    });

    menu.appendChild(list);

    if (filterInput) {
      const noHits = document.createElement("div");
      noHits.className = "pe-menu-empty";
      noHits.textContent = peMsg("menuNoMatch");
      noHits.style.display = "none";
      list.appendChild(noHits);
      filterInput.addEventListener("input", () => {
        const q = filterInput.value.trim().toLowerCase();
        let shown = 0;
        const ownerHits = new Map(); // source header → surviving item count
        wraps.forEach(({ wrap, headerEl, ownerEl }) => {
          let groupShown = 0;
          wrap.querySelectorAll(".pe-menu-item").forEach((it) => {
            const hit = !q || it._haystack.indexOf(q) !== -1;
            it.style.display = hit ? "" : "none";
            if (hit) groupShown++;
          });
          wrap.style.display = groupShown ? "" : "none";
          if (headerEl) headerEl.style.display = groupShown ? "" : "none";
          if (ownerEl) ownerHits.set(ownerEl, (ownerHits.get(ownerEl) || 0) + groupShown);
          shown += groupShown;
        });
        // A source header disappears only when every group under it is empty.
        ownerHits.forEach((n, el) => (el.style.display = n ? "" : "none"));
        noHits.style.display = shown ? "none" : "block";
      });
    }

    menu.appendChild(makeMenuFooter(peMsg("menuManage")));
  }

  // Shared by both menu modes. The door is the same Settings page, but the label is not:
  // "Manage templates" under a list of copy formats sends the user looking for the wrong
  // card.
  function makeMenuFooter(label) {
    const footer = document.createElement("div");
    footer.className = "pe-menu-footer";
    const cfg = document.createElement("button");
    cfg.type = "button";
    cfg.className = "pe-menu-config";
    cfg.textContent = label;
    cfg.addEventListener("mousedown", (e) => e.preventDefault());
    cfg.addEventListener("click", (e) => {
      e.preventDefault();
      try {
        chrome.runtime.sendMessage({ type: "pe-open-options" });
      } catch (_) {}
      hideMenu();
    });
    footer.appendChild(cfg);
    return footer;
  }

  // The copy list. Every row previews the exact string the click will put on the
  // clipboard — the format is the output, so showing the output is showing the format.
  function renderCopyMenu() {
    menu.innerHTML = "";
    // Snapshot the item now, while whatever opened the menu (button or Alt+C) guarantees
    // the panel is still up. copyReference uses this, not a fresh read at click time.
    copyRef = readItemRef(findKeyEl());
    const ref = copyRef;
    const formats = (settings && settings.copyFormats) || [];
    const wrap = document.createElement("div");
    wrap.className = "pe-menu-group";
    formats.forEach((f) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "pe-menu-item";
      const name = document.createElement("div");
      name.className = "pe-menu-item-title";
      name.textContent = f.name || peMsg("menuUntitled");
      const preview = document.createElement("div");
      preview.className = "pe-menu-item-preview";
      preview.textContent = peExpandCopyFormat(f.format, ref).slice(0, 120);
      item.appendChild(name);
      item.appendChild(preview);
      // stopPropagation as well as preventDefault: the mousedown is on <body>-level menu,
      // outside the peek panel, and without stopping it Plane's own outside-click handler
      // closes the panel under the menu. The copy would still work (we use copyRef), but
      // the panel snapping shut mid-copy is jarring.
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      item.addEventListener("click", (e) => {
        e.preventDefault();
        copyReference(f);
      });
      wrap.appendChild(item);
    });
    menu.appendChild(wrap);
    menu.appendChild(makeMenuFooter(peMsg("menuManageCopy")));
  }

  function positionMenu(btn) {
    const br = btn.getBoundingClientRect();
    const mw = 300;
    let left = window.scrollX + br.left;
    if (left + mw > window.scrollX + window.innerWidth - 8) {
      left = window.scrollX + window.innerWidth - mw - 8;
    }
    const menuH = menu.offsetHeight || 240;
    // the toolbar sits near the bottom of the viewport, so open above the button by default
    let top = window.scrollY + br.top - menuH - 6;
    if (br.top - menuH - 6 < 0) top = window.scrollY + br.bottom + 6; // not enough room above → open below
    menu.style.left = left + "px";
    menu.style.top = top + "px";
    menu.style.width = mw + "px";
  }

  function toggleMenu(btn, mode) {
    if (menuOpen && menuOwnerBtn === btn) {
      hideMenu();
      return;
    }
    menuOwnerBtn = btn;
    ensureMenu();
    if (mode === "copy") renderCopyMenu();
    else renderMenu();
    menu.style.display = "block";
    positionMenu(btn);
    menuOpen = true;
  }
  function hideMenu() {
    if (menu) menu.style.display = "none";
    menuOpen = false;
  }

  /* ---- apply (title + body) ---- */
  function setNativeValue(el, value) {
    const proto =
      el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Expand template variables, all resolved at insert time:
  //   {{date}}        → today, YYYY-MM-DD
  //   {{date+N}} / {{date-N}} → N days from today (e.g. {{date+7}}), same format
  //   {{week}}        → this week's range "YYYY-MM-DD ~ YYYY-MM-DD" (Monday–Sunday)
  //   {{month}}       → current month, YYYY-MM
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtDate = (d) => d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  const shiftDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  //   {{var.<name>}}  → a value from Settings (see PE_VAR_PREFIX)
  function expandVars(text, vars) {
    if (!text) return "";
    const d = new Date();
    // Monday of the current week (ISO week: Monday is day 0).
    const monday = shiftDays(d, -((d.getDay() + 6) % 7));
    const week = fmtDate(monday) + " ~ " + fmtDate(shiftDays(monday, 6));
    return (
      String(text)
        .replace(/\{\{\s*date\s*([+-]\s*\d+)\s*\}\}/gi, (_, off) =>
          fmtDate(shiftDays(d, parseInt(String(off).replace(/\s+/g, ""), 10)))
        )
        .replace(/\{\{\s*date\s*\}\}/gi, fmtDate(d))
        .replace(/\{\{\s*week\s*\}\}/gi, week)
        .replace(/\{\{\s*month\s*\}\}/gi, d.getFullYear() + "-" + pad2(d.getMonth() + 1))
        // One pass, no recursion: a value is inserted as written, so {{var.a}} = "{{var.b}}"
        // stays literal instead of chaining. An unknown name is returned untouched, which
        // is what every other unrecognised {{…}} already does — a variable you forgot to
        // define stays visible rather than quietly becoming an empty string.
        .replace(/\{\{\s*var\.([a-zA-Z0-9_-]+)\s*\}\}/gi, (m, name) => {
          const hit = (vars || []).find((v) => v && String(v.name).toLowerCase() === name.toLowerCase());
          return hit ? String(hit.value) : m;
        })
    );
  }

  // Title etc. (input/textarea): insert at the cursor if focused, otherwise at the end —
  // the same rule insertIntoEditor uses for the body, so both halves of a template land
  // by one predictable law.
  //
  // Tempting and wrong: treating a title as a prefix and prepending it when the field is
  // not empty. That the sample reads "[Bug] " is an accident of the sample; a title can
  // be any text, and nothing in it says where the author meant it to go. Guessing from
  // its shape — or moving it depending on whether the field is empty — trades a rule the
  // user can predict for one they cannot. It appends; Ctrl/Cmd+Z takes it back.
  function insertIntoInput(el, text) {
    const was = document.activeElement === el;
    el.focus();
    const v = el.value || "";
    const s = was && el.selectionStart != null ? el.selectionStart : v.length;
    const e = was && el.selectionEnd != null ? el.selectionEnd : s;

    // Select the span we are about to write over, then let the browser make the edit:
    // execCommand puts it on the undo stack, so Ctrl/Cmd+Z takes the template back out.
    // Assigning .value (the fallback below) is invisible to undo — the body has always
    // been undoable through ProseMirror, and the title should not be the one field where
    // a mis-picked template cannot be taken back.
    try {
      el.setSelectionRange(s, e);
      if (document.execCommand("insertText", false, text) && el.value !== v) return;
    } catch (_) {}

    // Fallback: React keeps its own copy of the value, so a plain assignment goes
    // unnoticed — the native setter plus an input event is what makes it look real.
    setNativeValue(el, v.slice(0, s) + text + v.slice(e));
    const p = s + text.length;
    try {
      el.setSelectionRange(p, p);
    } catch (_) {}
  }

  // Minimal Markdown → HTML for template bodies. Plane's editor is a WYSIWYG
  // (TipTap/ProseMirror), so we hand it HTML (via paste) instead of literal markdown.
  function mdInline(s) {
    s = String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    return s;
  }
  function mdToHtml(md) {
    const lines = String(md).replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    let list = null; // 'ul' | 'ol' | 'task'
    const closeList = () => {
      if (list) {
        out.push(list === "ol" ? "</ol>" : "</ul>");
        list = null;
      }
    };
    let m;
    for (const line of lines) {
      if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
        closeList();
        const lv = m[1].length;
        out.push("<h" + lv + ">" + mdInline(m[2]) + "</h" + lv + ">");
      } else if ((m = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line))) {
        if (list !== "task") {
          closeList();
          out.push('<ul data-type="taskList">');
          list = "task";
        }
        out.push(
          '<li data-type="taskItem" data-checked="' +
            (m[1].toLowerCase() === "x") +
            '">' +
            mdInline(m[2]) +
            "</li>"
        );
      } else if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) {
        if (list !== "ul") {
          closeList();
          out.push("<ul>");
          list = "ul";
        }
        out.push("<li>" + mdInline(m[1]) + "</li>");
      } else if ((m = /^\s*\d+\.\s+(.*)$/.exec(line))) {
        if (list !== "ol") {
          closeList();
          out.push("<ol>");
          list = "ol";
        }
        out.push("<li>" + mdInline(m[1]) + "</li>");
      } else if (/^\s*---+\s*$/.test(line)) {
        closeList();
        out.push("<hr>");
      } else if (line.trim() === "") {
        closeList();
      } else {
        closeList();
        out.push("<p>" + mdInline(line) + "</p>");
      }
    }
    closeList();
    return out.join("");
  }

  // Body ProseMirror: if the cursor is outside the editor, move to the document end, then insert.
  function insertIntoEditor(editor, text) {
    editor.focus();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !editor.contains(sel.anchorNode)) {
      const r = document.createRange();
      r.selectNodeContents(editor);
      r.collapse(false);
      const s2 = window.getSelection();
      s2.removeAllRanges();
      s2.addRange(r);
    }
    // Rich insert, path 1: synthetic paste of HTML — the full detail-view editor
    // parses this into real headings/lists/checkboxes.
    const html = mdToHtml(text);
    try {
      const beforeLen = (editor.textContent || "").length;
      const dt = new DataTransfer();
      dt.setData("text/html", html);
      dt.setData("text/plain", text);
      editor.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })
      );
      if ((editor.textContent || "").length > beforeLen) {
        editor.dispatchEvent(new Event("input", { bubbles: true }));
        return; // rich content inserted
      }
    } catch (_) {}
    // Rich insert, path 2: execCommand("insertHTML") — the lite editor in the
    // "Create work item" modal ignores the synthetic paste but renders this into
    // headings/lists (task-list checkboxes may degrade to plain list items there).
    try {
      const beforeLen = (editor.textContent || "").length;
      if (document.execCommand("insertHTML", false, html) && (editor.textContent || "").length > beforeLen) {
        editor.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
    } catch (_) {}
    let done = false;
    try {
      done = document.execCommand("insertText", false, text);
    } catch (_) {}
    if (!done) {
      try {
        const ev = new InputEvent("beforeinput", {
          inputType: "insertText",
          data: text,
          bubbles: true,
          cancelable: true
        });
        done = !editor.dispatchEvent(ev);
      } catch (_) {}
    }
    if (!done) {
      const s3 = window.getSelection();
      if (s3 && s3.rangeCount) {
        const rng = s3.getRangeAt(0);
        rng.deleteContents();
        rng.insertNode(document.createTextNode(text));
        rng.collapse(false);
      }
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  // Work-item title field. The detail view uses `#title-input` (textarea); the
  // "Create work item" modal uses `input#name` (placeholder "Title"). Scope to the
  // insertion's dialog first so we fill the modal's title, not the page behind it.
  function findTitleField(contextEl) {
    const scope =
      (contextEl && contextEl.closest && contextEl.closest('[role="dialog"], form, [class*="modal" i]')) ||
      document;
    return (
      scope.querySelector("textarea#title-input, input#title-input") ||
      scope.querySelector('input#name[placeholder], input[placeholder="Title" i]') ||
      scope.querySelector(
        'textarea[placeholder*="title" i], input[placeholder*="title" i], textarea[placeholder*="제목" i], input[placeholder*="제목" i]'
      ) ||
      document.querySelector("textarea#title-input, input#title-input")
    );
  }

  // Find the body editor (nearest ProseMirror) for the toolbar the button belongs to
  function findEditorFor(btn) {
    let node = btn;
    for (let i = 0; i < 8 && node; i++) {
      const pm = node.querySelector && node.querySelector(".ProseMirror, .tiptap");
      if (pm) return pm;
      node = node.parentElement;
    }
    const top = btn.getBoundingClientRect().top;
    const eds = [...document.querySelectorAll(".ProseMirror, .tiptap")].filter(
      (e) => e.getBoundingClientRect().top < top
    );
    return eds.length ? eds[eds.length - 1] : document.querySelector(".ProseMirror, .tiptap");
  }

  function applyTemplate(tpl, btn) {
    const vars = (settings && settings.variables) || [];
    if (tpl.title && tpl.title.length) {
      const ta = findTitleField(btn);
      if (ta) insertIntoInput(ta, expandVars(tpl.title, vars));
    }
    if (tpl.content && tpl.content.length) {
      const ed = findEditorFor(btn);
      if (ed) insertIntoEditor(ed, expandVars(tpl.content, vars));
    }
  }

  /* ================================================================== */
  /* 3. Visual element picker (started from the popup → clicked element → rule) */
  /* ================================================================== */
  let pickerActive = false;
  let pickerBox = null;
  let pickerHint = null;
  let pickerTarget = null;

  function cssEsc(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }
  function buildSelector(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el.id) return "#" + cssEsc(el.id);
    const tag = el.tagName.toLowerCase();
    const cls =
      el.className && typeof el.className === "string"
        ? el.className.trim().split(/\s+/).filter(Boolean)
        : [];
    if (cls.length) return tag + cls.slice(0, 6).map((c) => "." + cssEsc(c)).join("");
    // no class → build a short nth-of-type path
    const path = [];
    let node = el;
    for (let d = 0; node && node.nodeType === 1 && d < 4; d++) {
      let s = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (same.length > 1) s += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
      }
      path.unshift(s);
      node = parent;
    }
    return path.join(" > ");
  }

  // From the clicked element, build candidate selectors (individual class / full / id / path) with each match count
  // A value safe to put inside an attribute selector's quotes.
  function attrValue(v) {
    return '"' + String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }

  // The selectors this element could be addressed by, best first. peSortPickCandidates
  // decides the order and peLooksGenerated decides what gets flagged; both are in common.js
  // because ranking is a judgement that can be argued with in a test, and only the counting
  // needs a document.
  function buildCandidates(el) {
    const out = [];
    const seen = new Set();
    // Every class on the page, so peHashNamespaces can spot a prefix that is a build
    // artefact rather than a vocabulary. Done once per pick, which is a user gesture.
    let namespaces = null;
    try {
      const all = [];
      document.querySelectorAll("[class]").forEach((n) => {
        if (typeof n.className === "string") all.push(...n.className.split(/\s+/));
      });
      namespaces = peHashNamespaces(all.filter(Boolean));
    } catch (_) {
      namespaces = null; // a page we cannot survey is one we judge by pattern alone
    }
    const add = (sel, kind, token) => {
      if (!sel || seen.has(sel)) return;
      let count = 0;
      try {
        count = document.querySelectorAll(sel).length;
      } catch (_) {
        return;
      }
      out.push({ sel, count, kind, token, generated: peLooksGenerated(token, kind, namespaces) });
      seen.add(sel);
    };

    if (el.id) {
      add("#" + cssEsc(el.id), "id", el.id);
      // An id with a generated tail still has a usable head. This is not a clever extra: it
      // is what the shipped dropdown preset does by hand for headlessui's counter, and what
      // Plane's per-item `editor-container-{uuid}` needs to be addressable at all.
      const head = peLooksGenerated(el.id, "id", namespaces) ? pePickIdPrefix(el.id) : "";
      if (head) add("[id^=" + attrValue(head) + "]", "id-prefix", head);
    }

    // Attributes were missing entirely, which on a page whose classes are all hashes meant
    // the list held no stable option at all — the picker could not reach `[data-view-id]` or
    // `[aria-label="Issue description"]` however hard the user looked.
    for (const a of el.attributes || []) {
      const name = a.name;
      const kind = name === "aria-label" ? "label" : name === "role" ? "role" : name.indexOf("data-") === 0 ? "data" : "";
      if (!kind) continue;
      const val = String(a.value == null ? "" : a.value);
      // The value is part of the handle only when it is itself a handle. A uuid in
      // `data-view-id` is this element today and a different element tomorrow, so there the
      // useful selector is the attribute's presence.
      const useValue = val && val.length <= 40 && !peLooksGenerated(val, "data", namespaces);
      add("[" + name + (useValue ? "=" + attrValue(val) : "") + "]", kind, useValue ? name + "-" + val : name);
    }

    const tag = el.tagName.toLowerCase();
    const cls =
      el.className && typeof el.className === "string"
        ? el.className.trim().split(/\s+/).filter(Boolean)
        : [];
    cls.forEach((c) => add("." + cssEsc(c), "class", c));
    if (cls.length) add(tag + cls.slice(0, 6).map((c) => "." + cssEsc(c)).join(""), "tag+classes", cls[0]);
    add(buildSelector(el), "auto", "");
    return peSortPickCandidates(out).slice(0, 14);
  }

  function toast(msg) {
    const t = document.createElement("div");
    t.className = "pe-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => (t.style.opacity = "0"), 3200);
    setTimeout(() => t.remove(), 3600);
  }

  function startPicker() {
    if (pickerActive) return;
    pickerActive = true;
    pickerBox = document.createElement("div");
    pickerBox.id = "pe-picker-box";
    pickerHint = document.createElement("div");
    pickerHint.id = "pe-picker-hint";
    pickerHint.textContent = peMsg("pickerHint");
    document.body.appendChild(pickerBox);
    document.body.appendChild(pickerHint);
    document.addEventListener("mousemove", pickerMove, true);
    document.addEventListener("click", pickerClick, true);
    document.addEventListener("keydown", pickerKey, true);
    // Suppress press events with stopPropagation only (preventDefault would cancel the click
    // and break the picker). This blocks only Plane's mousedown/pointerdown handlers (navigation, etc.).
    document.addEventListener("mousedown", pickerSuppress, true);
    document.addEventListener("pointerdown", pickerSuppress, true);
  }
  function pickerSuppress(e) {
    e.stopPropagation();
  }
  function stopPicker() {
    pickerActive = false;
    document.removeEventListener("mousemove", pickerMove, true);
    document.removeEventListener("click", pickerClick, true);
    document.removeEventListener("keydown", pickerKey, true);
    document.removeEventListener("mousedown", pickerSuppress, true);
    document.removeEventListener("pointerdown", pickerSuppress, true);
    if (pickerBox) pickerBox.remove();
    if (pickerHint) pickerHint.remove();
    pickerBox = pickerHint = pickerTarget = null;
  }
  function pickerMove(e) {
    const el = e.target;
    if (!el || el === pickerBox || el === pickerHint) return;
    pickerTarget = el;
    const r = el.getBoundingClientRect();
    pickerBox.style.top = r.top + "px";
    pickerBox.style.left = r.left + "px";
    pickerBox.style.width = r.width + "px";
    pickerBox.style.height = r.height + "px";
  }
  function pickerKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      stopPicker();
    }
  }
  function pickerClick(e) {
    e.preventDefault();
    e.stopPropagation();
    const el = pickerTarget || e.target;
    const x = e.clientX;
    const y = e.clientY;
    stopPicker();
    const cands = buildCandidates(el);
    if (!cands.length) {
      toast(peMsg("pickNoSelector"));
      return;
    }
    showChooser(cands, x, y);
  }

  /* ---- selector chooser menu ---- */
  let chooserEl = null;
  let chooserOutside = null;
  let chooserKey = null;
  function closeChooser() {
    if (chooserEl) chooserEl.remove();
    chooserEl = null;
    if (chooserOutside) document.removeEventListener("mousedown", chooserOutside, true);
    if (chooserKey) document.removeEventListener("keydown", chooserKey, true);
    chooserOutside = chooserKey = null;
  }
  function showChooser(cands, x, y) {
    closeChooser();
    chooserEl = document.createElement("div");
    chooserEl.id = "pe-pick-menu";
    const h = document.createElement("div");
    h.className = "pe-pick-header";
    h.textContent = peMsg("pickHeader");
    chooserEl.appendChild(h);
    // What kind of handle each row is. buildCandidates has always known this and the list
    // never showed it, which left the ordering to speak for itself — and an order speaks to
    // nobody without something to compare against. These are the words that say why a row
    // is where it is.
    const KIND_LABEL = {
      id: peMsg("pickKindId"),
      "id-prefix": peMsg("pickKindIdPrefix"),
      data: peMsg("pickKindData"),
      label: peMsg("pickKindLabel"),
      role: peMsg("pickKindRole"),
      class: peMsg("pickKindClass"),
      "tag+classes": peMsg("pickKindTagClasses"),
      auto: peMsg("pickKindPath")
    };
    // Two groups under two headings — but a heading only separates when there are two of
    // them, and on ordinary Plane markup there are not. Measured on a body element carrying
    // nothing but Tailwind: four candidates, all durable, one heading, nothing to compare it
    // against. Both earlier attempts at saying "this one expires" (a dimmed row, then an
    // amber badge) were invisible for the same reason — they render only on a row that never
    // appeared. So the verdict goes on every row, where it has a neighbour to differ from.
    let group = null;
    cands.forEach((c) => {
      const want = c.generated ? "expiring" : "durable";
      if (group !== want) {
        group = want;
        const g = document.createElement("div");
        g.className = "pe-pick-group";
        // Two literal calls, not one with a ternary inside: check-i18n reads the key out of
        // the call site, and an expression there hides it from the contract.
        g.textContent = want === "durable" ? peMsg("pickGroupDurable") : peMsg("pickGroupExpiring");
        chooserEl.appendChild(g);
      }
      const it = document.createElement("button");
      it.type = "button";
      it.className = "pe-pick-item";
      const s = document.createElement("span");
      s.className = "pe-pick-sel";
      s.textContent = c.sel;
      const k = document.createElement("span");
      k.className = "pe-pick-kind";
      k.textContent = KIND_LABEL[c.kind] || "";
      const life = document.createElement("span");
      life.className = "pe-pick-life" + (c.generated ? " expiring" : " lasting");
      // Two literal calls again, for the same reason as the headings above: check-i18n reads
      // the key out of the call site, so a key inside an expression is a key nothing verifies.
      if (c.generated) life.textContent = peMsg("pickLifeChanges");
      else life.textContent = peMsg("pickLifeLasts");
      const n = document.createElement("span");
      n.className = "pe-pick-count";
      n.textContent = peMsg("pickMatches", [String(c.count)]);
      it.appendChild(s);
      it.appendChild(k);
      it.appendChild(life);
      it.appendChild(n);
      if (c.generated) it.classList.add("generated");
      it.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        addPickedRule(c.sel);
      });
      chooserEl.appendChild(it);
    });
    document.body.appendChild(chooserEl);
    const mw = Math.min(380, window.innerWidth - 16);
    let left = Math.min(x, window.innerWidth - mw - 8);
    if (left < 8) left = 8;
    let top = y + 10;
    const mh = chooserEl.offsetHeight;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, window.innerHeight - mh - 8);
    chooserEl.style.left = left + "px";
    chooserEl.style.top = top + "px";
    chooserEl.style.width = mw + "px";
    chooserOutside = (ev) => {
      if (chooserEl && !chooserEl.contains(ev.target)) closeChooser();
    };
    chooserKey = (ev) => {
      if (ev.key === "Escape") closeChooser();
    };
    setTimeout(() => {
      document.addEventListener("mousedown", chooserOutside, true);
      document.addEventListener("keydown", chooserKey, true);
    }, 0);
  }
  function addPickedRule(sel) {
    closeChooser();
    peGetSettings()
      .then((s) => {
        s.rules = s.rules || [];
        s.rules.push({
          id: "rule-picked-" + Math.random().toString(36).slice(2, 8),
          enabled: true,
          label: "Picked",
          selector: sel,
          property: "max-width",
          value: "" // empty value → the rule stays inactive until you set a value in Settings
        });
        return peSaveSettings(s);
      })
      .then(() => toast(peMsg("pickRuleAdded", [sel])))
      .catch(() => toast(peMsg("pickRuleFailed")));
  }

  /* ---- global events ---- */
  function onDocClick(e) {
    if (!menuOpen) return;
    if (
      (menu && menu.contains(e.target)) ||
      (e.target.closest && e.target.closest(".pe-body-tmpl-btn, .pe-copy-ref-btn"))
    )
      return;
    hideMenu();
  }
  // Is the user typing into an editable field? (a real input/textarea, or a
  // contenteditable surface like Plane's ProseMirror/tiptap body). Used to keep Alt+C
  // from stealing a keystroke that is actually text.
  function isEditingText() {
    const a = document.activeElement;
    if (!a) return false;
    const tag = a.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return true;
    return !!a.isContentEditable;
  }

  function onKeyDown(e) {
    if (e.key === "Escape" && menuOpen) {
      hideMenu();
      return;
    }
    if (!isActive() || pickerActive) return;
    // Alt+T (macOS: ⌥ Option+T): open the template menu for the description being edited.
    // On macOS, Option+T changes e.key (e.g. "†"), so detect it via the layout-independent e.code.
    if (e.altKey && (e.code === "KeyT" || e.key === "t" || e.key === "T")) {
      let btns = [...document.querySelectorAll(".pe-body-tmpl-btn")];
      if (!btns.length) {
        // self-heal: the toolbar may have mounted late — inject now and retry
        try {
          injectAll();
        } catch (_) {}
        btns = [...document.querySelectorAll(".pe-body-tmpl-btn")];
      }
      if (!btns.length) return;
      const a = document.activeElement;
      const focusedEd = a && a.closest ? a.closest(".ProseMirror, .tiptap") : null;
      let target = btns[0];
      if (focusedEd) {
        const m = btns.find((b) => findEditorFor(b) === focusedEd);
        if (m) target = m;
      }
      e.preventDefault();
      toggleMenu(target);
      return;
    }
    // Alt+C (macOS: ⌥ Option+C, which yields "ç" — hence e.code): open the copy list for
    // the work item being viewed.
    //
    // Bail while the user is typing. Unlike Alt+T — where you WANT the menu over the
    // description you are editing — copying a reference is never something you do mid-word,
    // and on macOS Option+C is the character "ç". Hijacking it (with preventDefault, in a
    // capture-phase handler) would eat that letter out of a French/Portuguese/Turkish title
    // or body. So only act when focus is not in an editable field.
    if (e.altKey && (e.code === "KeyC" || e.key === "c" || e.key === "C") && !isEditingText()) {
      let btn = document.querySelector(".pe-copy-ref-btn");
      if (!btn) {
        // self-heal: the header may have mounted late — inject now and retry
        try {
          injectAll();
        } catch (_) {}
        btn = document.querySelector(".pe-copy-ref-btn");
      }
      if (!btn) return;
      e.preventDefault();
      toggleMenu(btn, "copy");
    }
  }
  function onScrollResize() {
    if (menuOpen && menuOwnerBtn) positionMenu(menuOwnerBtn);
  }

  document.addEventListener("mousedown", onDocClick, true);
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("scroll", onScrollResize, true);
  window.addEventListener("resize", onScrollResize);
  // self-heal: focusing a description editor OR anything inside a dialog (e.g. the
  // create-work-item modal's title) re-triggers injection — catches late mounts.
  document.addEventListener(
    "focusin",
    (e) => {
      if (!isActive()) return;
      const t = e.target;
      if (t && t.closest && t.closest('.ProseMirror, .tiptap, [role="dialog"]')) scheduleInject();
    },
    true
  );
  // Reliable dynamic trigger: a click (e.g. opening the "Create work item" modal, or
  // navigating) kicks a short, bounded inject burst. This does not depend on the
  // MutationObserver, and only runs on real interaction so idle cost stays zero.
  document.addEventListener(
    "click",
    () => {
      if (!isActive()) return;
      kickInject();
      // A click is also the moment transient UI exists — see scheduleHitScan.
      scheduleHitScan();
    },
    true
  );

  /* ================================================================== */
  /* 4. Load settings + watch                                           */
  /* ================================================================== */
  // Observing the whole document subtree is costly, so connect only on active domains.
  // (the script is registered only on granted origins, but this stays defensive)
  // When a modal or editor is added to the DOM, inject right away with a short retry
  // burst — React mounts the "Create work item" modal in stages, so a single delayed
  // pass can miss it and leave a perceptible gap. Ordinary DOM churn keeps using the
  // lighter debounced path.
  const isRelevantNode = (n) => {
    if (!n || n.nodeType !== 1) return false;
    try {
      return (
        (n.matches && n.matches('[role="dialog"], .ProseMirror, .tiptap')) ||
        (n.querySelector && n.querySelector('[role="dialog"], .ProseMirror, .tiptap'))
      );
    } catch (_) {
      return false;
    }
  };
  let burstTimers = [];
  function burstInject() {
    // one-shot retries (no perpetual polling) so a late-mounting toolbar is caught
    // within ~1.2s; each injectAll is ~0.2ms and idle cost stays zero.
    burstTimers.forEach(clearTimeout);
    burstTimers = [0, 70, 160, 300, 500, 800, 1200].map((d) =>
      setTimeout(() => {
        try {
          injectAll();
        } catch (_) {}
      }, d)
    );
  }
  // Same idea, driven by user clicks (see the click listener). Bounded one-shot
  // retries so a modal that mounts a few hundred ms after the click is still caught.
  let kickTimers = [];
  function kickInject() {
    kickTimers.forEach(clearTimeout);
    kickTimers = [0, 200, 450, 800, 1200].map((d) =>
      setTimeout(() => {
        try {
          injectAll();
        } catch (_) {}
      }, d)
    );
  }
  const domObserver = new MutationObserver((mutations) => {
    let relevant = false;
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        if (isRelevantNode(n)) {
          relevant = true;
          break;
        }
      }
      if (relevant) break;
    }
    if (relevant) {
      // Inject immediately so a modal/editor is caught the moment it mounts (React
      // mounts in stages; a timer-only burst gets reset by each stage and only fires
      // its last retry). A short trailing burst then covers late layout.
      try {
        injectAll();
      } catch (_) {}
      burstInject();
    } else {
      scheduleInject();
    }
  });
  let observing = false;
  function syncObserver() {
    const want = isActive();
    if (want && !observing) {
      domObserver.observe(document.documentElement, { childList: true, subtree: true });
      observing = true;
    } else if (!want && observing) {
      domObserver.disconnect();
      observing = false;
    }
  }

  let bootstrapTimer = null;
  function refresh() {
    return Promise.all([peGetSettings(), peGetSyncCache()]).then(([s, c]) => {
      settings = s;
      syncCache = c;
      recountTemplates();
      // Read once per load, before the first applyStyles: on a settings change this
      // re-reads the same value, and nothing else in the browser writes that key.
      focusOn = readStoredFocus();
      // Editing a rule is the one moment the reader is owed a fresh answer about it, and
      // refresh() is what a settings change calls. Forget which route was counted so the
      // edited selector is measured again on the page already in front of them.
      healthUrl = null;
      applyFocusClass();
      applyStyles();
      announceFocusOnce();
      syncObserver();
      injectAll();
      if (bootstrapTimer) clearInterval(bootstrapTimer);
      if (!isActive()) return; // inactive site → don't run the retry polling either
      // retry for the first few seconds in case the toolbar mounts late (peek view, etc.)
      let ticks = 0;
      bootstrapTimer = setInterval(() => {
        ticks++;
        try {
          injectAll();
        } catch (_) {}
        if (ticks >= 16) {
          clearInterval(bootstrapTimer);
          bootstrapTimer = null;
        }
      }, 500);
    });
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (peSettingsChanged(changes, area)) {
        refresh();
      } else if (area === "local" && changes[PE_SYNC_CACHE_KEY]) {
        // Synced templates updated by the service worker → refresh cache, re-render an
        // open menu, and re-evaluate whether the toolbar button should exist.
        const nv = changes[PE_SYNC_CACHE_KEY].newValue;
        syncCache = { bySource: (nv && nv.bySource) || {} };
        recountTemplates();
        if (menuOpen && menu) renderMenu();
        try {
          injectAll();
        } catch (_) {}
      }
    });
  } catch (_) {}

  // messages from the popup (picker, re-scan, focus) and from the service worker, which is
  // where the keyboard command for focus mode arrives.
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === "pe-start-picker") {
        if (isActive()) startPicker();
        if (sendResponse) sendResponse({ ok: isActive() });
      } else if (msg && msg.type === "pe-focus-toggle") {
        // Only on a site the extension runs on: elsewhere there are no rules to apply, and
        // a toast about a mode that changed nothing would be a lie.
        const active = isActive();
        // The popup sends the position its switch is now in; the keyboard command sends
        // nothing and means "the other one".
        if (active) setFocus(typeof msg.on === "boolean" ? msg.on : !focusOn, true);
        if (sendResponse) sendResponse({ ok: active, active, focus: focusOn });
      } else if (msg && msg.type === "pe-focus-state") {
        if (sendResponse) sendResponse({ ok: true, active: isActive(), focus: focusOn });
      } else if (msg && msg.type === "pe-rescan") {
        // "Re-scan this page": force a fresh settings load + re-injection, then report status.
        refresh().then(() =>
          setTimeout(() => {
            if (sendResponse)
              sendResponse({
                ok: true,
                active: isActive(),
                buttons: document.querySelectorAll(".pe-body-tmpl-btn").length
              });
          }, 250)
        );
        return true; // keep the message channel open for the async response
      }
    });
  } catch (_) {}

  refresh();
})();
