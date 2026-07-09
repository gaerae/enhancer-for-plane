// popup.js — quick toggle + status display
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  let state = null;
  let currentHost = "";
  let currentTabId = null;

  function updateDomainStatus() {
    const statusEl = $("domainStatus");
    const addBtn = $("addDomain");
    const pickBtn = $("pickEl");
    const rescanBtn = $("rescan");
    if (!currentHost) {
      statusEl.textContent = "Current site: unknown";
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
      statusEl.textContent = "Active: " + currentHost;
      statusEl.className = "pop-status on";
      addBtn.hidden = true;
    } else if (!state.enabled) {
      statusEl.textContent = "Disabled: " + currentHost;
      statusEl.className = "pop-status off";
      addBtn.hidden = true;
    } else {
      statusEl.textContent = "Inactive site: " + currentHost;
      statusEl.className = "pop-status off";
      addBtn.hidden = false;
    }
  }

  function init() {
    $("enabled").checked = !!state.enabled;
    $("tplCount").textContent = (state.templates || []).length;
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
      statusEl.textContent = "Re-scanning…";
      statusEl.className = "pop-status";
      try {
        chrome.tabs.sendMessage(currentTabId, { type: "pe-rescan" }, (resp) => {
          if (chrome.runtime.lastError || !resp) {
            statusEl.textContent = "Not loaded here — reload the page (Ctrl/Cmd+R).";
            statusEl.className = "pop-status off";
          } else if (!resp.active) {
            statusEl.textContent = "Inactive on this site.";
            statusEl.className = "pop-status off";
          } else if (resp.buttons > 0) {
            statusEl.textContent = "Re-scanned — template button ready.";
            statusEl.className = "pop-status on";
          } else {
            statusEl.textContent = "Re-scanned. Open a work item's description.";
            statusEl.className = "pop-status on";
          }
        });
      } catch (_) {
        statusEl.textContent = "Not loaded here — reload the page.";
        statusEl.className = "pop-status off";
      }
    });

    $("addDomain").addEventListener("click", async () => {
      if (!currentHost) return;
      if (!state.domains.includes(currentHost)) state.domains.push(currentHost);
      state.enabled = true;
      $("enabled").checked = true;
      await peSaveSettings(state);
      updateDomainStatus();
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
    peGetSettings().then((s) => {
      state = s;
      init();
    });
  });
})();
