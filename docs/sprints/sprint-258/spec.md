# Sprint 258 Spec — DataGrid `<table>` → CSS Grid 전환

## Feature Description

Sprint 238 이 `min-w-full` 제거 + `table-layout: fixed` 유지 + (c) 산식 컨테이너 fit 으로 column-width 안정화를 시도했으나, **`<table>` 자체가 stretch 의 진원지**라는 게 사용자 검증에서 드러났다. 5 가지 회귀가 한 인과로 묶인다:

1. **Scroll 중 너비 jitter** — virtualizer 가 row mount/unmount → tbody height 변동 → vertical scrollbar 토글 → container content-width 진동 → `<table>` width:auto 가 따라 진동 → table-layout:fixed 가 columns 합 < table.width 일 때 비례 분배 → 모든 column 폭이 미세하게 흔들림.
2. **id 컬럼 특이성** — id 는 `int` (default 6rem ≈ 96px) 로 가장 좁은 column. 비례 분배에서 절대 폭 변화는 작지만 base 대비 jitter 가 시각적으로 가장 두드러짐.
3. **id 드래그 시 다른 column 확장** — drag 중 `applyWidth` 가 `table.style.width` 를 직접 mutate. drag-end 후 React 가 `<th>`/`<td>` 만 redraw, `<table>` inline `style.width` 는 stale → columns 합과 table.width 의 어긋남이 매 paint 마다 redistribute 발동.
4. **긴 cell content 에서 ellipsis 실효** — `<td>` 의 explicit `style.width` 가 무력화되고 cell content 가 column 을 밀어내는 현상. `table-layout: fixed` 가 first row column-source 를 spacer `<td colSpan>` 로부터 잃어버린 fallback 동작 추정.
5. **cmd+shift+r 무동작** — App.tsx 의 단축키 핸들러가 `e.key === "r"` 만 검사 (shift 누르면 `"R"` 대문자라 누락). Tauri WKWebView default 도 capability 미등록이면 무시. 설령 reload 가 일어나도 (c) 산식이 컨테이너 fit 이라 _같은 stretch 결과_ 를 produce → 사용자 인식상 "되돌아오지 않음".

근본 해법: `<table>` 이라는 layout engine 을 떠난다. CSS Grid 로 전환하면 grid-template-columns 의 explicit px 가 cell content / container width 에 의해 redistribute 되지 않는다. Stretch 의 _근거 자체_ 가 사라진다.

## Sprint Breakdown

이 feature 는 **단일 sprint (Sprint 258)** 로 끝낸다. 4 grid (DataGridTable / DocumentDataGrid / QueryResultGrid / EditableQueryResultGrid) 모두 한 sprint 안에서 일관되게 전환 — 부분 전환은 css/markup 두 layout 엔진을 동시 운영해서 회귀 위험만 키운다.

## Acceptance Criteria

### AC-258-01 — `<table>` markup 폐기
- 4 grid 모두 `<table>` / `<thead>` / `<tbody>` / `<tr>` / `<th>` / `<td>` 사용 중지.
- 대체: `<div role="grid">` + `<div role="rowgroup">` + `<div role="row">` + `<div role="columnheader" | "gridcell">`.
- `aria-rowindex` / `aria-colindex` / `aria-rowcount` / `aria-colcount` 모두 유지 — 접근성 회귀 0.

### AC-258-02 — Column widths 는 CSS Grid + CSS 변수
- Outer scroll container `<div role="grid">` 에 inline `style={{ "--cols": "Npx Mpx ..." }}` (각 column 의 explicit px).
- 각 row container 가 `display: grid; grid-template-columns: var(--cols)` 사용.
- Column width 변경 (drag, reset) 시 outer container 의 `--cols` 만 mutate → 모든 row 가 cascade 로 따라옴. row 별 inline style mutate 불요.
- container width 변동, scrollbar 토글, cell content 길이 — 그 어떤 요인으로도 column width 가 redistribute 되지 않는다 (CSS Grid 의 explicit-px track 정의상 보장).

### AC-258-03 — (c) 산식 컨테이너 fit 폐기
- column initial width = `getDefaultRem(category) * rootFontSizePx` 그대로. `scale = containerPx / sum` 적용 안 함.
- 결과: mount 시 columns 합 < container 면 우측 잔여 공간 (사용자 의도), columns 합 > container 면 horizontal scroll. 둘 다 stretch 없음.
- `computeInitialWidths` 함수의 scale 로직 제거 — 또는 함수 자체 폐기, `getDefaultRem` 만 남김.

