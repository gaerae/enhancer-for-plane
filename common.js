// common.js — settings defaults and storage/read helpers (shared by the content
// script and the extension pages).
//
// Design principle: Plane's UI class names can change between versions (a single
// page may even mix max-w-40 / max-w-48 / max-w-[150px]), so instead of
// hardcoding specific classes we expose a generic engine where the user freely
// adds/edits/removes "selector + property + value" rules.

const PE_STORAGE_KEY = "peSettings";
const PE_SCHEMA = 3;

// Stamped on exported backups and required on import, so a file that is not ours is
// refused by name instead of being merged into the user's settings.
const PE_APP_ID = "enhancer-for-plane";

// Field separator for the id hashes. Named, not inlined: an inline "\u0000" escape has
// twice been written into this file as a raw NUL byte, which parses and runs but turns
// the source binary to grep. check-source.js rule 1 now catches that; this keeps the
// escape in exactly one place.
const PE_FIELD_SEP = String.fromCharCode(0);

// The synced-template cache lives in chrome.storage.local (5 MB) — separate from the
// synced settings item (~8 KB) so remote data never competes with personal settings
// for the sync quota. Shape: { bySource: { <sourceId>: { version, fetchedAt, status,
// lastError, count, dropped, templates: [ … ] } } }.
const PE_SYNC_CACHE_KEY = "peSyncCache";

// Custom template variables are written {{var.name}}. The prefix is what makes them
// safe: a user cannot shadow {{date}} or {{week}} by naming a variable "date", so there
// is no collision rule to enforce and no silently-ignored variable. Names are limited to
// these characters so the token stays a plain, regex-safe word.
const PE_VAR_PREFIX = "var.";
const PE_VAR_NAME_RE = /^[a-zA-Z0-9_-]+$/;
const PE_MAX_VARIABLES = 5;

// Hard caps applied to remote data BEFORE it is stored or shown. storage.local is
// large, but remote content is authored outside our trust boundary, so we bound it
// to protect quota, memory, and picker render time (and to blunt a bad endpoint).
const PE_SYNC_LIMITS = {
  maxSources: 10,
  maxTemplatesPerSource: 200,
  maxContentLen: 20000, // per-template body
  maxFieldLen: 300, // name / title / group
  maxResponseBytes: 1048576 // 1 MB per fetch
};

// Count caps for an imported settings file. The real ceiling is the ~8 KB sync quota, so
// these are far above anything that can actually be saved — they are here to bound the
// work done on a file that is hostile or simply corrupt, not to tell a user how many
// templates they may keep. Without them, sanitizing was asymmetric: the two newest
// fields (variables, sources) were count-capped and the three older ones were not.
const PE_IMPORT_LIMITS = {
  maxTemplates: 500,
  maxRules: 500,
  maxDomains: 200,
  maxHiddenGroups: 100
};

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
      label: peMsg("optPresetModuleName") || "Module / item name width",
      selector: ".max-w-40",
      property: "max-width",
      value: "320px" // Plane default 160px (max-w-40) → widened to 320px
    },
    {
      id: "rule-combobox-dropdown",
      enabled: true,
      label: peMsg("optPresetDropdown") || "Module search dropdown width",
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
  ],

  // Values the user can drop into any template as {{var.name}} — their own templates and
  // synced ones alike. A synced template can therefore say {{var.team}} and resolve
  // differently for each person who inserts it, with no per-user data ever leaving the
  // browser. Each: { name, value }.
  variables: [],

  // Template sync — pull shared templates from one or more URLs. Config only
  // (the fetched templates + per-device status live in PE_SYNC_CACHE_KEY, not here,
  // so status never syncs across devices or bloats the ~8 KB settings item).
  // Each source: { id, url, name, intervalMinutes, enabled, hiddenGroups }. `name` is
  // what the picker shows as the block header — two sources can share a host, so the
  // host alone cannot identify one. `hiddenGroups` lists group labels to keep out of
  // the picker ("" = the source's ungrouped items); they are still fetched.
  templateSync: {
    enabled: false,
    sources: []
  }
};

/* ================================================================== */
/* i18n                                                                */
/* ================================================================== */

// Message lookup with a safe fallback. Returns "" when the key is missing or
// chrome.i18n is unavailable, so callers can keep whatever is already in the DOM
// rather than blanking the UI.
function peMsg(key, subs) {
  try {
    return chrome.i18n.getMessage(key, subs) || "";
  } catch (_) {
    return "";
  }
}

