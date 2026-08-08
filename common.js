// common.js — settings defaults and storage/read helpers (shared by the content
// script and the extension pages).
//
// Design principle: Plane's UI class names can change between versions (a single
// page may even mix max-w-40 / max-w-48 / max-w-[150px]), so instead of
// hardcoding specific classes we expose a generic engine where the user freely
// adds/edits/removes "selector + property + value" rules.

const PE_STORAGE_KEY = "peSettings";
const PE_SCHEMA = 8;

// Templates live in their own chrome.storage.sync items, "peTpl.0", "peTpl.1", … — see
// peSettingsWriteSet for why, and how many.
const PE_TPL_KEY_PREFIX = "peTpl.";

// chrome.storage.sync's documented quotas. QUOTA_BYTES_PER_ITEM is the one that used to
// bind: the whole settings object was a single item, so ~8 KB was the ceiling for
// everything a user could keep — about 39 templates of the size the sample feed ships,
// while PE_IMPORT_LIMITS said 500. QUOTA_BYTES is 100 KB, so the other 92% was there all
// along; splitting templates across items is what reaches it.
const PE_SYNC_QUOTA_BYTES = 102400;
const PE_SYNC_ITEM_BYTES = 8192;

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

// Rule health — whether a rule's selector has ever actually matched anything.
//
// A rule that matches nothing is a no-op by design: that is what keeps a Plane redesign
// from breaking the extension. The cost is that a rule which has *stopped* matching looks
// exactly like one nobody switched on, and two focus presets sat dead on Plane Cloud for a
// whole release because nothing ever said so. The extension knew the whole time —
// `querySelectorAll(sel).length` is one call — nobody asked it.
//
// What is deliberately NOT recorded is a per-page verdict. Measured on Plane Cloud
// (2026-08-08): `.max-w-40` matches 35 elements on the work item list and zero on the item
// detail page, the projects list, the labels page and the states page. "No match on this
// page" is the normal case for a healthy rule, so any check that fires on it is noise, and
// noise is what gets switched off. Two facts survive that: whether the selector has EVER
// matched, and when it last did.
//
// Per rule id: { checks, hits, at } — page checks, checks where it matched, and the time of
// the last match. Per device, so chrome.storage.local (see "Store config and state
// separately"); losing it costs a few page loads of re-observation and nothing else.
const PE_RULE_HEALTH_KEY = "peRuleHealth";
// How many checks before silence becomes a claim. A rule added for a page the user has not
// opened yet has genuinely never matched, and saying so after one page load would be right
// but useless.
//
// 20 rather than a handful, and the measurement above is why: `.max-w-40` is a healthy rule
// that matches on one route in five, so somebody who spends a morning in work item detail
// pages can rack up a long run of honest misses. A threshold they can reach by working
// normally would put a warning on a rule that is fine, and a warning that cries wolf is
// one people learn to scroll past — which would cost more than the silence it replaced.
// Twenty consecutive routes with no match is still under a day for a genuinely dead rule.
const PE_RULE_HEALTH_MIN_CHECKS = 20;
// A bound on the record for a settings file that churns rule ids. Pruning to the current
// rules is what normally keeps this small; this is the backstop for whatever that misses.
const PE_RULE_HEALTH_MAX = 500;

// Custom template variables are written {{var.name}}. The prefix is what makes them
// safe: a user cannot shadow {{date}} or {{week}} by naming a variable "date", so there
// is no collision rule to enforce and no silently-ignored variable. Names are limited to
// these characters so the token stays a plain, regex-safe word.
const PE_VAR_PREFIX = "var.";
const PE_VAR_NAME_RE = /^[a-zA-Z0-9_-]+$/;
const PE_MAX_VARIABLES = 5;

// Copy formats — what the "copy reference" button puts on the clipboard, written as a
// plain string with {{item.…}} tokens. The `item.` prefix is the same idea as `var.`:
// a namespace, so "url" can later be joined by item.state or item.assignee without
// taking a top-level name, and so a token always says whose field it is. That matters
// here more than in a template body — a copy can be triggered from a list one day, and
// a bare {{url}} would be genuinely ambiguous between the page and the work item.
//
// A format is copied out exactly as written. There is no per-format special-casing and
// no post-processing: the markdown preset carries its own "[…](…)" because the user
// must be able to see, and edit, the thing that lands on their clipboard.
const PE_ITEM_PREFIX = "item.";
// Built fresh on every call. A /g regex carries lastIndex between uses, so one shared
// constant would make the expander and the missing-token scan depend on which ran last.
const peItemTokenRe = () => /\{\{\s*item\.([a-zA-Z0-9_-]+)\s*\}\}/gi;
// The fields we can actually read off a work item page. Deliberately three: key, title,
// url. A "slug" field (title lowercased into `a-b-c` for a branch name) was cut — a
// Korean or emoji title slugs to the empty string, and some projects' identifiers are
// numeric ("42-7"), so half the team would get a branch name with a dangling separator
// and no title in it. Half-support is worse than none.
const PE_ITEM_FIELDS = ["key", "title", "url"];
const PE_MAX_COPY_FORMATS = 5;
// A work item key as Plane prints it: project identifier + "-" + sequence number. The
// identifier is not always letters — a project's can be all digits, e.g. "42", so a key can
// read "42-7"; anchoring on [A-Z] would have matched nothing there.
//
// The sequence number starts at 1 and is never zero-padded ("DATA-5", not "DATA-05"), so it
// is required to be [1-9]\d* — no leading zero. That is also what keeps a calendar year-month
// out: a due-date chip reading "2026-07" (which Plane can render as a bare leaf <button> in
// the same header) has a zero-padded month and cannot be a key. It is a real constraint on
// keys, not a hack. (A residual: an unpadded month like "2026-10" on a project whose
// identifier is literally the year "2026" would still match — but a 4-digit-year identifier
// is not something Plane hands out.)
const PE_ITEM_KEY_RE = /^[A-Za-z0-9]{1,12}-[1-9]\d*$/;

