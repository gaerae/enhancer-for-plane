// options.js — settings page logic
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  let state = null;
  let syncCache = { bySource: {} }; // synced-template status/cache (chrome.storage.local)
  let dirty = false; // whether the user has edited the form
  // Ignore the storage changes our own save triggers. It has to span the whole save, not
  // absorb a single event: one save writes the settings and — when the template shards
  // shrink — prunes the ones it no longer needs, which is a second storage operation and
  // therefore a second event. Consuming only the first told the user "Loaded the rule
  // added by the picker" immediately after "Saved.", about their own deletion.
  let savingSelf = false;

  const el = {
    enabled: $("enabled"),
    allDomains: $("allDomains"),
    domains: $("domains"),
    ruleList: $("ruleList"),
    ruleEmpty: $("ruleEmpty"),
    addRule: $("addRule"),
    ruleRow: $("ruleRow"),
    templateList: $("templateList"),
    variableList: $("variableList"),
    variableEmpty: $("variableEmpty"),
    addVariable: $("addVariable"),
    varRow: $("varRow"),
    templateEmpty: $("templateEmpty"),
    addTemplate: $("addTemplate"),
    tplRow: $("tplRow"),
    syncEnabled: $("syncEnabled"),
    sourceList: $("sourceList"),
    sourceEmpty: $("sourceEmpty"),
    addSource: $("addSource"),
    syncNow: $("syncNow"),
    srcRow: $("srcRow"),
    save: $("save"),
    reset: $("reset"),
    status: $("status"),
    exportBtn: $("exportBtn"),
    importBtn: $("importBtn"),
    importFile: $("importFile"),
    exportFeedBtn: $("exportFeedBtn")
  };

  // labelKey feeds the rule's label field on click, so it must follow the UI language.
  const PRESETS = {
    modulename: {
      labelKey: "optPresetModuleName",
      selector: ".max-w-40",
      property: "max-width",
      value: "320px"
    },
    dropdown: {
      labelKey: "optPresetDropdown",
      selector: '[id^="headlessui-combobox-options"] > div',
      property: "width",
      value: "320px"
    },
    // Cycle names and the breadcrumb path (project / cycle / module / label names)
    // share this Tailwind cap; widening it stops those from truncating too.
    cyclename: {
      labelKey: "optPresetCycleName",
      selector: ".max-w-\\[150px\\].truncate",
      property: "max-width",
      value: "320px"
    }
  };

  const uid = (p) => p + "-" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

  /* ---------------- render ---------------- */
  function render() {
    el.enabled.checked = !!state.enabled;
    el.allDomains.checked = !!state.allDomains;
    el.domains.value = (state.domains || []).join("\n");
    el.domains.disabled = !!state.allDomains;
    renderRules();
    renderTemplates();
    renderVariables();
    renderSources();
    updateStorageMeter();
    dirty = false; // just re-rendered the form from state, so it's clean
  }

  function renderRules() {
    el.ruleList.innerHTML = "";
    const list = state.rules || [];
    el.ruleEmpty.hidden = list.length > 0;
    list.forEach((rule, idx) => {
      const node = el.ruleRow.content.firstElementChild.cloneNode(true);
      peApplyI18n(node);
      const enabled = node.querySelector(".rule-enabled");
      const label = node.querySelector(".rule-label");
      const selector = node.querySelector(".rule-selector");
      const property = node.querySelector(".rule-property");
      const value = node.querySelector(".rule-value");
      const del = node.querySelector(".rule-del");

      enabled.checked = rule.enabled !== false;
      label.value = rule.label || "";
      selector.value = rule.selector || "";
      property.value = rule.property || "";
      value.value = rule.value || "";

      enabled.addEventListener("change", () => (state.rules[idx].enabled = enabled.checked));
      label.addEventListener("input", () => (state.rules[idx].label = label.value));
      selector.addEventListener("input", () => {
        state.rules[idx].selector = selector.value;
        markSelector(selector);
      });
      property.addEventListener("input", () => (state.rules[idx].property = property.value));
      value.addEventListener("input", () => (state.rules[idx].value = value.value));
      del.addEventListener("click", () => {
        state.rules.splice(idx, 1);
        renderRules();
      });

      markSelector(selector);
      el.ruleList.appendChild(node);
    });
  }

  // visual feedback for selector validity
  function markSelector(input) {
    const v = input.value.trim();
    let ok = true;
    if (v) {
      try {
        document.createDocumentFragment().querySelector(v);
      } catch (_) {
        ok = false;
      }
    }
    input.classList.toggle("invalid", !ok);
    input.title = ok ? "" : peMsg("msgInvalidSelector");
  }

  // A source URL must be one the worker can actually ask for: http(s), so it maps to a
  // host permission. Import already drops anything else — but dropping a URL the user
  // typed would make their row vanish on Save with a cheerful "Saved". Show it instead.
  function markSourceUrl(input) {
    const v = input.value.trim();
    const ok = !v || !!peOriginPatternForUrl(v);
    input.classList.toggle("invalid", !ok);
    input.title = ok ? "" : peMsg("msgInvalidSrcUrl");
  }

  function renderTemplates() {
    el.templateList.innerHTML = "";
    const list = state.templates || [];
    el.templateEmpty.hidden = list.length > 0;
    list.forEach((tpl, idx) => {
      const node = el.tplRow.content.firstElementChild.cloneNode(true);
      peApplyI18n(node);
      const name = node.querySelector(".tpl-name");
      const titleInput = node.querySelector(".tpl-title");
      const content = node.querySelector(".tpl-content");
      const del = node.querySelector(".tpl-del");
      name.value = tpl.name || "";
      titleInput.value = tpl.title || "";
      content.value = tpl.content || "";
      name.addEventListener("input", () => (state.templates[idx].name = name.value));
      titleInput.addEventListener("input", () => (state.templates[idx].title = titleInput.value));
      content.addEventListener("input", () => (state.templates[idx].content = content.value));
      del.addEventListener("click", () => {
        state.templates.splice(idx, 1);
        renderTemplates();
      });
      el.templateList.appendChild(node);
    });
  }

  function renderVariables() {
    if (!Array.isArray(state.variables)) state.variables = [];
    el.variableList.innerHTML = "";
    const list = state.variables;
    el.variableEmpty.hidden = list.length > 0;
    list.forEach((v, idx) => {
      const node = el.varRow.content.firstElementChild.cloneNode(true);
      peApplyI18n(node);
      const token = node.querySelector(".var-token");
      const name = node.querySelector(".var-name");
      const value = node.querySelector(".var-value");
      const del = node.querySelector(".var-del");

      name.value = v.name || "";
      value.value = v.value || "";

      // Show the token the name actually produces, so what to type in a template is
      // never a guess.
      const paint = () => {
        const n = (state.variables[idx].name || "").trim();
        const ok = PE_VAR_NAME_RE.test(n);
        const dupe =
          ok && state.variables.some((o, i) => i !== idx && (o.name || "").trim().toLowerCase() === n.toLowerCase());
        token.textContent = n && ok && !dupe ? "{{" + PE_VAR_PREFIX + n + "}}" : "";
        name.classList.toggle("invalid", !!n && (!ok || dupe));
        name.title = !n ? "" : !ok ? peMsg("msgVarBadName") : dupe ? peMsg("msgVarDupe") : "";
      };

      name.addEventListener("input", () => {
        state.variables[idx].name = name.value;
        paint();
      });
      value.addEventListener("input", () => (state.variables[idx].value = value.value));
      del.addEventListener("click", () => {
        state.variables.splice(idx, 1);
        renderVariables();
      });

      paint();
      el.variableList.appendChild(node);
    });
  }

  function ensureSync() {
    if (!state.templateSync || typeof state.templateSync !== "object") {
      state.templateSync = { enabled: false, sources: [] };
    }
    if (!Array.isArray(state.templateSync.sources)) state.templateSync.sources = [];
    return state.templateSync;
  }

  // Local date, YYYY-MM-DD. Stamped on an exported feed as its `version`.
  function fmtDay(ms) {
    try {
      const d = new Date(ms);
      const p = (n) => String(n).padStart(2, "0");
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
    } catch (_) {
      return "";
    }
  }

  function fmtTime(ms) {
    if (!ms) return "";
    try {
      const d = new Date(ms);
      const p = (n) => String(n).padStart(2, "0");
      return (
        d.getFullYear() +
        "-" +
        p(d.getMonth() + 1) +
        "-" +
        p(d.getDate()) +
        " " +
        p(d.getHours()) +
        ":" +
        p(d.getMinutes())
      );
    } catch (_) {
      return "";
    }
  }

  function sourceStatusText(src) {
    if (!src.url || !src.url.trim()) return { text: peMsg("msgSrcEnterUrl"), cls: "" };
    const entry = (syncCache.bySource || {})[src.id];
    if (!entry) return { text: peMsg("msgSrcNotSynced"), cls: "" };
    if (entry.status === "ok") {
      let t = peMsg("msgSrcSynced", [fmtTime(entry.fetchedAt), String(entry.count || 0)]);
      if (entry.dropped) t += peMsg("msgSrcSkipped", [String(entry.dropped)]);
      return { text: t, cls: "ok" };
    }
    let t = peMsg("msgSrcFailed", [entry.lastError || "error"]);
    if (entry.fetchedAt) t += peMsg("msgSrcLastGood", [fmtTime(entry.fetchedAt)]);
    return { text: t, cls: "err" };
  }

  function renderSources() {
    const sync = ensureSync();
    el.syncEnabled.checked = !!sync.enabled;
    el.sourceList.innerHTML = "";
    const list = sync.sources || [];
    el.sourceEmpty.hidden = list.length > 0;
    list.forEach((src, idx) => {
      const node = el.srcRow.content.firstElementChild.cloneNode(true);
      peApplyI18n(node);
      const enabled = node.querySelector(".src-enabled");
      const nameInput = node.querySelector(".src-name");
      const url = node.querySelector(".src-url");
      const interval = node.querySelector(".src-interval");
      const del = node.querySelector(".src-del");
      const statusEl = node.querySelector(".src-status");

      enabled.checked = src.enabled !== false;
      nameInput.value = src.name || "";
      url.value = src.url || "";
      interval.value = String(src.intervalMinutes || 360);
      // Unnamed source → the placeholder IS the name the picker falls back to, so the
      // header is never a surprise.
      const entry = (syncCache.bySource || {})[src.id];
      nameInput.placeholder = src.url ? peSourceDisplayName({ url: src.url }, entry) : peMsg("optSrcNamePh");

      enabled.addEventListener("change", () => (sync.sources[idx].enabled = enabled.checked));
      nameInput.addEventListener("input", () => (sync.sources[idx].name = nameInput.value));
      markSourceUrl(url);
      url.addEventListener("input", () => {
        sync.sources[idx].url = url.value.trim();
        markSourceUrl(url);
        const s = sourceStatusText(sync.sources[idx]);
        statusEl.textContent = s.text;
        statusEl.className = "src-status " + s.cls;
      });
      interval.addEventListener("change", () => (sync.sources[idx].intervalMinutes = parseInt(interval.value, 10) || 360));
      del.addEventListener("click", () => {
        sync.sources.splice(idx, 1);
        renderSources();
      });

      const s = sourceStatusText(src);
      statusEl.textContent = s.text;
      statusEl.className = "src-status " + s.cls;
      renderSourceGroups(node, sync.sources[idx], entry);
      el.sourceList.appendChild(node);
    });
  }

  // What a source actually delivered, read-only, with a per-group show/hide switch.
  // Unchecking is a view preference, not a delete: the group keeps syncing, it just
  // stays out of the picker. Editing content here is deliberately not offered — the
  // next sync would silently revert it.
  function renderSourceGroups(node, src, entry) {
    if (!entry || !Array.isArray(entry.templates) || !entry.templates.length) return;
    const groups = peGroupSourceTemplates(entry);
    const hidden = new Set(src.hiddenGroups || []);

    const det = document.createElement("details");
    det.className = "src-detail";
    const sum = document.createElement("summary");
    // Updated in place on toggle — re-rendering the list would collapse this <details>
    // and drop focus mid-click.
    const updateSummary = () => {
      const h = new Set(src.hiddenGroups || []);
      const shownCount = groups.filter((g) => !h.has(g.label)).length;
      const n = String(entry.templates.length);
      sum.textContent =
        (groups.length === 1
          ? peMsg("msgSrcSummaryOne", [n])
          : peMsg("msgSrcSummaryMany", [n, String(groups.length)])) +
        (shownCount < groups.length ? peMsg("msgSrcHidden", [String(groups.length - shownCount)]) : "");
    };
    updateSummary();
    det.appendChild(sum);

    groups.forEach((g) => {
      const row = document.createElement("div");
      row.className = "src-group";

      const head = document.createElement("label");
      head.className = "src-group-head";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !hidden.has(g.label);
      cb.addEventListener("change", () => {
        src.hiddenGroups = (src.hiddenGroups || []).filter((x) => x !== g.label);
        if (!cb.checked) src.hiddenGroups.push(g.label);
        row.classList.toggle("off", !cb.checked);
        updateSummary();
      });
      const label = document.createElement("span");
      label.className = "src-group-name";
      // Remote-authored text → textContent only.
      label.textContent = g.label || peMsg("msgUngrouped");
      const count = document.createElement("span");
      count.className = "src-group-count";
      count.textContent = String(g.items.length);
      head.appendChild(cb);
      head.appendChild(label);
      head.appendChild(count);

      const items = document.createElement("div");
      items.className = "src-group-items";
      items.textContent = g.items.map((t) => t.name).join(", ");

      row.classList.toggle("off", hidden.has(g.label));
      row.appendChild(head);
      row.appendChild(items);
      det.appendChild(row);
    });

    node.appendChild(det);
  }

  /* ---------------- events ---------------- */
  function bind() {
    el.enabled.addEventListener("change", () => (state.enabled = el.enabled.checked));

    el.allDomains.addEventListener("change", () => {
      state.allDomains = el.allDomains.checked;
      el.domains.disabled = state.allDomains;
    });

    el.domains.addEventListener("input", () => {
      state.domains = el.domains.value.split("\n").map((s) => s.trim()).filter(Boolean);
    });

    el.addRule.addEventListener("click", () => addRule({ label: "", selector: "", property: "max-width", value: "" }));

    document.querySelectorAll(".chip[data-preset]").forEach((chip) => {
      chip.addEventListener("click", () => addRule(PRESETS[chip.dataset.preset]));
    });

    el.addTemplate.addEventListener("click", () => {
      state.templates.push({ id: uid("tpl"), name: "", title: "", content: "" });
      renderTemplates();
      focusLast(".tpl-name");
    });

    el.addVariable.addEventListener("click", () => {
      if (!Array.isArray(state.variables)) state.variables = [];
      if (state.variables.length >= PE_MAX_VARIABLES) {
        flash(peMsg("msgVarLimit", [String(PE_MAX_VARIABLES)]), true);
        return;
      }
      state.variables.push({ name: "", value: "" });
      renderVariables();
      focusLast(".var-name");
    });

    el.syncEnabled.addEventListener("change", () => (ensureSync().enabled = el.syncEnabled.checked));

    el.addSource.addEventListener("click", () => {
      if (ensureSync().sources.length >= PE_SYNC_LIMITS.maxSources) {
        flash(peMsg("msgSrcLimit", [String(PE_SYNC_LIMITS.maxSources)]), true);
        return;
      }
      ensureSync().sources.push({
        id: uid("src"),
        url: "",
        name: "",
        intervalMinutes: 360,
        enabled: true,
        hiddenGroups: []
      });
      renderSources();
      focusLast(".src-name");
    });

    el.syncNow.addEventListener("click", syncNow);

    el.save.addEventListener("click", saveAll);
    el.reset.addEventListener("click", resetAll);

    // mark dirty on real user input (programmatic value sets don't fire these events)
    document.addEventListener(
      "input",
      () => {
        dirty = true;
        scheduleMeter();
      },
      true
    );
    document.addEventListener(
      "change",
      () => {
        dirty = true;
        scheduleMeter();
      },
      true
    );

    // reflect settings changed elsewhere (e.g. the picker)
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        // Synced-template cache updated by the service worker (scheduled/now) → refresh statuses.
        if (area === "local" && changes[PE_SYNC_CACHE_KEY]) {
          const nv = changes[PE_SYNC_CACHE_KEY].newValue;
          syncCache = { bySource: (nv && nv.bySource) || {} };
          renderSources();
          return;
        }
        if (!peSettingsChanged(changes, area)) return;
        if (savingSelf) return; // our own save; cleared once it has settled
        peGetSettings().then((s) => {
          // Read before deciding: a write that leaves the settings identical to what is
          // already on screen is not news, and announcing it is worse than saying
          // nothing. (Chrome does not promise onChanged arrives before the set callback,
          // so an event can outlive the flag above.)
          if (JSON.stringify(s) === JSON.stringify(state)) return;
          if (dirty) {
            flash(peMsg("msgChangedElsewhere"), true);
            return;
          }
          state = s;
          render();
          flash(peMsg("msgLoadedPicked"));
        });
      });
    } catch (_) {}

    el.exportBtn.addEventListener("click", exportSettings);
    el.exportFeedBtn.addEventListener("click", exportTeamFeed);
    el.importBtn.addEventListener("click", () => el.importFile.click());
    el.importFile.addEventListener("change", () => {
      const f = el.importFile.files && el.importFile.files[0];
      if (f) importSettings(f);
      el.importFile.value = "";
    });
  }

  function downloadJson(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportSettings() {
    // `settings.schema` already states which version this is; a second copy alongside
    // it would only be one more thing that can disagree.
    downloadJson({ _app: PE_APP_ID, settings: state }, "enhancer-for-plane-settings.json");
    flash(peMsg("msgExported"));
  }

  // Publish the user's own templates as a sync feed — the file a teammate subscribes to.
  // Deliberately not a backup: no domains, no rules, no variable values, no source URLs.
  // This one is meant to be handed to other people, and a backup is not.
  function exportTeamFeed() {
    const templates = (state.templates || []).filter(peTemplateHasContent);
    if (!templates.length) {
      flash(peMsg("msgFeedEmpty"), true);
      return;
    }
    // Asked, not stored: naming the collection is a decision about this file, and a
    // remembered name would go stale the moment it was published under another one.
    // Cancel means cancel — an empty answer still exports, just without a name.
    const name = prompt(peMsg("msgFeedNamePrompt"), "");
    if (name === null) return;
    const feed = peBuildTeamFeed(state, name, fmtDay(Date.now()));
    downloadJson(feed, "enhancer-for-plane-team-templates.json");
    flash(peMsg("msgFeedExported", [String(feed.templates.length)]));
  }

  function importSettings(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch (_) {
        flash(peMsg("msgImportInvalid"), true);
        return;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        flash(peMsg("msgImportInvalid"), true);
        return;
      }
      // Identify the file before merging any of it. Without this, any object-shaped
      // JSON was accepted and silently replaced the form.
      if (parsed._app !== PE_APP_ID) {
        // A template sync feed is the one wrong file that is genuinely easy to pick:
        // it is JSON, it says "templates", and it belongs in a different box entirely.
        const looksLikeFeed = Array.isArray(parsed.templates) && !parsed.rules && !parsed.domains;
        flash(peMsg(looksLikeFeed ? "msgImportIsSyncFile" : "msgImportNotOurs"), true);
        return;
      }
      const raw = parsed.settings;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        flash(peMsg("msgImportInvalid"), true);
        return;
      }
      // Refuse to half-apply a file from a newer version: unknown fields would survive
      // the merge and be written back on Save, quietly downgrading them.
      if (typeof raw.schema === "number" && raw.schema > PE_SCHEMA) {
        flash(peMsg("msgImportNewer", [String(raw.schema), String(PE_SCHEMA)]), true);
        return;
      }
      try {
        state = peDeepMerge(PE_DEFAULTS, peSanitizeSettings(peMigrate(raw)));
        render();
        flash(peMsg("msgImported"));
      } catch (e) {
        flash(peMsg("msgImportInvalid"), true);
      }
    };
    reader.onerror = () => flash(peMsg("msgImportUnreadable"), true);
    reader.readAsText(file);
  }

  function addRule(base) {
    state.rules.push({
      id: uid("rule"),
      enabled: true,
      label: (base.labelKey && peMsg(base.labelKey)) || base.label || "",
      selector: base.selector || "",
      property: base.property || "max-width",
      value: base.value || ""
    });
    renderRules();
    focusLast(base.selector ? ".rule-value" : ".rule-selector");
  }

  function focusLast(sel) {
    const listKey = sel.startsWith(".rule")
      ? "ruleList"
      : sel.startsWith(".src")
        ? "sourceList"
        : sel.startsWith(".var")
          ? "variableList"
          : "templateList";
    const nodes = el[listKey].querySelectorAll(sel);
    if (nodes.length) nodes[nodes.length - 1].focus();
  }

  // Ensure host access matches the active-domain list. Requesting already-granted
  // origins is a silent no-op, so the user is only prompted for newly added domains.
  // Called first (before any other await) so the Save click still counts as a gesture.
  // Host access needed = active-domain patterns (content script) + template-source
  // origins (background fetch). Requesting already-granted origins is a silent no-op,
  // so the user is only prompted for newly added domains/sources.
  function desiredOrigins() {
    const out = peOriginPatterns(state);
    const sync = state.templateSync || {};
    if (sync.enabled) {
      for (const src of sync.sources || []) {
        if (!src || src.enabled === false || !src.url) continue;
        const p = peOriginPatternForUrl(src.url);
        if (p) out.push(p);
      }
    }
    return [...new Set(out)];
  }

  async function syncHostPermissions() {
    const desired = desiredOrigins();
    if (desired.length) {
      let ok = false;
      try {
        ok = await chrome.permissions.request({ origins: desired });
      } catch (_) {}
      if (!ok) return false;
    }
    // Drop grants for origins no longer listed (domains or sources); no gesture needed.
    // Source origins may be specific hosts (https://host/*), so match those too.
    try {
      const perms = await chrome.permissions.getAll();
      const stale = (perms.origins || []).filter((o) => /^(\*|https?):\/\//.test(o) && !desired.includes(o));
      if (stale.length) await chrome.permissions.remove({ origins: stale });
    } catch (_) {}
    return true;
  }

  async function saveAll() {
    // Refuse BEFORE touching state. A URL we cannot turn into a host permission is one
    // the worker will never fetch, so the save cannot go ahead — but bailing out after
    // the filters below have already rebuilt state.rules/templates/variables leaves every
    // rendered row bound to an index that has shifted underneath it. That cost a user
    // their work: an empty template row is dropped from state, the DOM still shows it,
    // typing into it writes to state.templates[undefined], and the next save reports
    // "Saved" with the template silently gone. Nothing here may mutate state until we
    // know we are going through with it.
    const badSrc = (ensureSync().sources || []).find(
      (s) => s && s.url && s.url.trim() && !peOriginPatternForUrl(s.url.trim())
    );
    if (badSrc) {
      flash(peMsg("msgInvalidSrcUrl"), true);
      return; // state untouched, so every row's bindings still line up
    }

    // drop empty rules/templates
    state.rules = (state.rules || []).filter((r) => (r.selector && r.selector.trim()) || (r.label && r.label.trim()));
    state.templates = (state.templates || []).filter(
      (t) => (t.name && t.name.trim()) || (t.title && t.title.trim()) || (t.content && t.content.trim())
    );
    // A variable with no usable name can never be referenced; a duplicate would make the
    // winner depend on array order. Drop both rather than save something inert.
    const seenVar = new Set();
    state.variables = (state.variables || [])
      .map((v) => ({ name: (v.name || "").trim(), value: v.value || "" }))
      .filter((v) => {
        if (!PE_VAR_NAME_RE.test(v.name)) return false;
        const k = v.name.toLowerCase();
        if (seenVar.has(k)) return false;
        seenVar.add(k);
        return true;
      })
      .slice(0, PE_MAX_VARIABLES);

    // drop empty sources; enforce the source cap
    const sync = ensureSync();
    sync.sources = (sync.sources || [])
      .filter((s) => s && s.url && s.url.trim())
      // Backstop only: the Add button stops at the cap, so this can bite only for
      // settings that arrived from elsewhere (an import, or an older build).
      .slice(0, PE_SYNC_LIMITS.maxSources)
      .map((s) => ({
        id: s.id || uid("src"),
        url: s.url.trim(),
        name: peClampStr(s.name || "", PE_SYNC_LIMITS.maxFieldLen).trim(),
        intervalMinutes: parseInt(s.intervalMinutes, 10) || 360,
        enabled: s.enabled !== false,
        hiddenGroups: Array.isArray(s.hiddenGroups)
          ? [...new Set(s.hiddenGroups.map((x) => peClampStr(String(x), PE_SYNC_LIMITS.maxFieldLen)))]
          : []
      }));
    const permOk = await syncHostPermissions();
    try {
      savingSelf = true;
      await peSaveSettings(state);
      render();
      flash(permOk ? peMsg("msgSaved") : peMsg("msgSavedNoPerm"), !permOk);
      // Fetch sources now (don't wait for the scheduled alarm), then refresh statuses.
      if (permOk && ensureSync().enabled && ensureSync().sources.length) {
        try {
          chrome.runtime.sendMessage({ type: "pe-sync-now" }, () => {
            if (chrome.runtime.lastError) return;
            reloadSyncCache();
          });
        } catch (_) {}
      }
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      // One template too big for an item of its own is the one quota failure with a
      // specific cause and a specific fix, so it gets its own message and names the
      // template — "settings are too large" would send the user hunting through all of
      // them for the one that is actually the problem.
      if (e && e.code === PE_ERR_TEMPLATE_TOO_LARGE) {
        flash(
          peMsg("msgSaveTplTooLarge", [e.templateName || peMsg("menuUntitled"), String(Math.round(PE_SYNC_ITEM_BYTES / 1024))]),
          true
        );
      } else if (/QUOTA_BYTES_PER_ITEM/i.test(msg)) {
        // The templates are already split across items, so this can only be the core
        // one: domains and style rules. Saying "settings are too large" would point at
        // the templates, which are not the problem and cannot help.
        flash(peMsg("msgSaveQuotaItem", [String(Math.round(PE_SYNC_ITEM_BYTES / 1024))]), true);
      } else if (/quota/i.test(msg)) {
        flash(peMsg("msgSaveQuota", [String(Math.round(PE_SYNC_QUOTA_BYTES / 1024))]), true);
      } else {
        flash(peMsg("msgSaveFailed", [msg]), true);
      }
    } finally {
      // Released a turn later than the save, so every event the save produced has landed
      // while the flag was still set.
      setTimeout(() => (savingSelf = false), 0);
    }
  }

  function reloadSyncCache() {
    return peGetSyncCache().then((c) => {
      syncCache = c;
      renderSources();
    });
  }

  // Ask the service worker to fetch all sources now, then refresh the status lines.
  function syncNow() {
    if (dirty) {
      flash(peMsg("msgSaveFirst"), true);
      return;
    }
    flash(peMsg("msgSyncing"));
    try {
      chrome.runtime.sendMessage({ type: "pe-sync-now" }, (resp) => {
        if (chrome.runtime.lastError) {
          flash(peMsg("msgSyncFailed", [chrome.runtime.lastError.message]), true);
          return;
        }
        reloadSyncCache().then(() => {
          if (resp && typeof resp.ok === "number") {
            flash(
              resp.err
                ? peMsg("msgSyncDoneErrors", [String(resp.ok), String(resp.err)])
                : peMsg("msgSyncDone", [String(resp.ok)]),
              !!resp.err
            );
          } else {
            flash(peMsg("msgSyncFinished"));
          }
        });
      });
    } catch (e) {
      flash(peMsg("msgSyncFailed", [String((e && e.message) || e)]), true);
    }
  }

  function resetAll() {
    if (!confirm(peMsg("msgResetConfirm"))) return;
    state = peDeepMerge(PE_DEFAULTS, {});
    render();
    flash(peMsg("msgResetDone"));
  }

  let flashTimer = null;
  function flash(msg, isError) {
    el.status.textContent = msg;
    el.status.style.color = isError ? "#dc2626" : "";
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (el.status.textContent = ""), 3000);
  }

  // header "about" line: show the version straight from the manifest (never goes stale)
  try {
    const av = $("appVersion");
    if (av) av.textContent = "v" + chrome.runtime.getManifest().version + " · ";
  } catch (_) {}

  // Storage meter. Settings occupy several chrome.storage.sync items now (the core one
  // plus a template shard per ~8 KB), so the ceiling that matters is the 100 KB total,
  // and the figure has to come from the same packing the save uses — measuring
  // JSON.stringify(state) instead would ignore the shard keys and quietly under-report.
  function updateStorageMeter() {
    const bar = $("storageBarFill");
    const txt = $("storageText");
    if (!bar || !txt || !state) return;
    let usage = { total: 0, overTotal: false, overItem: false };
    try {
      usage = peSettingsUsage(state);
    } catch (_) {}
    const bytes = usage.total;
    // Either ceiling refuses the save, so either one has to light the bar up. The bar
    // itself tracks the total, which is the number the user can act on.
    const over = usage.overTotal || usage.overItem;
    const near = !over && bytes > PE_SYNC_QUOTA_BYTES * 0.8;
    bar.style.width = Math.min(100, Math.round((bytes / PE_SYNC_QUOTA_BYTES) * 100)) + "%";
    bar.className = over ? "over" : near ? "near" : "";
    txt.textContent =
      peMsg("msgStorageUsed", [(bytes / 1024).toFixed(1), String(Math.round(PE_SYNC_QUOTA_BYTES / 1024))]) +
      (over ? peMsg("msgStorageOver") : near ? peMsg("msgStorageNear") : "");
    txt.className = "storage-text" + (over ? " over" : near ? " near" : "");
  }
  let meterTimer = null;
  function scheduleMeter() {
    clearTimeout(meterTimer);
    meterTimer = setTimeout(updateStorageMeter, 120);
  }

  peApplyI18n(document);
  Promise.all([peGetSettings(), peGetSyncCache()]).then(([s, c]) => {
    state = s;
    syncCache = c;
    render();
    bind();
  });
})();
