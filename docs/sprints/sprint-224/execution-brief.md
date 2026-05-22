# Sprint Execution Brief: sprint-224

## Objective

`src/stores/connectionStore.ts` 의 `hydrateFromSession` action (lines 225-237, 13 LOC) 본문을 신규 use-case module `src/hooks/useConnectionSessionHydration.ts` 으로 이동. 두 export — `hydrateConnectionSession` (plain function) + `useConnectionSessionHydration` (React hook wrap). 2 callers (`src/main.tsx:47` / `src/hooks/useWindowFocusHydration.ts:30`) swap. 2 store test case → module test migrate. **persist 3 site (P10 step 3b) + IPC bridge module-load attach (step 4) 동결**. P10 step 3a (read-only path 만, narrow split from step 3).

## Task Why

- `docs/archives/etc/refactoring-candidates.md` § P10 step 3 — connectionStore session persistence 를 use-case hook 으로 이동. 단 step 3 의 4 site 중 read-only `hydrateFromSession` 만 본 sprint scope.
- Sprint 219 (P10 step 1, evaluator 9.20/10) + Sprint 223 (P10 step 2, evaluator 8.35/10) narrow-scope pattern 답습.
- persist 3 site 는 cross-window broadcast / IPC bridge ordering 과 결합 + 5 callers update 필요 + Sprint 219 freeze 영역 (`useConnectionLifecycle`) 충돌 — risk 매우 높음. 별도 sprint (3b) 로 분리.
- 본 sprint 의 `hydrateFromSession` 은 read-only — risk 낮음, callers 2 곳뿐.
- `main.tsx` boot path 가 React tree 외부 호출 — plain function entry point 필수 (Sprint 219 의 `useCallback` 패턴과 차별화).

## Scope Boundary

- 신규 module + module test + store body shrink + 2 case migration + 2 caller swap.
- persist 3 site (`connectToDatabase:198` / `disconnectFromDatabase:217` / `setFocusedConn:222`) byte-equivalent 동결 (P10 step 3b).
- `attachZustandIpcBridge` module-load attach (lines 311-318) byte-equivalent 동결 (P10 step 4).
- SYNCED_KEYS 4 key 동결.
- ConnectionState 16 method signature 동결 — `hydrateFromSession: () => void` 보존 (action body 가 thin proxy).
- `useConnectionMutations*` / `useConnectionLifecycle*` / `useSchemaTableMutations*` / `useSchemaCache*` / `useMigrationExport*` / `schemaStore*` 변경 0.
- `src/lib/*` 변경 0.
- cross-window regression test / 다른 connection components 변경 0.

## Invariants

- 모든 input 에 대해 boot/focus hydrate 사후 store state byte-equivalent (focusedConnId / activeStatuses).
- session empty → no-op (`Object.keys(patch).length === 0`).
- partial session (`focusedConnId` only / `activeStatuses` only / both) 분기 사전 동일.
- `setState` 호출 횟수 / 인자 / shape 사전 동일 (한 번 호출, partial patch).
- `markBootMilestone("connectionStore:hydrated")` 사전 동일 — hydrate 동기 return 후 호출.
- `useWindowFocusHydration` 의 `prevConnId` snapshot / `newConnId` 비교 / stale-tab clear / `addEventListener("focus", hydrate)` / `removeEventListener` 동결.
- 새 useEffect / setInterval / setTimeout / subscribe / window event listener 0 in module.
- 새 `any` / `eslint-disable` / silent `catch{}` / `it.only` / `it.skip` 0.

## Done Criteria

1. `pnpm vitest run` / `pnpm tsc --noEmit` / `pnpm lint` 모두 exit 0. 사전 baseline → 사후 file count +2 / store -2 + module ≥ +2 case / net delta ≥ 0.
2. store body shrink: `hydrateFromSession` body ≤ 2 LOC. `git diff --stat src/stores/connectionStore.ts` 의 `-` count ≥ 10. `grep -nE 'Pick<ConnectionState,'` = 0.
3. module surface: `hydrateConnectionSession` named export + 2 case migrate verbatim.
4. caller swap: `main.tsx` + `useWindowFocusHydration.ts` 모두 `hydrateConnectionSession()` 직접 호출. `useConnectionStore.getState().hydrateFromSession()` 매치 0 (store file 제외).
5. **CRITICAL FREEZE** — persist 3 site / SYNCED_KEYS / IPC bridge module-load attach grep verbatim 동일. cross-window regression 통과. sibling diff 0.