// Quick open — a key typed in the omnibox (or the popup) opens straight to that item.
// A quick link is { id, name, prefix, url, enabled }: `url` is a base carrying an optional
// {{key}} token (its variants {{key.proj}} / {{key.num}} split the key on its last "-"), and
// `prefix` routes — the typed key picks the link whose prefix it starts with, so one person
// can point "ENG-" at Linear and leave everything else on Plane. It only opens a URL, so it
// needs no host permission and works even where the content-script enhancer never runs.
// Plane, Jira and Linear all expose a key-addressable link (Plane's is /{workspace}/browse/
// {KEY}, the same short link peItemUrl composes), so one model covers all three.
const PE_MAX_QUICK_LINKS = 20;
// Built fresh each call — a /g regex carries lastIndex between uses (see peItemTokenRe).
const peQuickTokenRe = () => /\{\{\s*key(?:\.(proj|num))?\s*\}\}/gi;

// Hard caps applied to remote data BEFORE it is stored or shown. storage.local is
// large, but remote content is authored outside our trust boundary, so we bound it
// to protect quota, memory, and picker render time (and to blunt a bad endpoint).
//
// The binding one is maxResponseBytes: a source's cached entry is built from a single
// response, so it cannot hold more than one response's worth however generous the other
// caps look. That makes the storage budget maxSources x maxResponseBytes — and it has to
// fit chrome.storage.local's QUOTA_BYTES, which is 10 MB (5 MB on Chrome 113 and
// earlier). At 10 x 1 MB it did not: a measured worst case of 9.69 MB against a 10 MB
// quota, and over the line on older Chrome. Exceeding it does not corrupt anything — the
// save is refused and the source is reported failed — but a limit you can reach by using
// the feature as documented is not a limit. 10 x 512 KB leaves half the quota spare.
// tools/test.js asserts this arithmetic; change a number there and it will tell you.
const PE_SYNC_LIMITS = {
  maxSources: 10,
  maxTemplatesPerSource: 200,
  maxContentLen: 20000, // per-template body
  maxFieldLen: 300, // name / title / group
  maxResponseBytes: 524288 // 512 KB per fetch
};

// What chrome.storage.local will hold, for the budget check above (10 MB; 5 MB on
// Chrome <= 113). Not a cap we enforce — a fact we have to design against.
const PE_LOCAL_QUOTA_BYTES = 10485760;

// A ready-to-try team feed: this repo's own examples/team-templates.json, served raw from
// GitHub. The "Try the example" button in Settings fills a source with it, so a first-time
// user can watch sync work without writing or hosting a feed — one Save (which grants
// raw.githubusercontent.com, a different origin than Plane, so Chrome prompts once) and the
// picker fills with the sample collection. The URL lives here so the button and the tests
// share one string; tools/test.js checks it points at the file that actually ships.
const PE_EXAMPLE_FEED_URL =
  "https://raw.githubusercontent.com/gaerae/enhancer-for-plane/refs/heads/main/examples/team-templates.json";

// Count caps for an imported settings file: a bound on the work done for a file that is
// hostile or simply corrupt, not a statement of how many templates a user may keep.
// Without them, sanitizing was asymmetric — the two newest fields (variables, sources)
// were count-capped and the three older ones were not.
//
// maxTemplates is not a capacity figure and must not be read as one. The real ceiling is
// the byte budget, and it depends on the alphabet: measured, 100 KB holds about 218
// templates of 400 English characters but only about 81 of 400 Korean ones. 500 is
// reachable only at the small end (roughly 120 characters each). Quoting it to a user
// would promise six times what a Korean team actually gets — the READMEs give the
// measured range instead, and tools/test.js holds both to it.
const PE_IMPORT_LIMITS = {
  maxTemplates: 500,
  maxRules: 500,
  maxDomains: 200,
  maxHiddenGroups: 100
};

// Focus mode: the rules that only apply while it is on. Shipped as data, like every other
// rule, so a Plane release that renames a class costs a selector edit and nothing else —
// and so a rule that stops matching is a no-op rather than a broken feature. That last
// property is exactly what made the first version of these presets rot in silence:
// measured against Plane 1.4 (self-hosted), two of the three stopped matching anything on
// Plane Cloud, and a no-op looks identical to a feature nobody turned on. Each selector is
// now a list — Plane 1.4's shape, then Cloud's — because one install can only ever be on
// one of them and a union costs nothing on the other. Measured 2026-08-08 against both:
//
//   * A work item's own page puts properties in a right-hand div, a flex sibling of the
//     description column — hiding it lets that column take the whole width with no second
//     rule. Plane 1.4 writes it `fixed right-0 … min-w-[300px] border-l`; Cloud writes it
//     `relative z-[5] h-full shrink-0 overflow-hidden bg-surface-1`. On Cloud, `.z-[5]` is
//     what keeps the selector honest: `.shrink-0.bg-surface-1` alone also matches a 24x16
//     element on the cycles route, and focus mode is global CSS, so a rule that overreaches
//     hides things on pages that have no properties panel at all.
//     Both shapes leave the peek panel alone, which is the point of matching on the panel
//     rather than the route: rules are plain CSS and know nothing about routes. (1.4's peek
//     sidebar is `!w-[400px]`, neither `fixed` nor `right-0`; on Cloud neither selector
//     matches anything inside a peek.)
//   * The left navigation carries `id="main-sidebar"` on both, so there is no class to guess.
//     It is the one preset that never broke.
//   * Reading width ships OFF. With both panels gone the description spans the entire
//     window, which is worse to read rather than better — but it is a taste, so it is one
//     checkbox away instead of on. `padding-inline` centres the column with a single
//     property (`max-width` would need a second rule for the margins), and 2.25rem is the
//     `px-9` Plane 1.4 applies there, so the value can only widen the gutter. Cloud's column
//     is `px-8` (2rem), so there the floor widens it by a quarter rem — still only widening,
//     which is the direction that cannot make the page worse.
//
// Plane does hold a collapse state for that panel (`issue_detail_sidebar_collapsed` in
// localStorage), but nothing in its UI reaches it, and on a work item's own page its own
// resize effect forces it back to false above 768px. Driving Plane's state would mean
// fighting that effect; CSS is the mechanism that stays.
// The two selectors that had to grow a second shape, named because three places need the
// same string: the presets below, the v7 → v8 migration that repoints installs already
// carrying the old one, and the tests. Plane 1.4's shape comes first in each list, so the
// order reads as the history it is.
const PE_FOCUS_PROPS_SELECTOR = ".fixed.right-0.border-l.min-w-\\[300px\\], .z-\\[5\\].shrink-0.bg-surface-1";
const PE_FOCUS_WIDTH_SELECTOR = ".overflow-y-auto.px-9.py-5, .overflow-y-auto.px-8.py-6";

