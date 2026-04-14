# Sprint Execution Brief: Sprint 50

## Objective

- DataGrid의 단일 행 선택(`selectedRowIdx: number | null`)을 다중 행 선택(`selectedRowIds: Set<number>`)으로 확장
- Shift+Click 범위 선택, Cmd/Ctrl+Click 개별 토글, 시각적 하이라이트, Delete Row 일괄 삭제

## Task Why

- 후속 스프린트(51-52)의 행 컨텍스트 메뉴, Copy as, Duplicate Row 기능이 모두 다중 행 선택에 의존
- DB 관리 도구에서 다중 행 조작은 필수 워크플로우

## Scope Boundary

- 선택 상태 타입 변경: `selectedRowIdx: number | null` → `selectedRowIds: Set<number>`
- anchor row 추적: `anchorRowIdx: number | null` 추가
- 클릭 핸들러에 modifier key 감지 로직 추가
- 행 렌더링에 다중 선택 하이라이트 적용
- Delete Row 일괄 처리 업데이트
- **Hard stop**: Rust 백엔드 변경 없음, 컨텍스트 메뉴 없음, Copy as 없음

## Invariants

- 기존 707개 테스트 통과
- 단일 행 클릭 동작 유지
- 인라인 편집 워크플로우 유지
- shadcn/ui 토큰 기반 스타일 유지

## Done Criteria

1. `pnpm tsc --noEmit` 통과 — selectedRowIds 타입 마이그레이션 완료
2. `pnpm vitest run` 통과 — 신규 테스트 + 기존 테스트 모두 통과
3. 일반 클릭 → 단일 선택, Cmd+Click → 토글, Shift+Click → 범위 선택 동작
4. 다중 선택 시 모든 선택 행에 하이라이트 적용
5. Delete Row가 다중 선택 행을 일괄 처리

## Verification Plan

- Profile: command
- Required checks:
  1. `pnpm tsc --noEmit`
  2. `pnpm vitest run`
  3. `pnpm lint`
  4. `pnpm build`
- Required evidence:
  - 타입 체크 결과
  - 테스트 결과 (통과 수, 신규 테스트 목록)
  - 변경 파일 목록

## Evidence To Return

- Changed files and purpose
- Checks run and outcomes
- Done criteria coverage with evidence
- Assumptions made during implementation
- Residual risk or verification gaps

## References

- Contract: docs/sprints/sprint-50/contract.md
- Spec: docs/sprints/sprint-50/spec.md
- Relevant files:
  - src/components/datagrid/useDataGridEdit.ts (선택 상태 관리)
  - src/components/datagrid/DataGridTable.tsx (행 렌더링, 클릭 핸들러)
  - src/components/datagrid/DataGridToolbar.tsx (Delete 버튼)
  - src/components/DataGrid.tsx (상위 조율)
  - src/lib/format.ts (truncateCell)