## Verification Plan

- Profile: `command`
- Required checks: contract.md 의 22 checks.
- Required evidence:
  - 변경 파일 목록 + LOC delta
  - check 1-22 실행 결과
  - AC-01..AC-05 별 evidence
  - 2 verbatim case migrate 결과
  - persist 3 site / SYNCED_KEYS / IPC bridge byte-equivalence
  - main.tsx React tree 외부 호출 안전성 확인
  - module export shape (Option C 권장 명시)

## Evidence To Return

- Changed files and purpose: 신규 module + module test + store body shrink + 2 case migration + 2 caller swap.
- Checks run and outcomes: 22 checks 각각의 exit code + 핵심 출력.
- Done criteria coverage: AC-01~05 별 concrete evidence.
- Assumptions:
  - module export shape — Option A (`useConnectionSessionHydration` only with `useCallback`, plus separate plain helper) / Option B (single plain function) / Option C (two exports — recommended). Generator 재량 단 React tree 외부 entry point 필수.
  - store action thin proxy — `hydrateFromSession: () => hydrateConnectionSession()` 또는 `hydrateFromSession: hydrateConnectionSession` 또는 `hydrateFromSession() { return hydrateConnectionSession(); }` (Generator 재량).
  - mock pattern — `vi.hoisted` + factory mock for `@stores/connectionStore` + `@lib/session-storage` (Sprint 219/223 답습).
  - main.tsx import path — `@hooks/useConnectionSessionHydration` 또는 relative.
  - useWindowFocusHydration 의 `useConnectionStore` import 보존 — 다른 site (focusedConnId getter 등) 사용 중.
- Residual risk:
  - module 안 새 effect 추가 시 cross-window 회귀.
  - store thin proxy 가 module circular import 유발 가능 — module 이 store import + store 가 module import → circular.
    - 회피: store 가 module 호출하지 않고 단순 `set` 호출 lambda body 로 남기되 module 이 별도 export 로 동일 logic 포함 (Option B 변종) / 또는 module 이 store 의 `setState` 만 사용하고 store action 본문은 module 의 export 호출 — Generator 가 import 순서 분석 필수.
  - `markBootMilestone` 동기 timing — hydrate 가 비동기로 변하면 회귀.
  - `useWindowFocusHydration` 의 inner `hydrate` 가 useEffect 의 dependency array 변경 — re-mount/cleanup 발생 가능.
  - persist 3 site 의 `try` block 위치 의존 — `connectToDatabase` 의 try/catch 블록 줄 변경 시 line 198 의 `persistActiveStatuses` 위치가 시프트.

## References

- Contract: `docs/sprints/sprint-224/contract.md`
- Spec: `docs/sprints/sprint-224/spec.md`
- Findings: `docs/sprints/sprint-224/findings.md` (작성 예정)
- Sprint 219 model: `docs/sprints/sprint-219/{spec,contract,findings,handoff}.md` (P10 step 1, narrow-scope pattern source).
- Sprint 223 model: `docs/sprints/sprint-223/{spec,contract,findings,handoff}.md` (P10 step 2, store body shrink + N-case migration pattern).
- Relevant files:
  - `src/stores/connectionStore.ts` (target store, 318 LOC, -~10)
  - `src/stores/connectionStore.test.ts` (test, 1002 LOC, -~30 / -2 case)
  - `src/main.tsx` (boot caller swap, ~1 LOC)
  - `src/hooks/useWindowFocusHydration.ts` (window-focus caller swap, ~1 LOC)
  - `src/hooks/useConnectionMutations.ts` / `useConnectionMutations.test.ts` (Sprint 219 pattern, 변경 0)
  - `src/__tests__/cross-window-connection-sync.test.tsx` / `window-lifecycle.ac141.test.tsx` (cross-window regression, 변경 0)
- 인접 sprint 문서: `docs/sprints/sprint-219/handoff.md` / `docs/sprints/sprint-223/handoff.md`.
- 후속: P10 step 3b (Sprint 225+ 후보, persist 3 site 추출 — risk 매우 높음) / step 4 (IPC bridge 분리, 가장 위험).