// What v7 shipped for those two, kept only so the migration can tell an untouched preset
// from one the user edited. Never widen this into "any selector we ever shipped" — a value
// here is a licence to overwrite what is in somebody's storage.
const PE_V7_FOCUS_SELECTORS = {
  "rule-focus-item-properties": ".fixed.right-0.border-l.min-w-\\[300px\\]",
  "rule-focus-reading-width": ".overflow-y-auto.px-9.py-5"
};

function peFocusPresetRules() {
  return [
    {
      id: "rule-focus-item-properties",
      enabled: true,
      focus: true,
      label: peMsg("optPresetFocusProps") || "Focus: hide the work item properties panel",
      selector: PE_FOCUS_PROPS_SELECTOR,
      property: "display",
      value: "none"
    },
    {
      id: "rule-focus-main-nav",
      enabled: true,
      focus: true,
      label: peMsg("optPresetFocusNav") || "Focus: hide the left navigation",
      selector: "#main-sidebar",
      property: "display",
      value: "none"
    },
    {
      id: "rule-focus-reading-width",
      enabled: false,
      focus: true,
      label: peMsg("optPresetFocusWidth") || "Focus: centre the body at a reading width",
      selector: PE_FOCUS_WIDTH_SELECTOR,
      property: "padding-inline",
      value: "max(2.25rem, (100% - 60rem) / 2)"
    }
  ];
}

// Split the rules into the CSS that is always on and the CSS that only applies in focus
// mode. Two strings, not one: focus mode is a per-tab moment, so the caller re-joins them
// on every toggle instead of re-deciding what each rule means. `isValidSelector` is passed
// in because only a browser can answer it — that keeps this function testable in node,
// which is where a wrong grouping would otherwise go unnoticed.
function peBuildRuleCss(rules, isValidSelector) {
  const ok = typeof isValidSelector === "function" ? isValidSelector : () => true;
  const always = [];
  const focus = [];
  (Array.isArray(rules) ? rules : []).forEach((r) => {
    if (!r || typeof r !== "object" || !r.enabled) return;
    const sel = String(r.selector == null ? "" : r.selector).trim();
    const prop = String(r.property == null ? "" : r.property).trim();
    const val = String(r.value == null ? "" : r.value)
      .replace(/[;{}]/g, "")
      .trim();
    if (!sel || !val) return;
    if (!/^-?[a-zA-Z][a-zA-Z-]*$/.test(prop)) return;
    // A brace in the selector would close our own rule and open whatever follows it. The
    // caller's check catches this too, but it is the caller's — and this function decides
    // what reaches a stylesheet, so it does not lean on being handed a good one.
    if (/[{}]/.test(sel)) return;
    if (!ok(sel)) return;
    (r.focus ? focus : always).push(`${sel} { ${prop}: ${val} !important; }`);
  });
  return { always: always.join("\n"), focus: focus.join("\n") };
}

// Fold one page's match counts into the stored record. `counts` is { ruleId: n } for the
// rules that were checked — a rule missing from it was not checked (disabled, or the site
// is not one we run on) and must not be counted as a miss, which is the difference between
// "we looked and found nothing" and "we never looked".
//
// `now` is passed in rather than read here so the caller owns the clock and the tests do
// not have to. Nothing is ever decremented: two tabs on different Plane routes both write,
// and the honest merge of "35 here, 0 there" is one hit and two checks, in either order.
function peRuleHealthUpdate(prev, counts, now) {
  const out = Object.assign({}, prev && typeof prev === "object" ? prev : {});
  const at = typeof now === "number" && isFinite(now) ? now : 0;
  Object.keys(counts && typeof counts === "object" ? counts : {}).forEach((id) => {
    const n = counts[id];
    if (typeof n !== "number" || !isFinite(n) || n < 0) return;
    const was = out[id] && typeof out[id] === "object" ? out[id] : {};
    const checks = (typeof was.checks === "number" ? was.checks : 0) + 1;
    const hits = (typeof was.hits === "number" ? was.hits : 0) + (n > 0 ? 1 : 0);
    // The timestamp only moves forward, and only on a hit — it answers "when did this last
    // work", which a miss has nothing to say about.
    const prevAt = typeof was.at === "number" ? was.at : 0;
    out[id] = { checks, hits, at: n > 0 ? Math.max(prevAt, at) : prevAt };
  });
  return out;
}

// Drop records for rules that no longer exist, and hard-cap what is left. Called on the
// same write as the update: a deleted rule's history is not evidence about anything, and a
// rule id that comes back is a new rule that happens to share a name.
function peRuleHealthPrune(health, rules) {
  const live = new Set(
    (Array.isArray(rules) ? rules : []).map((r) => (r && typeof r === "object" ? r.id : null)).filter(Boolean)
  );
  const out = {};
  let n = 0;
  Object.keys(health && typeof health === "object" ? health : {}).forEach((id) => {
    if (!live.has(id) || n >= PE_RULE_HEALTH_MAX) return;
    out[id] = health[id];
    n++;
  });
  return out;
}

// What a row may say about a rule. Three states, and the first is the important one:
//   "unknown" — not looked at enough times to have an opinion. Says nothing.
//   "ok"      — it has matched; `at` is when it last did. A redesign shows up here as a
//               stale date beside rules that all read "just now", which is a comparison the
//               reader makes better than a threshold would.
//   "cold"    — checked enough times, never once matched. This is the shape of the Plane
//               Cloud bug, and the one state worth a warning.
// There is deliberately no "was working, stopped" state: it would need a threshold on
// consecutive misses, and a rule for one route legitimately misses on every other one.
function peRuleHealthState(entry) {
  const e = entry && typeof entry === "object" ? entry : null;
  const checks = e && typeof e.checks === "number" ? e.checks : 0;
  const hits = e && typeof e.hits === "number" ? e.hits : 0;
  if (hits > 0) return "ok";
  if (checks >= PE_RULE_HEALTH_MIN_CHECKS) return "cold";
  return "unknown";
}

