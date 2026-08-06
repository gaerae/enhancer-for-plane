# Chrome Web Store — Listing copy (Enhancer for Plane)

> **Published:** https://chromewebstore.google.com/detail/dicjfphghjfljkifogkplgdeefjdkhbo

Paste these into the Web Store Developer Dashboard fields. The English listing is the default (below); the Korean translation is in the "한국어 (Korean listing)" section near the end.

**Formatting note:** the Detailed description is laid out one sentence per line, grouped under short feature headers, with blank lines between sections. The store's description field preserves these line breaks literally — so it pastes exactly as shown here: scannable, with no mid-sentence wrapping. Paste as-is; don't re-flow the lines.

> How Korean shows up in the store: the Web Store offers a separate per-language
> listing tab only if the package ships a `_locales/<lang>` directory with a
> `default_locale`. This package now ships `_locales/en` (default) and
> `_locales/ko` — so the store recognizes English + Korean, and the extension's
> own name/description are localized (Korean users see "Enhancer for Plane — 이슈 템플릿 & 바로 열기"). In the dashboard, set the default listing to English and
> add a Korean listing (Store listing ▸ language selector) using the Korean
> summary + description below, and its own screenshots — the `*.ko.png` set in
> store-assets (screenshots are stored per language, so the Korean tab does not
> inherit the English ones). The extension's own UI is fully translated too;
> the Korean captures quote those strings rather than inventing new ones.

---

## Product name  (max 75)
Enhancer for Plane — Issue Templates & Quick Open

> Why this shape: the brand comes first because a name has to be repeatable — "install
> Enhancer for Plane" is something you can say, and a descriptive phrase is not. The half
> after the dash is the searchable one: "Plane" on its own loses to aircraft, and nobody
> types "enhancer", so the two features people actually search for sit where the store can
> index them. "makeplane" and "plane.so" belong in the summary and description rather than
> the name, which they only lengthen. "Jira" stays out of the name too: quick open works
> there, but the other five features need Plane's own pages, and a name must not promise
> otherwise.

> The brand alone — "Enhancer for Plane" — is what the popup and settings headers show
> (extShort), so the thing you install and the thing you point at match.

## Summary / short description  (max 132)
Jump to a work item by key from the address bar. Plus templates, copy reference and full names for Plane (makeplane).

## Category
Developer Tools  (alternative: Workflow & Planning)

## Language
English

---

## Detailed description  (max 16,000)

Every issue tracker leaves the same gaps: no reusable templates, no way to open an item from its key, no way to hand one to a chat message without retyping it. This fills them for Plane (makeplane / plane.so), the open-source Jira alternative — inside the Plane UI, with no changes to your Plane server.

Plane (makeplane / plane.so) is the open-source project management, issues, and wiki tool, a self-hosted alternative to Jira. This is an independent, unofficial add-on — not affiliated with or endorsed by Plane, and "Plane" is a trademark of its owner. (And no — nothing to do with airplanes.)

WHAT YOU GET

▸ Fill a work item in one click — title + body templates
Register a template once, drop it into any work item with one click — title and description together. A native "Template" button sits in the description toolbar and in the "Create work item" dialog, so new items start fast.
Bodies are Markdown: headings, lists, checkboxes. Variables fill themselves in on insert — {{date}}, {{date+7}} for a deadline, {{week}}, {{month}} — plus up to 5 of your own like {{var.team}}.
Shortcut: Alt/⌥+T.

▸ Go straight to a work item — quick open
Type "issue" in the address bar, a space, then a key like PROJ-142, and Enter opens it. The same box is on the toolbar popup.
Each target is a base link you set, with {{key}} where the key belongs — so it works for Plane, and for Jira and Linear alongside it. The key's prefix picks the target: point ENG- at Linear and leave everything else on Plane.
It only opens a URL, so it asks for no site access at all and works on any tab.

▸ Hand off a work item in one click — copy reference
Send a work item to a chat message, a pull request, or a branch name without retyping it. The button beside its ID (or Alt/⌥+C) copies it in the format you pick — plain text, a Markdown link, a branch name — and every format is a row you can edit into your own. The preview in Settings is exactly what lands on the clipboard.
Works from the item's own page and from the preview panel a list opens, so you never leave the list.

