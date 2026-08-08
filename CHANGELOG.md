# Changelog

Every release is one minor version, cut by `release.yml` when `manifest.json`'s version
changes on `main`. Entries are grouped as **New** (a feature that was not there),
**Improved** (something that already worked, working better), **Fixed** (it was wrong),
and **Internal** (nothing a user sees, but it is why the rest holds).

`Schema` is the settings-storage version; a bump means installed settings are migrated on
first read, never rewritten by hand.

---

## v1.8.0 — 2026-08-08

Schema 7 → 8.

### Fixed
- **Focus mode did almost nothing on Plane Cloud.** Two of its three presets were written
  against self-hosted Plane 1.4, and Cloud writes both elements with completely different
  classes — so the properties panel and the reading width matched zero elements there and
  only the left navigation ever moved. Each of those two selectors now carries both shapes,
  and installs that still have the shipped selector are repointed on first read. A selector
  you edited yourself is left exactly as it is, and a preset you deleted stays deleted.

  A rule that matches nothing is a no-op by design — which is why nobody noticed for a
  release. The checks now hold both generations on one page, including the near misses:
  `.shrink-0.bg-surface-1` without the `.z-[5]` also catches an unrelated chip on Cloud's
  cycles route, and hiding it would be focus mode reaching outside the page it is for.

### New
- **Settings now says whether each rule is actually doing anything.** A rule that matches
  nothing is a no-op by design — that is what keeps a Plane redesign from breaking the
  extension — but it made a rule that had *stopped* matching look exactly like one nobody
  switched on. Every rule row now reads either when it last applied, or that it has never
  matched anything, and a line above the list counts the second kind.

  Deliberately not a per-page verdict: measured on Plane Cloud, `.max-w-40` matches 35
  elements on the work item list and none on the item page, the projects list, the labels
  page or the states page. "No match here" is the normal case for a healthy rule, so a
  warning that fires on it is noise, and noise is what people switch off. What is recorded
  is whether a selector has **ever** matched, and when it last did — a redesign then shows
  up as one stale date beside rules that all read today. A rule needs 20 checks with no
  match before the page will say it has never worked, because a rule written for one route
  honestly misses on every other one.

  The record is per device (`chrome.storage.local`), never synced, and disabled rules are
  left out of it — a rule nobody applies has nothing to answer for.

### Internal
- **`tools/dom-harness.js`'s synthetic Plane page carries two generations of the markup**,
  1.4 and Cloud, plus a decoy for each. A page that carries one generation cannot notice
  when the other stops matching; that is the whole failure above. Reverting either half of
  the selector now fails three assertions.
- **The harness's `chrome.storage.local` is now readable and writable**, so the rule-health
  record can be seeded for the settings page and read back after the content script writes
  it. A stub that swallowed the write could not tell the feature working from the silence it
  was built to end. Its virtual-time budget grew with it: 5000ms was less than one
  measurement delay, so a suite proving "nothing for 2.5s, then this" had no room to run.

---

## v1.7.0 — 2026-08-06

Schema 6 → 7.

### New
- **Focus mode.** On a work item's own page Plane pins the properties to the right with no
  way to collapse them. `Alt+Shift+F` (macOS `⌥+⇧+F`), the toggle beside the item's key, or
  the switch in the popup hides the properties panel and the left navigation; the same key
  brings them back. The state is per tab and is never synced — waking up on another machine
  to a hidden panel is not a feature.
- **Any style rule can be marked "Only while focus mode is on"**, so what disappears is your
  choice. Three presets ship: the work item properties panel (on), the left navigation (on),
  and the body centred at a reading width (off — a taste, not a default).
- **A Shortcuts tab in Settings.** Every shortcut in one table: what it does, the
  Windows/Linux keys, the macOS keys, where it works, and which of them can be rebound at
  `chrome://extensions/shortcuts`.

### Fixed
- **Copy reference copied the parent item's key and URL** on any work item that has a
  parent. Plane draws the parent's key and this item's key from one component, and the
  parent's comes first, so both header buttons attached to the wrong chip. Which key belongs
  to the item you are on is now decided by three signals — the address, whether the key is a
  link, and whether it is inert — and was re-checked on pages with sub-items and relations.

### Improved
- **Settings descriptions break at each sentence** instead of arriving as one grey block.
- **One shortcut, one spelling.** `Alt+Shift+F` was written for macOS as `⌥⇧F` in eleven
  places while the Windows form kept its `+` signs, and three cards marked keystrokes up
  three different ways.
