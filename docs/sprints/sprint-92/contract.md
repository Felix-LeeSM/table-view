# Sprint Contract: sprint-92

## Summary

- Goal: ConnectionDialog 의 Test Connection alert 슬롯이 항시 마운트되어 testResult 4-state 전이(idle/pending/success/error) 시 DOM identity 가 유지되도록 한다. 연타 시 다이얼로그 높이 점프 0.
- Audience: Generator + Evaluator
- Owner: Generator
- Verification Profile: `command` (jsdom + RTL DOM identity 단언; offsetHeight 는 jsdom 한계로 className/structure 단언으로 대체)

## In Scope

- `src/components/connection/ConnectionDialog.tsx`:
  - testResult state 를 union type 으로 모델링: `{ status: "idle" } | { status: "pending" } | { status: "success"; message: string } | { status: "error"; message: string }`. (또는 동등한 표현 — discriminated union 권장.)
  - 기존 `testing: boolean` + `testResult: {success, message} | null` 두 state 를 단일 testResult union 으로 병합 (또는 testing 을 derived 값으로 유지).
  - alert 슬롯 항시 마운트 — `data-slot="test-feedback"` (또는 등가) 부여, `min-h` reserve 로 빈 상태에서도 영역 유지.
  - pending 시 알림 영역에 스피너 + "Testing…" 노출.
  - `handleTest` 가 pending 상태 발행 → 응답 후 success/error 전이.
- `src/components/connection/ConnectionDialog.test.tsx`:
  - `expectNodeStable` 헬퍼(`src/__tests__/utils/expectNodeStable.ts`) 로 DOM identity 단언 (마운트 직후 / pending / 응답 후 3 시점).
  - pending 상태에서 "Testing…" 텍스트 + spinner 단언.
  - 4-state 단언 (idle 시 alert 비어있음 또는 placeholder, success/error 시 메시지 표시).

## Out of Scope

- 다른 컴포넌트, 다른 다이얼로그.
- ConnectionDialog footer/form 레이아웃 변경.
- `min-h` 절대값 디자인 결정 외 시각 스타일 변경.
- sprint-88/89/90/91 산출물.

## Invariants

- 기존 `ConnectionDialog.test.tsx` happy path 통과 (성공/실패 alert 표시 등) — 회귀 0.
- testConnection store action 시그니처 변경 0.
- `CLAUDE.md`, `memory/` 변경 0.

## Acceptance Criteria

- `AC-01` alert 슬롯 selector (`[data-slot="test-feedback"]`) 가 마운트 직후, Test 버튼 클릭 직후, 응답 도착 후 세 시점 모두에서 동일 DOM 노드 identity 유지. `expectNodeStable` 헬퍼 사용.
- `AC-02` testResult state 가 `idle | pending | success | error` 4-state union 으로 모델링됨. 코드/grep 으로 확인 가능 (예: `status: "pending"` 리터럴 존재).
- `AC-03` pending 시 alert 슬롯 안에 스피너 (예: `Loader2` `animate-spin`) + "Testing…" 텍스트가 노출. RTL `findByText("Testing...")` 또는 `getByText(/Testing/)` 단언.
- `AC-04` Test 버튼 3 회 연속 클릭 시 alert 슬롯 DOM 노드 identity 유지 (jsdom 의 offsetHeight 한계로 identity 단언으로 대체). 클릭 사이에 mock testConnection 이 pending → success 또는 pending → error 로 전이.
- `AC-05` 기존 ConnectionDialog happy-path 회귀 0.

## Design Bar / Quality Bar

- 4-state union 은 discriminated union (`status` 필드) 사용. boolean flag 조합 회피.
- `min-h` 값은 디자인 보수적으로 (예: `min-h-[2.5rem]` 또는 `min-h-12`). 실제 alert 콘텐츠 평균 높이 기준 추정 가능.
- `data-slot="test-feedback"` 또는 등가 stable selector 가 jsdom 환경에서 React 재렌더와 무관하게 동일 DOM 노드를 가리켜야 함.

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 0 failures.
2. `pnpm tsc --noEmit` — exit 0.
3. `pnpm lint` — exit 0.
4. `grep -n 'data-slot="test-feedback"\|status:.*pending\|Testing' src/components/connection/ConnectionDialog.tsx` — 1+ 라인.
5. `grep -n "expectNodeStable\|test-feedback\|pending\|Testing" src/components/connection/ConnectionDialog.test.tsx` — 신규 단언 케이스 존재.

### Required Evidence

- Generator: 변경 파일 + 명령 출력 + AC 별 라인 인용 + 4-state 전이 다이어그램(텍스트).
- Evaluator: AC 별 라인 인용 + 회귀 0 검증.

## Test Requirements

### Unit Tests (필수)
- alert 슬롯 stable identity 단언 (`expectNodeStable`) ≥ 1.
- pending 상태 텍스트 + spinner 단언 ≥ 1.
- 4-state 전이 단언 (idle → pending → success/error) ≥ 1.

### Coverage Target
- 신규 코드 라인 70%+.

### Scenario Tests (필수)
- [x] Happy path: idle → pending → success → idle (또는 stable) — alert slot identity 유지
- [x] 에러 케이스: idle → pending → error
- [x] 연타: pending 중 재클릭 — slot identity 유지

## Test Script / Repro Script

1. `pnpm vitest run -- ConnectionDialog`
2. `pnpm tsc --noEmit`
3. `pnpm lint`

## Ownership

- Generator: 단일 agent.
- Write scope: contract In Scope 만.
- Merge order: 단일 PR.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `findings.md`
