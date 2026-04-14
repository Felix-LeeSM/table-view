# Sprint Execution Brief: Sprint 52

## Objective
- Duplicate Row 툴바 버튼 추가 (handleDuplicateRow는 이미 구현됨)
- Column drag reorder 구현 (시각적 전용, 스키마 변경 없음)

## Task Why
- 컬럼 순서 변경은 데이터 탐색 시 필수 기능
- Duplicate Row 버튼은 우클릭 외에 툴바에서도 접근 가능해야 함

## Scope Boundary
- DataGridToolbar: Duplicate 버튼 추가
- DataGridTable: columnOrder 상태, 드래그 이벤트 핸들러
- DataGrid: columnOrder 상태 조율
- **Hard stop**: BLOB viewer 없음, SQL Uglify 없음

## Invariants
- 기존 768개 테스트 통과
- handleDuplicateRow 인터페이스 변경 없음

## Done Criteria
1. `pnpm tsc --noEmit` 통과
2. `pnpm vitest run` 통과
3. Duplicate Row 버튼 동작
4. Column drag reorder 동작 (시각적)
5. Reorder 후 정렬/편집 올바른 컬럼 참조

## Verification Plan
- Profile: command
- Required checks: tsc, vitest, lint, build

## References
- Contract: docs/sprints/sprint-52/contract.md
- Relevant files: DataGridTable.tsx, DataGridToolbar.tsx, DataGrid.tsx
