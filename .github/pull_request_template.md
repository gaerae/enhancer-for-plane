<!-- Copy-only changes go straight to main. Rules: AGENTS.md. -->

## What changed, and why

<!-- If it fixes something, say how it failed. -->

## Checks

- [ ] `test.js`, `check-i18n.js`, `check-source.js`, `dom-harness.js` all pass
- [ ] Anything a user sees is driven in `dom-harness.js`, not only by hand
- [ ] Anything selector- or anchor-shaped is checked on **both** Plane generations
- [ ] `PE_SCHEMA` moved only if the number it leaves behind is already on `main`