// How many of these rules have been checked enough to say they have never matched. The
// summary line above the rule list; the count is what turns one quiet row into something
// the reader notices. Disabled rules are excluded — they are not being applied, so "it
// never matched" is not news about them.
function peRuleHealthColdCount(health, rules) {
  return (Array.isArray(rules) ? rules : []).filter(
    (r) => r && typeof r === "object" && r.enabled !== false && peRuleHealthState((health || {})[r.id]) === "cold"
  ).length;
}

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
    },
    // Same list, but each of these waits for focus mode. Existing installs get them from
    // the v6 → v7 migration, not from here — peDeepMerge only backfills an absent array.
    ...peFocusPresetRules()
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

  // Copy formats — see PE_ITEM_PREFIX. Each: { id, name, format }. The three presets are
  // the three places a work item reference actually goes: a chat message, a pull request
  // body, and a branch name. They are ordinary rows, editable and deletable like any
  // other — nothing in the code treats them as special.
  copyFormats: [
    {
      id: "cpy-plain",
      name: peMsg("optCopyPresetPlain") || "Plain text",
      format: "{{item.key}} {{item.title}} {{item.url}}"
    },
    {
      id: "cpy-markdown",
      name: peMsg("optCopyPresetMarkdown") || "Markdown link",
      format: "[{{item.key}}]({{item.url}}) {{item.title}}"
    },
    {
      id: "cpy-branch",
      name: peMsg("optCopyPresetBranch") || "Branch name",
      format: "feature/{{item.key}}"
    }
  ],

  // Quick open targets — see PE_MAX_QUICK_LINKS. Ships empty like `domains`: a target's
  // url carries the user's own host and workspace ("https://plane.acme.com/team/browse/
  // {{key}}"), so a shipped preset would only open a broken address. The Settings section
  // shows the shape and the omnibox keyword. Each: { id, name, prefix, url, enabled }.
  quickLinks: [],

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
//   v3 → v4: templates moved into their own storage items. Nothing to rewrite here — a
//            v3 object still carries them inline and peAssembleSettings reads them from
//            there whenever no shard count is stamped, so the conversion happens on the
//            next save. Only the stamp moves.
//   v4 → v5: copyFormats is additive, so peDeepMerge backfills it — only the stamp
//            moves. Note it backfills an *absent* array only: a user who deleted every
//            format keeps an empty one and does not get the presets back.
//   v5 → v6: quickLinks is additive and ships empty, so there is nothing to backfill —
//            peDeepMerge carries an absent array through as []. Only the stamp moves.
//   v6 → v7: focus mode arrives with rules of its own. `rules` is an array every install
//            already has, and peDeepMerge only backfills an *absent* one, so the presets
//            would reach new installs and nobody else — they are appended here instead.
//            This is not the resurrection trap: these ids did not exist before v7, so
//            nothing the user deleted comes back, and once the stamp reaches 7 deleting
//            them is final.
//   v7 → v8: two of the focus presets stopped matching anything on Plane Cloud (see
//            peFocusPresetRules), so their selectors grow a second shape. Unlike v6 → v7
//            this rewrites a value already in the user's storage, which is only allowed
//            because it is guarded: a rule is repointed ONLY while its selector is still
//            character-for-character what v7 shipped. Anyone who edited theirs — including
//            anyone who already worked out Cloud's selector by hand — keeps it. A rule the
//            user deleted stays deleted; this appends nothing.
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
  if (from < 7) {
    const rules = Array.isArray(raw.rules) ? raw.rules : [];
    const have = new Set(rules.map((r) => (r && typeof r === "object" ? r.id : null)));
    peFocusPresetRules().forEach((r) => {
      if (!have.has(r.id)) rules.push(r);
    });
    raw.rules = rules;
  }
  if (from < 8) {
    const shipped = {};
    peFocusPresetRules().forEach((r) => (shipped[r.id] = r.selector));
    (Array.isArray(raw.rules) ? raw.rules : []).forEach((r) => {
      if (!r || typeof r !== "object") return;
      const was = PE_V7_FOCUS_SELECTORS[r.id];
      if (was && r.selector === was) r.selector = shipped[r.id];
    });
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
      // Absent means "always on": a backup written before focus mode existed describes
      // rules that applied unconditionally, and that is what it should still mean.
      focus: bool(r.focus, false),
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

  out.copyFormats = arr(raw.copyFormats)
    .filter((c) => c && typeof c === "object")
    .map((c) => ({
      id: str(c.id, L.maxFieldLen) || "cpy-" + peHash([c.name, c.format].map((x) => str(x, L.maxFieldLen)).join(SEP)),
      name: str(c.name, L.maxFieldLen),
      format: str(c.format, L.maxFieldLen)
    }))
    // A format with nothing in it copies nothing; the name alone is not the thing.
    .filter((c) => c.format.trim())
    .slice(0, PE_MAX_COPY_FORMATS);

  out.quickLinks = arr(raw.quickLinks)
    .filter((q) => q && typeof q === "object")
    .map((q) => ({
      id: str(q.id, L.maxFieldLen) || "qlk-" + peHash([q.name, q.prefix, q.url].map((x) => str(x, L.maxFieldLen)).join(SEP)),
      name: str(q.name, L.maxFieldLen),
      prefix: str(q.prefix, L.maxFieldLen),
      url: str(q.url, L.maxFieldLen).trim(),
      enabled: bool(q.enabled, true)
    }))
    // A quick link with no url opens nothing; a name or prefix on its own is not a target.
    .filter((q) => q.url)
    .slice(0, PE_MAX_QUICK_LINKS);

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

/* ------------------------------------------------------------------ */
/* Settings storage — one core item plus a template shard per 8 KB     */
/* ------------------------------------------------------------------ */

// Chrome sizes an item as "the JSON stringification of its value plus its key length",
// and that is bytes, not characters — a Korean template costs three times what its
// length suggests. Measure it the same way, or the meter lies in exactly the locale
// least able to afford it.
const PE_ENCODER = new TextEncoder();
function peByteLen(s) {
  return PE_ENCODER.encode(String(s == null ? "" : s)).length;
}

// Chrome sizes an item with its OWN serializer, not ours, and the two disagree on one
// character. Chromium's JSON writer escapes "<" as "<" — six bytes — to stop a
// serialized value from closing a script tag; JSON.stringify emits it raw as one. Every
// other rule matches: the same escapes for quotes, backslashes and control characters,
// and raw UTF-8 for everything non-ASCII (a Korean character is three bytes in both, an
// emoji four). So the whole correction is five bytes per "<".
//
// Left out, a template of Markdown with HTML in it measured up to six times small: the
// meter showed green, the packer filled a shard past the cap, and Chrome refused the save
// with a per-item quota error that pointed at the wrong part of the settings.
// (Verified against extensions/browser/api/storage/settings_storage_quota_enforcer.cc and
// base/json/string_escape.cc, not inferred from the API docs.)
function peJsonBytes(value) {
  const json = JSON.stringify(value);
  let lt = 0;
  for (let i = 0; i < json.length; i++) if (json.charCodeAt(i) === 60) lt++;
  return peByteLen(json) + lt * 5;
}

function peItemBytes(key, value) {
  return peByteLen(key) + peJsonBytes(value);
}

// Greedily fill one item at a time. Templates are never split across two items, so a
// shard ends wherever the next one would not fit — one holding a single 5 KB template is
// correct, not under-filled. Packing tighter means splitting them, which buys a little
// quota and makes one lost shard damage several templates instead of one.
//
// A template that does not fit an item on its own is still emitted (as a shard of one)
// rather than dropped — losing a user's work to stay under a limit is never the right
// trade. peSaveSettings refuses that save by name.
function pePackTemplates(templates) {
  const shards = [];
  let cur = [];
  for (const t of templates || []) {
    if (cur.length && peItemBytes(PE_TPL_KEY_PREFIX + shards.length, cur.concat([t])) > PE_SYNC_ITEM_BYTES) {
      shards.push(cur);
      cur = [];
    }
    cur.push(t);
  }
  if (cur.length) shards.push(cur);
  return shards;
}

// The exact set of items a save writes. The storage meter uses this too, so what it
// measures is what actually goes to storage rather than a second guess at the layout.
function peSettingsWriteSet(settings) {
  const templates = Array.isArray(settings.templates) ? settings.templates : [];
  const shards = pePackTemplates(templates);
  // Copy every key except templates, then set the mirror from the normalized array — so a
  // non-array `templates` on the way in cannot land in the core item as-is.
  const core = {};
  for (const k of Object.keys(settings)) if (k !== "templates") core[k] = settings[k];
  core.tplShards = shards.length;
  // A build older than sharding reads templates from the core item and knows nothing
  // about the shards, so it would show an empty list on any device that had not updated
  // yet. Keeping a copy here while it still fits costs quota we have and spares that
  // user the fright. It is dropped the moment it stops fitting — which is precisely the
  // case an older build could never have stored anyway.
  core.templates = templates;
  if (peItemBytes(PE_STORAGE_KEY, core) > PE_SYNC_ITEM_BYTES) core.templates = [];
  const items = { [PE_STORAGE_KEY]: core };
  shards.forEach((s, i) => (items[PE_TPL_KEY_PREFIX + i] = s));
  return items;
}

// What a save would occupy: the total against PE_SYNC_QUOTA_BYTES, and the largest
// single item against PE_SYNC_ITEM_BYTES. Both are real ceilings and either one can
// refuse the write, so the meter has to watch both — when everything lived in one item
// the two questions were the same question, and a meter that only tracks the total now
// shows green while a core item bloated by domains and rules fails on save.
function peSettingsUsage(settings) {
  const items = peSettingsWriteSet(settings);
  let total = 0;
  let worst = 0;
  let worstKey = "";
  for (const k of Object.keys(items)) {
    const n = peItemBytes(k, items[k]);
    total += n;
    if (n > worst) {
      worst = n;
      worstKey = k;
    }
  }
  return {
    total,
    worst,
    worstKey,
    overTotal: total > PE_SYNC_QUOTA_BYTES,
    overItem: worst > PE_SYNC_ITEM_BYTES
  };
}

// Total bytes one save would occupy, against PE_SYNC_QUOTA_BYTES.
function peSettingsBytes(settings) {
  return peSettingsUsage(settings).total;
}

// Reassemble settings from a raw chrome.storage.sync dump. Split out so the assembly
// rules are testable without a storage stub — they are where a wrong guess costs a user
// their templates.
//
// `tplShards` is the switch: stamped, templates come from the shards and whatever sits
// inline is a mirror to ignore; absent, they come from inline, which covers both a v3
// object and a write from a build that predates sharding.
function peAssembleSettings(all) {
  const raw = peMigrate((all && all[PE_STORAGE_KEY]) || {});
  const n = raw.tplShards;
  if (typeof n === "number" && n >= 0) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const part = all[PE_TPL_KEY_PREFIX + i];
      if (Array.isArray(part)) out.push(...part);
    }
    raw.templates = out;
  }
  // Never let it reach the form: it is storage bookkeeping, and peDeepMerge carries
  // unknown keys through, so it would ride into exports and back out of imports.
  delete raw.tplShards;
  const merged = peDeepMerge(PE_DEFAULTS, raw);
  // Backfill the template title field (compat with older templates)
  (merged.templates || []).forEach((t) => {
    if (typeof t.title !== "string") t.title = "";
  });
  return merged;
}

