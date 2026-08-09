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
- **The search dropdown preset had stopped matching on Plane Cloud too.** Same rot as the
  focus presets below, one rule over, and reported as "this rule still says it never
  matched" — which it was right to say. Plane Cloud has moved its property dropdowns from
  Headless UI to Base UI; self-hosted 1.4 has not. Measured 2026-08-08 with the module picker
  open on each:

  | | `[id^="headlessui-combobox-options"]` | `[data-base-ui-portal] [role="dialog"]:has(input)` |
  |---|---|---|
  | self-hosted 1.4 | 1 | 0 |
  | Plane Cloud | 0 | 1 |

  So the selector is a union of both, Plane 1.4 first, and installs still carrying exactly
  what v7 shipped are repointed on first read — the same schema step as the focus selectors,
  because this is one release's worth of the same rot. A selector you edited is left alone.

  `:has(input)` is what keeps this a *search* dropdown rather than every popover — a plain
  menu has no search box. Two things it deliberately does not catch, both checked with them
  open: the create-work-item modal, and the ⌘+K command palette, which is `[role="dialog"]` at
  the full window width and sits outside the portal entirely.

  **Why nothing caught it:** the browser checks seeded a synthetic `.max-w-40` rule, so no
  shipped preset except the focus ones was ever driven in a browser. That page now starts
  from the oldest install there is — pre-schema `widths`, no rules — so every preset on it is
  one `peMigrate` built, and both dropdown generations are in the markup with the two decoys
  beside them.
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
- **"Restore defaults" now says that it also hands back site access.** It empties the domain
  list, and the next Save gives Chrome back the host permission for every site on it — so the
  extension goes dark everywhere and nothing on screen connects that to the button you
  pressed a minute ago. Found the hard way: a reset here took a working self-hosted instance
  offline and it read as a bug in the extension. The confirm now says three things — the site
  list empties, nothing happens until Save, and switching a site back on means approving it
  again.
- **A site switched on somewhere else is no longer un-switched by saving Settings.** Enable a
  site from the popup while the Settings page sits open with unsaved edits, and the page
  correctly refuses to adopt the change — it would throw away what you are typing. But its
  own list had never held that domain, so saving wrote the old list and revoked the origin:
  the site you had just turned on went dark. A domain that this page has never had on screen
  is one you cannot have meant to remove, so the save carries it across and says so. Removing
  a domain you *can* see still removes it, and Restore defaults still clears the list it just
  showed you.
- **A half-filled quick link could navigate somewhere real.** The chooser seeds a row holding
  `⟨host⟩` blanks by design, and nothing refused one: `new URL` reads `⟨host⟩` as the
  perfectly valid hostname `xn--host-fg5bk`, so saving without filling it in and pressing
  Enter opened that. `peIsHttpUrl` — the gate every navigation passes — now rejects a blank,
  and a link still holding one is not routed to at all, so the omnibox says "no quick link
  set" instead.
- **Searching from the popup with no search URL did nothing at all.** No tab, no message, no
  close — Enter simply looked broken, and that is the default state for a hand-added target
  and for Linear, whose search is not addressable. It opens Settings now, which is what the
  omnibox has always done in the same situation.
- **Two picker bugs, both cosmetic and both misleading.** A generated candidate could outscore
  a durable one and land mid-list, splitting "Recommended" into two headings with an expiring
  row between them; the sort now partitions on that flag before it looks at any score. And
  the React `useId` pattern was applied to class names, where a colon means a Tailwind
  variant — `dark:hover:bg-custom-background-90` was being demoted below the nth-child
  fallback and badged "may change". useId never reaches a class attribute, so that test is
  ids only.
- **Saving could swallow a permission failure.** When a save both carried across a domain
  enabled elsewhere and failed to get Chrome's grant for it, only the good news was shown —
  and the origin Chrome refused is exactly the one that was carried across.
