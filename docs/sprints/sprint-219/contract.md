# Sprint Contract: sprint-219

## Summary

- Goal: `src/stores/connectionStore.ts` 의 `addConnection` / `updateConnection` / `removeConnection` 3 mutation action 본문에서 `toast.success(...)` 호출 (각 1건, 총 3건) + `toast` import 1줄을 신규 use-case hook `useConnectionMutations` 으로 이동. 2 component (`ConnectionDialog` / `ConnectionItem`) 의 selector 호출 site 를 hook destructure 로 swap. 행동 변경 0; toast text byte-equivalent; SYNCED_KEYS / IPC bridge / session-storage / store action signature 모두 사전 동결.
- Audience: Generator + Evaluator (multi-agent harness, post-209 cycle, **P10 step 1 (first)**).
- Owner: harness skill orchestrator.
- Verification Profile: `command`

## In Scope

- 신규 hook 파일: `src/hooks/useConnectionMutations.ts` (~50 LOC).
- 신규 hook test: `src/hooks/useConnectionMutations.test.ts` (≥ 5 case).
- `src/stores/connectionStore.ts` 본문 축소 (-4 ~ -6 LOC): toast import + 3 toast 호출 제거 (선택: removeConnection 의 toast 전용 `removed` lookup 제거).
- `src/components/connection/ConnectionDialog.tsx`: 2 selector → `useConnectionMutations()` destructure swap.
- `src/components/connection/ConnectionItem.tsx`: 1 selector → `useConnectionMutations()` destructure swap.

## Out of Scope

- store public API (16 method signature) 변경.
- `SYNCED_KEYS` / `attachZustandIpcBridge` / `initEventListeners` / module-load attach 변경.
- session-storage 호출 줄 (`persistFocusedConnId` / `persistActiveStatuses` / `readConnectionSession` 3 site) 변경.
- `connectionStore.test.ts` / `schemaStore.test.ts` / `useConnectionLifecycle.{ts,test.ts}` / `useSchemaCache.{ts,test.ts}` / `useMigrationExport.ts` / `src/lib/{toast,session-storage,zustand-ipc-bridge,window-label}.ts` 변경.
- cross-window regression test (`cross-window-connection-sync.test.tsx` / `window-lifecycle.ac141.test.tsx`) 변경.
- P10 후속 step (schemaStore optimistic refresh / connectionStore session persistence / IPC bridge 분리) — 본 sprint scope 외.

## Invariants

- toast text byte-equivalent: `Connection "${name}" added.` / `Connection "${name}" updated.` / `Connection "${name}" removed.` / `Connection removed.` (fallback).
- store action signature (return type / throw 정책 / parameter shape) 변경 0.
- `SYNCED_KEYS` 4 key (connections / groups / activeStatuses / focusedConnId) 변경 0.
- `attachZustandIpcBridge<ConnectionState>(useConnectionStore, ...)` 모듈-load attach 줄 변경 0.
- session-storage 3 호출 site 변경 0.
- `initEventListeners` body 변경 0.
- ConnectionDialog 의 setSaving / setError / try-catch / onClose / sanitizeMessage 분기 변경 0.
- Sidebar 의 `connection-added` window event dispatch 변경 0.
- 새 `eslint-disable*` / 새 silent `catch{}` / `it.only` / `it.skip` 0.
- 새 `any` 0.

## Acceptance Criteria

