# Sprint Contract: sprint-8

## Summary

- Goal: Sidebar 컴포넌트 테스트 추가 (0% → 70%+)
- Audience: Generator, Evaluator
- Owner: Claude Code
- Verification Profile: `command`

## In Scope

- Sidebar.tsx 렌더링, 빈 상태, 테마 토글, 리사이즈, 다이얼로그 열기/닫기 테스트
- 전체 커버리지 58% → 60%+ 상승 확인

## Out of Scope

- ConnectionList 테스트 (별도 스프린트)
- ConnectionDialog 테스트 (별도 스프린트)
- ConnectionItem 테스트
- 프로덕션 코드 수정

## Invariants

- 기존 208개 테스트 모두 통과
- 프로덕션 코드 변경 없음 (테스트만 추가)

## Acceptance Criteria

- `AC-01`: 연결 없을 때 빈 상태 UI 렌더링 (Database 아이콘, "No connections yet", DB 타입 배지)
- `AC-02`: 연결 있을 때 ConnectionList 렌더링
- `AC-03`: "+" 버튼 클릭 시 ConnectionDialog 열기
- `AC-04`: ConnectionDialog 닫기 시 showNewDialog false
- `AC-05`: 테마 토글 버튼 클릭 시 system→light→dark→system 순환
- `AC-06`: 테마별 아이콘 표시 (Monitor/Sun/Moon)
- `AC-07`: 연결된 connection마다 SchemaTree 렌더링
- `AC-08`: 리사이즈 드래그 핸들 렌더링 및 mousedown 이벤트 처리
- `AC-09`: Sidebar.tsx 라인 커버리지 70%+

## Design Bar / Quality Bar

- store 모킹: connectionStore 모킹으로 유닛 테스트 격리
- 자식 컴포넌트(ConnectionList, SchemaTree, ConnectionDialog)는 모킹 가능
- useTheme 훅 모킹

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 모든 테스트 통과
2. `pnpm vitest run --coverage` — Sidebar 70%+, 전체 60%+
3. `pnpm tsc --noEmit` — 타입 체크 통과

### Required Evidence

- Generator must provide:
  - changed files with purpose
  - checks run and outcomes
  - acceptance criteria coverage with concrete evidence
- Evaluator must cite:
  - concrete evidence for each pass/fail decision

## Test Requirements

### Unit Tests (필수)
- AC-01~AC-09 각각 대응 테스트

### Coverage Target
- Sidebar.tsx: 70%+

### Scenario Tests (필수)
- [ ] Happy path: 빈 상태 → 연결 추가 → SchemaTree 표시
- [ ] 에러/예외: 없음
- [ ] 경계 조건: 리사이즈 최소/최대 폭, 테마 순환
- [ ] 기존 기능 회귀 없음

## Ownership

- Generator: general-purpose
- Write scope: `src/components/Sidebar.test.tsx`
- Merge order: 단일 커밋

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