function peGetSettings() {
  return new Promise((resolve) => {
    try {
      // Everything, not one key: the shards have to come back in the same read, and a
      // second read could land either side of another device's write.
      chrome.storage.sync.get(null, (res) => resolve(peAssembleSettings(res || {})));
    } catch (e) {
      resolve(peDeepMerge(PE_DEFAULTS, {}));
    }
  });
}

// Raised when one template is too big for an item of its own. Nothing can split it
// further, and chrome's own answer is a generic quota error that never says which
// template — so it is caught here, by name, before the write.
const PE_ERR_TEMPLATE_TOO_LARGE = "PE_TEMPLATE_TOO_LARGE";

function peSaveSettings(settings) {
  return new Promise((resolve, reject) => {
    try {
      const items = peSettingsWriteSet(settings);
      const live = Object.keys(items);
      // A shard of one that is still over the per-item cap is a single template nothing
      // can split — refuse it by name before the write, since Chrome's own quota error
      // never says which one. Checked on the ACTUAL items (real keys): the shard's stored
      // key can be longer than "peTpl.0" once there are ten shards, and guessing the
      // short key would let a byte-boundary template pass here only to be rejected by
      // Chrome and mislabelled as a core-item (domains/rules) failure. (Multi-template
      // shards are never over — pePackTemplates starts a new one before it would be.)
      for (const key of live) {
        if (key.indexOf(PE_TPL_KEY_PREFIX) !== 0) continue;
        const shard = items[key];
        if (shard.length === 1 && peItemBytes(key, shard) > PE_SYNC_ITEM_BYTES) {
          reject(
            Object.assign(new Error("template too large for one sync item"), {
              code: PE_ERR_TEMPLATE_TOO_LARGE,
              templateName: ((shard[0] && shard[0].name) || "").trim()
            })
          );
          return;
        }
      }
      chrome.storage.sync.set(items, () => {
        const err = chrome.runtime && chrome.runtime.lastError;
        if (err) {
          reject(err);
          return;
        }
        // Write first, prune second. A stale shard left behind is inert — the core item
        // says how many to read — whereas pruning first would leave a failed save with
        // its tail of templates already gone.
        chrome.storage.sync.get(null, (all) => {
          const stale = Object.keys(all || {}).filter(
            (k) => k.indexOf(PE_TPL_KEY_PREFIX) === 0 && live.indexOf(k) === -1
          );
          if (!stale.length) {
            resolve();
            return;
          }
          chrome.storage.sync.remove(stale, () => resolve());
        });
      });
    } catch (e) {
      reject(e);
    }
  });
}

