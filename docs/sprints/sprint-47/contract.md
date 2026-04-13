# Sprint Contract: Sprint 47

## Summary

- Goal: DataGrid(1038줄)를 기능별 서브 컴포넌트로 분해
- Verification Profile: `command`

## In Scope

- 툴바 영역을 `datagrid/DataGridToolbar.tsx`로 분리
- 테이블 헤더를 `datagrid/DataGridTable.tsx`로 분리
- 편집 상태 관리를 `datagrid/useDataGridEdit.ts`로 분리
- SQL 생성 로직을 `datagrid/sqlGenerator.ts`로 분리
- DataGrid 본체를 조립 역할로 경량화

## Out of Scope

- shadcn Button/Input/Select 적용 (Sprint 49)
- 기능 변경 없음
- StructurePanel 분해 (Sprint 48)

## Invariants

- 707 테스트 모두 통과
- 기존 DataGrid 기능(정렬, 필터링, 페이지네이션, 인라인 편집) 동일
- `pnpm build`, `pnpm tsc --noEmit`, `pnpm lint` 통과

## Done Criteria

1. DataGrid 메인 파일이 서브 컴포넌트 조립 역할 (목표: 400줄 이하)
2. 툴바, 테이블, 편집 상태, SQL 생성이 각각 독립 파일로 분리
3. 모든 검사 통과

## Verification Plan

- Profile: `command`
- Checks: tsc, vitest, build, lint, wc -l DataGrid.tsx
