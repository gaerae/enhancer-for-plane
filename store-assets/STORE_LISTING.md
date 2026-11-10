# Chrome Web Store — Listing copy (Enhancer for Plane)

> **Published:** https://chromewebstore.google.com/detail/dicjfphghjfljkifogkplgdeefjdkhbo

Paste these into the Web Store Developer Dashboard fields. The English listing is the default (below); the Korean translation is in the "한국어 (Korean listing)" section near the end.

**Formatting note:** the Detailed description is laid out one sentence per line, grouped under short feature headers, with blank lines between sections. The store's description field preserves these line breaks literally — so it pastes exactly as shown here: scannable, with no mid-sentence wrapping. Paste as-is; don't re-flow the lines.

> How Korean shows up in the store: the Web Store offers a separate per-language
> listing tab only if the package ships a `_locales/<lang>` directory with a
> `default_locale`. This package now ships `_locales/en` (default) and
> `_locales/ko` — so the store recognizes English + Korean, and the extension's
> own name/description are localized (Korean users see "Enhancer for Plane — 바로 열기 & 이슈 템플릿"). In the dashboard, set the default listing to English and
> add a Korean listing (Store listing ▸ language selector) using the Korean
> summary + description below, and its own screenshots — the `*.ko.png` set in
> store-assets (screenshots are stored per language, so the Korean tab does not
> inherit the English ones). The extension's own UI is fully translated too;
> the Korean captures quote those strings rather than inventing new ones.

---

## Product name  (max 75)
Enhancer for Plane — Quick Open & Issue Templates

> Why this shape: the brand comes first because a name has to be repeatable — "install
> Enhancer for Plane" is something you can say, and a descriptive phrase is not. The half
> after the dash is the searchable one: "Plane" on its own loses to aircraft, and nobody
> types "enhancer", so the two features people actually search for sit where the store can
> index them. "makeplane" and "plane.so" are searchable spellings rather than reading matter:
> they stay in the summary and at the foot of the description, out of the name (which they
> only lengthen) and out of the extension's own description (where the reader is already
> looking at a Plane extension). "Jira" stays out of the name too: quick open works
> there, but most of the other features need Plane's own pages, and a name must not promise
> otherwise.

> The brand alone — "Enhancer for Plane" — is what the popup and settings headers show
> (extShort), so the thing you install and the thing you point at match.

## Summary / short description  (max 132)
Open any work item by key from the address bar — plus issue templates, copy reference and focus mode for Plane (makeplane).

## Category
Workflow & Planning

> Not Developer Tools, which is where it started. That category is devtools panels —
> React DevTools, JSON viewers, API clients — and a reader browsing it is not looking for
> an issue-tracker add-on. What this does is project management: templates for tickets,
> reaching a work item, reading a list. The audience happens to be developers; the job is
> planning, and the category names the job.

## Language
English

---

## Detailed description  (max 16,000)

Every issue tracker leaves the same gaps.
No reusable templates for the tickets you file over and over, and no way to open an item from its key.
Nothing hands one to a chat message without retyping it, and nothing puts the side panels away so you can read.
This fills them inside the Plane UI, on any plan, with no changes to your Plane server.
It runs on Plane Cloud and on self-hosted Plane, and each release is checked against a live instance of each.

✨ WHAT YOU GET — at a glance
⚡ Quick open — a work item from its key: address bar, popup, or right-click
📝 Issue templates — fill a title and body in one click
📋 Copy reference — hand an item to chat, a PR or a branch name
📐 Width & style rules — read every name in full
🧘 Focus mode — put the side panels away
🎯 Element picker — build a rule without DevTools
🔄 Template sync — one set of templates for the whole team
Nothing runs inside a page until you enable a site for it.

⚡ Go straight to a work item — quick open
Type "issue" in the address bar, a space, then a key like PROJ-142, and Enter opens it.
The same box is on the toolbar popup, and both offer the keys you opened last.
Pin the items you keep returning to, and the popup holds them for you.
A key almost never arrives on its own; it arrives inside a sentence, in a Slack message or a pull request title.
Select it anywhere, right-click, and choose "Open work items from selection" — nothing to type, nothing to set up.
Several keys open in their own tabs, up to 10 at a time.
Setting the link up is one paste: copy the address of any work item you have open and it falls out of it, search address included.
Plane, Jira, Linear, GitHub and GitLab are recognised by name, and several can coexist: point ENG- at Linear and leave the rest on Plane.
Type words instead of a key and it searches instead.
It only opens a URL, so it asks for no site access at all and works on any tab.

📝 Fill a work item in one click — issue templates (title + body)
Register a template once, drop it into any work item with one click — title and description together.
A native "Template" button sits in the description toolbar and in the "Create work item" dialog (Alt/⌥+T).
Bodies are Markdown: headings, lists, checkboxes.
On a long menu the three templates you used last sit at the top, so a team pack is not a scroll every time.
Variables fill themselves in on insert — {{date}}, {{date+7}} for a deadline, {{week}}, {{month}} — plus up to 5 of your own.
Plane's own work item templates are a Pro feature; these run on any instance, including a free self-hosted one.

