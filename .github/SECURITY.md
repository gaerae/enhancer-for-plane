# Security policy

## Reporting

Report privately through GitHub:
[**Report a vulnerability**](https://github.com/gaerae/enhancer-for-plane/security/advisories/new),
or email <gaerae@gmail.com> with `enhancer-for-plane` in the subject.

Please do not open a public issue for anything exploitable. This extension runs on pages
holding a company's issue tracker, so an unreported window is a window on somebody's
internal data.

This is a one-maintainer project. Expect an acknowledgement within a week. A fix ships as a
new version to the Chrome Web Store, and store review adds days on top of that, which is
outside anyone's control here.

## Supported versions

The version currently on the Chrome Web Store, and only that one. Chrome auto-updates
extensions, so in practice everyone is on the latest within a day of it passing review.

## Where the sharp edges are

Aim a report at one of these and it will land:

- **Team template sync fetches a URL the user supplies**, so whoever controls that URL
  writes the strings the picker renders. Everything from a source is treated as hostile:
  capped before storage, rendered with `textContent` and never as markup, ids namespaced per
  source. A way around any of that is a vulnerability.
- **Style rules inject CSS the user typed.** Values have `;{}` stripped, property names pass
  a whitelist, selectors are parse-validated. An escape from a declaration into the
  surrounding stylesheet is a vulnerability.
- **Host access is per-site and optional** — none at install, one origin at a time. Widening
  it without a Chrome prompt is a vulnerability.
- **The only network request is that template fetch.** Anything else reaching the network is
  worth reporting even if you cannot exploit it.

Vulnerabilities in Plane itself go to [makeplane/plane](https://github.com/makeplane/plane/security);
this is an unofficial add-on and does not modify a Plane server. What the extension does
with your data is in [PRIVACY.md](../PRIVACY.md).
