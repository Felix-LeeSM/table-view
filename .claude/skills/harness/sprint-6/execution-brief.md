## Sprint Execution Brief

### Objective
QueryEditor (0%) + MainArea (0%) 테스트 추가로 전체 커버리지 50%+ 달성

### Task Why
Phase 3 핵심 파일 중 두 개가 0% 커버리지. 전체 39% → 50%+ 상승 예상.

### Scope Boundary
- 새 테스트 파일만 생성 (프로덕션 코드 수정 없음)
- `src/components/QueryEditor.test.tsx`
- `src/components/MainArea.test.tsx`

### Invariants
- 기존 139개 테스트 통과
- 프로덕션 코드 변경 금지

### Done Criteria
1. AC-01~AC-04: QueryEditor 렌더링, 콜백, 동기화 테스트
2. AC-05~AC-07: MainArea 라우팅 테스트
3. AC-08: 파일별 70%+ 커버리지
4. AC-09: 전체 50%+ 커버리지

### Verification Plan
- Profile: `command`
- Required checks:
  1. `pnpm vitest run` — 모든 테스트 통과
  2. `pnpm vitest run --coverage` — 파일별 + 전체 커버리지 확인
  3. `pnpm tsc --noEmit` — 타입 체크
