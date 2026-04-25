# Sprint Execution Brief: sprint-114

## Objective
DataGridTable tbody 를 `@tanstack/react-virtual` 기반 가상화로 전환. 행 수 > 200 일 때만 발동 (threshold-based) 해서 기존 작은 데이터셋 테스트 회귀 0.

## Task Why
Page size 1000 / 5000 같은 대용량 결과셋에서 DOM 노드 수 폭발 → 스크롤 jank. 가상화로 viewport 외 행 미렌더 → DOM 안정.

## Scope Boundary
- **건드리지 말 것**:
  - DataGrid.tsx (호스트 컴포넌트) 의 외부 prop/api.
  - 셀 편집 / 컨텍스트 메뉴 / FK ref / BLOB / pending edits 로직 (DataGridTable 내부의 기존 동작).
  - DocumentDataGrid (별도 컴포넌트, 별도 sprint).
- **반드시 보존**:
  - sprint-106 의 ARIA 그리드 (role/aria-rowcount/aria-rowindex/aria-colindex/role="gridcell").
  - sticky thead.
  - column resize / sort / filter / page navigation.

## Invariants
- 행 수 ≤ 200: 기존 렌더 path. `getAllByRole("row")` 가 모든 행을 포함.
- 행 수 > 200: 가상화 path 발동. 단, viewport 내 행만 렌더되고 spacer 가 DOM 높이 보존.
- `aria-rowcount`, `aria-rowindex` 는 항상 글로벌 (총 행 수 / 글로벌 인덱스) 기준.

## Done Criteria
1. `pnpm add @tanstack/react-virtual` 으로 의존성 추가.
2. DataGridTable.tsx 가 행 수 > 200 시 useVirtualizer 사용. 이하면 기존 path.
3. 신규 테스트 파일 `DataGridTable.virtualization.test.tsx`: page 1000 mock 으로 DOM `<tr>` ≤ 101 (header 1 + ≤100 visible) 단언 + ARIA rowindex 정확도 + sort 후 viewport reset.
4. 기존 1815 테스트 통과 + 신규 테스트 추가.
5. tsc/lint 0.

## Verification Plan
- Profile: `command`
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`
- Required evidence:
  - 변경 파일 + 목적
  - 신규 의존성 명세 (package.json + lockfile)
  - 가상화 path 발동 단언 (DOM row count)
  - ARIA 정확도 단언

## Evidence To Return
- 변경 파일 + 목적
- 명령어 결과 (vitest 통과 수, tsc/lint 0)
- AC-01..06 단언
- 사용한 jsdom 폴리필 / mock (clientHeight 등)
- 가정/리스크