// Did a storage change touch the settings? Every listener used to ask
// `changes[PE_STORAGE_KEY]`, which stopped seeing template edits the moment templates
// moved into items of their own — the picker would keep showing the old list until the
// page was reloaded.
function peSettingsChanged(changes, area) {
  if (area !== "sync" || !changes) return false;
  return Object.keys(changes).some((k) => k === PE_STORAGE_KEY || k.indexOf(PE_TPL_KEY_PREFIX) === 0);
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
// Returns null for anything Chrome cannot turn into a host permission.
function peOriginPatternForUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch (_) {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  // hostname, not host: a match pattern's host is a hostname and carries no port, and
  // Chrome's docs say the way to match any port is to leave it out ("To match any
  // localhost port during development, use http://localhost/*"). Keeping the port
  // produced "http://localhost:8731/*", which is not a valid pattern — chrome throws on
  // it, fetchSource reads the throw as "not granted", and a self-hosted Plane on a
  // non-default port could never be granted at all. Dropping it grants the host on every
  // port, which is what the ported URL needed anyway.
  return u.protocol + "//" + u.hostname + "/*";
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

// The version of the sync feed format — what a published file stamps as `schema`, and
// what examples/team-templates.json carries. Independent of PE_SCHEMA, which versions the
// user's own settings: one is a wire format between people, the other is storage.
const PE_FEED_SCHEMA = 1;

// Turn the user's own templates into a file another install can subscribe to.
//
// Sync could always read a feed; nothing could write one, so the only way to publish for
// a team was to author the JSON by hand. That put the feature out of reach of everyone
// who was not going to do that, which is most of the people it was built for.
//
// The output goes back through peNormalizeRemoteTemplates on the subscriber's side, so
// this is one half of a round trip and tools/test.js checks it as one. `version` is a
// stamp for whoever reads the file — sync deliberately does not use it for change
// detection (a source edited without bumping it once kept serving the old templates), so
// nothing breaks if two exports on one day share a value.
function peBuildTeamFeed(settings, feedName, today) {
  const L = PE_SYNC_LIMITS;
  const templates = (settings && settings.templates ? settings.templates : [])
    .filter(peTemplateHasContent)
    .slice(0, L.maxTemplatesPerSource)
    .map((t) => ({
      id: peClampStr(t.id || "", L.maxFieldLen),
      name: peClampStr(t.name || "", L.maxFieldLen),
      title: peClampStr(t.title || "", L.maxFieldLen),
      content: peClampStr(t.content || "", L.maxContentLen)
    }));
  const feed = { schema: PE_FEED_SCHEMA };
  const label = peClampStr(typeof feedName === "string" ? feedName : "", L.maxFieldLen).trim();
  // Omitted rather than blank when unnamed: a subscriber falls back to the source's host,
  // and an empty string would only look like a name that failed to load.
  if (label) feed.name = label;
  if (today) feed.version = today;
  feed.templates = templates;
  return feed;
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

// Read the rule-health record (chrome.storage.local). Absent is the normal state on a
// fresh install and reads as "nothing known yet", which is what peRuleHealthState says
// about an id it does not find.
function peGetRuleHealth() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(PE_RULE_HEALTH_KEY, (res) => {
        const h = res && res[PE_RULE_HEALTH_KEY];
        resolve(h && typeof h === "object" ? h : {});
      });
    } catch (_) {
      resolve({});
    }
  });
}

