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
const EXPORT_GLOBALS =
  "\n;globalThis.__DEFAULTS = PE_DEFAULTS;" +
  "\n;globalThis.__LIMITS = PE_SYNC_LIMITS;" +
  "\n;globalThis.__SCHEMA = PE_SCHEMA;" +
  "\n;globalThis.__MAX_VARS = PE_MAX_VARIABLES;" +
  "\n;globalThis.__IMPORT_LIMITS = PE_IMPORT_LIMITS;" +
  "\n;globalThis.__LOCAL_QUOTA = PE_LOCAL_QUOTA_BYTES;" +
  "\n;globalThis.__SYNC_QUOTA = PE_SYNC_QUOTA_BYTES;" +
  "\n;globalThis.__ITEM_BYTES = PE_SYNC_ITEM_BYTES;" +
  "\n;globalThis.__STORAGE_KEY = PE_STORAGE_KEY;" +
  "\n;globalThis.__TPL_PREFIX = PE_TPL_KEY_PREFIX;" +
  "\n;globalThis.__ERR_TPL_BIG = PE_ERR_TEMPLATE_TOO_LARGE;" +
  "\n;globalThis.__MAX_COPY = PE_MAX_COPY_FORMATS;" +
  "\n;globalThis.__MAX_QUICK = PE_MAX_QUICK_LINKS;" +
  "\n;globalThis.__ITEM_FIELDS = PE_ITEM_FIELDS;" +
  "\n;globalThis.__ITEM_KEY_RE = PE_ITEM_KEY_RE;" +
  "\n;globalThis.__EXAMPLE_FEED_URL = PE_EXAMPLE_FEED_URL;";

function loadCommon() {
  const ctx = { console, URL, Date, TextEncoder };
  vm.createContext(ctx);
  vm.runInContext(COMMON + EXPORT_GLOBALS, ctx);
  return ctx;
}