### AC-258-04 — Drag-resize 는 `--cols` 변경
- drag handle 위치 / hit area 기존과 동일.
- drag 중 imperative DOM 갱신: outer container 의 `style.setProperty('--cols', ...)` 직접 호출 (per-frame setState 회피, 기존 패턴 유지).
- drag-end 시 `useColumnWidths.setWidth(name, px)` 로 React state 커밋. state → render 사이클이 동일 `--cols` 값을 다시 발행 → 시각 회귀 없음.
- min/max 가드 0 (Sprint 238 AC-238-04 user-free policy 유지).

### AC-258-05 — Header sticky
- header row container `position: sticky; top: 0; z-index: 10` 로 기존 동작 유지.
- CSS Grid 의 row 가 sticky 와 호환 (검증됨, MDN/CanIUse).

### AC-258-06 — Virtualizer 통합
- `@tanstack/react-virtual` `useVirtualizer` 유지. Scroll element = outer `<div role="grid">`.
- 가상 row 는 `position: absolute; top: virtualItem.start; left: 0; right: 0` + `display: grid; grid-template-columns: var(--cols)`.
- spacer row 폐기 — absolute positioning + outer container 의 `style.height = totalSize` 만으로 scroll 영역 확보. spacer `<td colSpan>` 가 만들었던 column-source 충돌이 자연 소거된다.

### AC-258-07 — Cell ellipsis 보장
- 각 cell `<div role="gridcell">` 에 `overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0`. 
- inner element 가 길어도 grid track 의 explicit px 를 넘어서 column 을 밀어낼 수 없음 (Grid 명세).
- `dir="auto"` + `[unicode-bidi:isolate]` 기존대로 유지.

### AC-258-08 — Toolbar Reset + cmd+shift+r 단축키
- 기존 toolbar "Reset column widths" 버튼 (Sprint 238 AC-238-12) 유지.
- App.tsx 의 단축키 핸들러를 `e.key.toLowerCase() === "r"` 로 normalize, `e.shiftKey` 분기 추가:
  - cmd+r / ctrl+r / F5 → `refresh-data` (data refetch, 기존 동작).
  - cmd+shift+r / ctrl+shift+r → `reset-column-widths` 새 이벤트.
- DataGrid + DocumentDataGrid 가 `reset-column-widths` listen → 각자의 grid handle 의 reset 호출.
- editable target 가드 (input / textarea / contenteditable focused) 기존대로.

### AC-258-09 — column reorder 호환
- 기존 `columnOrder: number[]` (visual → data idx 매핑) 유지.
- `--cols` 의 px 순서를 `columnOrder` 에 맞춰 정렬. cell rendering 도 `order.map((dIdx, visualIdx) => ...)` 기존 패턴.

### AC-258-10 — 4 grid 일괄 전환
- 본 sprint 안에서 모두 마이그레이션:
  - `src/components/datagrid/DataGridTable.tsx` (RDB)
  - `src/components/document/DocumentDataGrid.tsx`
  - `src/components/query/QueryResultGrid.tsx`
  - `src/components/query/EditableQueryResultGrid.tsx`
- 4 grid 가 가능한 한 동일한 grid shell primitive 를 공유 — 중복 layout 코드 최소화. 단, edit / blob / fk / pending state 같은 grid 별 특이 동작은 그대로.

### AC-258-11 — 테스트 마이그레이션
- 기존 `<th>` / `<td>` 셀렉터 단언 → `[role="columnheader"]` / `[role="gridcell"]` 로 전환.
- column-resize.test 의 `<th> style.width` 단언 → `outerGrid.style` 의 `--cols` parse 또는 `[role="columnheader"]` 의 `getBoundingClientRect().width` 로 전환.
- text-align.test (Sprint 238 AC-238-08 lock) — `[role="gridcell"]` 클래스 단언 그대로.
- `pnpm vitest run` exit 0, `cargo test` 영향 없음 (백엔드 변화 없음).

### AC-258-12 — `<table>` JSX 흔적 0
- 4 grid 본체에서 `<table` / `<thead` / `<tbody` / `<tr` / `<th` / `<td` 검색 결과 0 (단, 외부 라이브러리 / 메일 양식 / 마크다운 등은 제외).
- `useColumnResize` / `useColumnWidths` 등의 helper 가 더 이상 `tableRef` / `<th>` querySelector 에 의존하지 않는다.

## Out of Scope (Sprint 259+)

- BigInt / Decimal128 wire-format 정밀도 보존 — IPC contract 변경.
- raw DBMS data_type DDL-level 노출 (`serial`, `varchar(200)`, `text[]` 등) — PG `format_type(atttypid, atttypmod)` 경로 별도 sprint.
- column widths 의 localStorage / 세션 persistence — 본 sprint 도 in-memory only (Sprint 238 AC-238-04 정책 그대로).
- TanStack Table v8 도입 — 본 sprint 는 layout engine 만 교체, headless table lib 도입은 별도 ADR + sprint.
