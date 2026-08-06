#!/usr/bin/env node
// check-source.js — enforces the architectural invariants that a reviewer would
// otherwise have to remember. Run: node tools/check-source.js
//
// Each rule here exists because breaking it is silent: the code still parses, the
// tests still pass, and the damage only shows up later (or never, until someone is
// hunting a bug with grep and the file is invisible to it).

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SHIPPED = ["common.js", "background.js", "content.js", "options.js", "popup.js"];
// Only the service worker may reach the network. The picker and settings read the
// cache, so applying a template costs no request, works offline, and cannot surprise
// the user with a permission prompt mid-edit.
const MAY_FETCH = ["background.js"];

const errors = [];
const err = (file, line, msg) => errors.push(`${file}:${line}: ${msg}`);
const lineOf = (src, index) => src.slice(0, index).split("\n").length;

// Drop whole-line comments, keeping line numbers intact.
// Deliberately line-based: this codebase is full of match patterns like "*://*/*",
// and a regex that hunts for comment delimiters reads the "/*" inside those strings
// as a comment opener and swallows the rest of the file. Telling a comment from a
// string needs a real JS lexer, which is not worth carrying here — so this only
// removes lines that are entirely comment, and callers must tolerate the rest.
function stripComments(src) {
  return src
    .split("\n")
    .map((line) => (/^\s*(\/\/|\/\*|\*)/.test(line) ? "" : line))
    .join("\n");
}

/* 1. No raw control bytes in source.
   A literal NUL (written as a raw byte instead of an escape) still parses
   and still runs — but `file` calls the source binary and grep skips it silently, so
   code search stops finding anything in that file. */
const TEXT_FILES = [...SHIPPED, "options.html", "popup.html", "manifest.json"].concat(
  // The tools police the shipped code, but they are source too — and this very check
  // shipped with a NUL inside the comment describing NULs, precisely because it only
  // ever looked at other people's files.
  fs.readdirSync(path.join(ROOT, "tools")).filter((f) => f.endsWith(".js")).map((f) => "tools/" + f)
);
for (const f of TEXT_FILES) {
  const full = path.join(ROOT, f);
  if (!fs.existsSync(full)) continue;
  const buf = fs.readFileSync(full);
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b < 9 || (b > 13 && b < 32)) {
      const line = buf.slice(0, i).toString("utf8").split("\n").length;
      err(f, line, `raw control byte 0x${b.toString(16).padStart(2, "0")} — write it as an escape (e.g. "\\u0000")`);
      break; // one report per file is enough
    }
  }
}

/* 2. innerHTML may only receive text we authored.
   Synced templates are written by whoever controls the source URL. Assigning that to
   innerHTML would run their markup inside the extension's own context. Allowed: an
   empty string, a static literal, or a bundled message via peMsg(). */