📋 Hand off a work item in one click — copy reference
The button beside a work item's ID (or Alt/⌥+C) copies it to your clipboard as plain text, a Markdown link, or a branch name.
Every format is a row you can edit into your own, previewed in Settings.
It works on the item's own page, in the preview panel a list opens, and from the toolbar popup on any tracker you have a link for.

📐 Read every name in full — width & style rules
Plane cuts long names off in lists and dropdowns until you can't tell items apart.
One "selector → property → value" rule forces any width, and the names come back.
It's a generic CSS engine, so if Plane's class names change between versions you just edit the selector.
Settings shows when each rule last matched anything, and flags one that never has.
A redesign is then one line to fix instead of a feature that quietly went away.
Plane Cloud folds a long description behind "Show all" every time an item opens; two rules that ship switched on show all of it.

🧘 Just the description — focus mode
Alt+Shift+F (⌥+⇧+F on macOS) hides the properties panel and the left navigation, so the body is what is left.
There is a toggle beside the item's key too, and a switch in the popup.
Plane pins those properties to the right with no way to collapse them; this collapses them.
Any rule can be marked "Only while focus mode is on", so what disappears is up to you.
It applies to that tab, survives a reload there, and is never synced to your other devices.

🎯 Build rules without DevTools — visual element picker
Click "Pick element" in the popup, then click anything on the Plane page.
Candidate selectors come back ordered by what will still work next month, each with a match count.
Anything the build generated is marked "may change" in words rather than colour.

🔄 One set of templates for the whole team — template sync
Point everyone at one JSON file — your intranet, a Git host, any URL — and the whole team pulls the same templates.
Off by default; it fetches only the URL you add, on the schedule you choose or on demand.
Inserting reads a local cache, so it works offline, and synced templates stay read-only so no one's edits get overwritten.
New to it? "Try our example" fills in a live feed so you can watch it work.

🏠 Your instance, wherever it runs
Add the domain you use — plane.your-company.com, or app.plane.so.
Wildcards (*.example.com) are supported.
Self-hosted is where this started, and Plane Cloud is checked against a live instance every release.
The two do not draw the same page, so a rule that ships can fit one and not the other.
The item-name width rule was written for self-hosted Plane and does not match on Plane Cloud yet.
It ships with no site access: enabling a domain asks Chrome for that one site, and it stays completely inert everywhere else.
"Run on all sites" in Settings asks Chrome for every site instead; it is off unless you turn it on.
Your settings back up to a JSON file and restore on another machine.

🔒 PRIVACY — nothing leaves your browser
No accounts, no tracking, no analytics, no server.
Your settings live in Chrome's own storage, synced to your Google account only if you use Chrome Sync.
The one request this extension can make is downloading the team-template file from a URL you added yourself.
It carries none of your data.

🚀 GET STARTED
1. Open your Plane instance — self-hosted or Plane Cloud.
2. Click the toolbar icon and "Enable on this site" (grant access when Chrome prompts).
3. In Settings, paste the address of any work item you have open: that one paste sets up opening, searching and copying at once.
4. Add templates whenever you want them, and adjust the two width rules that ship if they need it. Everything else is optional.

Open source. Feedback and issues welcome.

Works with Plane (makeplane / plane.so), the open-source project management, issues and wiki tool, and a self-hosted alternative to Jira.
An independent, unofficial add-on: not affiliated with or endorsed by Plane, and "Plane" is a trademark of its owner.
(And no — nothing to do with airplanes.)

---

## Single purpose  (review form)

Enhancer for Plane has one purpose: to let users customize the Plane (makeplane) project-management web app in their own browser — inserting reusable title/body templates into work items, copying a work item's own reference to the clipboard in a user-defined format, changing how the page is laid out via user-editable CSS rules (element widths, a focus mode that hides the side panels, and showing a long description in full), and reaching a work item from its key via a user-configured link — on the Plane instances the user chooses. Reaching a work item covers the several places a key can be typed or found: the address bar, the toolbar popup, the list of keys the user opened most recently, the items the user pinned, and a key selected in text on any page. All of them build a URL from the same user-configured link and navigate to it. Two helpers serve the same purpose: an element picker that helps the user write a CSS rule, and a tidy-up of text the user copies out of a Plane description so it pastes cleanly.

---

## Permission justifications  (review form)

