#!/usr/bin/env node
// dom-harness.js — drives options.html and popup.html in a real browser.
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
// no chance of a harness file reaching the release zip.
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
    onMessage: { addListener: () => {} }
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
        timeout: 30000
      }
    );
  } catch (e) {
    const why = e && e.killed ? "timed out after 60s" : String(e.message).slice(0, 200);
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
      schema: 6,
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

/* ------------------------------------------------------------------ */
/* Suites                                                             */
/* ------------------------------------------------------------------ */

const TAB_READY = `await waitFor(() => document.querySelector('.tab[aria-selected="true"]'), "the tabs to initialise");
const sel = () => document.querySelector('.tab[aria-selected="true"]').dataset.tab;
const shown = () => [...document.querySelectorAll(".panel")].filter((p) => !p.hidden).map((p) => p.dataset.tab);`;

const suites = [
  {
    name: "options · tabs",
    page: { name: "opt-tabs", ...OPTIONS, seed: seedOf() },
    body: `
      ${TAB_READY}
      check("opens on Templates when a site is configured", () => { eq(sel(), "templates"); eq(location.hash, "#templates"); });
      check("exactly one panel is visible", () => eq(shown().length, 1));
      check("all eight cards are inside a panel", () => {
        const inPanels = [...document.querySelectorAll(".panel section.card")].length;
        eq(document.querySelectorAll("section.card").length, inPanels, "cards in panels");
        eq(inPanels, 8, "card count");
      });
      check("each tab holds the sections it says it does", () => {
        const count = (t) => document.querySelectorAll("#panel-" + t + " section.card").length;
        eq([count("templates"), count("items"), count("appearance"), count("sites"), count("backup")].join(","), "3,2,1,1,1");
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
      check("arrow keys and Home/End move between tabs", () => {
        const nav = document.getElementById("tabs");
        const key = (k) => nav.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
        document.getElementById("tab-templates").click();
        key("ArrowRight"); eq(sel(), "items", "ArrowRight");
        key("ArrowLeft"); eq(sel(), "templates", "ArrowLeft");
        key("End"); eq(sel(), "backup", "End");
        key("Home"); eq(sel(), "templates", "Home");
        eq(document.activeElement.dataset.tab, "templates", "focus follows the selection");
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
      check("starts on Templates with one rule", () => {
        eq(sel(), "templates");
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
    name: "options · unknown hash",
    page: { name: "opt-hash", ...OPTIONS, seed: seedOf() },
    hash: "#not-a-tab",
    body: `
      ${TAB_READY}
      check("an unknown hash falls back to a real tab", () => eq(sel(), "templates"));
      check("…and rewrites itself so the address matches the page", () => eq(location.hash, "#templates"));`
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
      check("the header stays a single row", () => {
        const brand = document.querySelector(".brand").getBoundingClientRect();
        const master = document.querySelector(".master").getBoundingClientRect();
        ok(Math.abs(brand.top - master.top) < brand.height, "the toggle dropped below the brand");
      });
      check("the tab row still fits without the page scrolling sideways", () => {
        ok(document.documentElement.scrollWidth <= window.innerWidth + 1,
           "page scrolls horizontally: " + document.documentElement.scrollWidth + " > " + window.innerWidth);
      });`
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
        for (const id of ["addDomain", "pickEl", "rescan"]) ok(document.getElementById(id).hidden, id);
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
  const page = buildPage({ ...suite.page, body: suite.body });
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
