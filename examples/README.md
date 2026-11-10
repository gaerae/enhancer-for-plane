# Team template file format

The JSON a template sync source serves, and the two packs in this folder that follow it.

Host a JSON file anywhere your team can reach over `http(s)` — an intranet path, a
Git host's raw URL, an S3 bucket. Add its URL in Settings ▸ Templates ▸ Template sync.

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
| `schema` | no | The format's version. **Share with your team** writes `1`; sync does not read it. |
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

**Bodies are the Markdown the inserter renders**, not Markdown at large: headings, `-`/`1.`
lists, `- [ ]` checkboxes, `---` rules, bold, italic and inline code. A table, a code fence,
a link, an image or a blockquote pastes as its literal characters.

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

## The packs in this folder

[`team-templates.json`](team-templates.json) is the 26-template pack the "Try our example"
button subscribes to, and [`team-templates-ko.json`](team-templates-ko.json) is the same pack
in Korean — same ids, same order. Fork it, serve it from your own URL, and edit the templates
to match how your team actually writes an issue.

Neither file ships in the extension; it fetches them from this repository like any other
source. `tools/test.js` holds both to the rules above, including the Markdown subset.
