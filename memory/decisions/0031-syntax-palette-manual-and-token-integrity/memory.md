---
id: 0031
title: Syntax palette — manual themes.css + theme-agnostic fallback + token integrity 강제
status: Accepted
date: 2026-05-15
---

**결정**: syntax 색 처리 방침을 다음 4개로 못 박는다.

1. **`scripts/generate-syntax-palette.ts` 폐기.** Sprint 257 의 HSL
   자동 도출 (3 토큰: keyword/string/number) 은 더 이상 source of truth 가
   아니다. 12 토큰 × 144 블록 (72 테마 × 2 모드) = 1728 값을 `src/themes.css`
   에 디자이너 산출물 그대로 *수동* import 한다.
2. **Theme-agnostic fallback** 을 `src/index.css` 의 `@theme inline`
   다음, `body` 앞에 박는다. selector `:root[data-mode="light"]` /
   `:root[data-mode="dark"]` 두 블록에 slate 의 syntax 12 값 사본. specificity
   (0,1,1) — 테마 블록 (0,2,0) 보다 낮아 새 테마가 syntax 토큰을 정의하지
   않으면 cascade 로 slate 값 발동. *위치는 index.css* 이유: themes.css 는
   theme-specific 정의 전용, fallback 은 theme-agnostic base 라 책임 분리.
3. **Token reference 무결성 강제** — 자체 ESLint plugin
   (`eslint-plugin-view-table/rules/no-undefined-css-token`) 신규.
   `*.ts` / `*.tsx` 안 문자열 리터럴 / 템플릿 리터럴의 `var(--xxx)` 를
   모두 추출해 `src/themes.css` + `src/index.css` 의 정의된 토큰 set 과
   diff. 미정의 참조는 ESLint error. allowlist prefix 는 `--tw-` / `--cm-`
   / `--radix-` (third-party internal).
4. **`scripts/check-theme-contrast.ts` 확장** — 검사 대상 토큰 set 에
   syntax 12 추가, AA 기준 4.5:1. critical 6 (`keyword` `string` `number`
   `function` `type` `error`) 은 미달 시 차단; 부수 6 (`comment` `operator`
   `property` `punct` `atom` `builtin`) 은 brand 우선시 allowlist 진입
   허용. allowlist schema 의 `pair` 필드를 enum 확장 (`"primary button"`,
   `"syntax-<token>"`).

**이유**:

1. **사용자 원칙: "토큰을 사용하지 않는 모든 색깔을 제거"** (2026-05-15).
   `var(--primary)` 가 정의 없는 raw var 였던 사건 (`autocompleteTheme.ts`
   highlight 누락) 의 root cause = 사용처가 토큰 미정의를 인지 못 한 채
   invalid CSS 가 production 도달. 메커니즘 수준 강제가 없으면 재발.
   stylelint 는 `.css` 만 보고 TS 내부 `EditorView.theme({...})` 의
   inline 문자열을 못 봐 본 사건 패턴은 ESLint custom rule 만 잡는다.
2. **자동 도출 (`generate-syntax-palette.ts`) 폐기 정당성** — 사용자
   직관 (2026-05-15): "새 테마 추가하는 사람이 themes.css 한 파일을 보면
   syntax 12 자리 빠진 것 알아서 채울 것". 추가 비용 (HSL 룰 9개 정의 +
   ~200줄 스크립트 확장 + brand exception 명문화) 이 cover 하는 forget
   위험은 fallback (#2) 이 이미 0 으로 만든다. 자동화 over-engineering.
3. **Fallback 위치가 themes.css 가 아니라 index.css 인 이유** — themes.css
   는 *theme-specific values* 의 단일 책임. fallback 은 *theme-agnostic
   default* (= slate 의 사본). 두 관심사 분리하면 git diff 가 깔끔
   (테마 추가 / 토큰 fallback 갱신이 서로 noise 만들지 않음).
4. **slate 가 fallback source 인 이유** — `DEFAULT_THEME_ID = "slate"`
   (`src/lib/themeCatalog.ts`). 사용자가 테마 안 고를 때 자동 선택되는
   테마와 일치시켜 정합성 유지.
5. **`:root[data-mode]` 분리 이유** — light fallback 이 dark 모드에서
   발동하면 어두운 bg 에 진한 색 → 대비 깨짐. `:root` 단독은 mode
   구분 못 함. `@media (prefers-color-scheme)` 는 user-controlled
   `data-mode` (themeBoot) 와 충돌 (user 가 light 강제 + OS dark 일 때
   media query 가 OS 따라가 mismatch). data-attribute selector 가
   user 선택과 1:1.

**트레이드오프**:

- **+** 디자이너 의도 (브랜드 톤, lamborghini light=cool_dark 등) 100%
  보존 — HSL 룰의 평균화에서 자유.
- **+** ESLint rule 이 본 사건 패턴을 *타이핑 중* IDE 빨간 줄로 잡음
  (pre-commit / CI 도달 전).
- **+** Fallback 으로 새 테마 추가 시 syntax 12 토큰 누락이 시각적
  깨짐을 만들지 않음 (slate 값 cascade).
- **+** ADR 0023 의 AC-257-* 본문은 그대로 보존 (동결 규칙) — 본 ADR 이
  syntax palette 정책만 새로 정의해 신·구 ADR 충돌 없이 진화.
- **−** 76번째 테마 추가 시 디자이너가 12 값 manual 입력. 단 fallback 이
  이를 cover 해 시각 깨짐 위험 0 — drift 위험은 "정의되지 않음" 이 아닌
  "slate 와 동일" 형태로만 발현, 인지 가능.
- **−** ESLint custom rule (`eslint-plugin-view-table`) 작성 비용 ~40줄
  + flat config wire.
- **−** `check-theme-contrast.ts` 첫 실행 시 syntax 미달 entries 가
  다수 발견될 가능성 — critical 6 은 토큰 값 조정 필요, 부수 6 은 brand
  allowlist 진입. 1회성 cleanup 분량.
- **−** `@theme inline` 의 syntax alias 는 현재 3 토큰 (keyword/string/
  number) 만 유지 — 향후 Tailwind utility 로 9 추가 토큰 (`bg-syntax-
  comment` 등) 필요 시 alias 추가 별도 결정.

**관련**:

- ADR 0023 — production warning + AC-257-01..04 (HSL 자동 syntax palette).
  본문 동결, AC 의 syntax palette 부분만 본 ADR 이 *기능적으로* 대체.
- `src/themes.css` — 시방서 manual 1728 값 append.
- `src/index.css` — fallback 두 블록 추가.
- `src/lib/editor/highlightStyle.ts` — 12 tag 매핑 in-place 확장
  (`atom` / `builtin` / `punct` / `error` 추가).
- `scripts/generate-syntax-palette.ts` — 삭제.
- `scripts/check-theme-contrast.ts` — 12 syntax token × 144 block 검사.
- `scripts/theme-contrast-allowlist.json` — schema 의 `pair` enum 확장.
- `eslint-plugin-view-table/rules/no-undefined-css-token.js` — 신규.
- `src/__tests__/syntax-tokens-mount.test.ts` — 좁은 vitest, 12 토큰
  `getComputedStyle` mount-check.
- Exploration: `docs/explorations/how-browser-theme-works-2026-05-15.html`
  — fallback cascade interactive demo.
- Exploration: `docs/explorations/v20-syntax-palette-decision-2026-05-15.html`
  — generate-syntax-palette.ts 폐기 결정 근거 표.