storage
  Stores the user's own settings (active domains, style rules, templates, user-defined template variables, copy formats, quick-open links, and team-template source URLs) so they persist across sessions and sync via Chrome. storage.local holds six device-only records: the team templates downloaded from the user's own source URLs, so the picker can read them without a network request; the last few work item keys the user opened, so the address bar and popup can offer them again; the work items the user pinned in the popup (key, address, target name and tab title), written only when the user presses "Pin"; the ids of the last three templates the user inserted (ids only, never a template's text), so a long template menu can offer them first; a count of how often each style rule has matched an element; and a count of how often each of the extension's two buttons (Template, copy) has been placed. The two counts are numbers and timestamps only, shown in Settings. None of this is sent anywhere, and the storage.local records are not synced.

alarms
  Refreshes team templates on the interval the user selects (hourly to daily). An MV3 service worker is terminated when idle, so a timer cannot survive; chrome.alarms is the only supported way to run a periodic refresh. Used solely to trigger that refresh — no alarm exists unless the user has enabled template sync and added a source.

activeTab
  When the user clicks the toolbar icon, the popup reads the current tab's address and title. The address gives the hostname, which is what tells the user whether enhancements are active on this site and offers "Enable on this site"; the address and title together are also what "Copy reference" builds its string from when the tab is a work item, which is why this path needs no content script and works on any tracker the user has configured a link for. The popup also messages the current tab to start the element picker. Reading these values stores nothing, and neither value is ever transmitted. Two popup buttons keep part of what was read, and only when pressed: "Pin" saves that work item's address and title in storage.local on this device, and "Enable on this site" adds the hostname to the user's domain list. Access is limited to the tab the user explicitly invoked the extension on, and only for as long as that invocation lasts.

contextMenus
  Adds one right-click item, "Open work items from selection", shown only when text is selected. A key rarely arrives on its own — it arrives inside a sentence, in a chat message or a pull request title — so this is the same navigation the address bar offers, reached from where the key actually is. Chrome passes the extension the selected text and nothing else: the page is never read, no script is injected, and the extension has no access to the page the selection came from. The selected text is matched against a key pattern and any keys it contains, ten at most, are used to build URLs from the user's own configured link. It is not stored.

omnibox (manifest key, not a permission)
  Registers the keyword "issue" in the address bar. The extension receives what the user types only AFTER they have typed that keyword and a space — Chrome sends nothing before the keyword is active, and nothing from any other omnibox input. What is typed is matched against a key pattern to build a URL from the user's configured link, or, when it is not shaped like a key, put into the user's configured search URL for that tracker. Either way it is turned into an address in the browser and navigated to. Nothing is sent to the developer or to any search service the user has not configured.

scripting
  Registers the content script on exactly the origins the user granted, and right after a grant injects it into tabs of that origin that were already open, so the site works without a reload. That script is the whole in-page extension: it applies the user's style rules (including the ones reserved for focus mode and the two that show a long description in full), places the Template button and the copy-reference button, runs the element picker when the user starts it from the popup, tidies a copy the user makes inside a Plane description, and records whether each rule and each button found anything (the counts described under storage). No script is registered or injected until the user enables a domain.

Optional host permissions (requested per site at runtime, NOT at install)
  Plane can be self-hosted on ANY domain, so the target host is not known at build time and cannot be a fixed match list. The extension therefore declares optional host permissions and requests access to a single origin only when the user enables that domain (via the popup's "Enable on this site" or Settings) — Chrome shows a per-site prompt. It requests no host access at install, holds access only for the domains the user granted, and releases it when a domain is removed. This is the least-privilege way to support arbitrary user-provided self-hosted Plane hosts.
  One setting widens this, and only by the user's own choice: "Run on all sites" in Settings, off by default, requests `*://*/*` through the same optional-permission prompt, for users whose Plane hosts are too many to list. Unticking it and saving hands that access back.
  The same mechanism covers team-template sync: a source URL can be on any host (an intranet server, a Git host), so adding a source prompts for that one origin, and the extension refuses to fetch any origin the user has not granted.

Clipboard (NOT a dashboard field — there is no box to paste this into)
  The form generates one box per permission the manifest actually requests, so there is no
  Clipboard field and there never will be: none is requested. This entry is here to be
  answerable — in a reply to a reviewer, or to whoever reads this file next and wonders
  whether the clipboard needed disclosing. It did not, and nothing about it changes the
  Data usage answers below: what is read is read locally, in the user's own gesture, and
  never leaves the device.
  No clipboard permission is requested or needed, and the clipboard's existing contents are never read. Two things happen, both inside a gesture the user made and both through the standard page API. "Copy reference" writes one string during the user's own click. And when the user copies inside a Plane description, the extension edits THAT copy before it lands — Plane replaces its plain-text version with Markdown whose line breaks carry a trailing backslash, and the backslash is removed; and when the copy holds a table, its HTML version is adjusted so each cell's lines stay in one cell when pasted into a spreadsheet. It reads only the data the page just put into that copy event, on granted origins only, and nothing is stored or sent anywhere.

Remote code
  None. All JavaScript and CSS is bundled in the package; nothing is eval'd, injected as markup, or executed from the network at runtime.
  For clarity, since the extension does make one kind of request: when the user turns on team-template sync and supplies a URL, the service worker downloads that JSON file. It is data, not code — parsed with JSON.parse, capped in size, and rendered into the picker with textContent only. It is never evaluated, never assigned to innerHTML, and never loaded as a script. The extension makes no other request, and none at all until the user configures a source.

---

## Data usage disclosures  (Privacy practices tab — check these)

• Does your extension collect or use user data? → Only "Website content" is read locally — to apply styling on matched Plane pages, and to tidy a copy the user is making (Plane's stray backslash in the text, and a table's cells for pasting into a spreadsheet). It is NOT collected, transmitted, or stored off-device.
• Personally identifiable information — NO
• Health, financial, authentication, personal communications, location, web history, user activity — NO
  On "web history", which is worth being able to answer out loud rather than just ticking:
  the extension keeps the last few work item keys and URLs the user opened through it, and
  the address and title of each item the user pinned, in storage.local on that device.
  Chrome's policy defines collection as transmitting data off the user's device, and nothing
  here leaves it — there is no server to send it to, it is excluded from Chrome Sync on
  purpose, and the user can clear the recent list from the popup in one click, remove a pin
  with its ×, or clear both with "Restore defaults". So NO is correct, and PRIVACY.md says
  the same thing in the same words.
• I do NOT sell or transfer user data to third parties (except approved cases) — attest
• I do NOT use or transfer user data for purposes unrelated to the item's single purpose — attest
• I do NOT use or transfer user data to determine creditworthiness / lending — attest

Privacy policy URL: https://github.com/gaerae/enhancer-for-plane/blob/main/PRIVACY.md

---

## Store URLs  (dashboard fields)

Standard for open-source extensions — gives users a support/contact path.

• Homepage URL: https://github.com/gaerae/enhancer-for-plane
• Support URL:  https://github.com/gaerae/enhancer-for-plane/issues

---

## 한국어 (Korean listing)

### 이름 (max 75)
Enhancer for Plane — 바로 열기 & 이슈 템플릿

> 이 형태로 정한 이유: 이름은 남에게 그대로 옮길 수 있어야 하므로 브랜드가 앞에 옵니다 —
> "Enhancer for Plane 설치하세요"는 말이 되지만 서술형 문구는 그렇지 않습니다. 붙임표
> 뒤가 검색되는 쪽입니다. "Plane"만으로는 항공기 명사에 밀리고 "enhancer"는 아무도
> 검색하지 않으므로, 사람들이 실제로 찾는 두 기능을 스토어가 색인할 자리에 둡니다.
> "makeplane"과 "plane.so"는 읽을 문구가 아니라 검색용 표기라서 요약과 상세 설명 맨 아래에만
> 두었습니다. 이름은 길어지기만 하고, 익스텐션 자체 설명은 이미 Plane 익스텐션을 보고 있는
> 사람이 읽는 문구라서 뺐습니다.
> 이름을 바꿔도 확장 ID와 리스팅 URL은 그대로이므로 리뷰와 설치 수는 유지됩니다.

### 요약 / 짧은 설명 (max 132)
주소창에서 키로 작업 항목 바로 열기. 여기에 Plane(makeplane)용 이슈 템플릿, 참조 복사, 집중 모드까지.

### 카테고리
워크플로 및 계획

### 상세 설명 (max 16,000)

어느 이슈 트래커든 비어 있는 곳은 같습니다.
반복해 등록하는 티켓에 쓸 템플릿이 없고, 키로 항목을 바로 열 방법이 없습니다.
남에게 넘기려면 매번 다시 타이핑해야 하고, 측면 패널을 치워 본문만 볼 방법도 없습니다.
그 빈 곳을 Plane UI 안에서 채웁니다.
어느 플랜에서든 되고, Plane 서버는 전혀 건드리지 않습니다.
Plane Cloud와 자체 호스팅 양쪽에서 쓸 수 있고, 릴리스마다 양쪽 실제 인스턴스에서 확인합니다.

✨ 무엇을 제공하나 — 한눈에
⚡ 바로 열기 — 키로 작업 항목에 닿기: 주소창, 팝업, 우클릭
📝 이슈 템플릿 — 제목과 본문을 한 번에 채우기
📋 참조 복사 — 메신저, PR, 브랜치명으로 항목 넘기기
📐 폭·스타일 규칙 — 잘린 이름을 온전히 보기
🧘 집중 모드 — 측면 패널 치우기
🎯 요소 피커 — DevTools 없이 규칙 만들기
🔄 템플릿 동기화 — 팀 전체가 한 벌의 템플릿을
사이트를 켜기 전에는 어느 페이지 안에서도 아무것도 실행되지 않습니다.

⚡ 키만 입력해 작업 항목 열기 — 바로 열기
주소창에 "issue"를 입력하고 한 칸 띄운 뒤 PROJ-142 같은 키를 넣으면 Enter로 열립니다.
같은 입력칸이 툴바 팝업에도 있고, 두 곳 모두 최근에 연 항목을 보여 줍니다.
자주 여는 항목은 고정해 두면 팝업에 남습니다.
키는 키의 모습으로 오지 않습니다.
Slack 메시지나 풀 리퀘스트 제목처럼 문장 속에 섞여 옵니다.
그 부분을 드래그하고 우클릭해 "선택한 텍스트에서 작업 항목 열기"를 고르세요 — 입력할 것도, 따로 준비할 것도 없습니다.
키가 여러 개면 각각 새 탭으로, 한 번에 10개까지 열립니다.
링크 설정은 붙여넣기 한 번입니다.
열어 둔 작업 항목의 주소를 복사해 붙여넣으면 검색 주소까지 그대로 나옵니다.
Plane, Jira, Linear, GitHub, GitLab은 이름으로 알아보고, 여러 개를 함께 둘 수 있습니다(ENG-는 Linear로, 나머지는 Plane으로).
키 대신 낱말을 넣으면 검색으로 갑니다.
URL만 열기 때문에 사이트 접근 권한을 전혀 요청하지 않고, 어느 탭에서나 동작합니다.

📝 작업 항목을 한 번에 채우기 — 이슈 템플릿(제목 + 본문)
템플릿을 한 번 등록해 두면 어떤 작업 항목에도 클릭 한 번으로 넣습니다 — 제목과 본문을 함께.
설명 툴바와 "신규 작업항목 생성" 창에 네이티브 "템플릿" 버튼이 붙습니다(Alt/⌥+T).
본문은 마크다운입니다 — 제목, 목록, 체크박스.
메뉴가 길면 마지막으로 쓴 템플릿 세 개가 맨 위에 와서, 팀 템플릿이 많아도 매번 스크롤할 필요가 없습니다.
삽입할 때 변수가 채워집니다 — {{date}}, 마감일용 {{date+7}}, {{week}}, {{month}}, 그리고 직접 만든 변수 5개까지.
Plane 자체의 작업 항목 템플릿은 Pro 기능입니다.
이 템플릿은 무료 자체 호스팅을 포함해 어느 인스턴스에서든 동작합니다.

📋 작업 항목을 한 번에 넘기기 — 참조 복사
작업 항목 번호 옆 버튼(또는 Alt/⌥+C)이 일반 텍스트, 마크다운 링크, 브랜치명 중 원하는 형식으로 클립보드에 담습니다.
모든 형식은 직접 고쳐 쓸 수 있는 줄이고, 설정의 미리보기가 곧 클립보드에 담길 내용입니다.
항목 자신의 화면에서도, 목록에서 열리는 미리보기 패널에서도, 링크를 등록해 둔 트래커라면 툴바 팝업에서도 됩니다.

📐 이름을 온전히 보기 — 스타일 규칙
Plane은 목록과 드롭다운에서 긴 이름을 잘라 어느 항목인지 구분하기 어렵게 만듭니다.
"선택자 → 속성 → 값" 규칙 하나로 원하는 폭을 지정하면 이름이 돌아옵니다.
범용 CSS 엔진이라 버전이 바뀌어 클래스명이 달라져도 선택자만 고치면 됩니다.
설정에는 규칙마다 마지막으로 적용된 때가 나오고, 한 번도 적용된 적 없는 규칙은 따로 표시됩니다.
그래서 개편이 있어도 기능이 조용히 사라지지 않고, 고칠 줄 하나로 드러납니다.
Plane Cloud는 항목을 열 때마다 긴 설명을 "모두 보기" 뒤로 접는데, 켜진 채로 들어 있는 규칙 두 개가 전부 보여 줍니다.

🧘 본문만 남기기 — 집중 모드
Alt+Shift+F(macOS는 ⌥+⇧+F)로 속성 패널과 왼쪽 내비게이션을 숨기면 본문만 남습니다.
작업 항목 번호 옆 토글과 팝업 스위치로도 됩니다.
Plane은 그 속성 패널을 오른쪽에 고정해 두고 접는 방법을 주지 않는데, 이 기능이 접어 줍니다.
어떤 규칙이든 "집중 모드에서만 적용"으로 표시할 수 있어 무엇을 숨길지는 직접 정합니다.
켠 탭에서만 적용되고 그 탭에서는 새로 고쳐도 유지되며, 다른 기기로는 동기화되지 않습니다.

🎯 DevTools 없이 규칙 만들기 — 비주얼 요소 피커
팝업에서 "요소 선택 → 규칙 추가"를 누르고 Plane 화면의 요소를 클릭하세요.
후보 선택자가 "다음 달에도 살아 있을까" 순서로, 매칭 개수와 함께 나옵니다.
빌드가 만든 것은 색이 아니라 "바뀔 수 있음"이라는 말로 적힙니다.

🔄 팀 전체가 한 벌의 템플릿을 — 팀 템플릿 동기화
JSON 파일 하나(사내 서버, Git 호스트, 아무 URL이나)를 가리키면 팀 전체가 같은 템플릿을 씁니다.
기본은 꺼져 있고, 직접 등록한 URL만 선택한 주기로 또는 즉시 받아 옵니다.
삽입은 로컬 캐시에서 읽으므로 오프라인에서도 되고, 동기화된 템플릿은 읽기 전용이라 누구의 편집도 덮이지 않습니다.
처음이라면 "예시 사용해 보기"가 살아 있는 피드를 채워 넣어 바로 확인할 수 있습니다.

🏠 쓰는 곳이 어디든
쓰는 도메인을 추가하세요 — plane.your-company.com도, app.plane.so도 됩니다.
와일드카드(*.example.com)도 지원합니다.
자체 호스팅에서 출발했고, Plane Cloud도 릴리스마다 실제 인스턴스에서 확인합니다.
둘은 같은 화면도 다르게 그리기 때문에, 기본으로 들어 있는 규칙이 한쪽에만 맞을 수 있습니다.
항목 이름 폭 규칙은 자체 호스팅에 맞춰 쓴 것이라 Plane Cloud에서는 아직 맞지 않습니다.
설치 시점에는 사이트 접근 권한이 하나도 없습니다.
도메인을 켜면 Chrome이 그 사이트 하나를 묻고, 그 외의 사이트에서는 완전히 비활성입니다.
설정의 "모든 사이트에서 실행"을 켜면 모든 사이트 접근을 요청합니다.
이 설정은 직접 켜지 않는 한 꺼져 있습니다.
설정은 JSON 파일로 백업해 다른 기기에서 되돌릴 수 있습니다.

🔒 개인정보 — 브라우저 밖으로 나가지 않습니다
계정도, 추적도, 분석도, 서버도 없습니다.
설정은 브라우저 자체 저장소에 보관되고, Chrome 동기화를 쓰는 경우에만 본인 Google 계정으로 동기화됩니다.
익스텐션이 보내는 요청은 직접 등록한 URL에서 팀 템플릿 파일을 내려받는 것 하나뿐입니다.
그 요청에도 사용자의 데이터는 담기지 않습니다.

🚀 시작하기
1. 쓰는 Plane을 엽니다 — 자체 호스팅이든 Plane Cloud든.
2. 툴바 아이콘을 눌러 "이 사이트에서 사용"을 클릭합니다(Chrome 프롬프트에서 접근 허용).
3. 설정에서 열어 둔 작업 항목의 주소를 붙여넣으세요. 이 붙여넣기 한 번으로 열기와 검색, 복사가 한꺼번에 준비됩니다.
4. 템플릿은 필요할 때 추가하고, 기본으로 들어 있는 폭 규칙 두 개는 필요하면 고치면 됩니다. 나머지는 전부 선택 사항입니다.

오픈소스입니다. 피드백과 이슈를 환영합니다.

makeplane / plane.so — 프로젝트 관리와 이슈, 위키를 함께 다루는 오픈소스 도구이자 Jira의 자체 호스팅 대안인 Plane에서 동작합니다.
독립적인 비공식 애드온입니다.
Plane과 제휴하거나 승인받지 않았으며 "Plane"은 해당 소유자의 상표입니다.
(비행기와는 무관합니다.)

---

### 단일 목적 / 권한 정당화 (심사 폼)
심사 폼(단일 목적, 권한 정당화, 데이터 사용)은 Google 리뷰어를 위해 **영문 그대로
제출**하세요. 위 영문 섹션을 사용하면 됩니다. 한국어 번역이 반드시 필요한 칸은
아닙니다.

---

## Real captures vs drawn templates

Three kinds of image live here, and the difference matters when you go to replace one.

`real/*.png` are **screen captures of a real Chrome window**, and captures 1, 2, 4 and 5 are
built from them: each `screenshot-N-*.html` lays two or three of them out as cards, and
`shot.js` picks `real/<name>.<lang>.png` for the page's language. They are the only way to
show the omnibox dropdown, the right-click menu and the toolbar popup as Chrome draws them,
because all three are browser UI outside every page's viewport. How they were taken, so the
next set matches:

- A **demo workspace on Plane Cloud** holding invented content only: a `Storefront` project
  (`SHOP`) for the English set and a `스토어프론트` project (`STORE`) for the Korean one, the
  same twelve items in each language. A store image is published for as long as the listing
  exists, and a real workspace's project names, item titles and colleagues are not ours to
  publish.
- The account's **avatar is replaced** before each capture: the page's `img` for it is
  swapped for a grey "A" in the page, and in frames recorded from the screen, where the page
  had already reloaded the photo, the same "A" is laid over it. Check the top-right corner and
  every comment before committing a new one.
- **Chrome's UI language decides the extension's strings**, not the page's: the menus, the
  popup and the omnibox rows follow `chrome.i18n`. The English set was taken with Chrome
  started as `open -a "Google Chrome" --args -AppleLanguages '(en-US)'`, which lasts until
  Chrome quits. Three things are stored settings rather than strings and have to be switched
  by hand for the other language: the copy format names, the team template source
  (`examples/team-templates.json` or `-ko.json`), and the recent keys, which come from
  actually opening `issue SHOP-…` or `issue STORE-…`.
- Plane's own UI was left in English in both sets. Plane does have a Korean UI, but its
  language is a setting in Plane, not in Chrome, and this set was taken without switching
  it, so the Korean frames show Korean content and the extension's Korean strings inside an
  English Plane. A retake in Korean would match the Korean listing, which already quotes
  Plane's Korean labels ("신규 작업항목 생성"); keep the two the same language.
- A 1280×900 window (1600×1000 for the create dialog, which a narrower one squeezes), captured
  at 2x with `screencapture -l` for the page and with `-R` on the window's rectangle for the
  omnibox, the popup and the menu, which are separate windows on top of it.

`screenshot-3-width.html` and `promo-*.html` are still **illustrations**: every pixel is drawn
in CSS. Capture 3 stays drawn because there is no honest real frame for it on Plane Cloud
today: the module chip it shows being cut is a `max-w-[224px]` button there, not the
`.max-w-40` the preset names, and at 1280px Cloud folds a second module into "+1". Retake it
once the width presets are measured against Cloud again.

`ui/*.png` are **real pages**: `node store-assets/capture-ui.js` renders the shipped
`popup.html` and `options.html`, with the shipped CSS byte for byte, in a real browser at 2x.
Only `chrome` is stubbed — the same technique `tools/dom-harness.js` asserts against — so
these cannot drift from the product without the checks noticing first. Its seed is invented
for the same reason as the demo workspace (`acme.atlassian.net`, PROJ-142).

Neither `real/` nor `ui/` is uploaded, so `tools/store-submit.js` does not count a change
under either as a listing change; only the images beside this file are.

---

## Assets checklist

• Store icon 128×128 ............ icons/icon128.png ✓
• Screenshot 1 (1280×800) ....... store-assets/screenshot-1-open.png ✓
• Screenshot 2 (1280×800) ....... store-assets/screenshot-2-focus.png ✓
• Screenshot 3 (1280×800) ....... store-assets/screenshot-3-width.png ✓
• Screenshot 4 (1280×800) ....... store-assets/screenshot-4-copy.png ✓
• Screenshot 5 (1280×800) ....... store-assets/screenshot-5-templates.png ✓
    Upload order is the order above, and the file numbers match it so the two cannot drift.
    It is hook order, not workflow order: the store shows two or three before anyone decides,
    so the captures that need no reading go first. Focus mode and the width rule are two
    frames each — panels and no panels, cut names and whole ones — and neither needs a
    sentence. Quick open leads because it is the one thing no other Plane extension does.
    Templates last is deliberate, not a demotion: it is in the extension's NAME and its
    summary, so it is the one feature whose discovery does not depend on a screenshot,
    while "names are cut off in the list" is a pain nobody goes looking for and only a
    picture can raise.
    Focus mode took a slot from the element picker. The picker is a tool for making a rule —
    it needs a paragraph before it means anything, and it sat where fewest people scroll. It
    is named in capture 3's caption now, beside the rule it exists to write.

The Korean listing gets its own set: `screenshot-N-*.ko.png`. The store keeps screenshots
per language, so a Korean visitor sees Korean captures — which is the point of shipping
`_locales/ko` at all. Upload them in the same order under Store listing ▸ 한국어.

Every screenshot is rendered from a page, not composited by hand. Each `screenshot-N-*.html`
is a 1280×800 page sharing `shot.css` and `shot.js` (the brand mark there is the real path
from `icons/icon.svg`), and carries its own copy for both languages in a `window.T`
block, applied by `?lang=`. One layout serves both listings, so a fix to the copy cannot
land in one language and not the other. What the pages hold differs: captures 1, 2, 4
and 5 lay out frames from `real/`, which the repo cannot regenerate — only a retake
replaces them — while capture 3 and the promo tiles are drawn in CSS end to end:

    sh store-assets/render.sh        # every capture and promo tile, both languages
    sh store-assets/render.sh 4      # just screenshot-4-*
    sh store-assets/render.sh promo  # just the promo tiles

The promo tiles work the same way, except each carries its size in its filename
(`promo-<name>-<W>x<H>.html`) and is rendered at exactly that — `shot.css` fixes the
capture canvas at 1280×800, so a tile overrides it. Both tiles are drawn, so like capture 3
they regenerate from the repo alone. The tiles are dark where the captures are light: `#121212` is half the brand, the white mark
reads best on it, and a dark tile is what separates this listing from a grid of pale ones.
They pull `../icons/icon.svg` directly rather than a copy of its path, so a tile and the
icon beside it in the store cannot drift apart.

What is translated and what is quoted differ. Headlines, ledes, captions and tags are ours
to write in each language. The extension's own strings are not: inside a real capture they
are whatever Chrome's UI language made the extension render, and where a page's own copy
names a control (capture 3's `요소 선택`) it uses the words in
`_locales/ko/messages.json`, because a poster showing a Korean UI the extension does not
render is a promise it cannot keep. Item titles and template bodies are user content, so the
demo workspace holds them in the reader's language.

Keep the pictures honest — they must show what the extension currently draws. The drawn
template menu once still showed a "TEMPLATES (TITLE + BODY)" header the picker had long
stopped rendering, and no "＋ Manage templates" footer, which the picker had gained. That is
what moved four of the five to real captures. A real capture is only true on the day it was
taken, so when the UI moves, retake it.

None of this ships: release.yml lists the packaged files explicitly and store-assets is
not among them.

## Packaging

CI builds the upload zip automatically — bump `version` in manifest.json, push to
`main`, and `.github/workflows/release.yml` creates a draft GitHub Release with
`enhancer-for-plane-<version>.zip` attached (the files on its allowlist, and everything
not on that allowlist left out). Nobody tags by hand. If that version already has a release,
draft or published, the run skips, so an unrelated push never makes a duplicate. Someone then
writes the release notes over the generated commit list and presses Publish; the tag is
created on Publish.

Both steps can be started by hand: **Actions ▸ Release extension ▸ Run workflow** makes the
draft, and **Actions ▸ Store ▸ Run workflow** sends a published release again, for example
after a failed run. If the release step fails with a 403, enable **Settings ▸ Actions ▸
General ▸ Workflow permissions ▸ Read and write permissions** so it can create tags and
releases.

Publishing that release runs `.github/workflows/store.yml`, which uploads the zip and
submits it for review. If the listing changed since the version the store is serving,
it uploads and stops red, naming each section and image that changed: paste those into
the dashboard, then press Submit for review there. The API has no call for listing text,
screenshots, or permission justifications. This section, the assets checklist and the
notes on captures are for whoever publishes, so editing them does not stop a release.

### One-time setup

Nothing below is a secret, and no key is created. The run proves who it is with its
GitHub identity, and Google lets exactly this repository's `chrome-web-store` environment
act as a service account that can do nothing except what the store dashboard allows it.

Paste this into [Cloud Shell](https://shell.cloud.google.com). The project id is global,
so change it if it is taken:

    PROJECT=enhancer-for-plane-cws
    REPO=gaerae/enhancer-for-plane
    REPO_ID=1296040347

    gcloud projects create "$PROJECT"
    gcloud config set project "$PROJECT"
    gcloud services enable chromewebstore.googleapis.com iam.googleapis.com \
      iamcredentials.googleapis.com sts.googleapis.com
    gcloud iam service-accounts create cws-publisher --display-name="Chrome Web Store publisher"
    gcloud iam workload-identity-pools create github --location=global --display-name="GitHub Actions"
    gcloud iam workload-identity-pools providers create-oidc enhancer-for-plane \
      --location=global --workload-identity-pool=github \
      --issuer-uri="https://token.actions.githubusercontent.com" \
      --attribute-mapping="google.subject=assertion.sub" \
      --attribute-condition="assertion.repository_id=='$REPO_ID'"
    NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
    SA="cws-publisher@$PROJECT.iam.gserviceaccount.com"
    POOL="projects/$NUMBER/locations/global/workloadIdentityPools/github"
    gcloud iam service-accounts add-iam-policy-binding "$SA" \
      --role=roles/iam.workloadIdentityUser \
      --member="principal://iam.googleapis.com/$POOL/subject/repo:$REPO:environment:chrome-web-store"
    echo "GCP_WORKLOAD_PROVIDER=$POOL/providers/enhancer-for-plane"
    echo "GCP_SERVICE_ACCOUNT=$SA"

Then:

1. In the Developer Dashboard's **Account** section, add the service account's email. A
   publisher can have only one.
2. Set the two values it printed on the environment, along with the store's own ids:

       gh variable set GCP_WORKLOAD_PROVIDER --env chrome-web-store --body "<printed value>"
       gh variable set GCP_SERVICE_ACCOUNT --env chrome-web-store --body "<printed value>"
       gh variable set CWS_PUBLISHER_ID --env chrome-web-store --body "<id from the dashboard URL>"
       gh variable set CWS_EXTENSION_ID --env chrome-web-store --body dicjfphghjfljkifogkplgdeefjdkhbo

The environment itself admits only `main` and `v*` tags. To rebuild it:

    gh api -X PUT repos/gaerae/enhancer-for-plane/environments/chrome-web-store \
      -F 'deployment_branch_policy[protected_branches]=false' \
      -F 'deployment_branch_policy[custom_branch_policies]=true'
    gh api repos/gaerae/enhancer-for-plane/environments/chrome-web-store/deployment-branch-policies \
      -f name=main -f type=branch
    gh api repos/gaerae/enhancer-for-plane/environments/chrome-web-store/deployment-branch-policies \
      -f 'name=v*' -f type=tag

### By hand

To upload without the workflow, download the zip from the release, or build the same zip
locally (run from the repo root):

  zip -r "enhancer-for-plane-$(jq -r .version manifest.json).zip" \
      manifest.json common.js content.js content.css background.js \
      options.html options.js options.css popup.html popup.js popup.css icons _locales \
      -x "icons/icon.svg"
