# Sprint Execution Brief: sprint-92

## Objective

ConnectionDialog 의 Test Connection alert 슬롯을 항시 마운트하고, testResult 를 `idle | pending | success | error` 4-state union 으로 모델링해 연타 시 DOM identity 와 다이얼로그 높이가 유지되도록 한다.

## Task Why

P1 사용자 리포트 (#CONN-DIALOG-6). 현재 `{(testResult || error) && <div>…</div>}` 패턴은 alert 영역이 unmount/remount 되어 연타 시 다이얼로그 높이가 점프한다. 또한 `testing: boolean` + `testResult: {success, message} | null` 두 state 의 조합이 모호한 경계 상태(pending 중 testResult 가 stale 한 경우 등) 를 만든다.

## Scope Boundary

**쓰기 허용**:
- `src/components/connection/ConnectionDialog.tsx`
- `src/components/connection/ConnectionDialog.test.tsx`

**쓰기 금지**:
- 다른 컴포넌트, 다른 다이얼로그
- `connectionStore.testConnection` 액션 시그니처
- sprint-88/89/90/91 산출물
- `CLAUDE.md`, `memory/`

## Invariants

- `ConnectionDialog.test.tsx` happy-path 회귀 0
- `testConnection` 호출 시그니처 변경 없음
- 기존 success/error 메시지 표시 회귀 0

## Done Criteria

1. testResult state 가 `{status:"idle"|"pending"|"success"|"error", message?}` 형태 discriminated union 으로 모델링됨.
2. alert 슬롯이 idle 상태에서도 마운트 — `data-slot="test-feedback"` (또는 등가) 부여, `min-h` reserve.
3. pending 상태에서 spinner + "Testing…" 텍스트 표시.
4. `expectNodeStable` 단언으로 마운트/pending/응답 후 DOM identity 유지 검증.
5. 기존 happy-path 회귀 0.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`
  4. `grep` 으로 `data-slot="test-feedback"`, `status:"pending"`, "Testing…" 확인
- Required evidence:
  - 변경 파일 + 목적
  - 명령 출력 + AC 별 라인 인용

## Evidence To Return

- Changed files and purpose
- Checks run and outcomes
- AC coverage with evidence
- Assumptions / risks

## References

- Contract: `docs/sprints/sprint-92/contract.md`
- Spec: `docs/sprints/sprint-92/spec.md`
- expectNodeStable: `src/__tests__/utils/expectNodeStable.ts`
