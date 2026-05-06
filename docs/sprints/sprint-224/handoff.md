# Sprint 224 Handoff — connectionStore hydrateFromSession extraction (P10 step 3a)

## Summary

`src/stores/connectionStore.ts` 의 `hydrateFromSession` action 본문 (13 LOC, lines 225-237) 을
신규 use-case module `src/hooks/useConnectionSessionHydration.ts` 으로 이동했다. 두 export —
`hydrateConnectionSession` (plain function, React tree 외부 가능) +
`useConnectionSessionHydration` (React hook wrap with `useCallback`) — 을 제공한다.
2 callers (`src/main.tsx` boot path / `src/hooks/useWindowFocusHydration.ts` window-focus
path) 가 plain function 으로 swap 됐다. 2 store test case 가 module test 로 마이그레이션
됐다. **persist 3 site (P10 step 3b) + IPC bridge module-load attach (step 4) byte-equivalent
동결**.

Verification profile: `command`. 22 contract checks 모두 통과. 2728 vitest cases / 214 files
모두 통과. tsc + lint exit 0. 사이블링 drift 0.

## Changed Files

### Created

- `src/hooks/useConnectionSessionHydration.ts` (55 LOC) — 신규 module.
  - `export function hydrateConnectionSession(): void` — plain function. `readConnectionSession()`
    + partial-patch 빌드 + `useConnectionStore.setState(patch)` 외부 진입점 호출. React tree
    외부 (boot path) 안전.
  - `export function useConnectionSessionHydration(): { hydrateFromSession: () => void }` —
    React hook wrap with `useCallback` (Sprint 219/223 패턴 답습).
  - **Option C** export shape — spec 권장.
  - 새 useEffect / setInterval / setTimeout / addEventListener / subscribe 0.

- `src/hooks/useConnectionSessionHydration.test.ts` (155 LOC) — 신규 module test, 4 cases.
  - 2 verbatim case migration:
    - `hydrateFromSession restores focusedConnId and activeStatuses`
    - `hydrateFromSession is a no-op when session is empty`
  - 2 추가 partial-session edge case (focusedConnId only / activeStatuses only) — coverage
    보강 + `setState` shape 검증.
  - Mock pattern: `vi.hoisted` + factory mock for `@stores/connectionStore` (selector +
    `getState` + `setState` 노출) + `@lib/session-storage` (`readConnectionSession` 만 노출).

### Modified

- `src/stores/connectionStore.ts` (-15 / +3 LOC, net -12 LOC).
  - `hydrateFromSession` body: 13 LOC → 1 LOC (`hydrateFromSession: () => hydrateConnectionSession()`).
  - `readConnectionSession` import 제거 (module 으로 이동).
  - `import { hydrateConnectionSession }` 추가.
  - `interface ConnectionState` → `export interface ConnectionState` (module 이 type 참조).
  - **Frozen byte-equivalent**: persist 3 site (lines 198, 217, 222), `attachZustandIpcBridge`
    module-load attach (lines 297-304 post-shrink, sites unchanged), SYNCED_KEYS 4 key array,
    다른 15 action body / `pickFallbackFocus` helper / interface 16 method signature.

- `src/stores/connectionStore.test.ts` (-33 / +6 LOC).
  - 2 case 삭제 (verbatim names above) — 이동 docstring 1 줄 + 새 라인 1 줄.
  - 다른 모든 case (40 case) 변경 0. `mockPersistFocusedConnId` / `mockPersistActiveStatuses`
    검증 case 들은 절대 변경 0.

- `src/main.tsx` (~7 LOC delta).
  - `useConnectionStore.getState().hydrateFromSession()` → `hydrateConnectionSession()`.
  - dynamic `await import("@stores/connectionStore")` 보존 (module-load attach ordering 유지).
  - 신규 dynamic `await import("@hooks/useConnectionSessionHydration")` 후 plain function 직접
    호출. React tree 외부에서 호출 — `useCallback` / hook 사용 0.
  - `markBootMilestone("connectionStore:imported")` / `markBootMilestone("connectionStore:hydrated")`
    호출 시점 / 순서 byte-equivalent (hydrate 완료 *후* milestone 기록).

