#!/usr/bin/env node
// capture-ui.js — real captures of the extension's own screens, for the store assets.
//
//   node store-assets/capture-ui.js          # popup + settings, both languages
//
// The five screenshot-*.html templates draw everything by hand, including a Chrome window
// and a Chrome omnibox that do not exist. That reads as an illustration, because it is one.
// This produces the opposite: the shipped popup.html and options.html, the shipped CSS byte
// for byte, rendered by a real browser at 2x. Only `chrome` is stubbed — the same technique
// tools/dom-harness.js uses to assert against these pages, so what lands in the PNG is what
// the checks are run against.
//
// What it cannot reach, and why the templates still exist: the omnibox dropdown and the
// toolbar popup as Chrome frames them are browser UI, outside every page's viewport. No
// page-level capture can photograph them; that needs a screen recording of a real window.
//
// The seed below is a plausible install, not the user's. Every value here is invented —
// `acme.atlassian.net`, PROJ-123 — because a store image is published forever and a real
// workspace's project names are not ours to publish.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "ui");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pe-ui-"));
const CHROME = process.env.PE_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const fileUrl = (p) => "file://" + path.resolve(p);
const catalogue = (lang) => fs.readFileSync(path.join(ROOT, "_locales", lang, "messages.json"), "utf8");

// A plausible install. Two quick links so the preview lines have something to say, three
// copy formats, a couple of rules — enough that the page looks used rather than empty.
const SEED = {
  peSettings: {
    schema: 8,
    enabled: true,
    allDomains: false,
    domains: ["app.plane.so", "plane.acme.com"],
    rules: [
      { id: "r1", enabled: true, label: "Module / item name width", selector: ".max-w-40", property: "max-width", value: "320px" },
      { id: "r2", enabled: true, label: "Search dropdown width", selector: '[id^="headlessui-combobox-options"] > div, [data-base-ui-portal] [role="dialog"]:has(input)', property: "width", value: "320px" },
      { id: "r3", enabled: true, focus: true, label: "Focus: hide the work item properties panel", selector: ".fixed.right-0.border-l.min-w-\\[300px\\], .z-\\[5\\].shrink-0.bg-surface-1", property: "display", value: "none" }
    ],
    quickLinks: [
      { id: "q1", name: "Plane", prefix: "", enabled: true, url: "https://plane.acme.com/acme/browse/{{key}}", searchUrl: "https://plane.acme.com/acme/search/?q={{q}}" },
      { id: "q2", name: "Jira", prefix: "OPS-", enabled: true, url: "https://acme.atlassian.net/browse/{{key}}", searchUrl: 'https://acme.atlassian.net/issues/?jql=text ~ "{{q}}"' }
    ],
    copyFormats: [
      { id: "c1", name: "Chat", format: "{{item.key}} {{item.title}} — {{item.url}}" },
      { id: "c2", name: "Markdown", format: "[{{item.key}} {{item.title}}]({{item.url}})" },
      { id: "c3", name: "Branch", format: "feature/{{item.key}}" }
    ],
    templates: [
      { id: "t1", name: "🐞 Bug report", title: "[Bug] ", content: "## Steps\n1. \n" },
      { id: "t2", name: "🚀 Release checklist", title: "[Release] {{date}}", content: "- [ ] Tag\n" }
    ],
    variables: [{ name: "team", value: "Platform" }],
    templateSync: { enabled: false, sources: [] }
  }
};
const LOCAL = {
  peRecent: [
    { key: "PROJ-142", url: "https://plane.acme.com/acme/browse/PROJ-142", name: "Plane", at: 500 },
    { key: "OPS-214", url: "https://acme.atlassian.net/browse/OPS-214", name: "Jira", at: 400 },
    { key: "PROJ-97", url: "https://plane.acme.com/acme/browse/PROJ-97", name: "Plane", at: 300 }
  ]
};
const TAB = { id: 1, url: "https://plane.acme.com/acme/browse/PROJ-142", title: "PROJ-142 Checkout fails on Safari" };

