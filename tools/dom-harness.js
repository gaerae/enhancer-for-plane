#!/usr/bin/env node
// dom-harness.js — drives options.html, popup.html, and content.js in a real browser.
// Run: node tools/dom-harness.js
//
// tools/test.js covers everything that is a function of data. The settings page and the
// popup are not: their behaviour is tabs showing and hiding, a label reading the way it
// reads, and a colour resolving against the surface behind it. Every one of those shipped
// broken at least once while all three other checks stayed green — a white row on a dark
// card, a toggle knob at 1.1:1, a group label that made a global switch look per-site.
// So this runs the pages for real and asserts what the layout engine actually computed.
//
// Zero dependencies, like the rest of tools/. No puppeteer, no CDP client: the page runs
// its own assertions and writes them into the DOM, and Chrome is asked to print the DOM
// once it has settled.
//   --dump-dom             print the serialized DOM after load
//   --virtual-time-budget  advance timers deterministically instead of sleeping, so a
//                          150ms CSS transition and an awaited settings read both finish
//                          before the dump, at no wall-clock cost and with no flake
// The pages are generated into a temp dir, never into the repo: nothing to clean up, and
// no chance of a harness file reaching the release zip. Most are the shipped HTML with the
// script srcs rewritten; the content-script suites get a synthetic work item page instead
// (see buildPlanePage), because content.js has no page of its own to load.
//
// Dark mode is forced by rewriting `@media (prefers-color-scheme: dark)` to `@media all`
// in a copy of the stylesheet. The declarations under test are the real ones, byte for
// byte — only the condition selecting them is neutralised, because a headless flag for
// prefers-color-scheme is not something to depend on. The complementary half, "a light
// background with no dark counterpart at all", is check-source.js's job.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "pe-dom-"));
const results = [];
let hardError = null;

/* ------------------------------------------------------------------ */
/* Chrome                                                              */
/* ------------------------------------------------------------------ */

