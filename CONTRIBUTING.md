# Contributing to Enhancer for Plane

Thanks for helping. This file covers the order of work up to opening a PR.
The rules for working in this repo — what the checks cannot judge — live in [AGENTS.md](AGENTS.md).
The [Code of Conduct](CODE_OF_CONDUCT.md) applies everywhere you take part, and
security issues are reported privately as [SECURITY.md](SECURITY.md) describes.

## Setup

- Node.js 20 or later. There are no npm dependencies to install.
- Chrome or Chromium for the DOM harness (`PE_CHROME=/path` points it at one).
- Load the extension unpacked from the repository root: `chrome://extensions` → Developer mode → Load unpacked.

## Before you open a PR

Run the four checks CI runs on every push and PR:

```bash
node tools/test.js            # behaviour: sync engine, normalization, sections
node tools/check-i18n.js      # translation contract (--strict in CI)
node tools/check-source.js    # architectural invariants
node tools/dom-harness.js     # options.html + popup.html in a real browser
```

Passing them is not the same as working. If you changed anything a user sees, drive it in a
real Chrome against a Plane instance, and add the case to `tools/dom-harness.js` so it keeps
being checked.

## What a good change looks like

- One topic per PR. Small PRs get reviewed and merged faster.
- A new string is added in every locale under `_locales/` in the same PR; `check-i18n.js --strict` fails otherwise.
- A change people can see gets a line under `## [Unreleased]` in `CHANGELOG.md`.
- Do not bump `manifest.json` version in a feature PR; releases are cut separately.
- Never commit keys, tokens, personal data or store credentials.

## Commits and branches

- Branch from the latest `main` as `<area>/<topic>` (`feature/anchor-health`, `fix/options-focus`).
- Commit title: one sentence describing the result, no trailing period.
- PRs are squash-merged; the PR title becomes the commit title, so write it carefully.

## Bugs in Plane itself

This is an unofficial add-on. Bugs in Plane belong in
[Plane's tracker](https://github.com/makeplane/plane/issues).
