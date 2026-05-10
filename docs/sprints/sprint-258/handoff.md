# Sprint 258 — Handoff Stub

Date: 2026-05-11
Status: PASS (8.8/10)

## Sprint identifier
Sprint 258 — DataGrid `<table>` → CSS Grid 전환 (4 grid 일괄). `<table-layout: fixed>` 폐기 + `grid-template-columns: var(--cols)` cascade + virtualizer absolute positioning + cmd+shift+r → `reset-column-widths` 이벤트.

## Contract
`docs/sprints/sprint-258/spec.md` (locked at session start).

## Implementation under review

### Vertical-slice 진행

본 sprint 는 `feedback_git_ops.md` 정책에 따라 assistant 가 직접 commit 을 만들지 않고, working tree 의 모든 변경을 사용자가 일괄 검토 / commit. 따라서 본 항목은 commit hash 가 아닌 **slice 순서** 로 기록한다 (findings 의 "구현 슬라이스 이력" 와 동일).

1. **(c) 산식 + `useColumnWidths` 단순화** — `computeInitialWidths(cols, rootFontSizePx)` 의 `scale` 인자 폐기, `useColumnWidths(cols)` 의 `containerRef` 인자 폐기. 컨테이너 fit 의 _근거 자체_ 를 떠난다.
2. **`useColumnResize` 새 시그니처** — `outerRef` + `getCurrentWidths` array + drag 중 `outer.style.setProperty("--cols", ...)` imperative 갱신. drag-end 시 `setWidth(name, px)` 단일 column 커밋.
3. **DataGridTable + HeaderRow + DataRow** — `<table>` / `<thead>` / `<tbody>` / `<tr>` / `<th>` / `<td>` 폐기. `<div role="grid">` + `<div role="rowgroup">` + `<div role="row" style={{ display:'grid', gridTemplateColumns:'var(--cols)' }}>` + `<div role="columnheader" | "gridcell">` 로 대체. ARIA rowcount/colcount/rowindex/colindex 모두 유지.
4. **virtualizer 통합** — 가상 row = `position: absolute; top: virtualItem.start`. spacer row 폐기 — outer rowgroup 의 `style.height = rowVirtualizer.getTotalSize()` 만으로 scroll 영역 확보. Sprint 238 의 spacer `<td colSpan>` 가 만들었던 column-source 충돌이 자연 소거.
5. **DocumentDataGrid** — 동일 패턴. drag-resize 미적용 정책 (Sprint 238 RDB-only) 유지.
6. **QueryResultGrid (read-only)** — ResultTable 마이그레이션.
7. **EditableQueryResultGrid** — editable raw query grid 마이그레이션 (양 branch — hasPendingEdit / 정상 — 동일 grid shell).
8. **App.tsx + DataGrid (cmd+shift+r)** — `e.key.toLowerCase() === "r"` normalize, `e.shiftKey` 분기에서 `reset-column-widths` 이벤트 dispatch. DataGrid + DocumentDataGrid 의 listener 가 각 grid handle 의 reset 호출.
9. **테스트 마이그레이션** — 12 파일의 `<th>` / `<td>` / `tbody tr` / `.closest("tr")` 셀렉터를 ARIA roles 로 일괄 변경. column-resize 류는 `<th> style.width` 단언 → outer 의 `--cols` CSS variable 첫 토큰 px 단언으로 이전.

### Changed files (cumulative)

#### Rust
없음. 본 sprint 는 frontend layout engine 만 교체. `ColumnInfo.category` (Sprint 238 lock) 그대로 사용.

#### Frontend (Hook + Lib)
- `src/lib/columnCategory.ts` — `computeInitialWidths(cols, rootFontSizePx)` 시그니처 단순화 (`scale` 인자 폐기). `getDefaultRem` / `getTextAlign` 그대로.
- `src/hooks/useColumnWidths.ts` — `containerRef` 인자 폐기. `readRootFontSizePx()` helper + jsdom NaN fallback (16) 그대로. mount 1회 + drag setWidth + reset 의 외부 API 동일.

#### Frontend (RDB DataGrid)
- `src/components/datagrid/DataGridTable.tsx` — `<table>` 폐기 → `<div role="grid">` + `style={{ "--cols": colsTemplate }}` 가 outer 1 곳. virtualizer 가 absolute positioning 으로 가상 row 발행. `visualWidthsPx` / `colsTemplate` `useMemo` + `getCurrentWidths` callback ref.
- `src/components/datagrid/DataGridTable/HeaderRow.tsx` — `<thead>/<tr>/<th>` 폐기 → `<div role="rowgroup">` (sticky) + `<div role="row">` (grid template) + `<div role="columnheader">`. 셀별 explicit width style 제거 — column track 은 outer 의 `--cols` cascade.
- `src/components/datagrid/DataGridTable/DataRow.tsx` — `<tr>/<td>` 폐기 → `<div role="row">` + `<div role="gridcell">`. `rowStyle?: CSSProperties` prop 추가 (virtualizer 의 absolute position 주입). `getColumnWidth` context 제거.
- `src/components/datagrid/DataGridTable/useColumnResize.ts` — 새 API: `{ outerRef, getCurrentWidths, onCommitWidth }`. drag 중 `outer.style.setProperty("--cols", ...)` mutate, drag-end 시 `onCommitWidth(name, px)` 단일 column 커밋. min/max 가드 0 (Sprint 238 AC-238-04 user-free policy 유지).
- `src/components/rdb/DataGrid.tsx` — `reset-column-widths` 이벤트 listener → `dataGridTableRef.current?.resetColumnWidths()`.

