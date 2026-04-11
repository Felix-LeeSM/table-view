## Sprint Execution Brief

### Objective
Sidebar 컴포넌트 테스트 추가 (0% → 70%+)

### Task Why
Sidebar는 사용자에게 직접 보이는 핵심 네비게이션 컴포넌트. 0% 커버리지로 방치됨.

### Scope Boundary
- 새 테스트 파일만 생성 (프로덕션 코드 수정 없음)
- `src/components/Sidebar.test.tsx`

### Invariants
- 기존 208개 테스트 통과
- 프로덕션 코드 변경 금지

### Done Criteria
1. AC-01~AC-08: Sidebar 렌더링, 빈 상태, 테마, 리사이즈, 다이얼로그 테스트
2. AC-09: Sidebar.tsx 라인 커버리지 70%+

### Verification Plan
- Profile: `command`
- Required checks:
  1. `pnpm vitest run` — 모든 테스트 통과
  2. `pnpm vitest run --coverage` — Sidebar 70%+, 전체 60%+
  3. `pnpm tsc --noEmit` — 타입 체크

### Evidence To Return
- Changed files with purpose
- Commands/checks run and outcomes
- Acceptance criteria coverage with evidence
- Assumptions, risks, unresolved gaps

### References
- Contract: `.claude/skills/harness/sprint-8/contract.md`
- Relevant files:
  - `src/components/Sidebar.tsx` (테스트 대상)
  - `src/stores/connectionStore.ts` (모킹 대상)
  - `src/hooks/useTheme.ts` (모킹 대상)
