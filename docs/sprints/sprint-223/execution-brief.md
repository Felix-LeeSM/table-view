# Sprint Execution Brief: sprint-223

## Objective

`src/stores/schemaStore.ts` 의 `dropTable` (lines 267-288) / `renameTable` (lines 298-321) 두 action 본문에서 reload-then-fallback orchestration (~46 LOC) 을 신규 use-case hook `src/hooks/useSchemaTableMutations.ts` 으로 이동. store action 본문은 `await tauri.dropTable/renameTable(...)` 1 호출 (~1-3 LOC each) 로 축소. 1 caller (`useSchemaTreeActions.ts:100-101`) 가 hook destructure 로 swap. 사전 store test 의 6 case 가 hook test 로 migrate. **P10 step 2 (post-219)**.

## Task Why

- `docs/refactoring-candidates.md` § P10 — `connectionStore` / `schemaStore` 의 toast / session / IPC orchestration 을 use-case hook 으로 점진 이동.
- Sprint 219 (P10 step 1, evaluator 9.20/10) 의 narrow-scope pattern 답습.
- store unit test 가 cache state transition + reload-then-fallback orchestration policy 까지 같이 검증하는 entanglement 해소.
- store action 본문 thin 화 → 같은 use-case (mutation + optimistic refresh) 가 hook 에서 일관 owner.
- 후속 P10 step (step 3 session persistence / step 4 IPC bridge 분리) 보다 risk 낮은 cache-only refactor 진입.

## Scope Boundary

- 신규 hook + hook test + store body shrink + store test 6 case migration + 1 caller swap.
- 다른 14 store action / `clearConnectionEntries` helper / `SchemaState` interface 변경 0.
- `connectionStore.ts` / `connectionStore.test.ts` 변경 0 (P10 step 3/4 영역).
- `useConnectionLifecycle*` / `useConnectionMutations*` (Sprint 219 결과) / `useSchemaCache*` / `useMigrationExport*` 변경 0.
- `src/lib/{tauri,toast,session-storage,zustand-ipc-bridge,window-label}.ts` 변경 0.
- cross-window regression test / `main.tsx` / 다른 schema component (`SchemaTree.tsx` / `treeRows.ts` / `dialogs.ts`) 변경 0.

## Invariants

- 사전 모든 input 에 대해 사후 `state.tables[key]` 배열 byte-equivalent (happy: `tauri.listTables` 결과 그대로 / fallback: `filter` or `map`).
- `SchemaState` 16 method signature 동결 — `dropTable` / `renameTable` `Promise<void>` 계약 보존.
- Tauri command 호출 횟수 / 인자 / 순서 사전 동일 (1× drop/rename + 1× listTables / happy = success / fallback = listTables throw).
- Cache key naming `${connectionId}:${schema}` 동결.
- ConnectionStore SYNCED_KEYS / IPC bridge / session-storage 호출 동결.
- 새 useEffect / setInterval / setTimeout / subscribe / window event listener 0 in hook.
- 새 `any` / `eslint-disable` / silent `catch{}` (이동 외) / `it.only` / `it.skip` 0.

## Done Criteria

1. `pnpm vitest run` / `pnpm tsc --noEmit` / `pnpm lint` 모두 exit 0. 사전 baseline → 사후 file count +2 / store test -6 + hook test ≥ +6 / net delta ≥ 0.
2. store body shrink: `git diff --stat src/stores/schemaStore.ts` 의 `-` count ≥ 50. `grep -nE 'tauri\.listTables'` = 1 (loadTables only). `grep -nE 'state\.tables\[key\]'` = 0.
3. hook surface: `useSchemaTableMutations` named export + 2 method (drop/rename) + hook test ≥ 6 case + 6 verbatim case name migrate.
4. caller swap: `useSchemaTreeActions.ts` 가 `useSchemaTableMutations()` destructure. `useSchemaStore((s) => s.\(drop\|rename\)Table)` 매치 0.
5. cross-window regression / connectionStore* / useConnectionLifecycle* / useConnectionMutations* / useSchemaCache* / useMigrationExport / src/lib/* / cross-window test / main.tsx / 다른 schema component diff 모두 0.

## Verification Plan

- Profile: `command`
- Required checks: contract.md 의 22 checks 동일.
- Required evidence:
  - 변경 파일 목록 + 각 LOC delta
  - check 1-22 실행 결과
  - AC-01..AC-05 별 evidence
  - 6 verbatim case name migrate 매치 결과 (store 0 + hook ≥ 1 each)
  - cache 결과 byte-equivalence 검증 (hook test 가 store 사전 코드 동일 array 산출 검증)
  - store action thin 화 변종 명시

## Evidence To Return

- Changed files and purpose: 신규 hook + hook test + store body shrink + store test 6 case migration + 1 caller swap.
- Checks run and outcomes: 22 checks 각각의 exit code + 핵심 출력.
- Done criteria coverage: AC-01~05 별 concrete evidence.
- Assumptions:
  - hook 의 cache write 경로 — `useSchemaStore.setState(...)` 직접 호출 vs store 가 `applyOptimisticDropFallback` action 노출 (Generator 재량). 단 `SchemaState` interface 16 method signature 변경 금지.
  - hook 의 store action 호출 경로 — `useSchemaStore((s) => s.dropTable)` selector 사용 vs `tauri.dropTable` 직접 호출 (Generator 재량). 단 `dropTable` / `renameTable` interface signature 동결 + tauri 호출 횟수 / 인자 동일.
  - hook test mock pattern — `vi.hoisted` + factory mock (Sprint 219 답습).
  - 6 case migrate name verbatim 보존 — store test 의 case name 그대로 hook test 에 복제.
- Residual risk:
  - hook 안 새 effect / listener 추가 시 cross-window 회귀.
  - cache write timing — `await storeDrop` → `await tauri.listTables` → `setState` 순차 보존 필요. race window 변경 시 stale 데이터 노출 가능.
  - mock factory 의 selector + setState/getState 동시 노출 — leakage 또는 타입 누락 가능.
  - store action 의 `Promise<void>` 계약 변경 시 typecheck 실패.
  - fallback 의 `state.tables[key] ?? []` 방어가 cache miss 에서 `[]` 산출 — sibling cache key reference 보존 (`...state.tables` spread).

## References

- Contract: `docs/sprints/sprint-223/contract.md`
- Spec: `docs/sprints/sprint-223/spec.md`
- Findings: `docs/sprints/sprint-223/findings.md` (작성 예정)
- Sprint 219 model: `docs/sprints/sprint-219/{spec,contract,findings,handoff}.md` (P10 step 1, narrow-scope pattern source).
- Relevant files:
  - `src/stores/schemaStore.ts` (target store, 362 LOC, -~55)
  - `src/stores/schemaStore.test.ts` (test, 875 LOC, -~145 / -6 case)
  - `src/hooks/useConnectionMutations.ts` / `useConnectionMutations.test.ts` (pattern source — 변경 0)
  - `src/hooks/useConnectionLifecycle.ts` / `useConnectionLifecycle.test.ts` (selector + useCallback pattern, 변경 0)
  - `src/components/schema/SchemaTree/useSchemaTreeActions.ts` (caller swap, ~2 LOC)
  - `src/__tests__/cross-window-connection-sync.test.tsx` / `window-lifecycle.ac141.test.tsx` (cross-window regression, 변경 0)
- 인접 sprint 문서: `docs/sprints/sprint-219/{spec,contract,handoff}.md` (P10 step 1).
- 후속: P10 step 3 (Sprint 224+ 후보, connectionStore session persistence) / step 4 (IPC bridge 분리, 가장 위험).