- **Shorter copy.** The store description opened with two paragraphs explaining what Plane is
  and that this is unofficial — both true, both known to anyone reading the listing, both now
  at the foot where the search keywords still do their job.
- **Korean that reads like Korean.** Several strings kept an English sentence's frame; the
  가운뎃점 standing for "and" is a comma or 와/과 now, leaving it only as a UI separator.

### Internal
- The browser check now drives `content.js` too, on a synthetic work item page: 98
  assertions across 18 pages, including that the class escaping shipped for `min-w-[300px]`
  matches what Plane actually writes.

---

## v1.6.0 — 2026-08-06

### Improved
- **Settings are five tabs** — Templates · Work items · Appearance · Sites · Backup —
  instead of eight cards in one scroll. Presentation only: still one form and one Save, so an
  unsaved edit survives a tab switch. The tab is in the URL hash, and the page now opens on
  the tab that shows what it is talking about (a rule arriving from the element picker, a
  save refused for size, a profile with no sites yet).
- **The popup is three labelled groups** — jumping to an item, the extension's own switch,
  then this site. The unlabelled "Enabled" above the site status read as "enabled here" when
  it is the global switch. A site that is not on your list now says so rather than reporting
  itself inactive.
- **Quick jump is called Quick open**, everywhere a person reads it. A coined label does not
  get searched for; of eight extensions in this space none uses "jump". Stored keys are
  unchanged, so nothing migrates.
- **The extension is named `Enhancer for Plane — Quick Open & Issue Templates`.** "Plane"
  alone belongs to aircraft and "Enhancer" is not a word anyone types, so between them they
  filled the characters a browser and a store listing actually show. The popup and settings
  headers show the brand alone. The extension ID and listing URL are unchanged — reviews and
  installs carry over.
- **One example feed per language.** The four files under `examples/` — a small demo, a
  design pack and two data-team packs — are now `team-templates.json` and
  `team-templates-ko.json`, 26 templates each across six groups, so "Try our example" fills
  in the full set rather than a demo. The wired-in default URL still points at
  `team-templates.json`; a sync source aimed at one of the removed files needs repointing.

### Fixed
- **Dark mode on three row types.** Template variables, Copy reference and Quick open each
  drew a white block on a dark card (measured 16:1 against the card), the delete button's
  hover was a light red wash, and the toggle knob was white on a track that inverts to
  near-white when checked — a measured 1.1:1.
- **The style-rule "Add rule" button had silently become "Add quick link" in both locales**,
  already shipped: a new message reused a key that was already in use, and a duplicate JSON
  key is legal — the last one wins.

### Internal
- **A fourth check: the pages, in a real browser.** The three existing checks stayed green
  through every defect above, because none of it was a function of data. `tools/dom-harness.js`
  runs the generated pages in headless Chrome — 40 assertions across 10 pages — with no
  dependencies, and CI fails if nothing ran.
- Duplicate top-level i18n keys and light backgrounds with no dark-mode counterpart are now
  checked, both confirmed to flag the real regressions above before being left green.

---

## v1.5.0 — 2026-08-06

Schema 5 → 6.

### New
- **Quick open.** Type a work item key and go straight to it: in the address bar type
  `issue`, a space, then `PROJ-123`, or use the same input on the popup. Targets are base URLs
  you configure with `{{key}}` (or `{{key.proj}}` / `{{key.num}}`), or the key appended when
  the URL has no token — which covers Plane, Jira and Linear alike. The typed prefix routes
  it, so `ENG-` can go to Linear while everything else stays on Plane. It only opens a URL:
  no host permission, no content script, and it works on any tab.
- **Two import-ready template packs** under `examples/` — the data team's document
  archetypes and Plane issue types, 20 templates each, in English and Korean.

---

## v1.4.0 — 2026-07-27

Schema 4 → 5.

### New
- **Copy reference.** On a work item — its own page or the panel a list opens — a button
  beside the ID, or `Alt/⌥+C`, copies it in a format you define. Three presets ship (plain
  text, a Markdown link, a branch name), every format is an editable row, and the preview in
  Settings is exactly what lands on the clipboard. `{{item.key}}`, `{{item.title}}` and
  `{{item.url}}` are filled in; a field that is missing stays visible as its token and the
  toast names it, so a failure is seen before the paste rather than after.