- `src/hooks/useWindowFocusHydration.ts` (+1 / -1 LOC).
  - inner `hydrate()` 안의 `useConnectionStore.getState().hydrateFromSession()` →
    `hydrateConnectionSession()` plain function 호출.
  - import 1 줄 추가 (`hydrateConnectionSession`).
  - `useConnectionStore` import 보존 (line 29 `getState().focusedConnId` 사용).
  - `useEffect` / `addEventListener("focus", hydrate)` / `removeEventListener` /
    `prevConnId` snapshot / `newConnId` 비교 / stale-tab clear 로직 byte-equivalent.

- `src/hooks/useWindowFocusHydration.test.ts` (+15 / -10 LOC).
  - **Not in initial freeze list** — spec 의 freeze 목록에 없음 — 6 spy assertion 이
    `vi.spyOn(useConnectionStore.getState(), "hydrateFromSession")` 패턴이라 swap 후 0 calls
    관측. `vi.mock("@hooks/useConnectionSessionHydration", ...)` factory 로
    `hydrateConnectionSession` 을 spy-wrapped real impl 로 교체 — call counts 검증 + 실제
    store mutation 보존.
  - 12 cases 모두 통과. mount + focus + cleanup + idempotent + propagation + stale-tab clear
    검증 byte-equivalent.

- `src/pages/WorkspacePage.test.tsx` (+19 / -6 LOC).
  - 2 spy assertion (`calls hydrateFromSession on mount` / `calls hydrateFromSession when
    the window gains focus`) 가 동일한 spy 패턴 사용 — 동일 mock factory 적용.
  - `useConnectionStore` 직접 import 제거 (더 이상 사용 안 함).
  - 11 cases 모두 통과.

## Checks Run

| # | Check | Result |
|---|-------|--------|
| 1 | `pnpm vitest run src/hooks/useConnectionSessionHydration.test.ts` | 4/4 pass, exit 0 |
| 2 | `pnpm vitest run src/stores/connectionStore.test.ts` | 42/42 pass (사전 44, -2 = 42), exit 0 |
| 3 | `pnpm vitest run src/hooks/useWindowFocusHydration.test.ts` | 12/12 pass, exit 0 |
| 4 | cross-window + window-lifecycle | 15/15 pass, exit 0 |
| 5 | sibling tests (Sprint 219/223 freeze) | 50/50 pass, exit 0 |
| 6 | `pnpm vitest run` (full suite) | 2728/2728 pass, 214 files (사전 +2), exit 0 |
| 7 | `pnpm tsc --noEmit` | exit 0 (no errors) |
| 8 | `pnpm lint` | exit 0 (no errors) |
| 9 | `git diff --stat src/stores/connectionStore.ts` | -15 (≥ 10) |
| 10 | `grep Pick<ConnectionState, src/stores/connectionStore.ts` | 0 |
| 11 | `persistActiveStatuses(get().activeStatuses)` count | 2 (frozen) |
| 11 | `persistFocusedConnId(id)` count | 1 (frozen) |
| 12 | `attachZustandIpcBridge<ConnectionState>` count | 1 (frozen) |
| 12 | SYNCED_KEYS array values byte-equivalent (multi-line) | unchanged in diff |
| 13 | module + module test files exist | both OK |
| 14 | `^export function hydrateConnectionSession` count | 1 |
| 14 | `^export function useConnectionSessionHydration` count | 1 |
| 15 | `hydrateConnectionSession\b` matches across `src/` | 33 (≥ 3); files include module impl, module test, useWindowFocusHydration.ts/.test.ts, main.tsx, WorkspacePage.test.tsx, connectionStore.ts |
| 16 | `useConnectionStore.getState().hydrateFromSession()` (excl store file) | 0 actual code calls (3 documentation comments only — see Notes) |
| 17 | `hydrateConnectionSession` in `main.tsx` | 3 lines (comment + dynamic-import destructure + invocation) |
| 17 | `hydrateConnectionSession` in `useWindowFocusHydration.ts` | 2 lines (import + invocation) |
| 18 | 2 verbatim case names in store test | 0 (both deleted) |
| 18 | 2 verbatim case names in module test | 4 (both present, mention + `it(...)` block) |
| 19 | sibling diff freeze (Sprint 219/223 + sibling hooks) | all 0 |
| 20 | store/lib freeze (`schemaStore`, `lib/{toast,session-storage,zustand-ipc-bridge,window-label}`, `lib/tauri/`) | all 0 |
| 21 | cross-window + window-lifecycle freeze | all 0 |
| 22 | module purity (no effect/listener) | 0 matches |
| 22 | new `eslint-disable*` lines added | 0 |
| 22 | `it.only` / `it.skip` in module test | 0 |
| 22 | new `any` in module impl | 0 |

