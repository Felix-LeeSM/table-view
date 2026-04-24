# Sprint 67 Contract — Theme Token Migration (Foundation)

> `tmp/design-system/THEMING.md` Phase 1에 해당. 72 named themes × (light/dark) 시스템의 **토큰 레이어**만 완성한다. 이 스프린트는 앱 전체를 **`--tv-*` 토큰 + `[data-theme][data-mode]` 활성화 모델**로 전환하고, 기존 `.dark` 클래스 + 하드코딩 shadcn 토큰(`--primary` 등)을 완전히 제거한다. 스토어/팝오버 UI는 Sprint 68/69.

## Scope

1. `tmp/design-system/themes/themes.css`를 `src/themes.css`로 복사(그대로). 루트 스타일은 72 테마 × 2 모드 = 144개의 `[data-theme="X"][data-mode="Y"]` 블록을 담는다.
2. `src/themes.css` 끝에 **테마 비의존 공통 토큰** 추가 — `--tv-destructive`, `--tv-destructive-foreground` (모든 테마 공통), `--tv-radius`, `--tv-radius-sm/md/lg/xl`, `--tv-shadow-xs/sm/md/lg/xl`, `--tv-font-sans`, `--tv-font-mono`. 다크에서 덮는 토큰(`--tv-destructive`)은 `[data-mode="dark"]`에서 별도 값. 이 블록의 출처는 `tmp/design-system/colors_and_type.css`를 베이스로 하되, **토큰 이름 충돌은 themes.css 우선**.
3. `src/index.css` 완전 재작성:
   - `@import "tailwindcss";` + `@import "./themes.css";`
   - `@custom-variant dark (&:where([data-mode="dark"], [data-mode="dark"] *));` — `dark:` prefix를 `[data-mode="dark"]` 기반으로.
   - `@theme inline { ... }` 블록의 모든 `--color-*`/`--radius-*` 토큰을 `var(--tv-*)`로 리와이어. 예: `--color-primary: var(--tv-primary)`, `--radius-lg: var(--tv-radius)`.
   - 기존 `:root` / `.dark` / `@media (prefers-color-scheme: dark)` 규칙 전부 제거.
   - `body`, `#root`, `*`, `input/textarea/select` 규칙은 유지 (토큰만 `var(--tv-*)` 참조로 교체).
4. `src/hooks/useTheme.ts` 수정:
   - `applyTheme(mode)` 내부에서 `classList.add/remove("light"|"dark")` → `document.documentElement.setAttribute("data-mode", resolved)`.
   - 초기화 시 `document.documentElement.setAttribute("data-theme", "slate")` 고정 (Sprint 68에서 가변화).
   - `Theme` 유니언/외부 API (`theme`, `setTheme`, storage key `table-view-theme`, 값 `"system"|"light"|"dark"`)는 불변.
   - 기존 클래스 기반 호환이 필요한 경로가 있다면(test 등) `data-mode` 기반으로 동시 이행.
5. `src/hooks/useTheme.test.ts` 수정:
   - 기대값을 `classList.contains("dark")` → `getAttribute("data-mode") === "dark"` 형태로 전환.
   - `data-theme="slate"`가 루트에 세팅되는지 검증 ≥ 1건.
   - 기존 시나리오(stored value 읽기, setTheme persistence, system 리스너, light↔dark 전환) 전원 유지.
6. FOUC 방지:
   - `src/main.tsx`에서 `ReactDOM.createRoot(...).render(...)` 이전에 `data-theme`/`data-mode` 속성을 **동기적으로** 적용하는 부팅 루틴 삽입 — `useTheme`의 `applyTheme` 로직을 `lib/themeBoot.ts`로 추출 후 `main.tsx`에서 먼저 호출.
   - `index.html` 수정 없이 JS 레벨에서 해결 (Tauri 2의 Vite 번들은 HTML 최소 유지).
7. 기존 `dark:` Tailwind prefix 사용처(26곳)는 셀렉터 변경만으로 그대로 동작해야 한다 (JSX 수정 0건).
8. 시각 회귀 방지: 슬레이트(default) 테마의 **light/dark 색상 값**이 Sprint 66 이전과 **바이트 단위로 동일**(`themes.css`의 `slate` 블록이 `src/index.css` 원본과 정확히 일치 — 이미 동일함을 사전 확인).

## Done Criteria

1. **`src/themes.css`**: 파일이 존재하고, `tmp/design-system/themes/themes.css`와 72개 테마 블록이 모두 복제됨(`grep -c '\[data-theme=' src/themes.css` ≥ 144). 끝에 공통 토큰 블록 추가.
2. **`src/index.css`**: `@custom-variant dark` 셀렉터가 `[data-mode="dark"]` 기반. `:root { --primary: ...; ... }` 같은 레거시 선언은 0건 (`grep -c '^\s*--primary:' src/index.css` == 0). `@theme inline` 블록의 모든 `--color-*`가 `var(--tv-*)` 참조.
3. **`src/hooks/useTheme.ts`**:
   - `classList.add("dark"|"light")` 호출 0건 (`grep -c 'classList.add("dark"' src/hooks/useTheme.ts` == 0).
   - `setAttribute("data-mode", ...)` 호출 존재.
   - `setAttribute("data-theme", "slate")` 호출 존재 (초기화 시 1회).
