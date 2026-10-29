# Security policy

## Supported versions
- Only the latest release gets security fixes.
- Install or update from the [Chrome Web Store](https://chromewebstore.google.com/detail/dicjfphghjfljkifogkplgdeefjdkhbo); the matching source is tagged under [GitHub Releases](https://github.com/gaerae/enhancer-for-plane/releases).

## Reporting a vulnerability
- Do not post it as a public issue.
- Report it privately through **Security → Report a vulnerability** on the repository ([open a private report](https://github.com/gaerae/enhancer-for-plane/security/advisories/new)), or email gaerae@gmail.com.
- Include steps to reproduce, the Plane version and URL shape involved, the scope of impact, and a suggested fix if you can.
- You get a reply within 3 days of receipt.
- Confirmed issues are noted in the release notes after a fixed version ships, and the reporter is credited by name if they want.

## What this extension touches
- It runs only on the Plane hosts you add in its options; it has no access to other sites.
- Issue templates and settings are stored in Chrome's extension storage on your machine (and synced by Chrome if sync is on). Nothing is sent to any server of the author's.
- It uses no remote code, no analytics and no third-party scripts. See [PRIVACY.md](PRIVACY.md).
- Permissions are the minimum the manifest declares; a change that widens them is a release note, not a quiet bump.
