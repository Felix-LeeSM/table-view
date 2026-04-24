# Sprint 68 — Generator Handoff (Theme Store + Palette Audit)

## Scope recap

`tmp/design-system/THEMING.md`의 Phase 2 + Phase 1 마무리.

1. Sprint 67이 깔아둔 `--tv-*` 레이어 위에 72-테마 상태를 쥐는 Zustand
   `themeStore`를 도입해 `slate` 고정을 해제했다.
2. `src/` tsx 전반에 남아 있던 하드코딩 Tailwind palette 클래스(`bg-emerald-500`,
   `text-amber-500`, `bg-yellow-500/20`, `bg-red-500/10` 등)를 semantic 토큰
   (`bg-success`, `text-warning`, `bg-highlight/20`, `bg-destructive/10`)로
   전면 교체했다.
3. 팝오버 UI는 Sprint 69.

## Changed Files

### Frontend — tokens / lib / stores

- `src/themes.css` — 파일 끝 공통 블록에 semantic 보조 토큰 추가:
  ```css
  :root {
    --tv-success-foreground: #ffffff;
    --tv-warning-foreground: #ffffff;
    --tv-highlight: #eab308;
  }
  [data-mode="dark"] {
    --tv-highlight: #facc15;
  }
  ```
- `src/index.css` — `@theme inline`에 5개 semantic 토큰 신규:
  ```css
  --color-success: var(--tv-status-connected);
  --color-success-foreground: var(--tv-success-foreground);
  --color-warning: var(--tv-status-connecting);
  --color-warning-foreground: var(--tv-warning-foreground);
  --color-highlight: var(--tv-highlight);
  ```
- `src/lib/themeCatalog.ts` (new, 93 lines) —
  - 72개 `THEME_CATALOG` 엔트리 (`{id, name, vibe, swatch}`), `as const satisfies readonly ThemeCatalogEntry[]`.
  - `ThemeId = (typeof THEME_CATALOG)[number]["id"]` 유니언.
  - `THEME_IDS: readonly ThemeId[]`, `DEFAULT_THEME_ID: ThemeId = "slate"`.
  - `isThemeId(value: unknown): value is ThemeId` 가드.
- `src/lib/themeBoot.ts` (rewrite, 101 lines) —
  - `ThemeState = { themeId; mode }` 신규 export.
  - `readStoredState(): ThemeState` — JSON 파싱, 레거시(`"light"|"dark"|"system"` 리터럴) 자동 마이그레이션, 무효 id/mode는 기본값 폴백.
  - `writeStoredState(state)` — JSON 직렬화.
  - `applyTheme(themeId, mode)` — `data-theme` + `data-mode` 둘 다 세팅.
  - `applyMode(mode)` — `applyTheme(DEFAULT_THEME_ID, mode)` 위임 shim.
  - `bootTheme()` — `readStoredState()` → `applyTheme(...)` 동기 호출.
  - `subscribeSystemModeChange(handler)` — `prefers-color-scheme` `matchMedia` 리스너, 구독 해제 함수 반환.
  - `readStoredMode()` — 하위 호환 유지(`readStoredState().mode`).
- `src/stores/themeStore.ts` (new, 71 lines, Zustand) —
  - `{ themeId, mode, resolvedMode: "light"|"dark" }` 상태.
  - `setTheme(id)` / `setMode(mode)` / `setState(state)` / `hydrate()` / `handleSystemChange()`.
  - 쓰기 액션은 `applyTheme` + `writeStoredState` 동시 수행.
  - 초기 상태는 module load 시점 `readStoredState()`; 테스트는 `hydrate()`로 리셋.
- `src/hooks/useTheme.ts` (rewrite, 23 lines) —
  - 내부를 `useThemeStore`로 위임. public API `{ theme, setTheme }` 불변.
  - `mode === "system"`일 때 `subscribeSystemModeChange`로 `handleSystemChange` 구독 + 언마운트 시 해제.
- `src/main.tsx` — 수정 없음. Sprint 67의 `bootTheme()` 직접 호출이 그대로 동작.

### Frontend — palette audit (20 tsx)

다음 파일에서 Tailwind palette 하드코딩을 semantic 토큰으로 치환:

