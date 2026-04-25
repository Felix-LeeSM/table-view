# Sprint 112 → next Handoff

## Sprint 112 Result
- **PASS** (Generator + Evaluator, 1 attempt) — 1799/1799 tests, tsc/lint 0. Evaluator overall 8.75/10.

## 산출물
- `src/components/structure/IndexesEditor.tsx`: native `<select>` (Index Type) → Radix `Select`.
- `src/components/structure/ConstraintsEditor.tsx`: native `<select>` (Constraint Type) → Radix `Select`.
- `src/components/connection/ConnectionDialog.tsx`: db_type / environment 두 native `<select>` → Radix `Select`. Environment `""` 은 `__none__` sentinel 로 매핑. sprint-108 confirm dialog flow 유지.
- `src/components/FilterBar.tsx`: column / operator 두 native `<select>` → Radix `Select`. operator → null 전이 유지.
- `src/components/query/GlobalQueryLogPanel.tsx`: connection filter native `<select>` → Radix `Select`. `""` 은 `__all__` sentinel.
- `src/components/datagrid/DataGridToolbar.tsx`: Page size native `<select>` → Radix `Select`. `onSetPageSize(Number(v))` 유지.
- `src/test-setup.ts`: jsdom 용 `Element.prototype.hasPointerCapture / releasePointerCapture / scrollIntoView` polyfill (idempotent guard).
- `eslint.config.js`: `no-restricted-syntax` rule 추가 — `JSXOpeningElement[name.name='select']` 에 대해 `Use <Select> from @components/ui/select instead of native <select>` 메시지로 lint 실패.
- 테스트 migration: `ConnectionDialog.test.tsx` (db_type/environment + sprint-108 port-guard), `GlobalQueryLogPanel.test.tsx` (connection filter), `DataGrid.test.tsx` (Page size), `StructurePanel.test.tsx` (Constraint type), `FilterBar.test.tsx` (column/operator) 를 userEvent click-trigger + click-option 패턴으로 일괄 이전.

## AC Coverage
- AC-01: `grep -RnE '<select(\s|>)' src/` → `isEditableTarget.ts:24` (JSDoc 백틱 텍스트, JSX 아님) 만 매치. JSX `<select>` 0건.
- AC-02: 8 위치 모두 `Select`/`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem` 사용 (Evaluator 가 각 라인 확인).
- AC-03: 모든 영향 테스트가 userEvent + role-based queries 로 migration. 1799/1799 통과.
- AC-04: ESLint `no-restricted-syntax` rule active (eslint.config.js).
- AC-05: 1799/1799 tests pass.
- AC-06: tsc 0, lint 0.
- AC-07: 회귀 0 (sprint-108 ConfirmDialog flow + FilterBar operator null 전이 + DataGrid pageSize numeric callback 모두 dedicated tests 통과).
