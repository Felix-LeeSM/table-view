# Sprint Execution Brief: Sprint 46

## Objective

- 프로젝트 전체의 수작성 모달 오버레이를 shadcn Dialog로 통합

## Task Why

- `fixed inset-0 z-50 bg-black/50` 패턴이 10회 중복
- 수동 Escape 핸들러, 수동 포커스 트랩, 수동 오버레이 클릭 핸들러가 반복
- shadcn Dialog가 이 모든 것을 자동 제공

## Scope Boundary

- 모달 내부 폼 로직/비즈니스 로직은 변경하지 않음
- shadcn Input/Select/Button 적용은 Sprint 49에서
- DataGrid/StructurePanel 분해는 Sprint 47-48에서

## Invariants

- 기존 707 테스트 모두 통과
- 모든 모달의 기능이 기존과 동일
- Rust 백엔드 변경 없음

## Done Criteria

1. ConfirmDialog가 shadcn AlertDialog 사용
2. ConnectionDialog가 shadcn Dialog 사용
3. StructurePanel 인라인 모달들이 shadcn Dialog 사용
4. DataGrid SQL Preview 모달이 shadcn Dialog 사용
5. SchemaTree 인라인 모달들이 shadcn Dialog 사용
6. QuickOpen이 shadcn Dialog 사용
7. 수작성 모달 오버레이 패턴(`fixed inset-0 z-50`)이 0건
8. 모든 검사 통과

## Verification Plan

- Profile: `command`
- Required checks: tsc, vitest, build, lint, grep for inline modals

## Evidence To Return

- Changed files and purpose
- Checks run and outcomes
- grep 결과
- Assumptions and residual risk

## References

- Contract: `docs/sprints/sprint-46/contract.md`
- Relevant files:
  - `src/components/ui/dialog.tsx` — shadcn Dialog 프리미티브 (Sprint 44에서 설치)
  - `src/components/ConfirmDialog.tsx`
  - `src/components/ConnectionDialog.tsx`
  - `src/components/StructurePanel.tsx`
  - `src/components/DataGrid.tsx`
  - `src/components/SchemaTree.tsx`
  - `src/components/QuickOpen.tsx`
