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

chrome.runtime.onInstalled.addListener(() => reconcile());
chrome.runtime.onStartup.addListener(() => reconcile());

chrome.permissions.onAdded.addListener(async (perms) => {
  await reconcile();
  await injectExistingTabs((perms && perms.origins) || []);
});
chrome.permissions.onRemoved.addListener(() => reconcile());

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes[PE_STORAGE_KEY]) reconcile();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "pe-open-options") chrome.runtime.openOptionsPage();
});
