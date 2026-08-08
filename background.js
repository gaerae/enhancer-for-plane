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

// The toolbar badge for the "this device has not approved access yet" state. Settings sync
// across devices but host permissions do not (see peDesiredOrigins), so a profile synced to
// a new device can leave the extension inert with nothing to show for it. The badge is that
// something — visible without opening a page — and it clears the moment every listed domain
// and source is granted here.
async function refreshBadge() {
  let missing = 0;
  try {
    const settings = await peGetSettings();
    if (settings.enabled) {
      for (const o of peDesiredOrigins(settings)) {
        let has = false;
        try {
          has = await chrome.permissions.contains({ origins: [o] });
        } catch (_) {}
        if (!has) missing++;
      }
    }
  } catch (_) {}
  try {
    if (missing > 0) {
      chrome.action.setBadgeText({ text: "!" });
      chrome.action.setBadgeBackgroundColor({ color: "#d97706" });
      chrome.action.setTitle({ title: peMsg("badgeNeedsAccess") || PE_ACTION_TITLE });
    } else {
      chrome.action.setBadgeText({ text: "" });
      chrome.action.setTitle({ title: PE_ACTION_TITLE });
    }
  } catch (_) {}
}
// The plain toolbar tooltip to restore when the badge clears. Read from the manifest so
// there is one source of truth — if action.default_title ever becomes a localized
// __MSG_…__ reference, chrome.i18n resolves it here too, rather than a second hardcoded copy.
const PE_ACTION_TITLE = (() => {
  try {
    const a = chrome.runtime.getManifest().action;
    return (a && a.default_title) || "Enhancer for Plane";
  } catch (_) {
    return "Enhancer for Plane";
  }
})();

/* ------------------------------------------------------------------ */
/* Open a key from selected text                                       */
/* ------------------------------------------------------------------ */
//
// A key almost never arrives as a key. It arrives inside a Slack message, a PR title, a
// commit body — "blocked by PROJ-123 until Friday" — and the way out of that today is to
// select it, copy it, open the omnibox, type the keyword, paste. This is the same jump with
// the reading step removed, and it costs nothing the extension did not already have: no host
// permission, no content script, no page access. `contexts: ["selection"]` means Chrome
// hands over the selected text; we never look at the page.
const PE_CTX_ID = "pe-open-key";

function ensureContextMenu() {
  if (!chrome.contextMenus) return;
  // Rebuilt rather than updated: onInstalled and onStartup both run this, and creating an id
  // that already exists is an error Chrome reports through lastError.
  chrome.contextMenus.removeAll(() => {
    void (chrome.runtime && chrome.runtime.lastError);
    chrome.contextMenus.create(
      {
        id: PE_CTX_ID,
        title: peMsg("ctxOpenSelection") || "Open work item from selection",
        contexts: ["selection"]
      },
      () => void (chrome.runtime && chrome.runtime.lastError)
    );
  });
}

