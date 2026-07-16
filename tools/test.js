#!/usr/bin/env node
// test.js — behaviour tests for the settings/sync logic. Run: node tools/test.js
//
// Zero dependencies: common.js and background.js are plain scripts, so they run in a
// `vm` context with a stubbed `chrome` and `fetch`. Every case here exists because it
// is either a bug that actually shipped, or a boundary where remote data meets ours.

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const COMMON = read("common.js");
const BACKGROUND = read("background.js");

/* ---------- tiny runner ---------- */
const tests = [];
let pass = 0;
const fails = [];
const test = (name, fn) => tests.push({ name, fn });

function eq(actual, expected, what) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what || "value"}: expected ${e}, got ${a}`);
}
function ok(cond, what) {
  if (!cond) throw new Error(what || "expected truthy");
}
function match(actual, re, what) {
  if (!re.test(actual)) throw new Error(`${what || "value"}: ${JSON.stringify(actual)} does not match ${re}`);
}

/* ---------- harnesses ---------- */

// common.js alone (no chrome). peMsg falls back to "" so seed labels keep their
// English literals — exercising the fallback path at the same time.
function loadCommon() {
  const ctx = { console, URL, Date };
  vm.createContext(ctx);
  vm.runInContext(COMMON + "\n;globalThis.__DEFAULTS = PE_DEFAULTS;\n;globalThis.__LIMITS = PE_SYNC_LIMITS;\n;globalThis.__SCHEMA = PE_SCHEMA;\n;globalThis.__MAX_VARS = PE_MAX_VARIABLES;", ctx);
  return ctx;
}

// background.js as a service worker: stubbed storage, permissions, alarms and fetch.
// `respond` maps a URL to a Response-ish object (or throws, to simulate offline).
function loadWorker({ settings, respond, granted = true }) {
  const noop = { addListener() {} };
  const state = { settings, cache: { bySource: {} } };
  const ctx = {
    console,
    URL,
    Date,
    setTimeout,
    clearTimeout,
    fetch: async (url) => respond(url),
    importScripts() {
      vm.runInContext(COMMON, ctx);
    },
    chrome: {
      runtime: { onInstalled: noop, onStartup: noop, onMessage: noop, lastError: null, openOptionsPage() {} },
      alarms: { onAlarm: noop, get: async () => null, create: async () => {}, clear: async () => {} },
      permissions: {
        onAdded: noop,
        onRemoved: noop,
        contains: async () => granted,
        getAll: async () => ({ origins: [] }),
        remove: async () => {}
      },
      scripting: { unregisterContentScripts: async () => {}, registerContentScripts: async () => {} },
      tabs: { query: async () => [] },
      storage: {
        sync: { get: (k, cb) => cb({ peSettings: state.settings }) },
        local: {
          get: (k, cb) => cb({ peSyncCache: state.cache }),
          set: (o, cb) => {
            state.cache = JSON.parse(JSON.stringify(o.peSyncCache));
            cb();
          }
        },
        onChanged: noop
      }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(BACKGROUND, ctx);
  return { ctx, state };
}

const jsonResponse = (body) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => body });
const feed = (templates, extra = {}) =>
  JSON.stringify(Object.assign({ schema: 1, name: "Feed", version: "v1", templates }, extra));

/* ================================================================== */
/* remote normalization — the trust boundary                          */
/* ================================================================== */

test("normalize: drops entries that are not usable templates", () => {
  const { peNormalizeRemoteTemplates: N } = loadCommon();
  const r = N({ templates: [null, "x", 42, {}, { name: "", title: "", content: "" }, { name: "ok", content: "c" }] }, "s");
  eq(r.templates.length, 1, "kept");
  eq(r.dropped, 5, "dropped");
});

test("normalize: enforces every length cap", () => {
  const ctx = loadCommon();
  const L = ctx.__LIMITS;
  const t = ctx.peNormalizeRemoteTemplates(
    { templates: [{ name: "x".repeat(9999), title: "t".repeat(9999), content: "c".repeat(999999), group: "g".repeat(9999) }] },
    "s"
  ).templates[0];
  eq(t.name.length, L.maxFieldLen, "name cap");
  eq(t.title.length, L.maxFieldLen, "title cap");
  eq(t.content.length, L.maxContentLen, "content cap");
  eq(t.group.length, L.maxFieldLen, "group cap");
});

test("normalize: caps the number of templates per source", () => {
  const ctx = loadCommon();
  const many = Array.from({ length: 250 }, (_, i) => ({ name: "t" + i, content: "c" }));
  const r = ctx.peNormalizeRemoteTemplates({ templates: many }, "s");
  eq(r.templates.length, ctx.__LIMITS.maxTemplatesPerSource, "kept");
  eq(r.dropped, 250 - ctx.__LIMITS.maxTemplatesPerSource, "dropped");
});

test("normalize: namespaces ids and derives a stable one when absent", () => {
  const { peNormalizeRemoteTemplates: N } = loadCommon();
  const r = N({ templates: [{ name: "no id", content: "c" }, { id: "has-id", name: "y", content: "c" }] }, "s1");
  eq(r.templates[1].id, "sync:s1:has-id", "explicit id namespaced");
  match(r.templates[0].id, /^sync:s1:h[a-z0-9]+$/, "derived id");
  // same input -> same id (so a re-sync does not churn)
  const again = N({ templates: [{ name: "no id", content: "c" }] }, "s1");
  eq(again.templates[0].id, r.templates[0].id, "derived id is stable");
});

test("normalize: ids from different sources never collide", () => {
  const { peNormalizeRemoteTemplates: N } = loadCommon();
  const a = N({ templates: [{ id: "bug", name: "A", content: "c" }] }, "srcA").templates[0];
  const b = N({ templates: [{ id: "bug", name: "B", content: "c" }] }, "srcB").templates[0];
  ok(a.id !== b.id, "same remote id in two sources must differ locally");
});

test("normalize: non-string fields are neutralised, not trusted", () => {
  const { peNormalizeRemoteTemplates: N } = loadCommon();
  const t = N([{ name: "bare", content: "c", title: { evil: 1 }, group: ["x"] }], "s").templates[0];
  eq(t.title, "", "object title");
  eq(t.group, "", "array group");
});

test("normalize: garbage payloads yield nothing and never throw", () => {
  const { peNormalizeRemoteTemplates: N } = loadCommon();
  for (const bad of [null, undefined, {}, { templates: "nope" }, 42, "str"]) {
    eq(N(bad, "s").templates.length, 0, "payload " + JSON.stringify(bad));
  }
});

test("normalize: captures the collection name", () => {
  const { peNormalizeRemoteTemplates: N } = loadCommon();
  eq(N({ name: "QA standards", templates: [{ name: "a", content: "c" }] }, "s").name, "QA standards");
});

/* ================================================================== */
/* picker sections — grouping, order, hiding                          */
/* ================================================================== */

const SAMPLE = [
  { id: "a", group: "QA", name: "A", content: "c" },
  { id: "b", group: "QA", name: "B", content: "c" },
  { id: "c", group: "Ops", name: "C", content: "c" },
  { id: "d", group: "", name: "D", content: "c" }
];

function sectionsFor({ hidden = [], enabled = true, srcEnabled = true } = {}) {
  const ctx = loadCommon();
  const norm = ctx.peNormalizeRemoteTemplates({ name: "Feed", templates: SAMPLE }, "srcA");
  const cache = { bySource: { srcA: { templates: norm.templates, remoteName: norm.name } } };
  const settings = {
    templates: [{ id: "p", name: "Mine", content: "c" }],
    templateSync: {
      enabled,
      sources: [{ id: "srcA", url: "https://x.test/f.json", name: "", enabled: srcEnabled, hiddenGroups: hidden }]
    }
  };
  return { ctx, sections: ctx.peBuildTemplateSections(settings, cache) };
}

test("sections: ungrouped leads, then groups in first-seen order", () => {
  const { sections } = sectionsFor();
  eq(sections.map((s) => s.kind), ["personal", "synced"]);
  eq(sections[1].groups.map((g) => g.label), ["", "QA", "Ops"]);
});

test("sections: counts personal plus synced", () => {
  const { ctx, sections } = sectionsFor();
  eq(ctx.peCountTemplates(sections), 5);
});

test("sections: hidden groups leave the picker but stay in the cache", () => {
  const { ctx, sections } = sectionsFor({ hidden: ["Ops"] });
  eq(sections[1].groups.map((g) => g.label), ["", "QA"]);
  eq(ctx.peCountTemplates(sections), 4);
});

test("sections: hiding every group removes the block, not just its items", () => {
  const { sections } = sectionsFor({ hidden: ["", "QA", "Ops"] });
  eq(sections.map((s) => s.kind), ["personal"], "no empty synced block");
});

test("sections: sync disabled or source disabled yields no synced block", () => {
  eq(sectionsFor({ enabled: false }).sections.map((s) => s.kind), ["personal"]);
  eq(sectionsFor({ srcEnabled: false }).sections.map((s) => s.kind), ["personal"]);
});

test("sections: a source with no cached templates is skipped", () => {
  const ctx = loadCommon();
  const settings = {
    templates: [],
    templateSync: { enabled: true, sources: [{ id: "srcA", url: "https://x.test/f.json" }] }
  };
  eq(ctx.peBuildTemplateSections(settings, { bySource: {} }).length, 0, "no entry");
  eq(ctx.peBuildTemplateSections(settings, { bySource: { srcA: { templates: [] } } }).length, 0, "empty entry");
});

// The popup badge counted state.templates and said "2" while the picker offered 16.
// Both now call peBuildTemplateSections, so the two cannot drift: whatever removes a
// template from the menu removes it from the count by the same rule.
test("count: the badge and the picker are the same number, under every switch", () => {
  const ctx = loadCommon();
  const cache = {
    bySource: {
      srcA: { templates: Array.from({ length: 11 }, (_, i) => ({ id: "a" + i, group: i < 3 ? "QA" : "Ops", name: "A" + i, content: "c" })) },
      srcB: { templates: Array.from({ length: 3 }, (_, i) => ({ id: "b" + i, group: "Design", name: "B" + i, content: "c" })) }
    }
  };
  const base = {
    templates: [{ id: "p1", name: "a", content: "c" }, { id: "p2", name: "b", content: "c" }],
    templateSync: {
      enabled: true,
      sources: [
        { id: "srcA", url: "https://a.test/t.json", enabled: true, hiddenGroups: [] },
        { id: "srcB", url: "https://b.test/t.json", enabled: true, hiddenGroups: [] }
      ]
    }
  };
  const count = (s) => ctx.peCountTemplates(ctx.peBuildTemplateSections(s, cache));
  const clone = (o) => JSON.parse(JSON.stringify(o));

  eq(count(base), 16, "2 personal + 11 + 3");
  const off = clone(base);
  off.templateSync.enabled = false;
  eq(count(off), 2, "sync off leaves only your own");
  const srcOff = clone(base);
  srcOff.templateSync.sources[0].enabled = false;
  eq(count(srcOff), 5, "a disabled source drops out");
  const hidden = clone(base);
  hidden.templateSync.sources[0].hiddenGroups = ["Ops"];
  eq(count(hidden), 8, "a hidden group drops out");
});

/* ================================================================== */
/* source identity                                                     */
/* ================================================================== */

test("source name: user name wins, then the file's name, then the host", () => {
  const { peSourceDisplayName: D } = loadCommon();
  const url = "https://plane.acme.com/qa.json";
  eq(D({ url, name: "Mine" }, { remoteName: "Feed" }), "Mine", "user name");
  eq(D({ url, name: "  " }, { remoteName: "Feed" }), "Feed", "blank user name falls through");
  eq(D({ url }, null), "plane.acme.com", "host fallback");
});

test("source name: two sources on one host stay distinguishable", () => {
  const { peSourceDisplayName: D } = loadCommon();
  const a = D({ url: "https://p.acme.com/qa.json" }, { remoteName: "QA" });
  const b = D({ url: "https://p.acme.com/design.json" }, { remoteName: "Design" });
  ok(a !== b, "same host must not collapse to one label");
});

test("origin pattern: only http(s) URLs produce a permission pattern", () => {
  const { peOriginPatternForUrl: P } = loadCommon();
  eq(P("https://plane.acme.com/t.json"), "https://plane.acme.com/*");
  eq(P("http://localhost:8731/t.json"), "http://localhost:8731/*", "port is kept");
  eq(P("ftp://x/y"), null);
  eq(P("not a url"), null);
  eq(P(""), null);
});

/* ================================================================== */
/* sync engine                                                         */
/* ================================================================== */

const oneSource = (over = {}) => ({
  enabled: true,
  allDomains: true,
  domains: [],
  rules: [],
  templates: [],
  templateSync: {
    enabled: true,
    sources: [Object.assign({ id: "src1", url: "https://x.test/t.json", intervalMinutes: 360, enabled: true }, over)]
  }
});

test("sync: stores what was fetched, with count matching templates", async () => {
  const { ctx, state } = loadWorker({
    settings: oneSource(),
    respond: () => jsonResponse(feed([{ id: "a", group: "G", name: "A", content: "c" }]))
  });
  await ctx.syncSources(true);
  const e = state.cache.bySource.src1;
  eq(e.status, "ok");
  eq(e.count, e.templates.length, "count matches stored");
  eq(e.remoteName, "Feed");
});

// Regression: a file edited without bumping "version" used to keep the OLD templates
// while updating count — the picker then showed stale entries (count 11 / stored 3).
test("sync: a file edited without bumping version is still replaced", async () => {
  let body = feed([{ id: "a", name: "A", content: "c" }]); // version "v1"
  const { ctx, state } = loadWorker({ settings: oneSource(), respond: () => jsonResponse(body) });
  await ctx.syncSources(true);
  eq(state.cache.bySource.src1.templates.length, 1, "first sync");

  body = feed(Array.from({ length: 11 }, (_, i) => ({ id: "t" + i, name: "T" + i, content: "c" }))); // same "v1"
  await ctx.syncSources(true);
  const e = state.cache.bySource.src1;
  eq(e.templates.length, 11, "templates replaced despite unchanged version");
  eq(e.count, e.templates.length, "count and templates cannot diverge");
});

test("sync: a failure keeps the last good copy", async () => {
  let fail = false;
  const { ctx, state } = loadWorker({
    settings: oneSource(),
    respond: () => {
      if (fail) throw new Error("offline");
      return jsonResponse(feed([{ id: "a", name: "A", content: "c" }]));
    }
  });
  await ctx.syncSources(true);
  fail = true;
  await ctx.syncSources(true);
  const e = state.cache.bySource.src1;
  eq(e.status, "error");
  eq(e.templates.length, 1, "last good templates survive a failed sync");
  match(e.lastError, /offline/i, "error recorded");
});

test("sync: HTTP and JSON failures are reported, not treated as empty", async () => {
  const cases = [
    [() => ({ ok: false, status: 404, headers: { get: () => null }, text: async () => "" }), /HTTP 404/],
    [() => jsonResponse("{not json"), /Invalid JSON/i]
  ];
  for (const [respond, re] of cases) {
    const { ctx, state } = loadWorker({ settings: oneSource(), respond });
    await ctx.syncSources(true);
    eq(state.cache.bySource.src1.status, "error");
    match(state.cache.bySource.src1.lastError, re, "error text");
  }
});

// A payload that parses but carries no usable templates must not read as success —
// that showed "Synced · 0 templates" while nothing arrived.
test("sync: a wrong file shape names what was found", async () => {
  const cases = [
    [JSON.stringify({ groups: [{ name: "QA", templates: [{ name: "A" }] }] }), /groups/],
    [JSON.stringify({ items: [{ name: "A" }] }), /items/],
    [JSON.stringify({ templates: { a: { name: "A" } } }), /must be an array/],
    [JSON.stringify({ templates: [{ id: "x" }, { id: "y" }] }), /0 usable templates/]
  ];
  for (const [body, re] of cases) {
    const { ctx, state } = loadWorker({ settings: oneSource(), respond: () => jsonResponse(body) });
    await ctx.syncSources(true);
    eq(state.cache.bySource.src1.status, "error", "shape " + body.slice(0, 24));
    match(state.cache.bySource.src1.lastError, re, "hint");
  }
});

test("sync: an oversized response is refused", async () => {
  const ctx0 = loadCommon();
  const huge = feed([{ id: "a", name: "A", content: "c" }]) + " ".repeat(ctx0.__LIMITS.maxResponseBytes);
  const { ctx, state } = loadWorker({ settings: oneSource(), respond: () => jsonResponse(huge) });
  await ctx.syncSources(true);
  eq(state.cache.bySource.src1.status, "error");
  match(state.cache.bySource.src1.lastError, /too large/i);
});

test("sync: without host permission nothing is fetched", async () => {
  const { ctx, state } = loadWorker({
    settings: oneSource(),
    granted: false,
    respond: () => {
      throw new Error("fetch must not be called without permission");
    }
  });
  await ctx.syncSources(true);
  match(state.cache.bySource.src1.lastError, /not granted/i);
});

test("sync: per-source interval is respected unless forced", async () => {
  let hits = 0;
  const { ctx } = loadWorker({
    settings: oneSource(),
    respond: () => {
      hits++;
      return jsonResponse(feed([{ id: "a", name: "A", content: "c" }]));
    }
  });
  await ctx.syncSources(true);
  eq(hits, 1, "first fetch");
  await ctx.syncSources(false); // not due yet
  eq(hits, 1, "scheduled run skips a source that is not due");
  await ctx.syncSources(true); // "Sync now"
  eq(hits, 2, "force fetches regardless");
});

test("sync: disabled sources are not fetched", async () => {
  let hits = 0;
  const { ctx } = loadWorker({
    settings: oneSource({ enabled: false }),
    respond: () => {
      hits++;
      return jsonResponse(feed([]));
    }
  });
  await ctx.syncSources(true);
  eq(hits, 0);
});

/* ---------- cache lifecycle ---------- */

test("cache: deleting a source drops its cached templates", async () => {
  const settings = oneSource();
  settings.templateSync.sources.push({ id: "src2", url: "https://y.test/t.json", intervalMinutes: 360, enabled: true });
  const { ctx, state } = loadWorker({ settings, respond: () => jsonResponse(feed([{ id: "a", name: "A", content: "c" }])) });
  await ctx.syncSources(true);
  eq(Object.keys(state.cache.bySource).sort(), ["src1", "src2"]);

  state.settings.templateSync.sources = [state.settings.templateSync.sources[0]];
  await ctx.pruneSyncCacheNow();
  eq(Object.keys(state.cache.bySource), ["src1"], "orphan cache removed");
});

// "Restore defaults" claims to clear everything; the synced copies used to linger.
test("cache: restoring defaults clears the synced templates", async () => {
  const { ctx, state } = loadWorker({
    settings: oneSource(),
    respond: () => jsonResponse(feed([{ id: "a", name: "A", content: "c" }]))
  });
  await ctx.syncSources(true);
  ok(Object.keys(state.cache.bySource).length > 0, "precondition: cache populated");

  state.settings.templateSync = { enabled: false, sources: [] };
  await ctx.pruneSyncCacheNow();
  eq(Object.keys(state.cache.bySource), [], "cache cleared");
});

/* ================================================================== */
/* settings defaults / migration                                       */
/* ================================================================== */

test("defaults: seed labels fall back to English when i18n is unavailable", () => {
  const ctx = loadCommon();
  eq(ctx.__DEFAULTS.rules[0].label, "Module / item name width");
  eq(ctx.__DEFAULTS.templateSync.enabled, false);
  eq(ctx.__DEFAULTS.templateSync.sources, []);
});

test("migrate: a v1 widths object becomes rules", () => {
  const ctx = loadCommon();
  const out = ctx.peMigrate({ widths: { moduleName: { px: 400 }, dropdown: { px: 300 } } });
  eq(out.rules.length, 2);
  eq(out.rules[0].value, "400px");
  ok(!out.widths, "old shape removed");
});

// The gate used to be `raw.rules || raw.schema >= PE_SCHEMA`, so once a user had any
// rules every later migration was skipped and the stored stamp froze at its old value.
test("migrate: every stored version ends up stamped at PE_SCHEMA", () => {
  const ctx = loadCommon();
  const S = ctx.__SCHEMA;
  eq(ctx.peMigrate({ widths: { moduleName: { px: 400 } } }).schema, S, "v1");
  eq(ctx.peMigrate({ schema: 2, rules: [{ id: "r" }] }).schema, S, "v2");
  eq(ctx.peMigrate({ rules: [{ id: "r" }] }).schema, S, "v2 with no stamp");
  eq(ctx.peMigrate({ schema: S, rules: [] }).schema, S, "current is untouched");
});

test("migrate: a v2 user keeps their rules and gains the sync defaults", () => {
  const ctx = loadCommon();
  const stored = { schema: 2, rules: [{ id: "r", selector: ".x", property: "width", value: "1px" }], templates: [], domains: ["a.com"] };
  const merged = ctx.peDeepMerge(ctx.__DEFAULTS, ctx.peMigrate(stored));
  eq(merged.rules.length, 1, "rules preserved");
  eq(merged.domains, ["a.com"], "domains preserved");
  eq(merged.templateSync, { enabled: false, sources: [] }, "sync backfilled");
});

test("merge: settings saved before template sync existed gain the new defaults", () => {
  const ctx = loadCommon();
  const merged = ctx.peDeepMerge(ctx.__DEFAULTS, { schema: 2, rules: [], templates: [] });
  eq(merged.templateSync, { enabled: false, sources: [] }, "templateSync backfilled");
});

test("merge: a saved source list survives untouched", () => {
  const ctx = loadCommon();
  const src = [{ id: "s", url: "https://x.test/t.json", name: "N", intervalMinutes: 60, enabled: true, hiddenGroups: ["Ops"] }];
  const merged = ctx.peDeepMerge(ctx.__DEFAULTS, { templateSync: { enabled: true, sources: src } });
  eq(merged.templateSync.sources, src);
});

/* ================================================================== */
/* template variables                                                  */
/* ================================================================== */
// expandVars lives inside content.js's IIFE, so lift it out by source. It is a pure
// function of (text, vars) plus the clock, which is exactly why it takes vars as an
// argument rather than reaching for module state.
function loadExpandVars() {
  const src = read("content.js");
  const body = src.slice(src.indexOf("const pad2 ="), src.indexOf("// Title etc."));
  return new Function(body + "\nreturn expandVars;")();
}

test("vars: a defined variable is substituted, an undefined one stays visible", () => {
  const expand = loadExpandVars();
  const vars = [{ name: "team", value: "Data Platform" }];
  eq(expand("owner: {{var.team}}", vars), "owner: Data Platform");
  // silently blanking an undefined variable would hide the mistake inside the item
  eq(expand("owner: {{var.nope}}", vars), "owner: {{var.nope}}");
  eq(expand("owner: {{var.team}}", []), "owner: {{var.team}}", "no variables configured");
});

test("vars: the var. prefix cannot shadow a built-in", () => {
  const expand = loadExpandVars();
  // a variable literally named "date" is reachable only as {{var.date}}; {{date}} stays the clock
  const out = expand("{{date}} / {{var.date}}", [{ name: "date", value: "SHADOWED" }]);
  match(out, /^\d{4}-\d{2}-\d{2} \/ SHADOWED$/, "built-in wins its own token");
});

test("vars: substitution is single-pass, so a value cannot chain", () => {
  const expand = loadExpandVars();
  const vars = [{ name: "a", value: "{{var.b}}" }, { name: "b", value: "END" }];
  eq(expand("{{var.a}}", vars), "{{var.b}}", "the value is inserted as written");
});

test("vars: names match case-insensitively, like the built-ins", () => {
  const expand = loadExpandVars();
  eq(expand("{{VAR.Team}}", [{ name: "team", value: "X" }]), "X");
});

test("vars: a value is never re-scanned for markup or dates", () => {
  const expand = loadExpandVars();
  eq(expand("{{var.x}}", [{ name: "x", value: "{{date}}" }]), "{{date}}", "no second pass");
});

// The form used to let you add sources past the cap and then drop the extras during
// save, without a word. The Add button now refuses at the cap, so this slice is only
// ever reached by settings that came from elsewhere.
test("caps: saving can never be the first place a limit is felt", () => {
  const ctx = loadCommon();
  const over = Array.from({ length: 15 }, (_, i) => ({ id: "s" + i, url: "https://h" + i + ".test/t.json" }));
  const out = ctx.peSanitizeSettings({ templateSync: { enabled: true, sources: over } });
  eq(out.templateSync.sources.length, ctx.__LIMITS.maxSources, "an imported over-cap list is trimmed on the way in");
  const vars = Array.from({ length: 12 }, (_, i) => ({ name: "v" + i, value: "x" }));
  eq(ctx.peSanitizeSettings({ variables: vars }).variables.length, ctx.__MAX_VARS, "same for variables");
});

test("vars: import clamps, dedupes and caps them", () => {
  const ctx = loadCommon();
  const out = ctx.peSanitizeSettings({
    variables: [
      { name: "ok", value: "v" },
      { name: "bad name!", value: "v" }, // unusable in a token
      { name: "OK", value: "dupe" }, // same name, different case
      { name: "long", value: "x".repeat(9999) },
      ...Array.from({ length: 9 }, (_, i) => ({ name: "v" + i, value: "x" }))
    ]
  });
  ok(out.variables.length <= ctx.__MAX_VARS, "cap enforced");
  ok(!out.variables.some((v) => v.name === "bad name!"), "unusable name dropped");
  eq(out.variables.filter((v) => v.name.toLowerCase() === "ok").length, 1, "duplicate dropped");
  const long = out.variables.find((v) => v.name === "long");
  if (long) eq(long.value.length, ctx.__LIMITS.maxFieldLen, "value clamped");
});

/* ================================================================== */
/* backup import — the other place foreign data gets in               */
/* ================================================================== */
// A backup file is authored elsewhere (a colleague's export, a hand-edited config), so
// it gets the same treatment as a synced source. It used to get none: any object-shaped
// JSON was accepted and merged straight into the form.

test("import: a settings object is clamped exactly like remote data", () => {
  const ctx = loadCommon();
  const out = ctx.peSanitizeSettings({
    templates: [
      { name: { evil: 1 }, content: 42, title: ["x"] }, // nothing usable survives
      { name: "ok", content: "c".repeat(999999) }
    ],
    rules: [null, "junk", { selector: ".x", property: "width", value: "1px" }],
    domains: ["a.com", 42, { b: 1 }]
  });
  eq(out.templates.length, 1, "unusable template dropped");
  eq(out.templates[0].content.length, ctx.__LIMITS.maxContentLen, "body clamped");
  eq(out.rules.length, 1, "junk rules dropped");
  eq(out.domains, ["a.com"], "non-string domains dropped");
});

test("import: sources are capped and unfetchable URLs are dropped", () => {
  const ctx = loadCommon();
  const sources = [{ id: "bad", url: "javascript:alert(1)" }, { id: "ftp", url: "ftp://h/t.json" }];
  for (let i = 0; i < 20; i++) sources.push({ id: "s" + i, url: "https://h" + i + ".test/t.json" });
  const out = ctx.peSanitizeSettings({ templateSync: { enabled: true, sources } });
  eq(out.templateSync.sources.length, ctx.__LIMITS.maxSources, "source cap");
  ok(!out.templateSync.sources.some((s) => /^(javascript|ftp):/.test(s.url)), "only http(s) survives");
});

test("import: a genuine export round-trips unchanged", () => {
  const ctx = loadCommon();
  const original = ctx.peDeepMerge(ctx.__DEFAULTS, {});
  const restored = ctx.peDeepMerge(ctx.__DEFAULTS, ctx.peSanitizeSettings(ctx.peMigrate(original)));
  eq(restored.templates.length, original.templates.length, "templates survive");
  eq(restored.rules.length, original.rules.length, "rules survive");
  eq(restored.templates[0].name, original.templates[0].name, "content intact");
  eq(restored.rules[0].selector, original.rules[0].selector, "selectors intact");
});

test("import: sanitizing keeps every key the form renders", () => {
  const ctx = loadCommon();
  const out = ctx.peDeepMerge(ctx.__DEFAULTS, ctx.peSanitizeSettings({}));
  for (const k of Object.keys(ctx.__DEFAULTS)) ok(k in out, `"${k}" must survive an empty import`);
});

/* ---------- run ---------- */
(async () => {
  for (const t of tests) {
    try {
      await t.fn();
      pass++;
    } catch (e) {
      fails.push({ name: t.name, message: e.message });
    }
  }
  for (const f of fails) console.log(`  FAIL  ${f.name}\n          ${f.message}`);
  console.log(`\ntests: ${pass} passed, ${fails.length} failed, ${tests.length} total`);
  process.exit(fails.length ? 1 : 0);
})();
