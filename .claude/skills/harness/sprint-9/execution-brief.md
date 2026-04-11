## Sprint Execution Brief

### Objective
ConnectionList + ConnectionItem 컴포넌트 테스트 추가 (0% → 70%+)

### Task Why
연결 관리 UI의 핵심 컴포넌트 두 개가 0% 커버리지. 드래그앤드롭, 컨텍스트 메뉴, 상태 표시 등 사용자 인터랙션이 풍부함.

### Scope Boundary
- 새 테스트 파일만 생성
- `src/components/ConnectionList.test.tsx`
- `src/components/ConnectionItem.test.tsx`

### Invariants
- 기존 234개 테스트 통과
- 프로덕션 코드 변경 금지

### Done Criteria
1. AC-01~AC-04: ConnectionList 렌더링, 드래그앤드롭, 힌트
2. AC-05~AC-13: ConnectionItem 렌더링, 인터랙션, 컨텍스트 메뉴, 삭제
3. AC-14: 각 파일 70%+ 라인 커버리지

### Verification Plan
- Profile: `command`
- Required checks:
  1. `pnpm vitest run` — 모든 테스트 통과
  2. `pnpm vitest run --coverage` — 각 파일 70%+, 전체 65%+
  3. `pnpm tsc --noEmit` — 타입 체크

### Evidence To Return
- Changed files with purpose
- Commands/checks run and outcomes
- Acceptance criteria coverage with evidence

### References
- Contract: `.claude/skills/harness/sprint-9/contract.md`
- Relevant files:
  - `src/components/ConnectionList.tsx`
  - `src/components/ConnectionItem.tsx`
  - `src/stores/connectionStore.ts`