if (chrome.contextMenus) {
  chrome.contextMenus.onClicked.addListener((info) => {
    if (!info || info.menuItemId !== PE_CTX_ID) return;
    const key = peKeyFromText(info.selectionText);
    if (!key) return; // no key in what was selected — a menu entry that does nothing is the
    // honest outcome here, because the alternative is opening something the reader did not
    // point at. The item only appears on a selection, so this is not a dead end they can sit in.
    peGetSettings().then((settings) => {
      const link = peRouteQuickLink(peEnabledQuickLinks(settings), key);
      const url = link ? peExpandQuickLink(link, key) : "";
      if (!peIsHttpUrl(url)) {
        chrome.runtime.openOptionsPage();
        return;
      }
      // A new tab, always: the selection is on a page the reader was reading, and replacing
      // it with the work item would lose their place.
      chrome.tabs.create({ url });
      peRememberOpened(key, url, link);
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  reconcile();
  ensureSyncAlarm();
  syncSources(true);
  refreshBadge();
  ensureContextMenu();
});
chrome.runtime.onStartup.addListener(() => {
  reconcile();
  ensureSyncAlarm();
  syncSources(false);
  refreshBadge();
  ensureContextMenu();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === PE_SYNC_ALARM) syncSources(false);
});

chrome.permissions.onAdded.addListener(async (perms) => {
  await reconcile();
  await injectExistingTabs((perms && perms.origins) || []);
  // A freshly granted origin may be a template source — try syncing it now.
  syncSources(true);
  refreshBadge();
});
chrome.permissions.onRemoved.addListener(() => {
  reconcile();
  refreshBadge();
});

chrome.storage.onChanged.addListener((changes, area) => {
  // The core item only — NOT peSettingsChanged. The worker reconciles content-script
  // registration (domains), the sync alarm (sources) and the cache (sources); none of
  // those live in a template shard. Reacting to shard writes would just repeat this work,
  // and the prune step of a shrinking save (a remove of peTpl.* keys) would run it a
  // second time for one save. Domains/rules/sources are always in the core item, so its
  // change is the only signal this worker needs. (The picker and the settings page do
  // need template edits, and they use peSettingsChanged.)
  if (area === "sync" && changes[PE_STORAGE_KEY]) {
    reconcile();
    ensureSyncAlarm();
    pruneSyncCacheNow();
    // A settings change synced from another device is the exact moment a permission gap
    // opens on THIS device — new domains/sources it has never granted. Re-evaluate the badge.
    refreshBadge();
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "pe-open-options") {
    chrome.runtime.openOptionsPage();
    return;
  }
  // The popup asking us to remember a jump it is about to make. It has to be us: the popup
  // calls window.close() in the same breath, and a storage write left pending in a context
  // that is being torn down is a write that may never land. No reply — the caller is gone.
  if (msg && msg.type === "pe-remember-open") {
    peRememberOpened(msg.key, msg.url, { name: msg.name });
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

/* ------------------------------------------------------------------ */
/* Keyboard command — toggle focus mode on the tab in front.            */
/*                                                                      */
/* A browser command, not a key handler in the page, and that is the     */
/* whole point: on macOS every Option+letter is a character (⌥C is "ç"), */
/* which is why content.js has to refuse Alt+C while you are typing.     */
/* Focus mode is the opposite case — you reach for it *while* writing a  */
/* description — so a shortcut that either eats a character or declines  */
/* to fire in an editor would be wrong both ways. Chrome intercepts a    */
/* command before the page sees the keystroke, and the user can rebind   */
/* it at chrome://extensions/shortcuts, which no in-page handler offers. */
/* ------------------------------------------------------------------ */
try {
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command !== "toggle-focus") return;
    const id = tab && tab.id;
    if (id == null) return;
    try {
      chrome.tabs.sendMessage(id, { type: "pe-focus-toggle" }, () => {
        // No content script here (a site the extension does not run on) — nothing to
        // toggle. The callback exists to read lastError: leaving it unread is what prints
        // "Unchecked runtime.lastError" into the worker's console on every such press.
        void chrome.runtime.lastError;
      });
    } catch (_) {}
  });
} catch (_) {}

/* ------------------------------------------------------------------ */
/* Omnibox — "issue <KEY>" in the address bar jumps straight to the    */
/* item. It only opens a URL: no host permission, no content script,   */
/* so it works on any tab, including where the enhancer never runs.    */
/* ------------------------------------------------------------------ */

// Chrome renders a suggestion description as XML, so a raw & or < is dropped or throws.
function peOmniEscape(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Honour the omnibox disposition: Enter → current tab, Alt+Enter → new foreground tab,
// Meta+Enter → new background tab. Guarded to http(s) so nothing else can be navigated to.
function peOpenUrl(url, disposition) {
  if (!peIsHttpUrl(url)) return;
  if (disposition === "currentTab") {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const id = tabs && tabs[0] && tabs[0].id;
      if (id != null) chrome.tabs.update(id, { url });
      else chrome.tabs.create({ url });
    });
  } else {
    chrome.tabs.create({ url, active: disposition !== "newBackgroundTab" });
  }
}

// Remember a jump, so the omnibox can offer it back. Fire-and-forget: a jump that opened is
// the outcome the reader wanted, and a failed bookkeeping write must not be allowed to look
// like a failed jump.
function peRememberOpened(key, url, link) {
  peGetRecent()
    .then((list) => peSaveRecent(peRecentAdd(list, { key, url, name: (link && link.name) || "" }, Date.now())))
    .catch(() => {});
}

function peEnabledQuickLinks(settings) {
  return (settings.quickLinks || []).filter((l) => l && l.enabled !== false && String(l.url || "").trim());
}

if (chrome.omnibox) {
  const omniReset = () =>
    chrome.omnibox.setDefaultSuggestion({
      description: peOmniEscape(peMsg("omniboxHint") || "Type a work item key to open it")
    });
  omniReset();

  // A row for a key opened before. `content` is the resolved URL, which is what
  // onInputEntered opens verbatim — so a recent row costs no lookup when it is picked.
  const recentRows = (recent, text) =>
    peRecentMatches(recent, text)
      .filter((r) => peIsHttpUrl(r.url))
      .map((r) => ({
        content: r.url,
        description:
          peOmniEscape(peMsg("omniboxRecent", [r.key, r.name || ""]) || r.key) +
          " <url>" +
          peOmniEscape(r.url) +
          "</url>"
      }));

  chrome.omnibox.onInputChanged.addListener((text, suggest) => {
    const key = (text || "").trim();
    Promise.all([peGetSettings(), peGetRecent()]).then(([settings, recent]) => {
      const links = peEnabledQuickLinks(settings);
      // Nothing typed yet: the keyword is on screen and the cursor is waiting, which is
      // exactly the moment the reader is trying to remember a key. Offer the last few.
      if (!key || !links.length) {
        chrome.omnibox.setDefaultSuggestion({
          description: peOmniEscape(
            links.length
              ? peMsg("omniboxHint") || "Type a work item key to open it"
              : peMsg("omniboxNoTarget") || "No quick link set — Enter opens Settings"
          )
        });
        suggest(links.length ? recentRows(recent, "") : []);
        return;
      }
      // Words, not a key — the one disambiguation, and it is made by shape so there is no
      // syntax to learn. Only targets that were given a search URL can answer.
      if (!peLooksLikeKey(key)) {
        const searchable = links.filter((l) => peIsHttpUrl(peExpandSearchLink(l, key)));
        const first = searchable[0];
        chrome.omnibox.setDefaultSuggestion({
          description: first
            ? peOmniEscape(peMsg("omniboxSearch", [first.name || "", key]) || "Search for " + key) +
              " <url>" +
              peOmniEscape(peExpandSearchLink(first, key)) +
              "</url>"
            : peOmniEscape(peMsg("omniboxHint") || "Type a work item key to open it")
        });
        suggest(
          searchable
            .slice(1)
            .map((l) => ({
              content: peExpandSearchLink(l, key),
              description:
                peOmniEscape(peMsg("omniboxSearch", [l.name || "", key]) || "Search for " + key) +
                " <url>" +
                peOmniEscape(peExpandSearchLink(l, key)) +
                "</url>"
            }))
            // A half-typed key is still words to this branch, so the recents that start with
            // it belong here too — it is the same list the reader was narrowing.
            .concat(recentRows(recent, key))
        );
        return;
      }
      const chosen = peRouteQuickLink(links, key);
      const chosenUrl = peExpandQuickLink(chosen, key);
      // The default row is what plain Enter uses; show where it lands.
      chrome.omnibox.setDefaultSuggestion({
        description:
          peOmniEscape(peMsg("omniboxOpen", [key, (chosen && chosen.name) || ""]) || "Open " + key) +
          " <url>" +
          peOmniEscape(chosenUrl) +
          "</url>"
      });
      // The other enabled targets, so a key that auto-routed one way can still be sent
      // elsewhere. `content` is the resolved URL — onInputEntered opens a URL verbatim.
      const others = links
        .filter((l) => l !== chosen)
        .map((l) => {
          const u = peExpandQuickLink(l, key);
          return {
            content: u,
            description:
              peOmniEscape(peMsg("omniboxOpen", [key, l.name || ""]) || "Open " + key) +
              " <url>" +
              peOmniEscape(u) +
              "</url>"
          };
        })
        .filter((s) => peIsHttpUrl(s.content));
      suggest(others);
    });
  });

  chrome.omnibox.onInputEntered.addListener((text, disposition) => {
    const entered = (text || "").trim();
    if (!entered) return;
    // A picked suggestion arrives as its already-resolved URL — open it verbatim.
    if (peIsHttpUrl(entered)) {
      peOpenUrl(entered, disposition);
      // Which item that was is a question the quick links can answer, so a row picked from
      // the list counts as a jump too — including a recent one, which moves back to the top.
      // A search result URL matches no template and is simply not remembered, which is
      // right: a phrase is not an item.
      peGetSettings().then((settings) => {
        const m = peMatchItemUrl(peEnabledQuickLinks(settings), entered);
        if (m) peRememberOpened(m.key, entered, m.link);
      });
      omniReset();
      return;
    }
    peGetSettings().then((settings) => {
      const links = peEnabledQuickLinks(settings);
      // Words rather than a key: the same shape test the suggestions used, so plain Enter
      // lands where the row above it said it would.
      if (!peLooksLikeKey(entered)) {
        const first = links.filter((l) => peIsHttpUrl(peExpandSearchLink(l, entered)))[0];
        const surl = first ? peExpandSearchLink(first, entered) : "";
        if (peIsHttpUrl(surl)) peOpenUrl(surl, disposition);
        else chrome.runtime.openOptionsPage(); // no target can search — go and give one a search URL
        omniReset();
        return;
      }
      const chosen = peRouteQuickLink(links, entered);
      const url = chosen ? peExpandQuickLink(chosen, entered) : "";
      if (peIsHttpUrl(url)) {
        peOpenUrl(url, disposition);
        peRememberOpened(entered, url, chosen);
      } else chrome.runtime.openOptionsPage(); // nothing configured, or a bad url — send them to set one
      omniReset();
    });
  });
}
