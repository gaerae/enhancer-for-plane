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
function stub(seed, lang, local) {
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
window.__LOCAL = ${JSON.stringify(local || {})};
window.__localWrites = 0;
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
    // Readable and writable, unlike sync: the rule-health record is the one piece of state
    // the content script both writes and the settings page reads back, so a stub that
    // swallowed the write could not tell a working feature from a silent one. Writes are
    // kept so an assertion can read what was actually stored, and counted so "it wrote
    // once per route" is provable rather than assumed.
    local: {
      get: (k, cb) => cb(JSON.parse(JSON.stringify(window.__LOCAL))),
      set: (o, cb) => { Object.assign(window.__LOCAL, JSON.parse(JSON.stringify(o))); window.__localWrites++; cb && cb(); }
    },
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
    // A title as well as a URL, because that pair is the whole input to the popup's copy
    // block — it reads a tab, never a page. The shape is the one Plane and Linear both
    // write, measured 2026-08-08: "{KEY} {title}".
    query: (o, cb) => cb([{ id: 1, url: "https://plane.example.com/acme/browse/PROJ-7", title: "PROJ-7 Fix the login redirect" }]),
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
// A check body must be synchronous. An async one returns a Promise, this records a pass
// before it settles, and every assertion inside it becomes decorative — the failure mode
// being that the suite goes green having asserted nothing. Await outside the check and
// assert on the result.
const check = (name, fn) => { try { const d = fn(); if (d && typeof d.then === "function") throw new Error("check body is async — await outside it and assert on the result"); __out.push({ name, pass: true, detail: d === undefined ? "" : String(d) }); } catch (e) { __out.push({ name, pass: false, detail: String(e && e.message || e) }); } };
const eq = (a, b, what) => { if (String(a) !== String(b)) throw new Error((what || "value") + ": " + JSON.stringify(a) + " !== " + JSON.stringify(b)); return a; };
const ok = (c, what) => { if (!c) throw new Error(what || "expected true"); return true; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 8 virtual seconds. It polls in virtual time, so the ceiling costs nothing when the
// condition is met early and only decides how long a genuine failure waits before saying so
// — and 2s was under a single rule-health delay, which made a slow answer look like no answer.
const waitFor = async (cond, label) => {
  for (let i = 0; i < 400; i++) { if (cond()) return true; await sleep(20); }
  throw new Error("timed out waiting for " + (label || "condition"));
};
const rgb = (s) => (String(s).match(/\\d+/g) || []).slice(0, 3).map(Number);
const lum = (c) => { const a = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; };
const contrast = (x, y) => { const l1 = lum(rgb(x)), l2 = lum(rgb(y)); const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05); };
const bg = (sel) => getComputedStyle(typeof sel === "string" ? document.querySelector(sel) : sel).backgroundColor;
const report = () => { const el = document.createElement("pre"); el.id = "pe-results"; el.textContent = JSON.stringify(__out); document.body.appendChild(el); };
`;

function buildPage({ name, html, css, js, seed, local, dark, lang, body }) {
  let src = fs.readFileSync(path.join(ROOT, html), "utf8");
  const cssPath = dark ? darkCss(css) : path.join(ROOT, css);
  // Every insertion goes through a replacer function, never a replacement string. A string
  // replacement reads $&, $1 and $' as instructions, and the things being inserted here are
  // an entire message catalogue and an entire test body — authored text, full of $ signs.
  // One "$NAME$'s" in a catalogue entry expanded $' into the rest of the file and truncated
  // the page mid-string; every suite on it then failed for reasons that pointed elsewhere.
  const put = (re, text) => (src = src.replace(re, () => text));
  put(new RegExp(`href="${css}"`), `href="${fileUrl(cssPath)}"`);
  for (const f of ["common.js", js]) {
    put(new RegExp(`src="${f}"`), `src="${fileUrl(path.join(ROOT, f))}"`);
  }
  // The stub has to define `chrome` before the page's own scripts run.
  put(/<script src="file:[^"]*common\.js"><\/script>/, stub(seed, lang, local) + "\n" + `<script src="${fileUrl(path.join(ROOT, "common.js"))}"></script>`);
  // Transitions off. Virtual time advances timers but not the compositor clock that drives
  // a CSS transition, so a colour read after a toggle came back mid-interpolation — the
  // toggle knob measured 1.1:1 here while a real browser settled at 9.5:1. Asserting the
  // final computed value is both what matters and the only thing that can be deterministic.
  put(
    "</head>",
    "<style>*, *::before, *::after { transition: none !important; animation: none !important; }</style>\n</head>"
  );
  put(
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
function buildPlanePage({ name, seed, local, lang, plane, body }) {
  const src =
    `<!doctype html>\n<html lang="en"><head><meta charset="utf-8" />\n` +
    `<link rel="stylesheet" href="${fileUrl(path.join(ROOT, "content.css"))}" />\n` +
    `<style>*, *::before, *::after { transition: none !important; animation: none !important; }</style>\n` +
    `</head><body>\n${plane}\n${stub(seed, lang, local)}\n` +
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
        // Virtual milliseconds, not real ones, so this is a bound on what a page may wait
        // for rather than on how long the run takes. It was 5000, which was under the
        // rule-health delay alone — a suite that has to prove "nothing happened for 2.5s,
        // then this did" needs several of those windows back to back, and the click scan's
        // own throttle has to be waited out on top of them.
        "--virtual-time-budget=40000",
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

// The classes and the id are copied from Plane's own markup — the properties panel is a
// flex sibling of the description column, the left navigation carries an id. The widths are
// here so a hidden panel has something to give its space back to.
//
// Two generations sit on this one page on purpose. Plane 1.4 (self-hosted) and Plane Cloud
// write the properties panel and the body column with completely different classes, and no
// install ever sees both — which is exactly why a page that carried only one of them let
// the Cloud half rot unnoticed through a release. A single page proves the shipped selector
// list matches both, and it costs one extra element per pair. Measured against Cloud on
// 2026-08-08; the ones marked "decoy" are the near misses that a looser selector would
// wrongly catch, and they must stay visible while focus mode is on.
const PLANE = `
<div class="flex h-full w-full overflow-hidden" style="width: 1200px">
  <div class="h-full w-full space-y-6 overflow-y-auto px-9 py-5" id="probe-body">description</div>
  <div class="fixed right-0 z-[5] h-full w-full min-w-[300px] border-l border-subtle bg-surface-1 sm:w-1/2 md:relative md:w-1/4" id="probe-props">properties</div>
</div>
<div class="relative flex h-full w-full overflow-hidden" style="width: 1200px">
  <div class="h-full flex-1 min-w-0 overflow-y-auto px-8 py-6" id="probe-body-cloud">description (cloud)</div>
  <div class="relative z-[5] h-full shrink-0 overflow-hidden bg-surface-1 motion-safe:transition-[width,min-width]" id="probe-props-cloud">properties (cloud)</div>
</div>
<div class="shrink-0 bg-surface-1" id="probe-props-decoy">a cycles-route chip that .shrink-0.bg-surface-1 alone would have hidden</div>
<div class="overflow-y-auto px-8 py-5" id="probe-body-decoy">neither generation's body column</div>
<div id="main-sidebar" class="z-20 h-full border-r border-subtle">navigation</div>
<div class="max-w-40" id="probe-width">a module name long enough to be truncated</div>
<div id="probe-header">
  <!-- An item with a parent, which is where the buttons were landing on the wrong key. Plane
       renders both keys from one component: the parent's inside a link to the parent and inert,
       this item's on its own and click-to-copy. The parent comes first in document order. -->
  <div class="mb-5 flex w-min items-center gap-3 rounded-md border">
    <a href="/acme/browse/PROJ-100"><button type="button" disabled>PROJ-100</button></a>
  </div>
  <!-- Not what Plane renders today, and that is the point: another item's key above this one,
       in a link, but click-to-copy rather than inert. Plane 1.4 leaves every other key inert, so
       "not disabled" alone would pick the right button and the link signal could rot untested —
       one release enabling copy on a chip is all it would take. Here it is that release. -->
  <div class="mb-5 flex w-min items-center gap-3 rounded-md border">
    <a href="/acme/browse/PROJ-9"><button type="button">PROJ-9</button></a>
  </div>
  <button type="button">PROJ-142</button>
  <textarea id="title-input">A work item</textarea>
  <!-- Sub-items and relations, which put more keys on the page. They sit below the description
       in Plane, but inside the same block as the title and the two keys above — which is what
       matters here, because that block is the first scope the walk up from #title-input finds a
       key in, so every one of these is a candidate. Each is a link to another item with an inert
       key inside it, exactly as Plane renders them. -->
  <div class="sub-issues">
    <a href="/acme/browse/PROJ-201"><button type="button" disabled>PROJ-201</button></a>
    <a href="/acme/browse/PROJ-202"><button type="button" disabled>PROJ-202</button></a>
  </div>
  <div class="relations">
    <a href="/acme/browse/PROJ-77"><button type="button" disabled>PROJ-77</button></a>
  </div>
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

// The page builder is a text substitution, and everything it substitutes in is authored text
// — an entire catalogue, an entire suite body. If any of it reaches String.replace as a
// replacement string, "$&", "$1" and "$'" are read as instructions. One catalogue entry
// containing "$NAME$'s" expanded $' into the rest of the file, truncating the page mid-string;
// 32 assertions on 6 pages then failed with messages pointing at tabs and preview text.
// Cheaper to assert the builder is immune than to diagnose that twice.
function checkPageBuilderQuotesNothing() {
  const src = fs.readFileSync(path.join(__dirname, "dom-harness.js"), "utf8");
  const fn = src.slice(src.indexOf("function buildPage("), src.indexOf("function buildPlanePage("));
  // The one legitimate src.replace is `put`, whose replacement is a function.
  const bad = fn.split("\n").filter((l) => l.indexOf("src.replace(") > -1 && l.indexOf("() =>") === -1);
  if (bad.length) {
    hardError = "buildPage substitutes with a replacement string: " + bad[0].trim();
    console.log(`  ERROR ${hardError}`);
  }
}
checkPageBuilderQuotesNothing();

const suites = [
  {
    // Chrome caps a toolbar popup at 600px and cuts the rest. This one reached 606 on an
    // ordinary work item tab and 761 with every block showing, so Settings — the one control
    // worth reaching from any state — was the part below the line, and macOS overlay
    // scrollbars meant nothing on screen said there was a below.
    name: "popup · taller than the window Chrome gives it",
    page: {
      name: "pop-tall",
      ...POPUP,
      seed: seedOf(),
      local: { peRecent: [
        { key: "PROJ-7", url: "https://plane.example.com/acme/browse/PROJ-7", name: "Plane", at: 700 },
        { key: "ENG-9", url: "https://linear.app/acme/issue/ENG-9", name: "Linear", at: 600 },
        { key: "PROJ-1", url: "https://plane.example.com/acme/browse/PROJ-1", name: "Plane", at: 500 },
        { key: "DU-61", url: "https://gprxh.atlassian.net/browse/DU-61", name: "Jira", at: 400 },
        { key: "GH-1234", url: "https://github.com/gaerae/enhancer-for-plane/issues/1234", name: "GitHub", at: 300 },
        { key: "TRASHSWD-17", url: "https://gprxh.atlassian.net/browse/TRASHSWD-17", name: "Jira", at: 200 }
      ] }
    },
    body: `
      await waitFor(() => document.getElementById("domainStatus").textContent.indexOf("Checking") === -1, "the popup to resolve");
      const scroll = () => document.getElementById("popScroll");
      const foot = () => document.querySelector(".pop-foot");
      check("the document stays inside Chrome's 600px", () => {
        const h = document.documentElement.scrollHeight;
        ok(h <= 600, "the popup is " + h + "px and Chrome will cut " + (h - 600) + " of it");
        return h + "px";
      });
      // The state that makes all of this necessary. If a seed stops overflowing, the checks
      // below start passing for the wrong reason.
      check("this content really is taller than the box", () => {
        ok(scroll().scrollHeight > scroll().clientHeight + 4,
           "content " + scroll().scrollHeight + " fits in " + scroll().clientHeight);
      });
      check("the scrollbar takes real space rather than fading out of sight", () => {
        const gutter = scroll().offsetWidth - scroll().clientWidth;
        ok(gutter >= 6, "gutter is " + gutter + "px — an overlay scrollbar is invisible at rest");
      });
      check("the way out is outside the part that scrolls", () => {
        ok(!scroll().contains(document.getElementById("openOptions")), "Settings is inside the scroll box");
        ok(!scroll().contains(document.getElementById("tplCount")), "so is the template count");
        const before = foot().getBoundingClientRect().top;
        scroll().scrollTop = scroll().scrollHeight;
        eq(foot().getBoundingClientRect().top, before, "the footer moved when the middle scrolled");
      });
      check("and scrolling reaches the last thing in the middle", () => {
        scroll().scrollTop = scroll().scrollHeight;
        const last = [...scroll().children].filter((n) => !n.hidden).pop();
        const r = last.getBoundingClientRect();
        const box = scroll().getBoundingClientRect();
        ok(r.bottom <= box.bottom + 1 && r.top >= box.top - 1, "the last block is still out of view");
      });
      // The other half of the same mistake: a short popup padded out to the cap.
      check("the header and the footer are not what scrolled", () => {
        const head = document.querySelector(".pop-head").getBoundingClientRect();
        ok(head.top >= 0 && head.bottom <= scroll().getBoundingClientRect().top + 1, "the header is in the scroll flow");
      });`
  },
  {
    // The case the two earlier attempts at "this selector expires" both missed. Ordinary
    // Plane markup carries Tailwind and nothing else, so every candidate is durable, one
    // heading renders, and a mark that appears only on generated rows appears nowhere. It
    // was reported exactly that way twice: "is it shown in words? am I not finding it?"
    name: "content · picker on ordinary markup",
    page: {
      name: "ct-picker-plain",
      plane: `
        <div class="overflow-y-auto px-9 py-5"><span class="text-sm font-medium">Real Plane body</span></div>
        <div class="px-9 py-5">a sibling sharing two of the three classes</div>`,
      seed: seedOf({ allDomains: true })
    },
    body: `
      await waitFor(() => window.__peLoaded, "the content script to load");
      await sleep(200);
      await new Promise((r) => window.__onMessage({ type: "pe-start-picker" }, {}, r));
      document.querySelector(".overflow-y-auto").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await waitFor(() => document.getElementById("pe-pick-menu"), "the candidate list");
      const rows = () => [...document.querySelectorAll("#pe-pick-menu .pe-pick-item")];
      check("this page really is the one-group case", () => {
        const heads = [...document.querySelectorAll("#pe-pick-menu .pe-pick-group")].map((g) => g.textContent);
        eq(heads, [peMsg("pickGroupDurable")], "a second group would make the check meaningless");
        ok(rows().length >= 3, "only " + rows().length + " candidates");
      });
      check("every row still says how long it lasts", () => {
        for (const r of rows()) {
          const l = r.querySelector(".pe-pick-life");
          ok(l, "no verdict on " + r.querySelector(".pe-pick-sel").textContent);
          eq(l.textContent, peMsg("pickLifeLasts"), r.querySelector(".pe-pick-sel").textContent);
        }
      });
      check("the verdict is legible and is not the same grey as the row furniture", () => {
        const l = rows()[0].querySelector(".pe-pick-life");
        const c = contrast(getComputedStyle(l).color, bg(l));
        ok(c >= 4.5, "contrast " + c.toFixed(2));
        const kind = getComputedStyle(rows()[0].querySelector(".pe-pick-kind")).color;
        ok(getComputedStyle(l).color !== kind, "the verdict is the same colour as the kind label");
      });
      check("the extra chip did not squeeze a row into wrapping", () => {
        for (const r of rows()) {
          ok(r.offsetHeight < 44, r.querySelector(".pe-pick-sel").textContent + " is " + r.offsetHeight + "px tall");
          const l = r.querySelector(".pe-pick-life");
          ok(l.scrollWidth <= l.clientWidth + 1, "the verdict is clipped: " + l.scrollWidth + " > " + l.clientWidth);
        }
      });`
  },
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
        eq(rows().length, 5, "rows");
        const win = keys.map((k) => k[0]).join(" | ");
        // The context menu earns a row for the same reason the omnibox keyword does: it is a
        // way in that answers a gesture, and this table is the one place they are all
        // written down. Its "key" is a right-click, which is why the check is on the text of
        // the column rather than on a modifier combination.
        for (const combo of ["Alt+T", "Alt+C", "Alt+Shift+F", "issue", peMsg("optKeysRightClick")]) {
          ok(win.indexOf(combo) > -1, combo + " missing from: " + win);
        }
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
    // The quick link row is where a wrong URL is caught or not caught at all: an API address
    // loads, returns 200 and shows JSON, so no later surface can tell. Both previews and the
    // hint have to be on screen at the same time, which is a layout question as much as a
    // logic one — three lines joined with newlines in a box that has to keep them.
    name: "options · quick link previews",
    page: {
      name: "opt-quick",
      ...OPTIONS,
      seed: seedOf({
        quickLinks: [
          { id: "ok", name: "Plane", prefix: "", enabled: true,
            url: "https://plane.hectoai.co.kr/hecto/browse/{{key}}",
            searchUrl: "https://plane.hectoai.co.kr/hecto/search/?q={{q}}" },
          { id: "api", name: "Wrong", prefix: "X-", enabled: true,
            url: "https://plane.hectoai.co.kr/hecto/browse/{{key}}",
            searchUrl: "https://plane.hectoai.co.kr/api/workspaces/hecto/search/?search={{q}}&workspace_search=true" }
        ]
      })
    },
    body: `
      document.querySelector('#tabs .tab[data-tab="items"]').click();
      await waitFor(() => document.querySelectorAll("#quickList .qlk-preview").length === 2, "the rows");

      // The chooser exists because an empty row is where a wrong URL gets typed. What only a
      // browser can answer is whether picking one lands the caret on the part that still
      // needs replacing — a filled URL with the caret at position 0 is no better than a
      // placeholder nobody reads.
      const box = document.getElementById("quickExamples");
      check("the add button opens a chooser rather than adding a row", () => {
        const before = document.querySelectorAll("#quickList .cpy-item").length;
        document.getElementById("addQuickLink").click();
        ok(!box.hidden, "the chooser is shown");
        eq(document.querySelectorAll("#quickList .cpy-item").length, before, "and nothing was added yet");
      });
      check("the sites already configured come first, with the host filled in", () => {
        const heads = [...box.querySelectorAll(".qlk-ex-head")].map((h) => h.textContent);
        eq(heads[0], peMsg("optQuickExamplesFromSites"));
        const first = box.querySelector(".qlk-ex");
        eq(first.querySelector(".qlk-ex-name").textContent, "plane.example.com", "the domain from Sites");
        ok(first.querySelector(".qlk-ex-url").textContent.indexOf("https://plane.example.com/") === 0,
           "with the host already right: " + first.querySelector(".qlk-ex-url").textContent);
      });
      check("every tracker is offered, and the two that disappoint say so", () => {
        const names = [...box.querySelectorAll(".qlk-ex-name")].map((n) => n.textContent);
        for (const t of ["Plane", "Jira", "Linear", "GitHub", "GitLab"]) ok(names.indexOf(t) > -1, t + " missing: " + names.join(", "));
        ok(names.indexOf(peMsg("optQuickExamplesBlank")) > -1, "and the empty row is still reachable");
        const noteFor = (name) => {
          const row = [...box.querySelectorAll(".qlk-ex")].find((r) => r.querySelector(".qlk-ex-name").textContent === name);
          const n = row.querySelector(".qlk-ex-note");
          return n ? n.textContent : "";
        };
        eq(noteFor("Plane"), peMsg("optQuickExampleNotePlane"));
        eq(noteFor("Linear"), peMsg("optQuickExampleNoteLinear"));
        eq(noteFor("GitHub"), peMsg("optQuickExampleNoteNumbered"));
        eq(noteFor("Jira"), "", "Jira's works, so it says nothing");
      });
      // Picking the Jira example: nothing about it is known in advance, so both halves are
      // filled and the caret goes to ⟨site⟩.
      [...box.querySelectorAll(".qlk-ex")].find((r) => r.querySelector(".qlk-ex-name").textContent === "Jira").click();
      await waitFor(() => document.querySelectorAll("#quickList .cpy-item").length === 3, "the row to be added");
      check("picking one fills both URLs and selects the first blank", () => {
        const row = document.querySelectorAll("#quickList .cpy-item")[2];
        const url = row.querySelector(".qlk-url");
        eq(row.querySelector(".qlk-name").value, "Jira");
        ok(url.value.indexOf(".atlassian.net/browse/{{key}}") > -1, url.value);
        ok(row.querySelector(".qlk-search").value.indexOf("jql=text ~") > -1, "and the search URL too");
        eq(document.activeElement, url, "the caret is in the URL field");
        eq(url.value.slice(url.selectionStart, url.selectionEnd), "⟨" + peMsg("optQuickPartSite") + "⟩",
           "with the part to replace selected, so typing overwrites it");
        ok(box.hidden, "and the chooser closed behind it");
      });
      // The preview under the new row has to say something a reader can act on rather than
      // echoing the blanks back — this is the row they are about to edit.
      check("the new row previews where its blanks would land", () => {
        const p = document.querySelectorAll("#quickList .qlk-preview")[2];
        ok(p.textContent.indexOf("PROJ-123") > -1, "the sample key: " + p.textContent);
      });
      const prev = (i) => document.querySelectorAll("#quickList .qlk-preview")[i];
      check("a good row previews both destinations", () => {
        const t = prev(0).textContent;
        ok(t.indexOf("PROJ-123") > -1 && t.indexOf("/browse/PROJ-123") > -1, "the key: " + t);
        ok(t.indexOf("login%20bug") > -1, "and the phrase, encoded: " + t);
        ok(!prev(0).classList.contains("warn"), "with nothing to warn about");
      });
      check("an API address is called out where it was typed", () => {
        ok(prev(1).classList.contains("warn"), "the row is marked");
        ok(prev(1).textContent.indexOf("JSON") > -1, "and says what will happen: " + prev(1).textContent);
      });
      // Two URLs force the row to wrap, and the delete button was ending up on a line of its
      // own — which reads as a control belonging to nothing.
      check("the delete button stays on the row's first line", () => {
        const row = document.querySelectorAll("#quickList .cpy-item")[0];
        const box = (sel) => row.querySelector(sel).getBoundingClientRect();
        // Overlap, not an exact top: the button is shorter than an input and sits centred
        // against it, so equal tops would be asserting a coincidence.
        const overlaps = (a, b) => a.top < b.bottom && b.top < a.bottom;
        ok(overlaps(box(".qlk-del"), box(".qlk-name")), "the ✕ is on the name field's line");
        ok(box(".qlk-url").top >= box(".qlk-name").bottom, "and the URLs are on their own lines");
        ok(box(".qlk-search").top >= box(".qlk-url").bottom, "one each");
      });
      // The tab order must still run through the fields in the order they are read, with the
      // destructive button last: CSS order moves the button visually and must not move that.
      check("moving it did not move it in the tab order", () => {
        const row = document.querySelectorAll("#quickList .cpy-item")[0];
        const focusable = [...row.querySelectorAll("input, button")];
        eq(focusable[focusable.length - 1].className.indexOf("qlk-del") > -1, true, "delete is reached last");
      });
      // Joined with newlines, so the stylesheet has to keep them — otherwise the hint runs
      // onto the end of the preview and reads as part of the URL.
      check("the lines are lines", () => {
        const box = prev(1);
        const line = parseFloat(getComputedStyle(box).lineHeight);
        ok(box.getBoundingClientRect().height > line * 2.2, "the preview did not break into lines");
        eq(getComputedStyle(box).whiteSpace, "pre-line");
      });`
  },
  {
    // Paste beats a list of five, and the list of five is what the chooser was. Everything
    // here is a question about the assembled page: whether the box reports what it read
    // before anything is committed, whether refusing looks like refusing, and where the caret
    // ends up in each of the three outcomes.
    name: "options · quick link from a pasted address",
    page: { name: "opt-quick-paste", ...OPTIONS, seed: seedOf({ quickLinks: [] }) },
    body: `
      document.querySelector('#tabs .tab[data-tab="items"]').click();
      const box = document.getElementById("quickExamples");
      const open = () => { if (box.hidden) document.getElementById("addQuickLink").click(); };
      const type = (v) => {
        const i = document.getElementById("quickPasteUrl");
        i.value = v;
        i.dispatchEvent(new Event("input", { bubbles: true }));
        return i;
      };
      const go = () => document.querySelector(".qlk-paste-go");
      const hint = () => document.querySelector(".qlk-paste-hint");
      const rows = () => [...document.querySelectorAll("#quickList .cpy-item")];
      open();

      check("the panel explains the two kinds of brace before anything else does", () => {
        const legend = box.querySelector(".qlk-ex-legend");
        ok(legend, "no legend");
        ok(legend.textContent.indexOf("⟨") > -1 && legend.textContent.indexOf("{{key}}") > -1, legend.textContent);
      });
      // Picking a row fills two fields. Showing one of them is how a search URL nobody chose
      // ends up in the settings.
      check("every example row shows the search address it will also fill", () => {
        const rowFor = (name) => [...box.querySelectorAll(".qlk-ex")].find((r) => r.querySelector(".qlk-ex-name").textContent === name);
        const searchOf = (name) => { const s = rowFor(name).querySelector(".qlk-ex-search"); return s ? s.textContent : ""; };
        ok(searchOf("Jira").indexOf("jql=text ~") > -1, "Jira: " + searchOf("Jira"));
        ok(searchOf("GitHub").indexOf("{{q}}") > -1, "GitHub: " + searchOf("GitHub"));
        eq(searchOf("Linear"), "", "Linear has none, and an empty line would imply one is missing");
      });
      check("the box starts inert and says nothing", () => {
        ok(go().disabled, "the button is live before anything was pasted");
        eq(hint().textContent, "");
      });
      check("a known tracker is named back, and the search address is promised", () => {
        type("https://gprxh.atlassian.net/browse/DU-61");
        ok(!go().disabled, "the button did not come alive");
        eq(hint().textContent, peMsg("optQuickPasteKnown", ["Jira"]));
        ok(!hint().classList.contains("bad"));
      });
      check("an address with no key in it is refused, and looks refused", () => {
        type("https://linear.app/gaerae/settings/members");
        ok(go().disabled, "a template would have been built from a settings page");
        eq(hint().textContent, peMsg("optQuickPasteUnread"));
        ok(hint().classList.contains("bad"), "and it reads as ordinary body text");
        const c = contrast(getComputedStyle(hint()).color, bg(document.querySelector(".qlk-examples")));
        ok(c >= 4.5, "contrast " + c.toFixed(2));
      });
      check("Enter is the same as the button", () => {
        const i = type("https://gprxh.atlassian.net/browse/DU-61");
        i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      });
      await waitFor(() => rows().length === 1, "the row to be added");
      check("what it built needs no typing at all", () => {
        const r = rows()[0];
        eq(r.querySelector(".qlk-name").value, "Jira");
        eq(r.querySelector(".qlk-url").value, "https://gprxh.atlassian.net/browse/{{key}}");
        ok(r.querySelector(".qlk-search").value.indexOf("gprxh.atlassian.net") > -1, r.querySelector(".qlk-search").value);
        eq(peFirstBlank(r.querySelector(".qlk-url").value), null, "a blank was left in a URL read from a real address");
        ok(box.hidden, "and the chooser closed behind it");
      });
      check("the preview agrees that it is a working link", () => {
        const p = document.querySelectorAll("#quickList .qlk-preview")[0].textContent;
        ok(p.indexOf("https://gprxh.atlassian.net/browse/PROJ-123") > -1, p);
      });

      // The tracker nobody listed, which is the case the example list cannot serve at all.
      open();
      type("https://redmine.example.org/issues/45231");
      check("an unlisted numbered tracker is built, and says which part is left to you", () => {
        eq(hint().textContent, peMsg("optQuickPasteGuessNumbered", ["redmine.example.org"]));
        ok(!go().disabled);
      });
      go().click();
      await waitFor(() => rows().length === 2, "the second row");
      check("and the caret goes to the prefix, which is the decision it could not make", () => {
        const r = rows()[1];
        eq(r.querySelector(".qlk-url").value, "https://redmine.example.org/issues/{{key.num}}");
        eq(r.querySelector(".qlk-name").value, "redmine.example.org");
        eq(r.querySelector(".qlk-search").value, "");
        eq(document.activeElement, r.querySelector(".qlk-prefix"), "the caret is somewhere else");
      });`
  },
  {
    // Tab walking the blanks. Only a browser has a selection to move, and the failure worth
    // guarding is the one where Tab stops being Tab — a field the keyboard cannot leave is
    // worse than the two-blank example it was added for.
    name: "options · tabbing between the blanks",
    page: { name: "opt-quick-tab", ...OPTIONS, seed: seedOf({ quickLinks: [] }) },
    body: `
      document.querySelector('#tabs .tab[data-tab="items"]').click();
      document.getElementById("addQuickLink").click();
      const box = document.getElementById("quickExamples");
      // GitHub is the two-blank shape: ⟨owner⟩ and ⟨repo⟩ in the URL, and both again in the
      // search URL. Four blanks over two fields is most of the work the chooser was meant to
      // save, and all of it was being done by dragging over text.
      [...box.querySelectorAll(".qlk-ex")].find((r) => r.querySelector(".qlk-ex-name").textContent === "GitHub").click();
      await waitFor(() => document.querySelectorAll("#quickList .cpy-item").length === 1, "the row");
      const row = () => document.querySelectorAll("#quickList .cpy-item")[0];
      const url = () => row().querySelector(".qlk-url");
      const search = () => row().querySelector(".qlk-search");
      const sel = (f) => f.value.slice(f.selectionStart, f.selectionEnd);
      const tab = (f, shift) => f.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: !!shift, bubbles: true, cancelable: true }));
      const OWNER = "⟨" + peMsg("optQuickPartOwner") + "⟩";
      const REPO = "⟨" + peMsg("optQuickPartRepo") + "⟩";

      check("it opens on the first blank", () => {
        eq(document.activeElement, url());
        eq(sel(url()), OWNER);
      });
      check("Tab goes to the next blank rather than the next field", () => {
        tab(url());
        eq(document.activeElement, url(), "focus left the field");
        eq(sel(url()), REPO);
      });
      check("Shift+Tab goes back to the previous one", () => {
        tab(url(), true);
        eq(sel(url()), OWNER);
      });
      check("past the last blank it crosses into the search field, on its first blank", () => {
        tab(url());
        tab(url());
        eq(document.activeElement, search(), "it stayed in the URL field");
        eq(sel(search()), OWNER);
      });
      check("and once nothing is left, Tab is Tab again", () => {
        tab(search());
        eq(sel(search()), REPO, "the second one in the search URL");
        const e = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
        search().dispatchEvent(e);
        ok(!e.defaultPrevented, "the last blank trapped the caret in the box");
      });
      // Typing over a blank removes it, which is the whole point — the walk has to shorten as
      // the row gets filled rather than sending the caret back to text that is now real.
      check("a filled-in blank is no longer walked to", () => {
        const u = url();
        u.focus();
        const at = peFirstBlank(u.value);
        u.setSelectionRange(at[0], at[1]);
        u.setRangeText("gaerae", at[0], at[1], "end");
        u.dispatchEvent(new Event("input", { bubbles: true }));
        tab(u);
        eq(sel(u), REPO, "it went back to the part that is now a real owner");
      });`
  },
  {
    // Rule health is the answer to "a preset that stops matching is invisible", so the thing
    // to prove is that it is actually visible — which is a question about rendered rows, not
    // about the pure functions tools/test.js already covers. The seed is the Plane Cloud bug
    // as the storage would have recorded it: one rule working, two never matching.
    name: "options · rule health",
    page: {
      name: "opt-health",
      ...OPTIONS,
      seed: seedOf({
        rules: [
          { id: "r-live", enabled: true, label: "Working", selector: ".max-w-40", property: "max-width", value: "320px" },
          { id: "r-dead", enabled: true, label: "Dead", selector: ".gone", property: "display", value: "none" },
          { id: "r-new", enabled: true, label: "Just added", selector: ".fresh", property: "display", value: "none" },
          { id: "r-off", enabled: false, label: "Switched off", selector: ".nope", property: "display", value: "none" }
        ]
      }),
      local: {
        peRuleHealth: {
          "r-live": { checks: 40, hits: 12, at: 1754600000000 },
          "r-dead": { checks: 40, hits: 0, at: 0 },
          "r-new": { checks: 2, hits: 0, at: 0 },
          "r-off": { checks: 40, hits: 0, at: 0 }
        }
      }
    },
    body: `
      const rows = () => [...document.querySelectorAll("#ruleList .rule-item")];
      const healthOf = (i) => rows()[i].querySelector(".rule-health");
      const summary = document.getElementById("ruleHealthSummary");
      await waitFor(() => rows().length === 4, "the rules to render");
      // The rules live behind a tab, and nothing inside a hidden panel can take focus — so
      // the "does not disturb the row" check below would pass on a page where focus never
      // landed anywhere. Open the tab the way a reader does.
      document.querySelector('#tabs .tab[data-tab="appearance"]').click();
      await waitFor(() => !document.getElementById("panel-appearance").hidden, "the rules panel");

      check("a rule that has matched says when it last did, and does not shout", () => {
        const h = healthOf(0);
        ok(!h.hidden, "the badge is shown");
        ok(!h.classList.contains("cold"), "in the quiet style");
        ok(h.textContent.indexOf("2025") > -1 || /\\d{4}-\\d{2}-\\d{2}/.test(h.textContent), "a date: " + h.textContent);
      });
      check("a rule that has never matched says so, in the warning style", () => {
        const h = healthOf(1);
        ok(!h.hidden, "shown");
        ok(h.classList.contains("cold"), "and marked as the thing to look at");
        eq(h.textContent, peMsg("optRuleHealthCold"));
      });
      // The state that keeps this from becoming noise: too little evidence, so no claim.
      check("a rule nobody has measured yet says nothing at all", () => {
        const h = healthOf(2);
        ok(h.hidden, "no badge");
        eq(h.textContent, "", "and no text hiding behind the attribute");
      });
      check("a switched-off rule is not accused of anything", () => {
        ok(healthOf(3).hidden, "no badge on a rule that is not being applied");
      });
      // The count is what carries this to someone not reading row by row — which is exactly
      // how two dead presets went unnoticed for a release.
      check("the summary counts only the enabled rules that never matched", () => {
        ok(!summary.hidden, "the summary is shown");
        ok(summary.textContent.indexOf("1") > -1, "one rule: " + summary.textContent);
        ok(summary.textContent.indexOf("Plane") > -1, "and it says what to suspect");
      });
      check("the warning is legible against the card it sits on", () => {
        const c = contrast(getComputedStyle(summary).color, bg(summary));
        ok(c >= 4.5, "contrast " + c.toFixed(2));
      });
      // Arriving mid-edit is the normal case: a Plane tab writes this every time it changes
      // route. Rebuilding the rows would take the caret out of the field being typed in.
      const sel = rows()[1].querySelector(".rule-selector");
      sel.focus();
      sel.setSelectionRange(2, 2);
      window.__onChanged({ peRuleHealth: { newValue: { "r-dead": { checks: 41, hits: 1, at: 1754600000000 } } } }, "local");
      await waitFor(() => !healthOf(1).classList.contains("cold"), "the badge to update in place");
      check("a record arriving while the user types does not disturb the row", () => {
        ok(document.activeElement === sel, "focus left the selector field for " + document.activeElement.tagName + "." + document.activeElement.className);
        eq(sel.selectionStart, 2, "and so did the caret");
        ok(summary.hidden, "the summary went away with the last cold rule");
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
      // The one thing no data test can check: whether a class Plane writes as min-w-[300px]
      // or z-[5] is matched by the escaping we ship for it. Both generations are probed from
      // the one selector, and the near misses are probed too — a selector list is as easy to
      // widen by accident as to narrow, and .shrink-0.bg-surface-1 without the .z-[5] really
      // does catch an unrelated chip on Plane Cloud's cycles route.
      check("every preset selector is one the browser can read", () => {
        peFocusPresetRules().forEach((r) => document.querySelector(r.selector));
        const add = (cls) => {
          const el = document.createElement("div");
          el.className = cls;
          document.body.appendChild(el);
          return el;
        };
        const cases = [
          {
            id: "rule-focus-item-properties",
            hit: [
              "fixed right-0 z-[5] h-full w-full min-w-[300px] border-l border-subtle",
              "relative z-[5] h-full shrink-0 overflow-hidden bg-surface-1 motion-safe:transition-[width,min-width]"
            ],
            miss: ["shrink-0 bg-surface-1", "fixed right-0 border-l", "z-[5] overflow-hidden bg-surface-1"]
          },
          {
            id: "rule-focus-reading-width",
            hit: ["h-full w-full space-y-6 overflow-y-auto px-9 py-5", "h-full flex-1 min-w-0 overflow-y-auto px-8 py-6"],
            miss: ["overflow-y-auto px-8 py-5", "overflow-y-auto px-6 py-6"]
          }
        ];
        for (const c of cases) {
          const sel = peFocusPresetRules().find((r) => r.id === c.id).selector;
          const hits = c.hit.map(add);
          const misses = c.miss.map(add);
          const got = [...document.querySelectorAll(sel)];
          eq(got.length, hits.length, c.id + ": one match per generation, and no more");
          hits.forEach((el, i) => ok(got.indexOf(el) > -1, c.id + ": shape " + i + " is matched"));
          misses.forEach((el, i) => ok(got.indexOf(el) === -1, c.id + ": near miss " + i + " was caught"));
          hits.concat(misses).forEach((el) => el.remove());
        }
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
    // Recents and the copy block: the two things the popup can do from a tab alone. Neither
    // injects anything or reads a page, which is what lets them work on a tracker the rest
    // of the extension never runs on — the stub tab is a Plane URL only because QUICK's
    // first target is.
    name: "popup · recents and copy from the tab",
    page: {
      name: "pop-tab",
      ...POPUP,
      seed: seedOf(),
      local: {
        peRecent: [
          { key: "PROJ-7", url: "https://plane.example.com/acme/browse/PROJ-7", name: "Plane", at: 300 },
          { key: "ENG-9", url: "https://linear.app/acme/issue/ENG-9", name: "Linear", at: 200 },
          { key: "PROJ-1", url: "https://plane.example.com/acme/browse/PROJ-1", name: "Plane", at: 100 }
        ]
      }
    },
    body: `
      await waitFor(() => document.getElementById("domainStatus").textContent.indexOf("Checking") === -1, "the popup to resolve");
      const chips = () => [...document.querySelectorAll("#recentList .pop-recent-item")];

      check("the keys opened last are offered under the jump box", () => {
        ok(!document.getElementById("recentList").hidden, "the list is shown");
        eq(chips().map((c) => c.querySelector(".pop-recent-key").textContent), ["PROJ-7", "ENG-9", "PROJ-1"], "newest first");
        // A list spanning two trackers has to say which is which, or two keys that look
        // alike are indistinguishable.
        eq(chips()[1].querySelector(".pop-recent-name").textContent, "Linear");
      });
      // The placeholder had to say two things once the box took phrases as well as keys, and
      // the first wording it grew ("Issue key, or words to search…") was cut off mid-word at
      // this width. Nothing else would have caught it: a truncated placeholder is not an
      // error, it is just a sentence you cannot read. Korean is measured in the pop-ko suite.
      check("the jump placeholder fits the box it is in", () => {
        const input = document.getElementById("jumpKey");
        const probe = document.createElement("span");
        const cs = getComputedStyle(input);
        probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;font:" + cs.font;
        probe.textContent = input.placeholder;
        document.body.appendChild(probe);
        const room = input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const need = probe.getBoundingClientRect().width;
        probe.remove();
        ok(need <= room, "placeholder needs " + Math.ceil(need) + "px, has " + Math.floor(room) + "px: " + input.placeholder);
      });
      check("a chip fits its row rather than stretching it", () => {
        const box = document.getElementById("recentList").getBoundingClientRect();
        for (const c of chips()) {
          const r = c.getBoundingClientRect();
          ok(r.right <= box.right + 1, c.textContent + " overflows: " + Math.round(r.right) + " > " + Math.round(box.right));
        }
      });

      check("the copy block names the item the tab is showing", () => {
        ok(!document.getElementById("copyBlock").hidden, "shown");
        eq(document.getElementById("copyItem").textContent, "PROJ-7 Fix the login redirect", "key and title, from the tab alone");
      });
      // The reader has to be able to see what each button will put on the clipboard before
      // they press it — the popup has no preview row, so the title attribute is it.
      check("each format offers the text it would copy", () => {
        const btns = [...document.querySelectorAll(".pop-copy-fmt")];
        eq(btns.length, 1, "one format in this seed");
        eq(btns[0].textContent, "Chat");
        eq(btns[0].title, "PROJ-7 https://plane.example.com/acme/browse/PROJ-7");
      });
      // Three formats ship by default and five are allowed. The seed above has one, which is
      // why this stacked full-width in the real extension while the harness stayed green —
      // .pop-btn sets width:100% and the override was losing on source order. Add formats
      // here rather than trusting the single-row case.
      check("several formats share rows instead of stacking", () => {
        const box = document.getElementById("copyFormats");
        for (const name of ["Markdown", "Branch"]) {
          const b = document.createElement("button");
          b.className = "pop-btn ghost pop-copy-fmt";
          b.textContent = name;
          box.appendChild(b);
        }
        const btns = [...box.querySelectorAll(".pop-copy-fmt")];
        const tops = new Set(btns.map((b) => Math.round(b.getBoundingClientRect().top)));
        ok(tops.size < btns.length, "each button is on its own line: " + btns.length + " buttons, " + tops.size + " rows");
        for (const b of btns) {
          ok(b.getBoundingClientRect().width < box.getBoundingClientRect().width, b.textContent + " is full width");
        }
      });
      let copied = null;
      navigator.clipboard.writeText = (t) => { copied = t; return Promise.resolve(); };
      document.querySelector(".pop-copy-fmt").click();
      await waitFor(() => copied !== null, "the clipboard write");
      await sleep(20); // the label is set in the same promise chain, one tick later
      check("clicking one copies, and reports where the heading was", () => {
        eq(copied, "PROJ-7 https://plane.example.com/acme/browse/PROJ-7", "what reached the clipboard");
        eq(document.getElementById("copyLabel").textContent, peMsg("msgCopied"));
      });
      // Chrome sizes the popup to the DOCUMENT, not to .pop — so a child that overflows
      // .pop widens the window rather than being clipped by it, and the existing check on
      // .pop cannot see that. Everything added here is user-supplied and unbounded: a work
      // item title, a format name, a key.
      check("hostile content cannot widen the popup", () => {
        document.getElementById("copyItem").textContent =
          "PROJ-7 " + "a work item title nobody thought to keep short ".repeat(4);
        const b = document.createElement("button");
        b.className = "pop-btn ghost pop-copy-fmt";
        b.textContent = "a copy format name the user typed and never shortened";
        document.getElementById("copyFormats").appendChild(b);
        const chip = document.querySelector(".pop-recent-item");
        chip.querySelector(".pop-recent-key").textContent = "VERYLONGKEY-123456";
        // Two measurements, and both matter. "wants" is the document's preferred width,
        // which is the size Chrome gives a toolbar popup — with this content it is over a
        // thousand pixels, because a nowrap title only ellipsises once something constrains
        // it. "is" is what the stylesheet actually renders. The gap between them is the
        // whole point: the width has to be a property of the popup, not of its contents.
        document.body.style.width = "max-content";
        const wants = Math.round(document.body.getBoundingClientRect().width);
        document.body.style.width = "";
        const is = Math.round(document.body.getBoundingClientRect().width);
        eq(is, 260, "the popup is pinned");
        // Measured on <body>, not on documentElement: in a harness tab the latter reports the
        // tab's viewport width and would pass or fail for reasons that have nothing to do
        // with the popup.
        ok(document.body.scrollWidth <= 261, "content escapes the body: " + document.body.scrollWidth);
        return wants + "px wanted, " + is + "px rendered";
      });
      // Every block at once, which is a state no single suite otherwise produces — and the
      // one most likely to be on screen when someone reports the popup opening wide.
      check("no combination of blocks widens it either", () => {
        for (const id of ["permNotice", "addDomain", "focusWrap", "pickEl", "rescan", "jumpBlock", "copyBlock", "recentList"]) {
          const e = document.getElementById(id);
          if (e) e.hidden = false;
        }
        const sel = document.getElementById("jumpTarget");
        sel.hidden = false;
        sel.innerHTML = "";
        // An unnamed quick link shows its whole URL as the option text.
        for (const t of ["Auto", "https://plane.hectoai.co.kr/hecto/browse/{{key}}"]) {
          const o = document.createElement("option");
          o.textContent = t;
          sel.appendChild(o);
        }
        eq(Math.round(document.body.getBoundingClientRect().width), 260, "with everything shown");
        ok(document.body.scrollWidth <= 261, "content escapes the body: " + document.body.scrollWidth);
      });
      check("clicking a recent chip opens it", () => {
        chips()[1].click();
        eq(window.__opened, "https://linear.app/acme/issue/ENG-9");
      });`
  },
  {
    // A tab that is not a work item. The block has to be absent, not present and inert — a
    // "Copy reference" heading over nothing is a bug report waiting to be filed.
    name: "popup · a tab that is not an item",
    page: {
      name: "pop-tab-none",
      ...POPUP,
      seed: seedOf({ quickLinks: [{ id: "q", name: "Plane", prefix: "", url: "https://plane.example.com/acme/browse/{{key}}", enabled: true }] }),
      local: { peRecent: [] }
    },
    body: `
      await waitFor(() => document.getElementById("domainStatus").textContent.indexOf("Checking") === -1, "the popup to resolve");
      // The stub tab IS an item URL, so make it not one the only way that matters here: a
      // link list that cannot recognise it. (peSanitizeSettings would drop a urlless link.)
      check("nothing is claimed when no template matches", () => {
        const m = peMatchItemUrl([{ id: "x", enabled: true, url: "https://elsewhere.test/i/{{key}}" }], "https://plane.example.com/acme/browse/PROJ-7");
        eq(m, null);
      });
      check("an empty recents list shows no row at all", () => {
        ok(document.getElementById("recentList").hidden, "hidden, not an empty box with a gap");
      });`
  },
  {
    name: "popup · active site",
    page: { name: "pop-active", ...POPUP, seed: seedOf() },
    body: `
      await waitFor(() => document.getElementById("domainStatus").textContent.indexOf("Checking") === -1, "the popup to resolve the site");
      const visible = () => [...document.querySelectorAll(".pop > *, .pop-scroll > *, .pop-foot > *")].filter((e) => !e.hidden && getComputedStyle(e).display !== "none" && e.className.indexOf("pop-scroll") === -1 && e.className.indexOf("pop-foot") === -1);
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
      // The other half of bounding the popup: a short one has to stay short. A window padded
      // out to the cap with empty space, and a scrollbar on a box with nothing to scroll, are
      // the same bug seen from the other side.
      check("a short popup is short, with no scrollbar on it", () => {
        const h = document.documentElement.scrollHeight;
        // 469 measured. The number that matters is the cap: height:588 instead of
        // max-height:588 would put this at 588 with 119px of nothing under the footer.
        ok(h < 520, "the popup is " + h + "px with almost nothing in it");
        const scroll = document.getElementById("popScroll");
        eq(scroll.offsetWidth - scroll.clientWidth, 0, "a scrollbar on a box that does not overflow");
        return h + "px";
      });
      check("no site action is offered while it is off", () => {
        for (const id of ["addDomain", "pickEl", "rescan", "focusWrap"]) ok(document.getElementById(id).hidden, id);
      });`
  },
  {
    // The picker's list, built from a real element. tools/test.js argues about the ranking;
    // what only a browser can answer is which candidates get generated at all — the bug that
    // started this was that attributes were never offered, so on a page whose classes are
    // all hashes the list held nothing worth picking however far you scrolled.
    //
    // The target carries, on one element, every shape measured on 2026-08-08: a per-item
    // uuid id (Plane Cloud), a data attribute with a uuid value and one with a real value
    // (Linear), an aria-label (Linear), hashed classes (Linear) and Tailwind (Plane).
    name: "content · picker candidates",
    page: {
      name: "ct-picker",
      plane: `
        <div id="editor-container-d833e58d-d489-433e-9551-c2ab0768068d"
             data-view-id="8f14e45f-ceea-467a-9f36-dcd8ab4d3f21"
             data-restore-scroll-view="issue-view"
             aria-label="Issue description"
             class="sx-3nfvp2 max-w-40 sx-16dsc37 truncate">pick me</div>
        <div class="max-w-40">another element sharing the width class</div>`,
      seed: seedOf({ allDomains: true })
    },
    body: `
      await waitFor(() => window.__peLoaded, "the content script to load");
      await sleep(200);
      await new Promise((r) => window.__onMessage({ type: "pe-start-picker" }, {}, r));
      const target = document.querySelector('[aria-label="Issue description"]');
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await waitFor(() => document.getElementById("pe-pick-menu"), "the candidate list");
      const rows = () => [...document.querySelectorAll("#pe-pick-menu .pe-pick-item")];
      const sels = () => rows().map((r) => r.querySelector(".pe-pick-sel").textContent);

      // The whole point of the change: these did not exist in the list before.
      check("attribute candidates are offered at all", () => {
        const s = sels();
        ok(s.indexOf('[aria-label="Issue description"]') > -1, "aria-label: " + s.join(" | "));
        ok(s.indexOf('[data-restore-scroll-view="issue-view"]') > -1, "a data attribute with its value");
        ok(s.indexOf("[data-view-id]") > -1, "and one whose value is a uuid, offered by presence only");
      });
      check("a generated id also yields the prefix form the shipped preset writes by hand", () => {
        ok(sels().indexOf('[id^="editor-container"]') > -1, sels().join(" | "));
      });
      check("the stable handles are what the list opens with", () => {
        const s = sels();
        ok(!rows()[0].classList.contains("generated"), "the first row is not one that expires: " + s[0]);
        // The uuid id is the most precise selector on this element and the least durable, so
        // "most precise first" is exactly the instinct being corrected here.
        ok(s.indexOf('#editor-container-d833e58d-d489-433e-9551-c2ab0768068d') > 2, "the uuid id sank: " + s.join(" | "));
        // A hashed class below the Tailwind one, which is below every attribute.
        ok(s.indexOf(".max-w-40") < s.indexOf(".sx-3nfvp2"), "Tailwind above the hash");
        ok(s.indexOf('[aria-label="Issue description"]') < s.indexOf(".max-w-40"), "attributes above Tailwind");
      });
      // Order alone is not legible — a reader has nothing to compare a position against, and
      // a dimmed row reads as the normal colour. It was reported as exactly that: "I thought
      // grey was the default." So the ranking has to be said in words, twice: a heading over
      // each group, and the kind of handle on each row.
      check("the two groups are named, in order", () => {
        const heads = [...document.querySelectorAll("#pe-pick-menu .pe-pick-group")].map((g) => g.textContent);
        eq(heads, [peMsg("pickGroupDurable"), peMsg("pickGroupExpiring")], "both headings, durable first");
      });
      check("every row says what kind of handle it is", () => {
        const pairs = rows().map((r) => [r.querySelector(".pe-pick-sel").textContent, r.querySelector(".pe-pick-kind").textContent]);
        for (const [sel, kind] of pairs) ok(kind, "no kind on " + sel);
        const kindOf = (sel) => (pairs.find((p) => p[0] === sel) || [])[1];
        eq(kindOf("[data-view-id]"), peMsg("pickKindData"));
        eq(kindOf(".max-w-40"), peMsg("pickKindClass"));
        eq(kindOf('[id^="editor-container"]'), peMsg("pickKindIdPrefix"));
      });
      check("the two verdicts differ in word and in colour, side by side", () => {
        const of = (sel) => rows().find((r) => r.querySelector(".pe-pick-sel").textContent === sel).querySelector(".pe-pick-life");
        const good = of(".max-w-40");
        const bad = of(".sx-3nfvp2");
        eq(good.textContent, peMsg("pickLifeLasts"));
        eq(bad.textContent, peMsg("pickLifeChanges"));
        ok(getComputedStyle(good).color !== getComputedStyle(bad).color, "same colour");
        for (const l of [good, bad]) {
          const c = contrast(getComputedStyle(l).color, bg(l));
          ok(c >= 4.5, l.textContent + ": contrast " + c.toFixed(2));
        }
      });
      check("the hashes sit under the second heading, not scattered", () => {
        const marked = rows().filter((r) => r.classList.contains("generated"));
        const names = marked.map((r) => r.querySelector(".pe-pick-sel").textContent);
        ok(names.indexOf(".sx-3nfvp2") > -1, "the hash is in it: " + names.join(" | "));
        ok(names.indexOf(".max-w-40") === -1, "and Tailwind is not");
        ok(names.indexOf('[aria-label="Issue description"]') === -1, "nor the aria-label");
        // Grouped means contiguous: the marked rows must be the tail of the list, or the
        // heading above them is describing rows it does not cover.
        const all = rows();
        const firstMarked = all.findIndex((r) => r.classList.contains("generated"));
        ok(all.slice(firstMarked).every((r) => r.classList.contains("generated")), "the groups interleave");
      });
      check("both headings are legible", () => {
        for (const g of document.querySelectorAll("#pe-pick-menu .pe-pick-group")) {
          const c = contrast(getComputedStyle(g).color, bg(document.getElementById("pe-pick-menu")));
          ok(c >= 4.5, g.textContent + ": contrast " + c.toFixed(2));
        }
      });
      check("the counts are still real", () => {
        const row = rows().find((r) => r.querySelector(".pe-pick-sel").textContent === ".max-w-40");
        eq(row.querySelector(".pe-pick-count").textContent, peMsg("pickMatches", ["2"]), "two elements carry it");
      });`
  },
  {
    // The other half of rule health: the settings page can only show what the content script
    // measured, and only a browser can say whether it measured the right thing. The rules are
    // chosen to be the two cases side by side — one that matches the synthetic Plane page and
    // one that matches nothing on it.
    name: "content · rule health",
    page: {
      name: "ct-health",
      plane: PLANE,
      seed: seedOf({
        allDomains: true,
        rules: [
          { id: "r-live", enabled: true, selector: "#main-sidebar", property: "display", value: "none" },
          { id: "r-dead", enabled: true, selector: ".not-on-this-page", property: "display", value: "none" },
          { id: "r-off", enabled: false, selector: "#probe-props", property: "display", value: "none" },
          { id: "r-broken", enabled: true, selector: "((", property: "display", value: "none" }
        ]
      })
    },
    body: `
      const health = () => (window.__LOCAL.peRuleHealth || {});
      await waitFor(() => Object.keys(health()).length > 0, "the first measurement to be written");

      check("what matched and what did not are both recorded", () => {
        eq(health()["r-live"].hits, 1, "the rule that matches the page");
        eq(health()["r-live"].checks, 1, "checked once");
        ok(health()["r-live"].at > 0, "and stamped with when it worked");
        eq(health()["r-dead"].hits, 0, "the rule that matches nothing");
        eq(health()["r-dead"].checks, 1, "was still checked — that is the whole difference");
        eq(health()["r-dead"].at, 0, "and has no time to report");
      });
      // Two rules that must never reach the record: one nobody applies, and one the browser
      // cannot read. The second matters because "selector is nonsense" is already reported
      // where it is typed, and counting it here would say the same thing in a worse place.
      check("a disabled rule and an unreadable selector are not measured", () => {
        ok(!("r-off" in health()), "disabled");
        ok(!("r-broken" in health()), "unreadable");
      });

      // Once per route, not once per mutation burst — injectAll runs on every one of those,
      // and a write per burst would be a storage write per keystroke on a busy page.
      const writes = window.__localWrites;
      for (let i = 0; i < 5; i++) {
        document.body.appendChild(Object.assign(document.createElement("div"), { className: "ProseMirror" }));
        await sleep(60);
      }
      await sleep(3000);
      check("mutations alone do not re-measure", () => eq(window.__localWrites, writes, "extra writes"));

      // A rule aimed at something that only exists while a menu is open. The route sample
      // will always miss it, which is how the shipped dropdown preset came to be reported
      // dead; the click scan is what rescues it. Both halves are here because the safe part
      // is that the rescue counts hits and never misses.
      const dead = () => health()["r-dead"].checks;
      const missesBefore = dead();
      const transient = Object.assign(document.createElement("div"), { className: "not-on-this-page" });
      document.body.appendChild(transient);
      document.body.click();
      await waitFor(() => health()["r-dead"].hits === 1, "the click scan to see it");
      check("a click rescues a rule that is only there while something is open", () => {
        eq(health()["r-dead"].hits, 1, "seen once");
        ok(health()["r-dead"].at > 0, "and stamped");
      });
      transient.remove();
      const deadChecks = dead();
      const liveChecks = health()["r-live"].checks;
      // Past the scan's own throttle, so the click below definitely produces one — otherwise
      // this passes by not running, which is the failure mode it exists to rule out.
      await sleep(4200);
      document.body.click();
      await waitFor(() => health()["r-live"].checks > liveChecks, "a scan to have run");
      check("and a scan with nothing open accuses nobody", () => {
        // The discriminating value: r-live matches either way, so only the rule that is now
        // absent can tell a hits-only pass from a full one.
        eq(dead(), deadChecks, "the absent rule was not counted as a miss");
        eq(health()["r-dead"].hits, 1, "and still remembers the one time it was there");
      });

      // Counted against a baseline rather than an absolute, because the click scans above
      // legitimately move r-live's numbers — it matches, so a hit-only pass counts it.
      // r-dead is the one whose miss count only a route sample may raise.
      const beforeRoute = { live: health()["r-live"].checks, dead: dead() };
      history.pushState({}, "", location.pathname + "?route=2");
      document.body.appendChild(document.createElement("div"));
      await waitFor(() => dead() === beforeRoute.dead + 1, "the new route to be measured");
      check("a route change is what triggers the next full measurement", () => {
        eq(health()["r-live"].checks, beforeRoute.live + 1, "the matching rule counted once more");
        eq(health()["r-dead"].checks, beforeRoute.dead + 1, "and so did the one that misses");
        eq(health()["r-dead"].hits, 1, "whose single sighting still stands");
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
      const propsCloud = document.getElementById("probe-props-cloud");
      const propsDecoy = document.getElementById("probe-props-decoy");
      const nav = document.getElementById("main-sidebar");
      const bodyCol = document.getElementById("probe-body");
      const bodyColCloud = document.getElementById("probe-body-cloud");
      const width = document.getElementById("probe-width");
      const shown = (el) => getComputedStyle(el).display !== "none";
      const send = (msg) => new Promise((r) => window.__onMessage(msg, {}, r));
      const focusClass = () => document.documentElement.classList.contains("pe-focus");
      const stored = () => sessionStorage.getItem("pe-focus");
      const toasts = () => [...document.querySelectorAll(".pe-toast")].map((t) => t.textContent);

      await waitFor(() => getComputedStyle(width).maxWidth === "320px", "the always-on rules to be injected");
      check("nothing is hidden until it is asked for", () => {
        ok(shown(props), "the properties panel is where Plane put it");
        ok(shown(propsCloud), "and so is Cloud's");
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
      // Six keys are on this page: the parent's, a copyable chip's, this item's, two sub-items'
      // and one relation's. One button of each kind, on the one key that is this item's.
      check("the keys of sub-items and relations are left alone", () => {
        const keys = [...document.querySelectorAll("#probe-header button")]
          .filter((b) => /^[A-Za-z0-9]{1,12}-[1-9]\\d*$/.test((b.textContent || "").trim()))
          .map((b) => b.textContent.trim());
        eq(keys.join(","), "PROJ-100,PROJ-9,PROJ-142,PROJ-201,PROJ-202,PROJ-77", "the keys on the page");
        eq(document.querySelectorAll(".pe-copy-ref-btn").length, 1, "one copy button");
        eq(document.querySelectorAll(".pe-focus-btn").length, 1, "one focus toggle");
        for (const k of ["PROJ-100", "PROJ-9", "PROJ-201", "PROJ-202", "PROJ-77"]) {
          const other = [...document.querySelectorAll("#probe-header button")].find(
            (b) => (b.textContent || "").trim() === k
          );
          const next = other.parentElement.nextElementSibling;
          ok(!next || !/pe-(copy-ref|focus)-btn/.test(next.className || ""), "a button landed beside " + k);
        }
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
      // The half that shipped broken. Both shapes come from one selector list, so a change
      // that drops either end of it fails here rather than on somebody's Cloud workspace.
      check("both generations of the panel answer to the one preset", () => {
        ok(!shown(propsCloud), "Plane Cloud's properties panel went away too");
        ok(shown(propsDecoy), "and the cycles-route chip beside it did not");
      });
      document.querySelector(".pe-focus-btn").click();
      check("clicking it again brings the panels back", () => {
        eq(document.querySelector(".pe-focus-btn").getAttribute("aria-pressed"), "false");
        ok(shown(props), "properties panel back");
        ok(shown(propsCloud), "Cloud's too");
      });

      const on = await send({ type: "pe-focus-toggle" });
      check("one message hides both panels", () => {
        eq(on.ok, true, "the site is one we run on");
        eq(on.focus, true, "and it reports the new position");
        ok(!shown(props), "properties panel hidden");
        ok(!shown(propsCloud), "Cloud's properties panel hidden");
        ok(!shown(nav), "navigation hidden");
        ok(focusClass(), "<html> carries the state a rule can hang off");
      });
      // The bug this is here for: a focus rule and an ordinary one share a stylesheet, and an
      // implementation that rebuilt only the focus half would drop the width rules on toggle.
      check("the rules that were already on stay on", () => eq(getComputedStyle(width).maxWidth, "320px"));
      check("a preset that ships switched off stays off", () => {
        eq(getComputedStyle(bodyCol).paddingLeft, "0px", "the reading-width rule is disabled, so it applies to nothing");
        eq(getComputedStyle(bodyColCloud).paddingLeft, "0px", "on either generation's body column");
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
        ok(shown(propsCloud), "Cloud's too");
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
      });
      // A placeholder does not wrap and is not caught by anything above: it is simply cut
      // off, which reads as a shorter sentence rather than as a broken one. Korean is the
      // case that matters, since it is measured wider per character than the English the
      // wording was chosen against.
      check("the Korean jump placeholder fits the box", () => {
        const input = document.getElementById("jumpKey");
        const probe = document.createElement("span");
        const cs = getComputedStyle(input);
        probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;font:" + cs.font;
        probe.textContent = input.placeholder;
        document.body.appendChild(probe);
        const room = input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const need = probe.getBoundingClientRect().width;
        probe.remove();
        ok(need <= room, "needs " + Math.ceil(need) + "px, has " + Math.floor(room) + "px: " + input.placeholder);
        return Math.ceil(need) + "/" + Math.floor(room) + "px";
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
        const first = [...document.querySelectorAll(".pop-scroll > *")].filter((e) => !e.hidden && getComputedStyle(e).display !== "none")[0];
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