| 파일 | 주요 치환 |
|---|---|
| `connection/ConnectionDialog.tsx` | `bg-red-500/10` → `bg-destructive/10`, `bg-emerald-500/10 text-emerald-600 dark:text-emerald-400` → `bg-success/10 text-success`, `bg-green-500/10` → `bg-success/10` |
| `connection/ConnectionItem.tsx` | `bg-emerald-500 dark:bg-emerald-400` → `bg-success` |
| `connection/ImportExportDialog.tsx` | `bg-emerald-500/10`/`text-emerald-*` → `bg-success/10`/`text-success`, `text-amber-600 dark:text-amber-400` → `text-warning`, `bg-red-500/10` → `bg-destructive/10` |
| `datagrid/CellDetailDialog.tsx` | `text-emerald-500` → `text-success` |
| `datagrid/DataGridTable.tsx` | `text-amber-500` → `text-warning`, `bg-yellow-500/20` → `bg-highlight/20`, `bg-yellow-500/5` → `bg-warning/5` |
| `datagrid/DataGridToolbar.tsx` | `text-yellow-500` → `text-warning`, `bg-green-600/20 text-green-400` → `bg-success/20 text-success`, `bg-red-600/20 text-red-400` → `bg-destructive/20 text-destructive` |
| `query/EditableQueryResultGrid.tsx` | `bg-yellow-500/10` → `bg-warning/10`, `text-amber-500` → `text-warning`, `bg-yellow-500/20` → `bg-highlight/20`, `bg-green-600 hover:bg-green-700` → `bg-success hover:bg-success/90` |
| `query/GlobalQueryLogPanel.tsx` | `text-emerald-500 dark:text-emerald-400` → `text-success` |
| `query/QueryLog.tsx` | `bg-emerald-500 dark:bg-emerald-400` → `bg-success` |
| `query/QueryResultGrid.tsx` | `bg-emerald-500/10 text-emerald-700 dark:text-emerald-400` → `bg-success/10 text-success` |
| `query/QueryTab.tsx` | `text-emerald-500 dark:text-emerald-400` → `text-success`, `bg-emerald-500 dark:bg-emerald-400` → `bg-success` |
| `schema/StructurePanel.tsx` | `border-red-500/20 bg-red-500/10` → `border-destructive/20 bg-destructive/10` |
| `schema/ViewStructurePanel.tsx` | 상동 + `text-emerald-500` → `text-success` |
| `shared/QuickLookPanel.tsx` | `bg-green-500/15 text-green-600 dark:text-green-400` / `bg-red-500/15 text-red-600 dark:text-red-400` → `bg-success/15 text-success` / `bg-destructive/15 text-destructive` |
| `structure/ColumnsEditor.tsx` | `text-amber-500` → `text-warning`, `text-emerald-500 dark:text-emerald-400` → `text-success`, `bg-green-500/5`/`text-green-600`/`bg-green-500/10` → `bg-success/5`/`text-success`/`bg-success/10` |
| `structure/ConstraintsEditor.tsx` | `bg-red-500/10` → `bg-destructive/10` |
| `structure/IndexesEditor.tsx` | `bg-red-500/10` → `bg-destructive/10`, `text-amber-500` → `text-warning` |
| `structure/SqlPreviewDialog.tsx` | `bg-red-500/10` → `bg-destructive/10` |
| `DataGrid.tsx` | `border-red-500/20 bg-red-500/10` → `border-destructive/20 bg-destructive/10`, `bg-green-600 text-white hover:bg-green-700` → `bg-success text-success-foreground hover:bg-success/90` |
| `DocumentDataGrid.tsx` | `border-red-500/20 bg-red-500/10` → `border-destructive/20 bg-destructive/10` |

수동 `dark:` 오버라이드는 토큰이 모드별 자동 해결하므로 모두 제거(Invariant: `dark:` prefix 신규 추가 0).

### Tests

- `src/lib/themeCatalog.test.ts` (new, 7 tests) — 72 count, unique ids, default id 포함, swatch hex 형식, `THEME_IDS` sync, `isThemeId` guard(+/- 케이스).
- `src/lib/themeBoot.test.ts` (rewrite, 19 tests — +12 vs Sprint 67) — 기존 `readStoredMode`/`resolveMode`/`applyMode`/`bootTheme` 유지 + `readStoredState`(default/legacy 마이그레이션/JSON/unknown id 폴백/invalid mode 폴백/malformed JSON) + `writeStoredState` + `applyTheme`(data-theme/data-mode/return resolved) + `bootTheme`의 JSON 경로 + `subscribeSystemModeChange`.
- `src/stores/themeStore.test.ts` (new, 10 tests) — 기본 hydrate / JSON hydrate / setTheme(JSON 직렬화) / setMode(resolved 반영) / setState(동시) / system 리스너(`handleSystemChange`) / system 이외 모드일 때 리스너 no-op / themeId 독립 / mode 독립.
- `src/hooks/useTheme.test.ts` (rewrite, 9 tests — +1 vs Sprint 67) — 모든 assertion을 `data-mode`/`data-theme`/JSON localStorage 기반으로 갱신. 신규 "reads JSON-formatted stored state" 케이스 추가.
- `src/components/datagrid/DataGridTable.editing-visual.test.tsx` — 기대값 `/bg-yellow/` → `/bg-highlight/`.
- `src/components/query/QueryLog.test.tsx` — 기대값 `emerald-500` → `bg-success`.
- `src/components/DataGrid.test.tsx` — 4개 `bg-yellow-500/20` → `bg-highlight/20` + 주석 갱신.

