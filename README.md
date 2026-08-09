# Enhancer for Plane — Issue Templates & Quick Open

**English** · [한국어](README.ko.md)

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/dicjfphghjfljkifogkplgdeefjdkhbo?label=Chrome%20Web%20Store&logo=googlechrome&logoColor=white&color=121212)](https://chromewebstore.google.com/detail/dicjfphghjfljkifogkplgdeefjdkhbo)

**➜ [Install from the Chrome Web Store](https://chromewebstore.google.com/detail/dicjfphghjfljkifogkplgdeefjdkhbo)** — or [load unpacked from source](#install).

A lightweight, unofficial Chrome extension (Manifest V3) for
[Plane](https://github.com/makeplane/plane) (makeplane / plane.so) — the
open-source project management, issues and wiki tool, and a self-hosted
alternative to Jira.

It fills the gaps every issue tracker leaves: **issue templates** for the tickets
you file over and over, **quick open** to reach a ticket from its key, a one-click
**copy reference**, and a **focus mode** that puts the side panels away.

All of it inside the Plane UI, with no changes to your Plane server. It works on
Plane Cloud and self-hosted alike, and only on the domains you enable.

> Not affiliated with or endorsed by Plane. "Plane" is a trademark of its owner.
> (And no — nothing to do with airplanes.)

![Typing a work item key in the address bar opens it — for Plane, Jira or Linear](store-assets/screenshot-1-open.png)

## What it does, and where you use it

| | Where you reach it | What it needs first |
|---|---|---|
| **Open an item by key** | Address bar: `issue` ␣ `PROJ-123` · toolbar popup · right-click a key in any text | one Quick open link |
| **Come back to a recent one** | Same two places — they appear the moment you type the keyword | nothing, it fills itself |
| **Search instead of opening** | Address bar: `issue` ␣ `login bug` | a search URL on that link |
| **Copy a reference** | The button beside the item's key · <kbd>Alt</kbd>/<kbd>⌥</kbd>+<kbd>C</kbd> · the popup | nothing, three formats ship |
| **Insert a title + body** | "Template" button in the description toolbar · <kbd>Alt</kbd>/<kbd>⌥</kbd>+<kbd>T</kbd> | one template |
| **Share templates with a team** | Settings ▸ Templates ▸ Template sync | one JSON URL |
| **Hide the side panels** | <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> · the toggle beside the key · the popup | nothing, presets ship |
| **Widen a truncated name** | Settings ▸ Appearance · or the element picker in the popup | nothing, presets ship |

**Your first five minutes**

1. Install, open your Plane tab, click the toolbar icon → **Enable on this site**.
   Chrome asks once for that one site. Nothing runs anywhere else.
2. Settings ▸ **Work items** ▸ **＋ Add quick link** → paste the address of any work
   item you have open. That one paste sets up opening, searching and copying.
3. Try it: type `issue` and a space in the address bar. Everything else on this page
   is optional.

Everything is off, empty, or inert until you do something — the extension ships with
no active domain, no host access, and no quick-open links.

## Features

What each one does and how to reach it. Implementation notes are under
[How it works](#how-it-works-notes); the reasoning behind the design choices is in
[AGENTS.md](AGENTS.md).

### ⚡ Quick open

Type `issue` in the address bar, a space, then a key like `PROJ-123` — Enter opens it.
The same input is in the toolbar popup.

- **Any tracker, because it is only a URL.** Each target is a base link you configure with
  `{{key}}` where the key belongs; Plane's is `/{workspace}/browse/{{key}}`. It needs no
  host permission and no content script, so it works on any tab.
- **Adding one is a paste.** Copy the address of a work item you have open and paste it
  into Settings ▸ **Work items** — a known tracker is recognised and both URLs are filled,
  search included. Nothing open? Start from an example row: Plane, Jira, Linear, GitHub,
  GitLab.
- **The key's prefix routes it.** Point `ENG-` at Linear and leave the rest on Plane. A
  target with an empty prefix is the default.
- **The keys you opened last come back**, in the address bar and the popup. Twelve entries,
  per device, never synced.
- **Words search instead of opening.** `issue login bug` goes to the tracker's search, if
  that target has a search URL with `{{q}}`. How far it gets you varies: Jira and GitHub
  land on results, while Plane opens its search page with your words already in the box and
  one keystroke still to go.
- **A key in someone else's text.** Select it anywhere, right-click, and choose **Open work
  item from selection**. Chrome hands over the selected text; the page is never read.

### 📝 Body templates (title + body)

Register a template once and drop it into any work item in one click — title and
description together. A native **"Template"** button sits in the description toolbar and
in the "Create work item" dialog; `Alt/⌥+T` works in both.

- Bodies are **Markdown** — headings, `-`/`1.` lists, `- [ ]` checkboxes, bold, inline code.
- **Variables fill themselves in on insert**: `{{date}}`, `{{date+N}}` / `{{date-N}}` (e.g.
  `{{date+7}}` for a deadline), `{{week}}`, `{{month}}`.
- **Up to 5 of your own** — define `name` → `value` in Settings and write `{{var.name}}`.
  A shared template can say `{{var.team}}` and resolve differently for each person who
  inserts it, with no per-user data leaving the browser. An unknown name is left as its
  token rather than blanked, so a typo is visible instead of eating text.

![A native Template button fills a work item's title and body in one click](store-assets/screenshot-5-templates.png)

### 📋 Copy reference

The button beside a work item's ID (or `Alt/⌥+C`) copies that item to your clipboard, so
handing it to a chat message, a pull request body, or a branch name is one click instead of
three selections. It works on the item's own page and in the panel a list opens.

- **The formats are yours to write.** Plain text, a markdown link and a branch name ship as
  a starting point, and each is an editable row that copies out exactly as typed. Settings
  previews every row.
- Three values are filled in: `{{item.key}}`, `{{item.title}}`, `{{item.url}}`. A value the
  page does not give us stays visible as its token rather than turning into an empty string,
  and the toast names it — you find out before you paste.
- **Also in the toolbar popup**, when the tab you are on is a work item. That path reads the
  tab's address and title and nothing else, so it works wherever Quick open has a link.

![One click beside a work item's ID copies it in the format you wrote](store-assets/screenshot-4-copy.png)

### 📐 Style rules — a generic engine

Plane cuts long names off in lists and dropdowns until you cannot tell items apart. One
`selector + property + value` rule forces any width and the names come back.

- Write the full value with units — `320px`, `30rem`, `55ch`. Selector validity is checked
  as you type.
- Two rules ship switched on — the item name width and the search dropdown — and a
  **Quick add** chip seeds the cycle / breadcrumb width in one click. Because the engine is
  generic, anything else Plane truncates is the same one-rule fix, and a class name that
  shifts between versions is one selector to edit.
- **Each rule says whether it is actually doing anything.** A selector that matches nothing
  is a no-op — that is what stops a Plane redesign from breaking the extension — so every
  row reads when it last applied, or that it has never matched anything. A redesign shows up
  as one stale date beside rules that all read today.

![Cut-off names in the work item list, and the same list with a width rule applied](store-assets/screenshot-3-width.png)

### 🧘 Focus mode

`Alt+Shift+F` (macOS `⌥+⇧+F`) hides the side panels so the description is what is left.
There is a toggle beside the work item's key and a switch in the toolbar popup too.

- It is **the rules engine with a switch on it**: mark any rule *"Only while focus mode is
  on"* and it joins in. Two presets ship ready — the properties panel and the left
  navigation — and a third, capping the reading width, ships switched off.
- **Per tab, and only for that tab.** It survives a reload there, disappears when the tab
  closes, and is never synced.
- The shortcut is a **browser command**, so it fires while you are typing a description
  without eating a character. Rebind it at `chrome://extensions/shortcuts`; Settings ▸
  **Shortcuts** lists every key the extension answers to.

![The same work item with the side panels shown and hidden](store-assets/screenshot-2-focus.png)

### 🎯 Visual element picker

Click **"Pick element → add rule"** in the popup, then click any element on the page. You
get a list of candidate selectors, each with a match count, and the one you choose lands in
Settings ready for a value. No DevTools.

- **The list is ordered by what will still work next month, not by what is most precise.**
  A handle a person wrote comes first; hashed classes, uuids and other build-generated names
  are pushed down. Demoted, never hidden — it is a guess about someone else's markup.
- **Every row says so in words** — what kind of handle it is, and whether it **lasts** or
  **may change**.
- For an id whose tail is generated you also get the `[id^="…"]` prefix form.

### 🔄 Team template sync

Point the extension at a JSON file — your intranet, a Git host, any URL — and everyone pulls
the same templates. Off by default.

- Add a source in Settings, Chrome asks for access to that one origin, and its templates
  appear in the picker under their own heading. **Not sure what a source looks like?** Click
  **"Try our example"** to fill in this repo's own 26-template pack in your language.
- **Refreshed on a schedule you pick** (hourly / 6h / 12h / daily) plus **Sync now**, for up
  to 10 sources, each with its own interval and switch.
- **Synced templates are read-only** — they are edited at the source. What is local is the
  view: hide any group you do not need and it stays hidden across syncs.
- **The picker reads the cache, never the network**, so inserting costs no request and works
  offline. A failed sync keeps the last good copy.
- Remote data is treated as untrusted: size-capped, rendered as text only, ids namespaced per
  source. See [the file format](#team-template-file-format).

### 🏠 Active domains

Runs only on the domains you add. Wildcards (`*.example.com`) and a "run on all sites"
switch are supported.

### 💾 Backup (import / export)

Export everything you configured to a JSON file and import it back: domains, rules,
templates, variables, copy formats, quick open links, and sync sources. Downloaded templates
and sync status stay out — those are a per-device cache the next sync refetches. An import
loads into the form; `Save` applies it.

## Team template file format

Host a JSON file anywhere your team can reach over `http(s)` — an intranet path, a
Git host's raw URL, an S3 bucket. Add its URL in Settings ▸ Templates ▸ Team template sync.

You do not have to write it by hand. **Settings ▸ Templates ▸ Body templates ▸ "Share with your
team"** writes this exact format from the templates you already have: build them in
the UI, export, upload, share the URL. It asks for the collection's `name` and
stamps today's date as `version`. It is a *publication*, not a backup — it carries
your templates and nothing else, no domains, no rules, no variable values, no source
URLs. Templates you received *from* a source are left out too; they belong to
whoever publishes them.

```json
{
  "schema": 1,
  "name": "QA & Delivery standards",
  "version": "2026-07-15b",
  "templates": [
    {
      "id": "bug-detailed",
      "group": "QA Templates",
      "name": "🐞 Bug (detailed)",
      "title": "[Bug] ",
      "content": "## Steps to reproduce\n1. \n\n## Expected\n\n## Actual\n"
    }
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `name` | no | The collection's label. Shown as the picker's header for this source unless you give the source your own name in Settings. |
| `version` | no | Free-form string. Informational only — see the note below. |
| `templates[]` | **yes** | A flat array. `{ "groups": [...] }` is *not* the shape; grouping is a field on each item. |
| `.name` | yes¹ | What the picker lists. |
| `.title` | no | Prefilled work-item title. |
| `.content` | no | Body, in Markdown. `{{date}}`, `{{var.team}}` etc. resolve on insert. |
| `.group` | no | Sub-heading within this source. Omit (or `""`) and the item sits directly under the source header, above any named group. |
| `.id` | no | Stable id. Omit it and one is derived from the content — but then editing an item makes it a "new" item, which loses the group-hidden preference someone set on it. Set ids for anything long-lived. |

¹ At least one of `name` / `title` / `content` must be non-empty; entries with all
three blank are dropped. An item with no `name` lists as `(untitled)`.

**`version` does not control freshness.** The extension stores whatever it fetched,
every time. That is deliberate: a version-gated cache means one forgotten bump
serves stale templates to the whole team, and this project shipped exactly that bug
once (`count: 11 / stored: 3`) before the check was removed.

Limits, enforced on download: **10 sources**, **200 templates** per source, **512 KB**
per response, **20,000 chars** per body, **300 chars** per name/title/group. Anything
over a cap is clamped or dropped, not rejected wholesale — one oversized entry never
costs you the rest of the file. (The response cap is what bounds a source on disk, so
10 × 512 KB is the storage budget — half of what `chrome.storage.local` holds.)

**If your source redirects, use the address it lands on.** Redirects are followed, but
templates are only accepted from an origin you granted — so a URL that hops to another
host reports `Redirected to <host>, which you have not granted` rather than syncing.
The common case is a Git host: `github.com/<org>/<repo>/raw/main/t.json` redirects to
`raw.githubusercontent.com`, so enter the `raw.githubusercontent.com` URL directly.

Group ordering follows first appearance in the file; ungrouped items come first.
Working example: [`examples/team-templates.json`](examples/team-templates.json) — the
26-template pack the "Try our example" button subscribes to, also translated in
[`examples/team-templates-ko.json`](examples/team-templates-ko.json). Fork it, serve it
from your own URL, and edit the templates to match how your team actually writes an issue.

## Built for self-hosted Plane, and it works on Plane Cloud

This extension was written for **self-hosted Plane**, and the same build runs on
**Plane Cloud** (`app.plane.so`). Either way it ships with **no active domain and no
host access**, so it does nothing until you add your instance (e.g.
`plane.your-company.com`, or `app.plane.so`) via the popup's **Enable on this site**
or the active-domains list in Settings — enabling a domain prompts Chrome for
one-time access to that one site. It stays completely inert on every other site.

The two draw the same screens with different classes, which matters only for the
presets that name one. Every preset that has needed a second shape now carries both,
and each is checked against a live instance of each generation before release —
because a rule that matches nothing is a no-op, which is indistinguishable from a
rule you switched off, which is how one of them stayed broken for a release.
Anything a preset misses is one selector edit, or one click of the element picker,
away — that is what the generic rule engine is for.

## Install

**From the Chrome Web Store (recommended)**

[Install Enhancer for Plane](https://chromewebstore.google.com/detail/dicjfphghjfljkifogkplgdeefjdkhbo),
then click the toolbar icon and **Enable on this site** on your Plane instance.

**Developer mode (from source)**

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. **Load unpacked** → select this project folder.
4. Click the toolbar icon → **Settings · Manage templates** to adjust domains,
   widths, and templates.

## Verified live (on both generations)

Each release is driven by hand on a self-hosted Plane 1.4 instance **and** on Plane
Cloud, because the two do not write the same page and a rule that matches nothing
fails silently. Measured 2026-08-09 unless noted.

- Injecting CSS on `.max-w-40` changes max-width from 160px to the configured
  value — confirmed applied. On Cloud it matches 35 elements on the work item list
  and none on the item page, which is the normal shape of a healthy rule.
- The **template button** appears beside the description toolbar's attach button on
  both — the anchor is found by walking up from the editor, and Cloud puts that
  button two levels further out than 1.4 did (10 vs within 8), which is why it was
  missing there for a release. One button per item, and never on the comment box.
- **Copy reference** resolves key, title and URL from the real page on both.
- The **search dropdown** preset matches Headless UI on 1.4 and Base UI on Cloud;
  the ⌘+K command palette and the create-work-item modal are deliberately not caught.
- The focus-mode presets hide the properties panel and the left navigation, and the
  description column takes the space back — confirmed on both self-hosted Plane 1.4
  and Plane Cloud (2026-08-08: on Cloud the body column went 1056px → 1658px, and the
  reading-width preset centred it at exactly `(1658 − 960) / 2` = 349px of gutter).
- Values are inserted into React-controlled search inputs via a native setter +
  `input` event — confirmed.
- The description editor is TipTap/ProseMirror (contenteditable) — confirmed, so
  template bodies are inserted as HTML via a synthetic paste (headings, lists, and
  checkboxes render as real nodes), with an `execCommand` text fallback.
- A single page mixes several width classes — confirmed, hence the generic rule
  engine.

## Structure

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest |
| `common.js` | Settings defaults / storage / domain matching / sync cache + normalization / i18n runtime (shared by the worker, content script, and pages) |
| `content.js` / `content.css` | Style-rule injection (including the focus-mode half) + template insertion UI + picker |
| `background.js` | Service worker: registers the content script on granted origins and reconciles on permission/settings changes; opens the options page; relays the focus-mode keyboard command to the tab in front. **The only file that may touch the network** — it fetches team templates on an alarm and caches them |
| `options.html/js/css` | Full settings page — the sections are grouped into tabs (Work items · Templates · Appearance · Sites · Backup · Shortcuts), still one form with one Save. Shortcuts is reference only: every key the extension answers to, for both platforms |
| `popup.html/js/css` | Toolbar popup (quick toggle · status · focus mode · picker · re-scan) |
| `_locales/` | `en` + `ko` message catalogues |
| `tools/` | Checks (not shipped) — see below |
| `examples/` | Sample team-template files (not shipped) |

## Checks

No dependencies, no build step — stock node:

```sh
node tools/test.js          # behaviour: sync engine, normalization, sections, counts
node tools/check-i18n.js    # translation contract (--strict in CI)
node tools/check-source.js  # architectural invariants
node tools/dom-harness.js   # the settings page, popup and content script, in a real browser
```

CI runs all four on every push and PR. `check-source.js` enforces what a reviewer
would otherwise have to remember — network access confined to the worker, no
`innerHTML` for data that isn't ours, every remote field clamped, a dark-mode
counterpart for every light surface, and that the release zip actually contains
every file the extension loads. `dom-harness.js` covers what is only true of a
real layout engine — which tab is showing, that an unsaved edit survives one, what
a label says, what a colour resolves to against the surface behind it, whether focus
mode actually hides the panel it aims at — by running the pages in headless Chrome
with a stubbed `chrome` API (the content script gets a synthetic work item page,
carrying the classes the shipped rules select on). It needs a browser
(`PE_CHROME=/path` to choose one); locally it skips loudly without one, and in CI
a missing browser is a failure rather than a quiet pass. Contributor rules live in
[AGENTS.md](AGENTS.md).

## How it works (notes)

- **No host access until you grant it.** There are no static content scripts.
  When you enable a domain, the extension requests that origin, and the service
  worker registers the content script + CSS for it via `chrome.scripting`
  (injecting any already-open matching tab so no reload is needed). Registration
  persists across restarts and is reconciled whenever permissions or settings
  change; removing a domain drops its access.
- **Sync is a worker + cache, not a live fetch.** `chrome.alarms` wakes the service
  worker (an MV3 worker is evicted when idle, so a timer would never fire), which
  fetches each due source, validates and clamps it, and writes it to
  `chrome.storage.local`. Everything else — picker, popup, settings — reads that
  cache. So inserting a template makes no request, works offline, and a source that
  is down or malformed leaves the last good copy in place with the error shown in
  Settings. Removing a source drops its cached templates immediately.
- **Styles are injected via `adoptedStyleSheets` (constructed stylesheets).**
  Plane is a Next.js/React SPA — inserting a `<style>` DOM node into
  `<head>`/`<body>` can trigger a hydration mismatch and get the node removed, so
  the rules disappear. `adoptedStyleSheets` are not part of the DOM tree, so they
  don't affect hydration and aren't removed. (Legacy fallback: a `<style>`
  directly under `<html>` re-inserted by a MutationObserver.)
- Rules are applied as user-specified `selector { property: value !important }`.
  Values have `;{}` stripped, property names pass a whitelist regex, and
  selectors are parse-validated.
- Settings are stored in `chrome.storage.sync` and applied live to open tabs on
  change. The content script's full-document observer is only connected on
  domains you've enabled — it stays disconnected everywhere else.
- **Language-independent anchoring.** The template button and title fill don't
  rely on UI text. The toolbar anchor is found structurally (the attach button
  wraps a hidden `input[type="file"]`, the same in every language) and the title
  is matched by its stable `#title-input` id — so it works on Plane in any UI
  language. Attach/첨부 text is kept only as a fallback.
- **Self-healing injection.** If Plane mounts the toolbar late and the button
  doesn't appear, it recovers without a reload: focusing the description editor
  (or pressing Alt/⌥+T) re-scans, and the popup's **↻ Re-scan this page** forces a
  fresh injection. If the content script never loaded at all (e.g. a tab opened
  before you enabled this domain), Re-scan reports it so you can reload.
- **Brand.** The popup and Settings follow Plane's monochrome tone (near-black
  `#121212` + white) and your system light/dark theme, so the extension's own
  surfaces do not look bolted on.

## Permissions

- `storage` — persists your own settings (domains, rules, templates, variables, copy formats,
  sync sources) and caches downloaded team templates on this device.
- `alarms` — wakes the service worker on your chosen interval to refresh team
  templates. An MV3 worker is evicted when idle, so a `setTimeout` would never
  fire; this is the only way to sync on a schedule. Chrome shows no install
  warning for it.
- `activeTab` — when you click the toolbar icon, the popup reads the current
  tab's hostname to show status and offer "Enable on this site," and messages the
  tab to start the element picker. Limited to the tab you invoked it on.
- `contextMenus` — adds one right-click entry, shown only when text is selected, that reads
  a work item key out of the selection and opens it. Chrome hands over the selected text; the
  page itself is never read, and the entry appears on no other kind of click.
- `scripting` — registers/injects the content script on the specific origins you
  grant (see below).
- **Optional host permissions, requested per site.** The extension ships with
  **no host access at all**. When you enable a domain (popup or Settings), it asks
  Chrome for access to *that origin only* — you see a permission prompt naming the
  site. It never requests all-sites access up front, holds access only for the
  domains you granted, and drops that access when you remove a domain. (A
  self-hosted Plane host isn't known at build time, so it can't be a fixed match
  list — this per-site grant is the least-privilege way to support any host.)
  A team-template source URL is granted the same way: adding one prompts for that
  origin, and the worker refuses to fetch a source whose origin you haven't granted.

No accounts, no tracking, no analytics, no remote code. The developer runs no
server and receives nothing from you; the only request the extension can make is
downloading the team-template file from a URL you configured yourself, and it
carries none of your data. See [PRIVACY.md](PRIVACY.md).

## Limits & constraints

- **Chrome / Chromium, Manifest V3** — not built for Firefox or Safari.
- **Self-hosted Plane, inactive by default** — no domain ships enabled; add yours
  in the popup or Settings. It never touches non-Plane sites.
- **Sync storage cap (~100 KB total, ~8 KB per item).** Both numbers are Chrome's
  and neither can be raised. Settings used to occupy a single item, so the 8 KB was
  the ceiling for everything; templates are now packed into their own items
  (`peTpl.0`, `peTpl.1`, …) and the ceiling is the 100 KB.

  Capacity is measured in **bytes**, not characters — a Korean character costs 3,
  an emoji 4, and `<` costs 6 because Chrome stores it escaped. So the honest answer
  is a range, measured rather than estimated:

  | | fits in 100 KB | longest single template |
  |---|---|---|
  | English, ~400 chars each | ~218 | ~8,100 chars |
  | Korean, ~400 chars each | ~81 | ~2,700 chars |
  | Markdown with inline HTML | ~160 | ~1,350 chars |

  **One template must still fit one 8 KB item** — nothing can split it further — and
  a save that breaks either ceiling is refused up front, naming the template or the
  setting responsible. The Settings page meters both. **Team templates don't count
  against any of this**: they live in `chrome.storage.local` (10 MB, 5 MB on
  Chrome ≤ 113; this device only), which is why sync is the way to carry a large
  shared library.
- **Synced templates are read-only.** They're edited at the source file, not in
  Settings. An edit here would be silently reverted by the next sync, so the UI
  doesn't offer one; hiding a group is local and does survive.
- **Markdown rendering depends on the editor** — template bodies are pasted as HTML
  so Plane renders headings/lists/checkboxes; if a build rejects the paste, it
  falls back to literal text.
- **Description templates only** — comment templates are not provided.
- **Rule values are sanitized** — values strip `;{}`, property names pass a
  whitelist, and selectors are parse-validated before injection.

## Publishing

Store listing copy (EN + KO), permission justifications, and the assets
checklist live in [store-assets/STORE_LISTING.md](store-assets/STORE_LISTING.md).
Screenshots and the promo tile are in `store-assets/`.

**Releases are cut automatically from the version in `manifest.json` — you never
tag by hand.** The workflow
[.github/workflows/release.yml](.github/workflows/release.yml) reads the version,
packages only the shipping files (store assets, docs, and `icons/icon.svg` source
are excluded), and publishes the Release.

To ship a new version:

1. Bump `"version"` in `manifest.json` (e.g. `1.1.0` → `1.1.1`).
2. Commit and push to `main`.
3. CI creates the `v<version>` tag and a GitHub Release with
   `enhancer-for-plane-<version>.zip` attached. If that version was already
   released, it skips — so an unrelated push never makes a duplicate.

You can also trigger it from **Actions ▸ Release extension ▸ Run workflow**.
Then download the zip from the Release and upload it in the Chrome Web Store
dashboard.

> If the release step fails with a 403, enable **Settings ▸ Actions ▸ General ▸
> Workflow permissions ▸ Read and write permissions** so the workflow can create
> tags and releases.

<details>
<summary>Build the zip locally instead (optional)</summary>

```sh
zip -r "enhancer-for-plane-$(jq -r .version manifest.json).zip" \
  manifest.json common.js content.js content.css background.js \
  options.html options.js options.css popup.html popup.js popup.css icons _locales \
  -x "icons/icon.svg"
```
</details>

## License

[MIT](LICENSE) © 2026 gaerae
