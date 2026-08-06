#!/usr/bin/env node
// check-i18n.js — guards the translation contract. Run: node tools/check-i18n.js
//
// Every feature change tends to add UI strings, and the ways that silently go wrong
// are always the same: a key referenced but never defined, a locale left behind, a
// placeholder renamed on one side only, or a term translated two different ways.
// This encodes those rules so they fail loudly instead of shipping.
//
// English (_locales/en) is the reference locale. Errors exit 1. Warnings cover the
// heuristic rules (terminology, unused keys) and only report — pass --strict to fail
// on them too, which is what CI does, so a wrong term cannot slip by unnoticed.

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LOCALES_DIR = path.join(ROOT, "_locales");
const REF = "en";

// Files that may reference message keys.
const SOURCES = ["common.js", "background.js", "content.js", "options.js", "popup.js", "options.html", "popup.html", "manifest.json"];

// Terms that must be rendered consistently. Keeps one feature from calling it
// "동기화" while the next calls it "싱크". Checked only when the reference message
// uses the term as a whole word.
const GLOSSARY = {
  ko: [
    ["template", "템플릿"],
    ["sync", "동기화"],
    ["source", "소스"],
    ["group", "그룹"],
    ["domain", "도메인"],
    ["rule", "규칙"],
    ["settings", "설정"],
    ["save", "저장"],
    ["picker", "선택기"]
  ]
};

// Assigned once the catalogues are read. Declared here, not at first use: report() can
// run before that point (a parse failure bails out early), and touching a const still in
// its temporal dead zone throws a ReferenceError that buries the error being reported.
let refKeys = null;
const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

/* ---------- load ---------- */
const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((d) => fs.statSync(path.join(LOCALES_DIR, d)).isDirectory())
  .sort();

if (!locales.includes(REF)) {
  console.error(`FATAL: reference locale "${REF}" missing`);
  process.exit(1);
}

// A duplicate key is legal JSON and the last one silently wins, so JSON.parse can never
// see it — and every check below runs on the parsed object. That is not hypothetical: a
// second "optQuickAdd" added for a new button quietly took over the style-rule chips label
// that already used that name, in both locales, and shipped. Scan the raw text for the
// top-level keys before parsing.
function duplicateKeys(text) {
  const seen = new Set();
  const dupes = new Set();
  // Top-level entries only: they sit at exactly two spaces of indent in these catalogues.
  for (const m of text.matchAll(/^ {2}"([A-Za-z0-9_]+)"\s*:/gm)) {
    if (seen.has(m[1])) dupes.add(m[1]);
    seen.add(m[1]);
  }
  return [...dupes];
}

const catalogs = {};
let parseFailed = false;
for (const loc of locales) {
  const file = path.join(LOCALES_DIR, loc, "messages.json");
  try {
    const text = fs.readFileSync(file, "utf8");
    for (const k of duplicateKeys(text)) {
      err(`[${loc}] "${k}" is defined more than once — the last one silently wins`);
    }
    catalogs[loc] = JSON.parse(text);
  } catch (e) {
    err(`[${loc}] messages.json is not valid JSON: ${e.message}`);
    parseFailed = true;
  }
}
// Only a parse failure has to stop here — without a catalogue nothing below can run. A
// duplicate key parses fine, so it is reported alongside everything else in one pass
// rather than hiding whatever else is wrong.
if (parseFailed) {
  report();
}

refKeys = Object.keys(catalogs[REF]);

/* ---------- collect key references from source ---------- */
// The i18n helper documents `data-i18n="key"` in its own comment block, which would
// otherwise register as a reference to a key named "key".
//
// Deliberately line-based: this codebase is full of match patterns like "*://*/*", and
// a regex that hunts for comment delimiters reads the "/*" inside those strings as a
// comment opener and swallows the rest of the file — which silently hid most of
// common.js from these scans. Telling a comment from a string needs a real JS lexer,
// which is not worth carrying here, so this only removes whole-line comments (and
// keeps line numbers intact for reporting).
function stripComments(src) {
  return src
    .split("\n")
    .map((line) => (/^\s*(\/\/|\/\*|\*)/.test(line) ? "" : line))
    .join("\n");
}

const refs = new Map(); // key -> Set(file)
const callArity = []; // { key, args, file }
function addRef(key, file) {
  if (!refs.has(key)) refs.set(key, new Set());
  refs.get(key).add(file);
}

