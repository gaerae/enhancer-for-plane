// background.js — service worker.
//
// Host access is NOT requested at install time. The extension declares only
// `optional_host_permissions` and asks for a specific origin (via the popup or
// Settings) when the user enables a domain. This worker keeps the dynamically
// registered content script in sync with the origins the user has actually
// granted, so we only ever touch the sites the user chose.

importScripts("common.js"); // shares PE_STORAGE_KEY, peGetSettings, peOriginPatterns, …

const SCRIPT_ID = "pe-main";
const JS_FILES = ["common.js", "content.js"];
const CSS_FILES = ["content.css"];

async function grantedOrigins() {
  try {
    const perms = await chrome.permissions.getAll();
    return new Set(perms.origins || []);
  } catch (_) {
    return new Set();
  }
}

// Register (or refresh) a single content script covering every active origin the
// user both listed AND granted; unregister it when nothing qualifies.
async function reconcile() {
  let settings;
  try {
    settings = await peGetSettings();
  } catch (_) {
    return;
  }
  const granted = await grantedOrigins();
  let matches = [];
  if (settings.enabled) {
    matches = peOriginPatterns(settings).filter((p) => granted.has(p));
  }

  try {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  } catch (_) {}

  if (!matches.length) return;
  try {
    await chrome.scripting.registerContentScripts([
      {
        id: SCRIPT_ID,
        matches,
        js: JS_FILES,
        css: CSS_FILES,
        runAt: "document_idle",
        allFrames: false,
        persistAcrossSessions: true
      }
    ]);
  } catch (_) {}
}

// After a fresh grant, apply to already-open tabs so it works without a reload.
// Skip tabs that already ran the script (avoids re-declaring common.js globals).
async function injectExistingTabs(origins) {
  if (!origins || !origins.length) return;
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: origins });
  } catch (_) {
    return;
  }
  for (const t of tabs) {
    if (!t.id || !/^https?:/.test(t.url || "")) continue;
    let already = false;
    try {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId: t.id },
        func: () => !!window.__peLoaded
      });
      already = !!(r && r.result);
    } catch (_) {
      continue;
    }
    if (already) continue;
    chrome.scripting.insertCSS({ target: { tabId: t.id }, files: CSS_FILES }).catch(() => {});
    chrome.scripting.executeScript({ target: { tabId: t.id }, files: JS_FILES }).catch(() => {});
  }
}

/* ================================================================== */
/* Template sync — fetch remote sources into the local cache          */
/* ================================================================== */
// Network happens ONLY here (startup / alarm / "Sync now"). The picker and the
// settings page read the cache; they never fetch. So applying a template touches
// no network, works offline, and never surprises the user with a permission prompt.

const PE_SYNC_ALARM = "pe-template-sync";
// Sources are fetched one after another, so a server that accepts the connection and
// then says nothing does not just fail itself — it blocks every source after it in the
// list, on every run, forever. fetch() has no timeout of its own.
const PE_FETCH_TIMEOUT_MS = 30000;

