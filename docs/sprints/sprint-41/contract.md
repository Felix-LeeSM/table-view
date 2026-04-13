# Sprint Contract: sprint-41

## Summary

- Goal: 쿼리 에디터의 핵심 동작 버그 3건 수정 (null row, Cmd+Enter, Tab autocomplete)
- Audience: Generator → Evaluator
- Owner: harness
- Verification Profile: `command`

## In Scope

- QueryResultGrid에서 null row 표시 문제 수정
- CodeMirror에서 Cmd+Enter가 줄바꿈 대신 쿼리 실행을 트리거하도록 수정
- CodeMirror에서 자동완성 팝업 활성 시 Tab이 자동완성 수락으로 동작하도록 수정

## Out of Scope

- QueryTab 툴바 UI 변경 (Sprint 45)
- SchemaTree UUID 수정 (Sprint 42)
- Preview tab 시스템 (Sprint 43)
- 데이터 그리드 UX 개선 (Sprint 44)

## Invariants

- 기존 CodeMirror 기능(구문 하이라이팅, 들여쓰기, 괄호 매칭) 유지
- 자동완성 팝업 비활성 상태에서 Tab은 들여쓰기로 동작
- Cmd+Enter가 아닌 일반 Enter는 줄바꿈으로 동작
- 기존 577개 프론트엔드 테스트 모두 통과

## Acceptance Criteria

- `AC-01`: 빈 쿼리 또는 whitespace-only 쿼리를 실행하면 null row가 표시되지 않고 실행이 차단되거나 빈 결과가 정상 표시됨
- `AC-02`: QueryEditor CodeMirror에서 Cmd+Enter 입력 시 줄바꿈이 발생하지 않고 onExecute 콜백이 호출됨
- `AC-03`: 자동완성 팝업이 활성 상태일 때 Tab 키를 누르면 자동완성 항목이 수락되고 들여쓰기가 발생하지 않음

## Design Bar / Quality Bar

- 기존 코드 패턴 준수
- 에러 케이스 테스트 포함
- 프로덕션급 코드 (TODO, console.log 금지)

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 기존 + 신규 테스트 통과
2. `pnpm tsc --noEmit` — 타입 에러 0건
3. `pnpm lint` — ESLint 에러 0건

### Required Evidence

- Generator must provide:
  - changed files with purpose
  - checks run and outcomes
  - acceptance criteria coverage with concrete evidence
- Evaluator must cite:
  - concrete evidence for each pass/fail decision
  - any missing or weak evidence as a finding

## Test Requirements

### Unit Tests (필수)
- 각 AC 항목에 대응하는 최소 1개 테스트 작성
- 에러/예외 케이스 최소 1개 테스트 작성

### Scenario Tests (필수)
- [x] Happy path: 정상 쿼리 실행, Cmd+Enter 동작, Tab 자동완성 동작
- [x] 에러/예외: 빈 쿼리, whitespace-only 쿼리
- [x] 경계 조건: 자동완성 팝업 없을 때 Tab = 들여쓰기
- [x] 기존 기능 회귀 없음

## Test Script / Repro Script

1. `pnpm vitest run` — 전체 테스트 실행
2. `pnpm tsc --noEmit` — 타입 체크
3. `pnpm lint` — 린트 체크

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `handoff.md`
