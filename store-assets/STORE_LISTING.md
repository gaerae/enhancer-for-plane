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
> there, but the other five features need Plane's own pages, and a name must not promise
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
Plane Cloud and self-hosted alike — each release is checked against a live instance of each.

✨ WHAT YOU GET — at a glance
⚡ Quick open — a work item from its key: address bar, popup, or right-click
📝 Issue templates — fill a title and body in one click
📋 Copy reference — hand an item to chat, a PR or a branch name
📐 Width & style rules — read every name in full
🧘 Focus mode — put the side panels away
🎯 Element picker — build a rule without DevTools
🔄 Template sync — one set of templates for the whole team
Every one of them is off, empty or inert until you ask for it.

⚡ Go straight to a work item — quick open
Type "issue" in the address bar, a space, then a key like PROJ-142, and Enter opens it.
The same box is on the toolbar popup, and both offer the keys you opened last.
A key almost never arrives on its own; it arrives inside a sentence, in a Slack message or a pull request title.
Select it anywhere, right-click, and choose "Open work item from selection" — nothing to type, nothing to set up.
Setting the link up is one paste: copy the address of any work item you have open and it falls out of it, search address included.
Plane, Jira, Linear, GitHub and GitLab are recognised by name, and several can coexist: point ENG- at Linear and leave the rest on Plane.
Type words instead of a key and it searches instead.
It only opens a URL, so it asks for no site access at all and works on any tab.

📝 Fill a work item in one click — issue templates (title + body)
Register a template once, drop it into any work item with one click — title and description together.
A native "Template" button sits in the description toolbar and in the "Create work item" dialog (Alt/⌥+T).
Bodies are Markdown: headings, lists, checkboxes.
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
Settings tells you when a rule has stopped matching anything, so a redesign is one line to fix instead of a feature that quietly went away.

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
Add the domain you use — plane.your-company.com, or app.plane.so. Wildcards (*.example.com) supported.
Self-hosted is where this started, and Plane Cloud is checked against a live instance every release.
The two do not draw the same page.
It ships with no site access: enabling a domain asks Chrome for that one site, and it stays completely inert everywhere else.
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
4. Add templates and width rules whenever you want them. Everything else is optional.

Open source. Feedback and issues welcome.

Works with Plane (makeplane / plane.so), the open-source project management, issues and wiki tool, and a self-hosted alternative to Jira.
An independent, unofficial add-on: not affiliated with or endorsed by Plane, and "Plane" is a trademark of its owner.
(And no — nothing to do with airplanes.)

---

## Single purpose  (review form)

Enhancer for Plane has one purpose: to let users customize the Plane (makeplane) project-management web app in their own browser — inserting reusable title/body templates into work items, copying a work item's own reference to the clipboard in a user-defined format, adjusting element widths via CSS rules, and reaching a work item from its key via a user-configured link — on the Plane instances the user chooses. Reaching a work item covers the several places a key can be typed or found: the address bar, the toolbar popup, the list of keys the user opened most recently, and a key selected in text on any page. All of them build a URL from the same user-configured link and navigate to it.

---

## Permission justifications  (review form)

storage
  Stores the user's own settings (active domains, style rules, templates, user-defined template variables, copy formats, quick-open links, and team-template source URLs) so they persist across sessions and sync via Chrome. storage.local holds three device-only caches: the team templates downloaded from the user's own source URL, so the picker reads from disk instead of the network; the last few work item keys the user opened, so the address bar can offer them again; and a per-rule tally of how often each style rule has matched anything, so Settings can say when a rule has stopped working. None of it is sent to the developer, and the device-only items are deliberately kept out of Chrome Sync — recent work items are not something to push to a user's other machines.

alarms
  Refreshes team templates on the interval the user selects (hourly to daily). An MV3 service worker is terminated when idle, so a timer cannot survive; chrome.alarms is the only supported way to run a periodic refresh. Used solely to trigger that refresh — no alarm exists unless the user has enabled template sync and added a source.

