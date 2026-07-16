# Working on this repo

Rules for anyone changing this extension — human or AI. Everything mechanically
checkable already lives in `tools/`; this file only covers what a script cannot judge.

## Before you claim it works

```bash
node tools/test.js            # behaviour: sync engine, normalization, sections
node tools/check-i18n.js      # translation contract (--strict in CI)
node tools/check-source.js    # architectural invariants
```

CI runs all three on every push and PR. They are fast and have no dependencies —
there is no reason to skip them.

**Passing them is not the same as working.** Every one of them passed while the
picker was showing stale templates, because the bug was in data, not code. If you
changed anything a user sees, drive it:

- **Options page / popup**: serve the repo and open the page with a stubbed `chrome`
  (see "Driving the UI" below). Node cannot render CSS.
- **Picker (`content.js`)**: needs a page with a `.ProseMirror` element. The harness
  pattern is in this session's history; rebuild it rather than guessing.
- **The real extension**: load unpacked, then **reload the extension AND the tab**.
  A reloaded extension does not replace content scripts already running in open tabs,
  and `window.__peLoaded` blocks re-injection — so you will be testing old code and
  not know it.

## Invariants a script cannot check

**Do not couple to Plane's internals.** Plane's class names change between versions —
a single page mixes `max-w-40`, `max-w-48`, `max-w-[150px]`. That is why the extension
ships a generic "selector + property + value" engine instead of hardcoded rules, and
why the template button is found via structure (a button wrapping a file input) rather
than text. Anything that reaches into Plane's editor schema or DOM shape is a future
breakage. This is the project's core design principle; weigh it before adding features
that need it.

**Synced templates are read-only, and the UI must not pretend otherwise.** Edit and
delete affordances on synced content would be reverted by the next sync — a button
that appears to work and silently undoes itself. Hiding a group is fine (a local view
preference that survives sync); editing the content is not. Edits happen at the source.

**Remote data is authored outside our trust boundary.** Whoever controls a source URL
writes the strings the picker renders. `textContent` only, caps enforced before storage,
ids namespaced per source. `check-source.js` enforces the mechanical half; the judgment
half is: treat every new remote field as hostile until you have clamped it.

**Never trust undocumented behaviour.** Message substitutions use declared
`placeholders`, not bare `$1`, because neither Chrome's nor MDN's docs promise bare `$1`
works in a message body. If the documentation does not say it, do not build on it —
find the guarantee or pick the documented path.

**Store config and state separately.** `chrome.storage.sync` holds settings (~8 KB,
follows the user across devices). `chrome.storage.local` holds the fetched templates and
per-device sync status. Never put fetched content or timestamps in `sync`.

## Traps this codebase has already hit

Each of these shipped, or nearly did. They are now covered by tests — do not remove them.

- **Change detection on an author-supplied version.** A source edited without bumping
  `version` kept the old templates while the count updated: `count: 11 / stored: 3`.
  Store what you fetched; do not out-clever it to save one storage write.
- **A payload that parses but yields nothing** reported success. "Synced · 0 templates"
  looks fine while nothing arrives. A wrong shape must be an error that names what it
  found.
- **A raw NUL byte in a source file.** It parses, it runs, tests pass, git diffs it —
  and `grep` skips the whole file silently. Write control characters as escapes.
- **A migration gate keyed on shape** (`if (raw.rules) return raw`) blocked every future
  migration and froze the stored `schema` stamp. Gate on the version number.

## Conventions

- **Zero dependencies.** No `package.json`, no build step. Plain scripts loaded by the
  browser; `tools/` runs on stock node. Adding the first dependency is a project
  decision, not a drive-by.
- **`common.js` is shared** by the service worker (`importScripts`), the content script,
  and the extension pages. Anything added there must work in all three — including with
  `chrome` absent, which is how the tests load it.
- **User-facing strings go through `peMsg`** with a key in every locale. `check-i18n.js`
  fails the build on a hardcoded literal in a UI sink, a missing translation, a mismatched
  placeholder, or an inconsistent term (see its `GLOSSARY`).
- **A translation that passes the checker can still read badly**, and that part is on you.
  Every case below was live until someone sat and read the catalogue end to end:
  - Don't carry English grammar across. "read-only — edit them at the source" became
    `읽기 전용이며 소스에서 수정하세요`, which welds a statement to an imperative and is
    simply not a sentence. Split it.
  - Translate the meaning, not the word. "A flat list" became `평면 목록`, which says
    nothing in Korean; `중첩이 없는 단순한 목록` says what "flat" was there to say. Same
    for possessives — "each item carries its own X" is `항목마다 X를 넣습니다`, never
    `각 항목이 자신의 X를 가집니다`.
  - Keep one register per string. `아직 동기화 안 됨 — …누르세요` mixes a bare fragment
    with 존댓말 in one breath.
  - Sets must read as a set. `1시간마다 / 6시간마다 / 12시간마다 / 하루에 한 번` — the
    last one breaks a pattern the first three establish.
- **Only `background.js` may touch the network.** The picker reads the cache, so inserting
  a template costs no request and works offline.
- `examples/` and `tools/` are not shipped: `release.yml` zips an explicit allowlist.
  Add new shipped files there too — `check-source.js` walks what the extension actually
  loads (manifest entries, page `<script>`/`<link>`, the worker's injection lists) and
  fails if the zip would miss any of it, so you will hear about it before a release does.
