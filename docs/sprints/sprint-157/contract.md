# Sprint Contract: sprint-157

## Summary

- Goal: handleActivate에 debounce 가드를 추가하여 빠른 연속 더블클릭 시 중복 showWindow 호출을 방지한다.
- Verification Profile: `command`

## In Scope

- `src/pages/HomePage.tsx` handleActivate에 activating ref 가드 추가
- 가드 동작을 검증하는 단위 테스트
- 기존 handleActivate 동작(정상 케이스) 회귀 테스트 보강

## Out of Scope

- preview tab 수정 (Sprint 158)
- E2E 테스트 (Sprint 160)
- window-controls.ts 수정

## Invariants

- 정상적인 단일 더블클릭 동작은 변하지 않음
- showWindow 거부 시 에러 처리 로직 유지
- 기존 테스트 모두 통과

## Acceptance Criteria

- `AC-157-01`: handleActivate 실행 중(activating=true) 추가 호출이 들어오면 즉시 return (showWindow 미호출).
- `AC-157-02`: 정상 단일 활성화 후 가드가 해제됨 (activating=false). 이후 재활성화 가능.
- `AC-157-03`: showWindow reject 시에도 가드가 해제됨 (catch 블록에서 activating=false).
- `AC-157-04`: 빠른 연속 더블클릭 테스트에서 showWindow가 정확히 1회만 호출됨.

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 모든 테스트 통과
2. `pnpm tsc --noEmit` — 타입 체크 통과
3. `pnpm lint` — ESLint 에러 0건

### Required Evidence

- 수정된 파일 경로와 변경 내용
- showWindow 호출 횟수 단언 포함된 테스트 결과