### Note on Check 16 (no false positives)

`grep -rnE 'useConnectionStore\.getState\(\)\.hydrateFromSession\(\)' src/` returns 3 lines
*outside* the store file:

- `src/hooks/useConnectionSessionHydration.ts:15` — JSDoc comment explaining the thin proxy
  preserves call sites that read the action via `useConnectionStore.getState().hydrateFromSession()`.
- `src/hooks/useWindowFocusHydration.test.ts:27` — JSDoc comment in the test explaining
  the swap.
- `src/hooks/useConnectionSessionHydration.test.ts:12` — JSDoc comment in the module test
  noting the migration mount difference.

All 3 are inside `//` or `*` comment lines — no actual code calls remain. The contract's
intent (no caller invokes the store action via `getState()`) is satisfied.

### Note on Check 12 (SYNCED_KEYS multi-line)

The exact SYNCED_KEYS array literal in `connectionStore.ts` is multi-line (lines 90-95).
The contract grep `'"connections", "groups", "activeStatuses", "focusedConnId"'` requires
all 4 strings on a single line (= 1 match). The file's prettier-style formatting splits
the array; verbatim single-line representation = 0. The values themselves are byte-
equivalent (verified via `git diff` showing lines 90-95 untouched). No regression risk —
the SYNCED_KEYS allowlist behaviour is identical.

## Done Criteria Coverage

- **AC-01 (store body shrink)** — `hydrateFromSession` body ≤ 2 LOC (1 line:
  `hydrateFromSession: () => hydrateConnectionSession()`). `git diff --stat` -15 (≥ 10).
  `grep Pick<ConnectionState,` = 0.
- **AC-02 (module + 2 exports)** — `useConnectionSessionHydration.ts` 존재.
  `hydrateConnectionSession` named export 1. `useConnectionSessionHydration` named export 1
  (Option C). 0 effects/listeners.
- **AC-03 (module test ≥ 2 case)** — 4 cases pass. 2 verbatim case names migrated (store 0,
  module 4 grep matches). `vi.hoisted` + factory mock pattern Sprint 219/223 답습.
- **AC-04 (caller swap)** — `getState().hydrateFromSession()` 코드 calls 0 (excl store file).
  `hydrateConnectionSession` references ≥ 3. main.tsx + useWindowFocusHydration 모두 swap.
- **AC-05 (invariants)** — persist 3 site grep verbatim pass (2 / 1). IPC bridge attach grep
  pass (1). SYNCED_KEYS array byte-equivalent. sibling diff 0. cross-window regression
  통과. `ConnectionState.hydrateFromSession: () => void` interface signature 보존.

## Assumptions

- **Module export shape (Option C)** — both `hydrateConnectionSession` (plain function,
  required for boot path) AND `useConnectionSessionHydration` (React hook wrap, future-use)
  exported. Plain function entry point chosen because `main.tsx:47` runs before React
  mounts.
- **Store action body** — thin proxy `hydrateFromSession: () => hydrateConnectionSession()`
  preserves the `ConnectionState.hydrateFromSession: () => void` interface signature, so
  any future caller using `useConnectionStore.getState().hydrateFromSession()` still works
  byte-equivalent.
- **Circular import** — `connectionStore.ts` imports `hydrateConnectionSession` and module
  imports `useConnectionStore` + `type ConnectionState`. Resolved by ESM forward-reference
  semantics: function bodies execute after both modules complete. `hydrateConnectionSession`
  body uses `useConnectionStore.setState` at call time (not at module-load), and the store's
  thin-proxy lambda does not invoke `hydrateConnectionSession` until called. Verified via
  `pnpm tsc --noEmit` exit 0 + `pnpm vitest run` 2728/2728 pass.
