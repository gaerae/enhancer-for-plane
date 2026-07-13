# Chrome Web Store — Listing copy (Enhancer for Plane)

> **Published:** https://chromewebstore.google.com/detail/dicjfphghjfljkifogkplgdeefjdkhbo

Paste these into the Web Store Developer Dashboard fields. The English listing is the default (below); the Korean translation is in the "한국어 (Korean listing)" section near the end.

**Formatting note:** the Detailed description is laid out one sentence per line, grouped under short feature headers, with blank lines between sections. The store's description field preserves these line breaks literally — so it pastes exactly as shown here: scannable, with no mid-sentence wrapping. Paste as-is; don't re-flow the lines.

> How Korean shows up in the store: the Web Store offers a separate per-language
> listing tab only if the package ships a `_locales/<lang>` directory with a
> `default_locale`. This package now ships `_locales/en` (default) and
> `_locales/ko` — so the store recognizes English + Korean, and the extension's
> own name/description are localized (Korean users see "Enhancer for Plane —
> 프로젝트·위키·이슈"). In the dashboard, set the default listing to English and
> add a Korean listing (Store listing ▸ language selector) using the Korean
> summary + description below. Full in-extension UI i18n (options/popup strings)
> is still intentionally out of scope for now.

---

## Product name  (max 75)
Enhancer for Plane — Projects, Wiki & Issues

## Summary / short description  (max 132)
One-click title + body templates and width rules for Plane (makeplane) — the open-source project management, issues & wiki tool.

## Category
Developer Tools  (alternative: Workflow & Planning)

## Language
English

---

## Detailed description  (max 16,000)

Enhancer for Plane is a lightweight companion for Plane (makeplane / plane.so) — the open-source project management, issues, and wiki tool, and a self-hosted alternative to Jira.
It fixes small day-to-day annoyances right in the Plane UI, with no changes to your Plane server.

Not affiliated with or endorsed by Plane. "Plane" is a trademark of its owner; this is an independent, unofficial add-on. (And no — nothing to do with airplanes.)

WHAT IT DOES

▸ Title + body templates
Register reusable templates and insert them in one click.
A native "Template" button sits in the description toolbar — and in the "Create work item" dialog, next to the project selector, so new items start fast.
One click fills the work-item title AND the description together.
Bodies are Markdown, rendered into the editor: headings, bullet and numbered lists, checkboxes.
Variables on insert: {{date}}, {{date+N}} / {{date-N}} (e.g. {{date+7}} for a deadline), {{week}}, {{month}}.
Shortcut: Alt/⌥+T.

▸ Width & style rules
Plane truncates long names — modules, cycles, labels, breadcrumbs.
In lists and search dropdowns that makes items impossible to tell apart.
Add a simple "selector → property → value" rule to force any width (e.g. 320px, 30rem), and names show in full.
It's a generic CSS engine: target any element, and if Plane's class names change between versions, just edit the selector.

▸ Visual element picker
No DevTools needed.
Click "Pick element" in the popup, then click any part of Plane.
You get a candidate selector list with match counts (width classes first).
The rule lands in Settings, ready for you to set a value.

▸ Built for self-hosted Plane
Add your Plane instance's domain (e.g. plane.your-company.com) in the popup or Settings.
It ships with no host access; enabling a domain asks Chrome for one-time access to just that site.
It runs only on the domains you enable and stays completely inert everywhere else.
Wildcards (*.example.com) are supported.

▸ Import / Export
Back up all your domains, rules, and templates to a JSON file, and restore them on another machine.

▸ Light & dark mode
The popup and settings follow your system theme and match Plane's monochrome look.

PRIVACY

No accounts, no tracking, no analytics, no external servers.
Your settings live in Chrome's own storage (synced to your Google account by Chrome if you have sync on) and are never sent anywhere else.
See the privacy policy for details.

HOW TO START

1. Open your self-hosted Plane instance.
2. Click the toolbar icon and "Enable on this site" (grant access when Chrome prompts).
3. Open Settings to manage templates and width rules.

Open source. Feedback and issues welcome.

---

## Single purpose  (review form)

Enhancer for Plane has one purpose: to let users customize the Plane (makeplane) project-management web app in their own browser — inserting reusable title/body templates into work items and adjusting element widths via CSS rules — on the Plane instances the user chooses.

---

## Permission justifications  (review form)

storage
  Stores the user's own settings (active domains, style rules, and templates) so they persist across sessions and sync via Chrome. No other data is stored.

activeTab
  When the user clicks the toolbar icon, the popup reads the current tab's hostname to show whether Plane enhancements are active there and to offer "Enable on this site." It also messages the current tab to start the element picker. Access is limited to the tab the user explicitly invoked the extension on.

scripting
  Registers/injects the content script (style rules + template button) on the specific origins the user grants. No script is registered until the user enables a domain.

Optional host permissions (requested per site at runtime, NOT at install)
  Plane can be self-hosted on ANY domain, so the target host is not known at build time and cannot be a fixed match list. The extension therefore declares optional host permissions and requests access to a single origin only when the user enables that domain (via the popup's "Enable on this site" or Settings) — Chrome shows a per-site prompt. It requests no host access at install, holds access only for the domains the user granted, and releases it when a domain is removed. This is the least-privilege way to support arbitrary user-provided self-hosted Plane hosts.

Remote code
  None. All JavaScript and CSS is bundled in the package. Nothing is fetched or eval'd at runtime.

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
Enhancer for Plane — 프로젝트·위키·이슈

> 참고: 스토어 이름은 브랜드 일관성을 위해 영문 "Enhancer for Plane" 유지를
> 권장합니다. 위 한글 병기는 선택 사항입니다.

### 요약 / 짧은 설명 (max 132)
제목·본문 템플릿 원클릭 삽입과 이름 폭 조정 규칙을 오픈소스 프로젝트 관리·이슈·위키 도구 Plane(makeplane)에 추가합니다.

### 카테고리
개발자 도구 (또는 워크플로 및 계획)

### 상세 설명 (max 16,000)

Enhancer for Plane 는 오픈소스 프로젝트 관리·이슈·위키 도구 Plane(makeplane / plane.so) — Jira 의 자체 호스팅 대안 — 을 위한 가벼운 보조 익스텐션입니다.
Plane 서버를 전혀 수정하지 않고, 브라우저에서 매일의 사소한 불편을 바로잡아 줍니다.

Plane 과 제휴하거나 승인받은 제품이 아닙니다. "Plane" 은 해당 소유자의 상표이며, 본 익스텐션은 독립적인 비공식 애드온입니다. (비행기와는 무관합니다.)

주요 기능

▸ 제목 + 본문 템플릿
자주 쓰는 템플릿을 등록해 한 번의 클릭으로 삽입합니다.
설명 툴바의 네이티브 "Template" 버튼, 그리고 "신규 작업항목 생성" 창의 프로젝트 선택기 옆에서도 동작해 새 항목을 빠르게 시작합니다.
한 번의 클릭으로 작업 항목의 제목과 본문을 함께 채웁니다.
본문은 마크다운으로 작성되어 에디터에 제목·목록·체크박스로 렌더됩니다.
삽입 시 변수 치환: {{date}}(오늘), {{date+N}} / {{date-N}}(예: 마감일 {{date+7}}), {{week}}(이번 주 범위), {{month}}.
단축키: Alt/⌥+T.

▸ 폭·스타일 규칙
Plane 은 긴 이름(모듈·사이클·라벨·브레드크럼)을 잘라서 보여줍니다.
그래서 목록이나 검색 드롭다운에서 어느 항목인지 구분하기 어렵습니다.
"선택자 → 속성 → 값" 규칙으로 원하는 폭(예: 320px, 30rem)을 지정하면 이름이 온전히 표시됩니다.
범용 CSS 엔진이라 어떤 요소든 대상이 되고, 버전이 바뀌어 클래스명이 달라져도 선택자만 고치면 됩니다.

▸ 비주얼 요소 피커
DevTools 가 필요 없습니다.
팝업에서 "Pick element" 를 누르고 Plane 화면의 요소를 클릭하세요.
각 선택자의 매칭 개수와 함께 후보 목록이 뜹니다(폭 관련 클래스 우선).
고른 규칙은 설정에 추가되고, 값만 입력하면 됩니다.

▸ 자체 호스팅 Plane 전용
팝업이나 설정에서 자신의 Plane 인스턴스 도메인(예: plane.your-company.com)을 추가하세요.
설치 시 호스트 접근 권한이 없고, 도메인을 활성화하면 Chrome 이 그 사이트 하나에 대한 1회성 접근을 묻습니다.
활성화한 도메인에서만 동작하고, 그 외 모든 사이트에서는 완전히 비활성 상태로 남습니다.
와일드카드(*.example.com)도 지원합니다.

▸ 가져오기 / 내보내기
도메인·규칙·템플릿 전체를 JSON 파일로 백업하고 다른 기기에서 복원할 수 있습니다.

▸ 라이트 & 다크 모드
팝업과 설정이 시스템 테마를 따르며 Plane 의 모노크롬 톤과 어울립니다.

개인정보

계정·추적·분석·외부 서버가 없습니다.
설정은 브라우저 자체 저장소(chrome.storage)에 보관됩니다(동기화가 켜져 있으면 본인 Google 계정으로 동기화).
그 외 어디로도 전송되지 않습니다. 자세한 내용은 개인정보 처리방침을 참고하세요.

시작하기

1. 자체 호스팅 Plane 인스턴스를 엽니다.
2. 툴바 아이콘을 눌러 "Enable on this site" 를 클릭합니다(Chrome 프롬프트에서 접근 허용).
3. 설정에서 템플릿과 폭 규칙을 관리합니다.

오픈소스입니다. 피드백과 이슈를 환영합니다.

### 단일 목적 / 권한 정당화 (심사 폼)
심사 폼(단일 목적, 권한 정당화, 데이터 사용)은 Google 리뷰어를 위해 **영문 그대로
제출**하세요. 위 영문 섹션을 사용하면 됩니다. 한국어 번역이 반드시 필요한 칸은
아닙니다.

---

## Assets checklist

• Store icon 128×128 ............ icons/icon128.png ✓
• Screenshot 1 (1280×800) ....... store-assets/screenshot-1-templates.png ✓  ← lead with templates (the biggest gain over stock Plane)
• Screenshot 2 (1280×800) ....... store-assets/screenshot-2-width.png ✓
• Screenshot 3 (1280×800) ....... store-assets/screenshot-3-picker.png ✓
  (Upload in this order so the store carousel opens on templates.)
• Small promo tile 440×280 ...... store-assets/promo-small-440x280.png ✓
• Marquee 1400×560 (optional) ... not provided (optional)

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