activeTab
  When the user clicks the toolbar icon, the popup reads the current tab's address and title. The address gives the hostname, which is what tells the user whether enhancements are active on this site and offers "Enable on this site"; the address and title together are also what "Copy reference" builds its string from when the tab is a work item, which is why this path needs no content script and works on any tracker the user has configured a link for. The popup also messages the current tab to start the element picker. Both values are used in that moment and are not stored or transmitted. Access is limited to the tab the user explicitly invoked the extension on, and only for as long as that invocation lasts.

contextMenus
  Adds one right-click item, "Open work item from selection", shown only when text is selected. A key rarely arrives on its own — it arrives inside a sentence, in a chat message or a pull request title — so this is the same navigation the address bar offers, reached from where the key actually is. Chrome passes the extension the selected text and nothing else: the page is never read, no script is injected, and the extension has no access to the page the selection came from. The selected text is matched against a key pattern and, if it contains one, used to build a URL from the user's own configured link. It is not stored.

omnibox (manifest key, not a permission)
  Registers the keyword "issue" in the address bar. The extension receives what the user types only AFTER they have typed that keyword and a space — Chrome sends nothing before the keyword is active, and nothing from any other omnibox input. What is typed is matched against a key pattern to build a URL from the user's configured link, or, when it is not shaped like a key, put into the user's configured search URL for that tracker. Either way it is turned into an address in the browser and navigated to. Nothing is sent to the developer or to any search service the user has not configured.

scripting
  Registers/injects the content script (style rules + template button) on the specific origins the user grants. No script is registered until the user enables a domain.

