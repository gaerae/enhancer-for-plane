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
    const resp = await fetch(src.url, { method: "GET", cache: "no-store", redirect: "follow" });
    if (!resp.ok) return { status: "error", lastError: "HTTP " + resp.status };
    const declared = parseInt(resp.headers.get("content-length") || "", 10);
    if (declared && declared > PE_SYNC_LIMITS.maxResponseBytes)
      return { status: "error", lastError: "Response too large" };
    const text = await resp.text();
    if (text.length > PE_SYNC_LIMITS.maxResponseBytes)
      return { status: "error", lastError: "Response too large" };
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

let syncing = false;
// force=true ignores per-source intervals (used by "Sync now" / install).
async function syncSources(force) {
  if (syncing) return { ok: 0, err: 0, skipped: 0, busy: true };
  syncing = true;
  try {
    const settings = await peGetSettings();
    const sync = settings.templateSync || {};
    const cache = await peGetSyncCache();
    cache.bySource = cache.bySource || {};
    const now = Date.now();
    let ok = 0;
    let err = 0;
    let skipped = 0;
    let mutated = false;

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
          cache.bySource[src.id] = {
            version: res.version,
            remoteName: res.name || "",
            fetchedAt: now,
            status: "ok",
            lastError: "",
            dropped: res.dropped || 0,
            count: res.templates.length,
            templates: res.templates
          };
          mutated = true;
          ok++;
        } else {
          // Keep the last good templates; only flip status/error.
          cache.bySource[src.id] = Object.assign({}, prev, {
            status: "error",
            lastError: res.lastError || "Error"
          });
          mutated = true;
          err++;
        }
      }
    }

    if (pruneCacheEntries(cache, sync.sources)) mutated = true;

    if (mutated) await peSaveSyncCache(cache);
    return { ok, err, skipped };
  } finally {
    syncing = false;
  }
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
