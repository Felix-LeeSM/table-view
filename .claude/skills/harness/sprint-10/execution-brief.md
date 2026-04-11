## Sprint Execution Brief

### Objective
ConnectionGroup 컴포넌트 테스트 추가 (0% → 70%+)

### Task Why
연결 그룹 관리의 핵심 컴포넌트. 접기/펼치기, 이름 변경, 드래그앤드롭 등 인터랙션이 풍부함.

### Scope Boundary
- 새 테스트 파일만 생성
- `src/components/ConnectionGroup.test.tsx`

### Invariants
- 기존 282개 테스트 통과
- 프로덕션 코드 변경 금지

### Done Criteria
1. AC-01~AC-11: ConnectionGroup 인터랙션 테스트
2. AC-12: ConnectionGroup.tsx 라인 커버리지 70%+

### Verification Plan
- Profile: `command`
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm vitest run --coverage`
  3. `pnpm tsc --noEmit`

### References
- Contract: `.claude/skills/harness/sprint-10/contract.md`
- Relevant files: `src/components/ConnectionGroup.tsx`
