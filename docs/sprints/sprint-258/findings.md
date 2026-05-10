# Sprint 258 — DataGrid `<table>` → CSS Grid 전환 — Evaluator Findings

Date: 2026-05-11
Spec: `docs/sprints/sprint-258/spec.md` (locked at session start)

## Sprint 258 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Correctness** (35%) | 9/10 | 12/12 AC implemented + verified. `<table>` JSX 가 4 grid 본체에서 0 (AC-258-12 — `grep "<table\|<thead\|<tbody\|<tr \|<td \|<th "` 결과 doc comment 만 hit). `--cols` CSS variable cascade 가 outer container 1 곳에 lock 되고, 모든 row 가 `grid-template-columns: var(--cols)` 를 통해 동일 width track 을 공유 — column width 의 redistribute 가 발생할 수 없는 구조. (c) 산식의 컨테이너 fit (`scale = containerPx / sum`) 폐기 → mount 시점 widths 가 default rem 그대로라 stretch 의 _근거 자체_ 가 사라졌다. virtualizer 통합도 absolute positioning + outer rowgroup 의 height 만으로 scroll 영역 확보 — spacer `<td colSpan>` 가 만들었던 column-width-source 충돌이 자연 소거. |
| **Completeness** (25%) | 9/10 | 4 grid (DataGridTable / DocumentDataGrid / QueryResultGrid / EditableQueryResultGrid) 모두 한 sprint 안에서 마이그레이션. `useColumnResize` 의 시그니처도 `tableRef` + `getStartWidth` 단일 column 측정에서 `outerRef` + `getCurrentWidths` array 로 일관 정리. cmd+shift+r 단축키도 spec 의 AC-258-08 대로 App.tsx 의 `e.shiftKey` 분기 + `reset-column-widths` 이벤트 dispatch + DataGrid / DocumentDataGrid 의 listener 로 구현됨. 단, drag-resize hook 은 RDB DataGridTable 만 사용 — Document / read-only Query grid 은 Sprint 238 이후의 RDB-only 정책 그대로. |
| **Reliability** (20%) | 9/10 | 모든 4 grid 의 row 는 자체 `grid-template-columns: var(--cols)` 를 가져 _CSS Grid 의 explicit-px track 정의_ 에 의해 cell content / container width 변동에도 column 이 stretch 되지 않는다. virtualizer 의 vertical scrollbar 토글로 인한 container width 미세 진동 → 더 이상 column redistribute 의 trigger 가 아님. drag 중에는 `outer.style.setProperty('--cols', ...)` 로 imperative 갱신 (per-frame setState 회피), drag-end 시에 React state 커밋 — 다음 render 가 동일 `--cols` 를 다시 발행하므로 시각 회귀 0. ellipsis 도 `<div role="gridcell">` 의 `min-w-0 overflow-hidden text-ellipsis whitespace-nowrap` 만으로 정상 동작 — 긴 cell content 가 column 을 밀어내지 못함 (Grid track 의 explicit-px 가 cell content 의 intrinsic width 보다 우선). |
| **Verification Quality** (20%) | 8/10 | 3176 tests passed (251 files) — Sprint 238 대비 동일 갯수, 단 `<table>` 셀렉터 의존 12 파일 모두 마이그레이션 (`tbody tr td` → `[role="row"][aria-rowindex="..."] [role="gridcell"]`, `<th>` → `[role="columnheader"]`, `.closest("tr")` → `.closest('[role="row"]')`). `useColumnWidths.test` 는 컨테이너 fit 폐기에 맞춰 mock container 무관한 단순 시그니처로 재작성 (`useColumnWidths(cols)` 단일 인자). column-resize.test 는 `<th> style.width` 단언 → outer container 의 `--cols` CSS variable 첫 토큰 px 단언으로 이전. **Gap**: drag 중 `--cols` 의 _다른_ column 이 변하지 않는다는 단언은 column-resize.test 만 lock — DataGrid.refetch-overlay.test 의 drag 케이스는 첫 column px 만 단언. 4 grid 의 ARIA grid roles (rowcount/colcount/rowindex/colindex) integrity 는 컴포넌트 단위 테스트는 있으나 e2e-level 회귀 가드는 미실시. |
| **Overall** | **8.8/10** | Weighted: 9×0.35 + 9×0.25 + 9×0.20 + 8×0.20 = 3.15 + 2.25 + 1.8 + 1.6 = 8.8. |

## Verdict: PASS