for (const f of SOURCES) {
  const full = path.join(ROOT, f);
  if (!fs.existsSync(full)) continue;
  const raw = fs.readFileSync(full, "utf8");
  const src = f.endsWith(".js") ? stripComments(raw) : raw;

  for (const m of src.matchAll(/data-i18n(?:-[a-z-]+)?="([A-Za-z0-9_]+)"/g)) addRef(m[1], f);
  for (const m of src.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) addRef(m[1], f);
  for (const m of src.matchAll(/labelKey:\s*"([A-Za-z0-9_]+)"/g)) addRef(m[1], f);

  // peMsg("key") / peMsg("key", [a, b]) — capture how many substitutions are passed.
  // The key may also be chosen inline (`peMsg(cond ? "a" : "b")`), so every literal in
  // the first argument counts as a reference; anything after the first comma is a
  // substitution value, not a key.
  for (const m of src.matchAll(/peMsg\(\s*([^,)]*)\s*(,)?/g)) {
    const keys = [...m[1].matchAll(/"([A-Za-z0-9_]+)"/g)].map((k) => k[1]);
    if (!keys.length) continue; // computed key — nothing to verify here
    for (const k of keys) addRef(k, f);
    const key = keys[0];
    let args = 0;
    if (m[2]) {
      // Count top-level commas inside the substitution array literal.
      const rest = src.slice(m.index + m[0].length);
      const open = rest.indexOf("[");
      if (open !== -1 && rest.slice(0, open).trim() === "") {
        let depth = 0;
        let i = open;
        let count = 1;
        for (; i < rest.length; i++) {
          const c = rest[i];
          if (c === "[" || c === "(") depth++;
          else if (c === "]" || c === ")") {
            depth--;
            if (depth === 0) break;
          } else if (c === "," && depth === 1) count++;
        }
        args = count;
      } else {
        args = 1; // a single non-array substitution
      }
    }
    callArity.push({ key, args, file: f });
  }
}

/* ---------- rules ---------- */

// 1. every referenced key exists in the reference locale
for (const [key, files] of refs) {
  if (!catalogs[REF][key]) err(`missing key "${key}" in _locales/${REF} (used in ${[...files].join(", ")})`);
}

// 2. every defined key is actually used
for (const key of refKeys) {
  if (!refs.has(key)) warn(`unused key "${key}" in _locales/${REF} — remove it or wire it up`);
}

// 3. locale parity against the reference
for (const loc of locales) {
  if (loc === REF) continue;
  const keys = Object.keys(catalogs[loc]);
  for (const k of refKeys) if (!keys.includes(k)) err(`[${loc}] missing translation for "${k}"`);
  for (const k of keys) if (!refKeys.includes(k)) err(`[${loc}] has "${k}" which does not exist in ${REF}`);
}

// 4. placeholder hygiene, per locale
for (const loc of locales) {
  for (const [key, entry] of Object.entries(catalogs[loc])) {
    const msg = entry.message;
    if (typeof msg !== "string") {
      err(`[${loc}] "${key}" has no message string`);
      continue;
    }
    const ph = entry.placeholders || {};

    // Bare $1 in a message body is NOT documented by Chrome or MDN — only declared
    // placeholders are. Anything positional must go through a placeholder.
    const bare = msg.replace(/\$\$/g, "").match(/\$\d/g);
    if (bare) err(`[${loc}] "${key}" uses bare ${bare.join(", ")} — declare a placeholder instead`);

    const used = new Set([...msg.matchAll(/\$([A-Za-z0-9_]+)\$/g)].map((m) => m[1].toLowerCase()));
    const declared = new Set(Object.keys(ph).map((n) => n.toLowerCase()));
    for (const n of used) if (!declared.has(n)) err(`[${loc}] "${key}" references $${n.toUpperCase()}$ but declares no such placeholder`);
    for (const n of declared) if (!used.has(n)) err(`[${loc}] "${key}" declares placeholder "${n}" but never uses $${n.toUpperCase()}$`);

    if (declared.size > 9) err(`[${loc}] "${key}" declares ${declared.size} placeholders — Chrome allows at most 9`);

    for (const [name, def] of Object.entries(ph)) {
      if (!def || typeof def.content !== "string" || !/^\$\d$/.test(def.content)) {
        err(`[${loc}] "${key}" placeholder "${name}" must have content "$1".."$9"`);
      }
    }
  }
}

// 5. the same placeholder set in every locale (translators may reorder, not rename)
for (const loc of locales) {
  if (loc === REF) continue;
  for (const key of refKeys) {
    if (!catalogs[loc][key]) continue;
    const a = Object.keys(catalogs[REF][key].placeholders || {}).sort().join(",");
    const b = Object.keys(catalogs[loc][key].placeholders || {}).sort().join(",");
    if (a !== b) err(`[${loc}] "${key}" placeholders (${b || "none"}) differ from ${REF} (${a || "none"})`);
  }
}

// 6. call sites pass exactly as many substitutions as the key declares
for (const { key, args, file } of callArity) {
  const entry = catalogs[REF][key];
  if (!entry) continue;
  const need = Object.keys(entry.placeholders || {}).length;
  if (args !== need) {
    err(`${file}: peMsg("${key}") passes ${args} substitution(s) but the message declares ${need}`);
  }
}

