<!--
Copy-only changes (wording, docs, store text) go straight to main — see AGENTS.md.
Open a PR when behaviour, the schema, permissions or manifest.json change; a manifest
change makes the merge a store release, which deserves a last look.
-->

## What changed, and why

<!-- The problem, not just the diff. If it fixes something, say how it failed. -->

## Checks

```
node tools/test.js
node tools/check-i18n.js
node tools/check-source.js
node tools/dom-harness.js
```

- [ ] All four pass locally (`dom-harness` needs a Chrome; `PE_CHROME=/path` to point at one)

**Passing them is not the same as working.** Every check passed while the template picker
was showing stale templates, because the bug was in data rather than in code. So:

- [ ] If a user sees this change, I drove it — and the case is in `tools/dom-harness.js`, not
      only in a one-off browser session
- [ ] If it touches a selector or a DOM anchor, it is checked against **both** Plane
      generations (self-hosted 1.4 and Plane Cloud). A rule that stops matching is a silent
      no-op, which is why two presets sat dead on Cloud for a release
- [ ] If it adds user-facing text, every string goes through `peMsg` with a key in both locales
- [ ] If it changes stored settings, `PE_SCHEMA` moved **only if** the number it leaves behind
      is already on `main` (`git show main:common.js | grep PE_SCHEMA`) — one bump per released
      version, so an unreleased bump gets folded into the existing step instead

## Anything a reviewer should look at first

<!-- The part you are least sure about. -->