function peSaveRuleHealth(health) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ [PE_RULE_HEALTH_KEY]: health }, () => {
        // Advisory data. A write that fails costs a page's worth of observation, so it is
        // swallowed rather than surfaced — there is nothing the reader could do about it.
        void (chrome.runtime && chrome.runtime.lastError);
        resolve();
      });
    } catch (_) {
      resolve();
    }
  });
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
// Where a work item lives, as a link someone else can open. Returns "" when the page
// cannot tell us — the caller then leaves {{item.url}} standing as its own token.
//
// Three cases, tried in this order, and the difference is worth keeping in view:
//
//   observed  — the address bar already IS the item's page. Nothing to work out; the query
//               string is dropped because it carries view state, not the item. This is the
//               case on Plane's /{workspace}/browse/{KEY} and on Linear's
//               /{workspace}/issue/{KEY}/{slug} alike, which is why the check asks the
//               quick links rather than looking for the word "browse".
//   configured — a peek panel opened over a list keeps the *list's* URL, and the panel
//               contains no link to the item at all (checked: its only anchor points at
//               Plane's docs). So the link is composed from the user's own quick link for
//               that key — the same grammar that opens it from the address bar, read
//               forwards this time. Only a link landing on the origin we are already on is
//               used: a key routed to a different tracker is a link to somewhere else, and
//               copying that while reading this page would be a quiet lie.
//   assembled — no quick link covers it, so fall back to Plane's canonical short link,
//               /{workspace}/browse/{KEY}, composed from the first path segment and the
//               key. Quick open ships empty, so this is what everyone who has not
//               configured one still gets, unchanged.
//
// That last case is the one that rests on Plane's URL scheme — verified by opening the
// /projects/{uuid}/issues/{uuid} form and watching Plane redirect to exactly that. It used
// to be the only case, and the line to re-check against a new Plane version. It is now the
// fallback, and a user who has configured Quick open never reaches it: their own grammar
// answers first, and a grammar they wrote is one they can fix.
// The key an item's own page carries in its path, or "" for anything else — a list route with a
// peek panel over it has none. Two callers: peItemUrl, to notice it is already looking at the
// item, and the content script, to tell this item's key from another one shown beside it.
function peKeyFromPath(pathname) {
  const seg = String(pathname || "")
    .split("/")
    .filter(Boolean);
  const i = seg.indexOf("browse");
  if (i === -1 || seg.length !== i + 2) return "";
  try {
    return decodeURIComponent(seg[i + 1]);
  } catch (_) {
    return seg[i + 1]; // keep it raw rather than lose it
  }
}

function peItemUrl(origin, pathname, key, links) {
  if (!origin || !key) return "";
  const seg = String(pathname || "")
    .split("/")
    .filter(Boolean);
  // Same page, same item → hand back what the user is looking at. Asked two ways, because
  // the quick links only answer for someone who configured them and peKeyFromPath answers
  // for every Plane install whether they did or not.
  if (peKeyFromPath(pathname) === key) return origin + pathname;
  if (peKeyFromUrl(links, origin + pathname) === key) return origin + pathname;
  // Configured: the user's own grammar, read forwards. Same origin only.
  const routed = peExpandQuickLink(peRouteQuickLink(links, key), key);
  if (peIsHttpUrl(routed)) {
    try {
      if (new URL(routed).origin === origin) return routed;
    } catch (_) {
      /* an unparseable url is not a link we will hand anyone */
    }
  }
  if (!seg.length) return "";
  return origin + "/" + seg[0] + "/browse/" + key;
}

// Expand a copy format against the fields read off the work item page.
//
// One pass, no recursion, and the same law the template variables already follow: a
// token we cannot resolve is returned untouched instead of blanked. A format that asks
// for a field the page did not give us then says so on the clipboard — visible before
// the paste — rather than copying a hole that reads as if the title were empty.
// peMissingItemFields names those tokens so the caller can say which one failed.
function peExpandCopyFormat(format, item) {
  if (!format) return "";
  const fields = item || {};
  return String(format).replace(peItemTokenRe(), (token, name) => {
    const v = fields[String(name).toLowerCase()];
    return typeof v === "string" && v !== "" ? v : token;
  });
}

// The item fields a format references but the page could not supply — unknown names
// ({{item.state}}) and known ones that came back empty alike, because from the user's
// side both leave the same unexpanded token on the clipboard.
function peMissingItemFields(format, item) {
  const fields = item || {};
  const out = [];
  const re = peItemTokenRe();
  let m;
  while ((m = re.exec(String(format || "")))) {
    const name = String(m[1]).toLowerCase();
    const v = fields[name];
    if (!(typeof v === "string" && v !== "") && out.indexOf(name) === -1) out.push(name);
  }
  return out;
}

// Split a typed key on its LAST "-" into { proj, num } for the {{key.proj}} / {{key.num}}
// tokens. A key is "<identifier>-<number>" and the identifier itself can hold a "-", so the
// last "-" is the true split. A key with no usable "-" has no split — proj/num come back
// empty and their tokens stay unexpanded, the same as any other unknown token.
function peSplitKey(key) {
  const s = String(key == null ? "" : key).trim();
  const i = s.lastIndexOf("-");
  if (i <= 0 || i === s.length - 1) return { key: s, proj: "", num: "" };
  return { key: s, proj: s.slice(0, i), num: s.slice(i + 1) };
}

// Pick the quick link a typed key routes to: among enabled links that have a url, the one
// whose non-empty prefix the key starts with — longest prefix wins, so "ENG-INFRA-" beats
// "ENG-"; failing that, the first with an empty prefix (the default); failing that, the
// first usable link. The prefix test is a literal string comparison, never a letter-anchored
// regex — a Plane identifier can be all digits ("42-7"). Returns the link, or null.
function peRouteQuickLink(links, key) {
  const k = String(key == null ? "" : key).trim();
  if (!k) return null;
  const usable = (links || []).filter((l) => l && l.enabled !== false && String(l.url || "").trim());
  if (!usable.length) return null;
  let best = null;
  let bestLen = -1;
  for (const l of usable) {
    const p = String(l.prefix || "");
    if (p && k.startsWith(p) && p.length > bestLen) {
      best = l;
      bestLen = p.length;
    }
  }
  return best || usable.find((l) => !String(l.prefix || "").trim()) || usable[0];
}

