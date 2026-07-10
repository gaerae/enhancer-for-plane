// common.js — settings defaults and storage/read helpers (shared by the content
// script and the extension pages).
//
// Design principle: Plane's UI class names can change between versions (a single
// page may even mix max-w-40 / max-w-48 / max-w-[150px]), so instead of
// hardcoding specific classes we expose a generic engine where the user freely
// adds/edits/removes "selector + property + value" rules.

const PE_STORAGE_KEY = "peSettings";
const PE_SCHEMA = 2;

const PE_DEFAULTS = {
  schema: PE_SCHEMA,
  enabled: true,
  allDomains: false, // when true, ignore the domain list and run on every site
  // Built for self-hosted Plane, so the target host differs per user. Ships empty —
  // the user adds their own instance via the popup's "Enable on this site" or the
  // active domains list in Settings. (The Settings textarea shows a format hint.)
  domains: [],

  // Style rules: each rule is injected as `selector { property: value !important; }`.
  rules: [
    {
      id: "rule-module-name",
      enabled: true,
      label: "Module / item name width",
      selector: ".max-w-40",
      property: "max-width",
      value: "320px" // Plane default 160px (max-w-40) → widened to 320px
    },
    {
      id: "rule-combobox-dropdown",
      enabled: true,
      label: "Module search dropdown width",
      selector: '[id^="headlessui-combobox-options"] > div',
      property: "width",
      value: "320px" // Plane default 192px (w-48) → widened to 320px
    }
  ],

  // Body (description) templates — title + body. Applied from the button next to
  // "Attach" in the description toolbar; fills the title (textarea) and the body
  // (ProseMirror) together.
  templates: [
    {
      id: "tpl-sample-bug",
      name: "🐞 Bug report",
      title: "[Bug] ",
      content:
        "## Summary\n\n## Steps to reproduce\n1. \n2. \n\n## Expected result\n\n## Actual result\n\n## Environment\n- "
    },
    {
      id: "tpl-sample-task",
      name: "✅ Task",
      title: "",
      content:
        "## Background\n\n## Goal\n\n## Definition of Done\n- [ ] \n- [ ] \n\n## References\n- "
    }
  ]
};

function peDeepMerge(def, cur) {
  if (Array.isArray(def)) return Array.isArray(cur) ? cur : def.slice();
  if (def && typeof def === "object") {
    const out = {};
    for (const k of Object.keys(def)) out[k] = peDeepMerge(def[k], cur ? cur[k] : undefined);
    if (cur && typeof cur === "object") {
      for (const k of Object.keys(cur)) if (!(k in out)) out[k] = cur[k];
    }
    return out;
  }
  return cur === undefined ? def : cur;
}

// v1 → v2 migration: convert the old widths.{moduleName,dropdown} shape into rules
function peMigrate(raw) {
  if (!raw || typeof raw !== "object") return {};
  if (raw.rules || raw.schema >= PE_SCHEMA) return raw;
  if (raw.widths) {
    const rules = [];
    const w = raw.widths;
    if (w.moduleName)
      rules.push({
        id: "rule-module-name",
        enabled: w.moduleName.enabled !== false,
        label: "Module / item name width",
        selector: ".max-w-40",
        property: "max-width",
        value: (w.moduleName.px || 320) + "px"
      });
    if (w.dropdown)
      rules.push({
        id: "rule-combobox-dropdown",
        enabled: w.dropdown.enabled !== false,
        label: "Module search dropdown width",
        selector: '[id^="headlessui-combobox-options"] > div',
        property: "width",
        value: (w.dropdown.px || 320) + "px"
      });
    raw.rules = rules;
    delete raw.widths;
  }
  raw.schema = PE_SCHEMA;
  return raw;
}

function peGetSettings() {
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.get(PE_STORAGE_KEY, (res) => {
        const raw = peMigrate((res && res[PE_STORAGE_KEY]) || {});
        const merged = peDeepMerge(PE_DEFAULTS, raw);
        // Backfill the template title field (compat with older templates)
        (merged.templates || []).forEach((t) => {
          if (typeof t.title !== "string") t.title = "";
        });
        resolve(merged);
      });
    } catch (e) {
      resolve(peDeepMerge(PE_DEFAULTS, {}));
    }
  });
}

function peSaveSettings(settings) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.sync.set({ [PE_STORAGE_KEY]: settings }, () => {
        const err = chrome.runtime && chrome.runtime.lastError;
        if (err) reject(err);
        else resolve();
      });
    } catch (e) {
      reject(e);
    }
  });
}

function peDomainMatches(domains, host) {
  host = (host || "").toLowerCase();
  return (domains || []).some((raw) => {
    const d = (raw || "").trim().toLowerCase();
    if (!d) return false;
    if (d.startsWith("*.")) {
      const base = d.slice(2);
      return host === base || host.endsWith("." + base);
    }
    return host === d || host.endsWith("." + d);
  });
}

function peIsActiveOn(settings, host) {
  if (!settings || !settings.enabled) return false;
  if (settings.allDomains) return true;
  return peDomainMatches(settings.domains, host);
}

// Convert the active-domain settings into origin match patterns (e.g. "*://host/*").
// Used both for optional host-permission requests and for dynamic content-script
// registration, so the extension holds host access only for domains the user granted.
function peOriginPatterns(settings) {
  if (!settings) return [];
  if (settings.allDomains) return ["*://*/*"];
  const out = [];
  for (const raw of settings.domains || []) {
    const d = (raw || "").trim().toLowerCase();
    // Allow host chars and a leading "*." wildcard only; skip anything malformed.
    if (!d || /[^a-z0-9.*-]/.test(d)) continue;
    out.push("*://" + d + "/*");
  }
  return [...new Set(out)];
}
