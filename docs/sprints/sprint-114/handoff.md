# Sprint 114 → next Handoff

## Sprint 114 Result
- **PASS** (Generator + Evaluator, 1 attempt) — 1822/1822 tests, tsc/lint 0. Evaluator overall 8.75/10.

## 산출물
- `package.json`: `@tanstack/react-virtual ^3.13.24` 의존성.
- `src/test-setup.ts`: jsdom `ResizeObserver` polyfill (feature-detected guard).
- `src/components/datagrid/DataGridTable.tsx`:
  - `VIRTUALIZE_THRESHOLD = 200` constant + `shouldVirtualize` 플래그.
  - `useVirtualizer({ count, getScrollElement: scrollContainerRef.current, estimateSize: 32, overscan: 10 })` 와 outer overflow-auto wrapper ref 연결.
  - `renderDataRow(rowIdx)` 헬퍼 추출 — eager / virtualized 양 path 가 동일 셀 렌더 로직 공유.
  - 가상화 path: `<tbody>` 내부에 leading/trailing spacer `<tr aria-hidden="true">` (높이 = `start` / `totalSize - end`) + 가상 행만 실 렌더. `aria-rowindex={virtualRow.index + 2}`, `aria-rowcount` 는 글로벌 (1 + total + pendingNew).
  - `useEffect` (data.executed_query / sorts / shouldVirtualize 변화 시 `scrollToIndex(0, { align: "start" })` 로 viewport reset).
- `src/components/datagrid/DataGridTable.virtualization.test.tsx` (신규): 7 테스트 (1000 rows ≤ 101 DOM rows, rowindex=2 정확도, rowcount=1001, sort reset, ≤200 eager path 정확히 101 rows, threshold boundary 201, aria-colindex 보존).

## AC Coverage
- AC-01: 1000-row mock 으로 `getAllByRole("row")` ≤ 101 단언. spacer 는 `aria-hidden="true"` + `role` 미지정으로 query 에서 제외.
- AC-02: useEffect 가 sorts/executed_query 변경 시 `scrollToIndex(0)` 호출 → 첫 행 (rowindex=2) 가시.
- AC-03: `renderDataRow` 가 모든 path 에서 `aria-rowindex={rowIdx + 2}`.
- AC-04: ≤200 rows (기존 73개 DataGrid + ARIA 테스트들의 fixture 크기) 는 eager path. datagrid sub-suite 26 파일 / 364 테스트 통과 → 회귀 0.
- AC-05: 1822/1822 tests, tsc 0, lint 0.
- AC-06: 회귀 0.

## Evaluator 권장 follow-up (이번 sprint 비포함, 후속 작업)
- spacer `<tr aria-hidden="true">` 직접 단언 추가.
- AC-02 테스트 강화 — pre-scroll 후 sort change 시 viewport 가 0 으로 복귀하는지 검증.
- VIRTUALIZE_THRESHOLD = 200 의 근거 (최대 fixture 행 수) 주석.
- DocumentDataGrid 에서 동일 패턴 재사용 시 `useResetVirtualizerOnDatasetChange` 추출.