▸ Read every name in full — width & style rules
Plane cuts long names off in lists and dropdowns until you can't tell items apart. One "selector → property → value" rule forces any width (320px, 30rem) and names show completely.
It's a generic CSS engine: target any element, and if Plane's class names change between versions, you just edit the selector.

▸ Build rules without DevTools — visual element picker
Click "Pick element" in the popup, then click anything on the Plane page. You get candidate selectors with match counts (width classes first); the rule lands in Settings ready for a value.

▸ One set of templates for the whole team — template sync
Point everyone at one JSON file — your intranet, a Git host, any URL — and the whole team pulls the same templates. It refreshes on the schedule you choose or on demand.
Off by default: it fetches only the URL you add, reads from a local cache so inserting works offline, and synced templates stay read-only so no one's edits get overwritten. New to it? "Try our example" fills in a live feed so you can watch it work.

▸ Built for self-hosted Plane
Add your instance's domain (e.g. plane.your-company.com). It ships with no site access — enabling a domain asks Chrome for that one site — runs only where you allow it, and stays completely inert everywhere else. Wildcards (*.example.com) supported.

▸ Yours to keep — import / export
Back up your domains, rules, templates, variables, copy formats, and sync sources to a JSON file, and restore them on another machine.

▸ Light & dark
The popup and Settings follow your system theme and match Plane's monochrome look.

PRIVACY — nothing leaves your browser
No accounts, no tracking, no analytics, no server. Your settings live in Chrome's own storage (synced to your Google account only if you use Chrome Sync). The one request this extension can make is downloading the team-template file from a URL you added yourself — and it carries none of your data. See the privacy policy for details.

GET STARTED
1. Open your self-hosted Plane instance.
2. Click the toolbar icon and "Enable on this site" (grant access when Chrome prompts).
3. Open Settings to add templates, copy formats, and width rules.

Open source. Feedback and issues welcome.

---

## Single purpose  (review form)

Enhancer for Plane has one purpose: to let users customize the Plane (makeplane) project-management web app in their own browser — inserting reusable title/body templates into work items, copying a work item's own reference to the clipboard in a user-defined format, adjusting element widths via CSS rules, and opening a work item from its key via a user-configured link — on the Plane instances the user chooses.

---

## Permission justifications  (review form)

storage
  Stores the user's own settings (active domains, style rules, templates, user-defined template variables, copy formats, and team-template source URLs) so they persist across sessions and sync via Chrome. Also caches the team templates downloaded from the user's own source URL in storage.local, so the template picker reads from disk instead of the network. No other data is stored, and nothing is sent to the developer.

alarms
  Refreshes team templates on the interval the user selects (hourly to daily). An MV3 service worker is terminated when idle, so a timer cannot survive; chrome.alarms is the only supported way to run a periodic refresh. Used solely to trigger that refresh — no alarm exists unless the user has enabled template sync and added a source.

activeTab
  When the user clicks the toolbar icon, the popup reads the current tab's hostname to show whether Plane enhancements are active there and to offer "Enable on this site." It also messages the current tab to start the element picker. Access is limited to the tab the user explicitly invoked the extension on.

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
> "makeplane"과 "plane.so"는 이름을 길게만 만들어서 요약과 상세 설명에 남겼습니다.
> 이름을 바꿔도 확장 ID와 리스팅 URL은 그대로이므로 리뷰와 설치 수는 유지됩니다.

### 요약 / 짧은 설명 (max 132)
주소창에서 작업 항목 키로 바로 이동. 여기에 Plane용 템플릿·참조 복사·이름 폭 조정까지.

### 카테고리
개발자 도구 (또는 워크플로 및 계획)

### 상세 설명 (max 16,000)

어느 이슈 트래커든 비어 있는 곳은 같습니다 — 재사용할 템플릿이 없고, 키로 항목을 바로 열 방법이 없고, 다시 타이핑하지 않고 메신저로 넘길 방법이 없습니다. 오픈소스 Jira 대안 Plane(makeplane / plane.so)에서 그 빈 곳을 채웁니다. Plane UI 안에서, Plane 서버는 전혀 건드리지 않습니다.