// Attributes that can be localized via data-i18n-<attr>="key".
const PE_I18N_ATTRS = ["placeholder", "title", "aria-label", "alt"];

// Translate a document in place:
//   data-i18n="key"        → textContent
//   data-i18n-html="key"   → innerHTML — only for copy that needs <b>/<code>. Messages
//                            ship inside the extension package, the same trust level as
//                            the page markup itself; remote text never reaches this.
//   data-i18n-<attr>="key" → sets that attribute (placeholder, title, aria-label, alt)
function peApplyI18n(root) {
  const scope = root || document;
  scope.querySelectorAll("[data-i18n]").forEach((el) => {
    const m = peMsg(el.getAttribute("data-i18n"));
    if (m) el.textContent = m;
  });
  scope.querySelectorAll("[data-i18n-html]").forEach((el) => {
    const m = peMsg(el.getAttribute("data-i18n-html"));
    if (m) el.innerHTML = m;
  });
  for (const attr of PE_I18N_ATTRS) {
    scope.querySelectorAll("[data-i18n-" + attr + "]").forEach((el) => {
      const m = peMsg(el.getAttribute("data-i18n-" + attr));
      if (m) el.setAttribute(attr, m);
    });
  }
  // Reflect the UI language on the page itself (affects font stacks, hyphenation).
  try {
    const lang = chrome.i18n.getUILanguage();
    if (lang && scope.documentElement) scope.documentElement.lang = lang;
  } catch (_) {}
}

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

