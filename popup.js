// popup.js — quick toggle + status display
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  let state = null;
  let syncCache = { bySource: {} }; // synced templates (chrome.storage.local)
  let currentHost = "";
  let currentTabId = null;

  function updateDomainStatus() {
    const statusEl = $("domainStatus");
    const addBtn = $("addDomain");
    const pickBtn = $("pickEl");
    const rescanBtn = $("rescan");
    if (!currentHost) {
      statusEl.textContent = peMsg("popUnknown");
      statusEl.className = "pop-status";
      addBtn.hidden = true;
      pickBtn.hidden = true;
      rescanBtn.hidden = true;
      return;
    }
    const matched = state.allDomains || peDomainMatches(state.domains, currentHost);
    const active = state.enabled && matched;
    pickBtn.hidden = !active; // picker is only offered on active sites
    rescanBtn.hidden = !active; // re-scan/self-heal is only relevant on active sites
    if (active) {
      statusEl.textContent = peMsg("popActive", [currentHost]);
      statusEl.className = "pop-status on";
      addBtn.hidden = true;
    } else if (!state.enabled) {
      statusEl.textContent = peMsg("popDisabled", [currentHost]);
      statusEl.className = "pop-status off";
      addBtn.hidden = true;
    } else {
      statusEl.textContent = peMsg("popInactive", [currentHost]);
      statusEl.className = "pop-status off";
      addBtn.hidden = false;
    }
  }

  function init() {
    peApplyI18n(document);
    $("enabled").checked = !!state.enabled;
    $("tplCount").textContent = peCountTemplates(peBuildTemplateSections(state, syncCache));
    updateDomainStatus();

    $("enabled").addEventListener("change", async () => {
      state.enabled = $("enabled").checked;
      await peSaveSettings(state);
      updateDomainStatus();
    });

    $("openOptions").addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
      window.close();
    });

    $("pickEl").addEventListener("click", () => {
      if (currentTabId == null) return;
      try {
        chrome.tabs.sendMessage(currentTabId, { type: "pe-start-picker" });
      } catch (_) {}
      window.close();
    });

    // Force a re-scan (self-heal) on the current tab; keep the popup open for feedback.
    $("rescan").addEventListener("click", () => {
      if (currentTabId == null) return;
      const statusEl = $("domainStatus");
      statusEl.textContent = peMsg("popRescanning");
      statusEl.className = "pop-status";
      try {
        chrome.tabs.sendMessage(currentTabId, { type: "pe-rescan" }, (resp) => {
          if (chrome.runtime.lastError || !resp) {
            statusEl.textContent = peMsg("popNotLoaded");
            statusEl.className = "pop-status off";
          } else if (!resp.active) {
            statusEl.textContent = peMsg("popInactiveHere");
            statusEl.className = "pop-status off";
          } else if (resp.buttons > 0) {
            statusEl.textContent = peMsg("popRescanReady");
            statusEl.className = "pop-status on";
          } else {
            statusEl.textContent = peMsg("popRescanOpen");
            statusEl.className = "pop-status on";
          }
        });
      } catch (_) {
        statusEl.textContent = peMsg("popNotLoadedShort");
        statusEl.className = "pop-status off";
      }
    });

    $("addDomain").addEventListener("click", () => {
      if (!currentHost) return;
      // Persist the domain FIRST. Requesting a permission from a popup closes the
      // popup when the prompt appears, which would kill anything after an await —
      // so we don't await. storage.set is dispatched synchronously and completes
      // in the browser process even after the popup is gone.
      if (!state.domains.includes(currentHost)) state.domains.push(currentHost);
      state.enabled = true;
      peSaveSettings(state);
      // Request access to just this origin. Called synchronously (no prior await)
      // so the click still counts as the required user gesture. On grant, the
      // service worker (permissions.onAdded) registers the script + injects the tab.
      try {
        chrome.permissions.request({ origins: ["*://" + currentHost + "/*"] }, (granted) => {
          // Runs only if the popup is still open. If denied, roll back the domain.
          if (!granted) {
            state.domains = (state.domains || []).filter((d) => d !== currentHost);
            peSaveSettings(state);
            const statusEl = $("domainStatus");
            statusEl.textContent = peMsg("popPermNeeded", [currentHost]);
            statusEl.className = "pop-status off";
            return;
          }
          $("enabled").checked = true;
          updateDomainStatus();
        });
      } catch (_) {}
    });
  }

  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    try {
      const tab = tabs && tabs[0];
      if (tab) {
        currentTabId = tab.id;
        if (tab.url) currentHost = new URL(tab.url).hostname;
      }
    } catch (_) {}
    Promise.all([peGetSettings(), peGetSyncCache()]).then(([s, c]) => {
      state = s;
      syncCache = c;
      init();
    });
  });
})();
