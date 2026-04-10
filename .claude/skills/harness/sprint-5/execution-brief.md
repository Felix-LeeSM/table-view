## Sprint Execution Brief

### Objective
DataGrid 로딩 깜빡임 버그 수정 및 회귀 테스트 추가

### Task Why
사용자 피드백 P1: 정렬/필터/페이지 전환 시 테이블이 통째로 사라졌다가 다시 나타나 깜빡임 발생. table head가 화면 중간까지 내려와 레이아웃이 깨짐.

### Scope Boundary
- `src/components/DataGrid.tsx` 로딩 렌더링 로직만 수정
- `src/components/DataGrid.test.tsx`에 새 테스트 추가
- 다른 컴포넌트 수정 금지

### Invariants
- 기존 정렬, 필터, 페이지네이션 동작 유지
- 기존 124개 테스트 모두 통과
- 초기 로딩(데이터 없음)은 기존 방식 유지

### Done Criteria
1. AC-01: 리패치 시 기존 테이블(헤더+행)이 DOM에 유지
2. AC-02: 리패치 중 오버레이 로딩 인디케이터 표시
3. AC-03: 초기 로딩은 중앙 스피너
4. AC-04: 에러 표시 변경 없음
5. AC-05: 기존 테스트 회귀 없음
6. AC-06: 새 회귀 테스트 존재

### Verification Plan
- Profile: `command`
- Required checks:
  1. `pnpm vitest run` — 모든 테스트 통과
  2. `pnpm vitest run --coverage` — DataGrid.tsx 75%+ lines
  3. `pnpm tsc --noEmit` — 타입 체크
- Required evidence:
  - 변경된 파일 목록과 목적
  - 테스트 실행 결과
  - 커버리지 수치

### Evidence To Return
- Changed files with purpose
- Commands/checks run and outcomes
- Acceptance criteria coverage with evidence
- Assumptions, risks, unresolved gaps