Optional host permissions (requested per site at runtime, NOT at install)
  Plane can be self-hosted on ANY domain, so the target host is not known at build time and cannot be a fixed match list. The extension therefore declares optional host permissions and requests access to a single origin only when the user enables that domain (via the popup's "Enable on this site" or Settings) — Chrome shows a per-site prompt. It requests no host access at install, holds access only for the domains the user granted, and releases it when a domain is removed. This is the least-privilege way to support arbitrary user-provided self-hosted Plane hosts.
  The same mechanism covers team-template sync: a source URL can be on any host (an intranet server, a Git host), so adding a source prompts for that one origin, and the extension refuses to fetch any origin the user has not granted.

Clipboard
  No clipboard permission is requested or needed. "Copy reference" writes one string during the user's own click, using the standard page API; the extension never reads the clipboard.

Remote code
  None. All JavaScript and CSS is bundled in the package; nothing is eval'd, injected as markup, or executed from the network at runtime.
  For clarity, since the extension does make one kind of request: when the user turns on team-template sync and supplies a URL, the service worker downloads that JSON file. It is data, not code — parsed with JSON.parse, capped in size, and rendered into the picker with textContent only. It is never evaluated, never assigned to innerHTML, and never loaded as a script. The extension makes no other request, and none at all until the user configures a source.

---

## Data usage disclosures  (Privacy practices tab — check these)

• Does your extension collect or use user data? → Only "Website content" is read locally to apply styling on matched Plane pages; it is NOT collected, transmitted, or stored off-device.
• Personally identifiable information — NO
• Health, financial, authentication, personal communications, location, web history, user activity — NO
  On "web history", which is worth being able to answer out loud rather than just ticking:
  the extension keeps the last few work item keys and URLs the user opened through it, in
  storage.local on that device. Chrome's policy defines collection as transmitting data off
  the user's device, and nothing here leaves it — there is no server to send it to, it is
  excluded from Chrome Sync on purpose, and "Restore defaults" clears it. So NO is correct,
  and PRIVACY.md says the same thing in the same words.
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

아래는 스토어 등록 페이지에 넣을 한국어 번역입니다. `_locales/ko` 없이 단일
리스팅으로 낼 경우, 영문 설명 뒤에 "— 한국어 —" 구분선을 넣고 이 텍스트를 이어
붙이세요.

### 이름 (max 75)
Enhancer for Plane — 이슈 템플릿 & 바로 열기

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
그 빈 곳을 Plane UI 안에서 채웁니다. 어느 플랜에서든 되고, Plane 서버는 전혀 건드리지 않습니다.
Plane Cloud와 자체 호스팅 모두에서 동작하며, 릴리스마다 양쪽 실제 인스턴스에서 확인합니다.

✨ 무엇을 제공하나 — 한눈에
⚡ 바로 열기 — 키로 작업 항목에 닿기: 주소창, 팝업, 우클릭
📝 이슈 템플릿 — 제목과 본문을 한 번에 채우기
📋 참조 복사 — 메신저, PR, 브랜치명으로 항목 넘기기
📐 폭·스타일 규칙 — 잘린 이름을 온전히 보기
🧘 집중 모드 — 측면 패널 치우기
🎯 요소 피커 — DevTools 없이 규칙 만들기
🔄 템플릿 동기화 — 팀 전체가 한 벌의 템플릿을
전부 요청하기 전까지는 꺼져 있거나, 비어 있거나, 아무 일도 하지 않습니다.

⚡ 키만 입력해 작업 항목 열기 — 바로 열기
주소창에 "issue"를 입력하고 한 칸 띄운 뒤 PROJ-142 같은 키를 넣으면 Enter로 열립니다.
같은 입력칸이 툴바 팝업에도 있고, 두 곳 모두 최근에 연 항목을 보여 줍니다.
키는 키의 모습으로 오지 않습니다. Slack 메시지나 풀 리퀘스트 제목처럼 문장 속에 섞여 옵니다.
그 부분을 드래그하고 우클릭해 "선택한 텍스트에서 작업 항목 열기"를 고르세요 — 입력할 것도, 따로 준비할 것도 없습니다.
링크 설정은 붙여넣기 한 번입니다. 열어 둔 작업 항목의 주소를 복사해 붙여넣으면 검색 주소까지 그대로 나옵니다.
Plane, Jira, Linear, GitHub, GitLab은 이름으로 알아보고, 여러 개를 함께 둘 수 있습니다(ENG-는 Linear로, 나머지는 Plane으로).
키 대신 낱말을 넣으면 검색으로 갑니다.
URL만 열기 때문에 사이트 접근 권한을 전혀 요청하지 않고, 어느 탭에서나 동작합니다.

📝 작업 항목을 한 번에 채우기 — 이슈 템플릿(제목 + 본문)
템플릿을 한 번 등록해 두면 어떤 작업 항목에도 클릭 한 번으로 넣습니다 — 제목과 본문을 함께.
설명 툴바와 "신규 작업항목 생성" 창에 네이티브 "Template" 버튼이 붙습니다(Alt/⌥+T).
본문은 마크다운입니다 — 제목, 목록, 체크박스.
삽입할 때 변수가 채워집니다 — {{date}}, 마감일용 {{date+7}}, {{week}}, {{month}}, 그리고 직접 만든 변수 5개까지.
Plane 자체의 작업 항목 템플릿은 Pro 기능입니다. 이 템플릿은 무료 자체 호스팅을 포함해 어느 인스턴스에서든 동작합니다.

📋 작업 항목을 한 번에 넘기기 — 참조 복사
작업 항목 번호 옆 버튼(또는 Alt/⌥+C)이 일반 텍스트, 마크다운 링크, 브랜치명 중 원하는 형식으로 클립보드에 담습니다.
모든 형식은 직접 고쳐 쓸 수 있는 줄이고, 설정의 미리보기가 곧 클립보드에 담길 내용입니다.
항목 자신의 화면에서도, 목록에서 열리는 미리보기 패널에서도, 링크를 등록해 둔 트래커라면 툴바 팝업에서도 됩니다.

📐 이름을 온전히 보기 — 스타일 규칙
Plane은 목록과 드롭다운에서 긴 이름을 잘라 어느 항목인지 구분하기 어렵게 만듭니다.
"선택자 → 속성 → 값" 규칙 하나로 원하는 폭을 지정하면 이름이 돌아옵니다.
범용 CSS 엔진이라 버전이 바뀌어 클래스명이 달라져도 선택자만 고치면 됩니다.
규칙이 아무것도 찾지 못하게 되면 설정이 알려 줍니다. 개편이 있어도 기능이 조용히 사라지지 않고 고칠 줄 하나로 드러납니다.

🧘 본문만 남기기 — 집중 모드
Alt+Shift+F(macOS는 ⌥+⇧+F)로 속성 패널과 왼쪽 내비게이션을 숨기면 본문만 남습니다. 작업 항목 번호 옆 토글과 팝업 스위치로도 됩니다.
Plane은 그 속성 패널을 오른쪽에 고정해 두고 접는 방법을 주지 않는데, 이 기능이 접어 줍니다.
어떤 규칙이든 "집중 모드에서만 적용"으로 표시할 수 있어 무엇을 숨길지는 직접 정합니다.
켠 탭에서만 적용되고 그 탭에서는 새로 고쳐도 유지되며, 다른 기기로는 동기화되지 않습니다.

🎯 DevTools 없이 규칙 만들기 — 비주얼 요소 피커
팝업에서 "요소 선택 → 규칙 추가"를 누르고 Plane 화면의 요소를 클릭하세요.
후보 선택자가 "다음 달에도 살아 있을까" 순서로, 매칭 개수와 함께 나옵니다. 빌드가 만든 것은 색이 아니라 "곧 바뀜"이라는 말로 적힙니다.

🔄 팀 전체가 한 벌의 템플릿을 — 팀 템플릿 동기화
JSON 파일 하나(사내 서버, Git 호스트, 아무 URL이나)를 가리키면 팀 전체가 같은 템플릿을 씁니다.
기본은 꺼져 있고, 직접 등록한 URL만 선택한 주기로 또는 즉시 받아 옵니다.
삽입은 로컬 캐시에서 읽으므로 오프라인에서도 되고, 동기화된 템플릿은 읽기 전용이라 누구의 편집도 덮이지 않습니다.
처음이라면 "예시 사용해 보기"가 살아 있는 피드를 채워 넣어 바로 확인할 수 있습니다.

🏠 쓰는 곳이 어디든
쓰는 도메인을 추가하세요 — plane.your-company.com도, app.plane.so도 됩니다. 와일드카드(*.example.com)도 지원합니다.
자체 호스팅에서 출발했고, Plane Cloud도 릴리스마다 실제 인스턴스에서 확인합니다. 둘은 같은 화면을 같은 방식으로 그리지 않기 때문입니다.
설치 시점에는 사이트 접근 권한이 하나도 없습니다. 도메인을 켜면 Chrome이 그 사이트 하나를 묻고, 그 외의 사이트에서는 완전히 비활성입니다.
설정은 JSON 파일로 백업해 다른 기기에서 되돌릴 수 있습니다.

🔒 개인정보 — 브라우저 밖으로 나가지 않습니다
계정도, 추적도, 분석도, 서버도 없습니다.
설정은 브라우저 자체 저장소에 보관되고, Chrome 동기화를 쓰는 경우에만 본인 Google 계정으로 동기화됩니다.
익스텐션이 보내는 요청은 하나뿐입니다 — 직접 등록한 URL에서 팀 템플릿 파일을 내려받는 것. 그 요청에도 사용자의 데이터는 담기지 않습니다.

🚀 시작하기
1. 쓰는 Plane을 엽니다 — 자체 호스팅이든 Plane Cloud든.
2. 툴바 아이콘을 눌러 "이 사이트에서 사용"을 클릭합니다(Chrome 프롬프트에서 접근 허용).
3. 설정에서 열어 둔 작업 항목의 주소를 붙여넣으세요. 이 붙여넣기 한 번으로 열기와 검색, 복사가 한꺼번에 준비됩니다.
4. 템플릿과 폭 규칙은 필요할 때 추가하면 됩니다. 나머지는 전부 선택 사항입니다.

오픈소스입니다. 피드백과 이슈를 환영합니다.

makeplane / plane.so — 프로젝트 관리와 이슈, 위키를 함께 다루는 오픈소스 도구이자 Jira의 자체 호스팅 대안인 Plane에서 동작합니다.
독립적인 비공식 애드온입니다. Plane과 제휴하거나 승인받지 않았으며 "Plane"은 해당 소유자의 상표입니다. (비행기와는 무관합니다.)

---

### 단일 목적 / 권한 정당화 (심사 폼)
심사 폼(단일 목적, 권한 정당화, 데이터 사용)은 Google 리뷰어를 위해 **영문 그대로
제출**하세요. 위 영문 섹션을 사용하면 됩니다. 한국어 번역이 반드시 필요한 칸은
아닙니다.

---

## Real captures vs drawn templates

Two kinds of image live here, and the difference matters when you go to replace one.

`screenshot-*.html` and `promo-*.html` are **illustrations**: every pixel, including the
window frame and the address bar, is drawn in CSS. That is the only way to picture the
omnibox at all — the dropdown Chrome shows under the address bar is browser UI, outside
every page's viewport, so no page-level tool can photograph it. It also means those images
are only as honest as whoever drew them, and they date the moment the product moves.

`ui/*.png` are **real**: `node store-assets/capture-ui.js` renders the shipped `popup.html`
and `options.html`, with the shipped CSS byte for byte, in a real browser at 2x. Only
`chrome` is stubbed — the same technique `tools/dom-harness.js` asserts against — so these
cannot drift from the product without the checks noticing first. Prefer embedding these in a
template over drawing our own UI a second time.

The seed in `capture-ui.js` is invented on purpose (`acme.atlassian.net`, PROJ-142). A store
image is published for as long as the listing exists, and a real workspace's project names,
item titles and colleagues' avatars are not ours to publish.

What still needs a human with a screen recorder: the omnibox dropdown, the toolbar popup as
Chrome frames it, and the in-page buttons on a workspace whose contents are safe to show.

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

Every screenshot is generated, not hand-composited. Each `screenshot-N-*.html` is a
1280×800 page sharing `shot.css` and `shot.js` (the brand mark there is the real path
from `icons/icon.svg`), and carries its own copy for both languages in a `window.T`
block, applied by `?lang=`. One layout serves both listings, so a fix to a mock cannot
land in one language and not the other:

    sh store-assets/render.sh        # every capture and promo tile, both languages
    sh store-assets/render.sh 4      # just screenshot-4-*
    sh store-assets/render.sh promo  # just the promo tiles

The promo tiles work the same way, except each carries its size in its filename
(`promo-<name>-<W>x<H>.html`) and is rendered at exactly that — `shot.css` fixes the
capture canvas at 1280×800, so a tile overrides it. Both tiles have a source, so every
published asset here can be regenerated from the repo — nothing is hand-composited. The
tiles are dark where the captures are light: `#121212` is half the brand, the white mark
reads best on it, and a dark tile is what separates this listing from a grid of pale ones.
They pull `../icons/icon.svg` directly rather than a copy of its path, so a tile and the
icon beside it in the store cannot drift apart.

What is translated and what is quoted differ. Headlines, ledes and captions are ours to
write in each language. The strings inside a mocked menu are not: "＋ 템플릿 관리",
"1개 일치", "선택자로 규칙 만들기" are copied from `_locales/ko/messages.json`, because a
poster showing a Korean UI the extension does not render is a promise it cannot keep.
Sample templates and item titles are user content, so those are written in the reader's
language.

Keep the mocks honest — they must show what the extension currently draws. Capture 1's
menu once still showed a "TEMPLATES (TITLE + BODY)" header that the picker had long
stopped rendering, and no "＋ Manage templates" footer, which the picker had gained.
When the UI moves, re-render.

None of this ships: release.yml lists the packaged files explicitly and store-assets is
not among them.

## Packaging

CI builds the upload zip automatically — bump `version` in manifest.json, push to
`main`, and `.github/workflows/release.yml` publishes a GitHub Release with
`enhancer-for-plane-<version>.zip` (only the shipping files; store-assets, docs,
LICENSE, .github, and icons/icon.svg are excluded). Download that zip and upload
it in the dashboard.

To build the same zip locally instead (run from the repo root):

  zip -r "enhancer-for-plane-$(jq -r .version manifest.json).zip" \
      manifest.json common.js content.js content.css background.js \
      options.html options.js options.css popup.html popup.js popup.css icons _locales \
      -x "icons/icon.svg"