5 가지 사용자 보고 회귀 (scroll 중 width jitter / id 컬럼 특이성 / id 드래그 시 모든 column 확장 / cell content 가 column 을 밀어내는 ellipsis 실효 / cmd+shift+r 무동작) 가 모두 한 인과 — `<table>` 의 layout engine 이 columns 합 vs container width 를 가지고 redistribute 하는 동작 — 으로 묶인다는 가설이 검증됐고, layout engine 자체를 떠나는 것이 단일 fix 였다. CSS Grid 의 `grid-template-columns` 의 explicit-px track 정의는 _redistribute 자체가 spec 에 정의되지 않은 동작_ 이므로, 시각 회귀의 _근거_ 가 사라졌다.

## Sprint Contract Status (AC-258-01..12)

- [x] **AC-258-01** `<table>` markup 폐기 — 4 grid 본체의 `<table>` / `<thead>` / `<tbody>` / `<tr>` / `<th>` / `<td>` JSX 0. `<div role="grid">` + `<div role="rowgroup">` + `<div role="row">` + `<div role="columnheader" | "gridcell">` 로 대체. ARIA 의 rowcount/colcount/rowindex/colindex 모두 유지.
- [x] **AC-258-02** Column widths 는 CSS Grid + CSS 변수 — outer container 가 `style={{ "--cols": colsTemplate }}` 를 owning 하고, 모든 row 가 `grid-template-columns: var(--cols)` cascade. width 변경 (drag, reset) 시 outer 한 곳만 mutate.
- [x] **AC-258-03** (c) 산식 컨테이너 fit 폐기 — `computeInitialWidths(cols, rootFontSizePx)` 가 column 별 `getDefaultRem(category) * rootFontSizePx` 를 반환할 뿐. `scale` 매개변수 / 컨테이너 width 측정 / scale 적용 모두 제거. `useColumnWidths` 도 containerRef 인자 폐기.
- [x] **AC-258-04** Drag-resize via `--cols` — `useColumnResize` 가 outer container 의 `style.setProperty("--cols", ...)` 로 imperative 갱신, drag-end 시 `setWidth(name, px)` 단일 column 커밋. min/max 가드 0 (`Math.max(0, ...)` floor 만).
- [x] **AC-258-05** Header sticky — `<div role="rowgroup">` + `position: sticky; top: 0; z-index: 10` 유지. CSS Grid 의 row 가 sticky 와 호환.
- [x] **AC-258-06** Virtualizer 통합 — `useVirtualizer` + scrollContainer (outer `[role="grid"]`). 가상 row = absolute positioned `<div role="row">` (top: virtualItem.start). spacer row 폐기 — outer rowgroup 의 `height: rowVirtualizer.getTotalSize()` 로 scroll 영역 확보.
- [x] **AC-258-07** Cell ellipsis — `<div role="gridcell">` 의 `min-w-0 overflow-hidden text-ellipsis whitespace-nowrap` + inner span 의 `dir="auto"` + `[unicode-bidi:isolate]`. cell content 가 길어도 grid track 의 explicit px 를 넘어서 column 을 밀어내지 않는다.
- [x] **AC-258-08** cmd+shift+r 단축키 — App.tsx 가 `e.key.toLowerCase() === "r"` 로 normalize, `e.shiftKey` 분기에서 `reset-column-widths` 이벤트 dispatch. DataGrid + DocumentDataGrid 가 `reset-column-widths` listen 해서 widths reset.
- [x] **AC-258-09** Column reorder 호환 — 기존 `columnOrder: number[]` 유지. visualWidthsPx / colsTemplate 가 order 따라 정렬.
- [x] **AC-258-10** 4 grid 일괄 전환 — DataGridTable + DocumentDataGrid + QueryResultGrid (read-only) + EditableQueryResultGrid 모두 마이그레이션. 4 grid 가 동일 ARIA grid roles 와 `--cols` cascade 패턴을 공유.
- [x] **AC-258-11** 테스트 마이그레이션 — 12 test 파일 (column-resize / column-sort / context-menu / editing-visual / text-align / DocumentDataGrid / DocumentDataGrid.refetch-overlay / EditableQueryResultGrid / EditableQueryResultGrid.safe-mode / QueryResultGrid / DataGrid.editing / DataGrid.refetch-overlay) 의 `<th>` / `<td>` / `tbody tr` 셀렉터를 ARIA roles 로 마이그레이션. 3176 tests passed.
- [x] **AC-258-12** `<table>` JSX 흔적 0 — 4 grid 본체의 grep 결과 doc comment 2 hit (Sprint 258 의 변경 메모). 실제 JSX 에는 0.

## 사용자 review 추가 작업 (in-sprint follow-up)

