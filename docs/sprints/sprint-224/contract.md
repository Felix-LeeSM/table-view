# Sprint Contract: sprint-224

## Summary

- Goal: `src/stores/connectionStore.ts` 의 `hydrateFromSession` action (lines 225-237, 13 LOC) 본문 (`readConnectionSession` + partial-patch + `set(patch)`) 을 신규 use-case module `src/hooks/useConnectionSessionHydration.ts` 으로 이동. 두 export — `hydrateConnectionSession` (plain function, React tree 외부 가능) + `useConnectionSessionHydration` (React hook wrap). 2 callers (`main.tsx` / `useWindowFocusHydration.ts`) swap. 2 store test case → module test migrate. **persist 3 site (P10 step 3b) byte-equivalent 동결**.
- Audience: Generator + Evaluator (multi-agent harness, post-209 cycle, **P10 step 3a**).
- Owner: harness skill orchestrator.
- Verification Profile: `command`

## In Scope

- 신규 module: `src/hooks/useConnectionSessionHydration.ts` (~30-50 LOC).
- 신규 module test: `src/hooks/useConnectionSessionHydration.test.ts` (≥ 2 case — 2 store case migration).
- `src/stores/connectionStore.ts` body shrink: `hydrateFromSession` 본문 ≤ 2 LOC + `readConnectionSession` import 이동.
- `src/stores/connectionStore.test.ts`: 2 case 삭제.
- `src/main.tsx` (~1 LOC swap).
- `src/hooks/useWindowFocusHydration.ts` (~1 LOC swap).

## Out of Scope

- persist 3 site (`connectToDatabase:198` / `disconnectFromDatabase:217` / `setFocusedConn:222`) — P10 step 3b 영역.
- `attachZustandIpcBridge` module-load attach (lines 311-318) — P10 step 4 영역.
- `SYNCED_KEYS` 4 key 변경.
- `ConnectionState` 16 method signature 변경.
- 다른 15 store action body / `pickFallbackFocus` helper 변경.
- `useConnectionMutations*` (Sprint 219) / `useConnectionLifecycle*` / `useSchemaTableMutations*` (Sprint 223) / `useSchemaCache*` / `useMigrationExport.ts` 변경.
- `schemaStore*` 변경.
- `src/lib/{toast,session-storage,zustand-ipc-bridge,window-label,tauri}.ts` 변경.
- cross-window regression test / 다른 connection components (`Sidebar` / `HomePage` / dialogs) 변경.

## Invariants

- 모든 input 에 대해 boot/focus 시 hydrate 사후 `focusedConnId` / `activeStatuses` byte-equivalent.
- session empty / partial / both fields 분기 사전 동일.
- `ConnectionState.hydrateFromSession: () => void` interface signature 동결.
- persist 3 site byte-equivalent.
- SYNCED_KEYS / IPC bridge module-load attach byte-equivalent.
- 새 useEffect / setInterval / setTimeout / subscribe / window event listener 0 in module.
- 새 `eslint-disable*` / 새 silent `catch{}` / `it.only` / `it.skip` / 새 `any` 0.

## Acceptance Criteria

- `AC-01`: store body shrink. `hydrateFromSession` body ≤ 2 LOC. `git diff --stat src/stores/connectionStore.ts` 의 `-` count ≥ 10. `grep -nE 'Pick<ConnectionState,' src/stores/connectionStore.ts | wc -l` = 0.
- `AC-02`: 신규 module + 2 export. `src/hooks/useConnectionSessionHydration.ts` 존재 + `hydrateConnectionSession` named export + `useConnectionSessionHydration` named export (Option C 권장). 새 useEffect / setInterval / setTimeout / subscribe / addEventListener 0.
- `AC-03`: module test ≥ 2 case. 2 verbatim case name (`hydrateFromSession restores focusedConnId and activeStatuses` / `hydrateFromSession is a no-op when session is empty`) — store match 0 + module match ≥ 1 each. mock 패턴: `vi.hoisted` + `vi.mock("@stores/connectionStore", ...)` + `vi.mock("@lib/session-storage", ...)`.
- `AC-04`: caller swap 2 site. `grep -rnE 'useConnectionStore\.getState\(\)\.hydrateFromSession\(\)' src/` (excl store file) 매치 0. `grep -rn 'hydrateConnectionSession\b' src/` ≥ 3 (module + main.tsx + useWindowFocusHydration.ts).
- `AC-05`: 모든 invariant 충족. **CRITICAL FREEZE**: persist 3 site grep verbatim 매치 동일 (`persistActiveStatuses(get().activeStatuses)` × 2 / `persistFocusedConnId(id)` × 1 / `attachZustandIpcBridge<ConnectionState>` × 1 / SYNCED_KEYS literal × 1). 모든 sibling diff 0. cross-window regression 통과.