#### Frontend (Document grid)
- `src/components/document/DocumentDataGrid.tsx` — 동일 grid 패턴. `useColumnWidths` + `colsTemplate` 도입. `reset-column-widths` 이벤트 listen. `<table>` 흔적 0.

#### Frontend (Query grids)
- `src/components/query/QueryResultGrid.tsx` — read-only ResultTable 의 `<table>` → CSS Grid 전환.
- `src/components/query/EditableQueryResultGrid.tsx` — editable raw query grid 마이그레이션.

#### Frontend (App)
- `src/App.tsx` — `e.key.toLowerCase() === "r"` normalize + `e.shiftKey` 분기 + `reset-column-widths` 이벤트 dispatch.

#### Tests (rewritten — selector migration to ARIA roles)
- `src/components/datagrid/DataGridTable.column-resize.test.tsx` — `<th> style.width` 단언 → `outer.style['--cols']` 첫 토큰 px 단언.
- `src/components/datagrid/DataGridTable.column-sort.test.tsx` — `<th>` 셀렉터 → `[role="columnheader"]`.
- `src/components/datagrid/DataGridTable.context-menu.test.tsx` — `tbody tr td` → `[role="row"][aria-rowindex] [role="gridcell"]`.
- `src/components/datagrid/DataGridTable.editing-visual.test.tsx` — 동일 패턴.
- `src/components/datagrid/DataGridTable.text-align.test.tsx` — 동일 패턴 (Sprint 238 AC-238-08 lock 유지).
- `src/components/document/DocumentDataGrid.test.tsx` — `.closest("tr")` → `.closest('[role="row"]')`.
- `src/components/document/DocumentDataGrid.refetch-overlay.test.tsx` — 동일 패턴.
- `src/components/query/QueryResultGrid.test.tsx` — `<th>` / `<td>` → ARIA roles.
- `src/components/query/EditableQueryResultGrid.test.tsx` — bulk perl 치환 + manual fix.
- `src/components/query/EditableQueryResultGrid.safe-mode.test.tsx` — 동일 패턴.
- `src/components/rdb/DataGrid.editing.test.tsx` — 동일 패턴.
- `src/components/rdb/DataGrid.refetch-overlay.test.tsx` — column-resize 케이스 rewrite (`<th> style.width` → `--cols` 첫 토큰 px). 다른 케이스는 ARIA selector 단순 치환.

#### Tests (rewritten — signature migration)
- `src/hooks/useColumnWidths.test.ts` — mock container 무관한 단순 시그니처로 재작성 (`useColumnWidths(cols)` 단일 인자).
- `src/lib/columnCategory.test.ts` — `computeInitialWidths(cols, rootFontSizePx)` 새 시그니처에 맞춰 갱신.

## Verification evidence

### Static / lint / type
- `pnpm tsc --noEmit` — exit 0.
- `pnpm lint` — exit 0.
- `cargo clippy --all-targets --all-features -- -D warnings` — exit 0.

### Tests
- `pnpm vitest run` — **3176 passed (251 files)**. Sprint 238 (250 files) 대비 +1 file (text-align DOM 통합 가드 추가는 Sprint 238 follow-up `fc025e6` 에서 들어왔고 본 sprint 에서 ARIA selector 로 마이그레이션).
- `cargo test` — 영향 없음 (Rust 변경 0).

### `<table>` JSX 흔적 grep (AC-258-12 lock)
```
$ grep -n "<table\|<thead\|<tbody\|<tr \|<td \|<th " \
    src/components/datagrid/DataGridTable.tsx \
    src/components/document/DocumentDataGrid.tsx \
    src/components/query/QueryResultGrid.tsx \
    src/components/query/EditableQueryResultGrid.tsx
```
→ doc comment 2 hit, JSX 0.

## Acceptance Criteria coverage