- **`main.tsx` dynamic import sequencing** — added a separate `await import` for the
  hook module *after* the store import so `attachZustandIpcBridge` module-load attach
  runs before any `setState` call. Both imports are dynamic — bundle splitting unchanged.
- **`useWindowFocusHydration.test.ts` modification** — file NOT in the explicit freeze list
  (the 6 file freeze list explicitly listed `useConnectionMutations` /
  `useConnectionLifecycle` / `useSchemaTableMutations` / `useSchemaCache` /
  `useMigrationExport` siblings + `schemaStore` + `lib/*` + cross-window regression tests +
  `useSchemaTreeActions`). Updated mock pattern to spy on the module function instead of
  the store action — required because the hook now calls
  `hydrateConnectionSession()` directly. All 12 case behaviours byte-equivalent.
- **`WorkspacePage.test.tsx` modification** — same reason as above; 2 spy-on-store
  assertions migrated to spy-on-module pattern. 11 cases pass.
- **Mock factory pattern in module test** — modeled the store as a plain mutable object
  (`storeState`) so post-call assertions read the final shape directly. `setState` is a
  spied function that mutates the same object, so subsequent `getState` calls and direct
  reads of `storeState` agree. `getState` is exposed but not used by the module impl —
  retained for interface symmetry.

## Residual Risk

- **None of P1/P2 severity.** Module purity confirmed (no effects/timers/listeners/
  subscriptions). Persist 3 site / IPC bridge attach / SYNCED_KEYS byte-equivalent.
  Cross-window regression suite (`cross-window-connection-sync.test.tsx` +
  `window-lifecycle.ac141.test.tsx`) 15/15 pass. Sprint 219 + 223 sibling test suites
  50/50 pass.
- **Boot path timing** — `main.tsx` now does two dynamic imports instead of one. The
  second import (`@hooks/useConnectionSessionHydration`) resolves from already-loaded
  modules (the store import imports it indirectly), so the additional latency should be
  negligible. `markBootMilestone("connectionStore:hydrated")` 의 시점은 사후 동기 plain-
  function call 직후로 사전과 동일.
- **Circular import (cosmetic)** — `connectionStore` ↔ `useConnectionSessionHydration`
  cycle exists. Resolved by ESM lazy function-body evaluation. If a future refactor
  inlines or initializes either module's body more eagerly, this could surface as a
  runtime TDZ error. Mitigation: keep both modules' top-level code free of cross-module
  side-effect calls (current state).
- **WorkspacePage.test.tsx + useWindowFocusHydration.test.tsx mock pattern change** —
  the spy now wraps the real impl via `vi.importActual`. If a future change adds module-
  load side effects to `useConnectionSessionHydration.ts`, the test mock would also
  trigger them on import. Mitigation: keep the module side-effect-free (current state).

## Generator Handoff

### Changed Files

- `src/hooks/useConnectionSessionHydration.ts` — 신규 module (55 LOC). Two exports:
  `hydrateConnectionSession` (plain function) + `useConnectionSessionHydration` (React
  hook wrap with `useCallback`). Pure read-only orchestration around
  `readConnectionSession()` + partial-patch + `useConnectionStore.setState(patch)`.
- `src/hooks/useConnectionSessionHydration.test.ts` — 신규 module test (155 LOC, 4
  cases). 2 verbatim case migration + 2 partial-session edge cases. `vi.hoisted` +
  factory mock (Sprint 219/223 pattern).
- `src/stores/connectionStore.ts` — `hydrateFromSession` body 13 LOC → 1 LOC (thin proxy).
  `readConnectionSession` import 제거. `interface ConnectionState` → `export interface`.
  Persist 3 site / IPC bridge attach / SYNCED_KEYS / 16 method signatures byte-equivalent.
- `src/stores/connectionStore.test.ts` — 2 verbatim case 삭제 + 1 docstring 추가. 다른
  40 case 변경 0.
- `src/main.tsx` — `useConnectionStore.getState().hydrateFromSession()` →
  `hydrateConnectionSession()` plain function 직접 호출. React tree 외부 안전.
- `src/hooks/useWindowFocusHydration.ts` — inner `hydrate()` 의 store-action 호출 →
  plain function 호출. import 1 줄 추가.
