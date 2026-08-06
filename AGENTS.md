# Working on this repo

Rules for anyone changing this extension — human or AI. Everything mechanically
checkable already lives in `tools/`; this file only covers what a script cannot judge.

## Before you claim it works

```bash
node tools/test.js            # behaviour: sync engine, normalization, sections
node tools/check-i18n.js      # translation contract (--strict in CI)
node tools/check-source.js    # architectural invariants
node tools/dom-harness.js     # options.html + popup.html in a real browser
```

CI runs all four on every push and PR. They are fast and have no dependencies —
there is no reason to skip them.

`dom-harness.js` needs a Chrome or Chromium on the machine (`PE_CHROME=/path` to
point it at one). Locally it skips loudly when there is none; in CI, where the
runner has Chrome, a missing browser is a failure — a check that quietly ran
nothing is worse than no check. It generates its pages into a temp dir, forces the
dark blocks on by rewriting the media condition in a copy of the stylesheet, and
uses `--dump-dom --virtual-time-budget` so timers and transitions settle
deterministically instead of being slept on. A suite can ask for either locale
(`lang: "ko"`), which is not about parity: Korean strings are longer and break
differently, and the header that wrapped in Korean at full width fit perfectly in
English. Reach for it whenever a layout has to hold text it did not choose.

Do not give it `--user-data-dir` unless you have measured it on your platform: a
fresh profile directory never finishes initialising on macOS and every launch hangs.

**Passing them is not the same as working.** Every one of them passed while the
picker was showing stale templates, because the bug was in data, not code. If you
changed anything a user sees, drive it:

- **Options page / popup**: add the case to `tools/dom-harness.js` — that is what
  it is for, and it turns a one-off check into one that runs forever. Reach for a
  hand-served page with a stubbed `chrome` (see "Driving the UI" below) only while
  exploring. Node cannot render CSS.
- **Style rules and focus mode (`content.js`)**: `buildPlanePage` in the harness serves a
  synthetic work item page — the classes and the id the shipped rules select on, and no more
  than that. Extend that markup rather than mocking Plane. It is also the only check that
  a selector we ship still matches the class Plane writes, escaping and all: a probe element
  carrying `min-w-[300px]` proves `.min-w-\[300px\]` in one direction that no data test can.
  Keep the positive and negative cases on one page — `settings` arrives asynchronously, and
  while it is null the script reports "not active" for the same reason an unenabled site does,
  so a suite that opens on an inactive site cannot tell a refusal from a slow start.
- **Picker (`content.js`)**: needs a page with a `.ProseMirror` element. The harness
  pattern is in this session's history; rebuild it rather than guessing.
- **Copy reference (`content.js`)**: needs an item header — a `#title-input` next to a
  leaf `<button>` whose text is a key — and, for the peek-panel path, a second harness
  page on a list route (`…/issues/`) whose panel a mousedown outside it tears down. The
  value-level pieces (`peItemUrl`, `peExpandCopyFormat`, the snapshot contract) are in
  `tools/test.js`; the DOM timing is only provable in a browser.
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

**Never drive Plane's own UI state; put the change in our own layer.** Focus mode wants the
work item's properties panel gone, and Plane already has a flag for exactly that
(`issue_detail_sidebar_collapsed` in `localStorage`, `toggleIssueDetailSidebar` in its theme
store). Reaching for it is the wrong instinct twice over: nothing in Plane's UI sets it, so it
is undocumented internal state, and on a work item's own page Plane's own resize effect writes
`false` back over it above 768px — the feature would spend its life losing an argument. A rule
in our stylesheet cannot be argued with, works the same on Jira and Linear, and degrades to a
no-op instead of a fight when the markup moves. Same conclusion for "just mirror whatever
Plane's left-sidebar toggle did": one keystroke doing both is a fine outcome, but it is ours
to implement, not theirs to be observed.

**A shortcut you need while typing is a `chrome.commands` entry, not a key handler.** Alt+T and
Alt+C live in `content.js` because they act on the element under the cursor; focus mode does
not, and it is reached mid-sentence while writing a description. In the page that is a
contradiction — on macOS `⌥`+letter *is* a character, so an in-page handler either eats it or
has to bail out while the user is typing, which is precisely when they wanted it. A command is
intercepted by Chrome before the page, needs no permission, and is rebindable at
`chrome://extensions/shortcuts`, which no in-page handler can offer. The worker relays it to
the tab; a tab with no content script simply does not answer, and that is the whole handling.

