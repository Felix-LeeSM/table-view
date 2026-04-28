# Sprint Contract: sprint-156

## Summary

- Goal: Activation + preview 모든 entry point에 대한 TDD 회귀 테스트 작성. 통과/실패 분리해서 버그 위치 식별.
- Audience: Generator (제작자) → Evaluator (평가자)
- Owner: Claude Opus 4.7
- Verification Profile: `command`

## In Scope

- Connection activation 진단 테스트 (더블클릭 / Enter / disconnect 후 재활성화 / 빠른 연속 더블클릭 / WebviewWindow seam 호출 chain)
- PG preview tab entry point 진단 테스트 (단일클릭 / 더블클릭 / context menu "Open" / "View Structure" / 검색 결과)
- MongoDB preview entry point 진단 테스트 (단일클릭 / 더블클릭)
- TabBar preview cue 진단 테스트

## Out of Scope

- 실제 fix (Sprint 157/158)
- E2E Playwright 테스트 (Sprint 160)
- Cross-paradigm 통합 테스트 (Sprint 159)

## Invariants

- 기존 테스트가 모두 통과해야 함 (회귀 금지)
- 기존 프로덕션 코드 수정 금지 — 테스트 파일만 생성

## Acceptance Criteria

- `AC-156-01`: 새 테스트 파일 `src/__tests__/connection-activation.diagnostic.test.tsx` 생성. 더블클릭 → `showWindow("workspace")` → `focusWindow("workspace")` → `hideWindow("launcher")` 호출 chain 단언 (mock invocationCallOrder로 순서 검증).
- `AC-156-02`: 빠른 연속 더블클릭 시 showWindow가 2회 이상 호출되지 않는지 단언 (debounce/가드).
- `AC-156-03`: disconnect 후 재활성화 시 동일 chain이 정상 동작 단언.
- `AC-156-04`: 새 테스트 파일 `src/components/schema/SchemaTree.preview.entrypoints.test.tsx` 생성. context menu "Open" / "View Structure" / 검색 결과 클릭 시 preview swap 동작 단언.
- `AC-156-05`: MongoDB collection 단일/더블클릭 preview/promote 동작 추가 진단 테스트 (기존 DocumentDatabaseTree.test.tsx에서 누락된 엣지 케이스).
- `AC-156-06`: 모든 테스트에 작성 이유와 날짜(`// Reason: ... (2026-04-28)`) 주석 포함.
- `AC-156-07`: `pnpm vitest run` 통과 (RED 테스트가 있으면 `it.todo`가 아닌 실제 failing test로 작성 — 진단 목적).

## Design Bar / Quality Bar

- TDD-first: 진단 sprint이므로 의도적으로 RED인 테스트를 포함할 수 있음
- 모든 mock은 기존 프로젝트 패턴(`vi.mock('@lib/window-controls')`) 준수
- 테스트 파일 상단에 `// Purpose:` 주석으로 파일 전체 목적 명시

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 모든 기존 + 신규 테스트 실행 (신규 RED 테스트 허용)
2. `pnpm tsc --noEmit` — 타입 체크 통과
3. `pnpm lint` — ESLint 에러 0건

### Required Evidence

- Generator must provide:
  - 생성된 테스트 파일 경로와 목적
  - 각 테스트의 RED/GREEN 상태
  - 기존 테스트 회귀 없음 확인

## Test Requirements

### Unit Tests (필수)

- 이 sprint 자체가 테스트 작성 sprint
- 각 AC 항목에 대응하는 테스트 포함

### Scenario Tests (필수)

- [x] Happy path — 정상 activation chain
- [x] 에러/예외 상황 — showWindow reject 시
- [x] 경계 조건 — 빠른 연속 더블클릭, disconnect 후 재활성화
- [x] 기존 기능 회귀 없음

## Exit Criteria

- 신규 테스트 파일 2개 이상 생성
- `pnpm tsc --noEmit` + `pnpm lint` 통과
- RED 테스트가 있으면 해당 테스트가 다음 sprint의 fix scope 정의
