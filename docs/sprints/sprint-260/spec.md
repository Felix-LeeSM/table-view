# Sprint 260 Spec — DataGrid layout-side 마무리 (ADR 0025 lock + drag-resize 확대 + ARIA 가드)

## Feature Description

Sprint 258 (`<table>` → CSS Grid 전환) + Sprint 259 (ObjectId / serial / persistence / drag-가드) 가 layout 측면의 회귀를 다 정리한 뒤 남은 follow-up 3 항목 — TanStack Table 도입 결정 lock, 4 grid 사이 drag-resize 비대칭 해소, 4 grid component-level ARIA 가드 — 을 한 sprint 안에서 마무리한다. wire-format 정책 (BigInt / Decimal128) 은 본 sprint scope 밖, sprint-261 에서 처리.

3 항목 묶기 기준: 모두 layout / interaction / 회귀 가드 영역이고 sprint-258 의 CSS Grid + ARIA divs 구조 위에서 동작 — IPC contract 변경 없음, backend 변경 없음, frontend-only.

## Sprint Breakdown

단일 sprint (Sprint 260). 3 항목이 독립적이고 각 항목의 변경 범위가 작아 분할 cost 가 묶기 가치보다 크다.

## Acceptance Criteria

### AC-260-01 — ADR 0025 lock (TanStack Table 도입 안 함)
- `memory/decisions/0025-datagrid-self-managed-no-tanstack/memory.md` 작성.
- 결정 / 이유 / 트레이드오프 / 관련 sprint 명시.
- `memory/decisions/memory.md` 인덱스에 entry 추가 (활성 결정 마지막 행).

### AC-260-02 — Drag-resize 4 grid 확대
- 현재 RDB `DataGridTable` 만 `useColumnResize` 사용. Document `DocumentDataGrid`, read-only `QueryResultGrid`, editable `EditableQueryResultGrid` 에도 동일 hook 도입.
- 각 grid 의 header `<div role="columnheader">` 우측에 `.cursor-col-resize` handle 추가 (DataGridTable 의 패턴 그대로). `onMouseDown` 이 `onResizeStart(e, colName, visualIdx)` 호출.
- `useColumnResize` 의 입력 (`outerRef`, `getCurrentWidths`, `onCommitWidth`) 을 4 grid 가 동일하게 wiring.
- drag 결과는 `useColumnWidths.setWidth(name, px)` 로 commit. Document grid 는 `document:<db>:<coll>` 영속 (sprint-259), Query 류는 in-memory only.
- min/max 가드 0 유지 (Sprint 238 AC-238-04 의 user-free policy).

### AC-260-03 — ARIA grid roles integrity 가드 4 grid component-level
- 4 grid 각각에 `*.aria-grid.test.tsx` (Document / Query / EditableQuery 신규, RDB 는 기존 유지).
- 각 spec 이 검증할 항목: outer `<div role="grid">` 의 `aria-rowcount` / `aria-colcount`, header row 의 `aria-rowindex={1}`, body row 의 `aria-rowindex` 가 `2` 부터 연속, 각 cell `<div role="gridcell">` 의 `aria-colindex` 가 visual order 와 일치.
- RDB 가 갖고 있는 reorder 케이스 (`aria-colindex` 가 data idx 가 아닌 visual position 추적) 도 Document / EditableQuery 에 가능한 한 복제 (read-only Query 는 reorder 없음 — skip).
- pre-push 의 `7_ts-test` 게이트 안에서 동작 — e2e 환경 의존성 없음.

### AC-260-04 — 기존 가드 회귀 없음
- 3187 frontend tests + 656 Rust tests baseline 유지 또는 증가.
- `pnpm tsc --noEmit` exit 0.
- `pnpm lint` exit 0.
- `cargo clippy --all-targets --all-features -- -D warnings` exit 0.

## Out of Scope (Sprint 261 또는 별도 backlog)

- **BigInt / Decimal128 wire-format 정밀도 보존** — sprint-261. ADR 0026 + backend serde + 4 grid cell renderer / editor.
- **e2e-level ARIA gate** — component-level 로 충분 (a11y user-flow spec 은 별도 a11y sprint).
- **Drag-resize 의 column min/max width 정책** — Sprint 238 의 user-free 정책 유지.
- **column reorder 의 Document / Query 확대** — 현재 RDB 만. 별도 sprint.
