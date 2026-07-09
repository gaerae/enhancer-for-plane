// options.js — settings page logic
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  let state = null;
  let dirty = false; // whether the user has edited the form
  let savingSelf = false; // ignore the storage change our own save triggers

  const el = {
    enabled: $("enabled"),
    allDomains: $("allDomains"),
    domains: $("domains"),
    ruleList: $("ruleList"),
    ruleEmpty: $("ruleEmpty"),
    addRule: $("addRule"),
    ruleRow: $("ruleRow"),
    templateList: $("templateList"),
    templateEmpty: $("templateEmpty"),
    addTemplate: $("addTemplate"),
    tplRow: $("tplRow"),
    save: $("save"),
    reset: $("reset"),
    status: $("status"),
    exportBtn: $("exportBtn"),
    importBtn: $("importBtn"),
    importFile: $("importFile")
  };

  const PRESETS = {
    modulename: {
      label: "Module / item name width",
      selector: ".max-w-40",
      property: "max-width",
      value: "320px"
    },
    dropdown: {
      label: "Module search dropdown width",
      selector: '[id^="headlessui-combobox-options"] > div',
      property: "width",
      value: "320px"
    },
    // Cycle names and the breadcrumb path (project / cycle / module / label names)
    // share this Tailwind cap; widening it stops those from truncating too.
    cyclename: {
      label: "Cycle / breadcrumb name width",
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
    updateStorageMeter();
    dirty = false; // just re-rendered the form from state, so it's clean
  }

  function renderRules() {
    el.ruleList.innerHTML = "";
    const list = state.rules || [];
    el.ruleEmpty.hidden = list.length > 0;
    list.forEach((rule, idx) => {
      const node = el.ruleRow.content.firstElementChild.cloneNode(true);
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
    input.title = ok ? "" : "Invalid CSS selector";
  }

  function renderTemplates() {
    el.templateList.innerHTML = "";
    const list = state.templates || [];
    el.templateEmpty.hidden = list.length > 0;
    list.forEach((tpl, idx) => {
      const node = el.tplRow.content.firstElementChild.cloneNode(true);
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
        if (area !== "sync" || !changes[PE_STORAGE_KEY]) return;
        if (savingSelf) {
          savingSelf = false; // ignore our own save
          return;
        }
        if (dirty) {
          flash(
            "Settings changed elsewhere (e.g. the picker). Reload this page to apply them — unsaved edits will be lost.",
            true
          );
          return;
        }
        peGetSettings().then((s) => {
          state = s;
          render();
          flash("Loaded the rule added by the picker.");
        });
      });
    } catch (_) {}

    el.exportBtn.addEventListener("click", exportSettings);
    el.importBtn.addEventListener("click", () => el.importFile.click());
    el.importFile.addEventListener("change", () => {
      const f = el.importFile.files && el.importFile.files[0];
      if (f) importSettings(f);
      el.importFile.value = "";
    });
  }

  function exportSettings() {
    const payload = {
      _app: "enhancer-for-plane",
      schema: typeof PE_SCHEMA !== "undefined" ? PE_SCHEMA : 2,
      settings: state
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "enhancer-for-plane-settings.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    flash("Exported settings JSON.");
  }

  function importSettings(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const raw = parsed && parsed.settings ? parsed.settings : parsed;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid");
        const merged = peDeepMerge(PE_DEFAULTS, peMigrate(raw));
        (merged.templates || []).forEach((t) => {
          if (typeof t.title !== "string") t.title = "";
        });
        state = merged;
        render();
        flash("Imported — review, then click Save to apply.");
      } catch (e) {
        flash("Import failed: not a valid settings JSON.", true);
      }
    };
    reader.onerror = () => flash("Import failed: could not read file.", true);
    reader.readAsText(file);
  }

  function addRule(base) {
    state.rules.push({
      id: uid("rule"),
      enabled: true,
      label: base.label || "",
      selector: base.selector || "",
      property: base.property || "max-width",
      value: base.value || ""
    });
    renderRules();
    focusLast(base.selector ? ".rule-value" : ".rule-selector");
  }

  function focusLast(sel) {
    const nodes = el[sel.startsWith(".rule") ? "ruleList" : "templateList"].querySelectorAll(sel);
    if (nodes.length) nodes[nodes.length - 1].focus();
  }

  async function saveAll() {
    // drop empty rules/templates
    state.rules = (state.rules || []).filter((r) => (r.selector && r.selector.trim()) || (r.label && r.label.trim()));
    state.templates = (state.templates || []).filter(
      (t) => (t.name && t.name.trim()) || (t.title && t.title.trim()) || (t.content && t.content.trim())
    );
    try {
      savingSelf = true;
      await peSaveSettings(state);
      render();
      flash("Saved.");
    } catch (e) {
      savingSelf = false;
      const msg = e && e.message ? e.message : String(e);
      if (/quota/i.test(msg)) {
        flash(
          "Save failed: settings exceed Chrome sync's ~8 KB limit. Shorten or remove templates (or keep a JSON backup).",
          true
        );
      } else {
        flash("Save failed: " + msg, true);
      }
    }
  }

  function resetAll() {
    if (!confirm("Reset all settings to defaults. Continue?")) return;
    state = peDeepMerge(PE_DEFAULTS, {});
    render();
    flash("Restored defaults. Click “Save” to apply.");
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

  // storage meter: the whole settings object lives in one chrome.storage.sync item,
  // capped at ~8 KB (QUOTA_BYTES_PER_ITEM). Show how full it is so a save never fails silently.
  const PE_SYNC_ITEM_LIMIT = 8192;
  function updateStorageMeter() {
    const bar = $("storageBarFill");
    const txt = $("storageText");
    if (!bar || !txt || !state) return;
    let bytes = 0;
    try {
      bytes = new Blob([PE_STORAGE_KEY + JSON.stringify(state)]).size;
    } catch (_) {}
    const over = bytes > PE_SYNC_ITEM_LIMIT;
    const near = !over && bytes > PE_SYNC_ITEM_LIMIT * 0.8;
    bar.style.width = Math.min(100, Math.round((bytes / PE_SYNC_ITEM_LIMIT) * 100)) + "%";
    bar.className = over ? "over" : near ? "near" : "";
    txt.textContent =
      (bytes / 1024).toFixed(1) +
      " / 8 KB used" +
      (over ? " — over the sync limit; saving may fail" : near ? " — approaching the limit" : "");
    txt.className = "storage-text" + (over ? " over" : near ? " near" : "");
  }
  let meterTimer = null;
  function scheduleMeter() {
    clearTimeout(meterTimer);
    meterTimer = setTimeout(updateStorageMeter, 120);
  }

  peGetSettings().then((s) => {
    state = s;
    render();
    bind();
  });
})();
