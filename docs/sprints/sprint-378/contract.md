# Sprint Contract: sprint-378

## Summary

- Goal: Drag handle 더블클릭 → width 초기화. (a) Sidebar resize handle
  더블클릭 → `reset_setting("sidebar_width")` IPC 1회. (b) DataGrid
  column header resize handle 더블클릭 → `useColumnWidths.reset()`
  (`reset_datagrid_prefs({...pk, field:"widths"})` IPC 1회).
- Audience: TablePlus 워크플로우 — 사용자가 width drag 후 "기본값 복귀"
  를 위해 컨텍스트 메뉴/설정 패널을 거치지 않고 가장 가까운 affordance
  (호버 시 보이는 보라색 drag handle) 를 더블클릭으로 직접 reset.
- Owner: Generator (sprint-378)
- Verification Profile: `frontend` (pnpm vitest + pnpm tsc + pnpm lint
  + cargo fmt/clippy via pre-commit; backend 변경 0 이라 cargo test
  무관).

## In Scope

- **Sidebar resize handle 더블클릭** — `src/components/layout/Sidebar.tsx`
  의 `<div className="...cursor-col-resize..." onMouseDown={...}>` 에
  `onDoubleClick` 핸들러 추가 → 기존 `handleResetSidebarWidth` (sprint-376
  callback) 재호출. 신규 backend / IPC 0.
- **DataGrid column resize handle 더블클릭** —
  `src/components/datagrid/DataGridTable/HeaderRow.tsx` 의 resize handle
  `<div className="absolute right-0 top-0 h-full w-3 cursor-col-resize..."
  onMouseDown={...}>` 에 `onDoubleClick` 추가. `HeaderRow` 가 신규
  optional prop `onResetColumnWidths` (기존, sprint-376) 를 호출.
  단, prop 은 column-level reset 이 아닌 *전체 widths reset* (sprint-376
  contract 와 동일 IPC). 별 column 만 reset 은 별 sprint.
- Tests:
  - `src/components/layout/Sidebar.reset-affordance.test.tsx` 에 신규
    case 추가 — handle 의 더블클릭 → `reset_setting("sidebar_width")`
    1회. 또한 handle 의 *단일* 클릭에서 IPC 0회 보장 (drag-start 와의
    분리 regression).
  - `src/components/datagrid/DataGridTable/HeaderRow.reset-affordance.test.tsx`
    에 신규 case 추가 — column resize handle 더블클릭 →
    `onResetColumnWidths` callback 1회. handle 의 *단일* 클릭에서는
    callback 미호출 (drag-start 와의 분리).

## Out of Scope

- Per-column 만 reset 하는 신규 IPC (현재 backend `reset_datagrid_prefs`
  의 `field:"widths"` 는 모든 column 의 widths 를 한 번에 reset. 자연한
  UX 는 더블클릭한 column 만 default 로지만, 신규 IPC = scope creep.
  본 sprint 는 *전체* 로 시작. 별 sprint 로 분리).
- 키보드 단축키 (Cmd+더블클릭, Alt+더블클릭 등).
- Confirm dialog (Q21 contract — reset 은 직접 IPC).
- 다른 panel 의 drag handle 더블클릭 (Settings panel sidebar, TabBar
  resizer 등). 본 sprint 는 사용자 캡처 이미지 #7 의 두 handle 만.
- 신규 backend / IPC. 모두 sprint-376 IPC 재활용.

## Invariants

- 더블클릭 = reset. 단일 클릭 (drag-start mousedown 만, mouseup 없이
  click) 에서 reset IPC 0 호출.
- `onMouseDown` 의 drag-start path 는 sprint-258 의 imperative
  `--cols` write + sprint-369 의 sidebar drag 와 충돌 0 — `onDoubleClick`
  은 React synthetic event 로 mousedown 흐름과 독립.
- Confirm dialog 0. 사용자 의도가 명확한 더블클릭 = 즉시 IPC.
- sprint-376 의 IPC wrapper (`resetSetting("sidebar_width")` +
  `useColumnWidths.reset()`) 재사용 — 신규 helper 0.

## Acceptance Criteria

- `AC-378-01` Sidebar resize handle 의 `onDoubleClick` 트리거 →
  `invoke("reset_setting", { key: "sidebar_width" })` 1회. RTL test.
- `AC-378-02` Sidebar resize handle 의 단일 `onMouseDown` (mouseup
  없이) → reset IPC 0회. RTL test (단일 클릭 vs 더블클릭 분리 regression).
- `AC-378-03` DataGrid column resize handle 의 `onDoubleClick` →
  `onResetColumnWidths` callback 1회. RTL test.
- `AC-378-04` DataGrid column resize handle 의 단일 `onMouseDown` →
  `onResetColumnWidths` callback 0회. RTL test.
- `AC-378-05` `HeaderRow` 가 column resize handle `onDoubleClick` 에서
  header `onClick`/`onMouseDown` 으로의 bubble 을 막아 `onSort` 가
  발사되지 않는다. RTL test.

## Design Bar / Quality Bar

- TDD: 새 RTL case 5개 모두 red → 코드 추가 → green.
- 신규 IPC / backend / helper 0. sprint-376 의 frontend wrapper 만 재사용.
- 더블클릭 핸들러는 inline arrow — 추가 useCallback 없음 (현재 핸들러는
  이미 `useCallback` 캡처되어 있으니 그대로 재사용).
- 테스트 작성 날짜 (2026-05-17) + 사유 헤더 코멘트 필수.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/components/layout/Sidebar src/components/datagrid/DataGridTable/HeaderRow`
2. `pnpm tsc --noEmit`
3. `pnpm lint`
4. lefthook pre-commit (cargo fmt + clippy + prettier + secret scan) 통과.

### Required Evidence

- 5 신규 AC 의 RTL test name + 결과.
- `pnpm tsc --noEmit` 통과.
- `pnpm lint` 통과 (warn/err 0).

## Test Requirements

- Vitest: 5 신규 RTL case (Sidebar 2 + HeaderRow 3).
- Coverage: Sidebar.tsx / HeaderRow.tsx 의 변경 라인 100% (handler 추가
  + bubble guard).

## Test Script / Repro Script

1. `pnpm vitest run src/components/layout/Sidebar src/components/datagrid/DataGridTable/HeaderRow`
2. `pnpm tsc --noEmit && pnpm lint`
3. lefthook pre-commit 통과 시 commit + push.

## Ownership

- Generator: general-purpose Agent.
- Write scope: In Scope 의 두 파일 + 두 테스트 파일.
- Merge order: sprint-376 이후 (sprint-376 IPC 재활용 의존).

## Exit Criteria

- Open P1/P2: 0
- AC 5/5 PASS
- lefthook 통과
- PR 생성 + URL 보고
