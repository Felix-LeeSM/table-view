# Sprint 68 Contract — Theme Store + Palette Audit

> `tmp/design-system/THEMING.md` Phase 2 + Phase 1 마무리. Sprint 67이 토큰 레이어를 갈아끼웠고, 이번 스프린트는 (a) 72 테마 상태를 쥐는 Zustand `themeStore`를 도입해 `slate` 고정을 해제하고 (b) tsx에 남아 있는 하드코딩 Tailwind palette 클래스(`bg-emerald-500`, `text-amber-500`, `bg-yellow-500/5` 등)를 semantic 토큰(`bg-success`, `text-warning`, `bg-highlight/5`)으로 전면 교체한다. 팝오버 UI는 Sprint 69.

## Scope

1. **Semantic 토큰 확장** (`src/themes.css` + `src/index.css`):
   - `src/themes.css` 공통 블록에 `--tv-highlight`(light `#eab308` / dark `#facc15`), `--tv-success-foreground`(`#ffffff`), `--tv-warning-foreground`(`#ffffff`) 추가.
   - `src/index.css`의 `@theme inline`에 `--color-success: var(--tv-status-connected)`, `--color-success-foreground: var(--tv-success-foreground)`, `--color-warning: var(--tv-status-connecting)`, `--color-warning-foreground: var(--tv-warning-foreground)`, `--color-highlight: var(--tv-highlight)` 5개 토큰 추가.
2. **`src/lib/themeCatalog.ts` 신설**: 72 테마 메타(`id`, `name`, `vibe`, `swatch`)를 `as const` TS 배열로 하드코딩 — `_gallery_data.json` 기준. `ThemeId = typeof THEME_CATALOG[number]["id"]` 유니언 export. `THEME_IDS: readonly ThemeId[]`, `DEFAULT_THEME_ID: ThemeId = "slate"` export. `isThemeId(x): x is ThemeId` 가드 함수.
3. **`src/lib/themeBoot.ts` 확장**:
   - `ThemeState = { themeId: ThemeId; mode: ThemeMode }` 타입 export.
   - `THEME_STORAGE_KEY` 값 포맷을 JSON 문자열(`'{"themeId":"slate","mode":"system"}'`)로 확장. 
   - `readStoredState(): ThemeState` — JSON 파싱, 실패/레거시(`"system"|"light"|"dark"` 문자열) 자동 마이그레이션. 유효하지 않은 `themeId`는 `"slate"`로 폴백.
   - `applyTheme(themeId: ThemeId, mode: ThemeMode)` — `data-theme` + `data-mode` 속성 모두 세팅. 반환: resolved mode.
   - `applyMode(mode)` 기존 함수는 `applyTheme(DEFAULT_THEME_ID, mode)` 위임 shim으로 유지.
   - `bootTheme()` — `readStoredState()` → `applyTheme(...)` 호출.
4. **`src/stores/themeStore.ts` 신설** (Zustand):
   - `{ themeId: ThemeId; mode: ThemeMode; resolvedMode: "light" | "dark"; setTheme(id); setMode(m); }`.
   - 초기 상태는 `readStoredState()` 기반.
   - `setTheme`/`setMode` 호출 시 `applyTheme` + localStorage 직렬화(JSON) 동시 수행.
   - system mode일 때 `prefers-color-scheme` 변화 리스너를 `subscribe`로 wiring — store 생성 시점에 한 번만 등록, `resolvedMode` 업데이트.
5. **`src/hooks/useTheme.ts` → shim**:
   - 내부를 `useThemeStore`로 위임. public API (`{ theme, setTheme }`) 불변 — `theme`은 여전히 `ThemeMode` 문자열, `setTheme`은 mode 설정.
   - 기존 호출부(Sidebar 등) 수정 0.
