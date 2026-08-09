// popup.js — quick toggle + status display
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  let state = null;
  let syncCache = { bySource: {} }; // synced templates (chrome.storage.local)
  let currentHost = "";
  let currentTabId = null;
  let currentTabUrl = "";
  let currentTabTitle = "";
  let recent = [];

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
      refreshFocusToggle(false);
      return;
    }
    const matched = state.allDomains || peDomainMatches(state.domains, currentHost);
    const active = state.enabled && matched;
    pickBtn.hidden = !active; // picker is only offered on active sites
    rescanBtn.hidden = !active; // re-scan/self-heal is only relevant on active sites
    refreshFocusToggle(active);
    if (active) {
      statusEl.textContent = peMsg("popActive", [currentHost]);
      statusEl.className = "pop-status on";
      addBtn.hidden = true;
    } else if (!state.enabled) {
      // The master switch is off everywhere, so this says nothing about the host — naming
      // it here was what made the switch above read as a per-site one.
      statusEl.textContent = peMsg("popDisabled");
      statusEl.className = "pop-status off";
      addBtn.hidden = true;
    } else {
      statusEl.textContent = peMsg("popInactive", [currentHost]);
      statusEl.className = "pop-status off";
      addBtn.hidden = false;
    }
  }

  // Focus mode lives in the tab, not in settings, so the popup has to ask the page for it
  // rather than read it from state. No answer means no content script here — a tab opened
  // before the site was enabled, or a page that has not been reloaded since — and in that
  // case the switch is hidden instead of shown in a position it cannot honour.
  // Numbered because the answer arrives after the question has moved on: flipping the master
  // switch off calls this again, and an in-flight reply from when the site was still active
  // would put the switch back on screen under a status line that says the extension is off.
  let focusQuery = 0;
  function refreshFocusToggle(active) {
    const wrap = $("focusWrap");
    if (!wrap) return;
    const mine = ++focusQuery;
    if (!active || currentTabId == null) {
      wrap.hidden = true;
      return;
    }
    try {
      chrome.tabs.sendMessage(currentTabId, { type: "pe-focus-state" }, (resp) => {
        if (mine !== focusQuery) return; // a newer question is already out
        if (chrome.runtime.lastError || !resp || !resp.active) {
          wrap.hidden = true;
          return;
        }
        $("focusToggle").checked = !!resp.focus;
        wrap.hidden = false;
      });
    } catch (_) {
      wrap.hidden = true;
    }
  }

  // Quick open: type a key, Enter opens it in a new tab. Only shown when at least one
  // quick link is configured; the target picker appears only when there is more than one.
  // It just opens a URL — no host permission, and it works regardless of the current site.
  function setupJump() {
    const block = $("jumpBlock");
    const form = $("jumpForm");
    const input = $("jumpKey");
    const targetSel = $("jumpTarget");
    const links = (state.quickLinks || []).filter((l) => l && l.enabled !== false && String(l.url || "").trim());
    if (!links.length) return; // nothing to jump to → leave the block (label + divider) hidden

    block.hidden = false;
    if (links.length > 1) {
      // "Auto" routes by the key's prefix; the named rows force one target.
      targetSel.innerHTML = "";
      const opts = [{ v: "", t: peMsg("popJumpAuto") || "Auto" }].concat(
        links.map((l) => ({ v: l.id, t: l.name || l.url }))
      );
      for (const o of opts) {
        const opt = document.createElement("option");
        opt.value = o.v;
        opt.textContent = o.t;
        targetSel.appendChild(opt);
      }
      targetSel.hidden = false;
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const key = (input.value || "").trim();
      if (!key) return;
      let link = null;
      const forced = targetSel.hidden ? "" : targetSel.value;
      if (forced) link = links.find((l) => l.id === forced) || null;
      if (!link) link = peRouteQuickLink(links, key);
      // Words rather than a key go to the target's search URL, the same shape test the
      // omnibox makes — so the two entry points cannot disagree about what was typed.
      if (!peLooksLikeKey(key)) {
        const searchable = forced && link ? [link] : links;
        const first = searchable.filter((l) => peIsHttpUrl(peExpandSearchLink(l, key)))[0];
        const surl = first ? peExpandSearchLink(first, key) : "";
        if (peIsHttpUrl(surl)) {
          chrome.tabs.create({ url: surl });
          window.close();
          return;
        }
        // Nothing here can search — no target has a search URL, which is the default for a
        // hand-added one and for Linear, whose search is not addressable at all. Returning
        // in silence made Enter look broken. The omnibox answers this case by opening
        // Settings, and two entry points for one feature may not disagree about it.
        chrome.runtime.openOptionsPage();
        window.close();
        return;
      }
      jumpTo(key, link ? peExpandQuickLink(link, key) : "", link);
    });
    input.focus();
  }

  // Open a key and remember it. The remembering is handed to the worker rather than done
  // here: the next two lines destroy this page, and a storage write pending in a context
  // being torn down may never land. It is also the right shape — the jump happens now, and
  // bookkeeping never stands between the reader and the tab they asked for.
  function jumpTo(key, url, link) {
    if (!peIsHttpUrl(url)) return;
    try {
      chrome.runtime.sendMessage({ type: "pe-remember-open", key, url, name: (link && link.name) || "" });
    } catch (_) {}
    chrome.tabs.create({ url });
    window.close();
  }

  // The keys opened last, as buttons. Same list the omnibox offers, in the other place the
  // reader might be standing when they cannot remember a key.
  function renderRecent() {
    const box = $("recentList");
    const rows = peRecentMatches(recent, "").filter((r) => peIsHttpUrl(r.url)).slice(0, 6);
    box.innerHTML = "";
    box.hidden = !rows.length;
    rows.forEach((r) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pop-recent-item";
      b.title = r.url;
      const k = document.createElement("span");
      k.className = "pop-recent-key";
      k.textContent = r.key;
      b.appendChild(k);
      if (r.name) {
        const n = document.createElement("span");
        n.className = "pop-recent-name";
        n.textContent = r.name;
        b.appendChild(n);
      }
      b.addEventListener("click", () => jumpTo(r.key, r.url, { name: r.name }));
      box.appendChild(b);
    });
  }

  // Copy reference, from the tab's address and title — no injection, no page read. This is
  // the low-dependency half of the feature the content script does on Plane: it cannot see
  // into a peek panel (the address bar names the list there), and it says nothing at all
  // unless a quick link recognises the URL. When it does work it works anywhere.
  function setupCopy() {
    const block = $("copyBlock");
    const formats = (state.copyFormats || []).filter((f) => f && String(f.format || "").trim());
    const m = peMatchItemUrl(state.quickLinks || [], currentTabUrl);
    if (!m || !formats.length) return; // not a work item, or nothing to copy it as
    const item = {
      key: m.key,
      title: peTitleFromDocTitle(currentTabTitle, m.key),
      // The canonical form the template describes, not the address bar: Linear's address
      // carries a title slug it redirects from, and that slug is dead weight in a paste.
      url: peExpandQuickLink(m.link, m.key)
    };
    block.hidden = false;
    $("copyItem").textContent = item.title ? m.key + " " + item.title : m.key;
    const box = $("copyFormats");
    box.innerHTML = "";
    formats.forEach((f) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pop-btn ghost pop-copy-fmt";
      b.textContent = f.name || peMsg("menuUntitled");
      const text = peExpandCopyFormat(f.format, item);
      b.title = text;
      b.addEventListener("click", async () => {
        const missing = peMissingItemFields(f.format, item);
        try {
          await navigator.clipboard.writeText(text);
        } catch (_) {
          $("copyLabel").textContent = peMsg("msgCopyFailed");
          return;
        }
        // The same contract the in-page copy follows: a field the tab could not give us
        // stays on the clipboard as its own token, and the reader is told which one before
        // they paste rather than after.
        $("copyLabel").textContent = missing.length
          ? peMsg("msgCopiedMissing", [missing.map((n) => "{{item." + n + "}}").join(", ")])
          : peMsg("msgCopied");
      });
      box.appendChild(b);
    });
  }

  function init() {
    peApplyI18n(document);
    $("enabled").checked = !!state.enabled;
    $("tplCount").textContent = peCountTemplates(peBuildTemplateSections(state, syncCache));
    setupJump();
    renderRecent();
    setupCopy();
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

    // Route the toolbar badge here: if this device is missing access for any listed domain
    // or source (settings sync, host permissions do not), point at Settings — which has the
    // one-click grant. Async; the notice appears when the check resolves.
    (async () => {
      let missing = 0;
      if (state.enabled) {
        for (const o of peDesiredOrigins(state)) {
          let has = false;
          try {
            has = await chrome.permissions.contains({ origins: [o] });
          } catch (_) {}
          if (!has) missing++;
        }
      }
      const notice = $("permNotice");
      if (notice && missing > 0) {
        notice.hidden = false;
        notice.addEventListener("click", () => {
          chrome.runtime.openOptionsPage();
          window.close();
        });
      }
    })();

    // Send the position the switch was just moved to, not "flip it": the popup and the page
    // are two copies of one boolean, and only the box the user clicked knows what they meant.
    $("focusToggle").addEventListener("change", () => {
      const box = $("focusToggle");
      if (currentTabId == null) return;
      try {
        chrome.tabs.sendMessage(currentTabId, { type: "pe-focus-toggle", on: box.checked }, (resp) => {
          if (chrome.runtime.lastError || !resp || !resp.ok) {
            $("focusWrap").hidden = true;
            return;
          }
          box.checked = !!resp.focus;
        });
      } catch (_) {}
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
        currentTabUrl = tab.url || "";
        currentTabTitle = tab.title || "";
        if (tab.url) currentHost = new URL(tab.url).hostname;
      }
    } catch (_) {}
    Promise.all([peGetSettings(), peGetSyncCache(), peGetRecent()]).then(([s, c, r]) => {
      state = s;
      syncCache = c;
      recent = r;
      init();
    });
  });
})();
