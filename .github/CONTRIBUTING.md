# Contributing

**The rules live in [AGENTS.md](../AGENTS.md), and this file is a pointer to it, not a
second copy.** That is deliberate: two documents that almost agree are how they start
disagreeing, and the one that gets updated is never the one you happened to read. If you
want to change how this repo works, change AGENTS.md.

So this page only answers "where do I start".

## Before you claim it works

```bash
node tools/test.js            # behaviour: sync engine, normalization, sections
node tools/check-i18n.js      # translation contract
node tools/check-source.js    # architectural invariants
node tools/dom-harness.js     # options.html + popup.html in a real browser
```

No dependencies, no build step, no `package.json` — stock node. CI runs all four on every
push and pull request, so there is nothing to gain by skipping them.

`dom-harness.js` needs a Chrome or Chromium on your machine; `PE_CHROME=/path` points it at
one. Without a browser it skips loudly rather than passing quietly.

**Passing them is not the same as working.** Every one of them passed while the template
picker was serving stale templates, because the bug was in data rather than in code. If you
changed something a user sees, drive it — and add the case to `dom-harness.js` so it stays
driven. AGENTS.md's "Before you claim it works" says which surface needs which kind of check.

## Running it

Load unpacked at `chrome://extensions`, then **reload the extension and the tab**. A
reloaded extension does not replace a content script already running in an open tab, so
without the second reload you are testing the old code and cannot tell.

## Opening a pull request

Copy-only changes — wording, docs, store text — go straight to `main`. Open a PR when
behaviour, the schema, permissions or `manifest.json` change. A `manifest.json` change makes
the merge a store release, and that deserves a last look. The PR template lists what to
check before asking for one.

## Things that will come up in review

These are the ones that catch people, in full in AGENTS.md:

- **Do not couple to Plane's internals.** Plane's class names change between versions, which
  is why the extension ships a generic rule engine rather than hardcoded selectors and finds
  the template button by structure rather than by its text.
- **All user-facing text goes through `peMsg`**, with a key in both `en` and `ko`.
  `check-i18n.js` fails on a hardcoded literal in a UI sink.
- **Settings go in `chrome.storage.sync`; fetched content and per-device state go in
  `chrome.storage.local`.** Never the other way round.
- **Only `background.js` may touch the network.**
- **Remote data is authored outside our trust boundary** — `textContent` only, caps enforced
  before storage, ids namespaced per source.

## Reporting instead of fixing

A bug report with the right details is worth as much as a patch here — see the issue
templates. Anything exploitable goes to [SECURITY.md](SECURITY.md) rather than a public
issue.