**Per-tab state does not go in `chrome.storage.sync`, and settings are not per-tab.** Focus
mode is a moment, so it lives in the page's `sessionStorage` — that tab, that origin, surviving
a reload, gone with the tab. Syncing it would hide a properties panel on a second machine for
someone who never asked and has no way to know what did it. The mirror-image rule matters as
much: which rules *belong* to focus mode is a setting (the `focus` flag on a rule), and it goes
to sync like everything else.

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

**Store config and state separately.** `chrome.storage.sync` holds settings (~100 KB
total, follows the user across devices). `chrome.storage.local` holds the fetched
templates and per-device sync status. Never put fetched content or timestamps in `sync`.

**Settings span several sync items.** The per-item cap is ~8 KB and the total is ~100 KB,
so templates are packed into `peTpl.0`, `peTpl.1`, … and the core item stamps how many
there are. Two consequences bite anything that touches storage: a settings change is not
`changes[PE_STORAGE_KEY]` any more (ask `peSettingsChanged`), and sizes are **bytes**, not
string length — a Korean template costs three times what `.length` suggests. Everything
still reads and writes through `peGetSettings` / `peSaveSettings`; keep it that way.

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
- **State read before an `await` is stale after it.** A sync run kept the settings it read
  before the fetch. While it was on the network the user deleted a source, the prune
  removed it — and the run's write-back put it straight back, templates and all. Nothing
  showed it, because the picker reads settings rather than the cache. Re-read after the
  await and decide against that; never write a whole snapshot back over newer state.
- **Reporting "already running" and returning zeroes.** The counts were real numbers, so
  the caller rendered them: a green "Synced 0 source(s)" while a sync was in fact running,
  and — because the permission grant starts a run before Save writes settings — a source
  the user had just added was fetched by neither run. If a caller cannot act on a status,
  do not invent one: queue the work and hand back a real result.
- **A cap in the wrong unit, checked too late.** `text.length` counts UTF-16 code units
  and the limit was named `maxResponseBytes`, so a Korean feed passed at ~3x; and
  `resp.text()` had already buffered the whole stream before the check could run, which is
  no cap at all for a chunked response. Count bytes, and count them as they arrive.
- **One save, two storage events.** Templates live in their own items, so a save that
  needs fewer of them writes and then prunes — two operations, two `onChanged` events.
  The settings page absorbed exactly one as "my own save", so the prune read as somebody
  else's edit and it announced "Loaded the rule added by the picker" straight after
  "Saved.", about the user's own deletion. Chrome does not promise the event arrives
  before the `set` callback either, so nothing here may lean on ordering.
- **A backfilling merge turns "none" into "the defaults".** `peDeepMerge` fills an absent
  array from `PE_DEFAULTS`, which is right for a new install and wrong for a user who
  deleted everything. Reading the shard count as `n > 0` instead of `n >= 0` handed those
  users the two sample templates back on every load — and the test passed anyway, because
  the compatibility mirror happened to hold the same empty list. Assert the rule against
  the assembler directly, not through whatever else agrees with it today.
- **New default content has two homes, and only one of them is obvious.** `PE_DEFAULTS`
  serves a fresh install; every existing one has the array already, so `peDeepMerge` will not
  backfill into it and the migration has to append. Ship a preset to one of the two and half
  the users never see it — which is invisible, because whichever half you are is the half that
  works. The focus presets are asserted equal from both sides; do the same for the next ones.
  Appending in a migration is only allowed because those ids never existed before: it is new
  content, not the resurrection above, and once the stamp moves a deletion is final.
- **A percentage in `padding` measures the containing block, not the element.** The
  reading-width preset centres a column with `padding-inline: max(2.25rem, (100% - 60rem) / 2)`,
  which is right in Plane (the column is the flex child filling its parent) — but the first
  assertion for it set a width on the probe itself, read back the 2.25rem floor, and would have
  passed on a value the engine had thrown away entirely. If a check on a computed value can be
  satisfied by the fallback, it is not checking the value. Nest the probe.
- **An Alt-letter shortcut in a capture-phase handler eats that letter.** `onKeyDown` is
  registered with capture `true` and calls `preventDefault`, so a shortcut keyed on
  `e.code` fires before the page — and on macOS `Option`+a letter IS a character (`⌥C` =
  "ç", `⌥N` = "ñ", `⌥E` = an accent). Alt+C shipped hijacking "ç" out of a title or body.
  Gate any such shortcut on `isEditingText()` unless typing over it is the actual intent:
  Alt+T is exempt because you open the template menu *while* editing the description;
  Alt+C is not, because you never copy a reference mid-word.
