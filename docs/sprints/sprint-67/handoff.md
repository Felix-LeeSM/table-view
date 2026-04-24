# Sprint 67 — Generator Handoff (Theme Token Migration)

## Scope recap
`tmp/design-system/THEMING.md`의 Phase 1 — 토큰 레이어 전환. 앱 전체를
`--tv-*` 토큰 + `[data-theme][data-mode]` 활성화 모델로 옮기고, 기존 `.dark`
클래스 경로 + `:root`/`.dark`에 박혀 있던 하드코딩 shadcn 토큰(`--primary`,
`--background`, ...)을 완전히 제거했다. 이 스프린트는 72 테마 선택 기능을
`slate` 단일 테마로 고정한 채 **색상 파이프라인만** 갈아끼우는 foundation
레이어다. 스토어(72 테마 상태 + 영속화)는 Sprint 68, 팝오버 UI는 Sprint 69.

## Changed Files

### Frontend (TypeScript / CSS)

- `src/themes.css` (new) — `tmp/design-system/themes/themes.css`의 복제.
  `[data-mode="dark"] { color-scheme: dark; }` / `[data-mode="light"] { color-scheme: light; }` 프리앰블 + 72 테마 × 2 모드 = 144개의
  `[data-theme="X"][data-mode="Y"]` 블록. 각 블록은 `--tv-background` /
  `--tv-foreground` / `--tv-card` / `--tv-popover` / `--tv-primary` /
  `--tv-secondary` / `--tv-muted` / `--tv-accent` / `--tv-border` / `--tv-input`
  / `--tv-ring` / `--tv-primary-tint` / `--tv-syntax-*` / `--tv-status-*` 를
  정의한다.
  파일 끝에 **테마 비의존 공통 토큰** 블록 추가:
  ```css
  :root {
    --tv-destructive: #ef4444;
    --tv-destructive-foreground: #ffffff;
    --tv-radius: 0.5rem;
    --tv-font-sans: -apple-system, ...;
    --tv-font-mono: ui-monospace, ...;
  }
  [data-mode="dark"] {
    --tv-destructive: #f87171;
  }
  ```
  (themes.css는 destructive/radius/font 토큰을 테마별로 정의하지 않으므로
  공통 정의가 필요하다. 다크에서만 destructive 톤이 라이트와 달라서 분리.)

- `src/index.css` (rewrite) —
  - `@import "tailwindcss";` + `@import "./themes.css";`
  - `@custom-variant dark (&:where([data-mode="dark"], [data-mode="dark"] *));`
    — `dark:` Tailwind prefix를 `[data-mode="dark"]` 기반으로 재정의. 기존
    `dark:` 사용처 26곳(tsx) 전부 JSX 수정 0으로 동작.
  - `@theme inline { ... }`: 모든 `--color-*`가 `var(--tv-*)` 참조. `--radius-*`도
    `var(--tv-radius)` 기반 계산. shadcn primitive(`bg-primary`, `text-foreground`,
    `rounded-md` 등)가 Tailwind v4 정규 경로로 토큰 해석.
  - 기존 `:root { --primary: ...; ... }` / `.dark { ... }` /
    `@media (prefers-color-scheme: dark) { :root:not(.light) { ... } }` 블록은
    **완전 삭제**. CSS의 light/dark 결정은 이제 오직 `[data-mode]` 속성.
  - `body`는 `var(--tv-font-sans)` / `var(--tv-background)` / `var(--tv-foreground)`
    로 전환.

- `src/lib/themeBoot.ts` (new) —
  - `ThemeMode = "system" | "light" | "dark"` + `THEME_STORAGE_KEY` +
    `DEFAULT_THEME_ID = "slate"` 공개 상수.
  - `readStoredMode()` — `localStorage["table-view-theme"]`를 읽어 유효값이면 그대로, 아니면 `"system"` 폴백.
  - `resolveMode(mode)` — `"system"`은 `prefers-color-scheme`로 해석해 `"light"|"dark"` 반환.
  - `applyMode(mode)` — `document.documentElement.setAttribute("data-theme", "slate")` + `setAttribute("data-mode", resolved)`. 반환: 실제 적용된 `"light"|"dark"`.
  - `bootTheme()` — `applyMode(readStoredMode())`를 동기 실행. React mount 이전에 호출 가능.

- `src/main.tsx` —
  - `import { bootTheme } from "@lib/themeBoot";` 추가.
  - `ReactDOM.createRoot(...).render(...)` 직전에 `bootTheme()` 호출. FOUC 방지.

- `src/hooks/useTheme.ts` (rewrite) —
  - `@lib/themeBoot`의 `ThemeMode` / `applyMode` / `readStoredMode` /
    `THEME_STORAGE_KEY` 재사용. 훅은 shim.
  - public API (`{ theme, setTheme }`, storage key) 불변.
  - 내부 동작만 `classList.add/remove("dark"|"light")` → `applyMode` 위임으로 전환.

