# Security policy

## Reporting a vulnerability

Report privately through GitHub:
[**Report a vulnerability**](https://github.com/gaerae/enhancer-for-plane/security/advisories/new).
If that is not available to you, email <gaerae@gmail.com> with `enhancer-for-plane` in
the subject.

Please do not open a public issue for anything exploitable. This is a browser extension
that runs on pages holding a company's issue tracker, so an unreported window is a window
on somebody's internal data.

This is a one-maintainer project, not a vendor with an on-call rota. What that means
concretely: expect an acknowledgement within a week. A fix ships as a new version to the
Chrome Web Store, and store review adds its own delay — usually days, sometimes longer —
which is outside anyone's control here. You will be credited in the release notes unless
you would rather not be.

## Supported versions

The version currently published on the Chrome Web Store, and that one only. There are no
long-term support branches. Chrome updates extensions automatically, so in practice
everyone is on the latest within a day of it passing review.

## What is in scope

The extension itself: the service worker, the content script, the settings page, and the
popup. Some specific things worth knowing about how it is built, because they are where the
sharp edges are:

- **Team template sync fetches a URL the user supplies**, and whoever controls that URL
  writes the strings the picker renders. Everything from a source is treated as hostile:
  size-capped before storage, rendered with `textContent` and never as markup, with ids
  namespaced per source. A way around any of that is a vulnerability.
- **Style rules inject CSS the user typed.** Values have `;{}` stripped, property names go
  through a whitelist, and selectors are parse-validated. An escape from a declaration into
  the surrounding stylesheet is a vulnerability.
- **Host access is per-site and optional.** The extension ships with none and asks for one
  origin at a time. Anything that widens that without a Chrome prompt is a vulnerability.
- **The only network request is the template fetch.** Anything else reaching the network,
  from any part of the extension, is a bug worth reporting even if you cannot exploit it.

## What is out of scope

- Vulnerabilities in Plane itself — report those to
  [makeplane/plane](https://github.com/makeplane/plane/security). This is an unofficial
  add-on and does not modify a Plane server.
- Anything requiring the attacker to already control the user's browser profile, or to
  have the user paste a malicious settings backup they were told to distrust.
- Reports from automated scanners with no working path to exploitation. A scanner flagging
  `!important` in injected CSS is not a finding; a demonstration that a rule value can break
  out of its declaration is.

## What the extension does with your data

Nothing leaves the browser except the template fetch described above, and that request
carries none of your data. [PRIVACY.md](../PRIVACY.md) is the full account.