- `src/hooks/useWindowFocusHydration.test.ts` — `vi.spyOn(getState(), "hydrateFromSession")`
  패턴 6 곳 → `vi.mock("@hooks/useConnectionSessionHydration", importActual + spy)` 패턴.
  12 cases 모두 통과.
- `src/pages/WorkspacePage.test.tsx` — 동일 spy 패턴 변경 2 곳. 11 cases 모두 통과.

### Checks Run

- `pnpm vitest run src/hooks/useConnectionSessionHydration.test.ts`: pass (4/4)
- `pnpm vitest run src/stores/connectionStore.test.ts`: pass (42/42)
- `pnpm vitest run src/hooks/useWindowFocusHydration.test.ts`: pass (12/12)
- `pnpm vitest run src/__tests__/cross-window-connection-sync.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx`: pass (15/15)
- `pnpm vitest run src/hooks/useConnectionMutations.test.ts src/hooks/useConnectionLifecycle.test.ts src/hooks/useSchemaTableMutations.test.ts src/hooks/useSchemaCache.test.ts src/stores/schemaStore.test.ts`: pass (50/50)
- `pnpm vitest run` (full suite): pass (2728/2728, 214 files)
- `pnpm tsc --noEmit`: pass
- `pnpm lint`: pass
- `git diff --stat src/stores/connectionStore.ts`: -15 / +3 (delete count ≥ 10)
- `grep Pick<ConnectionState, src/stores/connectionStore.ts`: 0
- `grep persistActiveStatuses(get().activeStatuses) src/stores/connectionStore.ts`: 2
- `grep persistFocusedConnId(id) src/stores/connectionStore.ts`: 1
- `grep attachZustandIpcBridge<ConnectionState> src/stores/connectionStore.ts`: 1
- SYNCED_KEYS array values: byte-equivalent (multi-line, untouched in diff)
- `test -f` module + module test: both pass
- `^export function hydrateConnectionSession`: 1
- `^export function useConnectionSessionHydration`: 1
- `hydrateConnectionSession\b` across src/: 33 (across 7 files)
- `getState().hydrateFromSession()` outside store file: 0 code calls (3 doc comments only)
- 2 verbatim case names — store test: 0, module test: 4
- sibling diff: all 0 (Sprint 219/223 freeze + lib + schemaStore + cross-window tests)
- module purity (no effect/listener/timer/subscribe/addEventListener): 0 matches
- new `eslint-disable*` / new `any` in module / `it.only` / `it.skip`: 0

### Done Criteria Coverage

- AC-01 (store body shrink): pass — 13 LOC → 1 LOC, -15 / +3 diff, no `Pick<ConnectionState,`.
- AC-02 (module + 2 exports): pass — `hydrateConnectionSession` + `useConnectionSessionHydration` both named exports, 0 effects/listeners.
- AC-03 (module test ≥ 2 case): pass — 4 cases (2 verbatim migration + 2 edge), `vi.hoisted` + factory mock pattern.
- AC-04 (caller swap): pass — main.tsx + useWindowFocusHydration.ts both swapped to plain function call; 0 actual code calls of `getState().hydrateFromSession()` outside store file.
- AC-05 (invariants): pass — persist 3 site grep verbatim 2/1; IPC bridge attach grep 1; SYNCED_KEYS array body byte-equivalent; sibling diff 0; cross-window regression 15/15; `ConnectionState.hydrateFromSession: () => void` signature preserved.

### Assumptions

- Option C export shape (plain function + hook wrap), spec-recommended.
- Store thin-proxy `hydrateFromSession: () => hydrateConnectionSession()` preserves interface signature byte-equivalent.
- ESM lazy function-body evaluation handles `connectionStore.ts` ↔ `useConnectionSessionHydration.ts` circular import safely (verified via tsc + full vitest pass).
- `useWindowFocusHydration.test.ts` + `WorkspacePage.test.tsx` were NOT in the freeze list — modified to use the new spy pattern (mock module + `vi.importActual` + `vi.fn(actual.hydrateConnectionSession)`). All 23 cases (12 + 11) pass byte-equivalent.

### Residual Risk

- None of P1/P2 severity. Behavioural byte-equivalence verified via 22 contract checks + cross-window regression + Sprint 219/223 sibling test suites all pass. Cosmetic circular import is safe under ESM lazy evaluation.