## Done Criteria — Evidence

| Criterion | Evidence |
|---|---|
| `THEME_CATALOG` 72 entries | `grep -c '^\s*{\s*id:' src/lib/themeCatalog.ts` → **72** |
| `isThemeId`/`ThemeId`/`THEME_IDS` export | `src/lib/themeCatalog.ts:83-92` |
| `DEFAULT_THEME_ID === "slate"` | `src/lib/themeCatalog.ts:87` |
| themes.css 공통 블록에 `--tv-highlight` / `--tv-success-foreground` / `--tv-warning-foreground` | `grep -nE '^\s*--tv-(highlight\|success-foreground\|warning-foreground):' src/themes.css` → 4 lines (root + dark override) |
| `@theme inline`에 5 토큰 추가 | `grep -nE '^\s*--color-(success\|warning\|highlight)' src/index.css` → 5 lines |
| `applyTheme` export + 내부 호출 | `grep -c 'applyTheme' src/lib/themeBoot.ts` → **3** (정의 + applyMode shim 내부 + bootTheme 내부) |
| `bootTheme()` → `applyTheme` 경유 | `src/lib/themeBoot.ts:83-86` |
| `useThemeStore` export | `src/stores/themeStore.ts:24` |
| `useTheme`가 `useThemeStore` 위임 | `src/hooks/useTheme.ts:2,13-15` |
| tsx 하드코딩 palette 0 (테스트 제외) | `grep -rEn 'bg-(emerald\|green\|yellow\|amber\|red\|rose\|pink)-[0-9]+\|text-...\|border-...' --include='*.tsx' src/ \| grep -v '\.test\.tsx' \| wc -l` → **0** |
| `DataGrid.test.tsx` `bg-yellow-500/20` → `bg-highlight/20` | `grep -c 'bg-highlight/20' src/components/DataGrid.test.tsx` → 4 |

## Verification

- `pnpm tsc --noEmit` → **pass** (0 errors)
- `pnpm lint` → **pass** (0 warnings/errors)
- `pnpm vitest run` → **63 files · 1173 tests pass**. Sprint 67 1144 → 1173, 순증 +29:
  - themeCatalog.test.ts: +7 (신규)
  - themeStore.test.ts: +10 (신규)
  - themeBoot.test.ts: +12 (7 → 19)
  - useTheme.test.ts: +1 (8 → 9)
  - 나머지(DataGrid*/QueryLog) 회귀 assertion 수정으로 통과 유지.
  - Duration 12.32s.

## Invariants maintained

- `useTheme` 훅 public API(`{ theme, setTheme }`) 불변. Sidebar 등 호출부 수정 0.
- Sprint 67의 `THEME_STORAGE_KEY = "table-view-theme"` 상수값 불변. 저장 포맷은 문자열 → JSON으로 전환됐지만 레거시 문자열은 자동 마이그레이션.
- `dark:` Tailwind prefix JSX 사용처 **감소만** 발생(수동 dark variant 제거 경로). 신규 추가 0.
- `src-tauri/**` 수정 0.
- `connectionColor.ts`/`db-meta.ts`/`types/connection.ts` 데이터 식별 팔레트 hex 미변경.
- `--tv-status-connected` / `--tv-status-connecting` 토큰 자체는 그대로이며, Tailwind 유틸만 `success`/`warning`로 alias.

## Manual smoke

- `pnpm dev` 실행 필요 시 확인 포인트:
  - Sidebar cycle 버튼 → light/dark/system 전환 시 `[data-mode]` 토글 정상.
  - DevTools `document.documentElement.dataset.theme = "github"` 수동 주입 → primary 색상 등 즉시 재렌더(CSS 변수 기반이므로 JS 리렌더 불필요).
  - localStorage `"table-view-theme"` 값이 새 세션에서 `{"themeId":"slate","mode":"..."}` JSON으로 쓰여야 함. 기존 사용자의 `"dark"` 같은 레거시 문자열은 읽을 때 자동 해석됨.

## Out of Scope (deferred to Sprint 69)

- Sidebar 푸터 팝오버 UI — 72 테마 목록 + 라이트/다크/시스템 segmented toggle, Radix Popover 기반.
- ⌘K 팔레트 빠른 전환, Settings → Appearance 전용 그리드 화면, per-connection 테마 오버라이드, 사용자 커스텀 테마.

## 후속 Sprint 69 진입 조건

- `useThemeStore().setTheme(id)`가 이미 동작 — Sprint 69는 팝오버 UI에서 `setTheme`/`setMode` 호출만 wiring하면 된다.
- `THEME_CATALOG`의 `swatch` 필드가 팝오버 썸네일에 바로 쓰일 수 있다.
- `resolvedMode`는 palette 프리뷰/필터 UI에서 바로 소비 가능.