// 7. textContent keys must not carry markup; markup keys must not be wired to textContent
const htmlKeys = new Set();
const textKeys = new Set();
for (const f of SOURCES.filter((s) => s.endsWith(".html"))) {
  const src = fs.readFileSync(path.join(ROOT, f), "utf8");
  for (const m of src.matchAll(/data-i18n-html="([A-Za-z0-9_]+)"/g)) htmlKeys.add(m[1]);
  for (const m of src.matchAll(/data-i18n="([A-Za-z0-9_]+)"/g)) textKeys.add(m[1]);
}
for (const key of textKeys) {
  const msg = catalogs[REF][key] && catalogs[REF][key].message;
  if (msg && /<[a-z][^>]*>/i.test(msg)) {
    err(`"${key}" contains markup but is bound with data-i18n (textContent) — use data-i18n-html`);
  }
}
for (const key of htmlKeys) {
  const msg = catalogs[REF][key] && catalogs[REF][key].message;
  if (msg && !/<[a-z][^>]*>/i.test(msg)) {
    warn(`"${key}" has no markup — data-i18n would be safer than data-i18n-html`);
  }
}
// markup must match across locales, or a translation silently drops emphasis
for (const loc of locales) {
  if (loc === REF) continue;
  for (const key of htmlKeys) {
    if (!catalogs[loc][key]) continue;
    const tags = (s) => (s.match(/<([a-z][a-z0-9]*)/gi) || []).map((t) => t.slice(1).toLowerCase()).sort().join(",");
    const a = tags(catalogs[REF][key].message);
    const b = tags(catalogs[loc][key].message);
    if (a !== b) warn(`[${loc}] "${key}" markup (${b || "none"}) differs from ${REF} (${a || "none"})`);
  }
}

// 8. terminology consistency.
// Prose only: <code> spans are identifiers (a JSON field literally named "group"),
// URLs are not prose, and a message identical across locales is an untranslatable
// literal. Hyphenated compounds ("open-source") are not the term either.
function prose(s) {
  return s
    .replace(/<code>[\s\S]*?<\/code>/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/<[^>]+>/g, " ");
}
for (const [loc, pairs] of Object.entries(GLOSSARY)) {
  if (!catalogs[loc]) continue;
  for (const key of refKeys) {
    const enRaw = catalogs[REF][key] && catalogs[REF][key].message;
    const trRaw = catalogs[loc][key] && catalogs[loc][key].message;
    if (!enRaw || !trRaw || enRaw === trRaw) continue;
    const en = prose(enRaw);
    for (const [term, expected] of pairs) {
      const re = new RegExp(`(?<![\\w-])${term}s?(?![\\w-])`, "i");
      if (re.test(en) && !trRaw.includes(expected)) {
        warn(`[${loc}] "${key}": ${REF} says "${term}" but the translation lacks "${expected}"`);
      }
    }
  }
}

// 9. no hardcoded user-facing strings.
// Rules 1–8 only police strings that already went through peMsg. A new feature that
// simply assigns an English literal to textContent would pass every one of them — which
// is exactly how a UI drifts back to being monolingual. So scan the sinks that put text
// in front of a user and require the value to be a call, not a literal.
const SINKS = [
  // el.textContent = "…" / el.placeholder = "…" / el.title = "…"
  /\.(textContent|placeholder|title|innerText)\s*=\s*(["'`])((?:\\.|(?!\2).)*)\2/g,
  // setAttribute("title" | "aria-label" | "placeholder", "…")
  /setAttribute\(\s*["'](?:title|aria-label|placeholder|alt)["']\s*,\s*(["'`])((?:\\.|(?!\1).)*)\1/g,
  // toast("…") / flash("…") / confirm("…") / alert("…")
  /\b(?:toast|flash|confirm|alert)\(\s*(["'`])((?:\\.|(?!\1).)*)\1/g
];
// Two or more consecutive letters = prose. Icons ("✕", "＋"), empty strings and
// punctuation are not translatable and must not be flagged.
const isProse = (s) => /[A-Za-z]{2,}/.test(s);

for (const f of SOURCES.filter((s) => s.endsWith(".js"))) {
  const full = path.join(ROOT, f);
  if (!fs.existsSync(full)) continue;
  const src = stripComments(fs.readFileSync(full, "utf8"));
  for (const re of SINKS) {
    for (const m of src.matchAll(re)) {
      const literal = m[3] !== undefined ? m[3] : m[2];
      if (!isProse(literal)) continue;
      const line = src.slice(0, m.index).split("\n").length;
      err(`${f}:${line}: hardcoded user-facing string ${JSON.stringify(literal)} — use peMsg("key")`);
    }
  }
}

report();

/* ---------- output ---------- */
function report() {
  const strict = process.argv.includes("--strict");
  const locList = locales.join(", ");
  for (const w of warnings) console.log(`  ${strict ? "ERROR" : "warn "} ${w}`);
  for (const e of errors) console.log(`  ERROR ${e}`);
  console.log(
    `\ni18n: ${refKeys ? refKeys.length : "?"} keys · locales: ${locList} · ` +
      `${refs ? refs.size : 0} referenced · ${errors.length} error(s), ${warnings.length} warning(s)` +
      (strict ? " (strict: warnings fail)" : "")
  );
  process.exit(errors.length || (strict && warnings.length) ? 1 : 0);
}