세션 후반에 사용자 검토에서 다음 3 항목이 같은 sprint 안에서 추가 처리됐다:

- **Cell vertical-center** — header 와 body cell 의 위아래 가운데 정렬. header `<div role="columnheader">` 에 `flex flex-col justify-center`, body `<div role="gridcell">` 에 `flex items-center`. `text-right` / `text-center` 가 flex container 안에서 무력화되는 회귀를 막기 위해 cell alignClass 를 `justify-end` / `justify-center` 와 동기화. 4 grid 모두 적용.
- **UUID 별도 ColumnCategory 분리** — UUID 는 36 자 고정폭 (8-4-4-4-12 + 4 dashes) 이라 text (15rem) 에서 잘림. `ColumnCategory::Uuid` 를 백/프론트 양쪽 union 에 추가, default 18rem (text-align left). `map_pg_data_type("uuid")` → `Uuid` 로 분리.
- **PG `format_type(atttypid, atttypmod)` 도입** — Sprint 238 follow-up #1 (raw DDL-level data_type) 을 본 sprint 안에서 처리. `information_schema.columns.data_type` ("character varying") 대신 `pg_catalog.pg_attribute` + `format_type` 으로 `varchar(200)` / `numeric(10,2)` / `text[]` / `timestamptz` 등 DDL-level 표기 노출. `normalize_pg_type` 으로 psql `\d` 단축형 변환 (`character varying` → `varchar`, `timestamp with time zone` → `timestamptz` …). `map_pg_data_type` 은 parameter (괄호) / array (`[]`) 표기에서 base type 추출, array → Object 분기 추가. 3 query site (table / schema-bulk / view) 일괄 마이그레이션.

추가 검증: 3178 frontend tests (251 files, +2 from 3176) · 652 Rust tests · tsc / lint / clippy 모두 exit 0.

## Out-of-Scope (Sprint 259+ 또는 별도 backlog)

spec 의 Out of Scope 섹션 그대로 이월 + 본 sprint 작업 중 발견된 추가 정리 항목:

- **BigInt / Decimal128 wire-format 정밀도 보존** — IPC contract 변경.
- **column widths 의 localStorage / 세션 persistence** — 본 sprint 도 in-memory only.
- **TanStack Table v8 도입** — 본 sprint 는 layout engine 만 교체.
- **Drag-resize 를 Document / read-only Query grid 까지 확대** — Sprint 238 이후의 RDB-only 정책 유지. 사용자 ask 시 별도 sprint.
- **`serial` / `bigserial` 복원** — `format_type` 은 underlying `integer` / `bigint` 로 반환. `pg_attrdef` 의 `nextval(...)` default 를 본 후 serial 로 복원하는 로직은 별도 sprint.
- **Mongo `objectId` → `Uuid` category 매핑** — 본 sprint 는 PG 만. Mongo BSON `objectId` 는 현재 `Unknown` (12.5rem) → uuid 와 유사한 width 정책 필요.

## 구현 슬라이스 이력

본 sprint 의 vertical slice 진행:

1. **(c) 산식 + useColumnWidths 단순화** — `computeInitialWidths(cols, rootFontSizePx)` (scale 인자 제거), `useColumnWidths(cols)` (containerRef 인자 제거) + 테스트 갱신.
2. **useColumnResize 새 시그니처** — `outerRef` + `getCurrentWidths` array + `--cols` setProperty mutate.
3. **DataGridTable + HeaderRow + DataRow** — `<table>` 폐기, ARIA grid + grid-template-columns var(--cols).
4. **virtualizer 통합** — absolute positioning, spacer 폐기.
5. **DocumentDataGrid** — 동일 패턴, drag-resize 미적용 유지.
6. **QueryResultGrid (ResultTable)** — read-only 마이그레이션.
7. **EditableQueryResultGrid** — editable raw query grid 마이그레이션.
8. **App.tsx + DataGrid** — cmd+shift+r → reset-column-widths 이벤트 + DataGrid 의 listener.
9. **테스트 마이그레이션** — 12 파일의 셀렉터를 ARIA roles 로 일괄 변경.
10. **Cell vertical-center** — 4 grid 의 header + body cell 에 flex 정렬 적용 + text-align 동기화.
11. **UUID 카테고리 + DDL-level type** — `ColumnCategory::Uuid` 추가, PG schema 3 query 를 `pg_catalog.format_type` 으로 마이그레이션, `normalize_pg_type` 으로 psql 단축형 적용, `map_pg_data_type` 에 parameter/array 표기 지원 추가.
