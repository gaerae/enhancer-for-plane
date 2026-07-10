# Enhancer for Plane — Projects, Wiki & Issues

**English** · [한국어](README.ko.md)

A lightweight, unofficial Chrome extension (Manifest V3) for
[Plane](https://github.com/makeplane/plane) (makeplane / plane.so) — the
open-source **project management, issues & wiki** tool and a self-hosted
alternative to Jira. It fixes small day-to-day annoyances directly in the Plane
UI, with **no changes to your Plane server**, applied only on the domains you
enable.

> Not affiliated with or endorsed by Plane. "Plane" is a trademark of its owner.
> (And no — nothing to do with airplanes.)

Brand: follows Plane's monochrome tone (near-black `#121212` + white).

![A native Template button fills a work item's title and body in one click](store-assets/screenshot-1-templates.png)

## Features

1. **Body templates (title + body)** — register reusable templates and insert
   them in one click. The biggest gain over stock Plane.
   - A native **"Template" button is added right next to "Attach"** in the
     description toolbar (last item in the row, equal spacing, document icon).
   - Works in the **"Create work item" modal** too — that editor has no toolbar,
     so the "Template" button appears in the modal header, next to the project
     selector (an item-level spot, since a template fills title + body).
     `Alt/⌥+T` works in both places.
   - Selecting one fills the **work-item title** (`#title-input` textarea in the
     detail view, or the modal's `#name` title input) and the **body**
     (ProseMirror) together. The title is optional.
   - Template bodies are **Markdown, rendered into the editor** — `##` headings,
     `-`/`1.` lists, `- [ ]` checkboxes, `**bold**`, `` `code` ``. Because Plane's
     editor is WYSIWYG, the markdown is converted to HTML and inserted via a
     synthetic paste (ProseMirror parses it into real nodes); if the editor
     doesn't accept it, it falls back to literal text.
   - Even when Plane re-renders the toolbar, a `MutationObserver` (plus a short
     bootstrap poll) re-inserts the button. The button is cloned from Attach so
     it always looks native. (Comment templates are not provided.)
2. **Template variables** — substituted on insert: `{{date}}` (today,
   `YYYY-MM-DD`), `{{date+N}}` / `{{date-N}}` (N days from today, e.g.
   `{{date+7}}` for a deadline), `{{week}}` (this week's range,
   `YYYY-MM-DD ~ YYYY-MM-DD`, Monday–Sunday), and `{{month}}` (`YYYY-MM`). Open
   the template menu while editing a description with `Alt/⌥+T`.
   On macOS, Option+T changes `e.key` to a special
   character, so the shortcut is detected via `e.code === "KeyT"`.
3. **Style rules (width / length) — a generic engine**
   - Freely add / edit / delete `selector + property + value` rules. Each rule is
     injected as `selector { property: value !important; }`.
   - Type the full value with units, e.g. `320px`, `30rem`, `55ch`. Selector
     validity is checked live.
   - Built-in default: module / item name width `.max-w-40` → 320px. "Quick add"
     chips seed two more in one click: the module search dropdown, and the
     cycle / breadcrumb name width (`.max-w-[150px].truncate` → 320px).
   - The same truncation isn't module-only. Plane reuses one Tailwind
     "max-width + `truncate`" pattern across **modules, cycles, labels, and the
     breadcrumb path**, just with different caps (`max-w-40` / `max-w-48` /
     `max-w-[150px]`). Because it's a generic engine, you widen any of them the
     same way — add a rule (or use the picker, which escapes bracketed classes
     like `max-w-[150px]` for you). If class names shift between versions, you
     only edit the selector.
4. **Visual element picker** — click **"Pick element → add rule"** in the popup,
   then click any element on the Plane page. A **candidate selector list**
   appears (individual classes / full / id, each with a match count, width
   classes ranked first) so you can choose the right one. The picked rule is
   added to Settings (with an empty value → set the value there and apply). Build
   width/style rules without DevTools.
   - When the picker adds a rule, an open Settings page reflects it
     automatically (via `chrome.storage.onChanged`, unless you have unsaved
     edits).
   - During picking, press events are suppressed with `stopPropagation` only
     (not `preventDefault`, which would cancel the click and break the picker).
5. **Active domains** — runs only on the domains you specify. Wildcards
   (`*.example.com`) and a "run on all sites" switch are supported.
6. **Backup (Import / Export)** — export all domains, rules, and templates to a
   JSON file from the "Backup" section, and import them back. Imported settings
   load into the form — review, then `Save` to apply.

## Built for self-hosted Plane

This extension targets **self-hosted Plane**. It ships with **no active domain and
no host access**, so it does nothing until you add your instance (e.g.
`plane.your-company.com`) via the popup's **Enable on this site** or the
active-domains list in Settings — enabling a domain prompts Chrome for one-time
access to that one site. It stays completely inert on every other site.

## Install (developer mode)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. **Load unpacked** → select this project folder.
4. Click the toolbar icon → **Settings · Manage templates** to adjust domains,
   widths, and templates.

## Verified live (self-hosted Plane instance)

- Injecting CSS on `.max-w-40` changes max-width from 160px to the configured
  value — confirmed applied.
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
| `common.js` | Settings defaults / storage / domain matching (shared) |
| `content.js` / `content.css` | Style-rule injection + template insertion UI + picker |
| `background.js` | Service worker: registers the content script on granted origins and reconciles on permission/settings changes; opens the options page |
| `options.html/js/css` | Full settings page |
| `popup.html/js/css` | Toolbar popup (quick toggle · status · picker · re-scan) |

## How it works (notes)

- **No host access until you grant it.** There are no static content scripts.
  When you enable a domain, the extension requests that origin, and the service
  worker registers the content script + CSS for it via `chrome.scripting`
  (injecting any already-open matching tab so no reload is needed). Registration
  persists across restarts and is reconciled whenever permissions or settings
  change; removing a domain drops its access.
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

## Permissions

- `storage` — persists your own settings (domains, rules, templates).
- `activeTab` — when you click the toolbar icon, the popup reads the current
  tab's hostname to show status and offer "Enable on this site," and messages the
  tab to start the element picker. Limited to the tab you invoked it on.
- `scripting` — registers/injects the content script on the specific origins you
  grant (see below).
- **Optional host permissions, requested per site.** The extension ships with
  **no host access at all**. When you enable a domain (popup or Settings), it asks
  Chrome for access to *that origin only* — you see a permission prompt naming the
  site. It never requests all-sites access up front, holds access only for the
  domains you granted, and drops that access when you remove a domain. (A
  self-hosted Plane host isn't known at build time, so it can't be a fixed match
  list — this per-site grant is the least-privilege way to support any host.)

No accounts, no tracking, no analytics, no external servers, no remote code. See
[PRIVACY.md](PRIVACY.md).

## Limits & constraints

- **Chrome / Chromium, Manifest V3** — not built for Firefox or Safari.
- **Self-hosted Plane, inactive by default** — no domain ships enabled; add yours
  in the popup or Settings. It never touches non-Plane sites.
- **Sync storage cap (~8 KB).** All settings (domains + rules + templates) live in
  a single `chrome.storage.sync` item, which Chrome caps at ~8 KB — roughly a
  couple dozen typical templates. The Settings page shows a live storage meter and
  warns before you hit it; if a save fails, shorten/remove templates or keep a
  JSON backup (Export). Settings sync across your signed-in Chrome devices.
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
