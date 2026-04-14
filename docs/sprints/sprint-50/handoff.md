# Sprint 50 Handoff: Multi-row Selection Foundation

## What Changed

| File | Change |
|------|--------|
| `src/components/datagrid/useDataGridEdit.ts` | `selectedRowIdx` → `selectedRowIds: Set<number>`, `anchorRowIdx` 추가, `handleSelectRow(rowIdx, metaKey, shiftKey)` 추가, page 변경 시 선택 초기화 useEffect |
| `src/components/datagrid/DataGridTable.tsx` | Props: `selectedRowIds`, `onSelectRow(rowIdx, metaKey, shiftKey)`, 다중 선택 하이라이트 |
| `src/components/datagrid/DataGridToolbar.tsx` | `selectedRowIdsCount` prop, 다중 선택 시 카운트 표시 |
| `src/components/DataGrid.tsx` | editState → 하위 컴포넌트 wiring 업데이트 |
| `src/components/datagrid/useDataGridEdit.multi-select.test.ts` | 신규: 16개 단위 테스트 |
| `src/components/DataGrid.test.tsx` | 추가: 5개 통합 테스트 |

## Acceptance Criteria Status

| AC | Status | Evidence |
|----|--------|----------|
| AC-01: 일반 클릭 → 단일 선택 | PASS | useDataGridEdit.ts:162, 테스트 96-121줄 |
| AC-02: Cmd/Ctrl+Click → 토글 | PASS | useDataGridEdit.ts:134-146, 테스트 124-165줄 |
| AC-03: Shift+Click → 범위 선택 | PASS | useDataGridEdit.ts:147-155, 테스트 168-192줄 |
| AC-04: 다중 선택 하이라이트 | PASS | DataGridTable.tsx:206,210 |
| AC-05: Delete Row 일괄 삭제 | PASS | useDataGridEdit.ts:246-259, 테스트 208-233줄 |
| AC-06: Page 변경 시 선택 초기화 | PASS | useDataGridEdit.ts useEffect, 테스트 rerender |
| AC-07: Anchor 없는 Shift+Click | PASS | useDataGridEdit.ts:156-159, 테스트 195-205줄 |
| AC-08: 단위 테스트 커버 | PASS | 21개 신규 테스트 |

## Verification Results

- `pnpm tsc --noEmit` — PASS
- `pnpm vitest run` — 728 tests PASS
- `pnpm lint` — PASS
- `pnpm build` — PASS

## Next Sprint: Sprint 51 — Row Context Menu & Copy Formats

Sprint 51은 이 스프린트의 `selectedRowIds`와 `handleSelectRow`를 기반으로:
- 행 우클릭 컨텍스트 메뉴 (Edit Cell, Delete Row, Duplicate Row, Copy Row As)
- Copy as 포맷 (Plain Text, JSON, CSV, SQL Insert)
- 클립보드 API 연동