4. **`src/hooks/useTheme.test.ts`**:
   - 기존 6개 시나리오 유지 (default, stored read, apply dark, apply light, setTheme persistence, dark→light 전환).
   - 신규 시나리오 ≥ 1건: "applies `data-theme='slate'` on mount".
   - 모든 assertion이 `getAttribute("data-mode")` 기반.
5. **FOUC 방지**: `src/lib/themeBoot.ts` 또는 동등 모듈에 `bootTheme()` 함수가 존재하고 `src/main.tsx`에서 `createRoot` 이전 호출. 단위 테스트 ≥ 1건 (저장된 `dark` 값이 있을 때 `bootTheme()` 호출 후 `documentElement.dataset.mode === "dark"`).
6. **Legacy localStorage 역호환**: 기존 값 `"system"|"light"|"dark"`로 저장된 `table-view-theme`를 읽어 동일 동작 보장. 스토리지 key/값 형식은 **이번 스프린트에선 변경 금지** (Sprint 68에서 JSON 확장 예정).
7. **회귀 + 검증**:
   - `pnpm tsc --noEmit`
   - `pnpm lint`
   - `pnpm vitest run` (Sprint 66 대비 테스트 수 증가 or 동일, 감소 금지)
8. **시각 smoke (수동)**: `pnpm dev`로 앱 실행 후 사이드바 푸터 cycle 버튼으로 light → dark → system 3단계가 Sprint 66과 동일한 화면을 렌더. 차이는 **색상이 아닌 활성화 메커니즘**에만 있음.

## Out of Scope

- `themeStore` (Zustand) — **Sprint 68**.
- 72 테마 선택 UI(팝오버) — **Sprint 69**.
- 하드코딩된 Tailwind palette 클래스(`bg-emerald-500`, `text-red-500` 등 51곳) 전수 교체 — **Sprint 68**.
- `connectionColor.ts`/`db-meta.ts`/`types/connection.ts`의 데이터 팔레트 hex — 데이터 식별용이라 테마 토큰과 별개, 교체 없음.
- Settings 다이얼로그/⌘K 팔레트/per-connection 테마/커스텀 테마 — 전부 이후 스프린트 또는 별도 결정.
- `@tauri-apps/plugin-store` 도입 — 현행 `localStorage` 유지.

## Invariants

- Sprint 66 이후의 기능/렌더링 회귀 0.
- `useTheme` 훅의 public API (`{ theme, setTheme }`, `Theme` 유니언) 불변.
- `table-view-theme` localStorage key와 값 포맷(`"system"|"light"|"dark"`) 이번 스프린트 내 불변.
- 모든 `dark:` Tailwind prefix JSX 수정 0건.
- `src/components/**`, `src/stores/**`, `src-tauri/**` 파일 수정 0건 (본 스프린트 변경은 `src/index.css`, `src/themes.css`, `src/hooks/useTheme.ts`, `src/hooks/useTheme.test.ts`, `src/lib/themeBoot.ts`, `src/lib/themeBoot.test.ts`, `src/main.tsx` 7개로 한정).

## Verification Plan

- Profile: `frontend-only`.
- Required checks:
  1. `pnpm tsc --noEmit`
  2. `pnpm lint`
  3. `pnpm vitest run`
- Required evidence:
  - Generator: 변경 파일 목록 + 역할. `grep` 결과(신규 `--tv-*` wire-up, 레거시 `--primary` 0건, `setAttribute("data-mode", ...)` 실재). vitest 결과 요약.
  - Evaluator: 위 3개 check 직접 실행. `pnpm dev`로 수동 smoke 후 Sprint 66과 동일한 색상 렌더 확인. `docs/sprints/sprint-67/handoff.md` 작성.

## Test Requirements

- Vitest 테스트 ≥ 7건 (useTheme 기존 6 + data-theme 세팅 검증 1).
- `themeBoot` 모듈 테스트 ≥ 1건.
- 전체 `pnpm vitest run` 통과 수가 Sprint 66 대비 회귀 없음.

## Scenario coverage

- Happy path: 로드 시 `data-theme="slate"` + `data-mode="system 해석결과"` 적용, 모든 shadcn 컴포넌트가 슬레이트 색상 렌더.
- 빈/누락 localStorage: default `"system"` + `prefers-color-scheme` 해석.
- 에러 복구: 파싱 불가한 legacy 값(예: `""`, `"invalid"`)은 `"system"`으로 폴백, 콘솔 로그 없이.
- 상태 전이: `"system" → "light" → "dark" → "system"` 모든 방향 통과, DOM 속성 값이 정합.
- 동시성: 두 `useTheme` 훅 동시 마운트 + `setTheme` 연속 호출 시 마지막 값이 DOM 반영.
- FOUC: 다크 저장 상태에서 초기 페인트 시 `data-mode="dark"` 이미 세팅 (bootTheme 단위 테스트로 검증).
