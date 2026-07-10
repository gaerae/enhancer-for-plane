# Privacy Policy — Enhancer for Plane

_Last updated: 2026-07-10_

Enhancer for Plane ("the extension") is a browser add-on that customizes the
appearance and editing experience of the Plane (makeplane / plane.so) web app in
your own browser.

## Summary

The extension does **not** collect, transmit, sell, or share any personal data.
There are no accounts, no analytics, no tracking, and no external servers.

## What is stored

The extension saves only **your own configuration**:

- the list of domains where you want it active,
- your style rules (CSS selector / property / value), and
- your title + body templates.

This is stored using the browser's built-in extension storage
(`chrome.storage.sync`). If you have Chrome Sync enabled, Chrome may sync this
configuration across your own signed-in devices. The data stays within Google's
storage for your account and is never sent to the developer or any third party.

## What is accessed

- **Page content on domains you grant.** To apply your width/style rules and add
  the template button, the extension reads and modifies the page's DOM — but only
  on origins you have explicitly granted. It ships with no host access; when you
  enable a domain, Chrome asks you to grant access to that single site, and the
  extension is registered only there. It has no access to any other website and
  reads nothing on them.
- **The current tab's address (activeTab).** When you click the toolbar icon,
  the popup reads the active tab's hostname to tell you whether the extension is
  active there. This value is used only in that moment and is not stored or
  transmitted.

## What is NOT done

- No personal or identifying information is collected.
- No browsing history, keystrokes, form data, or credentials are collected.
- No data is sent to any server operated by the developer or a third party.
- No advertising or analytics SDKs are included.
- No remote code is loaded or executed; all logic ships inside the extension.

## Your control

You can view, edit, export, or delete all stored settings at any time from the
extension's Settings page ("Restore defaults" clears them). Uninstalling the
extension removes its stored data.

## Contact

Questions about this policy can be raised on the project's issue tracker:
https://github.com/gaerae/enhancer-for-plane/issues