for (const f of SHIPPED) {
  const full = path.join(ROOT, f);
  if (!fs.existsSync(full)) continue;
  const src = stripComments(fs.readFileSync(full, "utf8"));
  for (const m of src.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)) {
    const rhs = m[1].trim();
    const literal = /^(["'])(?:\\.|(?!\1).)*\1$/.test(rhs) || /^`[^`$]*`$/.test(rhs);
    const concatOfLiterals = /^(["'][\s\S]*["']\s*\+\s*)*["'][\s\S]*["']$/.test(rhs);
    const fromMessage = /^peMsg\(/.test(rhs) || /^m$/.test(rhs); // the i18n applier's own local
    if (!literal && !concatOfLiterals && !fromMessage) {
      err(f, lineOf(src, m.index), `innerHTML assigned a non-literal (${rhs.slice(0, 40)}…) — use textContent for any data that is not ours`);
    }
  }
}

/* 3. Network access lives in the service worker only. */
for (const f of SHIPPED) {
  if (MAY_FETCH.includes(f)) continue;
  const full = path.join(ROOT, f);
  if (!fs.existsSync(full)) continue;
  const src = stripComments(fs.readFileSync(full, "utf8"));
  for (const m of src.matchAll(/\b(fetch|XMLHttpRequest|EventSource|WebSocket)\s*\(/g)) {
    err(f, lineOf(src, m.index), `${m[1]}() outside the service worker — sync fetches in background.js and the rest reads the cache`);
  }
}

/* 4. No remote code execution (also a Chrome Web Store policy, not just taste). */
for (const f of SHIPPED) {
  const full = path.join(ROOT, f);
  if (!fs.existsSync(full)) continue;
  const src = stripComments(fs.readFileSync(full, "utf8"));
  for (const m of src.matchAll(/\b(eval|new\s+Function)\s*\(/g)) {
    err(f, lineOf(src, m.index), `${m[1].replace(/\s+/g, " ")}() — the extension must never execute code it did not ship`);
  }
}

/* 5. Every remote field must go through the clamp, never straight into storage.
   Line-based on purpose: slicing a function body with regexes was itself the kind of
   clever-but-wrong check that reports failures on correct code. */
{
  const lines = fs.readFileSync(path.join(ROOT, "common.js"), "utf8").split("\n");
  let inFn = false;
  lines.forEach((raw, i) => {
    const line = raw.replace(/\/\/.*$/, "");
    if (/function peNormalizeRemoteTemplates/.test(line)) inFn = true;
    else if (inFn && /^}/.test(line)) inFn = false;
    if (!inFn) return;
    // `t` is the raw remote entry; reading a string off it must clamp on the same line.
    const reads = line.match(/\bt\.(name|title|content|group|id)\b/g);
    if (reads && !/peClampStr\(/.test(line)) {
      err("common.js", i + 1, `${reads[0]} read without peClampStr — every remote string needs a cap`);
    }
  });
}

/* 6. Shared globals must exist.
   common.js is loaded into the worker, the content script and the extension pages, and
   everything it shares is a bare global. A typo there throws only on a real Plane page —
   content.js, options.js and popup.js need a DOM, so tools/test.js cannot reach them.
   This is the `no-undef` half of a linter, made reliable by the naming convention. */
{
  const commonSrc = stripComments(fs.readFileSync(path.join(ROOT, "common.js"), "utf8"));
  const shared = new Set();
  for (const m of commonSrc.matchAll(/^(?:function|const|let|var)\s+(pe[A-Z]\w*|PE_[A-Z0-9_]+)/gm)) shared.add(m[1]);

  for (const f of SHIPPED) {
    if (f === "common.js") continue;
    const src = stripComments(fs.readFileSync(path.join(ROOT, f), "utf8"));
    // names this file declares itself shadow the shared ones
    const local = new Set();
    for (const m of src.matchAll(/(?:function|const|let|var)\s+(pe[A-Z]\w*|PE_[A-Z0-9_]+)/g)) local.add(m[1]);
    const seen = new Set();
    for (const m of src.matchAll(/\b(pe[A-Z]\w*|PE_[A-Z0-9_]+)\b/g)) {
      const name = m[1];
      if (shared.has(name) || local.has(name) || seen.has(name)) continue;
      seen.add(name);
      err(f, lineOf(src, m.index), `"${name}" is not declared in common.js or this file — typo, or a global that was renamed`);
    }
  }
}

/* 7. Everything the extension loads at runtime must be in the release zip.
   release.yml packages an explicit allowlist — good, because it keeps tools/ and
   examples/ out of the published build. The cost is that adding a file and forgetting
   the allowlist produces a broken release while every check here still passes. So
   walk what the extension actually references and confirm the zip carries it. */
{
  const yml = fs.readFileSync(path.join(ROOT, ".github/workflows/release.yml"), "utf8");
  const start = yml.indexOf("zip -r");
  if (start === -1) {
    err(".github/workflows/release.yml", 1, "no `zip -r` line found — this check cannot verify the release contents");
  } else {
    // the command continues across backslash-terminated lines
    const lines = yml.slice(start).split("\n");
    const cmd = [];
    for (const line of lines) {
      cmd.push(line.replace(/\\$/, ""));
      if (!line.trimEnd().endsWith("\\")) break;
    }
    let tokens = cmd.join(" ").split(/\s+/).filter(Boolean);
    const exclude = tokens.indexOf("-x");
    if (exclude !== -1) tokens = tokens.slice(0, exclude);
    const packaged = tokens.filter((t) => !["zip", "-r", '"$ZIP"'].includes(t));

    const covered = (p) => packaged.some((e) => e === p || p.startsWith(e + "/"));
    const required = new Map(); // path -> why

    const need = (p, why) => {
      if (p && !required.has(p)) required.set(p, why);
    };
    need("manifest.json", "the extension entry point");

    const mf = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
    need(mf.background && mf.background.service_worker, "manifest.background.service_worker");
    need(mf.options_page, "manifest.options_page");
    need(mf.action && mf.action.default_popup, "manifest.action.default_popup");
    for (const src of Object.values((mf.action && mf.action.default_icon) || {})) need(src, "manifest.action.default_icon");
    for (const src of Object.values(mf.icons || {})) need(src, "manifest.icons");
    if (mf.default_locale) {
      for (const loc of fs.readdirSync(path.join(ROOT, "_locales"))) need(`_locales/${loc}/messages.json`, "a locale catalogue");
    }

    // pages pull their own scripts and styles
    for (const page of ["options.html", "popup.html"]) {
      const html = fs.readFileSync(path.join(ROOT, page), "utf8");
      for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) need(m[1], `loaded by ${page}`);
      for (const m of html.matchAll(/<link[^>]+href="([^"]+)"/g)) need(m[1], `loaded by ${page}`);
    }

    // the worker injects the content script by filename
    const bg = fs.readFileSync(path.join(ROOT, "background.js"), "utf8");
    for (const key of ["JS_FILES", "CSS_FILES"]) {
      const m = bg.match(new RegExp(`${key}\\s*=\\s*\\[([^\\]]*)\\]`));
      if (m) for (const f of m[1].match(/"([^"]+)"/g) || []) need(f.slice(1, -1), `injected via background.js ${key}`);
    }

    for (const [p, why] of required) {
      if (!covered(p)) err(".github/workflows/release.yml", 1, `"${p}" (${why}) is not in the release zip — the published extension would be missing it`);
    }
    for (const p of packaged) {
      if (!fs.existsSync(path.join(ROOT, p))) err(".github/workflows/release.yml", 1, `packages "${p}", which does not exist`);
    }
  }
}

/* 8. A light surface colour must have a dark-mode counterpart.
   Both stylesheets theme themselves with `prefers-color-scheme: dark`, which means every
   hardcoded light background is a promise to override it — and a missed one does not fail
   anywhere: it renders a white block on a dark card, which only a human looking at the
   page in dark mode ever notices. Three row styles shipped that way (.var-item, .cpy-item,
   and the Quick jump row that reuses .cpy-item). So: find the selectors that set a light
   background outside a dark block, and require each to appear inside one. */
{
  const lightness = (hex) => {
    let h = hex.slice(1);
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  };

  for (const file of ["options.css", "popup.css"]) {
    const css = fs.readFileSync(path.join(ROOT, file), "utf8");

    // Blank out the dark blocks, remembering which selectors they cover.
    const darkSelectors = new Set();
    let masked = css;
    for (const m of [...css.matchAll(/@media \(prefers-color-scheme: dark\)\s*\{/g)].reverse()) {
      let i = m.index + m[0].length;
      let depth = 1;
      while (i < css.length && depth) {
        if (css[i] === "{") depth++;
        else if (css[i] === "}") depth--;
        i++;
      }
      // Comments are stripped first: a comment sitting above a rule lands inside the
      // selector capture and would glue itself to the first selector, so the group's
      // leading member ("/* … */ .tpl-item") would never match and read as un-overridden.
      const block = css.slice(m.index + m[0].length, i - 1).replace(/\/\*[\s\S]*?\*\//g, "");
      for (const rule of block.matchAll(/([^{}]+)\{/g)) {
        for (const sel of rule[1].split(",")) {
          const s = sel.trim();
          if (s && !s.startsWith("@")) darkSelectors.add(s);
        }
      }
      masked = masked.slice(0, m.index) + " ".repeat(i - m.index) + masked.slice(i);
    }

    for (const rule of masked.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selectors = rule[1]
        .replace(/\/\*[\s\S]*?\*\//g, "") // a comment above the rule is not part of it
        .trim();
      if (!selectors || selectors.startsWith("@")) continue;
      const bg = rule[2].match(/background(?:-color)?:\s*(#[0-9a-fA-F]{3,6})\b/);
      if (!bg || lightness(bg[1]) < 0.85) continue;
      // A colour that is deliberately the same in both themes says so in the rule, e.g. a
      // toggle knob that stays light because its track darkens instead. The marker has to
      // be inside the braces so it cannot drift away from the declaration it excuses.
      if (/dark-ok/.test(rule[2])) continue;
      const parts = selectors.split(",").map((s) => s.trim()).filter(Boolean);
      // One selector of the group being overridden is enough — they share the declaration.
      if (parts.some((s) => darkSelectors.has(s))) continue;
      err(
        file,
        lineOf(css, css.indexOf(selectors)),
        `"${parts.join(", ")}" sets the light background ${bg[1]} with no dark-mode override — it renders as a light block in dark mode`
      );
    }
  }
}

for (const e of errors) console.log(`  ERROR ${e}`);
console.log(`\nsource: ${SHIPPED.length} shipped files · ${errors.length} error(s)`);
process.exit(errors.length ? 1 : 0);