// Read a response body with a byte cap, stopping as soon as it is exceeded. Returns the
// text, or null if the source went over.
//
// Two things this fixes over `await resp.text()` and a length check:
//   - Bytes, not UTF-16 code units. The cap is named maxResponseBytes, but text.length
//     counts code units, so a Korean/CJK feed sailed through at ~3x the limit.
//   - The check has to happen DURING the read. text() buffers the whole stream first, so
//     for a chunked response (no content-length to pre-check) the cap protected nothing:
//     by the time we could compare, the worker had already swallowed it all.
async function readCapped(resp, cap) {
  const reader = resp.body && typeof resp.body.getReader === "function" ? resp.body.getReader() : null;
  if (!reader) return ""; // no body (e.g. 204) — let the JSON parse report it
  const decoder = new TextDecoder("utf-8");
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > cap) {
      try {
        await reader.cancel();
      } catch (_) {}
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function fetchSource(src) {
  const pattern = peOriginPatternForUrl(src.url);
  if (!pattern) return { status: "error", lastError: "Invalid URL" };
  // Only fetch origins the user has actually granted (host permission).
  let allowed = false;
  try {
    allowed = await chrome.permissions.contains({ origins: [pattern] });
  } catch (_) {}
  if (!allowed) return { status: "error", lastError: "Site access not granted" };

  try {
    const resp = await fetch(src.url, {
      method: "GET",
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(PE_FETCH_TIMEOUT_MS)
    });

    // Check where we LANDED, not where we asked. The grant above covers src.url, but a
    // redirect can go anywhere, and the target only has to send
    // "Access-Control-Allow-Origin: *" for the response to be readable — which
    // raw.githubusercontent.com, the host our own README suggests, does. Without this a
    // source could hand its templates over to an origin the user never approved.
    // (redirect: "manual" refuses redirects outright, but Chrome returns an opaque
    // response for it — status 0, no headers, no Location — so we could not tell the
    // user where their source went, or even that it moved. Landing check it is.)
    const landed = peOriginPatternForUrl(resp.url || src.url);
    if (!landed) return { status: "error", lastError: "Invalid redirect target" };
    if (landed !== pattern) {
      let landedOk = false;
      try {
        landedOk = await chrome.permissions.contains({ origins: [landed] });
      } catch (_) {}
      if (!landedOk)
        return { status: "error", lastError: "Redirected to " + peSourceLabel(resp.url) + ", which you have not granted" };
    }

    if (!resp.ok) return { status: "error", lastError: "HTTP " + resp.status };
    const declared = parseInt(resp.headers.get("content-length") || "", 10);
    if (declared && declared > PE_SYNC_LIMITS.maxResponseBytes)
      return { status: "error", lastError: "Response too large" };
    const text = await readCapped(resp, PE_SYNC_LIMITS.maxResponseBytes);
    if (text === null) return { status: "error", lastError: "Response too large" };
    let json;
    try {
      json = JSON.parse(text);
    } catch (_) {
      return { status: "error", lastError: "Invalid JSON" };
    }

    // Shape check BEFORE normalizing: a payload that parses but carries no usable
    // templates must not be reported as a successful sync (that reads as "Synced ·
    // 0 templates" and looks fine while nothing arrives). Name what we found instead.
    const arr = json && Array.isArray(json.templates) ? json.templates : Array.isArray(json) ? json : null;
    if (!arr) {
      let hint = "";
      if (json && Array.isArray(json.groups)) hint = ' — found "groups"; use a flat "templates" array with a "group" field on each';
      else if (json && Array.isArray(json.items)) hint = ' — found "items"; rename it to "templates"';
      else if (json && json.templates) hint = ' — "templates" must be an array';
      return { status: "error", lastError: 'No "templates" array' + hint };
    }

    const version =
      json && typeof json.version === "string" ? json.version : text.length + ":" + peHash(text);
    const norm = peNormalizeRemoteTemplates(json, src.id);
    if (!norm.templates.length && arr.length) {
      return {
        status: "error",
        lastError: "0 usable templates — " + arr.length + " entries all missing name/title/content"
      };
    }
    return { status: "ok", version, templates: norm.templates, dropped: norm.dropped, name: norm.name };
  } catch (e) {
    // AbortSignal.timeout raises TimeoutError; its own message ("signal timed out") does
    // not tell the user which of the two things went wrong, so name it here.
    if (e && e.name === "TimeoutError")
      return { status: "error", lastError: "Timed out after " + PE_FETCH_TIMEOUT_MS / 1000 + "s" };
    return { status: "error", lastError: (e && e.message) || "Fetch failed" };
  }
}

// Drop cached entries whose source no longer exists in settings (deleted source, or
// "Restore defaults" wiping the list). Returns whether anything was removed.
function pruneCacheEntries(cache, sources) {
  const live = new Set((sources || []).map((s) => s && s.id).filter(Boolean));
  let mutated = false;
  for (const id of Object.keys(cache.bySource || {})) {
    if (!live.has(id)) {
      delete cache.bySource[id];
      mutated = true;
    }
  }
  return mutated;
}

// Prune as soon as settings change. Without this the fetched templates linger in
// storage.local until some later sync run — so "Restore defaults" appeared to clear
// everything while the synced copies were still on disk.
async function pruneSyncCacheNow() {
  try {
    const settings = await peGetSettings();
    const cache = await peGetSyncCache();
    if (pruneCacheEntries(cache, (settings.templateSync || {}).sources)) await peSaveSyncCache(cache);
  } catch (_) {}
}

// Store one source's result, and prune, against state read right now.
//
// Read-then-write rather than reusing the snapshot the run started with: a fetch takes
// seconds, and the user may have deleted a source or hit "Restore defaults" meanwhile.
// pruneSyncCacheNow() would have cleared it, and writing back the pre-fetch snapshot put
// it straight back, templates and all — invisibly, since the picker reads settings, not
// the cache. When the deleted source was the last one, ensureSyncAlarm() clears the
// alarm, so no later run cleaned it up either: the orphan sat in storage.local until the
// next browser start.
//
// Committing per source (rather than once at the end of the loop) also means a run that
// is cut short — the worker is evicted, or a later source hangs — keeps what it already
// fetched instead of throwing the whole round away.
// Never throws. storage.local.set rejects on quota (the caps allow far more than its
// 10 MB), and a throw here would abort the loop: every source after this one would go
// unfetched, this run and every later one, since a full disk stays full. Worse, the run
// is started by alarms and permission grants that do not await it, so the rejection went
// nowhere at all — sync simply stopped, with nothing said. Report it as this source's
// failure and let the rest of the run continue.
async function commitSource(id, entry) {
  try {
    const fresh = await peGetSettings();
    const freshSources = ((fresh.templateSync || {}).sources) || [];
    const live = new Set(freshSources.map((s) => s && s.id).filter(Boolean));
    const out = await peGetSyncCache();
    out.bySource = out.bySource || {};

    let mutated = false;
    if (live.has(id)) {
      // deleted mid-fetch → its result is not ours to store
      if (entry.error) {
        // Keep the last good templates; only flip status/error.
        out.bySource[id] = Object.assign({}, out.bySource[id], { status: "error", lastError: entry.error });
      } else {
        out.bySource[id] = entry;
      }
      mutated = true;
    }
    if (pruneCacheEntries(out, freshSources)) mutated = true;
    if (mutated) await peSaveSyncCache(out);
    return true;
  } catch (e) {
    return false;
  }
}

// force=true ignores per-source intervals (used by "Sync now" / install).
async function syncOnce(force) {
  const settings = await peGetSettings();
  const sync = settings.templateSync || {};
  const cache = await peGetSyncCache();
  cache.bySource = cache.bySource || {};
  const now = Date.now();
  let ok = 0;
  let err = 0;
  let skipped = 0;

  if (sync.enabled) {
    for (const src of sync.sources || []) {
      if (!src || !src.id || !src.url || src.enabled === false) continue;
      const prev = cache.bySource[src.id];
      const interval = Math.max(30, src.intervalMinutes || 360) * 60000;
      if (!force && prev && prev.fetchedAt && now - prev.fetchedAt < interval) {
        skipped++;
        continue;
      }
      const res = await fetchSource(src);
      if (res.status === "ok") {
        // Always store exactly what was just fetched. An earlier "same version → keep
        // the stored copy" optimization let `count` (fresh) and `templates` (stale)
        // diverge whenever a file was edited without bumping `version` — and it only
        // ever saved one storage write per interval, which is not worth the risk.
        const stored = await commitSource(src.id, {
          version: res.version,
          remoteName: res.name || "",
          fetchedAt: Date.now(),
          status: "ok",
          lastError: "",
          dropped: res.dropped || 0,
          count: res.templates.length,
          templates: res.templates
        });
        // Fetched but not stored is not a success: the picker reads the cache, so the
        // user would be told a source synced while nothing about it changed.
        if (stored) ok++;
        else err++;
      } else {
        await commitSource(src.id, { error: res.lastError || "Error" });
        err++;
      }
    }
  }

  // Nothing fetched (all skipped, or sync switched off) still has to honour a deletion
  // that landed while we were reading.
  await commitSource(null, {});
  return { ok, err, skipped };
}

let running = null; // the sync in progress
let waiting = null; // at most one run queued behind it
let waitingForce = false;

// Serialize runs. Reporting "already running" and returning zero counts looked tidy but
// was a silent no-op with two faces: "Sync now" flashed "Synced 0 source(s)" as success
// while a sync was in fact running, and — worse — adding a source fetched nothing. That
// second one is the whole feature's entry point: saveAll() requests the host permission
// BEFORE it writes settings, so permissions.onAdded starts a run that cannot see the new
// source, and the "sync now" the save then sends was rejected as busy. Neither run
// fetched it and the UI said the save succeeded. Queueing instead means a caller always
// gets a real run against the settings as they are when its turn comes.
function syncSources(force) {
  if (!running) {
    running = syncOnce(force).finally(() => {
      running = null;
    });
    return running;
  }
  // One queued run absorbs every caller that arrives while this one waits; if any of
  // them asked to force, the queued run forces.
  waitingForce = waitingForce || !!force;
  if (!waiting) {
    waiting = running
      .catch(() => {})
      .then(() => {
        const f = waitingForce;
        waiting = null;
        waitingForce = false;
        running = syncOnce(f).finally(() => {
          running = null;
        });
        return running;
      });
  }
  return waiting;
}

// One repeating alarm at the smallest source interval; each tick only fetches
// sources actually due (see the interval check above), so per-source cadence holds.
async function ensureSyncAlarm() {
  let period = 360;
  try {
    const settings = await peGetSettings();
    const sync = settings.templateSync || {};
    const active = (sync.sources || []).filter((s) => s && s.url && s.enabled !== false);
    if (!sync.enabled || !active.length) {
      await chrome.alarms.clear(PE_SYNC_ALARM);
      return;
    }
    period = Math.max(30, Math.min(...active.map((s) => s.intervalMinutes || 360)));
  } catch (_) {
    return;
  }
  try {
    const existing = await chrome.alarms.get(PE_SYNC_ALARM);
    if (!existing || existing.periodInMinutes !== period) {
      await chrome.alarms.create(PE_SYNC_ALARM, { periodInMinutes: period, delayInMinutes: 1 });
    }
  } catch (_) {}
}

chrome.runtime.onInstalled.addListener(() => {
  reconcile();
  ensureSyncAlarm();
  syncSources(true);
});
chrome.runtime.onStartup.addListener(() => {
  reconcile();
  ensureSyncAlarm();
  syncSources(false);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === PE_SYNC_ALARM) syncSources(false);
});

chrome.permissions.onAdded.addListener(async (perms) => {
  await reconcile();
  await injectExistingTabs((perms && perms.origins) || []);
  // A freshly granted origin may be a template source — try syncing it now.
  syncSources(true);
});
chrome.permissions.onRemoved.addListener(() => reconcile());

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes[PE_STORAGE_KEY]) {
    reconcile();
    ensureSyncAlarm();
    pruneSyncCacheNow();
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "pe-open-options") {
    chrome.runtime.openOptionsPage();
    return;
  }
  if (msg && msg.type === "pe-sync-now") {
    syncSources(true)
      .then((r) => {
        try {
          sendResponse(r);
        } catch (_) {}
      })
      .catch(() => {
        try {
          sendResponse({ error: true });
        } catch (_) {}
      });
    return true; // async response
  }
});