// common.js against a chrome.storage.sync that behaves like the real one: several keys,
// a per-item cap, a total cap, and errors reported through runtime.lastError rather than
// thrown. Settings live across many items now, so a stub that stores a single blob would
// agree with any packing whatsoever — including one that loses templates.
function loadCommonWithSyncStorage(seed = {}) {
  const store = clone(seed);
  const ctx = { console, URL, Date, TextEncoder };
  // Measured the way Chrome measures, independently of common.js — including Chromium's
  // "<" → "<" escape. A stub that just called JSON.stringify would agree with any
  // accounting bug in the code under test, which is the opposite of what it is for.
  const bytes = (k, v) => chromeItemBytes(k, v);
  const totalWith = (pending) => {
    const merged = Object.assign({}, store, pending);
    return Object.keys(merged).reduce((n, k) => n + bytes(k, merged[k]), 0);
  };
  const api = {
    calls: { set: 0, remove: 0 },
    store,
    // Set true to make every write fail the way a full quota does.
    full: false
  };
  ctx.chrome = {
    runtime: { lastError: null },
    storage: {
      sync: {
        get: (keys, cb) => {
          if (keys === null || keys === undefined) return cb(clone(store));
          const list = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const k of list) if (k in store) out[k] = clone(store[k]);
          cb(out);
        },
        set: (obj, cb) => {
          api.calls.set++;
          const over = Object.keys(obj).find((k) => bytes(k, obj[k]) > 8192);
          if (api.full || over || totalWith(obj) > 102400) {
            ctx.chrome.runtime.lastError = {
              message: over ? "QUOTA_BYTES_PER_ITEM quota exceeded" : "QUOTA_BYTES quota exceeded"
            };
            cb();
            ctx.chrome.runtime.lastError = null;
            return;
          }
          for (const k of Object.keys(obj)) store[k] = clone(obj[k]);
          cb();
        },
        remove: (keys, cb) => {
          api.calls.remove++;
          for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
          cb();
        }
      }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(COMMON + EXPORT_GLOBALS, ctx);
  return { ctx, storage: api };
}

// A template of a known JSON size, so a test can say "fill three shards" and mean it.
function tplOfBytes(id, n) {
  const t = { id, name: "n" + id, title: "", content: "" };
  const pad = n - Buffer.byteLength(JSON.stringify(t), "utf8");
  t.content = "x".repeat(Math.max(0, pad));
  return t;
}

// background.js as a service worker: stubbed storage, permissions, alarms and fetch.
// `respond` maps a URL to a Response-ish object (or throws, to simulate offline).
const clone = (v) => JSON.parse(JSON.stringify(v));

// A fetch we can hold open, so a test can act "while the network is slow".
function gate() {
  let release;
  const held = new Promise((r) => (release = r));
  return { held, release };
}

// Let the worker reach its first await (the fetch) before the test acts.
const tick = () => new Promise((r) => setImmediate(r));

// How chrome.storage.sync sizes an item, written from Chromium's own rules rather than
// from ours: key bytes + the byte length of Chromium's JSON serialization, in which "<"
// becomes the six-byte "<". Kept deliberately independent of common.js so the two
// can disagree and a test can say so.
//   extensions/browser/api/storage/settings_storage_quota_enforcer.cc
//     std::string value_as_json = base::WriteJson(value).value_or("");
//     size_t new_size = key.size() + value_as_json.size();
//   base/json/string_escape.cc — case '<': dest->append("\\u003C");
function chromeItemBytes(key, value) {
  const json = JSON.stringify(value).split("<").join("\\u003C");
  return Buffer.byteLength(key, "utf8") + Buffer.byteLength(json, "utf8");
}

function loadWorker({ settings, respond, granted = true }) {
  const noop = { addListener() {} };
  const state = { settings, cache: { bySource: {} }, writes: [], fetched: [] };
  const ctx = {
    console,
    URL,
    Date,
    setTimeout,
    clearTimeout,
    fetch: async (url, init) => {
      state.fetched.push(url);
      // Honour the abort signal the way a real fetch does, so a hanging source in a test
      // actually hangs instead of being a promise the harness quietly resolves.
      const aborted = new Promise((_, reject) => {
        const sig = init && init.signal;
        if (!sig) return;
        const fail = () => reject(Object.assign(new Error("signal timed out"), { name: "TimeoutError" }));
        if (sig.aborted) fail();
        else sig.addEventListener("abort", fail);
      });
      const r = await Promise.race([respond(url), aborted]);
      // A real Response always reports where it ended up; a test overrides `url` to
      // stand in for a redirect.
      if (r && typeof r === "object" && !r.url) r.url = url;
      return r;
    },
    AbortSignal,
    ReadableStream,
    TextEncoder,
    TextDecoder,
    importScripts() {
      vm.runInContext(COMMON, ctx);
    },
    chrome: {
      runtime: { onInstalled: noop, onStartup: noop, onMessage: noop, lastError: null, openOptionsPage() {} },
      alarms: { onAlarm: noop, get: async () => null, create: async () => {}, clear: async () => {} },
      permissions: {
        onAdded: noop,
        onRemoved: noop,
        // `granted` is a boolean for "all"/"none", or a list of patterns when a test
        // needs one origin allowed and another not.
        contains: async (q) =>
          typeof granted === "boolean"
            ? granted
            : ((q && q.origins) || []).every((o) => granted.includes(o)),
        getAll: async () => ({ origins: [] }),
        remove: async () => {}
      },
      scripting: { unregisterContentScripts: async () => {}, registerContentScripts: async () => {} },
      tabs: { query: async () => [] },
      storage: {
        // Hand back a copy, exactly as chrome.storage does — it structured-clones on
        // read, so a caller can never mutate stored state by writing to what it read.
        // (Realism only: the by-reference version did not actually hide the resurrection
        // bug below, because `set` replaced the stored object each time and broke the
        // aliasing. What hid that bug was that no test drove the in-flight window.)
        sync: { get: (k, cb) => cb({ peSettings: clone(state.settings) }) },
        local: {
          get: (k, cb) => cb({ peSyncCache: clone(state.cache) }),
          set: (o, cb) => {
            // `failSaves` stands in for the quota being full: chrome reports it through
            // lastError, which peSaveSyncCache turns into a rejection.
            if (state.failSaves) {
              ctx.chrome.runtime.lastError = { message: "QUOTA_BYTES quota exceeded" };
              cb();
              ctx.chrome.runtime.lastError = null;
              return;
            }
            state.cache = clone(o.peSyncCache);
            state.writes.push(Object.keys(state.cache.bySource || {}).sort());
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

// A body the worker reads the way it reads a real one: as a byte stream. `chunks` splits
// it, so a test can prove the cap bites mid-stream rather than after the whole thing has
// already been buffered.
function bodyStream(str, chunks = 1) {
  const bytes = new TextEncoder().encode(str);
  const size = Math.ceil(bytes.length / chunks) || 1;
  let at = 0;
  return new ReadableStream({
    pull(c) {
      if (at >= bytes.length) return c.close();
      c.enqueue(bytes.slice(at, at + size));
      at += size;
    }
  });
}

// Deliberately no text(): the worker reads bodies through the stream, and offering the
// shortcut let a buffer-it-all implementation satisfy the cap tests without ever touching
// a chunk. A stub should expose what the code under test actually uses, and no more.
const jsonResponse = (body, over = {}) =>
  Object.assign({ ok: true, status: 200, headers: { get: () => null }, body: bodyStream(body) }, over);
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
  // The port is dropped on purpose, and that is what makes a ported source work: a match
  // pattern's host carries no hostname:port form, and chrome's own advice for "any
  // localhost port" is the portless pattern. Keeping it built an invalid pattern that
  // permissions.contains() throws on, which fetchSource cannot tell from "not granted".
  eq(P("http://localhost:8731/t.json"), "http://localhost/*", "port dropped, so every port is covered");
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

test("sync: the response cap counts bytes, not UTF-16 units", async () => {
  const ctx0 = loadCommon();
  const cap = ctx0.__LIMITS.maxResponseBytes;
  // Well under the cap as a JS string, comfortably over it on the wire: "가" is one code
  // unit and three UTF-8 bytes. The old check compared text.length, so a Korean feed —
  // the realistic case for this extension — passed at ~3x the limit it advertises.
  const korean = feed([{ id: "a", name: "A", content: "가".repeat(Math.floor(cap * 0.6)) }]);
  ok(korean.length < cap, "precondition: under the cap by string length");
  ok(Buffer.byteLength(korean, "utf8") > cap, "precondition: over the cap in bytes");

  const { ctx, state } = loadWorker({ settings: oneSource(), respond: () => jsonResponse(korean) });
  await ctx.syncSources(true);
  eq(state.cache.bySource.src1.status, "error");
  match(state.cache.bySource.src1.lastError, /too large/i);
});

test("sync: a chunked response is cut off at the cap, not buffered whole", async () => {
  const ctx0 = loadCommon();
  const cap = ctx0.__LIMITS.maxResponseBytes;
  const huge = feed([{ id: "a", name: "A", content: "c" }]) + " ".repeat(cap * 3);
  let delivered = 0;
  const { ctx, state } = loadWorker({
    settings: oneSource(),
    // No content-length, so the pre-check cannot help: exactly the case the cap exists
    // for. Chunks are counted as the worker pulls them.
    respond: () => {
      const bytes = new TextEncoder().encode(huge);
      const step = 64 * 1024;
      let at = 0;
      // Hand-rolled rather than jsonResponse() so the chunks can be counted as they go.
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: new ReadableStream({
          pull(c) {
            if (at >= bytes.length) return c.close();
            const chunk = bytes.slice(at, at + step);
            at += step;
            delivered += chunk.byteLength;
            c.enqueue(chunk);
          }
        })
      };
    }
  });
  await ctx.syncSources(true);
  eq(state.cache.bySource.src1.status, "error");
  match(state.cache.bySource.src1.lastError, /too large/i);
  // Slack is deliberate: a ReadableStream keeps a chunk queued ahead of the reader, so
  // the cut lands a chunk or two past the cap rather than exactly on it. What matters is
  // that it stops there instead of buffering the whole 3x-oversized body.
  const total = Buffer.byteLength(huge, "utf8");
  ok(delivered <= cap * 1.5, `stopped near the cap: took ${delivered}, cap ${cap}`);
  ok(delivered < total / 2, `did not buffer the whole body: took ${delivered} of ${total}`);
});

test("sync: a redirect to an origin the user did not grant is refused", async () => {
  const { ctx, state } = loadWorker({
    settings: oneSource(),
    granted: ["https://x.test/*"], // the source's own origin, and nothing else
    // The grant covers x.test; the server 302s to a host the user never approved. It
    // only has to answer with Access-Control-Allow-Origin: * for the body to be
    // readable — raw.githubusercontent.com does exactly that.
    respond: () => jsonResponse(feed([{ id: "a", name: "Not ours", content: "c" }]), { url: "https://evil.test/t.json" })
  });
  await ctx.syncSources(true);
  eq(state.cache.bySource.src1.status, "error");
  match(state.cache.bySource.src1.lastError, /redirect/i, "the error names what happened");
  match(state.cache.bySource.src1.lastError, /evil\.test/, "and where it went, so it can be fixed");
  ok(!state.cache.bySource.src1.templates, "nothing from the unapproved origin was stored");
});

test("sync: a source that never answers cannot block the ones after it", async () => {
  const settings = oneSource({ id: "hang", url: "https://hang.test/t.json" });
  settings.templateSync.sources.push({ id: "src2", url: "https://ok.test/t.json", intervalMinutes: 360, enabled: true });
  const { ctx, state } = loadWorker({
    settings,
    // hang.test accepts the connection and then says nothing — the fetch only ends
    // because of the timeout. Sources are fetched in order, so without one this run
    // never reaches src2, on this tick or any other.
    respond: (url) =>
      url.includes("hang.test") ? new Promise(() => {}) : jsonResponse(feed([{ id: "a", name: "A", content: "c" }]))
  });
  // 30s is right in production and useless in a test; abort almost immediately instead.
  // Not AbortSignal.timeout(): node un-refs its timer, so with the fetch above pending
  // forever and nothing else holding the loop open, node would exit before the abort
  // ever fired — the suite ended silently with status 0 and printed nothing. A plain
  // setTimeout keeps the loop alive, which is what Chrome's behaviour looks like here.
  ctx.AbortSignal = {
    timeout: () => {
      const c = new AbortController();
      setTimeout(() => c.abort(), 1);
      return c.signal;
    }
  };

  await ctx.syncSources(true);
  eq(state.cache.bySource.hang.status, "error", "the hanging source fails on its own");
  match(state.cache.bySource.hang.lastError, /timed out/i, "and says why");
  eq(state.cache.bySource.src2.status, "ok", "the source behind it still synced");
});

test("sync: a result is stored as soon as it lands, not at the end of the run", async () => {
  const g = gate();
  const settings = oneSource();
  settings.templateSync.sources.push({ id: "src2", url: "https://slow.test/t.json", intervalMinutes: 360, enabled: true });
  const { ctx, state } = loadWorker({
    settings,
    respond: async (url) => {
      if (url.includes("slow.test")) await g.held;
      return jsonResponse(feed([{ id: "a", name: "A", content: "c" }]));
    }
  });
  const run = ctx.syncSources(true);
  await tick();
  await tick();

  // src1 is done; src2 is still out on the network. A worker evicted right now — or a
  // src2 that never returns — must not cost us src1, which the single terminal write
  // used to do: nothing was persisted until every source had finished.
  eq(state.cache.bySource.src1 && state.cache.bySource.src1.status, "ok", "src1 is already durable");
  ok(!state.cache.bySource.src2, "precondition: src2 has not landed yet");

  g.release();
  await run;
  eq(state.cache.bySource.src2.status, "ok", "and src2 lands when it lands");
});

test("limits: every source at its cap still fits chrome.storage.local", () => {
  const ctx = loadCommon();
  const L = ctx.__LIMITS;
  // A cached entry is built from one response, so maxResponseBytes — not the far larger
  // maxTemplatesPerSource x maxContentLen — is what actually bounds a source on disk.
  // The budget is therefore maxSources x maxResponseBytes, and it must fit QUOTA_BYTES
  // with room to spare. At 10 x 1 MB the measured worst case was 9.69 MB against a 10 MB
  // quota, and past the 5 MB quota of Chrome 113 and earlier. This test is here so that
  // raising either number has to be a decision rather than an accident.
  const budget = L.maxSources * L.maxResponseBytes;
  ok(
    budget <= ctx.__LOCAL_QUOTA / 2,
    `sync budget ${(budget / 1048576).toFixed(1)} MB must stay under half of the ` +
      `${(ctx.__LOCAL_QUOTA / 1048576).toFixed(0)} MB storage.local quota`
  );
});

test("limits: a source cannot store more than its response cap allows", async () => {
  const ctx0 = loadCommon();
  const L = ctx0.__LIMITS;
  // Pack a feed as full as the response cap permits and measure what actually lands.
  // This is the number the budget above is built on; if normalization ever starts
  // inflating what it stores, the budget stops being true and this catches it.
  const per = Math.floor(L.maxResponseBytes / 100) - 120;
  const templates = Array.from({ length: 100 }, (_, i) => ({ id: "t" + i, group: "G", name: "n" + i, content: "x".repeat(per) }));
  const body = feed(templates);
  ok(Buffer.byteLength(body, "utf8") <= L.maxResponseBytes, "precondition: the feed fits the cap");

  const { ctx, state } = loadWorker({ settings: oneSource(), respond: () => jsonResponse(body) });
  await ctx.syncSources(true);
  eq(state.cache.bySource.src1.status, "ok", "precondition: it synced");

  const stored = Buffer.byteLength(JSON.stringify(state.cache.bySource.src1), "utf8");
  ok(
    stored <= L.maxResponseBytes * 1.1,
    `a source stored ${(stored / 1024).toFixed(0)} KB from a ${(L.maxResponseBytes / 1024).toFixed(0)} KB cap`
  );
});

test("origin pattern: a port never reaches the pattern, so a ported source can be granted", () => {
  const ctx = loadCommon();
  const P = ctx.peOriginPatternForUrl;
  // This extension is built for self-hosted Plane, so a non-default port is an ordinary
  // input. A pattern's host is a hostname — "https://plane.internal:8443/*" is not valid
  // and chrome throws on it, which fetchSource cannot distinguish from "not granted": the
  // source would sit on "Site access not granted" with no way to ever grant it.
  eq(P("https://plane.internal:8443/t.json"), "https://plane.internal/*", "explicit https port");
  eq(P("http://h.test:8080/t.json"), "http://h.test/*", "explicit http port");
  eq(P("https://h.test:443/t.json"), "https://h.test/*", "default port URL normalizes away");
  eq(P("https://h.test/t.json"), "https://h.test/*", "no port");
  // The permission a ported source needs is the one we now ask for, and the settings page
  // must not flag it as unusable.
  ok(!!P("https://plane.internal:8443/t.json"), "a ported source is valid, not refused");
});

test("import: a ported source URL survives, with the port dropped from its pattern", () => {
  const ctx = loadCommon();
  const out = ctx.peSanitizeSettings({
    templateSync: { enabled: true, sources: [{ id: "p", url: "https://plane.internal:8443/t.json" }] }
  });
  eq(out.templateSync.sources.length, 1, "a self-hosted instance on a port is importable");
  eq(out.templateSync.sources[0].url, "https://plane.internal:8443/t.json", "the URL itself keeps its port");
});

test("sync: a source that cannot be stored is reported failed, and does not kill the run", async () => {
  const settings = oneSource();
  settings.templateSync.sources.push({ id: "src2", url: "https://y.test/t.json", intervalMinutes: 360, enabled: true });
  const { ctx, state } = loadWorker({
    settings,
    respond: () => jsonResponse(feed([{ id: "a", name: "A", content: "c" }]))
  });
  // storage.local is 10 MB and the caps allow far more, so quota failures are reachable.
  state.failSaves = true;

  const r = await ctx.syncSources(true);
  // Old behaviour: the rejection propagated out of an un-awaited call and vanished, and
  // the loop died at the first source.
  eq(state.fetched.length, 2, "the run kept going and still fetched every source");
  eq(r.ok, 0, "nothing was stored, so nothing synced");
  eq(r.err, 2, "and both are reported failed rather than silently dropped");
});

test("sync: a redirect within a granted origin still works", async () => {
  const { ctx, state } = loadWorker({
    settings: oneSource(),
    granted: ["https://x.test/*"],
    respond: () => jsonResponse(feed([{ id: "a", name: "A", content: "c" }]), { url: "https://x.test/elsewhere.json" })
  });
  await ctx.syncSources(true);
  eq(state.cache.bySource.src1.status, "ok", "a redirect the grant covers is not a problem");
  eq(state.cache.bySource.src1.count, 1);
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

/* ---------- concurrency ----------
   The two tests above delete only AFTER the sync has finished. Everything the user
   actually does happens while a fetch is in flight — a fetch takes seconds, and the
   alarm, the permission grant and the Save button all start runs the user never sees.
   These drive that window, which is where every bug in this section lived. */

test("sync: a source deleted mid-fetch is not resurrected by the run in flight", async () => {
  const g = gate();
  const { ctx, state } = loadWorker({
    settings: oneSource(),
    respond: async () => {
      await g.held;
      return jsonResponse(feed([{ id: "a", name: "Secret", content: "c" }]));
    }
  });
  const inFlight = ctx.syncSources(true);
  await tick();

  // The user deletes the source and Settings prunes the cache, all while we are fetching.
  state.settings.templateSync.sources = [];
  await ctx.pruneSyncCacheNow();
  eq(Object.keys(state.cache.bySource), [], "precondition: prune cleared it");

  g.release();
  await inFlight;
  eq(Object.keys(state.cache.bySource), [], "deleted source stays deleted");
});

test("sync: restoring defaults mid-fetch is not undone by the run in flight", async () => {
  const g = gate();
  const { ctx, state } = loadWorker({
    settings: oneSource(),
    respond: async () => {
      await g.held;
      return jsonResponse(feed([{ id: "a", name: "A", content: "c" }]));
    }
  });
  const inFlight = ctx.syncSources(true);
  await tick();

  state.settings.templateSync = { enabled: false, sources: [] };
  await ctx.pruneSyncCacheNow();

  g.release();
  await inFlight;
  // Nothing self-heals this one: with no sources left, ensureSyncAlarm clears the alarm,
  // so a resurrected orphan would sit in storage.local until the next browser start.
  eq(Object.keys(state.cache.bySource), [], "cache stays cleared");
});

test("sync: a second call runs for real instead of reporting a no-op", async () => {
  const g = gate();
  const { ctx } = loadWorker({
    settings: oneSource(),
    respond: async () => {
      await g.held;
      return jsonResponse(feed([{ id: "a", name: "A", content: "c" }]));
    }
  });
  const first = ctx.syncSources(true);
  await tick();
  const second = ctx.syncSources(true); // "Sync now" while the first is still fetching
  g.release();

  const [r1, r2] = await Promise.all([first, second]);
  eq(r1.ok, 1, "first run fetched");
  // The old code returned {ok:0, busy:true} here, and the options page rendered that as
  // a success: "Synced 0 source(s)." while a sync was in fact running.
  eq(r2.ok, 1, "second run fetched too, rather than reporting zero");
  ok(!("busy" in r2), "no busy flag for a caller to forget to read");
});

test("sync: a source added while a run is in flight is still fetched", async () => {
  const g = gate();
  const { ctx, state } = loadWorker({
    settings: oneSource(),
    respond: async (url) => {
      if (url.includes("x.test")) await g.held; // the existing source is slow
      return jsonResponse(feed([{ id: "a", name: "A", content: "c" }]));
    }
  });

  // saveAll() asks for the host permission BEFORE it writes settings, so this run —
  // started by permissions.onAdded — reads settings that do not know about src2 yet.
  const granted = ctx.syncSources(true);
  await tick();

  state.settings.templateSync.sources.push({
    id: "src2",
    url: "https://new.test/t.json",
    intervalMinutes: 360,
    enabled: true
  });
  const saveSync = ctx.syncSources(true); // the "sync now" that saveAll sends afterwards

  g.release();
  await Promise.all([granted, saveSync]);

  ok(
    state.fetched.some((u) => u.includes("new.test")),
    "the source the user just added was actually fetched"
  );
  eq(Object.keys(state.cache.bySource).sort(), ["src1", "src2"], "and it reached the cache");
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

/* ---------- copy reference ---------- */

// readItemRef reads the page; here the page is a stub. The key element is passed in (the
// DOM search that finds it is exercised in a browser, not here), so only the address bar
// and the title field need standing in.
function loadReadItemRef(href, titleValue, peItemUrl) {
  const src = read("content.js");
  const body = src.slice(src.indexOf("function readItemRef(keyEl)"), src.indexOf("function makeCopyButton()"));
  const u = new URL(href);
  const location = { pathname: u.pathname, origin: u.origin, href };
  const document = {
    querySelector: (s) => (s === "#title-input" && titleValue !== null ? { value: titleValue } : null)
  };
  const fn = new Function(
    "location",
    "document",
    "peItemUrl",
    body + "\nreturn readItemRef;"
  )(location, document, peItemUrl);
  return (keyText) => fn(keyText === null ? null : { textContent: keyText });
}

test("copy: a format is copied exactly as written", () => {
  const ctx = loadCommon();
  const item = { key: "PROJ-123", title: "Fix login", url: "https://p.test/w/browse/PROJ-123" };
  // The markdown preset carries its own link syntax. Nothing in the code appends a URL
  // or wraps anything — if that ever changes, what the user edits stops being what they
  // get, which is the whole contract of this feature.
  eq(
    ctx.peExpandCopyFormat("[{{item.key}}]({{item.url}}) {{item.title}}", item),
    "[PROJ-123](https://p.test/w/browse/PROJ-123) Fix login"
  );
  eq(ctx.peExpandCopyFormat("feature/{{item.key}}", item), "feature/PROJ-123");
  eq(ctx.peExpandCopyFormat("{{ITEM.Key}}", item), "PROJ-123", "token names are case-insensitive");
});

test("copy: a value the page could not give us stays visible as its token", () => {
  const ctx = loadCommon();
  const item = { key: "PROJ-1", title: "", url: "https://p.test/w/browse/PROJ-1" };
  // Blanking it would paste "PROJ-1  https://…" into a colleague's chat and read as an
  // item with no title, instead of as a failure to read one.
  eq(ctx.peExpandCopyFormat("{{item.key}} {{item.title}}", item), "PROJ-1 {{item.title}}");
  eq(ctx.peExpandCopyFormat("{{item.state}}", item), "{{item.state}}", "an unknown field, likewise");
  eq(ctx.peExpandCopyFormat("{{item.key}}", null), "{{item.key}}", "no item at all");
});

test("copy: the missing fields are the ones the caller can name in a toast", () => {
  const ctx = loadCommon();
  const item = { key: "PROJ-1", title: "", url: "" };
  const missing = ctx.peMissingItemFields("{{item.key}} {{item.title}} {{item.url}} {{item.title}}", item);
  eq(missing.join(","), "title,url", "empty and unknown alike, each named once");
  eq(ctx.peMissingItemFields("{{item.key}}", item).length, 0, "nothing to report when it all resolved");
});

test("copy: substitution is single-pass, so a title cannot inject a token", () => {
  const ctx = loadCommon();
  const item = { key: "K-1", title: "{{item.url}}", url: "https://p.test/x" };
  eq(ctx.peExpandCopyFormat("{{item.title}}", item), "{{item.url}}", "the value is inserted as written");
});

test("copy: the presets are three ordinary rows", () => {
  const ctx = loadCommon();
  const list = ctx.__DEFAULTS.copyFormats;
  eq(list.length, 3);
  ok(
    list.every((c) => c.id && c.format.trim()),
    "each has an id and a format"
  );
  // Every token the presets use must be a field we can actually read, or the shipped
  // defaults would hand a new user an unexpanded token on their first copy.
  const item = { key: "K-1", title: "T", url: "U" };
  for (const c of list) eq(ctx.peMissingItemFields(c.format, item).length, 0, c.id + " resolves");
});

test("copy: an import is clamped the same way the form is", () => {
  const ctx = loadCommon();
  const over = Array.from({ length: 12 }, (_, i) => ({ id: "c" + i, name: "n", format: "{{item.key}}" }));
  eq(ctx.peSanitizeSettings({ copyFormats: over }).copyFormats.length, ctx.__MAX_COPY, "count cap");
  const out = ctx.peSanitizeSettings({
    copyFormats: [{ name: "named but empty", format: "   " }, { format: "{{item.key}}" }, "junk", null]
  });
  eq(out.copyFormats.length, 1, "a row with no format copies nothing, so it is dropped");
  ok(out.copyFormats[0].id, "an id is generated for a row that arrived without one");
});

test("copy: deleting every format is not the same as never having had one", () => {
  const ctx = loadCommon();
  // peDeepMerge backfills an absent array from the defaults — right for a new install,
  // wrong for someone who cleared the list on purpose.
  eq(ctx.peDeepMerge(ctx.__DEFAULTS, { copyFormats: [] }).copyFormats.length, 0, "an empty list is kept empty");
  eq(
    ctx.peDeepMerge(ctx.__DEFAULTS, {}).copyFormats.length,
    ctx.__DEFAULTS.copyFormats.length,
    "an absent list is filled with the presets"
  );
});

test("copy: formats survive a save/read round trip", async () => {
  const { ctx } = loadCommonWithSyncStorage();
  const settings = clone(ctx.__DEFAULTS);
  settings.copyFormats = [{ id: "cpy-1", name: "Chat", format: "{{item.key}} {{item.url}}" }];
  await ctx.peSaveSettings(settings);
  const back = await ctx.peGetSettings();
  eq(back.copyFormats.length, 1);
  eq(back.copyFormats[0].format, "{{item.key}} {{item.url}}");
});

/* ------------------------------------------------------------------ */
/* quick open                                                         */
/* ------------------------------------------------------------------ */

test("quick: a key splits on its LAST dash", () => {
  const { peSplitKey } = loadCommon();
  eq(peSplitKey("PROJ-123").proj, "PROJ", "proj");
  eq(peSplitKey("PROJ-123").num, "123", "num");
  // A project identifier can hold a dash; the last dash is the true split.
  eq(peSplitKey("ENG-INFRA-42").proj, "ENG-INFRA", "multi-part identifier stays whole");
  eq(peSplitKey("ENG-INFRA-42").num, "42", "trailing number");
  // An all-digit identifier ("42-7") must not be treated specially.
  eq(peSplitKey("42-7").proj, "42", "numeric identifier");
  // No usable dash → no split, and the tokens stay unexpanded rather than blanking.
  eq(peSplitKey("PROJ").proj, "", "no dash");
  eq(peSplitKey("PROJ").key, "PROJ", "key is the whole input");
});

test("quick: routing picks the longest matching prefix, else the empty-prefix default", () => {
  const { peRouteQuickLink } = loadCommon();
  const links = [
    { id: "plane", prefix: "", url: "https://plane.test/w/browse/{{key}}" },
    { id: "linear", prefix: "ENG-", url: "https://linear.test/{{key}}" },
    { id: "infra", prefix: "ENG-INFRA-", url: "https://infra.test/{{key}}" }
  ];
  eq(peRouteQuickLink(links, "ENG-12").id, "linear", "prefix match");
  eq(peRouteQuickLink(links, "ENG-INFRA-9").id, "infra", "longest prefix wins over a shorter one");
  eq(peRouteQuickLink(links, "DATA-3").id, "plane", "no prefix match falls back to the empty-prefix default");
  eq(peRouteQuickLink(links, ""), null, "an empty key routes nowhere");
  eq(peRouteQuickLink([], "K-1"), null, "no links routes nowhere");
});

test("quick: routing skips disabled and url-less links", () => {
  const { peRouteQuickLink } = loadCommon();
  const links = [
    { id: "off", prefix: "ENG-", url: "https://x.test/{{key}}", enabled: false },
    { id: "empty", prefix: "ENG-", url: "   " },
    { id: "on", prefix: "", url: "https://plane.test/w/browse/{{key}}" }
  ];
  // "ENG-1" would match the first two on prefix, but both are unusable, so it lands on the default.
  eq(peRouteQuickLink(links, "ENG-1").id, "on", "disabled and empty links are not routed to");
});

test("quick: a {{key}} token is substituted, and a url without one gets the key appended", () => {
  const { peExpandQuickLink } = loadCommon();
  eq(
    peExpandQuickLink({ url: "https://plane.test/acme/browse/{{key}}" }, "DATA-5"),
    "https://plane.test/acme/browse/DATA-5",
    "token substitution"
  );
  eq(
    peExpandQuickLink({ url: "https://jira.test/browse/" }, "DATA-5"),
    "https://jira.test/browse/DATA-5",
    "base link + the typed key appended"
  );
  eq(
    peExpandQuickLink({ url: "https://l.test/{{key.proj}}/{{key.num}}" }, "ENG-INFRA-42"),
    "https://l.test/ENG-INFRA/42",
    "proj/num halves"
  );
  // A space in a partially typed key cannot break the address.
  match(peExpandQuickLink({ url: "https://x.test/{{key}}" }, "A B"), /A%20B$/, "the key is URL-encoded");
});

test("quick: only http(s) urls are treated as navigable", () => {
  const { peIsHttpUrl } = loadCommon();
  ok(peIsHttpUrl("https://x.test/a"), "https");
  ok(peIsHttpUrl("http://x.test/a"), "http");
  ok(!peIsHttpUrl("javascript:alert(1)"), "javascript: is rejected");
  ok(!peIsHttpUrl("/acme/browse/K-1"), "a bare path is not navigable on its own");
});

test("quick: the schema is stamped and a v5 user gains an empty quickLinks list", () => {
  const ctx = loadCommon();
  eq(ctx.__SCHEMA, 6, "PE_SCHEMA is 6");
  // A v5 object predates quickLinks; the merge fills the absent array as [] (it ships empty),
  // and the stamp advances so the migration does not run forever.
  const merged = ctx.peDeepMerge(ctx.__DEFAULTS, ctx.peMigrate({ schema: 5, copyFormats: [] }));
  ok(Array.isArray(merged.quickLinks), "quickLinks is an array");
  eq(merged.quickLinks.length, 0, "and it is empty by default");
  eq(ctx.peMigrate({ schema: 5 }).schema, 6, "stamp advances to PE_SCHEMA");
});

test("quick: an import is clamped the same way the form is", () => {
  const ctx = loadCommon();
  const over = Array.from({ length: 25 }, (_, i) => ({ id: "q" + i, url: "https://x.test/{{key}}" }));
  eq(ctx.peSanitizeSettings({ quickLinks: over }).quickLinks.length, ctx.__MAX_QUICK, "count cap");
  const out = ctx.peSanitizeSettings({
    quickLinks: [{ name: "named but no url", prefix: "X-" }, { url: "https://x.test/{{key}}" }, "junk", null]
  });
  eq(out.quickLinks.length, 1, "a row with no url opens nothing, so it is dropped");
  ok(out.quickLinks[0].id, "an id is generated for a row that arrived without one");
});

test("quick: links survive a save/read round trip", async () => {
  const { ctx } = loadCommonWithSyncStorage();
  const settings = clone(ctx.__DEFAULTS);
  settings.quickLinks = [{ id: "qlk-1", name: "Plane", prefix: "", url: "https://plane.test/w/browse/{{key}}", enabled: true }];
  await ctx.peSaveSettings(settings);
  const back = await ctx.peGetSettings();
  eq(back.quickLinks.length, 1);
  eq(back.quickLinks[0].url, "https://plane.test/w/browse/{{key}}");
});

test("copy: on the item's own page the link is the address bar, not a composition", () => {
  const { peItemUrl } = loadCommon();
  eq(
    peItemUrl("https://p.test", "/acme/browse/K-1", "K-1"),
    "https://p.test/acme/browse/K-1",
    "observed: the page already is the item"
  );
  // The key in the path decides it. A stale panel showing a different item must not make
  // us hand back this page's URL for that item.
  eq(
    peItemUrl("https://p.test", "/acme/browse/K-1", "K-2"),
    "https://p.test/acme/browse/K-2",
    "a different key is composed, not borrowed"
  );
  eq(peItemUrl("https://p.test", "/acme/browse/K%2D1", "K-1"), "https://p.test/acme/browse/K%2D1", "percent-decoded");
});

test("copy: a peek panel over a list composes the link from the workspace slug", () => {
  const { peItemUrl } = loadCommon();
  // Measured: the panel keeps the list's URL and contains no link to the item, so the
  // slug (always the first path segment) plus the key is all there is to work with.
  eq(
    peItemUrl("https://p.test", "/data/projects/86965b22/issues/", "DATA-5"),
    "https://p.test/data/browse/DATA-5"
  );
  eq(peItemUrl("https://p.test", "/acme/browse/K-1/activity", "K-1"), "https://p.test/acme/browse/K-1", "a sub-page");
  eq(peItemUrl("https://p.test", "/", "K-1"), "", "no slug to build on → no link at all");
  eq(peItemUrl("", "/acme/x", "K-1"), "", "no origin");
  eq(peItemUrl("https://p.test", "/acme/x", ""), "", "no key");
});

test("copy: the item is whatever key the header shows", () => {
  const { peItemUrl } = loadCommon();
  const onList = loadReadItemRef("https://p.test/data/projects/abc/issues/", "  Visualize your work  ", peItemUrl);
  eq(onList(null), null, "no key on screen → nothing to copy");
  const ref = onList("DATA-5");
  eq(ref.key, "DATA-5");
  eq(ref.title, "Visualize your work", "trimmed");
  eq(ref.url, "https://p.test/data/browse/DATA-5");
  const own = loadReadItemRef("https://p.test/acme/browse/K-1?tab=comments", "Fix login", peItemUrl)("K-1");
  eq(own.url, "https://p.test/acme/browse/K-1", "the query carries view state, not the item");
});

test("copy: a peek-panel ref is a detached snapshot, usable after the DOM is gone", () => {
  // The bug this guards: copying from the panel a list opens fired an "no item here" error,
  // because clicking a format closes the peek panel (an outside mousedown) and the old code
  // re-read the item from a DOM that no longer had #title-input. The fix reads the item once
  // when the menu opens and copies from that. The load-bearing property is that readItemRef
  // returns a COMPLETE VALUE — key, title, and an assembled url — that carries no live DOM
  // reference, so peExpandCopyFormat can render it with the page already torn down.
  const ctx = loadCommon();
  // Read the ref while the "panel" is up (list route, so the url is assembled from the slug).
  const read = loadReadItemRef("https://p.test/data/projects/abc/issues/", "Visualize your work", ctx.peItemUrl);
  const snapshot = read("DATA-5");
  // Now the panel is gone. peExpandCopyFormat is pure — it never touches the document — so a
  // copy that runs off `snapshot` still produces the full reference. If a future change makes
  // copyReference re-derive fields from the DOM at click time, the ref stops being self-
  // contained and this line is where it shows.
  eq(
    ctx.peExpandCopyFormat("[{{item.key}}]({{item.url}}) {{item.title}}", snapshot),
    "[DATA-5](https://p.test/data/browse/DATA-5) Visualize your work"
  );
  eq(ctx.peMissingItemFields("{{item.key}} {{item.title}} {{item.url}}", snapshot).length, 0, "every field resolved from the snapshot");
});

test("copy: a numeric project identifier is a key like any other", () => {
  const ctx = loadCommon();
  // A project's identifier can be numeric ("42-7"). A key pattern anchored on
  // letters would have matched nothing here, and a title slug would have been the empty
  // string for its Korean titles — which is why neither exists.
  ok(ctx.__ITEM_KEY_RE.test("42-7"), "numeric identifier");
  ok(ctx.__ITEM_KEY_RE.test("DATA-5"), "and the ordinary kind");
  ok(ctx.__ITEM_KEY_RE.test("DATA-10"), "a two-digit sequence");
  ok(!ctx.__ITEM_KEY_RE.test("2026-07-24"), "a full date is not a key");
  // A due-date chip Plane can render as a bare <button>. The sequence number is never
  // zero-padded, so the zero-padded month keeps a year-month from passing as a key.
  ok(!ctx.__ITEM_KEY_RE.test("2026-07"), "a zero-padded year-month is not a key");
  ok(!ctx.__ITEM_KEY_RE.test("DATA-05"), "a work item sequence never has a leading zero");
  ok(!ctx.__ITEM_KEY_RE.test("Fix login"), "nor is prose");
  const ref = loadReadItemRef("https://p.test/acme/browse/42-7", "한국어 제목 예시", ctx.peItemUrl)("42-7");
  eq(ref.key, "42-7");
  eq(ref.title, "한국어 제목 예시");
});

test("copy: no title field on the page means the token stays, not an empty string", () => {
  const ctx = loadCommon();
  const ref = loadReadItemRef("https://p.test/acme/browse/K-9", null, ctx.peItemUrl)("K-9");
  eq(ref.title, "");
  eq(ctx.peExpandCopyFormat("{{item.key}} {{item.title}}", ref), "K-9 {{item.title}}");
  eq(ctx.peMissingItemFields("{{item.title}}", ref).join(","), "title");
});

test("example feed: the button's URL points at the file that actually ships", () => {
  const ctx = loadCommon();
  const url = ctx.__EXAMPLE_FEED_URL;
  // A dead example is worse than none — it teaches a first-time user that sync is broken.
  // The URL must be a real https address Save will accept, and its path must be the file
  // present in the repo, so renaming or removing that file breaks this test loudly.
  ok(/^https:\/\//.test(url), "https");
  ok(ctx.peOriginPatternForUrl(url), "Save can turn it into a host permission");
  const path = new URL(url).pathname;
  ok(path.endsWith("/examples/team-templates.json"), "path is the example file");
  const shipped = read("examples/team-templates.json");
  const feed = JSON.parse(shipped);
  // And it has to be a feed the normalizer accepts, or the example would sync to nothing.
  const out = ctx.peNormalizeRemoteTemplates(feed, "src-example");
  ok(out.templates.length > 0, "the shipped file parses into templates");
});

test("example feeds: every template body is markdown the inserter can actually render", () => {
  const ctx = loadCommon();
  // content.js's mdToHtml handles headings, - / 1. lists, - [ ] task lists, --- and inline
  // bold/italic/code. Anything else is passed through as a paragraph of literal characters.
  // Markdown tables shipped once and pasted as rows of pipes; a ```mermaid fence shipped in
  // the architecture doc and pasted as backticks. Both were written by someone reading the
  // file as generic markdown, which is exactly what the next person will do — so the packs
  // are checked against what the renderer supports rather than against markdown at large.
  const UNSUPPORTED = [
    [/^\s*\|/m, "a markdown table row"],
    [/^\s*```/m, "a fenced code block"],
    [/^\s*>\s/m, "a blockquote"],
    [/^\s*!\[/m, "an image"],
    [/\[[^\]]*\]\([^)]*\)/, "a markdown link"]
  ];
  for (const file of ["examples/team-templates.json", "examples/team-templates-ko.json", "examples/team-templates-design.json"]) {
    const feed = JSON.parse(read(file));
    const out = ctx.peNormalizeRemoteTemplates(feed, "src-" + file);
    eq(out.dropped, 0, file + ": the normalizer keeps every template");
    ok(out.templates.length > 0, file + ": has templates");
    for (const t of feed.templates) {
      for (const [re, what] of UNSUPPORTED) {
        ok(!re.test(t.content), file + " / " + t.id + " contains " + what + ", which pastes as literal text");
      }
    }
  }
  // The Korean pack is a translation, not a second pack: same ids, same order, so a
  // template added to one and forgotten in the other fails here instead of leaving one
  // language quietly short.
  const en = JSON.parse(read("examples/team-templates.json")).templates;
  const ko = JSON.parse(read("examples/team-templates-ko.json")).templates;
  eq(ko.map((t) => t.id).join(","), en.map((t) => t.id).join(","), "the two packs carry the same ids in the same order");
  eq(new Set(en.map((t) => t.id)).size, en.length, "ids are unique");
});

test("permissions: desired origins are the domains plus every enabled source", () => {
  const ctx = loadCommon();
  // This is what a synced-in profile needs granted on a new device; the badge and the
  // options banner diff it against what permissions.contains reports. A source that is
  // disabled, url-less, or belongs to a disabled sync block must not appear — asking to
  // grant an origin nothing will fetch is noise.
  const settings = {
    enabled: true,
    domains: ["plane.example.com", "*.corp.example"],
    templateSync: {
      enabled: true,
      sources: [
        { url: "https://raw.example.com/a.json", enabled: true },
        { url: "https://off.example.com/b.json", enabled: false },
        { url: "", enabled: true }
      ]
    }
  };
  const out = ctx.peDesiredOrigins(settings).sort();
  eq(out.join("|"), ["*://*.corp.example/*", "*://plane.example.com/*", "https://raw.example.com/*"].sort().join("|"));
  // Sources are dropped entirely when the sync block is off, even if a source is enabled.
  const off = ctx.peDesiredOrigins({ enabled: true, domains: ["p.example"], templateSync: { enabled: false, sources: [{ url: "https://s.example/x.json", enabled: true }] } });
  eq(off.join("|"), "*://p.example/*", "a disabled sync block contributes no source origins");
  // allDomains collapses to the single all-urls pattern.
  eq(ctx.peDesiredOrigins({ enabled: true, allDomains: true }).join("|"), "*://*/*");
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

test("import: every list is count-capped, not just the newest two", () => {
  const ctx = loadCommon();
  const L = ctx.__IMPORT_LIMITS;
  const raw = { domains: [], rules: [], templates: [], templateSync: { enabled: true, sources: [] } };
  for (let i = 0; i < L.maxDomains + 50; i++) raw.domains.push("d" + i + ".test");
  for (let i = 0; i < L.maxRules + 50; i++) raw.rules.push({ id: "r" + i, selector: ".x" + i, property: "width", value: "1px" });
  for (let i = 0; i < L.maxTemplates + 50; i++) raw.templates.push({ id: "t" + i, name: "n" + i, content: "c" });
  raw.templateSync.sources.push({
    id: "s",
    url: "https://h.test/t.json",
    hiddenGroups: Array.from({ length: L.maxHiddenGroups + 50 }, (_, i) => "g" + i)
  });

  const out = ctx.peSanitizeSettings(raw);
  // variables and sources were capped from the start; these three were not, so a corrupt
  // or hostile file was mapped and clamped item by item with no bound at all.
  eq(out.domains.length, L.maxDomains, "domains");
  eq(out.rules.length, L.maxRules, "rules");
  eq(out.templates.length, L.maxTemplates, "templates");
  eq(out.templateSync.sources[0].hiddenGroups.length, L.maxHiddenGroups, "hiddenGroups");
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

/* ================================================================== */
/* settings storage — the core item plus one template shard per 8 KB  */
/* ================================================================== */

const shardKeys = (store) => Object.keys(store).filter((k) => k.startsWith("peTpl.")).sort();

test("storage: templates come back from a save exactly as they went in", async () => {
  const { ctx, storage } = loadCommonWithSyncStorage();
  const s = ctx.peDeepMerge(ctx.__DEFAULTS, {});
  s.templates = [
    { id: "a", name: "🐞 Bug", title: "[Bug] ", content: "## 요약\n\n## 재현 절차\n1. " },
    { id: "b", name: "Task", title: "", content: "body" }
  ];
  await ctx.peSaveSettings(s);
  const back = await ctx.peGetSettings();
  eq(back.templates, s.templates, "templates round-trip");
  eq(back.rules.length, s.rules.length, "rules round-trip");
  ok(!("tplShards" in back), "tplShards is storage bookkeeping and must not reach the form");
  ok(!("tplShards" in JSON.parse(JSON.stringify(back))), "…nor survive an export");
  eq(shardKeys(storage.store), ["peTpl.0"], "one shard for a small set");
});

test("storage: a set too big for one item is split across shards, in order", async () => {
  const { ctx, storage } = loadCommonWithSyncStorage();
  const s = ctx.peDeepMerge(ctx.__DEFAULTS, {});
  // 20 x ~1 KB is well past the 8 KB an item holds.
  s.templates = Array.from({ length: 20 }, (_, i) => tplOfBytes("t" + i, 1000));
  await ctx.peSaveSettings(s);
  ok(shardKeys(storage.store).length >= 3, `expected several shards, got ${shardKeys(storage.store).length}`);
  for (const k of shardKeys(storage.store)) {
    ok(chromeItemBytes(k, storage.store[k]) <= ctx.__ITEM_BYTES, `${k} within the item cap`);
  }
  const back = await ctx.peGetSettings();
  eq(back.templates.map((t) => t.id), s.templates.map((t) => t.id), "order preserved across shards");
});

test("storage: the ceiling moved — a settings object far past one item now saves", async () => {
  const { ctx } = loadCommonWithSyncStorage();
  const s = ctx.peDeepMerge(ctx.__DEFAULTS, {});
  s.templates = Array.from({ length: 60 }, (_, i) => tplOfBytes("t" + i, 1000));
  // The whole thing is ~60 KB: it could not have been stored at all before sharding.
  ok(ctx.peSettingsBytes(s) > ctx.__ITEM_BYTES * 4, "the fixture must exceed the old single-item ceiling");
  await ctx.peSaveSettings(s);
  const back = await ctx.peGetSettings();
  eq(back.templates.length, 60, "all 60 survive");
});

test("storage: the capacity the docs quote is the capacity you get", () => {
  // The READMEs give a range rather than one number, because the answer depends on the
  // alphabet: the quota is bytes and a Korean character costs three of them. These are
  // the figures they quote. If the packing changes, this is where it shows up — a doc
  // that overstates capacity is worse than one that says nothing.
  const ctx = loadCommon();
  const fits = (n, content) => {
    const s = ctx.peDeepMerge(ctx.__DEFAULTS, {});
    s.templates = Array.from({ length: n }, (_, i) => ({
      id: "tpl-abc123",
      name: "🐞 Bug report",
      title: "[Bug] ",
      content
    })).map((t, i) => Object.assign({}, t, { id: "t" + i }));
    const u = ctx.peSettingsUsage(s);
    return !u.overTotal && !u.overItem;
  };
  const en = "## Summary\n\n".padEnd(400, "x");
  const ko = "## 요약\n\n" + "가".repeat(390);

  ok(fits(200, en), "200 English templates of ~400 characters fit");
  ok(!fits(260, en), "…and it does run out; 260 must not fit");
  ok(fits(80, ko), "80 Korean templates of ~400 characters fit");
  ok(!fits(100, ko), "…and 100 do not — three bytes a character is the whole difference");

  // PE_IMPORT_LIMITS.maxTemplates is an anti-abuse bound on parsing a hostile file, not a
  // promise of capacity: it is only reachable at the small end (the sample feed averages
  // 187 bytes a template).
  ok(fits(ctx.__IMPORT_LIMITS.maxTemplates, "x".repeat(120)), "500 tiny templates fit");
  ok(!fits(ctx.__IMPORT_LIMITS.maxTemplates, en), "500 realistic ones do not — bytes bind first");
});

test("storage: how big one template may be, per alphabet", () => {
  // One template must fit one 8 KB item and nothing can split it further, so this is a
  // real user-facing ceiling. PE_SYNC_LIMITS.maxContentLen (20 000) is far above all of
  // these and always has been: it bounds work on a hostile remote file, where the cache
  // lives in storage.local, and says nothing about what a personal template may hold.
  const ctx = loadCommon();
  const maxChars = (ch) => {
    let lo = 0;
    let hi = 20000;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      const t = { id: "tpl-abc123", name: "🐞 Bug report", title: "[Bug] ", content: ch.repeat(mid) };
      if (ctx.peItemBytes("peTpl.0", [t]) <= ctx.__ITEM_BYTES) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const ascii = maxChars("x");
  const korean = maxChars("가");
  const emoji = maxChars("🐞");
  const lt = maxChars("<");
  ok(ascii > 8000 && ascii < 8192, `ASCII ~8100, got ${ascii}`);
  ok(korean > 2600 && korean < 2800, `Korean ~2700 (3 bytes each), got ${korean}`);
  ok(emoji > 1950 && emoji < 2100, `emoji ~2030 (4 bytes each), got ${emoji}`);
  ok(lt > 1300 && lt < 1400, `"<" ~1350 (6 bytes each in storage), got ${lt}`);
  ok(korean < ctx.__LIMITS.maxContentLen, "and every one of them is under maxContentLen, which is not the binding limit");
});

test("storage: one template too big for an item is refused by name, not dropped", async () => {
  const { ctx, storage } = loadCommonWithSyncStorage();
  const s = ctx.peDeepMerge(ctx.__DEFAULTS, {});
  s.templates = [{ id: "a", name: "Runbook", title: "", content: "x".repeat(9000) }];
  let caught = null;
  try {
    await ctx.peSaveSettings(s);
  } catch (e) {
    caught = e;
  }
  ok(caught, "the save must fail");
  eq(caught.code, ctx.__ERR_TPL_BIG, "carries the specific code, not a generic quota error");
  eq(caught.templateName, "Runbook", "names the offending template");
  eq(Object.keys(storage.store), [], "nothing was written — the form still holds the user's text");
});

test("storage: a boundary template past ten shards is still refused by name, not mislabelled", async () => {
  // The refusal check must weigh each template against its REAL shard key. A template
  // whose one-item size is exactly the cap with a 7-byte "peTpl.0" but one over it with
  // an 8-byte "peTpl.10" used to slip the old pre-check (which always guessed "peTpl.0")
  // and be rejected by Chrome as a generic per-item quota error — which the settings page
  // then blamed on "domains and style rules". Push it past ten shards and it must still
  // come back as the named too-large error.
  const { ctx, storage } = loadCommonWithSyncStorage();
  const s = ctx.peDeepMerge(ctx.__DEFAULTS, {});
  // Size the boundary so [t] serializes to exactly cap-7 bytes: fits "peTpl.0" (7),
  // busts any key of eight bytes or more.
  const target = ctx.__ITEM_BYTES - 7; // peItemBytes(key,[t]) = key.length + jsonBytes([t])
  let n = target;
  let boundary;
  for (let i = 0; i < 40; i++) {
    boundary = { id: "big", name: "Runbook", title: "", content: "x".repeat(n) };
    const bytes = ctx.peItemBytes("peTpl.0", [boundary]);
    if (bytes === ctx.__ITEM_BYTES) break;
    n += ctx.__ITEM_BYTES - bytes; // JSON overhead is constant, so this converges at once
  }
  eq(ctx.peItemBytes("peTpl.0", [boundary]), ctx.__ITEM_BYTES, "fits a 7-byte key exactly");
  ok(ctx.peItemBytes("peTpl.10", [boundary]) > ctx.__ITEM_BYTES, "…and busts an 8-byte one");

  // ~80 small templates ahead of it guarantee it lands at index >= 10 (8-byte key).
  s.templates = Array.from({ length: 80 }, (_, i) => tplOfBytes("t" + i, 1000)).concat([boundary]);
  const key = Object.keys(ctx.peSettingsWriteSet(s)).find((k) => k.startsWith("peTpl.") && k.length >= 8);
  ok(key, "the fixture really does produce a shard key of eight bytes or more");

  let caught = null;
  try {
    await ctx.peSaveSettings(s);
  } catch (e) {
    caught = e;
  }
  ok(caught, "the save must fail");
  eq(caught.code, ctx.__ERR_TPL_BIG, "named too-large error, not a generic quota rejection");
  eq(caught.templateName, "Runbook", "and it names the boundary template");
  eq(Object.keys(storage.store), [], "nothing written");
});

test("storage: shrinking the list prunes the shards it no longer needs", async () => {
  const { ctx, storage } = loadCommonWithSyncStorage();
  const s = ctx.peDeepMerge(ctx.__DEFAULTS, {});
  s.templates = Array.from({ length: 24 }, (_, i) => tplOfBytes("t" + i, 1000));
  await ctx.peSaveSettings(s);
  const before = shardKeys(storage.store).length;
  ok(before >= 3, "fixture must span several shards");
  s.templates = s.templates.slice(0, 2);
  await ctx.peSaveSettings(s);
  eq(shardKeys(storage.store), ["peTpl.0"], "the tail is gone");
  const back = await ctx.peGetSettings();
  eq(back.templates.length, 2, "and the read agrees");
});

test("storage: a save that prunes is two storage operations, and callers must expect both", async () => {
  // Each operation is its own onChanged event. The settings page used to absorb exactly
  // one of them as "my own save", so the prune arrived looking like somebody else's edit
  // and it announced "Loaded the rule added by the picker" right after "Saved." — about
  // the user's own deletion. Nothing in node can click that button; what node can do is
  // hold the count still, so the assumption stays visible to whoever changes this next.
  const { ctx, storage } = loadCommonWithSyncStorage();
  const s = ctx.peDeepMerge(ctx.__DEFAULTS, {});
  s.templates = Array.from({ length: 24 }, (_, i) => tplOfBytes("t" + i, 1000));
  await ctx.peSaveSettings(s);
  eq([storage.calls.set, storage.calls.remove], [1, 0], "a plain save writes once and prunes nothing");

  s.templates = s.templates.slice(0, 2);
  await ctx.peSaveSettings(s);
  eq([storage.calls.set, storage.calls.remove], [2, 1], "shrinking adds exactly one prune");
});

test("storage: a shard left behind by a failed prune is ignored, not read back", async () => {
  // The prune is a second call and can fail on its own. What must never happen is the
  // orphan reappearing as templates the user deleted — this codebase has already shipped
  // one resurrection bug.
  const { ctx } = loadCommonWithSyncStorage({
    peSettings: { schema: 4, tplShards: 1, templates: [] },
    "peTpl.0": [{ id: "keep", name: "keep", title: "", content: "" }],
    "peTpl.1": [{ id: "deleted", name: "deleted", title: "", content: "" }]
  });
  const back = await ctx.peGetSettings();
  eq(back.templates.map((t) => t.id), ["keep"], "only the shards the core item counts");
});

test("storage: v3 settings are read inline, then written sharded", async () => {
  const { ctx, storage } = loadCommonWithSyncStorage({
    peSettings: { schema: 3, templates: [{ id: "old", name: "Old", title: "", content: "kept" }] }
  });
  const back = await ctx.peGetSettings();
  eq(back.templates.map((t) => t.id), ["old"], "a pre-sharding user keeps their templates");
  eq(back.schema, ctx.__SCHEMA, "and is stamped at the current schema");
  await ctx.peSaveSettings(back);
  eq(shardKeys(storage.store), ["peTpl.0"], "the next save converts");
  eq(storage.store.peSettings.tplShards, 1, "and stamps the count");
});

test("storage: a write from a build that predates sharding is read from inline", async () => {
  // That build knows nothing of tplShards, so its save drops the stamp while leaving our
  // shards behind. Inline has to win, or the device shows a list the user did not write.
  const { ctx } = loadCommonWithSyncStorage({
    peSettings: { schema: 4, templates: [{ id: "typed-there", name: "Theirs", title: "", content: "" }] },
    "peTpl.0": [{ id: "stale", name: "Stale", title: "", content: "" }]
  });
  const back = await ctx.peGetSettings();
  eq(back.templates.map((t) => t.id), ["typed-there"], "inline wins when no count is stamped");
});

test("storage: the core item mirrors templates while they fit, and drops them when they do not", async () => {
  const { ctx, storage } = loadCommonWithSyncStorage();
  const s = ctx.peDeepMerge(ctx.__DEFAULTS, {});
  s.templates = [{ id: "a", name: "Small", title: "", content: "tiny" }];
  await ctx.peSaveSettings(s);
  eq(storage.store.peSettings.templates.length, 1, "a pre-sharding build still sees the list");

  s.templates = Array.from({ length: 30 }, (_, i) => tplOfBytes("t" + i, 1000));
  await ctx.peSaveSettings(s);
  eq(storage.store.peSettings.templates, [], "dropped once it stops fitting");
  ok(
    chromeItemBytes("peSettings", storage.store.peSettings) <= ctx.__ITEM_BYTES,
    "so the core item itself always fits"
  );
  eq((await ctx.peGetSettings()).templates.length, 30, "the shards remain the source of truth");
});

test("storage: deleting every template leaves zero, not the shipped samples", async () => {
  // peDeepMerge backfills an absent array from the defaults. Read the shard count wrong
  // and a user who cleared their templates gets the two sample ones back on every load.
  const { ctx } = loadCommonWithSyncStorage();
  const s = ctx.peDeepMerge(ctx.__DEFAULTS, {});
  ok(s.templates.length > 0, "the defaults do ship samples");
  s.templates = [];
  await ctx.peSaveSettings(s);
  eq((await ctx.peGetSettings()).templates, [], "cleared stays cleared");

  // …and it must hold on its own, not because the mirror happens to agree. A stamped
  // count of zero means zero whatever the core item still carries inline; without this
  // the guard could be written `n > 0` and nothing would notice until someone simplified
  // the mirror away and the samples came back from the dead.
  const stale = { peSettings: { schema: 4, tplShards: 0, templates: [{ id: "stale", name: "Stale" }] } };
  eq(ctx.peAssembleSettings(stale).templates, [], "a stamped zero outranks a stale mirror");
});

test("storage: a quota failure rejects rather than reporting a partial save", async () => {
  const { ctx, storage } = loadCommonWithSyncStorage();
  storage.full = true;
  const s = ctx.peDeepMerge(ctx.__DEFAULTS, {});
  let caught = null;
  try {
    await ctx.peSaveSettings(s);
  } catch (e) {
    caught = e;
  }
  ok(caught, "must reject");
  match(caught.message, /quota/i, "and say why");
});

test("storage: the meter measures the items the save actually writes", async () => {
  const { ctx, storage } = loadCommonWithSyncStorage();
  const s = ctx.peDeepMerge(ctx.__DEFAULTS, {});
  s.templates = Array.from({ length: 15 }, (_, i) => tplOfBytes("t" + i, 1000));
  const predicted = ctx.peSettingsBytes(s);
  await ctx.peSaveSettings(s);
  const actual = Object.keys(storage.store).reduce(
    (n, k) => n + chromeItemBytes(k, storage.store[k]),
    0
  );
  eq(predicted, actual, "predicted bytes");
});

test("storage: our byte count is Chrome's byte count, character for character", () => {
  // The budget is only as good as the measurement. Chrome sizes an item with its own
  // serializer, so this compares peItemBytes against Chromium's documented rules over
  // every kind of content that serializes differently — rather than against
  // JSON.stringify, which is the thing that was wrong.
  const ctx = loadCommon();
  const cases = {
    ascii: "plain text",
    korean: "한글 본문입니다",
    emoji: "🐞✅🗺️",
    quotes: 'he said "hi" \\ backslash',
    controls: "line\nbreak\ttab\r\u0001",
    // The one that used to be wrong: Chromium writes "<" as the six-byte "<".
    lessThan: "<details><summary>x</summary></details>",
    greaterAndAmp: "a > b && c",
    unicodeSeparators: "\u2028 and \u2029",
    markdownWithHtml: "## Steps\n<br>\n- [ ] <kbd>Alt</kbd>+<kbd>T</kbd>\n"
  };
  for (const [what, content] of Object.entries(cases)) {
    const value = [{ id: "t", name: "n", title: "", content }];
    eq(ctx.peItemBytes("peTpl.0", value), chromeItemBytes("peTpl.0", value), `bytes for ${what}`);
  }
});

test("storage: a template full of < is packed against its real size, not its raw one", async () => {
  // "<" costs six bytes in storage and one in JSON.stringify. Counted the cheap way, a
  // shard packed to "just under 8 KB" is really ~6x over, the meter says green, and the
  // save dies on a per-item quota error naming the wrong part of the settings.
  const { ctx, storage } = loadCommonWithSyncStorage();
  const s = ctx.peDeepMerge(ctx.__DEFAULTS, {});
  s.templates = Array.from({ length: 12 }, (_, i) => ({
    id: "t" + i,
    name: "html " + i,
    title: "",
    content: "<div>".repeat(200) // 1000 chars, 6000 bytes as Chrome stores it
  }));
  // Every shard the packer produces has to fit by Chrome's arithmetic, not ours.
  for (const shard of ctx.pePackTemplates(s.templates)) {
    ok(chromeItemBytes("peTpl.0", shard) <= ctx.__ITEM_BYTES, "shard fits Chrome's per-item cap");
  }
  await ctx.peSaveSettings(s); // the stub enforces the cap the same way; a bad pack throws
  eq((await ctx.peGetSettings()).templates.length, 12, "all of them stored and read back");
  ok(Object.keys(storage.store).length > 2, "and it genuinely needed several shards");
});

test("storage: the meter watches both ceilings, not just the total", async () => {
  // When everything lived in one item, "is the total too big" and "is this item too big"
  // were the same question. They are not any more: templates shard, but domains and rules
  // still share the core item, so that item can bust the 8 KB per-item cap while the
  // total sits comfortably inside 100 KB. Watching only the total shows green and then
  // fails on save.
  const { ctx, storage } = loadCommonWithSyncStorage();
  const s = ctx.peDeepMerge(ctx.__DEFAULTS, {});
  s.domains = Array.from({ length: 100 }, (_, i) => "sub" + i + ".plane.example.com".padEnd(120, "x"));
  const u = ctx.peSettingsUsage(s);
  ok(u.total < ctx.__SYNC_QUOTA, "the total is nowhere near the overall quota");
  ok(u.overItem, "yet one item is over the per-item cap");
  eq(u.worstKey, ctx.__STORAGE_KEY, "and it is the core item, not a template shard");

  // …and the save it predicts really does fail, so the warning is not theatre.
  let caught = null;
  try {
    await ctx.peSaveSettings(s);
  } catch (e) {
    caught = e;
  }
  ok(caught, "the save fails");
  match(caught.message, /QUOTA_BYTES_PER_ITEM/, "with the per-item error the UI keys off");
  eq(Object.keys(storage.store), [], "and wrote nothing");
});

test("storage: the budget is bytes, so a Korean template is not counted as ASCII", () => {
  // The cap that shipped wrong last time counted UTF-16 units against a byte limit, and
  // a Korean feed sailed past it at 3x. Same arithmetic, same trap, different place.
  const ctx = loadCommon();
  const ko = { id: "a", name: "n", title: "", content: "가".repeat(1000) };
  const en = { id: "a", name: "n", title: "", content: "a".repeat(1000) };
  const koBytes = ctx.peItemBytes("peTpl.0", [ko]);
  ok(koBytes > ctx.peItemBytes("peTpl.0", [en]) * 2.5, `Korean must cost ~3x, got ${koBytes}`);
  // …and the packer has to act on that, not on length.
  const shards = ctx.pePackTemplates(Array.from({ length: 6 }, () => ko));
  ok(shards.length >= 2, `6 x 3 KB cannot share one 8 KB item, got ${shards.length} shard(s)`);
});

test("storage: a change to a shard alone still counts as a settings change", () => {
  // Every listener used to test changes[PE_STORAGE_KEY]. Editing a template now writes a
  // shard and may leave the core item byte-identical, so that test would see nothing and
  // the picker would keep serving the old list.
  const ctx = loadCommon();
  ok(ctx.peSettingsChanged({ "peTpl.2": {} }, "sync"), "a shard-only change");
  ok(ctx.peSettingsChanged({ peSettings: {} }, "sync"), "the core item");
  ok(!ctx.peSettingsChanged({ peSyncCache: {} }, "local"), "the template cache is not settings");
  ok(!ctx.peSettingsChanged({ peSettings: {} }, "local"), "wrong area");
});

/* ================================================================== */
/* team feed export — the other half of the round trip                */
/* ================================================================== */

test("feed: what export writes, sync reads back — every field, unchanged", () => {
  const ctx = loadCommon();
  const s = ctx.peDeepMerge(ctx.__DEFAULTS, {});
  s.templates = [
    { id: "bug", name: "🐞 버그", title: "[Bug] ", content: "## 재현\n1. \n2. " },
    { id: "task", name: "Task", title: "", content: "## Goal\n- [ ] " }
  ];
  const feed = ctx.peBuildTeamFeed(s, "QA standards", "2026-07-22");
  // Publishing is only useful if a subscriber's normalizer accepts the result. Asserting
  // the shape of the file would pass while the two halves quietly disagreed.
  const got = ctx.peNormalizeRemoteTemplates(JSON.parse(JSON.stringify(feed)), "src1");
  eq(got.dropped, 0, "nothing dropped");
  eq(got.name, "QA standards", "the collection name survives");
  eq(got.templates.map((t) => t.name), ["🐞 버그", "Task"], "names survive");
  eq(got.templates.map((t) => t.title), ["[Bug] ", ""], "titles survive");
  eq(got.templates.map((t) => t.content), s.templates.map((t) => t.content), "bodies survive");
  eq(got.templates.map((t) => t.id), ["sync:src1:bug", "sync:src1:task"], "ids are namespaced by the reader");
});

test("feed: it is a publication, not a backup — nothing private rides along", () => {
  // This file is meant to be handed to other people. A backup is not: it carries the
  // user's domains, their source URLs and their variable values in plain text.
  const ctx = loadCommon();
  const s = ctx.peDeepMerge(ctx.__DEFAULTS, {});
  s.domains = ["plane.internal.example.com"];
  s.variables = [{ name: "team", value: "Someone's real name" }];
  s.templateSync = { enabled: true, sources: [{ id: "s1", url: "https://private.example.com/t.json", name: "", intervalMinutes: 360, enabled: true, hiddenGroups: [] }] };
  const wire = JSON.stringify(ctx.peBuildTeamFeed(s, "Team", "2026-07-22"));
  for (const secret of ["plane.internal.example.com", "Someone's real name", "private.example.com", "variables", "domains", "rules"]) {
    ok(wire.indexOf(secret) === -1, `"${secret}" must not appear in a published feed`);
  }
  eq(Object.keys(JSON.parse(wire)).sort(), ["name", "schema", "templates", "version"], "keys");
});

test("feed: synced templates are not re-published as your own", () => {
  // They belong to whoever publishes them. Re-exporting them would let a second feed
  // fork someone else's collection silently, and the ids would collide on the way back.
  const ctx = loadCommon();
  const s = ctx.peDeepMerge(ctx.__DEFAULTS, {});
  s.templates = [{ id: "mine", name: "Mine", title: "", content: "c" }];
  const cache = { bySource: { s1: { templates: [{ id: "sync:s1:theirs", group: "G", name: "Theirs", title: "", content: "c" }] } } };
  // The picker shows both; the feed must carry only the first.
  eq(ctx.peCountTemplates(ctx.peBuildTemplateSections(Object.assign({}, s, { templateSync: { enabled: true, sources: [{ id: "s1", url: "https://x.test/f.json", enabled: true }] } }), cache)), 2, "the picker shows both");
  eq(ctx.peBuildTeamFeed(s, "", "2026-07-22").templates.map((t) => t.id), ["mine"], "the feed carries only your own");
});

test("feed: an unnamed collection omits the key rather than publishing an empty one", () => {
  const ctx = loadCommon();
  const s = ctx.peDeepMerge(ctx.__DEFAULTS, {});
  const feed = ctx.peBuildTeamFeed(s, "   ", "2026-07-22");
  ok(!("name" in feed), "no blank name — a subscriber falls back to the host");
  // …and the reader must agree that there is no name to show.
  eq(ctx.peNormalizeRemoteTemplates(feed, "s").name, "", "reader sees no name");
  eq(ctx.peSourceDisplayName({ url: "https://team.example.com/f.json" }, { remoteName: "" }), "team.example.com", "falls back to the host");
});

test("feed: empty and unusable templates never reach the file", () => {
  const ctx = loadCommon();
  const s = ctx.peDeepMerge(ctx.__DEFAULTS, {});
  s.templates = [
    { id: "blank", name: "", title: "", content: "" },
    { id: "spaces", name: "   ", title: "  ", content: "\n\t " },
    { id: "real", name: "Real", title: "", content: "c" }
  ];
  eq(ctx.peBuildTeamFeed(s, "", "2026-07-22").templates.map((t) => t.id), ["real"], "only the usable one");
});

test("feed: the publisher's own caps apply, so a subscriber never has to drop anything", () => {
  const ctx = loadCommon();
  const L = ctx.__LIMITS;
  const s = ctx.peDeepMerge(ctx.__DEFAULTS, {});
  s.templates = Array.from({ length: L.maxTemplatesPerSource + 25 }, (_, i) => ({
    id: "t" + i,
    name: "x".repeat(400),
    title: "y".repeat(400),
    content: "z".repeat(L.maxContentLen + 500)
  }));
  const feed = ctx.peBuildTeamFeed(s, "z".repeat(400), "2026-07-22");
  eq(feed.templates.length, L.maxTemplatesPerSource, "count capped at what a source may hold");
  eq(feed.name.length, L.maxFieldLen, "collection name capped");
  eq(feed.templates[0].name.length, L.maxFieldLen, "name capped");
  eq(feed.templates[0].content.length, L.maxContentLen, "content capped");
  eq(ctx.peNormalizeRemoteTemplates(feed, "s").dropped, 0, "so the reader drops none of it");
});

test("feed: what the cap drops is a number the caller can report, not a silent loss", () => {
  // exportTeamFeed warns when the cap leaves templates out, and it computes the count as
  // (templates with content) minus (templates in the feed). Pin that arithmetic so the
  // export can never quietly publish fewer than the user built. Blanks don't count — they
  // are filtered before the cap, so they are not "dropped" in the sense the message means.
  const ctx = loadCommon();
  const L = ctx.__LIMITS;
  const s = ctx.peDeepMerge(ctx.__DEFAULTS, {});
  const extra = 37;
  s.templates = Array.from({ length: L.maxTemplatesPerSource + extra }, (_, i) => ({
    id: "t" + i,
    name: "n" + i,
    title: "",
    content: "c"
  }));
  s.templates.push({ id: "blank", name: "", title: "", content: "" }); // filtered, not dropped

  const withContent = s.templates.filter(ctx.peTemplateHasContent).length;
  const feed = ctx.peBuildTeamFeed(s, "Team", "2026-07-22");
  const dropped = withContent - feed.templates.length;
  eq(feed.templates.length, L.maxTemplatesPerSource, "feed holds exactly the cap");
  eq(dropped, extra, "the caller sees the real overflow count");
  ok(dropped > 0, "so the UI takes the 'capped' branch and warns");
});

test("feed: one publisher's export lands in another install's picker, end to end", async () => {
  // The whole point of the feature, exercised through the real worker rather than
  // asserted piecewise: the publisher's file goes over the wire, the subscriber fetches
  // it, and what they can insert is what was published.
  const author = loadCommon();
  const s = author.peDeepMerge(author.__DEFAULTS, {});
  s.templates = [
    { id: "bug", name: "🐞 버그 리포트", title: "[Bug] ", content: "## 재현 절차\n1. " },
    { id: "spec", name: "Spec", title: "[Spec] ", content: "## Problem\n" },
    { id: "blank", name: "", title: "", content: "" } // must not travel
  ];
  const published = JSON.stringify(author.peBuildTeamFeed(s, "QA & Delivery standards", "2026-07-22"));

  const { ctx, state } = loadWorker({
    settings: {
      templates: [{ id: "own", name: "My own", title: "", content: "c" }],
      templateSync: {
        enabled: true,
        sources: [{ id: "src1", url: "https://team.example.com/templates.json", intervalMinutes: 360, enabled: true }]
      }
    },
    respond: () => jsonResponse(published)
  });
  await ctx.syncSources(true);

  const entry = state.cache.bySource.src1;
  eq(entry.status, "ok", "the subscriber's sync succeeded");
  eq(entry.dropped, 0, "and had nothing to drop");
  eq(entry.remoteName, "QA & Delivery standards", "the collection name travelled");
  eq(entry.templates.map((t) => t.name), ["🐞 버그 리포트", "Spec"], "exactly what was published, blank one excluded");

  // …and the picker composes it with the subscriber's own templates.
  const settings = await ctx.peGetSettings();
  const sections = ctx.peBuildTemplateSections(settings, state.cache);
  eq(sections.map((x) => x.kind), ["personal", "synced"], "their own block, then the source");
  eq(sections[1].source, "QA & Delivery standards", "headed by the published name");
  eq(ctx.peCountTemplates(sections), 3, "1 of their own + 2 published");
  eq(sections[1].groups[0].items.map((t) => t.content), ["## 재현 절차\n1. ", "## Problem\n"], "bodies arrive intact");
});

test("feed: a published feed is not mistaken for a settings backup", () => {
  // Both are JSON with a "templates" key. Importing one as the other used to be an
  // unhelpful "not ours"; options.js tells them apart by this shape, so pin it.
  const ctx = loadCommon();
  const s = ctx.peDeepMerge(ctx.__DEFAULTS, {});
  const feed = ctx.peBuildTeamFeed(s, "Team", "2026-07-22");
  ok(feed._app === undefined, "a feed carries no app stamp, so import refuses it");
  ok(Array.isArray(feed.templates) && !feed.rules && !feed.domains, "…and looks like a feed, not a backup");
});

/* ---------- run ---------- */

// A test that awaits something which never settles does not fail — node runs out of work
// and exits 0, printing nothing at all. That is the worst possible outcome: CI reports a
// green suite that never ran a single assertion. beforeExit fires exactly in that case
// (never after an explicit process.exit), so it is where we catch it.
let finished = false;
let running = "";
process.on("beforeExit", () => {
  if (finished) return;
  console.log(`\ntests: DID NOT FINISH — "${running}" never settled (node exited with an empty event loop).`);
  console.log("       A hanging test is a failing test; it must not look like a pass.");
  process.exit(1);
});

(async () => {
  for (const t of tests) {
    running = t.name;
    try {
      await t.fn();
      pass++;
    } catch (e) {
      fails.push({ name: t.name, message: e.message });
    }
  }
  for (const f of fails) console.log(`  FAIL  ${f.name}\n          ${f.message}`);
  console.log(`\ntests: ${pass} passed, ${fails.length} failed, ${tests.length} total`);
  finished = true;
  process.exit(fails.length ? 1 : 0);
})();