// Bring a stored settings object up to PE_SCHEMA.
//   v1 → v2: the old widths.{moduleName,dropdown} shape becomes rules
//   v2 → v3: templateSync is additive, so peDeepMerge backfills it — only the stamp moves
// The version is decided by `schema`, falling back to the shape for pre-schema data.
// (An earlier gate returned early whenever `rules` existed, which silently blocked
// every future migration and left the stored `schema` stamp stuck at its old value.)
function peMigrate(raw) {
  if (!raw || typeof raw !== "object") return {};
  const from = raw.schema || (raw.rules ? 2 : 1);
  if (from >= PE_SCHEMA) return raw;
  if (from < 2 && raw.widths) {
    const rules = [];
    const w = raw.widths;
    if (w.moduleName)
      rules.push({
        id: "rule-module-name",
        enabled: w.moduleName.enabled !== false,
        label: peMsg("optPresetModuleName") || "Module / item name width",
        selector: ".max-w-40",
        property: "max-width",
        value: (w.moduleName.px || 320) + "px"
      });
    if (w.dropdown)
      rules.push({
        id: "rule-combobox-dropdown",
        enabled: w.dropdown.enabled !== false,
        label: peMsg("optPresetDropdown") || "Module search dropdown width",
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

// Clamp an imported settings object into the shape we actually support.
//
// A backup file is authored outside this extension — a colleague's export, a
// hand-edited config — which is the same trust level as a synced source, not the same
// as our own storage. Synced templates have always been clamped; imports used to go
// straight into the form, so a wrong type or a 5 MB body landed unchallenged. This
// closes that asymmetry: unknown keys are dropped, every string is capped, and every
// entry that carries nothing usable disappears.
function peSanitizeSettings(raw) {
  const L = PE_SYNC_LIMITS;
  const SEP = PE_FIELD_SEP;
  const str = (v, max) => peClampStr(typeof v === "string" ? v : "", max);
  const bool = (v, dflt) => (typeof v === "boolean" ? v : dflt);
  const arr = (v) => (Array.isArray(v) ? v : []);
  const out = {};

  if (typeof raw.schema === "number") out.schema = raw.schema;
  out.enabled = bool(raw.enabled, true);
  out.allDomains = bool(raw.allDomains, false);
  out.domains = arr(raw.domains)
    .map((d) => str(d, L.maxFieldLen).trim())
    .filter(Boolean)
    .slice(0, PE_IMPORT_LIMITS.maxDomains);

  out.rules = arr(raw.rules)
    .filter((r) => r && typeof r === "object")
    .map((r) => ({
      id: str(r.id, L.maxFieldLen) || "rule-" + peHash(str(r.selector, L.maxFieldLen)),
      enabled: bool(r.enabled, true),
      label: str(r.label, L.maxFieldLen),
      selector: str(r.selector, L.maxFieldLen),
      property: str(r.property, L.maxFieldLen),
      value: str(r.value, L.maxFieldLen)
    }))
    .filter((r) => r.selector.trim() || r.label.trim())
    .slice(0, PE_IMPORT_LIMITS.maxRules);

  out.templates = arr(raw.templates)
    .filter((t) => t && typeof t === "object")
    .map((t) => ({
      id: str(t.id, L.maxFieldLen) || "tpl-" + peHash([t.name, t.title, t.content].map((x) => str(x, L.maxContentLen)).join(SEP)),
      name: str(t.name, L.maxFieldLen),
      title: str(t.title, L.maxFieldLen),
      content: str(t.content, L.maxContentLen)
    }))
    .filter((t) => t.name.trim() || t.title.trim() || t.content.trim())
    .slice(0, PE_IMPORT_LIMITS.maxTemplates);

  const seenVar = new Set();
  out.variables = arr(raw.variables)
    .filter((v) => v && typeof v === "object")
    .map((v) => ({ name: str(v.name, L.maxFieldLen).trim(), value: str(v.value, L.maxFieldLen) }))
    .filter((v) => {
      // A name that cannot appear in a token is dead weight; a duplicate would make
      // which value wins depend on array order.
      if (!PE_VAR_NAME_RE.test(v.name)) return false;
      const key = v.name.toLowerCase();
      if (seenVar.has(key)) return false;
      seenVar.add(key);
      return true;
    })
    .slice(0, PE_MAX_VARIABLES);

  const sync = raw.templateSync && typeof raw.templateSync === "object" ? raw.templateSync : {};
  out.templateSync = {
    enabled: bool(sync.enabled, false),
    sources: arr(sync.sources)
      .filter((s) => s && typeof s === "object")
      .map((s) => ({
        id: str(s.id, L.maxFieldLen) || "src-" + peHash(str(s.url, L.maxFieldLen)),
        url: str(s.url, L.maxFieldLen).trim(),
        name: str(s.name, L.maxFieldLen).trim(),
        intervalMinutes: parseInt(s.intervalMinutes, 10) || 360,
        enabled: bool(s.enabled, true),
        hiddenGroups: [...new Set(arr(s.hiddenGroups).map((g) => str(g, L.maxFieldLen)))].slice(
        0,
        PE_IMPORT_LIMITS.maxHiddenGroups
      )
      }))
      // A source whose URL is not a plain http(s) address can never be fetched.
      .filter((s) => peOriginPatternForUrl(s.url))
      .slice(0, L.maxSources)
  };
  return out;
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

/* ================================================================== */
/* Template sync — cache, normalization, and section building         */
/* ================================================================== */

// djb2 — small, stable string hash. Used to derive a fallback template id when a
// remote entry omits one (so "last-good" merges and dedupe stay stable).
function peHash(s) {
  let h = 5381;
  const str = String(s == null ? "" : s);
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function peClampStr(v, max) {
  if (typeof v !== "string") return "";
  return v.length > max ? v.slice(0, max) : v;
}

// Build a host-permission match pattern for a source URL (e.g. "https://host/*").
// Returns null for anything that isn't a plain http(s) URL.
function peOriginPatternForUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch (_) {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  return u.protocol + "//" + u.host + "/*";
}

// Short label for a source (its host) shown in the picker/settings.
function peSourceLabel(url) {
  try {
    return new URL(url).host;
  } catch (_) {
    return String(url || "");
  }
}

// Validate + cap + namespace a remote payload into our single flat template shape.
// Accepts { templates: [...] } (preferred) or a bare array. Every id is namespaced
// as "sync:<sourceId>:<id>" so remote ids can never collide with personal ones or
// across sources. A top-level "name" is the collection's own label (used as the
// picker header when the user hasn't named the source). Returns { templates, dropped, name }.
function peNormalizeRemoteTemplates(json, sourceId) {
  const L = PE_SYNC_LIMITS;
  let arr = [];
  if (json && Array.isArray(json.templates)) arr = json.templates;
  else if (Array.isArray(json)) arr = json;
  const name = peClampStr(json && json.name, L.maxFieldLen).trim();
  const out = [];
  let dropped = 0;
  for (const t of arr) {
    if (out.length >= L.maxTemplatesPerSource) {
      dropped++;
      continue;
    }
    if (!t || typeof t !== "object") {
      dropped++;
      continue;
    }
    const name = peClampStr(t.name, L.maxFieldLen).trim();
    const title = peClampStr(t.title, L.maxFieldLen);
    const content = peClampStr(t.content, L.maxContentLen);
    const group = peClampStr(t.group, L.maxFieldLen).trim();
    if (!name && !title && !content) {
      dropped++;
      continue;
    }
    const rawId = peClampStr(t.id, L.maxFieldLen).trim();
    const stableId = rawId || "h" + peHash([group, name, title, content].join(PE_FIELD_SEP));
    out.push({
      id: "sync:" + sourceId + ":" + stableId,
      group,
      name: name || "(untitled)",
      title,
      content
    });
  }
  return { templates: out, dropped, name };
}

// What the picker/settings call a source: the user's own name wins, then the name the
// file declares, then the host. (Two sources can share a host, so a name matters.)
function peSourceDisplayName(src, entry) {
  const own = src && typeof src.name === "string" ? src.name.trim() : "";
  if (own) return own;
  const remote = entry && typeof entry.remoteName === "string" ? entry.remoteName.trim() : "";
  if (remote) return remote;
  return peSourceLabel(src && src.url);
}

// Read/write the synced-template cache (chrome.storage.local).
function peGetSyncCache() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(PE_SYNC_CACHE_KEY, (res) => {
        const c = (res && res[PE_SYNC_CACHE_KEY]) || {};
        resolve({ bySource: (c && c.bySource) || {} });
      });
    } catch (_) {
      resolve({ bySource: {} });
    }
  });
}

function peSaveSyncCache(cache) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set({ [PE_SYNC_CACHE_KEY]: cache }, () => {
        const err = chrome.runtime && chrome.runtime.lastError;
        if (err) reject(err);
        else resolve();
      });
    } catch (e) {
      reject(e);
    }
  });
}