- `AC-01`: store body 축소. `grep -c 'toast' src/stores/connectionStore.ts` = 0. `grep -nE 'toast\.(success|error|info|warning)' src/stores/connectionStore.ts` 매치 0. store body 의 다른 줄 변경 0 (mutation action 의 set / tauri / removed lookup 외 제거).
- `AC-02`: 신규 hook `src/hooks/useConnectionMutations.ts` 존재 + named export `useConnectionMutations` 1건. signature: `() => { addConnection, updateConnection, removeConnection }` — 3 method 가 store action 과 byte-equivalent. hook 안 새 useEffect / setInterval / setTimeout / subscribe / window event listener 0.
- `AC-03`: hook test ≥ 5 case + 모두 통과. 5 권고 case (success toast text 3 + remove fallback 1 + throw 시 toast 0 1) 모두 cover. mock 패턴 `vi.hoisted` + `vi.mock("@stores/connectionStore", ...)` + `vi.mock("@lib/toast", ...)` (`useConnectionLifecycle.test.ts` 답습).
- `AC-04`: 2 component swap. `grep -rn 'useConnectionStore((s) => s\.\(addConnection\|updateConnection\|removeConnection\))' src/components/ src/hooks/` 매치 0. `grep -rn 'useConnectionMutations' src/` ≥ 4 (hook + 2 component + hook test).
- `AC-05`: 모든 invariant 충족. `connectionStore.test.ts` / `schemaStore.test.ts` / `useConnectionLifecycle.{ts,test.ts}` / `useSchemaCache.{ts,test.ts}` / `useMigrationExport.ts` / `src/lib/{toast,session-storage,zustand-ipc-bridge,window-label}.ts` / cross-window regression test 모두 diff 0. 4 toast text byte-equivalent 매치. Global AC 1-10 모두 충족.

## Design Bar / Quality Bar

- narrow extraction — 한 흐름 (mutation toast) 만 이동. orchestration only — hook 은 store selector wrap 뿐, 새 effect / listener / subscribe 0.
- store body 의 다른 코드 (set / tauri call / persistActiveStatuses / pickFallbackFocus / connecting seed / activeDb seed 등) 변경 0.
- hook 은 `useConnectionLifecycle.ts` 패턴 답습 — `useCallback` + selector 3건.
- toast text 는 backtick template literal byte-equivalent.
- hook test 는 mock leakage 0 — `vi.hoisted` + factory mock.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/hooks/useConnectionMutations.test.ts` exit 0 + ≥ 5 case pass.
2. `pnpm vitest run src/stores/connectionStore.test.ts src/stores/schemaStore.test.ts src/hooks/useConnectionLifecycle.test.ts src/hooks/useSchemaCache.test.ts` exit 0. 사전 case 수 동일.
3. `pnpm vitest run src/__tests__/cross-window-connection-sync.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` exit 0.
4. `pnpm vitest run` exit 0. file count 사전 +2 (hook + hook test). tests delta ≥ +5.
5. `pnpm tsc --noEmit` exit 0.
6. `pnpm lint` exit 0.
7. `grep -c '^import.*toast' src/stores/connectionStore.ts` = 0.
8. `grep -nE 'toast\.(success|error|info|warning)' src/stores/connectionStore.ts` 매치 0.
9. `git diff --stat src/stores/connectionStore.ts` 의 `-` count ≥ 4.
10. `test -f src/hooks/useConnectionMutations.ts && test -f src/hooks/useConnectionMutations.test.ts`.
11. `grep -nE '^export function useConnectionMutations' src/hooks/useConnectionMutations.ts` = 1.
12. `grep -rn 'useConnectionMutations' src/components/connection/ConnectionDialog.tsx` ≥ 1.
13. `grep -rn 'useConnectionMutations' src/components/connection/ConnectionItem.tsx` ≥ 1.
14. `grep -rnE 'useConnectionStore\(\(s\) => s\.(addConnection\|updateConnection\|removeConnection)\)' src/components/ src/hooks/` 매치 0.
15. Toast text byte-equivalent 4건 — `grep -F` 로 hook 안 각 ≥ 1 매치:
    - `" added.`
    - `" updated.`
    - `" removed.`
    - `"Connection removed."` (fallback)