- **The template button never appeared on Plane Cloud.** The biggest thing this extension
  does, missing on one of the two places it runs, for a release. It anchors on the
  description toolbar's attach button, found by walking up from the editor, and the walk
  stopped at 8 levels. Measured 2026-08-09 on a real work item in each generation: 1.4 puts
  that button within 8 of the editor, Cloud puts it at **10**. Two levels short, and nothing
  said so — a button that was never injected looks exactly like a page still loading.

  The ceiling is 12 now, and both sides of that number are load-bearing. It has to reach 10
  or Cloud stays broken; it has to stop short of **14**, which is where the *comment* box's
  attach button sits — raising it until Cloud worked would have put a template button on a
  comment, and a template fills a title a comment has not got. Comment templates are
  deliberately not a feature.

  This had no browser check at all, which is why a number tuned to one generation survived
  the other. It now has a page carrying an editor at each of those three depths, and setting
  the ceiling to 8 or to 16 fails it.
- **Copy reference read no title on Jira.** Plane and Linear write a tab title as
  `KEY title`; Jira writes `[TRASHSWD-17] ArgoCD apps-of-apps 배포 패턴 확인 - Jira`, and the
  brackets meant the key never matched, so the popup offered the key with an empty title. The
  key leads in all three and only Jira wraps it, so that is the one extra shape accepted. The
  trailing ` - Jira` is left alone deliberately: cutting a trailing ` - something` is a guess
  about titles rather than about keys, and it would eat the last words of a title that
  genuinely ends that way. It is on screen in the popup before anything is copied.

### New
- **Quick open remembers what you opened.** Its one real barrier was having to already know
  the key. The address bar now offers your recent jumps the moment the keyword is on screen
  and narrows them as you type; the same list is in the popup. Twelve entries, per device
  (`chrome.storage.local`) and never synced — waking up on another machine to someone else's
  browsing in your address bar is not a feature.
- **Words search instead of opening.** `issue login bug` goes to the tracker's search.
  Which one it is gets decided by shape — `PROJ-123` is a key and `login bug` is not — so
  there is no prefix, no mode, nothing to remember. Give a target a **search URL** carrying
  `{{q}}` in Settings; a target without one does not answer a search rather than guessing.
- **Open a work item from selected text.** A key almost never arrives as a key — it arrives
  in a Slack message or a PR title, "blocked by PROJ-123 until Friday". Select it and
  right-click → **Open work item from selection**. Chrome hands over the selected text; the
  page itself is never read, and the entry appears on no other kind of click. This adds the
  `contextMenus` permission, which shows no install warning.

  Documented on the Quick open card as well as the Shortcuts tab. It shipped explained
  only on Shortcuts, which is a different tab from the one you are on while setting
  Quick open up — so the way in that needs no key at all was the one you had to go
  looking for. The card now names all four: the address bar, the popup, the recents
  both offer, and the right-click.
- **Copy reference from the toolbar popup**, when the tab you are on is a work item. It reads
  the tab's address and title and nothing else — no injection, no page access — so it works
  wherever Quick open has a link, and the block is absent rather than inert when the tab is
  not an item. It does not replace the in-page button: it cannot see into the panel a list
  opens, because there the address bar and the title both still name the list.
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

### Improved
- **The popup can no longer be widened by its own contents.** Chrome sizes a toolbar popup to
  the document, so a long work item title or format name could make it open far wider than it
  should — measured at 1132px against a 260px design. The width is now a property of the
  popup rather than a result of what is in it.
- **Rule health no longer accuses a rule that watches something transient.** It sampled once
  per route, so a rule pointing at a dropdown, a menu or a modal was never looked at while
  its target existed. The shipped "search dropdown width" preset is the example: on
  self-hosted 1.4 its selector matches 0 elements with the module picker closed and 1 with it
  open, so every routine sample missed it and Settings called a working preset dead. A second
  sampling now runs shortly after a click, when transient UI is up, and records **hits
  only**: it can promote a rule to working and can never move one toward "never matched".

  This was first written up as "and that is why the dropdown preset looks dead on Plane
  Cloud", which was wrong — on Cloud the old selector matched nothing whether the dropdown
  was open or not, because Plane had changed the markup. Two faults with one symptom; see the
  Fixed entry above for the other. The sampling fix stands on its own and is why the
  self-hosted case reports correctly.