| AC | Status |
|----|--------|
| AC-258-01 `<table>` markup 폐기 → ARIA grid roles | ✓ |
| AC-258-02 Column widths = CSS Grid + `--cols` 변수 | ✓ |
| AC-258-03 (c) 산식 컨테이너 fit 폐기 | ✓ |
| AC-258-04 Drag-resize via `--cols` setProperty | ✓ |
| AC-258-05 Header sticky | ✓ |
| AC-258-06 Virtualizer 통합 + spacer 폐기 | ✓ |
| AC-258-07 Cell ellipsis 보장 | ✓ |
| AC-258-08 cmd+shift+r → `reset-column-widths` | ✓ |
| AC-258-09 column reorder 호환 | ✓ |
| AC-258-10 4 grid 일괄 전환 | ✓ |
| AC-258-11 테스트 마이그레이션 | ✓ |
| AC-258-12 `<table>` JSX 흔적 0 | ✓ |

## Verdict

**PASS at 8.8/10**. 사용자 보고 5 가지 회귀 (scroll 중 width jitter / id 컬럼 특이성 / id 드래그 시 모든 column 확장 / cell content 가 column 을 밀어내는 ellipsis 실효 / cmd+shift+r 무동작) 가 한 인과 — `<table>` 의 layout engine 이 columns 합 vs container width 를 가지고 redistribute 하는 동작 — 으로 묶인다는 가설이 검증됐고, layout engine 자체를 떠나는 것이 단일 fix 였다. CSS Grid 의 `grid-template-columns` 의 explicit-px track 정의는 _redistribute 자체가 spec 에 정의되지 않은 동작_ 이므로 시각 회귀의 _근거_ 가 사라졌다.

## 사용자 review 추가 작업

세션 후반의 사용자 검토에서 본 sprint 안에 같이 처리된 항목:

- **Cell vertical-center** — header `flex flex-col justify-center`, body `flex items-center` + `text-right`/`text-center` 와 `justify-end`/`justify-center` 동기화 (flex container 안에서 inline text-align 무력화 회귀 방지). 4 grid 모두 적용.
- **UUID 별도 ColumnCategory 분리** — Rust `ColumnCategory::Uuid` + TS `"uuid"` union 추가. default 18rem (text 15rem 보다 넓어 36자 + 4 dash 수용), text-align left. `map_pg_data_type("uuid")` → `Uuid`.
- **PG `format_type` 마이그레이션** (Sprint 238 follow-up #1 처리) — `information_schema.columns.data_type` → `pg_catalog.pg_attribute` + `format_type(atttypid, atttypmod)`. 3 query site (table / schema-bulk / view) 일괄. `normalize_pg_type` 으로 `character varying` → `varchar`, `timestamp with time zone` → `timestamptz` 등 psql `\d` 단축형. `map_pg_data_type` 에 parameter (괄호) / array (`[]`) 표기 지원 + array → Object 분기 추가.

추가 변경 파일: `src/lib/columnCategory.ts` (+`uuid` union), `src-tauri/src/models/query.rs` (+`Uuid` variant), `src-tauri/src/db/postgres/category.rs` (+`normalize_pg_type` + parameter/array 지원), `src-tauri/src/db/postgres/schema.rs` (3 query 마이그레이션). 4 grid 의 cell className 조정 (DataRow + HeaderRow + DocumentDataGrid + QueryResultGrid + EditableQueryResultGrid).

추가 검증: 3178 frontend tests (251 files) · 652 Rust tests · tsc / lint / clippy 모두 exit 0.

## Follow-up — Sprint 259+

spec 의 Out of Scope 섹션 + findings 에서 발견된 미해결 항목 그대로 이월:

1. **BigInt / Decimal128 wire-format 정밀도 보존** — IPC contract 변경. Sprint 238 follow-up 에서 이월 중.
2. **column widths 의 localStorage / 세션 persistence** — 본 sprint 도 in-memory only.
3. **TanStack Table v8 도입** — 본 sprint 는 layout engine 만 교체. headless table lib 도입은 별도 ADR + sprint.
4. **Drag-resize 를 Document / read-only Query grid 까지 확대** — Sprint 238 이후의 RDB-only 정책 유지. 사용자 ask 시 별도 sprint.
5. **e2e-level ARIA grid roles integrity 가드** — 4 grid 의 rowcount/colcount/rowindex/colindex 회귀 가드는 컴포넌트 단위만 lock. e2e 차원의 가드는 미실시.
6. **drag 중 `--cols` 의 _다른_ column 불변 단언** — column-resize.test 만 lock. DataGrid.refetch-overlay.test 의 drag 케이스는 첫 column px 만 단언.
7. **`serial` / `bigserial` 복원** — `format_type` 은 underlying `integer` / `bigint` 반환. `pg_attrdef` 의 `nextval(...)` default 를 본 후 serial 로 복원하는 로직은 별도 sprint.
8. **Mongo `objectId` → `Uuid` category 매핑** — 본 sprint 는 PG 만 적용. Mongo BSON `objectId` 는 현재 `Unknown` (12.5rem) → uuid 와 유사한 width 정책 필요.