// A template is "meaningful" if it has at least one filled field.
function peTemplateHasContent(t) {
  return !!(t && ((t.name && t.name.trim()) || (t.title && t.title.trim()) || (t.content && t.content.trim())));
}

// Bucket one source's cached templates into display groups. Shared by the picker and
// the settings page so both always agree on grouping and order: ungrouped first (those
// belong to the source itself, and trailing them after a named group would make them
// look like part of it), then named groups in first-seen order.
function peGroupSourceTemplates(entry) {
  const groups = new Map();
  for (const t of (entry && entry.templates) || []) {
    const g = t.group || "";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(t);
  }
  return [...groups]
    .sort((a, b) => (a[0] === "" ? -1 : b[0] === "" ? 1 : 0))
    .map(([label, items]) => ({ label, items }));
}

// Combine personal + synced templates into ordered picker sections.
//   personal → { kind: "personal", items } — one leading block (v1 has no personal groups)
//   synced   → { kind: "synced", source, url, groups: [{ label, items }] } — ONE block
//              per source, with its groups nested inside, so the source header is
//              shown once instead of repeating on every group. `source` is the
//              resolved display name (see peSourceDisplayName), not a generic label.
// Group order within a source follows first appearance in the remote file; an empty
// group label means "ungrouped" and renders directly under the source header.
function peBuildTemplateSections(settings, cache) {
  const sections = [];
  const personal = (settings.templates || []).filter(peTemplateHasContent);
  if (personal.length) sections.push({ kind: "personal", items: personal });

  const sync = settings.templateSync || {};
  if (sync.enabled) {
    for (const src of sync.sources || []) {
      if (!src || !src.id || src.enabled === false) continue;
      const entry = (cache && cache.bySource && cache.bySource[src.id]) || null;
      if (!entry || !Array.isArray(entry.templates) || !entry.templates.length) continue;
      // Groups the user switched off in Settings. This is a view preference, not a
      // delete — the next sync still fetches them, they just stay out of the picker.
      const hidden = new Set(src.hiddenGroups || []);
      const groups = peGroupSourceTemplates(entry).filter((g) => !hidden.has(g.label));
      if (!groups.length) continue; // everything hidden → no empty block
      sections.push({
        kind: "synced",
        source: peSourceDisplayName(src, entry),
        url: src.url,
        groups
      });
    }
  }
  return sections;
}

// Total templates across built sections (personal items + every synced group's items).
function peCountTemplates(sections) {
  let n = 0;
  for (const s of sections || []) {
    if (s.kind === "synced") for (const g of s.groups || []) n += (g.items || []).length;
    else n += (s.items || []).length;
  }
  return n;
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