- **The peek panel closes the moment you mousedown outside it.** Our copy menu is
  appended to `<body>`, outside the panel, so clicking a format fires a mousedown Plane
  reads as an outside click — it tears the panel down, `#title-input` and all, before the
  click handler runs. `copyReference` used to re-read the item at click time and got
  `null`, so a copy from a peek panel always failed with "no item here". The fix is to
  snapshot the item when the menu opens (panel still up) and copy from that, never from a
  fresh read. `stopPropagation` on the menu-item mousedown keeps the panel from flickering
  shut, but that is polish layered on Plane's event wiring; the snapshot is what makes the
  copy correct regardless. Verified against real Plane: an outside mousedown removes
  `#title-input` within one frame.
- **The peek panel keeps the list's URL.** Clicking a row opens a panel with the same
  header as the item's own page — same `#title-input`, same key button — but the address
  bar still says `/projects/{uuid}/issues/`, with no query, no hash, and no link to the
  item anywhere inside the panel. So anything derived from the URL has to be composed
  there (`/{workspace}/browse/{KEY}`, which is what Plane redirects to). Composition is
  the only part of the copy feature that could go wrong silently rather than visibly;
  `peItemUrl` says so and is where to look first against a new Plane version.
- **A work item key is not `ABC-123`.** A project identifier can be all digits — a
  Plane project can have one, so a key can read `42-7`. Any regex anchored
  on letters silently matches nothing there. The same measurement killed the branch-name
  "title slug": Korean and emoji titles slug to the empty string, so the feature would
  have worked for English titles and quietly produced `feature/proj-123-` for everyone
  else. Read the key from the URL, which Plane already guarantees.
- **`redirect: "manual"` cannot tell you where you went.** It reads like the safe choice
  and is not: Chrome hands back an opaque response — status 0, no headers, no `Location` —
  so you cannot follow it, report it, or even say it happened. Follow the redirect and
  check the origin you landed on.

The harness has its own traps, and they are worse, because a broken check is a check that
lies:

- **A hanging test is indistinguishable from a passing one.** Nothing fails: node runs out
  of work, exits 0 and prints nothing, so CI reports green having run no assertions.
  `tools/test.js` catches this in `beforeExit` and names the test — do not remove it.
- **A stub that offers more than production uses.** The fetch stub still had `text()` after
  the worker moved to streaming, so an implementation that buffered the whole body passed
  the byte-cap tests without ever reading a chunk. Expose what the code actually calls.
- **A test that only acts after the work is done.** "deleting a source drops its cached
  templates" asserted the exact property the resurrection bug broke, and stayed green the
  whole time — because it deleted only once the sync had finished. Everything a user does
  happens mid-flight. Drive that window: hold a fetch open and act while it is in the air.

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
- **Korean needs `word-break: keep-all`.** CSS breaks CJK at any character, which is right
  for Chinese and Japanese and wrong for Korean: every description on the settings page was
  splitting an 어절 down the middle ("폭 조 / 정 규칙"). Both `options.css` and `popup.css` set
  `keep-all` with `overflow-wrap: break-word` as the escape hatch for a token longer than the
  line. The harness measures it per tab by reading back where the layout actually broke, so a
  new surface that sets its own `word-break` fails there rather than shipping.
- **Tab order lives in three places** — the nav buttons and the panel divs in `options.html`,
  and `PE_TABS` in `options.js`. Only the buttons are visible; a panel out of step breaks the
  focus order and a `PE_TABS` out of step breaks the arrow keys and the landing tab, neither
  of which looks broken. The harness reads all three back against each other.
- **Store copy quotes real labels.** `store-assets/STORE_LISTING.md`'s Korean section told
  readers to click "Pick element" and "Enable on this site" — the English buttons. `test.js`
  now holds every quoted label in an imperative sentence against that locale's catalogue.
  The same file's detailed description is one sentence per line on purpose: the store keeps
  the newlines literally, so that is what makes it scannable.
- **Template bodies are only as rich as `mdToHtml`.** It handles headings, `-`/`1.` lists,
  `- [ ]` task lists, `---`, and inline bold/italic/code — nothing else. Everything it does
  not know becomes a paragraph of literal characters, so a markdown table pastes as rows of
  pipes and a ` ``` ` fence pastes as backticks. Both shipped once, written by someone
  reasonably reading the file as generic markdown. `tools/test.js` now rejects tables,
  fences, blockquotes, images and links in `examples/*.json`; if you teach `mdToHtml` a new
  construct, take it off that list in the same change. `examples/team-templates.json` and
  `-ko.json` are one pack in two languages — same ids, same order, enforced by the same test.