### Tests

- `src/hooks/useTheme.test.ts` (rewrite) —
  - 기대 assertions `classList.contains(...)` → `getAttribute("data-mode")` 전환.
  - 신규 시나리오:
    - `sets data-theme=slate on mount`
    - `falls back to system when legacy localStorage value is unparseable`
  - 총 8 tests (Sprint 66의 6 → 8).

- `src/lib/themeBoot.test.ts` (new) —
  - `readStoredMode`: default/stored/invalid-value 3 cases
  - `resolveMode`: light/dark literal + system via `matchMedia` mock
  - `applyMode`: data-theme/data-mode 속성 적용
  - `bootTheme`: 저장값 있을 때 동기 적용 + 없을 때 system 해석
  - 총 7 tests.

## Done Criteria — Evidence

| Criterion | Evidence |
|---|---|
| `src/themes.css`에 72 테마 블록 존재 | `grep -oE '\[data-theme="[a-z_-]+"\]' src/themes.css \| sort -u \| wc -l` → **73** (72 실테마 + 파일 주석의 placeholder 1) |
| `src/index.css`에 레거시 `--primary:` 선언 0건 | `grep -c '^\s*--primary:' src/index.css` → **0** |
| `useTheme.ts`에 `classList.add("dark"` 0건 | `grep -c 'classList.add("dark"' src/hooks/useTheme.ts` → **0** |
| `themeBoot`에 `setAttribute("data-mode"` 존재 | `grep -c 'setAttribute("data-mode"' src/lib/themeBoot.ts` → **1** |
| `themeBoot`에 `setAttribute("data-theme"` 존재 | `grep -c 'setAttribute("data-theme"' src/lib/themeBoot.ts` → **1** |
| FOUC 방지: `bootTheme()`가 `createRoot` 이전 호출 | `src/main.tsx:7` `bootTheme();`가 line 9 `createRoot` 이전 |
| Legacy localStorage 역호환 | `readStoredMode()`가 `"system"/"light"/"dark"` 값만 유효 처리, 그 외 `"system"` 폴백 (test: `falls back to 'system' for unparseable values`) |

## Verification

- `pnpm tsc --noEmit` → **pass** (no output = 0 errors)
- `pnpm lint` → **pass** (no output = 0 warnings/errors)
- `pnpm vitest run` → **61 files · 1144 tests pass**. Sprint 66 대비 신규 테스트
  `themeBoot.test.ts` 7건 + `useTheme.test.ts` 시나리오 2건 추가 (기존 6 → 8).
  Duration 11.83s.

## Invariants maintained

- Sprint 66의 Postgres/Mongo 경로, `TableTab.paradigm`, `DataGridTable`
  sentinel 분기 — 전부 `src/index.css`/`src/themes.css`/hook 변경만 있었으므로 회귀 0.
- `useTheme` 훅의 public API(`{ theme, setTheme }`, `Theme` 유니언, storage key
  `table-view-theme`, 값 `"system"|"light"|"dark"`) 불변.
- `dark:` Tailwind prefix 호출부 26곳 JSX 수정 0건.
- `connectionColor.ts`/`db-meta.ts`/`types/connection.ts`의 데이터 식별
  팔레트 hex 미변경 (테마 토큰 대상 아님).

## Out of Scope (deferred)

- **Sprint 68**: `themeStore` (Zustand 72 테마 상태) + localStorage JSON 확장
  + tsx 51곳 Tailwind palette 클래스 (`bg-emerald-500`, `text-red-500` 등)
  전수 `--tv-*` 치환.
- **Sprint 69**: Sidebar 푸터 테마 팝오버 UI — 72 테마 목록 + 라이트/다크/시스템 세그먼트, Radix Popover 기반.
- **차후**: `⌘K` 팔레트 빠른 전환, Settings → Appearance 전용 그리드 화면,
  per-connection 테마 오버라이드, 사용자 커스텀 테마.

## 후속 Sprint 68 진입 조건

- `bootTheme()`가 `DEFAULT_THEME_ID = "slate"`만 적용한다 — 스토어 도입 시
  `applyMode`를 확장해 `themeId` 파라미터 수용 or `applyTheme(themeId, mode)`
  분리.
- `useTheme.setTheme(mode)` 의 public API는 Sprint 68에서 `useThemeStore`
  위임 shim으로 재래핑 예정. 호출부 28곳 일괄 이행 대신 단계적.
- `THEME_STORAGE_KEY` 값 포맷은 현재 단일 문자열. Sprint 68에서 `{theme, mode}`
  JSON으로 확장하면서 레거시 문자열 → 새 포맷 자동 마이그레이션 로직 추가.
