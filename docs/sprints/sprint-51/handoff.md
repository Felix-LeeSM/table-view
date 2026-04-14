# Sprint 51 Handoff: Row Context Menu & Copy Formats

## What Changed

| File | Change |
|------|--------|
| `src/lib/format.ts` | CopyRowData 인터페이스, rowsToPlainText/Json/Csv/SqlInsert 함수 추가 |
| `src/components/datagrid/useDataGridEdit.ts` | handleDuplicateRow 추가 (선택 행 데이터를 pendingNewRows에 복사) |
| `src/components/ContextMenu.tsx` | separator?: boolean prop 추가, role="separator" 렌더링 |
| `src/components/datagrid/DataGridTable.tsx` | onContextMenu, 컨텍스트 메뉴 상태, 7개 메뉴 항목, 클립보드 통합 |
| `src/components/DataGrid.tsx` | schema/table/onDeleteRow/onDuplicateRow props wiring |
| `src/lib/format.test.ts` | 21개 복사 포맷 테스트 |
| `src/components/datagrid/useDataGridEdit.multi-select.test.ts` | 5개 Duplicate Row 테스트 |
| `src/components/ContextMenu.test.tsx` | 2개 separator 테스트 |
| `src/components/datagrid/DataGridTable.context-menu.test.tsx` | 신규: 13개 컨텍스트 메뉴 테스트 |

## Acceptance Criteria Status

| AC | Status | Evidence |
|----|--------|----------|
| AC-01~AC-12 | PASS | DataGridTable.context-menu.test.tsx |
| AC-13 | PASS | 40개 신규 테스트 |

## Verification Results

- `pnpm tsc --noEmit` — PASS
- `pnpm vitest run` — 768 tests PASS
- `pnpm lint` — PASS
- `pnpm build` — PASS

## Next Sprint: Sprint 52 — Duplicate Row & Column Drag Reorder

Sprint 51에서 Duplicate Row 로직(handleDuplicateRow)은 이미 구현 완료. Sprint 52는:
- Duplicate Row 툴바 버튼 추가 (선택적)
- Column drag reorder 구현 (시각적 전용, 스키마 변경 없음)