function findChrome() {
  if (process.env.PE_CHROME) return process.env.PE_CHROME;
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser"
  ];
  for (const c of candidates) {
    try {
      if (c.startsWith("/")) {
        if (fs.existsSync(c)) return c;
      } else {
        // `command -v` rather than trusting a bare name to spawn later
        const found = execFileSync("sh", ["-c", `command -v ${c} || true`], { encoding: "utf8" }).trim();
        if (found) return found;
      }
    } catch (_) {
      /* keep looking */
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Page construction                                                   */
/* ------------------------------------------------------------------ */

const CATALOGUES = {
  en: fs.readFileSync(path.join(ROOT, "_locales/en/messages.json"), "utf8"),
  // Korean matters here beyond parity: its strings are longer and break differently, so a
  // header that fits in English can wrap in Korean and nobody sees it until a user does.
  ko: fs.readFileSync(path.join(ROOT, "_locales/ko/messages.json"), "utf8")
};
const fileUrl = (p) => "file://" + path.resolve(p).split(path.sep).join("/");

// A stylesheet copy with the dark blocks unconditionally applied.
function darkCss(name) {
  const src = fs.readFileSync(path.join(ROOT, name), "utf8");
  const out = path.join(OUT, "dark-" + name);
  fs.writeFileSync(out, src.replace(/@media \(prefers-color-scheme: dark\)/g, "@media all"));
  return out;
}

// The chrome API surface these pages actually touch — no more than that, so an
// implementation cannot pass here by calling something production does not have.
function stub(seed, lang) {
  return `<script>
const __CAT = ${CATALOGUES[lang] || CATALOGUES.en};
function __msg(key, subs) {
  const e = __CAT[key];
  if (!e) return "";
  let m = e.message || "";
  if (e.placeholders) {
    for (const [name, spec] of Object.entries(e.placeholders)) {
      const i = parseInt(String(spec.content).replace("$", ""), 10) - 1;
      const v = subs && subs[i] != null ? subs[i] : "";
      m = m.replace(new RegExp("\\\\$" + name + "\\\\$", "gi"), v);
    }
  }
  return m;
}
window.__SEED = ${JSON.stringify(seed)};
window.__opened = null;
window.__closed = false;
window.chrome = {
  i18n: { getMessage: (k, s) => __msg(k, s), getUILanguage: () => "${lang || "en"}" },
  storage: {
    sync: {
      get: (k, cb) => cb(JSON.parse(JSON.stringify(window.__SEED))),
      set: (o, cb) => cb && cb(),
      remove: (k, cb) => cb && cb()
    },
    local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() },
    onChanged: { addListener: (f) => { window.__onChanged = f; } }
  },
  runtime: {
    lastError: null,
    getManifest: () => ({ version: "test", action: {} }),
    openOptionsPage: () => {},
    sendMessage: () => {},
    // Captured, not discarded: this is how the popup and the keyboard command reach the
    // content script, so a page that hosts content.js has to be able to knock on it.
    onMessage: { addListener: (f) => { window.__onMessage = f; } }
  },
  permissions: {
    contains: (o, cb) => (cb ? cb(true) : Promise.resolve(true)),
    request: (o, cb) => cb && cb(true),
    getAll: (cb) => cb({ origins: [] }),
    onAdded: { addListener: () => {} },
    onRemoved: { addListener: () => {} }
  },
  tabs: {
    query: (o, cb) => cb([{ id: 1, url: "https://plane.example.com/acme/browse/PROJ-7" }]),
    create: (o) => { window.__opened = o.url; },
    update: () => {},
    sendMessage: () => {}
  },
  action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {}, setTitle: () => {} }
};
window.close = () => { window.__closed = true; };
</script>`;
}

// Helpers every assertion body can use, plus the reporting contract: results land in
// #pe-results as JSON. A thrown assertion becomes a failure with its message, and an
// uncaught load-time error becomes a failure too — the one outcome that must never look
// like success is "nothing ran".
const PREAMBLE = `
const __out = [];
window.addEventListener("error", (e) => __out.push({ name: "uncaught page error", pass: false, detail: String(e.message) }));
const check = (name, fn) => { try { const d = fn(); __out.push({ name, pass: true, detail: d === undefined ? "" : String(d) }); } catch (e) { __out.push({ name, pass: false, detail: String(e && e.message || e) }); } };
const eq = (a, b, what) => { if (String(a) !== String(b)) throw new Error((what || "value") + ": " + JSON.stringify(a) + " !== " + JSON.stringify(b)); return a; };
const ok = (c, what) => { if (!c) throw new Error(what || "expected true"); return true; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (cond, label) => {
  for (let i = 0; i < 100; i++) { if (cond()) return true; await sleep(20); }
  throw new Error("timed out waiting for " + (label || "condition"));
};
const rgb = (s) => (String(s).match(/\\d+/g) || []).slice(0, 3).map(Number);
const lum = (c) => { const a = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; };
const contrast = (x, y) => { const l1 = lum(rgb(x)), l2 = lum(rgb(y)); const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05); };
const bg = (sel) => getComputedStyle(typeof sel === "string" ? document.querySelector(sel) : sel).backgroundColor;
const report = () => { const el = document.createElement("pre"); el.id = "pe-results"; el.textContent = JSON.stringify(__out); document.body.appendChild(el); };
`;

function buildPage({ name, html, css, js, seed, dark, lang, body }) {
  let src = fs.readFileSync(path.join(ROOT, html), "utf8");
  const cssPath = dark ? darkCss(css) : path.join(ROOT, css);
  src = src.replace(new RegExp(`href="${css}"`), `href="${fileUrl(cssPath)}"`);
  for (const f of ["common.js", js]) {
    src = src.replace(new RegExp(`src="${f}"`), `src="${fileUrl(path.join(ROOT, f))}"`);
  }
  // The stub has to define `chrome` before the page's own scripts run.
  src = src.replace(/<script src="file:[^"]*common\.js"><\/script>/, stub(seed, lang) + "\n" + `<script src="${fileUrl(path.join(ROOT, "common.js"))}"></script>`);
  // Transitions off. Virtual time advances timers but not the compositor clock that drives
  // a CSS transition, so a colour read after a toggle came back mid-interpolation — the
  // toggle knob measured 1.1:1 here while a real browser settled at 9.5:1. Asserting the
  // final computed value is both what matters and the only thing that can be deterministic.
  src = src.replace(
    "</head>",
    "<style>*, *::before, *::after { transition: none !important; animation: none !important; }</style>\n</head>"
  );
  src = src.replace(
    "</body>",
    `<script>\n${PREAMBLE}\n(async () => {\ntry {\n${body}\n} catch (e) { __out.push({ name: "harness", pass: false, detail: String(e && e.message || e) }); }\nreport();\n})();\n</script>\n</body>`
  );
  const out = path.join(OUT, name + ".html");
  fs.writeFileSync(out, src);
  return out;
}

// A stand-in for a work item page, for the assertions that are content.js's own. It is not a
// mock of Plane: the markup carries exactly the classes and the id that the shipped presets
// select on, so if an escape is wrong or a selector drifts, the panel simply does not hide —
// which is the whole feature failing in the one way no data test can see.
//
// Everything is one page rather than several: `settings` is loaded asynchronously, and while
// it is null the content script reports "not active" for the same reason it does on a site
// the user never enabled. A suite that opened on an inactive site could not tell those apart,
// so the negative case is asserted here, after the positive one has proved settings arrived.
function buildPlanePage({ name, seed, lang, plane, body }) {
  const src =
    `<!doctype html>\n<html lang="en"><head><meta charset="utf-8" />\n` +
    `<link rel="stylesheet" href="${fileUrl(path.join(ROOT, "content.css"))}" />\n` +
    `<style>*, *::before, *::after { transition: none !important; animation: none !important; }</style>\n` +
    `</head><body>\n${plane}\n${stub(seed, lang)}\n` +
    `<script src="${fileUrl(path.join(ROOT, "common.js"))}"></script>\n` +
    `<script src="${fileUrl(path.join(ROOT, "content.js"))}"></script>\n` +
    `<script>\n${PREAMBLE}\n(async () => {\ntry {\n${body}\n} catch (e) { __out.push({ name: "harness", pass: false, detail: String(e && e.message || e) }); }\nreport();\n})();\n</script>\n` +
    `</body></html>\n`;
  const out = path.join(OUT, name + ".html");
  fs.writeFileSync(out, src);
  return out;
}

// How long one Chrome launch may take before it counts as hung, not slow.
const LAUNCH_TIMEOUT_MS = 30000;
let launch = 0;
function run(chrome, page, hash) {
  const url = fileUrl(page) + (hash || "");
  let dom = "";
  try {
    dom = execFileSync(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        // No --user-data-dir by default. Measured on macOS, pointing Chrome at a brand new
        // profile directory never finishes initialising it in headless mode — every launch
        // hung until the timeout below, with no output. Without the flag it dumps in ~3s.
        // PE_CHROME_PROFILE is there for an environment that needs the isolation instead.
        ...(process.env.PE_CHROME_PROFILE ? [`--user-data-dir=${process.env.PE_CHROME_PROFILE}-${++launch}`] : []),
        "--dump-dom",
        // Virtual time: timers fire as fast as the page allows, deterministically.
        "--virtual-time-budget=5000",
        url
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 64 * 1024 * 1024,
        // A browser that never exits would otherwise stall the run with no output at all —
        // the failure mode that looks exactly like a pass. A good launch takes about three
        // seconds, so anything past thirty is broken, not slow: kill it and report it.
        timeout: LAUNCH_TIMEOUT_MS
      }
    );
  } catch (e) {
    // The message reads the constant rather than restating it: it said 60s while the timeout
    // was 30s, which sends whoever hits it looking for a hang twice as long as the real one.
    const why = e && e.killed ? `timed out after ${LAUNCH_TIMEOUT_MS / 1000}s` : String(e.message).slice(0, 200);
    return [{ name: `${path.basename(page)} — chrome failed to run`, pass: false, detail: why }];
  }
  const m = dom.match(/<pre id="pe-results">([\s\S]*?)<\/pre>/);
  if (!m) {
    return [{ name: `${path.basename(page)} — no results`, pass: false, detail: "the page never reported; it probably threw before reporting" }];
  }
  const decoded = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'");
  try {
    const parsed = JSON.parse(decoded);
    if (!Array.isArray(parsed) || !parsed.length) {
      return [{ name: `${path.basename(page)} — empty result set`, pass: false, detail: "reported nothing, which is not a pass" }];
    }
    return parsed;
  } catch (e) {
    return [{ name: `${path.basename(page)} — unreadable results`, pass: false, detail: decoded.slice(0, 200) }];
  }
}

/* ------------------------------------------------------------------ */
/* Seeds                                                              */
/* ------------------------------------------------------------------ */

const QUICK = [
  { id: "qlk-plane", name: "Plane", prefix: "", url: "https://plane.example.com/acme/browse/{{key}}", enabled: true },
  { id: "qlk-linear", name: "Linear", prefix: "ENG-", url: "https://linear.app/acme/issue/{{key}}", enabled: true }
];
const settings = (over) =>
  Object.assign(
    {
      // A current install, so a suite sees the rules it seeded and nothing else. The
      // migration that appends the focus presets to an older one is its own suite below.
      schema: 7,
      enabled: true,
      allDomains: false,
      domains: ["plane.example.com"],
      rules: [{ id: "r1", enabled: true, label: "Module name", selector: ".max-w-40", property: "max-width", value: "320px" }],
      templates: [{ id: "t1", name: "Bug", title: "[Bug] ", content: "## Steps\n1. \n" }],
      variables: [{ name: "team", value: "Platform" }],
      copyFormats: [{ id: "c1", name: "Chat", format: "{{item.key}} {{item.url}}" }],
      quickLinks: QUICK,
      templateSync: { enabled: false, sources: [] }
    },
    over || {}
  );
const seedOf = (over) => ({ peSettings: settings(over) });

const OPTIONS = { html: "options.html", css: "options.css", js: "options.js" };
const POPUP = { html: "popup.html", css: "popup.css", js: "popup.js" };

// The classes and the id are copied from Plane 1.4's own markup — the properties panel is a
// flex sibling of the description column, the left navigation carries an id. The widths are
// here so a hidden panel has something to give its space back to.
const PLANE = `
<div class="flex h-full w-full overflow-hidden" style="width: 1200px">
  <div class="h-full w-full space-y-6 overflow-y-auto px-9 py-5" id="probe-body">description</div>
  <div class="fixed right-0 z-[5] h-full w-full min-w-[300px] border-l border-subtle bg-surface-1 sm:w-1/2 md:relative md:w-1/4" id="probe-props">properties</div>
</div>
<div id="main-sidebar" class="z-20 h-full border-r border-subtle">navigation</div>
<div class="max-w-40" id="probe-width">a module name long enough to be truncated</div>
<div id="probe-header">
  <!-- An item with a parent, which is where the buttons were landing on the wrong key. Plane
       renders both keys from one component: the parent's inside a link to the parent and inert,
       this item's on its own and click-to-copy. The parent comes first in document order. -->
  <div class="mb-5 flex w-min items-center gap-3 rounded-md border">
    <a href="/acme/browse/PROJ-100"><button type="button" disabled>PROJ-100</button></a>
  </div>
  <button type="button">PROJ-142</button>
  <textarea id="title-input">A work item</textarea>
</div>`;

/* ------------------------------------------------------------------ */
/* Suites                                                             */
/* ------------------------------------------------------------------ */

const TAB_READY = `await waitFor(() => document.querySelector('.tab[aria-selected="true"]'), "the tabs to initialise");
const sel = () => document.querySelector('.tab[aria-selected="true"]').dataset.tab;
const shown = () => [...document.querySelectorAll(".panel")].filter((p) => !p.hidden).map((p) => p.dataset.tab);`;

// Where a line actually broke, as the layout engine decided it — a Range around one
// character at a time, watching for the top edge to jump. If the last character of one line
// and the first of the next are both Hangul syllables, the break landed inside a word,
// because a break at a space would have left a space on one side of it.
const KO_BREAKS = `
const isHangul = (ch) => /[\\uAC00-\\uD7A3]/.test(ch);
const midWordBreaks = (root) => {
  const bad = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let node;
  while ((node = walk.nextNode())) {
    // Per text node, not across them. Two separate elements that land on different lines are
    // adjacent in this walk with only collapsed whitespace between them, and reading that as
    // a wrapped word reported "용|이" for a label ending in 사용 above one starting with 이슈.
    // A word split by wrapping is always inside one text node, so that is the only place to
    // look — the popup, where every string is its own element, is nothing but such pairs.
    let prev = null;
    const text = node.nodeValue;
    for (let i = 0; i < text.length; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      // A newline the copy asked for is a break at a sentence end, not a wrapped word — and
      // it must clear the previous character, or the one before it and the one after read as
      // one word split in half. That is a real false positive: a Korean sentence ending in a
      // syllable, followed by one starting with a syllable, reported "다|다".
      if (text[i] === "\\n") {
        prev = null;
        continue;
      }
      const rect = range.getBoundingClientRect();
      if (!rect.height) continue; // collapsed whitespace has no box to place
      const cur = { ch: text[i], top: Math.round(rect.top) };
      if (prev && cur.top > prev.top + 2 && isHangul(prev.ch) && isHangul(cur.ch)) {
        bad.push(prev.ch + "|" + cur.ch);
      }
      prev = cur;
    }
  }
  return bad;
};`;

const suites = [
  {
    name: "options · tabs",
    page: { name: "opt-tabs", ...OPTIONS, seed: seedOf() },
    body: `
      ${TAB_READY}
      check("opens on the first tab when a site is configured", () => { eq(sel(), "items"); eq(location.hash, "#items"); });
      check("exactly one panel is visible", () => eq(shown().length, 1));
      check("all ten cards are inside a panel", () => {
        const inPanels = [...document.querySelectorAll(".panel section.card")].length;
        eq(document.querySelectorAll("section.card").length, inPanels, "cards in panels");
        eq(inPanels, 10, "card count");
      });
      check("each tab holds the sections it says it does", () => {
        const count = (t) => document.querySelectorAll("#panel-" + t + " section.card").length;
        eq(
          [count("templates"), count("items"), count("appearance"), count("sites"), count("backup"), count("keys")].join(","),
          "3,2,2,1,1,1"
        );
      });
      check("clicking a tab switches the panel and the hash", () => {
        document.getElementById("tab-items").click();
        eq(sel(), "items"); eq(shown().join(), "items"); eq(location.hash, "#items");
      });
      check("an unsaved edit survives a tab switch", () => {
        const url = document.querySelector("#quickList .qlk-url");
        url.value = "https://jira.acme.com/browse/";
        url.dispatchEvent(new Event("input", { bubbles: true }));
        const preview = document.querySelector("#quickList .qlk-preview").textContent;
        document.getElementById("tab-backup").click();
        document.getElementById("tab-items").click();
        eq(document.querySelector("#quickList .qlk-url").value, "https://jira.acme.com/browse/", "value");
        eq(document.querySelector("#quickList .qlk-preview").textContent, preview, "preview");
      });
      check("the preview shows a key appended when the url has no token", () => {
        ok(/jira\\.acme\\.com\\/browse\\/PROJ-123$/.test(document.querySelector("#quickList .qlk-preview").textContent));
      });
      // Read the expected order out of the DOM rather than naming the tabs: the point is
      // that arrowing follows what the user sees, and hardcoded names would keep passing
      // after someone reorders the buttons without reordering options.js's PE_TABS.
      check("arrow keys and Home/End follow the visible order", () => {
        const nav = document.getElementById("tabs");
        const order = [...nav.querySelectorAll(".tab")].map((t) => t.dataset.tab);
        const key = (k) => nav.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
        document.getElementById("tab-" + order[0]).click();
        key("ArrowRight"); eq(sel(), order[1], "ArrowRight goes to the next button");
        key("ArrowLeft"); eq(sel(), order[0], "ArrowLeft comes back");
        key("End"); eq(sel(), order[order.length - 1], "End is the last button");
        key("Home"); eq(sel(), order[0], "Home is the first button");
        eq(document.activeElement.dataset.tab, order[0], "focus follows the selection");
        return order.join(" → ");
      });
      check("only the selected tab is in the tab order", () => {
        const on = [...document.querySelectorAll(".tab")].filter((t) => t.tabIndex === 0);
        eq(on.length, 1); eq(on[0].dataset.tab, sel());
      });
      check("switching tabs does not push history entries", () => {
        const before = history.length;
        for (const t of ["items", "appearance", "sites", "backup"]) document.getElementById("tab-" + t).click();
        eq(history.length, before, "history.length");
      });
      `
  },
  {
    // Its own page on purpose. The handler that adopts a foreign change bails out when the
    // form has unsaved edits — correctly — so running this after an editing assertion would
    // test that bail-out instead of the tab switch, and pass for the wrong reason.
    name: "options · picker",
    page: { name: "opt-picker", ...OPTIONS, seed: seedOf() },
    body: `
      ${TAB_READY}
      // What matters is that it does NOT start on Appearance, or the switch below would be
      // a no-op that passes. Which tab it does start on is the landing-tab decision, tested
      // in "options · tabs" — assert the property this case depends on, not the name.
      check("starts somewhere other than the rules tab, with one rule", () => {
        eq(document.querySelector("#tabs .tab").dataset.tab, sel(), "opens on the first tab");
        ok(sel() !== "appearance", "not already on Appearance");
        eq(document.querySelectorAll("#ruleList .rule-item").length, 1);
      });
      const grown = JSON.parse(JSON.stringify(window.__SEED));
      grown.peSettings.rules.push({ id: "r2", enabled: true, label: "", selector: ".x", property: "max-width", value: "" });
      window.__SEED = grown;
      window.__onChanged({ peSettings: { newValue: grown.peSettings } }, "sync");
      await waitFor(() => document.querySelectorAll("#ruleList .rule-item").length === 2, "the new rule to arrive");
      check("a rule arriving from the picker reveals the tab holding it", () => eq(sel(), "appearance"));
      check("…and the message points at something now visible", () => {
        ok(!document.getElementById("panel-appearance").hidden, "the rules panel is shown");
        eq(document.querySelectorAll("#ruleList .rule-item").length, 2, "rule rows");
      });`
  },
  {
    // The shortcuts tab is reference material, so what it has to get right is being complete
    // and being readable — every shortcut the extension answers to, and both platforms.
    name: "options · shortcuts",
    page: { name: "opt-keys", ...OPTIONS, seed: seedOf() },
    body: `
      ${TAB_READY}
      check("it is the last tab, and it is reachable", () => {
        const tabs = [...document.querySelectorAll("#tabs .tab")].map((t) => t.dataset.tab);
        eq(tabs[tabs.length - 1], "keys", "order: " + tabs.join(" > "));
        document.getElementById("tab-keys").click();
        eq(sel(), "keys");
        eq(shown().join(), "keys", "one panel, and it is this one");
      });
      const rows = () => [...document.querySelectorAll("#panel-keys .keys tbody tr")];
      check("every shortcut the extension answers to is listed", () => {
        const keys = rows().map((r) => [...r.querySelectorAll("td")].slice(1, 3).map((td) => td.textContent.replace(/\\s+/g, " ").trim()));
        eq(rows().length, 4, "rows");
        const win = keys.map((k) => k[0]).join(" | ");
        for (const combo of ["Alt+T", "Alt+C", "Alt+Shift+F", "issue"]) ok(win.indexOf(combo) > -1, combo + " missing from: " + win);
      });
      check("each row gives the macOS keys too, and neither column wraps", () => {
        for (const r of rows()) {
          const cells = [...r.querySelectorAll("td")];
          const mac = cells[2].textContent.replace(/\\s+/g, " ").trim();
          ok(mac.length > 0, "no macOS column in row: " + cells[0].textContent);
          for (const i of [1, 2]) eq(getComputedStyle(cells[i]).whiteSpace, "nowrap", "column " + i + " may not wrap a key");
        }
        return rows().map((r) => r.querySelectorAll("td")[2].textContent.trim()).join(" | ");
      });
      check("the ⌥ rows say Option, not Alt, and the modifier order matches", () => {
        const mac = rows().map((r) => r.querySelectorAll("td")[2].textContent.replace(/\\s+/g, "").trim());
        ok(mac.indexOf("⌥+T") > -1, "template row: " + mac.join(" | "));
        ok(mac.indexOf("⌥+⇧+F") > -1, "focus row: " + mac.join(" | "));
        ok(mac.join("").indexOf("Alt") === -1, "an Alt leaked into the macOS column");
      });
      check("it says which of them can be rebound", () => {
        const t = document.getElementById("panel-keys").textContent;
        ok(t.indexOf("chrome://extensions/shortcuts") > -1, "the rebinding address");
      });
      // Four columns, one of them a sentence: on a narrow window the table has to scroll
      // inside its own box rather than making the whole page scroll sideways.
      check("a narrow window scrolls the table, not the page", () => {
        const wrap = document.querySelector(".wrap");
        wrap.style.maxWidth = "360px";
        const doc = document.documentElement;
        ok(doc.scrollWidth <= window.innerWidth + 1, "page scrolls sideways: " + doc.scrollWidth + " > " + window.innerWidth);
        const box = document.querySelector(".keys-scroll");
        eq(getComputedStyle(box).overflowX, "auto", "the table's own box scrolls");
        wrap.style.maxWidth = "";
      });`
  },
  {
    // Seeded as a pre-focus install, so the v6 → v7 migration runs for real and the presets
    // arrive through the same path a user's upgrade takes. tools/test.js proves the append;
    // only a browser can say the rows render, the switches land the right way round, and the
    // escaped selectors are ones a stylesheet can actually use.
    name: "options · focus rules",
    page: { name: "opt-focus", ...OPTIONS, seed: seedOf({ schema: 6 }) },
    body: `
      ${TAB_READY}
      document.getElementById("tab-appearance").click();
      const rows = () => [...document.querySelectorAll("#ruleList .rule-item")];
      const rowFor = (id) => rows()[peFocusPresetRules().findIndex((r) => r.id === id) + 1];
      check("an upgraded install shows its own rule first, then the presets", () => {
        eq(rows().length, 1 + peFocusPresetRules().length, "row count");
        eq(rows()[0].querySelector(".rule-label").value, "Module name", "the user's rule kept its place");
      });
      check("only the presets are marked focus-only", () => {
        const marked = rows().map((r) => r.querySelector(".rule-focus").checked);
        eq(marked.join(), "false,true,true,true");
      });
      check("the reading-width preset is present but switched off", () => {
        const row = rowFor("rule-focus-reading-width");
        eq(row.querySelector(".rule-focus").checked, true, "focus-only");
        eq(row.querySelector(".rule-enabled").checked, false, "and off until asked for");
      });
      check("the focus card sits above the rules and names the shortcut", () => {
        const cards = [...document.querySelectorAll("#panel-appearance section.card h2")].map((h) => h.textContent);
        eq(cards.length, 2, "two cards");
        eq(cards[0], peMsg("optFocusTitle"), "focus first — it is what the checkbox on every rule below refers to");
        eq(cards[1], peMsg("optRulesTitle"), "then the rules");
        // textContent, not innerHTML: the keys are marked up one <kbd> at a time, so the
        // chord only reads as a chord once the tags are out of the way.
        const text = document.getElementById("panel-appearance").textContent;
        ok(text.indexOf("Alt+Shift+F") > -1, "the shortcut is written down somewhere the user will look");
        ok(text.indexOf("⌥+⇧+F") > -1, "with the macOS keys beside it");
        ok(text.indexOf("chrome://extensions/shortcuts") > -1, "and so is the way to change it");
        ok(document.querySelectorAll("#panel-appearance kbd").length >= 6, "and they are marked up as keys");
      });
      // The one thing no data test can check: whether a class Plane writes as
      // min-w-[300px] is matched by the escaping we ship for it.
      check("every preset selector is one the browser can read", () => {
        peFocusPresetRules().forEach((r) => document.querySelector(r.selector));
        const probe = document.createElement("div");
        probe.className = "fixed right-0 z-[5] h-full w-full min-w-[300px] border-l border-subtle";
        document.body.appendChild(probe);
        const sel = peFocusPresetRules().find((r) => r.id === "rule-focus-item-properties").selector;
        eq(document.querySelectorAll(sel).length, 1, "the properties panel selector matches exactly one probe");
        ok(document.querySelector(sel) === probe, "and it is the element carrying Plane's classes");
        probe.remove();
      });
      // padding-inline carries a max() with a percentage in it. An invalid value is not an
      // error anywhere — the declaration is simply dropped and the column stays full width,
      // which looks like a rule that did not apply rather than one that was malformed.
      // A percentage inside it resolves against the containing block, not the element — which
      // is why the probe is nested. In Plane the column is the flex child filling that block,
      // so the two are the same width there; measuring the element alone (its own width set,
      // no sized parent) reported the floor and would have passed on a broken value too.
      check("the reading-width value is arithmetic the engine accepts", () => {
        const outer = document.createElement("div");
        const box = document.createElement("div");
        outer.appendChild(box);
        document.body.appendChild(outer);
        box.style.paddingInline = peFocusPresetRules().find((r) => r.id === "rule-focus-reading-width").value;
        outer.style.width = "1200px";
        eq(getComputedStyle(box).paddingLeft, "120px", "(1200 - 960) / 2");
        outer.style.width = "800px";
        eq(getComputedStyle(box).paddingLeft, "36px", "never below the 2.25rem Plane already applies");
        outer.remove();
      });
      // Ticking the box has to reach storage, not just the row: the checkbox writes into
      // state, and Save is what turns state into what the content script reads.
      const written = [];
      chrome.storage.sync.set = (o, cb) => { written.push(JSON.parse(JSON.stringify(o))); if (cb) cb(); };
      const mine = rows()[0].querySelector(".rule-focus");
      mine.checked = true;
      mine.dispatchEvent(new Event("change", { bubbles: true }));
      document.getElementById("save").click();
      await waitFor(() => written.length, "the save to write something");
      check("the checkbox reaches storage, so the page and the rules agree", () => {
        const core = written.map((o) => o.peSettings).filter(Boolean).pop();
        ok(core, "the core item was written");
        eq(core.rules[0].focus, true, "the rule the user marked");
        eq(core.rules[0].id, "r1", "and it is the right rule");
      });`
  },
  {
    // Its own page: the assertion needs a clean form, and it ends by replacing every value.
    name: "options · import",
    page: { name: "opt-import", ...OPTIONS, seed: seedOf() },
    body: `
      ${TAB_READY}
      document.getElementById("tab-backup").click();
      check("Import starts from the Backup tab", () => eq(sel(), "backup"));
      // Drive the FileReader the way the browser would, rather than reaching into options.js:
      // a real <input type=file> cannot be populated from script, so the change handler gets a
      // File built here. Everything after that is the production path.
      // The real export shape: { _app, settings }. A bare settings object is rejected by
      // design ("not exported by this extension"), so it would not exercise the success path.
      const file = new File([JSON.stringify({
        _app: "enhancer-for-plane",
        settings: {
          schema: 6, enabled: true, allDomains: false, domains: ["imported.example.com"],
          rules: [], templates: [], variables: [], copyFormats: [], quickLinks: [],
          templateSync: { enabled: false, sources: [] }
        }
      })], "backup.json", { type: "application/json" });
      const input = document.getElementById("importFile");
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await waitFor(() => document.getElementById("domains").value.indexOf("imported.example.com") !== -1,
                    "the imported settings to land in the form");
      check("the import reports success rather than a rejection", () => {
        eq(document.getElementById("status").textContent, "Imported — review, then click Save to apply.");
      });
      check("a finished import leaves the user somewhere they can review it", () => {
        // "Imported — review, then click Save to apply" used to be flashed while the user sat
        // on Backup, which shows none of what the import just replaced.
        ok(sel() !== "backup", "still on Backup, where none of the imported settings are shown");
        eq(sel(), document.querySelector("#tabs .tab").dataset.tab, "landed on the first tab");
        ok(!document.getElementById("panel-" + sel()).hidden, "that panel is visible");
        return sel();
      });`
  },
  {
    name: "options · unknown hash",
    page: { name: "opt-hash", ...OPTIONS, seed: seedOf() },
    hash: "#not-a-tab",
    body: `
      ${TAB_READY}
      check("an unknown hash falls back to a real tab", () => eq(sel(), "items"));
      check("…and rewrites itself so the address matches the page", () => eq(location.hash, "#items"));`
  },
  {
    // Both of these are order, and only order — nothing breaks if a card or a link moves,
    // so nothing would tell us it moved. The order is the decision: Quick open leads the
    // Work items tab because it is the one feature there that needs no host permission
    // and works on Jira and Linear too, and "Rate it" is last because a rating is what
    // you ask for after the links that help someone.
    name: "options · reading order",
    page: { name: "opt-order", ...OPTIONS, seed: seedOf() },
    body: `
      ${TAB_READY}
      // Tab order now lives in three places — the nav buttons, the panel divs, and
      // options.js's PE_TABS — and only the buttons are visible. If the panels disagree,
      // Tab moves through the page in an order that does not match what is on screen; if
      // PE_TABS disagrees, the arrow keys and the landing tab do. Neither shows up as a
      // broken page, so read all three back against each other.
      check("the tab strip, the panels and PE_TABS are in one order", () => {
        const buttons = [...document.querySelectorAll("#tabs .tab")].map((t) => t.dataset.tab);
        const panels = [...document.querySelectorAll(".panel")].map((p) => p.dataset.tab);
        eq(panels.join(","), buttons.join(","), "panel order matches the tab strip");
        // PE_TABS is module-private, so infer it from what it drives: an unknown hash lands
        // on PE_TABS[0], and Home/End walk PE_TABS from either end.
        const nav = document.getElementById("tabs");
        const key = (k) => nav.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
        document.getElementById("tab-" + buttons[0]).click();
        key("End"); eq(sel(), buttons[buttons.length - 1], "End lands on the last button");
        key("Home"); eq(sel(), buttons[0], "Home lands on the first button");
        return buttons.join(" → ");
      });
      check("Work items is the first tab", () => {
        eq(document.querySelector("#tabs .tab").dataset.tab, "items");
      });
      // The descriptions carry a newline at every sentence end; only the stylesheet decides
      // whether that is a line break or a space, and the difference is invisible in the source.
      // So measure it: the characters either side of a newline have to land on different lines.
      check("each sentence of a description starts its own line", () => {
        const measured = [];
        for (const el of document.querySelectorAll(".panel:not([hidden]) .desc, #panel-items .desc")) {
          eq(getComputedStyle(el).whiteSpace, "pre-line", "a description that would swallow the break");
          const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          const range = document.createRange();
          let node;
          while ((node = walk.nextNode())) {
            const text = node.nodeValue;
            const at = text.indexOf("\\n");
            if (at < 1 || at + 1 >= text.length) continue;
            const topOf = (i) => {
              range.setStart(node, i);
              range.setEnd(node, i + 1);
              return Math.round(range.getBoundingClientRect().top);
            };
            const before = topOf(at - 1);
            const after = topOf(at + 1);
            ok(after > before, "the sentence after a break stayed on the same line");
            measured.push(text.slice(Math.max(0, at - 12), at).trim() + "⏎" + text.slice(at + 1, at + 13).trim());
          }
        }
        ok(measured.length > 0, "no description on this tab carries a sentence break to measure");
        return measured.length + " breaks, e.g. " + measured[0];
      });
      // The tagline names the features, so every release wants to add a word to it. It was
      // shortened once already for wrapping to three lines and pushing the tab strip down;
      // two is the budget, and this is what makes the next addition trade rather than grow.
      check("the tagline still fits in two lines", () => {
        const el = document.querySelector(".brand p");
        const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.5;
        const lines = Math.round(el.getBoundingClientRect().height / lh);
        ok(lines <= 2, lines + " lines — trade a feature out of it rather than adding one more");
        return lines + " lines";
      });
      check("Work items opens with Quick open above Copy reference", () => {
        document.getElementById("tab-items").click();
        const cards = [...document.querySelectorAll("#panel-items section.card")];
        const at = (id) => cards.findIndex((c) => c.querySelector("#" + id));
        const quick = at("quickList");
        const copy = at("copyList");
        ok(quick >= 0 && copy >= 0, "both cards are in the panel");
        ok(quick < copy, "Quick open is at " + quick + ", Copy reference at " + copy);
        return "quick " + quick + " · copy " + copy;
      });
      check("the header links read GitHub → feedback → rating", () => {
        const labels = [...document.querySelectorAll(".about .about-link")]
          .map((a) => a.textContent.trim());
        eq(labels.join(" · "), "GitHub · Send feedback · Rate it");
        return labels.join(" · ");
      });`
  },
  {
    name: "options · first run",
    page: { name: "opt-fresh", ...OPTIONS, seed: seedOf({ domains: [], quickLinks: [], rules: [], templates: [], variables: [], copyFormats: [] }) },
    body: `
      ${TAB_READY}
      check("a profile with nowhere to run opens on Sites", () => { eq(sel(), "sites"); eq(location.hash, "#sites"); });
      check("the domain box is the visible one", () => ok(!document.getElementById("panel-sites").hidden));`
  },
  {
    // Korean, at full desktop width. The header is a flex row and the toggle had nothing
    // stopping it from being squeezed, so "확장 프로그램 사용" wrapped onto a second line
    // beside a brand block that was free to take the space.
    name: "options · korean header",
    page: { name: "opt-ko", ...OPTIONS, seed: seedOf(), lang: "ko" },
    body: `
      ${TAB_READY}
      check("the interface is in Korean", () => {
        eq(document.querySelector(".master-label").textContent, "확장 프로그램 사용");
      });
      check("the master switch label stays on one line", () => {
        const el = document.querySelector(".master-label");
        const oneLine = parseFloat(getComputedStyle(el).fontSize) * 2; // generous ceiling
        const h = el.getBoundingClientRect().height;
        ok(h < oneLine, "label is " + h.toFixed(1) + "px tall — it wrapped");
        return h.toFixed(1) + "px";
      });
      // Same budget as the English page, measured again because the Korean line is shorter in
      // characters and wider per character — neither one predicts the other.
      check("the Korean tagline still fits in two lines", () => {
        const el = document.querySelector(".brand p");
        const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.5;
        const lines = Math.round(el.getBoundingClientRect().height / lh);
        ok(lines <= 2, lines + " lines");
        return lines + " lines";
      });
      check("the header stays a single row", () => {
        const brand = document.querySelector(".brand").getBoundingClientRect();
        const master = document.querySelector(".master").getBoundingClientRect();
        ok(Math.abs(brand.top - master.top) < brand.height, "the toggle dropped below the brand");
      });
      check("the tab row still fits without the page scrolling sideways", () => {
        ok(document.documentElement.scrollWidth <= window.innerWidth + 1,
           "page scrolls horizontally: " + document.documentElement.scrollWidth + " > " + window.innerWidth);
      });
      // Where the layout actually broke each line, read back a character at a time. CSS
      // defaults to breaking CJK anywhere, which is right for Chinese and Japanese and
      // wrong for Korean: every description on this page was splitting an 어절 down the
      // middle — "폭 조 / 정 규칙", "대상을 고 / 르므로", "클립보드에 복 / 사합니다". Nothing about
      // that looks broken unless you read Korean, so it is measured rather than reviewed.
      ${KO_BREAKS}
      // Derived from the tab strip, not listed: a tab added without a line here would be the
      // one nobody measured, and Korean breaking mid-word is invisible to a reviewer who
      // does not read Korean.
      for (const tab of [...document.querySelectorAll("#tabs .tab")].map((t) => t.dataset.tab)) {
        check("ko: " + tab + " breaks Korean lines at spaces, not mid-word", () => {
          document.getElementById("tab-" + tab).click();
          const bad = [];
          for (const el of document.querySelectorAll("#panel-" + tab + " .desc, #panel-" + tab + " td, .brand p")) {
            if (!el.getClientRects().length) continue;
            bad.push(...midWordBreaks(el));
          }
          ok(bad.length === 0, "split mid-word: " + bad.join(", "));
          return bad.length === 0 ? "clean" : bad.join(", ");
        });
      }`
  },
  {
    name: "options · dark mode",
    page: { name: "opt-dark", ...OPTIONS, seed: seedOf(), dark: true },
    body: `
      ${TAB_READY}
      // Every row style that sits on a card. .var-item and .cpy-item shipped without a dark
      // background and drew a white block; .cpy-item is also the Quick open row.
      const ROWS = [
        ["#templateList .tpl-item", "templates"],
        ["#ruleList .rule-item", "appearance"],
        ["#variableList .var-item", "templates"],
        ["#copyList .cpy-item", "items"],
        ["#quickList .cpy-item", "items"]
      ];
      for (const [selector, tab] of ROWS) {
        check("dark: " + selector + " sits on the dark surface", () => {
          document.getElementById("tab-" + tab).click();
          const row = document.querySelector(selector);
          ok(row, "row exists");
          const card = bg(row.closest("section.card"));
          const ratio = contrast(bg(row), card);
          ok(ratio < 2, "row vs card contrast " + ratio.toFixed(2) + " — a light row on a dark card");
          return ratio.toFixed(2);
        });
      }
      // :hover cannot be forced without a debugger protocol, and reading the rule out of
      // document.styleSheets is not available either — Chrome treats every file:// document
      // as its own opaque origin, so cssRules on the stylesheet throws. The hover wash is
      // covered statically instead: check-source.js requires a dark counterpart for every
      // light background, .icon-btn:hover included.
      // The knob is what shows the state, so it has to be visible against the track in
      // both positions. It was white on a track that inverts to near-white: 1.1:1.
      const box = document.getElementById("enabled");
      const track = document.querySelector(".master .switch") || document.querySelector(".switch");
      const knobVsTrack = () => contrast(getComputedStyle(track, "::after").backgroundColor, bg(track));
      box.checked = true; await sleep(400);
      check("dark: the toggle knob is visible when on", () => { const r = knobVsTrack(); ok(r >= 3, "contrast " + r.toFixed(2)); return r.toFixed(2); });
      box.checked = false; await sleep(400);
      check("dark: the toggle knob is visible when off", () => { const r = knobVsTrack(); ok(r >= 3, "contrast " + r.toFixed(2)); return r.toFixed(2); });`
  },
  {
    name: "popup · active site",
    page: { name: "pop-active", ...POPUP, seed: seedOf() },
    body: `
      await waitFor(() => document.getElementById("domainStatus").textContent.indexOf("Checking") === -1, "the popup to resolve the site");
      const visible = () => [...document.querySelectorAll(".pop > *")].filter((e) => !e.hidden && getComputedStyle(e).display !== "none");
      check("the jump block leads, with its own label and divider", () => {
        const block = document.getElementById("jumpBlock");
        ok(!block.hidden, "shown when a quick link exists");
        eq(block.querySelector(".pop-label").textContent, "Go to work item");
        ok(block.querySelector("hr.pop-div"), "divided off from the switches below");
      });
      check("the master switch says what it switches", () => {
        eq(document.querySelector(".pop-toggle span").textContent, "Extension enabled");
      });
      check("the site controls sit under a label of their own", () => {
        const labels = [...document.querySelectorAll(".pop-label")].map((e) => e.textContent);
        ok(labels.indexOf("This site") !== -1, "labels: " + labels.join(" | "));
      });
      check("the template count sits beside the button that manages it", () => {
        const seq = visible().map((e) => e.id || e.className.split(" ")[0]);
        const row = seq.indexOf("pop-row");
        ok(row !== -1 && seq[row + 1] === "openOptions", "order: " + seq.join(" > "));
      });
      check("a key routes by its prefix", () => {
        document.getElementById("jumpKey").value = "ENG-9";
        document.getElementById("jumpForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
        eq(window.__opened, "https://linear.app/acme/issue/ENG-9");
      });
      check("a chosen target overrides the routing", () => {
        const t = document.getElementById("jumpTarget");
        ok(!t.hidden, "the picker appears for two targets");
        t.value = "qlk-plane";
        document.getElementById("jumpKey").value = "ENG-9";
        document.getElementById("jumpForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
        eq(window.__opened, "https://plane.example.com/acme/browse/ENG-9");
      });`
  },
  {
    name: "popup · extension off",
    page: { name: "pop-off", ...POPUP, seed: seedOf({ enabled: false }) },
    body: `
      await waitFor(() => document.getElementById("domainStatus").textContent.indexOf("Checking") === -1, "the popup to resolve");
      check("the status describes the switch, not the site", () => {
        const t = document.getElementById("domainStatus").textContent;
        eq(t, "The extension is off");
        ok(t.indexOf("plane.example.com") === -1, "naming the host made a global switch look per-site");
      });
      check("jumping still works with the extension off", () => ok(!document.getElementById("jumpBlock").hidden));
      check("no site action is offered while it is off", () => {
        for (const id of ["addDomain", "pickEl", "rescan", "focusWrap"]) ok(document.getElementById(id).hidden, id);
      });`
  },
  {
    // The feature end to end, in the script that performs it. allDomains rather than a host,
    // because a file:// page has no hostname to match; schema 6 because that is how the
    // presets reach an existing install, and this asserts what they do once they arrive.
    name: "content · focus mode",
    page: { name: "ct-focus", plane: PLANE, seed: seedOf({ allDomains: true, schema: 6 }) },
    body: `
      const props = document.getElementById("probe-props");
      const nav = document.getElementById("main-sidebar");
      const bodyCol = document.getElementById("probe-body");
      const width = document.getElementById("probe-width");
      const shown = (el) => getComputedStyle(el).display !== "none";
      const send = (msg) => new Promise((r) => window.__onMessage(msg, {}, r));
      const focusClass = () => document.documentElement.classList.contains("pe-focus");
      const stored = () => sessionStorage.getItem("pe-focus");
      const toasts = () => [...document.querySelectorAll(".pe-toast")].map((t) => t.textContent);

      await waitFor(() => getComputedStyle(width).maxWidth === "320px", "the always-on rules to be injected");
      check("nothing is hidden until it is asked for", () => {
        ok(shown(props), "the properties panel is where Plane put it");
        ok(shown(nav), "and so is the navigation");
        ok(!focusClass(), "no focus class on <html>");
        eq(stored(), null, "and nothing stored for this tab");
      });

      // The affordance in the page. Popup-only would mean the feature exists for whoever
      // already knows it exists.
      await waitFor(() => document.querySelector(".pe-focus-btn"), "the toggle to be injected beside the key");
      // The regression this page now carries: with a parent above the title, the first key in
      // document order is the parent's, and both buttons hung off it — Copy reference then handed
      // over the parent's reference, which is wrong in a way you only notice after pasting it.
      check("both buttons attach to this item's key, not the parent's", () => {
        for (const sel of [".pe-copy-ref-btn", ".pe-focus-btn"]) {
          const btn = document.querySelector(sel);
          ok(!btn.closest("a[href]"), sel + " landed inside the link to the parent");
        }
        const copy = document.querySelector(".pe-copy-ref-btn");
        eq(copy.previousElementSibling.textContent.trim(), "PROJ-142", "the key the copy button follows");
        eq(document.querySelectorAll("a[href] .pe-copy-ref-btn, a[href] .pe-focus-btn").length, 0, "none inside a link");
      });
      check("the toggle sits in the item header, after the copy button", () => {
        const btn = document.querySelector(".pe-focus-btn");
        eq(btn.previousElementSibling.className, "pe-copy-ref-btn", "it follows the copy button");
        eq(btn.parentElement.id, "probe-header", "in the header row, not floating somewhere");
        eq(btn.getAttribute("aria-pressed"), "false", "and it starts in the off position");
        ok((btn.getAttribute("title") || "").indexOf("Alt+Shift+F") > -1, "naming the shortcut is how it is learned");
      });
      check("it is the same size as the button beside it", () => {
        const a = document.querySelector(".pe-copy-ref-btn").getBoundingClientRect();
        const b = document.querySelector(".pe-focus-btn").getBoundingClientRect();
        eq(Math.round(b.width), Math.round(a.width), "width");
        eq(Math.round(b.height), Math.round(a.height), "height");
      });
      document.querySelector(".pe-focus-btn").click();
      check("clicking it turns focus mode on and the button says so", () => {
        const btn = document.querySelector(".pe-focus-btn");
        eq(btn.getAttribute("aria-pressed"), "true", "pressed");
        ok(btn.classList.contains("on"), "and it looks pressed");
        ok(!shown(props), "the properties panel went away");
        eq(stored(), "1", "the tab remembered");
      });
      document.querySelector(".pe-focus-btn").click();
      check("clicking it again brings the panels back", () => {
        eq(document.querySelector(".pe-focus-btn").getAttribute("aria-pressed"), "false");
        ok(shown(props), "properties panel back");
      });

      const on = await send({ type: "pe-focus-toggle" });
      check("one message hides both panels", () => {
        eq(on.ok, true, "the site is one we run on");
        eq(on.focus, true, "and it reports the new position");
        ok(!shown(props), "properties panel hidden");
        ok(!shown(nav), "navigation hidden");
        ok(focusClass(), "<html> carries the state a rule can hang off");
      });
      // The bug this is here for: a focus rule and an ordinary one share a stylesheet, and an
      // implementation that rebuilt only the focus half would drop the width rules on toggle.
      check("the rules that were already on stay on", () => eq(getComputedStyle(width).maxWidth, "320px"));
      check("a preset that ships switched off stays off", () => {
        eq(getComputedStyle(bodyCol).paddingLeft, "0px", "the reading-width rule is disabled, so it applies to nothing");
      });
      check("the way back is in the message, not only in the settings page", () => {
        const t = toasts().join(" | ");
        ok(t.indexOf("Focus mode on") > -1, "toast: " + t);
        ok(t.indexOf("Alt+Shift+F") > -1, "and it names the shortcut: " + t);
      });
      check("the tab remembers, so a reload lands in the same place", () => eq(stored(), "1"));
      const state = await send({ type: "pe-focus-state" });
      check("the popup can ask without changing anything", () => {
        eq(state.focus, true, "reported");
        ok(!shown(props), "and asking did not toggle it");
      });

      const off = await send({ type: "pe-focus-toggle" });
      check("toggling back gives every panel its space", () => {
        eq(off.focus, false, "reported");
        ok(shown(props), "properties panel back");
        ok(shown(nav), "navigation back");
        ok(!focusClass(), "class gone");
        eq(stored(), null, "and the tab is no longer remembering anything");
      });

      const set1 = await send({ type: "pe-focus-toggle", on: true });
      const set2 = await send({ type: "pe-focus-toggle", on: true });
      check("an explicit position is set, not flipped", () => {
        eq(set1.focus, true, "first");
        eq(set2.focus, true, "and asking for the same position twice is not a flip");
        ok(!shown(props), "still hidden");
      });

      // Take the site away underneath it. Settings are loaded by now, so a refusal here is
      // about the site rather than about a state object that has not arrived yet.
      const gone = JSON.parse(JSON.stringify(window.__SEED));
      gone.peSettings.enabled = false;
      window.__SEED = gone;
      window.__onChanged({ peSettings: { newValue: gone.peSettings } }, "sync");
      // Both halves, because either alone is also true midway through a broken build: the
      // point of waiting is that the reload of settings has finished, not that one rule moved.
      await waitFor(() => getComputedStyle(width).maxWidth !== "320px" && shown(props), "every rule to be withdrawn");
      const refused = await send({ type: "pe-focus-toggle" });
      check("switching the extension off gives the panels back, focus or not", () => {
        ok(shown(props), "properties panel visible again");
        ok(!focusClass(), "and <html> no longer claims focus mode");
      });
      check("and there is nothing to toggle on a site we do not run on", () => {
        eq(refused.ok, false, "refused");
        eq(refused.active, false, "because the site is not active");
      });`
  },
  {
    // Focus mode is the one control here whose state lives in the tab rather than in
    // settings, so the popup has to ask for it and can be told "no". Both answers matter.
    name: "popup · focus switch",
    page: { name: "pop-focus", ...POPUP, seed: seedOf() },
    body: `
      await waitFor(() => document.getElementById("domainStatus").textContent.indexOf("Checking") === -1, "the popup to resolve");
      const wrap = () => document.getElementById("focusWrap");
      const box = () => document.getElementById("focusToggle");
      check("a tab that cannot answer is offered no switch", () => {
        ok(wrap().hidden, "the default stub never calls back — exactly what a tab with no content script does");
        eq(getComputedStyle(wrap()).display, "none", "and .pop-toggle's display:flex does not outvote [hidden]");
      });
      // Answer the way a content script on an active site answers.
      const sent = [];
      let pageFocus = true;
      chrome.tabs.sendMessage = (id, msg, cb) => {
        sent.push(msg);
        if (msg.type === "pe-focus-state") cb({ ok: true, active: true, focus: pageFocus });
        else if (msg.type === "pe-focus-toggle") {
          pageFocus = typeof msg.on === "boolean" ? msg.on : !pageFocus;
          cb({ ok: true, active: true, focus: pageFocus });
        }
      };
      document.getElementById("enabled").dispatchEvent(new Event("change", { bubbles: true }));
      await waitFor(() => !wrap().hidden, "the switch to appear once the page answers");
      check("the switch opens in the position the page reports, not a default", () => {
        eq(box().checked, true, "the page said focus mode was already on");
      });
      // The answer comes back after the question may have changed. Hold one reply, take the
      // site away, then let the reply land: a switch that reappears under "the extension is
      // off" is a control the popup cannot honour.
      const held = [];
      chrome.tabs.sendMessage = (id, msg, cb) => held.push(() => cb({ ok: true, active: true, focus: true }));
      document.getElementById("enabled").dispatchEvent(new Event("change", { bubbles: true }));
      await waitFor(() => held.length, "the state query to go out");
      const master = document.getElementById("enabled");
      master.checked = false;
      master.dispatchEvent(new Event("change", { bubbles: true }));
      await waitFor(() => wrap().hidden, "the switch to go away with the extension");
      held.forEach((reply) => reply());
      check("a reply to a question that has moved on is ignored", () => {
        ok(wrap().hidden, "the switch came back after the extension was switched off");
      });
      // Put it back the way the rest of the case expects.
      master.checked = true;
      chrome.tabs.sendMessage = (id, msg, cb) => {
        sent.push(msg);
        if (msg.type === "pe-focus-state") cb({ ok: true, active: true, focus: pageFocus });
        else if (msg.type === "pe-focus-toggle") {
          pageFocus = typeof msg.on === "boolean" ? msg.on : !pageFocus;
          cb({ ok: true, active: true, focus: pageFocus });
        }
      };
      master.dispatchEvent(new Event("change", { bubbles: true }));
      await waitFor(() => !wrap().hidden, "the switch to come back with the extension");
      check("moving it sends that position, so the two copies cannot drift", () => {
        box().checked = false;
        box().dispatchEvent(new Event("change", { bubbles: true }));
        const last = sent[sent.length - 1];
        eq(last.type, "pe-focus-toggle", "message");
        eq(last.on, false, "the position it was moved to — a bare 'flip it' would race the page");
        eq(pageFocus, false, "and the page followed");
        eq(box().checked, false, "confirmed by the answer");
      });`
  },
  {
    // The popup is 260px wide, so nearly every Korean string in it wraps — the surface where
    // breaking an 어절 in half is most likely and least visible to anyone reading English.
    name: "popup · korean line breaking",
    page: { name: "pop-ko", ...POPUP, seed: seedOf(), lang: "ko" },
    body: `
      await waitFor(() => document.getElementById("domainStatus").textContent.indexOf("확인") === -1, "the popup to resolve");
      ${KO_BREAKS}
      check("the popup is in Korean", () => {
        ok(/[\\uAC00-\\uD7A3]/.test(document.body.textContent), "no Hangul in the popup at all");
      });
      // The permission notice is the only popup string long enough to wrap inside one text
      // node — 45 Korean characters in a 260px popup is three lines. Everything else here is
      // a short label in its own element, so with the notice hidden this suite passed whether
      // popup.css kept 어절 together or not, and proved nothing. Revealing it is not cheating:
      // what is under test is how that text wraps, not the logic that decides to show it.
      check("the permission notice is showing, so there is something that wraps", () => {
        const notice = document.getElementById("permNotice");
        notice.hidden = false;
        const line = parseFloat(getComputedStyle(notice).lineHeight);
        ok(notice.getBoundingClientRect().height > line * 1.8, "the notice did not wrap at all");
        return notice.getBoundingClientRect().height.toFixed(0) + "px";
      });
      check("every Korean line breaks at a space, not mid-word", () => {
        const bad = midWordBreaks(document.querySelector(".pop"));
        ok(bad.length === 0, "split mid-word: " + bad.join(", "));
        return bad.length === 0 ? "clean" : bad.join(", ");
      });
      check("nothing overflows the popup's fixed width", () => {
        const pop = document.querySelector(".pop");
        ok(pop.scrollWidth <= pop.clientWidth + 1,
           "content is " + pop.scrollWidth + "px inside a " + pop.clientWidth + "px popup");
      });`
  },
  {
    name: "popup · site not listed",
    page: { name: "pop-unlisted", ...POPUP, seed: seedOf({ domains: ["elsewhere.test"] }) },
    body: `
      await waitFor(() => document.getElementById("domainStatus").textContent.indexOf("Checking") === -1, "the popup to resolve");
      check("the status says why nothing is running here", () => {
        eq(document.getElementById("domainStatus").textContent, "Not in your site list: plane.example.com");
      });
      check("and the fix is offered right below it", () => ok(!document.getElementById("addDomain").hidden));`
  },
  {
    name: "popup · no quick links",
    page: { name: "pop-nolinks", ...POPUP, seed: seedOf({ quickLinks: [] }) },
    body: `
      await waitFor(() => document.getElementById("domainStatus").textContent.indexOf("Checking") === -1, "the popup to resolve");
      check("the whole jump block goes away, label and divider included", () => {
        const block = document.getElementById("jumpBlock");
        ok(block.hidden, "block hidden");
        eq(getComputedStyle(block).display, "none");
      });
      check("the popup above the switch is then just the header", () => {
        const first = [...document.querySelectorAll(".pop > *")].filter((e) => !e.hidden && getComputedStyle(e).display !== "none")[1];
        eq(first.className.split(" ")[0], "pop-toggle");
      });`
  },
  {
    name: "popup · dark mode",
    page: { name: "pop-dark", ...POPUP, seed: seedOf(), dark: true },
    body: `
      await waitFor(() => document.getElementById("domainStatus").textContent.indexOf("Checking") === -1, "the popup to resolve");
      const box = document.getElementById("enabled");
      const track = document.querySelector(".switch");
      const knobVsTrack = () => contrast(getComputedStyle(track, "::after").backgroundColor, bg(track));
      box.checked = true; await sleep(400);
      check("dark: the toggle knob is visible when on", () => { const r = knobVsTrack(); ok(r >= 3, "contrast " + r.toFixed(2)); return r.toFixed(2); });
      box.checked = false; await sleep(400);
      check("dark: the toggle knob is visible when off", () => { const r = knobVsTrack(); ok(r >= 3, "contrast " + r.toFixed(2)); return r.toFixed(2); });
      check("dark: the jump input is not a white box", () => {
        const r = contrast(bg("#jumpKey"), bg(document.body));
        ok(r < 3, "input vs body contrast " + r.toFixed(2));
        return r.toFixed(2);
      });`
  }
];

/* ------------------------------------------------------------------ */
/* Go                                                                 */
/* ------------------------------------------------------------------ */

const chrome = findChrome();
if (!chrome) {
  // Never a silent pass. In CI the browser is part of the contract, so its absence is a
  // failure; locally it is a loud skip that names what to do about it.
  const msg =
    "no Chrome or Chromium found — set PE_CHROME=/path/to/chrome to run the DOM harness";
  if (process.env.CI) {
    console.log(`  ERROR ${msg}`);
    console.log("\ndom: could not run — CI requires the browser\n");
    process.exit(1);
  }
  console.log(`\ndom: SKIPPED (not a pass) — ${msg}\n`);
  process.exit(0);
}

for (const suite of suites) {
  const build = suite.page.plane ? buildPlanePage : buildPage;
  const page = build({ ...suite.page, body: suite.body });
  for (const r of run(chrome, page, suite.hash)) {
    results.push({ ...r, suite: suite.name });
  }
}

const failed = results.filter((r) => !r.pass);
for (const r of results) {
  if (!r.pass) console.log(`  FAIL  ${r.suite} — ${r.name}\n          ${r.detail}`);
}
if (!results.length) {
  hardError = "no assertions ran at all";
  console.log(`  ERROR ${hardError}`);
}
try {
  fs.rmSync(OUT, { recursive: true, force: true });
} catch (_) {
  /* a temp dir left behind is not worth failing over */
}
console.log(
  `\ndom: ${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total` +
    ` · ${suites.length} page(s) in ${path.basename(chrome)}\n`
);
process.exit(failed.length || hardError ? 1 : 0);