// Build the destination URL for a key against a quick link. A url with a {{key}} token (or
// {{key.proj}} / {{key.num}}) has it substituted; a url with no key token gets the key
// appended — the "base link + what you typed" case. The value is URL-encoded on the way in
// so a space or "#" cannot break the address; an unknown token stays as written, the same
// rule the copy formats follow. Returns "" when the link has no url.
function peExpandQuickLink(link, key) {
  const url = link && link.url ? String(link.url) : "";
  if (!url) return "";
  const parts = peSplitKey(key);
  const enc = (v) => encodeURIComponent(String(v == null ? "" : v));
  if (peQuickTokenRe().test(url)) {
    return url.replace(peQuickTokenRe(), (token, which) => {
      const v = which ? parts[which] : parts.key;
      return v ? enc(v) : token;
    });
  }
  return url + enc(parts.key);
}

// Read a key back OUT of a URL, using the same quick links that put keys into one.
//
// This is the whole of what makes Copy reference portable. A quick link already states the
// user's URL grammar for their tracker — "https://linear.app/acme/issue/{{key}}" — and a
// grammar reads in both directions. So the list that answers "where does GAE-2 live" also
// answers "which item is this page", with no second thing to configure and nothing new to
// couple to. It is also what retires the one piece of Plane's URL scheme this file used to
// hardcode; see peItemUrl.
//
// Turning a template into a matcher: literals are escaped, each {{key}} / {{key.proj}} /
// {{key.num}} becomes one path segment, and a template with no token at all is a base the
// key is appended to (the same three cases peExpandQuickLink writes). Trailing path,
// query and hash are allowed after the match, because a real address carries them —
// Linear redirects /issue/GAE-2 to /issue/GAE-2/connect-your-tools, and Plane's browse
// links end in a slash. Verified against both on 2026-08-08.
function peMatchQuickLink(template, url) {
  const t = String(template == null ? "" : template);
  const u = String(url == null ? "" : url);
  if (!t || !u) return "";
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // What a key may run up to. "&" is in there for the query case: a greedy segment would
  // swallow "ENG-42&view=grid" out of "?item=ENG-42&view=grid" and then fail the shape check,
  // so a perfectly good template would answer nothing. No key can contain any of these.
  const SEG = "([^/?#&]+)";
  const TAIL = "(?:[/?#&].*)?$";
  const order = [];
  let body = "";
  let last = 0;
  const re = peQuickTokenRe();
  let m;
  while ((m = re.exec(t))) {
    body += esc(t.slice(last, m.index)) + SEG;
    order.push(m[1] ? String(m[1]).toLowerCase() : "key");
    last = m.index + m[0].length;
  }
  if (!order.length) {
    body = esc(t) + SEG;
    order.push("key");
  } else {
    body += esc(t.slice(last));
  }
  let hit;
  try {
    hit = new RegExp("^" + body + TAIL, "i").exec(u);
  } catch (_) {
    return ""; // a template that will not compile matches nothing, it does not throw
  }
  if (!hit) return "";
  const parts = {};
  order.forEach((name, i) => {
    let v = hit[i + 1] || "";
    try {
      v = decodeURIComponent(v);
    } catch (_) {
      /* keep it raw rather than lose it */
    }
    parts[name] = v;
  });
  const key = (parts.key || (parts.proj && parts.num ? parts.proj + "-" + parts.num : "")).trim();
  // The shape check is not politeness — it is what stops a template from claiming a page it
  // has no business claiming. Without it "…/issue/{{key}}" would answer "settings" for
  // /issue/settings, and Copy reference would hand over a reference to a word.
  return PE_ITEM_KEY_RE.test(key) ? key : "";
}

// The key this URL names, according to the user's quick links, or "". The most specific
// template wins — "…/acme/browse/{{key}}" beats "…/{{key}}" — because a shorter template is
// a prefix of the longer one's world and would otherwise answer first by accident.
function peKeyFromUrl(links, url) {
  const usable = (Array.isArray(links) ? links : [])
    .filter((l) => l && typeof l === "object" && l.enabled !== false && l.url)
    .sort((a, b) => String(b.url).length - String(a.url).length);
  for (const l of usable) {
    const key = peMatchQuickLink(l.url, url);
    if (key) return key;
  }
  return "";
}

// The work item title out of a page title, or "".
//
// Measured 2026-08-08: Plane and Linear both write "{KEY} {title}" — "GAERA-6 5. Use Cycles
// to time box tasks 🗓️" and "GAE-2 Connect your tools". That is the only shape accepted,
// and only when the key is the one we already established from the URL. Anything else
// returns "" rather than a guess: an unresolved {{item.title}} stays visible on the
// clipboard and the toast names it, which is the contract every other missing field
// follows — a wrong title looks right and is pasted.
function peTitleFromDocTitle(docTitle, key) {
  const t = String(docTitle == null ? "" : docTitle).trim();
  const k = String(key == null ? "" : key).trim();
  if (!t || !k || t.length <= k.length) return "";
  if (t.slice(0, k.length).toLowerCase() !== k.toLowerCase()) return "";
  const rest = t.slice(k.length);
  if (!/^\s/.test(rest)) return ""; // "GAE-21 …" must not answer for the key "GAE-2"
  return rest.trim();
}

// Only ever navigate to an http(s) address from a quick link. A stored url is the user's
// own, but this keeps a javascript:/data: value (from a hand-edited import) from being
// opened as if it were a link.
function peIsHttpUrl(u) {
  return /^https?:\/\//i.test(String(u == null ? "" : u).trim());
}

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

// Every host pattern the current settings imply a need for: the active domains, plus the
// origin of each enabled sync source. This is what must be granted for the extension to
// actually run.
//
// It matters because Chrome does NOT sync host permissions across devices — only settings
// sync. So a settings object that arrived from another device can list domains and source
// URLs this device has never granted, and reconcile() then registers nothing for them: the
// extension looks installed and configured but sits inert. Callers diff this against what
// permissions.contains reports to find that gap and offer a one-click re-grant.
function peDesiredOrigins(settings) {
  const out = peOriginPatterns(settings);
  const sync = settings && settings.templateSync;
  if (sync && sync.enabled) {
    for (const src of sync.sources || []) {
      if (!src || src.enabled === false || !src.url) continue;
      const p = peOriginPatternForUrl(src.url);
      if (p) out.push(p);
    }
  }
  return [...new Set(out)];
}
