# Sprint Execution Brief: sprint-219

## Objective

`src/stores/connectionStore.ts` 의 `addConnection` / `updateConnection` / `removeConnection` 3 mutation action 본문에서 `toast.success(...)` 호출 (각 1건, 합 3) + `toast` import 1줄을 신규 use-case hook `src/hooks/useConnectionMutations.ts` 으로 이동. 2 component (`ConnectionDialog` / `ConnectionItem`) 의 store selector 호출을 hook destructure 로 swap. **P10 step 1 (first)** — risk 높음 candidate 의 가장 좁은 한 흐름.

## Task Why

- `docs/refactoring-candidates.md` § P10 — `connectionStore` / `schemaStore` 의 toast / session / IPC orchestration 을 use-case hook 으로 점진 이동. § P10 의 명시적 권고: "한 번에 전체 store architecture 를 바꾸지 말고 connection lifecycle 한 흐름씩 이동".
- post-209 cycle 의 마지막 candidate. P11 cycle (Sprint 216/218/220/221/222) 종료 후 진입.
- store unit test 가 API orchestration + UI notification 을 같이 검증하는 entanglement 해소 — toast 를 use-case 로 빼면 store test 는 순수 state transition 검증.
- narrow scope (3 toast 호출만) — risk 낮음. 후속 P10 step (Sprint 223+) 은 별도 sprint 로 분리.

## Scope Boundary

- 신규 hook 파일 1 + hook test 파일 1 + store body 축소 (-4 ~ -6 LOC) + 2 component swap.
- `connectionStore.test.ts` / `schemaStore*` / `useConnectionLifecycle*` / `useSchemaCache*` / `useMigrationExport*` 변경 금지.
- `src/lib/{toast,session-storage,zustand-ipc-bridge,window-label}.ts` 변경 금지.
- cross-window regression test / `main.tsx` 변경 금지.
- store public API (16 method signature) / `SYNCED_KEYS` / `attachZustandIpcBridge` / `initEventListeners` / session-storage 3 호출 site 변경 금지.

## Invariants

- toast text byte-equivalent — 4건 (added / updated / removed / fallback).
- store action signature 동결 + throw / return 정책 동결.
- SYNCED_KEYS / IPC bridge module-load attach / event listener 동결.
- session-storage 3 호출 site 동결.
- ConnectionDialog 의 setSaving / setError / try-catch / onClose / sanitizeMessage 분기 동결.
- Sidebar 의 `connection-added` event dispatch 동결.
- 새 `any` / `eslint-disable` / silent `catch{}` / `it.only` / `it.skip` 0.

## Done Criteria

1. `pnpm vitest run` / `pnpm tsc --noEmit` / `pnpm lint` 모두 exit 0. 사전 baseline → 사후 file count +2 / tests delta ≥ +5.
2. store body shrink: `grep -c 'toast' src/stores/connectionStore.ts` = 0 + `git diff --stat` 의 `-` count ≥ 4.
3. hook surface: `useConnectionMutations` named export + 3 method (addConnection / updateConnection / removeConnection) + hook test ≥ 5 case.
4. 2 component swap + `useConnectionStore((s) => s.\(add\|update\|remove\)Connection)` 매치 0.
5. cross-window regression test exit 0. sibling diff 0 (test / hook / lib / main).

## Verification Plan

- Profile: `command`
- Required checks: contract.md 의 22 checks 동일.
- Required evidence:
  - 변경 파일 목록 + 각 LOC delta
  - check 1-22 실행 결과
  - AC-01..AC-05 별 evidence
  - 4 toast text 매치 결과
  - removeConnection name resolution 변종 명시

## Evidence To Return

- Changed files and purpose: 신규 hook + hook test + store body shrink + 2 component swap.
- Checks run and outcomes: 22 checks 각각의 exit code + 핵심 출력.
- Done criteria coverage: AC-01~05 별 concrete evidence.
- Assumptions:
  - removeConnection name resolution 변종 (hook 안 `useConnectionStore.getState().connections.find(...)` 또는 component 가 connection 객체를 hook 에 전달) — Generator 재량.
  - hook 의 `addConnection` / `updateConnection` 가 store mock 의 saved.name 활용 vs draft.name 활용 — Generator 재량 (mock echo 가정 시 byte-equivalent).
  - hook test 의 mock 패턴 — `vi.hoisted` + factory mock (lifecycle hook test 답습).
- Residual risk:
  - hook 안 새 effect / listener 추가 시 cross-window 회귀.
  - removeConnection name lookup timing — store action 호출 전 snapshot 필요 (호출 후엔 connection 이 state 에서 사라짐).
  - toast text 의 backtick / quote escape — ESLint quotes rule 위반 가능성.
  - mock leakage in hook test — `vi.hoisted` 누락 시 다른 test 오염.
  - store action 의 return type 변경 시 typecheck 실패.

## References

- Contract: `docs/sprints/sprint-219/contract.md`
- Spec: `docs/sprints/sprint-219/spec.md`
- Findings: `docs/sprints/sprint-219/findings.md` (작성 예정)
- Relevant files:
  - `src/stores/connectionStore.ts` (target store, ~329 LOC, -4 ~ -6)
  - `src/hooks/useConnectionLifecycle.ts` / `useConnectionLifecycle.test.ts` (pattern source — 변경 0)
  - `src/components/connection/ConnectionDialog.tsx` (selector swap 2)
  - `src/components/connection/ConnectionItem.tsx` (selector swap 1)
  - `src/lib/toast.ts` (사용처, 변경 0)
  - `src/__tests__/cross-window-connection-sync.test.tsx` / `window-lifecycle.ac141.test.tsx` (cross-window regression, 변경 0)
- 인접 sprint 문서: `docs/sprints/sprint-218/{spec,contract,handoff}.md` (P11 step 2, vi.hoisted mock 패턴 참고).
- 후속: P10 step 2 (Sprint 223 후보, schemaStore optimistic refresh fallback) / step 3 (connectionStore session persistence) / step 4 (IPC bridge 분리, 가장 위험).