## Design Bar / Quality Bar

- narrow extraction — read-only `hydrateFromSession` 한 흐름만 이동.
- store body 다른 15 action / persist 3 site / IPC bridge / SYNCED_KEYS 변경 0.
- module 은 Sprint 219 / 223 패턴 답습 — `useCallback` + setState 외부 진입점.
- module 은 React tree 외부 호출 가능 — `hydrateConnectionSession` plain function entry point 필수.
- store interface signature `hydrateFromSession: () => void` 동결 (action body 가 thin proxy 로 module 호출).
- module test 는 Sprint 219 / 223 verbatim mock 패턴.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/hooks/useConnectionSessionHydration.test.ts` exit 0 + ≥ 2 case pass.
2. `pnpm vitest run src/stores/connectionStore.test.ts` exit 0. 사전 case 수 -2.
3. `pnpm vitest run src/hooks/useWindowFocusHydration.test.ts` exit 0 (사전 case 동일).
4. `pnpm vitest run src/__tests__/cross-window-connection-sync.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` exit 0.
5. `pnpm vitest run src/hooks/useConnectionMutations.test.ts src/hooks/useConnectionLifecycle.test.ts src/hooks/useSchemaTableMutations.test.ts src/hooks/useSchemaCache.test.ts src/stores/schemaStore.test.ts` exit 0.
6. `pnpm vitest run` exit 0. file count 사전 +2.
7. `pnpm tsc --noEmit` exit 0.
8. `pnpm lint` exit 0.
9. `git diff --stat src/stores/connectionStore.ts` 의 `-` count ≥ 10.
10. `grep -nE 'Pick<ConnectionState,' src/stores/connectionStore.ts | wc -l` = 0.
11. **CRITICAL FREEZE — persist 3 site**:
    - `grep -nE 'persistActiveStatuses\(get\(\)\.activeStatuses\)' src/stores/connectionStore.ts | wc -l` = 2
    - `grep -nE 'persistFocusedConnId\(id\)' src/stores/connectionStore.ts | wc -l` = 1
12. **CRITICAL FREEZE — IPC bridge**:
    - `grep -nE 'attachZustandIpcBridge<ConnectionState>' src/stores/connectionStore.ts | wc -l` = 1
    - `grep -nE '"connections", "groups", "activeStatuses", "focusedConnId"' src/stores/connectionStore.ts | wc -l` = 1
13. `test -f src/hooks/useConnectionSessionHydration.ts && test -f src/hooks/useConnectionSessionHydration.test.ts`.
14. `grep -nE '^export function hydrateConnectionSession' src/hooks/useConnectionSessionHydration.ts` = 1.
15. `grep -rn 'hydrateConnectionSession\b' src/` ≥ 3.
16. `grep -rnE 'useConnectionStore\.getState\(\)\.hydrateFromSession\(\)' src/` 매치 0 (단, store thin-proxy 가 internal 호출 시 store file 매치는 허용 — `grep -v src/stores/connectionStore.ts` 후 0).
17. `grep -n 'hydrateConnectionSession' src/main.tsx` ≥ 1. `grep -n 'hydrateConnectionSession' src/hooks/useWindowFocusHydration.ts` ≥ 1.
18. 2 verbatim case name `grep -nE` 사전 store test → module test 이동 (store 0 / module ≥ 1 each).
19. `git diff --stat src/hooks/useConnectionMutations.ts src/hooks/useConnectionMutations.test.ts src/hooks/useConnectionLifecycle.ts src/hooks/useConnectionLifecycle.test.ts src/hooks/useSchemaTableMutations.ts src/hooks/useSchemaTableMutations.test.ts src/hooks/useSchemaCache.ts src/hooks/useSchemaCache.test.ts src/hooks/useMigrationExport.ts` 모두 0.
20. `git diff --stat src/stores/schemaStore.ts src/stores/schemaStore.test.ts src/lib/toast.ts src/lib/session-storage.ts src/lib/zustand-ipc-bridge.ts src/lib/window-label.ts src/lib/tauri.ts 2>/dev/null` 모두 0 (단 tauri.ts → tauri/ 디렉토리).
21. `git diff --stat src/__tests__/cross-window-connection-sync.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` 모두 0.
22. `grep -nE '\b(useEffect|setInterval|setTimeout|addEventListener|subscribe)\b' src/hooks/useConnectionSessionHydration.ts | wc -l` = 0. `git diff src/ | grep "^+.*eslint-disable"` 매치 0. `grep -rnE 'it\.only|it\.skip' src/hooks/useConnectionSessionHydration.test.ts` 매치 0. `git diff src/hooks/useConnectionSessionHydration.ts | grep -E "^\+.*\bany\b"` 매치 0.

### Required Evidence

- Generator must provide:
  - 변경 파일 목록 + 각 LOC delta.
  - check 1-22 실행 결과.
  - AC-01..AC-05 별 evidence.
  - 2 verbatim case name 매치 결과.
  - persist 3 site / SYNCED_KEYS / IPC bridge attach byte-equivalence 검증.
  - module export shape 명시 (Option A / B / C 선택).
  - main.tsx 의 boot path 호출이 React tree 외부에서 작동함을 명시.
- Evaluator must cite:
  - 각 AC 별 pass/fail 근거.
  - missing 또는 weak evidence finding.
  - persist 3 site / SYNCED_KEYS / IPC bridge byte-equivalence 검증.

## Test Requirements

### Unit Tests (필수)
- AC-01 : `connectionStore.test.ts` 사후 case 수 = 사전 -2 + 모두 통과.
- AC-02 : `hydrateConnectionSession` named export 검증 + 0 effect/listener.
- AC-03 : 2 verbatim case migrate + 모두 통과.
- AC-04 : caller swap 후 `pnpm vitest run` exit 0.
- AC-05 : sibling diff 0 + cross-window regression 통과.

### Coverage Target
- 신규 `useConnectionSessionHydration.ts`: 라인 ≥ 70% (2 case 로 cover).
- CI baseline: 라인 40% / 함수 40% / 브랜치 35%.

### Scenario Tests (필수)
- [x] Happy path (session 모두 채워짐 → focusedConnId + activeStatuses 복원)
- [x] 에러/예외 상황 (해당 없음 — read-only path, 단 partial session edge case)
- [x] 경계 조건 (session empty → no-op)
- [x] 기존 기능 회귀 없음 (cross-window / window-lifecycle / Sprint 219/223 sibling test 사전 동일 통과)

## Test Script / Repro Script

1. baseline:
   ```sh
   pnpm vitest run src/stores/connectionStore.test.ts
   ```
2. Generator 작업 후:
   ```sh
   pnpm vitest run src/hooks/useConnectionSessionHydration.test.ts
   pnpm vitest run src/stores/connectionStore.test.ts
   pnpm vitest run src/hooks/useWindowFocusHydration.test.ts
   pnpm vitest run src/__tests__/cross-window-connection-sync.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx
   pnpm vitest run src/hooks/useConnectionMutations.test.ts src/hooks/useConnectionLifecycle.test.ts src/hooks/useSchemaTableMutations.test.ts src/hooks/useSchemaCache.test.ts src/stores/schemaStore.test.ts
   pnpm vitest run
   pnpm tsc --noEmit
   pnpm lint
   ```
3. body shrink + persist 3 site freeze 검증:
   ```sh
   git diff --stat src/stores/connectionStore.ts
   grep -nE 'persistActiveStatuses|persistFocusedConnId|attachZustandIpcBridge|SYNCED_KEYS' src/stores/connectionStore.ts
   ```

## Ownership

- Generator: general-purpose agent (Phase 3).
- Write scope: `src/hooks/useConnectionSessionHydration.{ts,test.ts}` 신규 + `src/stores/connectionStore.ts` body shrink + `src/stores/connectionStore.test.ts` 2 case 삭제 + `src/main.tsx` 1 swap + `src/hooks/useWindowFocusHydration.ts` 1 swap.
- 변경 금지: persist 3 site / SYNCED_KEYS / IPC bridge attach / `useConnectionMutations*` / `useConnectionLifecycle*` / `useSchemaTableMutations*` / `useSchemaCache*` / `useMigrationExport*` / `schemaStore*` / `src/lib/*` / cross-window regression test / 다른 connection components.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes` (1-22 모두)
- Acceptance criteria evidence linked in `handoff.md`
- **본 sprint 후 P10 step 3a 종료** — Sprint 225+ 후속 (step 3b persist 3 site 추출 / step 4 IPC bridge 분리) 시작 가능.