- **"Try our example"** for template sync fills in this repository's own example feed, so
  sync can be watched working in one Save.

### Improved
- **A missing per-device permission is now visible.** Settings sync across devices but host
  permissions do not, so a synced profile could sit inert with no sign of why: there is now a
  toolbar badge, a banner in Settings with a one-click "Approve access", and a pointer in the
  popup.
- The store listing was rewritten benefit-first and all four captures regenerated from
  source, in English and Korean.

---

## v1.3.0 — 2026-07-23

Schema 3 → 4.

### Improved
- **Template capacity 8 KB → ~100 KB.** Every setting lived in one `chrome.storage.sync`
  item, whose ~8 KB cap was therefore the ceiling for everything — about 39 sample-sized
  templates, while the import cap claimed 500. Templates now pack into their own items,
  which reaches the 100 KB quota (roughly 218 English or 81 Korean templates of ~400
  characters). A single template that will not fit one item is refused up front, by name.

### New
- **"Share with your team."** Sync could read a feed from day one but nothing could write
  one, so publishing meant hand-authoring JSON. Body templates now exports that exact format
  from the templates you already have. It is a publication, not a backup: templates only — no
  domains, rules, variable values or source URLs, and nothing you received from a source.

### Fixed
- A template edit no longer goes unnoticed by the settings watcher — it writes only a shard,
  not the core item.
- Deleting a template no longer announced "Loaded the rule added by the picker" about your
  own deletion.
- Storage size is measured in bytes the way Chrome measures them, not by string length: a
  Korean character is 3, an emoji 4, and Chromium escapes `<` to 6 where `JSON.stringify`
  emits 1.

---

## v1.2.0 — 2026-07-16

Schema 2 → 3. Adds the `alarms` permission, for which Chrome shows no install warning.

### New
- **Template sync.** A team keeps its templates in one JSON file and everyone pulls the same
  set. The service worker fetches on a schedule and writes to a local cache; everything else
  reads that, so inserting a template costs no request, works offline, and a source that is
  down leaves the last good copy in place with the error shown in Settings. Synced templates
  are read-only — an edit here would be reverted by the next sync — but hiding a group is
  local and survives syncing.
- **Your own template variables**, `{{var.something}}`, up to five. A shared template can say
  `{{var.team}}` and resolve per person, with no personal data leaving the browser. The
  `var.` prefix is structural: a future built-in `{{quarter}}` can never collide with
  someone's `{{var.quarter}}`.
- **Korean and English throughout** — every UI string moved into `_locales`.

### Improved
- `PRIVACY.md` said "no external servers" and "No data is sent to any server". Both stopped
  being true the moment sync shipped and are corrected: the developer runs no server, the one
  request is a GET of a URL you added, it is off by default, it carries no cookies, and what
  that host unavoidably learns (your IP) is stated. Source URLs need the same per-origin
  grant as Plane domains.

### Internal
- Three dependency-free checks, run by CI on every push: behaviour tests, the translation
  contract, and architectural invariants (network confined to the worker, no `innerHTML` for
  data that is not ours, every remote field clamped, and the release zip actually containing
  every file the extension loads).

---

## v1.1.0 — 2026-07-10

### Improved
- **No host access at install.** The static `<all_urls>` content script is gone; a single
  origin is requested when you enable that domain, and dropped when you remove it. This
  answers the Web Store's broad-host-permissions concern and matches what the extension
  claims about itself.
- Enabling a site now works on the tabs you already have open, without a reload.

### Fixed
- "Enable on this site" took two clicks: the popup closes when Chrome's permission prompt
  appears, so the code after it never ran. The domain is stored before the request now.

> **Upgrading from 1.0.0:** each domain has to be enabled once more, because host access is
> no longer granted at install time.

---

## v1.0.0 — 2026-07-09

First public release. An unofficial Manifest V3 extension for Plane, self-hosted or hosted.

### New
- **Title and body templates**, from the toolbar button and inside the create-work-item
  modal, with Markdown bodies rendered into the editor. `Alt+T` opens the picker, including
  while you are typing.
- **Built-in variables** `{{date}}`, `{{date+N}}`, `{{week}}`, `{{month}}`.
- **Style rules** — force a `property: value` onto any CSS selector, with a visual element
  picker; the shipped presets undo module, cycle, label and breadcrumb name truncation.
- **Per-domain activation**: the extension is inert on every site you have not listed.
- **Import/export of all settings**, with a live storage meter.
