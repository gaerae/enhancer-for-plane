# Privacy Policy — Enhancer for Plane

_Last updated: 2026-08-09_

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

**Device-only caches** (`chrome.storage.local`, this device only, never carried
by Chrome Sync):

- **Downloaded templates and sync status** — the templates fetched from your
  source URLs, plus each source's last sync time, last result, and any error
  message. The picker reads this instead of the network, so inserting a template
  works offline. It is removed when you delete the source.
- **Recently opened work items** — the key, the address, and the name of the
  target for the last few items you opened through Quick open, so the address bar
  and the popup can offer them again instead of making you remember a key. This is
  the one thing here that says anything about what you have been working on, which
  is exactly why it stays on the device it happened on: waking up at another
  machine to your own browsing in the address bar is not a feature, and there is
  no server for it to go to. Clearing settings clears it.
- **How often each style rule matched** — a count per rule and the time it last
  matched anything, which is how Settings can tell you a rule has quietly stopped
  working. Numbers and timestamps only; no page content and no addresses.

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
- **What you type for Quick open.** Chrome hands the extension what follows the
  `issue` keyword — and only that; it sends nothing before the keyword is active,
  and nothing you type anywhere else in the address bar. If it is shaped like a
  key it is matched against the links **you** configured and turned into a URL; if
  it is not, it goes into the search address **you** configured for that tracker.
  Either way the work happens inside the browser and the tab is then navigated
  there, the same as if you had typed the address yourself. No search service sees
  it unless it is the one you configured, and nothing is sent to the developer.
  Quick open needs no site access at all and works with no domain granted. Keys
  you open this way are remembered on this device — see "Recently opened work
  items" above.
- **Text you select, only when you use the right-click item.** "Open work item
  from selection" appears when text is selected. Choosing it makes Chrome pass the
  extension **that selected text and nothing else** — the page itself is never
  read, no script is placed on it, and the extension has no access to the site the
  selection came from. The text is scanned for something key-shaped and, if found,
  turned into a URL from your own configured link. It is not stored.
- **The current tab's address and title (activeTab).** When you click the toolbar
  icon, the popup reads the active tab's address — the hostname is what tells you
  whether the extension is active on that site — and, when the address matches one
  of your Quick open links, its title as well, so "Copy reference" can offer you
  that item's key and title without touching the page. Both values are used in
  that moment and are neither stored nor transmitted. This is why copying works on
  a tracker the rest of the extension never runs on: it reads the tab, not the
  page.

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
extension's Settings page. "Restore defaults" clears them, including sync sources
and their cached templates — and because it also empties the list of sites, saving
after it hands Chrome's access to those sites back as well, so switching one on
again means approving it again. The confirmation says so before you commit to it. There are two exports, and they carry different
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