16. `grep -nE 'SYNCED_KEYS|attachZustandIpcBridge|persistFocusedConnId|persistActiveStatuses|readConnectionSession' src/stores/connectionStore.ts` 매치 사전 동일 (베이스라인 보존).
17. `git diff --stat src/stores/connectionStore.test.ts src/stores/schemaStore.test.ts` = 0.
18. `git diff --stat src/hooks/useConnectionLifecycle.ts src/hooks/useConnectionLifecycle.test.ts src/hooks/useSchemaCache.ts src/hooks/useSchemaCache.test.ts src/hooks/useMigrationExport.ts` 모두 0.
19. `git diff --stat src/lib/toast.ts src/lib/session-storage.ts src/lib/zustand-ipc-bridge.ts src/lib/window-label.ts` 모두 0.
20. `git diff --stat src/__tests__/cross-window-connection-sync.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx src/main.tsx` 모두 0.
21. `git diff src/ | grep "^+.*eslint-disable"` 매치 0. `grep -rnE 'it\.only|it\.skip' src/hooks/useConnectionMutations.test.ts` 매치 0.
22. `git diff src/hooks/useConnectionMutations.ts | grep -E "^\+.*\bany\b"` 매치 0.

### Required Evidence

- Generator must provide:
  - 변경 파일 목록 + 각 LOC delta.
  - check 1-22 실행 결과 (exit code + 핵심 출력).
  - AC-01..AC-05 별 evidence.
  - 4 toast text 매치 결과.
  - removeConnection name resolution 변종 명시 (hook 안 selector lookup vs component 가 connection 객체 전달).
- Evaluator must cite:
  - 각 AC 별 pass/fail 근거.
  - missing 또는 weak evidence finding.

## Test Requirements

### Unit Tests (필수)
- AC-01 : `connectionStore.test.ts` 사전 case 수 사후 동일 + 통과 (toast assertion 0 사전 사실).
- AC-02 : `useConnectionMutations` named export + signature 검증 (hook test).
- AC-03 : 5 권고 case 모두 cover.
- AC-04 : component swap 후 `pnpm vitest run` exit 0.
- AC-05 : cross-window regression / sibling diff 0.

### Coverage Target
- 신규 `useConnectionMutations.ts`: 라인 ≥ 70% (5 case 로 cover).
- CI baseline: 라인 40% / 함수 40% / 브랜치 35%.

### Scenario Tests (필수)
- [x] Happy path (addConnection / updateConnection / removeConnection 각 success → toast 1)
- [x] 에러/예외 상황 (store throw → toast 0 + propagate)
- [x] 경계 조건 (removeConnection name unresolvable → fallback "Connection removed.")
- [x] 기존 기능 회귀 없음 (cross-window / store / lifecycle hook test 사전 동일 통과)

## Test Script / Repro Script

1. baseline:
   ```sh
   pnpm vitest run src/stores/connectionStore.test.ts src/hooks/useConnectionLifecycle.test.ts
   ```
2. Generator 작업 후:
   ```sh
   pnpm vitest run src/hooks/useConnectionMutations.test.ts
   pnpm vitest run src/stores/connectionStore.test.ts src/stores/schemaStore.test.ts src/hooks/useConnectionLifecycle.test.ts src/hooks/useSchemaCache.test.ts
   pnpm vitest run src/__tests__/cross-window-connection-sync.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx
   pnpm vitest run
   pnpm tsc --noEmit
   pnpm lint
   ```
3. store body shrink + hook surface 검증:
   ```sh
   grep -c '^import.*toast' src/stores/connectionStore.ts
   grep -nE 'toast\.' src/stores/connectionStore.ts
   git diff --stat src/stores/connectionStore.ts
   grep -nE '^export function useConnectionMutations' src/hooks/useConnectionMutations.ts
   ```

## Ownership

- Generator: general-purpose agent (Phase 3).
- Write scope: `src/hooks/useConnectionMutations.{ts,test.ts}` 신규 + `src/stores/connectionStore.ts` 본문 축소 + `src/components/connection/ConnectionDialog.tsx` + `src/components/connection/ConnectionItem.tsx` 의 selector swap.
- 변경 금지: `connectionStore.test.ts` / `schemaStore*` / `useConnectionLifecycle*` / `useSchemaCache*` / `useMigrationExport*` / `src/lib/*` / cross-window regression test / `main.tsx`.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes` (1-22 모두)
- Acceptance criteria evidence linked in `handoff.md`
- **본 sprint 후 P10 step 1 종료** — Sprint 223+ 후속 step (schemaStore optimistic refresh / connectionStore session persistence / IPC bridge 분리) 시작 가능.