6. **`src/main.tsx`**: 기존 `bootTheme()` 호출 유지. 스토어 생성 이후 리스너가 자동 wiring.
7. **하드코딩 Tailwind palette 전수 교체** — 다음 파일들의 Tailwind palette 클래스를 semantic 토큰으로 전환:
   - `src/components/connection/ConnectionDialog.tsx`
   - `src/components/connection/ConnectionItem.tsx`
   - `src/components/connection/ImportExportDialog.tsx`
   - `src/components/datagrid/CellDetailDialog.tsx`
   - `src/components/datagrid/DataGridTable.tsx`
   - `src/components/datagrid/DataGridToolbar.tsx`
   - `src/components/query/EditableQueryResultGrid.tsx`
   - `src/components/query/GlobalQueryLogPanel.tsx`
   - `src/components/query/QueryLog.tsx`
   - `src/components/query/QueryResultGrid.tsx`
   - `src/components/query/QueryTab.tsx`
   - `src/components/schema/StructurePanel.tsx`
   - `src/components/schema/ViewStructurePanel.tsx`
   - `src/components/shared/QuickLookPanel.tsx`
   - `src/components/structure/ColumnsEditor.tsx`
   - `src/components/structure/ConstraintsEditor.tsx`
   - `src/components/structure/IndexesEditor.tsx`
   - `src/components/structure/SqlPreviewDialog.tsx`
   - `src/components/DataGrid.tsx`
   - `src/components/DocumentDataGrid.tsx`
8. **매핑 규칙** (문서화):
   - `text-emerald-*` / `text-green-*` → `text-success`
   - `bg-emerald-*` / `bg-green-*` → `bg-success` (tint 비율 유지, 예: `bg-emerald-500/10` → `bg-success/10`)
   - solid `bg-green-600 ... text-white` → `bg-success text-success-foreground`
   - `text-amber-*` / `text-yellow-500` (단색 아이콘) → `text-warning`
   - `bg-yellow-500/N` (search highlight) → `bg-highlight/N`
   - `bg-red-*` / `border-red-*` (error 컨테이너) → `bg-destructive/...` / `border-destructive/...` (이미 `text-destructive`와 공존하므로 일관)
   - `dark:` prefix 있었던 수동 다크 변형(`dark:text-emerald-400`)은 토큰으로 자동 해결되므로 **제거**.
9. **테스트 회귀**:
   - `src/components/DataGrid.test.tsx`의 `bg-yellow-500/20` 기대값 → `bg-highlight/20`으로 수정.
   - 다른 컴포넌트 테스트에서 하드코딩 클래스명 기대하는 곳이 있으면 동시 수정.
10. **신규 테스트**:
    - `src/stores/themeStore.test.ts` — initial 상태 / setTheme / setMode / system 리스너 / JSON 마이그레이션 / 잘못된 themeId 폴백 / 잘못된 mode 폴백 (≥ 7건).
    - `src/lib/themeBoot.test.ts` 확장 — `readStoredState` 레거시 문자열 → JSON 마이그레이션, `applyTheme` 동작 (≥ 3건 추가).
    - `src/lib/themeCatalog.test.ts` — `THEME_CATALOG.length === 72`, 유니크 id, `isThemeId` 가드 (≥ 3건).

## Done Criteria

1. **`src/lib/themeCatalog.ts`**:
   - `THEME_CATALOG`가 72 항목이고 각 항목은 `{id, name, vibe, swatch}`.
   - `ThemeId` 유니언, `THEME_IDS` 배열, `isThemeId` 가드 export.
   - `DEFAULT_THEME_ID === "slate"`.
2. **`src/themes.css`** 공통 블록에 `--tv-highlight`, `--tv-success-foreground`, `--tv-warning-foreground` 추가. `[data-mode="dark"]`에 `--tv-highlight` override.
3. **`src/index.css`** `@theme inline`에 `--color-success`, `--color-success-foreground`, `--color-warning`, `--color-warning-foreground`, `--color-highlight` 5개 토큰 실재.
4. **`src/lib/themeBoot.ts`**:
   - `applyTheme(id, mode)` 함수 export.
   - `readStoredState()` — JSON 읽고, 레거시 문자열("system"/"light"/"dark")도 수용해 마이그레이션.
   - `bootTheme()`가 `applyTheme` 경유.
5. **`src/stores/themeStore.ts`**:
   - `useThemeStore` hook export.
   - `{themeId, mode, resolvedMode, setTheme, setMode}` 필드.
   - `setTheme`/`setMode`가 localStorage를 JSON으로 직렬화.
   - `prefers-color-scheme` 변화 시 `resolvedMode` 자동 업데이트 (mode === system 일 때).
6. **`src/hooks/useTheme.ts`**:
   - 내부는 `useThemeStore` 위임. public API (`{ theme, setTheme }`) 불변.
7. **하드코딩 palette 감사**:
   - `grep -rEn 'bg-(emerald|green|yellow|amber|red|rose|pink)-[0-9]+|text-(emerald|green|yellow|amber|red|rose|pink)-[0-9]+|border-(emerald|green|yellow|amber|red|rose|pink)-[0-9]+' --include='*.tsx' src/ | grep -v '\.test\.tsx' | wc -l` → **0**.
   - `connectionColor.ts`/`db-meta.ts`/`types/connection.ts`는 데이터 식별 팔레트라 제외 (.ts 파일, 위 grep에 미포함).
