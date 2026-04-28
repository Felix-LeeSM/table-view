# Sprint Execution Brief: sprint-157

## Objective

- handleActivate에 activating ref 가드를 추가하여 빠른 연속 더블클릭으로 인한 중복 window API 호출을 방지한다.

## Task Why

- Sprint 156 진단에서 handleActivate에 debounce/가드가 없어 빠른 더블클릭 시 showWindow가 2회 이상 호출되는 것을 발견. 실제 Tauri 런타임에서 WebviewWindow 생성 경쟁으로 이어져 사용자 보고 버그의 가능성 있는 원인.

## Scope Boundary

- `src/pages/HomePage.tsx`만 수정 (handleActivate 내부)
- `src/pages/HomePage.test.tsx`만 테스트 보강
- window-controls.ts, tabStore.ts 등 다른 파일 수정 금지

## Invariants

- 정상 단일 더블클릭 동작 불변
- showWindow 실패 시 에러 처리 유지
- 기존 테스트 회귀 없음

## Done Criteria

1. handleActivate에 `useRef<boolean>(false)` activating 가드 추가
2. 가드 활성 상태에서 즉시 return
3. try/finally로 가드 해제 보장 (성공/실패 무관)
4. 빠른 더블클릭 시 showWindow 정확히 1회 호출 단언 테스트 추가
5. `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` 통과

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`
- Required evidence:
  - 수정된 파일과 변경 내용
  - showWindow 호출 횟수 단언 결과

## References

- Contract: `docs/sprints/sprint-157/contract.md`
- Sprint 156 handoff: `docs/sprints/sprint-156/handoff.md`
- Key files:
  - `src/pages/HomePage.tsx` — handleActivate (lines 95-138)
  - `src/pages/HomePage.test.tsx` — existing activation tests (lines 220-300)
  - `src/__tests__/connection-activation.diagnostic.test.tsx` — Sprint 156 diagnostic (AC-156-02 rapid double-click test)