- **Adding a quick link starts from an example, not an empty box.** The empty box is where a
  wrong URL got typed, and none of those mistakes are detectable afterwards. The Add button
  now offers starting points: one row per site you have already added, with the host filled
  in, then Plane, Jira, Linear, GitHub and GitLab. Picking one fills both URLs and selects
  the first part you still have to replace — `⟨workspace⟩`, `⟨site⟩` — so the next keystroke
  overwrites it. An empty row is still one click away.

  Every shape was opened in a browser on 2026-08-08, and every search URL was checked against
  a nonsense query as well as a real one, because a search that ignores its parameter and
  shows the whole list looks exactly like one that works. Jira, GitHub and GitLab return real
  results. Plane fills its search box without running the search, and Linear has no
  URL-addressable search at all — both say so on the row rather than being left out, since an
  example that quietly underdelivers reads as the extension being broken. GitHub and GitLab
  number their issues rather than keying them, so those two arrive with a prefix and spend it:
  you type `GH-1234` and `{{key.num}}` puts `1234` in the URL.
- **Or paste an address and skip the choosing.** A list of five still asks you to recite your
  tracker's URL shape from memory, and reads as "these five are supported" — the opposite of
  what a generic quick link is for. So the chooser opens with a box: paste any work item's
  address and the template falls out of it. A known shape is recognised and **both** URLs are
  filled from it, search included, with nothing left to type —
  `https://gprxh.atlassian.net/browse/DU-61` becomes the Jira pair for *your* site. A tracker
  nobody listed still works: the last key-shaped segment of the path becomes the token and
  everything after it is dropped, so `https://redmine.example.org/issues/45231` yields
  `…/issues/{{key.num}}` and asks you for the one thing it cannot know — a prefix to type
  before the number. An address with nothing key-shaped in it is refused and says so, because
  a template built from a settings page opens the wrong address forever and nothing later can
  notice.

  Three smaller things in the same panel. Each row now shows the **search** address it will
  also fill, since picking a row was filling two fields and showing one. A line at the top
  says which braces are which — `⟨…⟩` is yours, `{{key}}` is ours — which until now you had to
  work out. And **Tab walks the remaining blanks** before it goes anywhere else, across both
  URL fields; GitHub's shape leaves four, and the other three were being dragged over by hand.
  Once none are left, Tab is Tab again.
- **The popup stays inside the window Chrome gives it, and says when there is more.** Chrome
  caps a toolbar popup at 600px tall and cuts the rest without a word. Recents, the copy block
  and the search field had taken it to 606px on an ordinary work item tab and 761px with every
  block showing — so **Settings**, the one control worth reaching from any state, was the part
  below the line. And macOS hides overlay scrollbars at rest, so nothing on screen said there
  was a below.

  The popup is now a column: the header and a footer holding the template count and Settings
  are pinned, and everything between them scrolls in a bounded box. Its scrollbar is styled,
  which opts it out of overlay mode so the track is visible the whole time it overflows, and a
  shadow appears at whichever edge has content behind it — two pairs of CSS gradients, one
  scrolling with the content and one fixed, so there is no scroll position for a script to keep
  in sync. A short popup stays short: `max-height`, not `height`.
- **"Try our example" gives a Korean reader the Korean pack.** Both packs have shipped since
  v1.6 and the button handed everybody the English file, so a Korean user's first look at
  sync was 26 templates in a language they had not chosen — the one surface left speaking
  only English. The UI language picks the file, matched as a prefix so `ko`, `ko-KR` and
  `ko-Kore-KR` all count and Konkani (`kok`) does not. Either file counts as "you already
  added the example", so switching Chrome's language cannot leave you subscribed to two
  copies of one feed.
- **Shortcuts says why the address-bar keyword is not a setting.** `issue` looks like one,
  because Chrome lists it under Search engines → Extensions — but an extension declares its
  keyword in its manifest and there is no API to change it, and that row's own menu offers
  only Manage and Deactivate (checked on Chrome 151, not assumed). Nor can there be a second
  one to sit beside it: `"keyword": ["issue", "pi"]` is refused at load with *Type is
  invalid. Expected string, found list*, and `"issue pi"` is accepted but registers as the
  single keyword `issuepi`. One extension, one word. So the tab says so, and points at
  Chrome's Site search on the same page for anyone who wants a shorter one, with what that
  costs: one fixed address, no prefix routing, no recents, no search fallback.