8. **테스트 회귀**:
   - `DataGrid.test.tsx`의 4개 `bg-yellow-500/20` 기대값을 `bg-highlight/20`으로 갱신.
9. **검증**:
   - `pnpm tsc --noEmit` pass
   - `pnpm lint` pass
   - `pnpm vitest run` pass, Sprint 67 대비 tests 증가(themeStore/themeCatalog/themeBoot 신규).
10. **수동 smoke**: `pnpm dev`로 실행 후 (a) Sidebar cycle 버튼으로 light/dark/system 전환 동작, (b) DevTools에서 `document.documentElement.dataset.theme = "github"`로 수동 지정 시 모든 주요 컴포넌트가 GitHub 팔레트 색상으로 재렌더.

## Out of Scope

- Sidebar 푸터 팝오버 UI (72 테마 목록 + 모드 세그먼트) — **Sprint 69**.
- ⌘K 팔레트, Settings → Appearance 전용 화면, per-connection 테마, 사용자 커스텀 테마.
- `connectionColor.ts`/`db-meta.ts`/`types/connection.ts` 데이터 팔레트 hex — 테마 토큰 대상 아님.
- Rust/Tauri 백엔드 수정 0.

## Invariants

- Sprint 67 이후의 color 렌더링 회귀 0 — slate 테마 + system mode의 색상이 Sprint 67과 픽셀 단위 동일(가능한 경우).
- `useTheme` 훅 public API 불변 (`{ theme, setTheme }`).
- `dark:` Tailwind prefix JSX 사용처 감소만 허용(제거된 경우) — 신규 추가 0.
- `src-tauri/**` 수정 0.
- `TableTab`/`connectionStore`/`tabStore` 등 Sprint 66 상태 저장소 포맷 불변.

## Verification Plan

- Profile: `frontend-only`.
- Required checks:
  1. `pnpm tsc --noEmit`
  2. `pnpm lint`
  3. `pnpm vitest run`
- Required evidence:
  - 변경 파일 목록과 역할.
  - grep evidence:
    - `wc -l src/lib/themeCatalog.ts` (THEME_CATALOG 72 항목 포함)
    - 팔레트 감사 grep 결과 0
    - `grep -c '--color-success:' src/index.css` ≥ 1
    - `grep -c 'applyTheme' src/lib/themeBoot.ts` ≥ 2 (정의 + 내부 호출)
  - `pnpm vitest run` 통과 테스트 수 비교 (Sprint 67 1144 → Sprint 68 ≥ 1157 예상).
  - 수동 smoke 기록: Sidebar cycle 정상, DevTools `data-theme="github"` 수동 전환 시 primary 색상 변화 확인.

## Test Requirements

- 신규 Vitest 테스트 ≥ 13건:
  - themeCatalog: ≥ 3
  - themeBoot (확장): ≥ 3
  - themeStore: ≥ 7
- 회귀 수정(기존 기대값 갱신) ≥ 4건 (DataGrid.test.tsx의 `bg-yellow-500/20` 4개).
- `pnpm vitest run`의 총 통과 수 Sprint 67 대비 순증.

## Scenario coverage

- Happy path: 신규 유저(저장값 없음) → `slate + system` + prefers-color-scheme에 따라 resolved.
- 레거시 마이그레이션: localStorage에 `"dark"` 저장 → `readStoredState()` → `{themeId:"slate", mode:"dark"}`로 복구.
- 잘못된 themeId 폴백: localStorage에 `'{"themeId":"unknown","mode":"light"}'` → `slate + light`.
- 잘못된 mode 폴백: localStorage에 `'{"themeId":"github","mode":"midnight"}'` → `github + system`.
- system 리스너: mode=system일 때 OS 다크모드 전환 → `resolvedMode`만 업데이트, mode는 그대로.
- setTheme 후 reload: localStorage JSON 정합, 앱 재시작 시 동일 테마/모드 복원.
- setMode 중복 호출: 같은 mode 연속 설정해도 DOM 속성 1회만 쓰임(idempotent). idempotency 자체는 테스트 안 하지만 버그 없어야.
- palette 토큰 회귀: 교체된 파일들이 Sprint 67과 렌더 결과 동일(자동 테스트는 `bg-highlight/20` 등 클래스명 기대로만 검증).
