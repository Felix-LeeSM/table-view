---
id: 0059
title: UI i18n — react-i18next + surface별 inline namespace (ko/en)
status: Accepted
date: 2026-07-25
supersedes: null
superseded_by: null
---

**결정**: 앱 UI 다국어화(#1074, 2026-07-02 오너결정 = i18n 지원 확정, ko/en 2 locale)의 i18n 라이브러리·구성·키 조직 계약을 확정한다. **이 ADR 은 소급 문서화(retroactive)다** — 결정은 이미 구현되어 shipped 되었고(#1004 인프라 + 언어 전환 UI, #1005 surface별 namespace 전량 전환, #1006 hooks/lib toast 마무리; 후속 #1227 error 번역, #1581 잔여 영어 제거, #1582 en/ko key parity 가드, #1621 orphan key 정리), 라이브러리 선택 근거가 ADR 로 남지 않은 gap 을 이 ADR 이 메운다. 결정 자체를 되돌리지 않는다. **(결정 1 — 라이브러리)** UI 문자열 번역 라이브러리로 **react-i18next**(`react-i18next@^17`, `i18next@^26`)를 채택한다. FormatJS/react-intl, LinguiJS 는 미채택(이유 §참조). **(결정 2 — locale 세트·기본값)** 지원 locale 은 `SUPPORTED_LOCALES = ["en", "ko"]` 2종, `DEFAULT_LOCALE = "en"`(= `fallbackLng`), `defaultNS = "common"`. boot 시 `applyPersistedLocale()` 이 SQLite 영속 locale(setting key `"locale"`)을 첫 render 전에 적용해 언어 flash 를 막는다(theme reconcile 과 동일 위치, `src/main.tsx:88`). ko 를 1차 타깃 언어로 보되 코드상 초기 fallback 은 `en` 이고 사용자 선택은 SQLite SOT 로 영속된다. **시스템 locale 자동 감지는 미구현 — 후속(§트레이드오프).** **(결정 3 — 리소스 조직: surface별 inline namespace)** 번역 리소스는 `src/lib/i18n/locales/<namespace>.ts` 파일 1개 = 1 namespace 로 분할하고, 각 파일이 `en`/`ko` 를 **named export** 한다. `src/lib/i18n/index.ts` 가 `import.meta.glob(["./locales/*.ts", "!./locales/*.test.ts"], { eager: true })` 로 빌드 타임에 모두 로드해 **동기 init** 한다 — 파일명(확장자 제외)이 곧 namespace 이름이고, 컴포넌트는 `useTranslation("<namespace>")` 로 접근한다. 인라인 리소스라 비동기 로드/`Suspense` 경계가 없다(`react.useSuspense: false`), React 가 이미 출력을 escape 하므로 `interpolation.escapeValue: false`. **(결정 4 — 언어 전환 UI + 키 무결성)** 언어 전환은 `src/components/theme/LanguageSwitcher.tsx`(ToggleGroup en/한국어, optimistic `i18n.changeLanguage` + `persistSettingValue(LOCALE_SETTING_KEY, ...)` fire-and-forget, ThemePicker 와 동일 패턴)로 제공한다. en/ko namespace 간 키 parity 는 테스트(#1582)가 강제해 drift 를 CI 에서 차단한다. **(범위 밖 — 구현 소관)** locale 텍스트 자체의 문구·개별 namespace 분할 경계·향후 locale 추가(3번째 언어)·자동 키 추출 도구·시스템 locale 감지는 이 ADR 범위 밖이다.

**이유**:

1. **react-i18next 가 React + Tauri 로컬 앱에 가장 낮은 마찰이다 (결정 1)** — `useTranslation` 훅이 React 렌더에 native 통합되어 컴포넌트 layer 에 별도 provider 배선 없이 붙고(전역 singleton init), i18next 코어는 런타임이 가볍다. inline resource 를 **동기** init 할 수 있어 번들에 리소스를 넣고 네트워크/파일 비동기 로드 없이 부팅 — Tauri 데스크톱(오프라인 우선, 로컬 앱) 에 정확히 맞고, 첫 render 전 언어 확정으로 FOUC/언어 flash 를 없앤다. namespace 분리가 1급 기능이라 결정 3 의 surface 분할과 자연 정합.
2. **대안 미채택 근거 (결정 1)**:
   - **FormatJS / react-intl** — ICU MessageFormat 의 복수/성별/선택 메시지가 가장 강력하지만, `<FormattedMessage>`/`defineMessages` API 가 verbose 하고 babel/컴파일 플러그인 기반 추출·번들 통합이 무겁다. 이 앱의 문자열은 대부분 단순 치환이라 ICU 의 표현력이 비용을 정당화하지 못한다.
   - **LinguiJS** — 컴파일 기반 catalog 추출/압축이 우수하나 매크로(`t`/`Trans`)와 빌드 파이프라인(CLI extract/compile) 통합이 추가 빌드 스텝을 강제한다. inline TS resource + glob 자동 등록으로 별도 추출 스텝 없이 가는 이 프로젝트의 저마찰 목표와 어긋난다.
   - **react-i18next** — 최소 런타임 + 훅 통합 + namespace native + 동기 inline init 이 세 후보 중 이 앱의 제약(React 19, Tauri offline, 데스크톱 동기 부팅)에 가장 부합해 채택.
3. **surface별 inline namespace 가 마이그레이션 병렬화의 merge conflict 를 원천 차단한다 (결정 3)** — #1074 는 전 repo 하드코딩 문자열을 여러 PR/작업자가 병렬로 키 전환해야 했다. 단일 거대 리소스 파일이면 모든 작업자가 같은 파일을 편집해 merge conflict 가 폭증한다. 파일=namespace 로 쪼개고 `import.meta.glob` 로 자동 등록하면, surface 를 추가/이주할 때 `index.ts`(등록부)를 건드릴 필요가 없어 공유 파일 충돌이 0 이 된다(`src/lib/i18n/index.ts` 주석의 설계 근거). `*.test.ts` 를 glob 에서 제외하는 것은 파일명=namespace 계약상 locales/ 안 테스트 파일이 namespace 로 오인 import 되어 부팅이 깨지는 회귀(#1227)를 막기 위함이다.
4. **SQLite 영속 + 첫 render 전 적용이 theme 선례를 계승한다 (결정 2)** — locale 을 ADR 0038(Theme/SafeMode SOT — SQLite truth)의 영속 패턴에 얹어 SQLite 를 SOT 로 삼고, boot 의 `applyPersistedLocale()` 이 theme reconcile 과 같은 위치에서 첫 render 전에 언어를 확정한다. 손상된 영속값/IPC 실패는 삼키고 `DEFAULT_LOCALE` 로 진행해 부팅을 막지 않는다. LanguageSwitcher 의 optimistic 전환도 ThemePicker 와 동일 UX 라 사용자 멘탈 모델이 일관된다.

**트레이드오프**:

- **+** React-native 훅 통합 + 최소 설정 + 동기 inline init → Tauri offline/데스크톱 부팅에 정합, 언어 flash 없음.
- **+** surface별 namespace + glob 자동 등록 → 병렬 마이그레이션 merge conflict 0, surface 추가 시 등록부 무수정.
- **+** SQLite SOT + 첫 render 전 reconcile 은 ADR 0038 theme 선례 계승 — 신규 영속/부팅 정책 면적 최소.
- **+** en/ko key parity 테스트(#1582)로 번역 drift 를 CI 에서 차단.
- **−** **ICU 표현력 제한** — 복잡한 복수/성별/서수 규칙은 i18next 의 plural 기능으로 제한적이라, react-intl 의 full ICU MessageFormat 대비 약하다. 현 UI 문자열엔 충분하나 미래에 복잡 복수형이 늘면 재검토 지점.
- **−** **자동 키 추출 도구 없음** — inline namespace 파일을 수동 관리하며, 소스에서 키를 자동 추출하지 않는다. 신규 하드코딩이 다시 새는 위험은 #1074 의 하드코딩 lint 가드(`eslint.config.js` no-restricted-syntax JSXText + user-facing 속성)로 보완하고, 잔여 미전환 surface 는 phased rollout 으로 편입한다.
- **−** **시스템 locale 자동 감지 미구현** — 초기 fallback 이 `en` 고정이라 ko 사용자도 첫 부팅은 영어이고, LanguageSwitcher 로 ko 선택 후에야 SQLite 에 영속된다. 오너의 "ko 1차" 의도와 코드 현실의 간극으로, OS locale 감지(예 `en-US`→en, `ko-KR`→ko)는 후속 과제다.
- **재개 트리거**: 본 ADR 은 라이브러리(react-i18next)·locale 세트(en/ko)·리소스 조직(surface별 inline namespace)·언어 전환 UI 계약만 동결한다. 라이브러리를 교체(예 react-intl/Lingui 로 전환)하거나 리소스를 단일 파일/비동기 로드로 뒤집으려면 새 ADR + Supersede. 3번째 locale 추가·시스템 locale 감지·자동 키 추출 도구 도입은 이 계약 위의 후속 구현으로, supersede 대상이 아니다.

**관련**:

- issue #1074 — UI 언어 전략(영어 하드코딩 + i18n 인프라). 본 ADR 이 라이브러리 결정 gap 을 소급 문서화하고, 잔여 2 gap(ADR + 하드코딩 lint 가드) 중 ADR 을 마감. 인프라·전량 전환·언어 전환 UI 는 #1004~#1006 에서 이미 shipped.
- PR #1004 — react-i18next 인프라 도입(ko/en) + 언어 전환 UI. 본 결정의 최초 구현.
- PR #1005 — 하드코딩 UI 문자열을 surface별 namespace(ko/en)로 전량 전환.
- PR #1006 — hooks/lib toast 전환 + ImportExportDialog 마무리.
- ADR 0038 — Theme/SafeMode SOT(SQLite truth). locale 영속이 계승하는 SQLite SOT + 첫 render 전 reconcile 선례.
- ADR 0036 — Telemetry 수집 0. locale 선호도 로컬 영속만, 외부 전송 없음(privacy contract 정합).
- `src/lib/i18n/index.ts` — react-i18next init(`SUPPORTED_LOCALES`·`DEFAULT_LOCALE`·`applyPersistedLocale`), `import.meta.glob` eager namespace 자동 등록.
- `src/lib/i18n/locales/*.ts` — surface별 namespace 파일(각 `en`/`ko` named export). 파일명 = namespace.
- `src/main.tsx:88` — boot 시 `applyPersistedLocale()` 로 첫 render 전 언어 확정.
- `src/components/theme/LanguageSwitcher.tsx` — 언어 전환 UI(optimistic changeLanguage + SQLite persist).
- `eslint.config.js` — #1074 하드코딩 UI 문자열 lint 가드(JSXText + user-facing 속성) + phased-exempt 블록.