- **A quick link says when its URL looks like an API address.** Plane's search *page* is
  `/{workspace}/search/?q={{q}}`; the `/api/…/search/?search=…` behind it returns JSON, and
  pasting that opens raw JSON in a tab. Nothing downstream can tell the difference — it
  loads, it returns 200 — so the row where it is typed is the only place to say anything. A
  hint, not a refusal.
- **Omnibox rows say what they are, in one shape.** They were indistinguishable from Chrome's
  own history, and the omnibox API has no way to put an icon on a row — the only icon an
  extension gets there is the one in the address bar, once the keyword is active. So every
  row now leads with a label: `Open · PROJ-123 · Plane`, `Search · Plane · "login bug"`,
  `Recent · PROJ-123 · Plane`. The labels are ordinary translated messages, so changing one
  (adding an emoji, say) is a catalogue edit rather than a code change.
- **The element picker now offers stable selectors first, and marks the ones that expire.**
  It ranked on one axis — "is this a Tailwind width class" — which says nothing about the
  question that decides whether a rule survives: did a person write this handle, or did a
  build step generate it? A hashed class sat at the top of the list looking like any other.

  Two things changed. **Attribute selectors are generated at all**, which they were not:
  `[data-view-id]`, `[aria-label="Issue description"]`, and — for an id with a generated tail
  — the `[id^="…"]` prefix form the shipped dropdown preset had to be written by hand. And
  anything that looks build-generated is demoted: hashes (`sx-3nfvp2`), uuids
  (`editor-container-d833e58d-…`), CSS-module names, counters, and React's `useId` values
  (`headlessui-menu-button-:r1b:`, `radix-:r1e:`). Demoted, not hidden — it is a guess about
  someone else's markup, so being wrong costs a position rather than an option.

  **The list says all of this in words, on every row.** Three tries were needed. A dimmed
  row reads as the normal colour ("I thought grey was the default"). An amber badge on the
  demoted rows, and then two group headings — "Recommended — a handle someone wrote" and
  "May change — generated by the build" — both only render when a demoted row exists, and on
  ordinary Plane markup none does: a body element carrying nothing but Tailwind yields four
  candidates, all durable, one heading, nothing to compare it against. So each row now
  carries its own verdict, **lasts** or **may change**, next to what kind of handle it is
  (id, id prefix, data attribute, label, class, tag + classes, position — computed since the
  picker was written and never shown). The headings and the grouping stay; they are no
  longer the only thing carrying the ranking.

  Some hashes have no digit in them and nothing tells `sx-euugli` from `bg-white` in
  isolation, so one signal is measured from the page instead: a prefix carrying an
  implausible number of distinct classes is a hash namespace. Measured 2026-08-08 —
  Linear's `sx` covers 862 classes on an issue page; the largest utility prefix on a Plane
  Cloud work item is `text` at 33. Over both real pages the finished detector flags 908 of
  Linear's 937 classes (the 29 it leaves are genuinely authored — `ProseMirror`, `editor`,
  `heading-node`) and **none** of Plane Cloud's 515.

### Internal
- **`tools/dom-harness.js`'s synthetic Plane page carries two generations of the markup**,
  1.4 and Cloud, plus a decoy for each. A page that carries one generation cannot notice
  when the other stops matching; that is the whole failure above. Reverting either half of
  the selector now fails three assertions.
- **The harness builds its pages with replacer functions, never replacement strings.** It
  substitutes a whole message catalogue and a whole suite body into each page, and
  `String.replace` reads `$&`, `` $` ``, `$'` and `$1` in a replacement *string* as
  instructions. A catalogue entry containing `$NAME$'s` expanded `$'` into the rest of the
  file and truncated the page mid-string; 32 assertions across 6 pages then failed with
  messages about tab state and preview text, none of which was wrong. A guard now asserts
  `buildPage` has no string substitutions left in it.
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
