## Sprint Execution Brief

### Objective
SchemaTree 컴포넌트 테스트 추가 (0% → 70%+)

### Task Why
TEST_IMPROVE_PLAN Phase 1의 마지막 0% 컴포넌트. 전체 커버리지 52% → 55%+ 상승 예상.

### Scope Boundary
- 새 테스트 파일만 생성 (프로덕션 코드 수정 없음)
- `src/components/SchemaTree.test.tsx`

### Invariants
- 기존 184개 테스트 통과
- 프로덕션 코드 변경 금지

### Done Criteria
1. AC-01~AC-10: SchemaTree 렌더링, 확장/축소, 테이블 클릭, 버튼, 이벤트 테스트
2. AC-11: SchemaTree.tsx 라인 커버리지 70%+

### Verification Plan
- Profile: `command`
- Required checks:
  1. `pnpm vitest run` — 모든 테스트 통과
  2. `pnpm vitest run --coverage` — SchemaTree 70%+, 전체 55%+
  3. `pnpm tsc --noEmit` — 타입 체크

### Evidence To Return
- Changed files with purpose
- Commands/checks run and outcomes
- Acceptance criteria coverage with evidence
- Assumptions, risks, unresolved gaps

### References
- Contract: `docs/sprints/sprint-7/contract.md`
- Relevant files:
  - `src/components/SchemaTree.tsx` (테스트 대상)
  - `src/stores/schemaStore.ts` (모킹 대상)
  - `src/stores/tabStore.ts` (모킹 대상)
