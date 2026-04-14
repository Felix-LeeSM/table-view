# Sprint Execution Brief: Sprint 51

## Objective

- DataGrid 행에 우클릭 컨텍스트 메뉴 추가 (Edit Cell, Delete Row, Duplicate Row, Copy Row As)
- 선택된 행을 Plain Text, JSON, CSV, SQL Insert 포맷으로 클립보드에 복사

## Task Why

- DB 관리 도구에서 행 데이터 복사는 가장 빈번한 작업 중 하나
- Copy as SQL Insert은 데이터 마이그레이션/시딩에 필수
- 우클릭 메뉴는 사용자가 기능을 발견하기 쉬운 진입점

## Scope Boundary

- DataGridTable에 onContextMenu 핸들러 추가
- ContextMenu 컴포넌트 재사용 (SchemaTree와 동일)
- 복사 유틸리티 함수 (rowsToPlainText, rowsToJson, rowsToCsv, rowsToSqlInsert)
- Duplicate Row (handleDuplicateRow) 로직
- **Hard stop**: Column reorder 없음, BLOB viewer 없음, SQL Uglify 없음

## Invariants

- 기존 728개 테스트 통과
- Sprint 50의 selectedRowIds 인터페이스 변경 없음
- ContextMenu 컴포넌트 수정 최소화 (서브메뉴 대신 평면 리스트)

## Done Criteria

1. `pnpm tsc --noEmit` 통과
2. `pnpm vitest run` 통과
3. 우클릭 → 컨텍스트 메뉴 → 각 항목 동작
4. 4가지 포맷으로 복사 동작
5. 다중 행 복사 지원

## Verification Plan

- Profile: command
- Required checks:
  1. `pnpm tsc --noEmit`
  2. `pnpm vitest run`
  3. `pnpm lint`
  4. `pnpm build`
- Required evidence:
  - 타입 체크 결과
  - 테스트 결과
  - 변경 파일 목록

## Evidence To Return

- Changed files and purpose
- Checks run and outcomes
- Done criteria coverage with evidence
- Assumptions made during implementation

## References

- Contract: docs/sprints/sprint-51/contract.md
- Spec: docs/sprints/sprint-50/spec.md (Sprint 51 section)
- Relevant files:
  - src/components/datagrid/DataGridTable.tsx (onContextMenu)
  - src/components/ContextMenu.tsx (재사용)
  - src/components/datagrid/useDataGridEdit.ts (handleDuplicateRow)
  - src/components/datagrid/sqlGenerator.ts (INSERT 생성 참고)
  - src/lib/format.ts (복사 유틸리티 추가)