Plane(makeplane / plane.so)은 오픈소스 프로젝트 관리·이슈·위키 도구이자 Jira 의 자체 호스팅 대안입니다. 본 익스텐션은 독립적인 비공식 애드온으로, Plane 과 제휴하거나 승인받지 않았으며 "Plane" 은 해당 소유자의 상표입니다. (비행기와는 무관합니다.)

무엇을 제공하나

▸ 작업 항목을 한 번에 채우기 — 제목 + 본문 템플릿
템플릿을 한 번 등록해 두면 어떤 작업 항목에도 한 번의 클릭으로 넣습니다 — 제목과 본문을 함께. 설명 툴바의 네이티브 "Template" 버튼과 "신규 작업항목 생성" 창에서 동작해 새 항목을 빠르게 시작합니다.
본문은 마크다운입니다: 제목·목록·체크박스. 삽입 시 변수가 알아서 채워집니다 — {{date}}, 마감일용 {{date+7}}, {{week}}, {{month}} — 그리고 {{var.team}}처럼 직접 만든 변수 최대 5개.
단축키: Alt/⌥+T.

▸ 키만 입력해 작업 항목 열기 — 바로 열기
주소창에 "issue"를 입력하고 한 칸 띄운 뒤 PROJ-142 같은 키를 입력하면 Enter로 열립니다. 같은 입력칸이 툴바 팝업에도 있습니다.
대상마다 기본 링크를 하나씩 정하고 키가 들어갈 자리에 {{key}}를 넣습니다. 그래서 Plane은 물론 Jira와 Linear도 함께 씁니다. 키의 접두사가 대상을 고르므로, ENG-는 Linear로 보내고 나머지는 Plane에 둘 수 있습니다.
URL만 열기 때문에 사이트 접근 권한을 전혀 요청하지 않고, 어느 탭에서나 동작합니다.

▸ 작업 항목을 한 번에 넘기기 — 참조 복사
작업 항목을 메신저, 풀 리퀘스트, 브랜치명으로 다시 타이핑 없이 넘기세요. 번호 옆 버튼(또는 Alt/⌥+C)이 원하는 형식으로 복사합니다 — 일반 텍스트, 마크다운 링크, 브랜치명 — 그리고 모든 형식은 직접 고쳐 쓸 수 있는 줄입니다. 설정의 미리보기가 곧 클립보드에 담길 내용입니다.
항목 자신의 화면에서도, 목록에서 열리는 미리보기 패널에서도 동작하므로 목록을 벗어날 필요가 없습니다.

▸ 이름을 온전히 보기 — 폭·스타일 규칙
Plane 은 목록과 드롭다운에서 긴 이름을 잘라, 어느 항목인지 구분하기 어렵게 만듭니다. "선택자 → 속성 → 값" 규칙 하나로 원하는 폭(320px, 30rem)을 지정하면 이름이 온전히 보입니다.
범용 CSS 엔진이라 어떤 요소든 대상이 되고, 버전이 바뀌어 클래스명이 달라져도 선택자만 고치면 됩니다.

▸ DevTools 없이 규칙 만들기 — 비주얼 요소 피커
팝업에서 "Pick element" 를 누르고 Plane 화면의 요소를 클릭하세요. 매칭 개수와 함께 후보 선택자가 뜨고(폭 관련 클래스 우선), 규칙은 값만 넣으면 되는 상태로 설정에 담깁니다.

▸ 팀 전체가 한 벌의 템플릿을 — 팀 템플릿 동기화
JSON 파일 하나(사내 서버·Git 호스트·아무 URL)를 가리키면 팀 전체가 같은 템플릿을 씁니다. 선택한 주기로, 또는 즉시 갱신됩니다.
기본은 꺼져 있습니다: 직접 등록한 URL만 받아 오고, 로컬 캐시에서 읽어 오프라인에서도 삽입되며, 동기화된 템플릿은 읽기 전용이라 누구의 편집도 덮이지 않습니다. 처음이라면 "예시 사용해 보기" 가 살아 있는 피드를 채워 넣어 바로 확인할 수 있습니다.

