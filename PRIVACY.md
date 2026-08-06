# Privacy Policy — Enhancer for Plane

_Last updated: 2026-07-16_

Enhancer for Plane ("the extension") is a browser add-on that customizes the
appearance and editing experience of the Plane (makeplane / plane.so) web app in
your own browser.

## Summary

The extension does **not** collect, transmit, sell, or share any personal data.
There are no accounts, no analytics, and no tracking. The developer operates no
server and receives nothing from you.

The extension makes network requests in exactly one case: if **you** turn on
template sync and add a source URL, it downloads that file on the schedule you
choose. It is off by default and contacts nothing until you configure it. See
[Template sync](#template-sync-the-only-network-access) below.

## What is stored

Everything is stored in the browser's own extension storage, on your device.

**Your configuration** (`chrome.storage.sync`):

- the list of domains where you want it active,
- your style rules (CSS selector / property / value),
- your title + body templates,
- your template variables — name/value pairs you define, which you can use as
  `{{var.name}}` inside a template. You choose what goes in them; if you put your
  own name or handle in one, that value is stored here like any other setting,
- your copy formats — the name and format string of each entry in "Copy
  reference". These hold only what you type; the work item values they refer to
  are read from the page at the moment you copy and are never stored,
- your template sync settings: source URLs, their labels, sync interval, and
  which groups you have hidden.

If you have Chrome Sync enabled, Chrome may sync the above across your own
signed-in devices. It stays within Google's storage for your account and is never
sent to the developer or any third party.

**Downloaded templates and sync status** (`chrome.storage.local`, this device
only): the templates fetched from your source URLs, plus each source's last sync
time, last result, and any error message. This is a cache — the picker reads it
instead of the network, so inserting a template works offline. It is removed when
you delete the source, and Chrome Sync never carries it to other devices.

## What is accessed

- **Page content on domains you grant.** To apply your width/style rules and add
  the template button, the extension reads and modifies the page's DOM — but only
  on origins you have explicitly granted. It ships with no host access; when you
  enable a domain, Chrome asks you to grant access to that single site, and the
  extension is registered only there. It has no access to any other website and
  reads nothing on them.
- **The clipboard, only when you ask for it (write only).** Choosing a format in
  "Copy reference" writes that one string to your clipboard. The extension never
  reads the clipboard, and needs no clipboard permission to do this — the write
  happens in your click.
- **The current tab's address (activeTab).** When you click the toolbar icon,
  the popup reads the active tab's hostname to tell you whether the extension is
  active there. This value is used only in that moment and is not stored or
  transmitted.

## Template sync — the only network access

Template sync lets a team keep shared templates in one JSON file. It is
**disabled by default and has no source URL**; nothing is requested until you add
one in Settings, and adding one prompts Chrome for access to that origin.

When it runs (on the interval you pick, and when you press "Sync now"):

- **What is requested:** a plain `GET` of the source URL you entered. The
  extension never contacts an address of its own choosing, and it accepts
  templates only from a host you have granted.
- **What is sent:** nothing of yours. The extension transmits no settings, no
  templates, no page content, and no identifiers. It sends no cookies or
  credentials for that site either: the request runs from the extension's own
  origin in the browser's default same-origin credentials mode, which never
  matches your source's origin.
- **What that server can see:** what any HTTP request unavoidably reveals to the
  host you are asking — your IP address, your browser's user-agent, and the fact
  that the file was requested. If that matters to you, choose a source URL whose
  operator you are willing to reveal that to (for most users this is their own
  company's server). The developer of this extension is not that operator and
  learns nothing from your syncs.
- **What comes back is treated as untrusted.** The downloaded file is capped in
  size, parsed as data, and rendered as plain text — never executed as code and
  never inserted as markup.

Turning sync off, or deleting a source, stops the requests and clears that
source's cached templates.

## What is NOT done

- No personal or identifying information is collected.
- No browsing history, keystrokes, form data, or credentials are collected.
- No data about you is sent anywhere. The extension has no server, no analytics,
  and no telemetry; the only request it can make is downloading the template file
  from a URL you configured yourself, and that request carries none of your data.
- No advertising or analytics SDKs are included.
- No remote code is loaded or executed; all logic ships inside the extension.
  Synced templates are text content, not code.

## Your control

You can view, edit, export, or delete all stored settings at any time from the
extension's Settings page ("Restore defaults" clears them, including sync sources
and their cached templates). There are two exports, and they carry different
things. "Export JSON" is a backup: it includes your domains, source URLs and
variable values in plain text, so keep it to yourself. "Export my templates as a
feed" is meant to be handed to teammates, and carries your templates and nothing
else — no domains, no rules, no variable values, no source URLs. Both write a file
to your device; neither uploads anything. Template sync can be switched off, or individual
sources disabled or removed, at any time. Uninstalling the extension removes its
stored data.

## Contact

Questions about this policy can be raised on the project's issue tracker:
https://github.com/gaerae/enhancer-for-plane/issues
