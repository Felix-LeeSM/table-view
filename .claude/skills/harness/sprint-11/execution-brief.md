## Sprint Execution Brief

### Objective
Residual risk 기반 프로덕션 버그 수정 + 누락 테스트 보강

### Task Why
Sprint 5-10에서 발견된 residual risk 중 실제 프로덕션 버그(loadTables 실패 시 loading 상태 미해제)를 수정하고, 누락된 엣지 케이스 테스트를 추가.

### Scope Boundary
- `src/components/SchemaTree.tsx`: 에러 핸들링만 수정
- `src/components/SchemaTree.test.tsx`: 누락 테스트만 추가

### Invariants
- 기존 317개 테스트 통과
- 기존 기능 회귀 없음

### Done Criteria
1. AC-01~AC-02: loadTables/loadSchemas 에러 시 loading 상태 정상 복원
2. AC-03~AC-05: 누락 테스트 추가
3. AC-06: 전체 테스트 통과

### Verification Plan
- Profile: `command`
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`

### References
- Contract: `.claude/skills/harness/sprint-11/contract.md`
- Residual risks: Sprint 5 #1-3, Sprint 7 #1-3