// Only what these two pages touch. Every method answers as a promise AND a callback: the
// popup awaits permissions.contains, and a callback-only stub resolves to undefined, which
// read as "this origin is not granted" and put a warning nobody configured into the capture.
function stub(lang) {
  const both = (v) => `(...a) => { const cb = a[a.length - 1]; if (typeof cb === "function") cb(${v}); return Promise.resolve(${v}); }`;
  return `<script>
const __CAT = ${catalogue(lang)};
function __msg(key, subs) {
  const e = __CAT[key];
  if (!e) return "";
  let m = e.message || "";
  if (e.placeholders) for (const [n, s] of Object.entries(e.placeholders)) {
    const i = parseInt(String(s.content).replace("$", ""), 10) - 1;
    m = m.replace(new RegExp("\\\\$" + n + "\\\\$", "gi"), subs && subs[i] != null ? subs[i] : "");
  }
  return m;
}
const __SEED = ${JSON.stringify(SEED)};
const __LOCAL = ${JSON.stringify(LOCAL)};
window.chrome = {
  i18n: { getMessage: (k, s) => __msg(k, s), getUILanguage: () => "${lang}" },
  runtime: { id: "capture", getURL: (p) => p, sendMessage: ${both("undefined")}, onMessage: { addListener() {} }, lastError: null, openOptionsPage() {} },
  storage: {
    sync: { get: ${both("JSON.parse(JSON.stringify(__SEED))")}, set: ${both("undefined")}, getBytesInUse: ${both("4096")}, remove: ${both("undefined")} },
    local: { get: ${both("JSON.parse(JSON.stringify(__LOCAL))")}, set: ${both("undefined")}, getBytesInUse: ${both("2048")}, remove: ${both("undefined")} },
    onChanged: { addListener() {} }
  },
  permissions: {
    contains: ${both("true")},
    request: ${both("true")},
    getAll: ${both('{ origins: ["https://app.plane.so/*", "https://plane.acme.com/*"] }')},
    remove: ${both("true")}
  },
  tabs: { query: ${both("[" + JSON.stringify(TAB) + "]")}, sendMessage: ${both("undefined")}, create() {}, reload() {} },
  action: { setBadgeText() {}, setBadgeBackgroundColor() {}, setTitle() {} },
  alarms: { create() {}, clear() {}, onAlarm: { addListener() {} } },
  scripting: { getRegisteredContentScripts: ${both("[]")}, registerContentScripts: ${both("undefined")}, unregisterContentScripts: ${both("undefined")} },
  commands: { getAll: ${both("[]")} }
};
<\/script>`;
}

// The shipped HTML with its own stylesheet and scripts, only repointed at absolute paths.
// Replacer functions throughout, never replacement strings — the catalogue goes in here and
// one "$NAME$'s" in a message would otherwise expand $' into the rest of the file.
function build(name, html, css, js, lang) {
  let src = fs.readFileSync(path.join(ROOT, html), "utf8");
  const put = (re, text) => (src = src.replace(re, () => text));
  put(new RegExp(`href="${css}"`), `href="${fileUrl(path.join(ROOT, css))}"`);
  for (const f of ["common.js", js]) put(new RegExp(`src="${f}"`), `src="${fileUrl(path.join(ROOT, f))}"`);
  put(/src="icons\//g, `src="${fileUrl(path.join(ROOT, "icons"))}/`);
  put(/<script src="file:[^"]*common\.js"><\/script>/, stub(lang) + "\n" + `<script src="${fileUrl(path.join(ROOT, "common.js"))}"></script>`);
  put("</head>", "<style>*, *::before, *::after { transition: none !important; animation: none !important; }</style>\n</head>");
  const p = path.join(TMP, name + ".html");
  fs.writeFileSync(p, src);
  return p;
}

function shoot(page, out, w, h) {
  execFileSync(
    CHROME,
    ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2",
      `--window-size=${w},${h}`, "--virtual-time-budget=4000", `--screenshot=${out}`, "file://" + page],
    { stdio: "ignore" }
  );
  console.log(path.relative(ROOT, out));
}

if (!fs.existsSync(CHROME)) {
  console.error("Chrome not found — set PE_CHROME=/path/to/chrome");
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });
for (const lang of ["en", "ko"]) {
  const sfx = lang === "en" ? "" : "." + lang;
  // 300 wide, not 260: Chrome's popup frame adds its own margin, and a capture cropped to
  // exactly the popup width reads as a screenshot of a screenshot.
  shoot(build("popup-" + lang, "popup.html", "popup.css", "popup.js", lang), path.join(OUT, "popup" + sfx + ".png"), 300, 640);
  shoot(build("settings-" + lang, "options.html", "options.css", "options.js", lang), path.join(OUT, "settings" + sfx + ".png"), 1280, 900);
}
try {
  fs.rmSync(TMP, { recursive: true, force: true });
} catch (_) {
  /* a temp dir left behind is not worth failing over */
}
