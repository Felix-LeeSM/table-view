# Sprint 238 — Handoff Stub

Date: 2026-05-10
Status: PASS (8.6/10)

## Sprint identifier
Sprint 238 — DataGrid Cell Layout Policy Lock (RDB + Document grid). 1줄 fixed row + category-based widths + drag-resize column 독립성 + ellipsis CSS + JSON oneline + min-w-full 제거 + Reset column widths 액션.

## Contract
`docs/sprints/sprint-238/spec.md` (locked at session start) + `docs/sprints/sprint-238/contract.md` + `docs/sprints/sprint-238/execution-brief.md`.

## Implementation under review

### Commits (chronological vertical-slice TDD)

1. **`38503ba`** — feat(sprint-238): trace bullet — 백엔드 `ColumnCategory` enum + PG/Mongo `map_*_data_type` + `useColumnWidths` 훅 foundation + `safeStringifyCell` + DataGridToolbar reset 버튼 + (c) 산식.
2. **`79cd510`** — feat(sprint-238): cell ellipsis + truncateCell 폐기 (slice #8/#12). 4 grid (`DataRow` / `DocumentDataGrid` / `QueryResultGrid` / `EditableQueryResultGrid`) ellipsis CSS + `dir="auto"` + `unicode-bidi:isolate`. `truncateCell` + `CELL_DISPLAY_LIMIT` 제거.
3. **`bf96376`** — feat(sprint-238): ColumnInfo category enrichment (slice #11). Rust `ColumnInfo.category` (`#[serde(default)]` Unknown). PG/Mongo schema fetcher 가 `map_pg_data_type` / `map_mongo_data_type` 통해 채움. TS `ColumnInfo.category?` 옵션.
4. **`b9dd160`** — feat(sprint-238): DataGridTable useColumnWidths 통합 (slice #9/#10). DataGridTable 가 widths state 직접 owning. `forwardRef` + `useImperativeHandle` 로 reset 노출. `useColumnResize` API: `onColumnWidthsChange` updater → `setWidth(name, px)`. `min-w-full` 제거. category → text-align (DataRow). `useColumnWidths` 의 jsdom rootFontSize NaN fallback + production mount layout-effect.
5. **`2a45382`** — fix(sprint-238): Document grid 도 min-w-full 제거 (AC-238-11).
6. **`e1a265e`** — docs(sprint-238): findings — PASS at 8.6/10.

### Changed files (cumulative)

#### Rust
- `src-tauri/src/models/query.rs` — `ColumnCategory` enum + `Default` impl (Unknown).
- `src-tauri/src/models/schema.rs` — `ColumnInfo.category` 필드 + 테스트 fixtures.
- `src-tauri/src/models/mod.rs` — `ColumnCategory` re-export.
- `src-tauri/src/db/postgres.rs` + `src-tauri/src/db/postgres/category.rs` (NEW) — `map_pg_data_type`.
- `src-tauri/src/db/postgres/schema.rs` — schema fetcher 가 `category` 채움 (3 ColumnInfo 사이트).
- `src-tauri/src/db/postgres/queries.rs` — `QueryColumn` 가 `map_pg_data_type` 으로 enrich + 테스트 fixture (col_pk / col_plain) 갱신.
- `src-tauri/src/db/mongodb.rs` + `src-tauri/src/db/mongodb/category.rs` (NEW) — `map_mongo_data_type`.
- `src-tauri/src/db/mongodb/schema.rs` — schema fetcher 가 `category` 채움.
- `src-tauri/src/db/mongodb/queries.rs` — `QueryColumn` enrich.
- `src-tauri/src/commands/{rdb/schema,document/browse}.rs` — 테스트 fixture (`category: ColumnCategory::Unknown`).

#### Frontend
- `src/lib/columnCategory.ts` (NEW) — `ColumnCategory` 타입, `getDefaultRem` (bool 4 / int·binary 6 / float·enum 7.5 / datetime 11 / unknown 12.5 / text·object 15), `getTextAlign` (int/float→right, bool→center, else→left), `computeInitialWidths` ((c) 산식 pure 함수).
- `src/lib/jsonCell.ts` (NEW) — `safeStringifyCell` (circular/BigInt/Symbol → `"[unserializable]"`).
- `src/hooks/useColumnWidths.ts` (NEW) — mount 1회 + drag setWidth + reset.
- `src/types/query.ts` — `QueryColumn.category: ColumnCategory` (required).
- `src/types/document.ts` — `DocumentColumn.category: ColumnCategory` (required).
- `src/types/schema.ts` — `ColumnInfo.category?: ColumnCategory` (옵션 — back-compat).
- `src/lib/format.ts` — `truncateCell` + `CELL_DISPLAY_LIMIT` 제거.
- `src/components/datagrid/DataGridTable.tsx` — `forwardRef` + `useColumnWidths` + `min-w-full` 제거 + `getColumnWidth(name, category)` 시그니처.
- `src/components/datagrid/DataGridTable/DataRow.tsx` — `category` → text-align + ellipsis CSS + `safeStringifyCell`.
- `src/components/datagrid/DataGridTable/HeaderRow.tsx` — `getColumnWidth` 시그니처 변경.
- `src/components/datagrid/DataGridTable/useColumnResize.ts` — `onColumnWidthsChange` updater → `setWidth` 단일 column commit + min/max 가드 0.
- `src/components/datagrid/DataGridToolbar.tsx` — `Columns3` 아이콘 + `onResetColumnWidths` prop + 조건부 버튼.
- `src/components/document/DocumentDataGrid.tsx` — `min-w-full` 제거 + ellipsis CSS + `safeStringifyCell`.
- `src/components/query/QueryResultGrid.tsx` — ellipsis CSS + `safeStringifyCell`.
- `src/components/query/EditableQueryResultGrid.tsx` — 양 branch (hasPendingEdit / 정상) ellipsis CSS + `safeStringifyCell`.
- `src/components/rdb/DataGrid.tsx` — `columnWidths` state 제거 + `dataGridTableRef` + `handleResetColumnWidths` callback.

#### Tests (신규)
- `src/lib/columnCategory.test.ts` — 23 케이스 (lookup + (c) 산식 6 시나리오).
- `src/lib/jsonCell.test.ts` — 10 케이스.
- `src/hooks/useColumnWidths.test.ts` — 3 (mount/drag/reset).
- `src/components/datagrid/DataGridToolbar.test.tsx` — Reset 버튼 3 케이스 추가.

#### Tests (rewritten)
- `src/components/datagrid/DataGridTable.column-resize.test.tsx` — prop-mock 단언 → DOM `<th> style.width` 단언.
- `src/components/rdb/DataGrid.refetch-overlay.test.tsx` — MIN_COL_WIDTH clamp 단언 → finite/≥0 (AC-238-04).
- `src/components/rdb/DataGrid.editing.test.tsx` — truncate 단언 → 전체 텍스트 단언.
- `src/components/rdb/DataGrid.lifecycle.test.tsx` — JSON pretty-print 단언 → compact JSON 단언.

## Verification evidence

### Static / lint / type
- `pnpm tsc --noEmit` — exit 0.
- `pnpm lint` — exit 0.
- `cargo clippy --all-targets --all-features -- -D warnings` — exit 0.

### Tests
- `pnpm vitest run` — **3176 passed (250 files)**.
- `cargo test` (lib): 31 + 28 + 12 = 71 passed in `db::`, `models::`, `commands::` 모듈 (단축 출력에서 확인된 모듈 별 결과 합산).

## Acceptance Criteria coverage

| AC | Status |
|----|--------|
| AC-238-01 1줄 row 고정 | ✓ |
| AC-238-02 category SoT 백엔드 (raw data_type 비회귀) | ✓ |
| AC-238-03 (c) 산식 mount 1회 | ✓ |
| AC-238-04 drag-resize 한도 없음, 세션 메모리만 | ✓ |
| AC-238-05 char-truncate 폐기 | ✓ |
| AC-238-06 CSS ellipsis + bidi | ✓ |
| AC-238-07 JSON oneline + safeStringifyCell | ✓ |
| AC-238-08 text-align category 기반 | ✓ (DataRow only — Document grid 의 text-align 적용은 다음 sprint) |
| AC-238-09 detail expansion 추가 안 함 | ✓ |
| AC-238-10 NULL 표시 유지 | ✓ |
| AC-238-11 column 독립성 + min-w-full 제거 | ✓ (RDB + Document) |
| AC-238-12 Reset column widths 액션 | ✓ |

## Verdict
**PASS at 8.6/10**. 12개 AC 모두 구현·테스트되었고, 사용자 보고 #4 (RTL/스크롤 중 폭 변동) 의 진짜 trigger 였던 `min-w-full` 가 양쪽 grid 에서 제거되었다. (c) 산식 mount-only 로 lock, drag-resize column 독립성 유지.

## Follow-up — Sprint 239+

spec 의 Out of Scope 섹션 + findings 의 미해결 작업 그대로 이월:

1. **raw `data_type` DDL-level 노출** (serial / bigserial / smallint / timestamptz) — PG `format_type(atttypid, atttypmod)` 별도 sprint.
2. **BigInt / Decimal128 wire-format 정밀도 보존** — 사용자 명시 follow-up. i64 가 JS Number 로 파싱될 때 2^53 - 1 (Number.MAX_SAFE_INTEGER) 초과 값 손실 → 백엔드가 string 으로 직렬화 + frontend 가 BigInt 파싱. IPC contract 변경 + 모든 cell renderer 수정 필요.
3. **Document grid (c) 산식 적용 + text-align** — 본 sprint 는 `min-w-full` 제거만.
4. **TS ColumnInfo.category required 강제** — 현재 옵션 (`?:`). fixture 점진 마이그레이션 후 strict 화.
5. **AC-238-08 text-align DOM 통합 테스트** — 회귀 가드.
6. **container 폭 변동 시 onboarding** — 사용자 학습 곡선 보강.
7. **"Reset column widths" 키보드 단축키** — 별도 backlog.