▸ 자체 호스팅 Plane 전용
자신의 인스턴스 도메인(예: plane.your-company.com)을 추가하세요. 설치 시 사이트 접근 권한이 없고 — 도메인을 켜면 Chrome 이 그 사이트 하나를 묻습니다 — 허용한 곳에서만 동작하며 그 외에는 완전히 비활성입니다. 와일드카드(*.example.com)도 지원합니다.

▸ 내 것으로 보관 — 가져오기 / 내보내기
도메인·규칙·템플릿·변수·복사 형식·동기화 소스를 JSON 파일로 백업하고 다른 기기에서 복원합니다.

▸ 라이트 & 다크
팝업과 설정이 시스템 테마를 따르며 Plane 의 모노크롬 톤과 어울립니다.

개인정보 — 브라우저 밖으로 나가지 않습니다
계정·추적·분석·서버가 없습니다. 설정은 브라우저 자체 저장소(chrome.storage)에 보관되고, Chrome 동기화를 쓰는 경우에만 본인 Google 계정으로 동기화됩니다. 익스텐션이 보내는 유일한 요청은 사용자가 직접 등록한 URL에서 팀 템플릿 파일을 내려받는 것이며, 그 요청에는 사용자의 데이터가 담기지 않습니다. 자세한 내용은 개인정보 처리방침을 참고하세요.

시작하기
1. 자체 호스팅 Plane 인스턴스를 엽니다.
2. 툴바 아이콘을 눌러 "Enable on this site" 를 클릭합니다(Chrome 프롬프트에서 접근 허용).
3. 설정에서 템플릿·복사 형식·폭 규칙을 추가합니다.

오픈소스입니다. 피드백과 이슈를 환영합니다.
### 단일 목적 / 권한 정당화 (심사 폼)
심사 폼(단일 목적, 권한 정당화, 데이터 사용)은 Google 리뷰어를 위해 **영문 그대로
제출**하세요. 위 영문 섹션을 사용하면 됩니다. 한국어 번역이 반드시 필요한 칸은
아닙니다.

---

## Assets checklist

• Store icon 128×128 ............ icons/icon128.png ✓
• Screenshot 1 (1280×800) ....... store-assets/screenshot-1-templates.png ✓
• Screenshot 2 (1280×800) ....... store-assets/screenshot-2-open.png ✓
• Screenshot 3 (1280×800) ....... store-assets/screenshot-3-copy.png ✓
• Screenshot 4 (1280×800) ....... store-assets/screenshot-4-width.png ✓
• Screenshot 5 (1280×800) ....... store-assets/screenshot-5-picker.png ✓
• The same five, Korean listing .. store-assets/screenshot-*.ko.png ✓
  (Upload in file order — the number in the filename IS the carousel position, so
  moving a capture means renumbering the file. Templates opens because it is the
  picture that says what this is; quick open follows because it is the thing a
  visitor can use a second after installing; then the two everyday actions, then
  the two that shape the page. The name, the description and the carousel now run
  in the same order — keep all three in step when one of them moves.)
• Small promo tile 440×280 ...... store-assets/promo-small-440x280.png ✓
• Marquee 1400×560 (optional) ... not provided (optional)

The Korean listing gets its own set: `screenshot-N-*.ko.png`. The store keeps screenshots
per language, so a Korean visitor sees Korean captures — which is the point of shipping
`_locales/ko` at all. Upload them in the same order under Store listing ▸ 한국어.

Every screenshot is generated, not hand-composited. Each `screenshot-N-*.html` is a
1280×800 page sharing `shot.css` and `shot.js` (the brand mark there is the real path
from `icons/icon.svg`), and carries its own copy for both languages in a `window.T`
block, applied by `?lang=`. One layout serves both listings, so a fix to a mock cannot
land in one language and not the other:

    sh store-assets/render.sh        # all four, both languages
    sh store-assets/render.sh 4      # just screenshot-4-*

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
