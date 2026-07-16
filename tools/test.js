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
  vm.runInContext(COMMON + "\n;globalThis.__DEFAULTS = PE_DEFAULTS;\n;globalThis.__LIMITS = PE_SYNC_LIMITS;\n;globalThis.__SCHEMA = PE_SCHEMA;\n;globalThis.__MAX_VARS = PE_MAX_VARIABLES;\n;globalThis.__IMPORT_LIMITS = PE_IMPORT_LIMITS;\n;globalThis.__LOCAL_QUOTA = PE_LOCAL_QUOTA_BYTES;", ctx);
  return ctx;
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
