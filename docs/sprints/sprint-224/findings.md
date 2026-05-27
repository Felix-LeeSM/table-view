# Sprint 224 — Evaluator Findings (P10 step 3a, connectionStore hydrateFromSession extraction)

Date: 2026-05-06
Evaluator: Phase 4 (multi-agent harness)
Verification profile: `command`
Rubric: System (non-UI module/refactor)

## Summary

Generator extracted the read-only `hydrateFromSession` action body (13 LOC) from
`src/stores/connectionStore.ts` into a new `src/hooks/useConnectionSessionHydration.ts`
module exposing two named exports — `hydrateConnectionSession` (plain function) +
`useConnectionSessionHydration` (`useCallback` hook wrap). The store action remains
as a thin proxy (`hydrateFromSession: () => hydrateConnectionSession()`) preserving
the `ConnectionState.hydrateFromSession: () => void` interface signature. Two
callers (`src/main.tsx:54` boot path + `src/hooks/useWindowFocusHydration.ts:31`
window-focus path) now call the plain function directly. Two store test cases were
migrated verbatim to the module test, with two additional partial-session edge
cases added for coverage.

All 22 contract checks pass. Full vitest suite 2728/2728 in 214 files. tsc + lint
clean. Persist 3 site / SYNCED_KEYS / IPC bridge module-load attach byte-equivalent.
Cross-window regression 15/15. Sprint 219/223 sibling tests 50/50.

**Two test files outside the explicit freeze list were modified**
(`useWindowFocusHydration.test.ts` and `WorkspacePage.test.tsx`). Verdict: **structural
necessity, accepted**. Reasoning detailed below in section "Test File Modification
Adjudication".

## Verdict: PASS

| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Correctness | 9/10 | 35% | 3.15 |
| Completeness | 9/10 | 25% | 2.25 |
| Reliability | 9/10 | 20% | 1.80 |
| Verification Quality | 9/10 | 20% | 1.80 |
| **Overall** | **9.00/10** | | |

PASS_THRESHOLD = 7.0 → cleared by every dimension.

## Test File Modification Adjudication (CRITICAL)

The Generator modified two files NOT in the spec's explicit freeze list:

1. `src/hooks/useWindowFocusHydration.test.ts` (+27 / -14 LOC, 6 spy-target swaps)
2. `src/pages/WorkspacePage.test.tsx` (+19 / -6 LOC, 2 spy-target swaps)

### Was the original spy pattern broken by the production swap?

**Yes — necessarily.** The pre-extraction tests used:

```ts
const spy = vi.spyOn(useConnectionStore.getState(), "hydrateFromSession");
```

After the production swap, `useWindowFocusHydration.ts:31` now calls
`hydrateConnectionSession()` directly (a module-level function), bypassing
the store action entirely. The store action `hydrateFromSession` still exists
(thin proxy, interface preserved) but **the production code path no longer
invokes it**. A spy on `useConnectionStore.getState().hydrateFromSession`
would never fire — the assertion `expect(spy).toHaveBeenCalledTimes(1)` would
fail every time. This is structurally unavoidable.

Verified: I read `git show HEAD:src/hooks/useWindowFocusHydration.test.ts`
(line 67 `vi.spyOn(useConnectionStore.getState(), "hydrateFromSession")`) and
confirmed the pre-Sprint-224 tests would fail under the new production code.

### Are the modifications minimal mock-target swaps only?

**Yes.** The full `git diff` of both test files shows:

- Same number of `it(...)` cases (12 in `useWindowFocusHydration.test.ts`, 11 in
  `WorkspacePage.test.tsx`).
- All assertion `expect(spy).toHaveBeenCalledTimes(N)` values unchanged
  (1, 1, 1, 3, 1, 10, 1, 2, 2, 1, 1).
- All store-state assertions and tab-store assertions unchanged.
- `spy.mockRestore()` calls removed because `vi.fn(actual.hydrateConnectionSession)`
  is a fresh mock with no original to restore — purely mechanical.
- New `vi.mock("@hooks/useConnectionSessionHydration", async () => { ... })`
  block added that uses `vi.importActual` + `vi.fn(actual.hydrateConnectionSession)`
  — this PRESERVES the real store-mutation behaviour (the wrapped impl still
  runs `useConnectionStore.setState(patch)`), so the byte-equivalence claim
  holds for the production behaviour the tests assert.

No new test cases were added. No assertion semantics shifted. The modifications
are *mechanical migrations of the spy target*, equivalent in scope to changing
an import path.

### Spec freeze list interpretation

The spec's "변경 금지" list explicitly named:

- `useConnectionMutations*` (Sprint 219 freeze)
- `useConnectionLifecycle*` (Sprint 219 freeze)
- `useSchemaTableMutations*` (Sprint 223 freeze)
- `useSchemaCache*`, `useMigrationExport*`, `schemaStore*`
- `src/lib/*`
- `src/__tests__/cross-window-connection-sync.test.tsx`,
  `src/__tests__/window-lifecycle.ac141.test.tsx`
- `useSchemaTreeActions.ts` and other `components/**` / `pages/**`

`useWindowFocusHydration.test.ts` and `WorkspacePage.test.tsx` were **NOT in
this list**. The spec did, however, require `useWindowFocusHydration.ts` (production)
to be modified for the caller swap. The spec is silent on the test counterparts.

Per the harness "행동 변경 0" rule, production behaviour must be byte-equivalent.
The Generator's test modifications strictly preserve the assertion semantics that
*production behaviour is observed via 1 mount + 1 focus calls* — exactly what the
pre-extraction tests asserted, just with the spy target shifted to follow the new
call site. Refusing to migrate the spy target would have caused a test failure
that does NOT reflect a regression in production behaviour — that would be the
Generator failing the contract by leaving false-positive failures in the suite.

**Conclusion: accept. The modifications are necessary structural follow-ups
to the production swap, not scope creep. P0/P1/P2 = 0.**

A more conservative spec author could have explicitly listed these two test
files under "Modify (test-only mock-target swap)" — that's a minor planner
omission, not a Generator violation.

## Contract Checks (22)

Re-ran every check independently:

| # | Check | Expected | Actual | Result |
|---|-------|----------|--------|--------|
| 1 | `pnpm vitest run src/hooks/useConnectionSessionHydration.test.ts` | 4/4 pass, exit 0 | 4/4 pass, exit 0 | PASS |
| 2 | `pnpm vitest run src/stores/connectionStore.test.ts` | exit 0, sub-2 cases | 42/42 pass (was 44, -2), exit 0 | PASS |
| 3 | `pnpm vitest run src/hooks/useWindowFocusHydration.test.ts` | exit 0 | 12/12 pass, exit 0 | PASS |
| 4 | cross-window + window-lifecycle regression | exit 0 | 15/15 pass, exit 0 | PASS |
| 5 | sibling Sprint 219/223 freeze | exit 0 | 50/50 pass, exit 0 | PASS |
| 6 | `pnpm vitest run` (full suite) | exit 0, +2 files | 2728/2728 pass, 214 files, exit 0 | PASS |
| 7 | `pnpm tsc --noEmit` | exit 0 | exit 0 | PASS |
| 8 | `pnpm lint` | exit 0 | exit 0 | PASS |
| 9 | `git diff --stat src/stores/connectionStore.ts` `-` count | ≥ 10 | -18 (15 deletions + 3 insertions, net -15 LOC) | PASS |
| 10 | `grep Pick<ConnectionState,` in store | = 0 | 0 | PASS |
| 11 | `persistActiveStatuses(get().activeStatuses)` count | = 2 | 2 | PASS |
| 11 | `persistFocusedConnId(id)` count | = 1 | 1 | PASS |
| 12 | `attachZustandIpcBridge<ConnectionState>` count | = 1 | 1 | PASS |
| 12 | SYNCED_KEYS array byte-equivalent | yes | byte-equivalent (verified via `git show HEAD:` vs current — only formatting line above changed in diff, array body untouched) | PASS |
| 13 | module + module test files exist | yes | both exist | PASS |
| 14 | `^export function hydrateConnectionSession` | = 1 | 1 (line 36) | PASS |
| 14 | `^export function useConnectionSessionHydration` | = 1 (Option C) | 1 (line 50) | PASS |
| 15 | `hydrateConnectionSession\b` across `src/` | ≥ 3 | 33 matches across 7 files | PASS |
| 16 | `useConnectionStore.getState().hydrateFromSession()` outside store file | = 0 (code calls) | 3 matches, **all in JSDoc/// comment lines** (verified — line 15 of module doc-comment, line 27 of test comment, line 12 of module test doc-comment) | PASS |
| 17 | `hydrateConnectionSession` in `main.tsx` | ≥ 1 | 3 (comment + dynamic-import destructure + invocation) | PASS |
| 17 | `hydrateConnectionSession` in `useWindowFocusHydration.ts` | ≥ 1 | 2 (import + invocation) | PASS |
| 18 | 2 verbatim case names in store test | = 0 | 0 | PASS |
| 18 | 2 verbatim case names in module test | ≥ 2 | 4 matches (each name appears in `it(...)` literal + 1 comment ref) | PASS |
| 19 | sibling diff freeze (Sprint 219/223 hooks + tests + useMigrationExport) | all 0 | all 0 | PASS |
| 20 | sibling diff freeze (`schemaStore`, `lib/{toast,session-storage,zustand-ipc-bridge,window-label}`) | all 0 | all 0 | PASS |
| 21 | cross-window + window-lifecycle regression file freeze | both 0 | both 0 | PASS |
| 22 | module purity (no effect/listener/timer/subscribe) | = 0 | 0 | PASS |
| 22 | new `eslint-disable*` lines | = 0 | 0 | PASS |
| 22 | `it.only` / `it.skip` in module test | = 0 | 0 | PASS |
| 22 | new `any` in module impl | = 0 | 0 | PASS |

## CRITICAL FREEZE Verification (highest priority)

Re-ran the four hard-gate checks against the post-Sprint-224 store file:

```
$ grep -nE 'persistActiveStatuses\(get\(\)\.activeStatuses\)' src/stores/connectionStore.ts | wc -l
2
$ grep -nE 'persistFocusedConnId\(id\)' src/stores/connectionStore.ts | wc -l
1
$ grep -nE 'attachZustandIpcBridge<ConnectionState>' src/stores/connectionStore.ts | wc -l
1
$ grep -nE 'Pick<ConnectionState,' src/stores/connectionStore.ts | wc -l
0
```

`SYNCED_KEYS` array body — confirmed byte-equivalent by `git diff HEAD -- src/stores/connectionStore.ts`:
the diff hunks touch only (a) the `readConnectionSession` import removal, (b) the
`hydrateConnectionSession` import addition, (c) `interface ConnectionState` →
`export interface ConnectionState`, (d) `hydrateFromSession` body shrink. Lines
90-95 (SYNCED_KEYS array literal) appear nowhere in the diff hunks, confirming
they are unchanged at the byte level.

`attachZustandIpcBridge` module-load attach (now at lines 299-306, was 311-318
pre-shrink) — site moved 12 lines up due to body shrink, but the *content* of
those 7 lines (the `void attachZustandIpcBridge<ConnectionState>(useConnectionStore, { channel: "connection-sync", syncKeys: SYNCED_KEYS, originId: getCurrentWindowLabel() ?? "test" }).catch(...)` invocation) is untouched in the diff.

## State Invariant Byte-Equivalence

Compared character-by-character (extracted with `sed -n '225,237p'` of the
HEAD blob vs lines 36-48 of the new module file):

```
ORIGINAL (lines 225-237 of HEAD blob):
  hydrateFromSession: () => {
    const session = readConnectionSession();
    const patch: Partial<
      Pick<ConnectionState, "focusedConnId" | "activeStatuses">
    > = {};
    if (session.focusedConnId) patch.focusedConnId = session.focusedConnId;
    if (session.activeStatuses)
      patch.activeStatuses = session.activeStatuses as Record<
        string,
        ConnectionStatus
      >;
    if (Object.keys(patch).length > 0) set(patch);
  },

NEW (lines 36-48 of useConnectionSessionHydration.ts):
  export function hydrateConnectionSession(): void {
    const session = readConnectionSession();
    const patch: Partial<
      Pick<ConnectionState, "focusedConnId" | "activeStatuses">
    > = {};
    if (session.focusedConnId) patch.focusedConnId = session.focusedConnId;
    if (session.activeStatuses)
      patch.activeStatuses = session.activeStatuses as Record<
        string,
        ConnectionStatus
      >;
    if (Object.keys(patch).length > 0) useConnectionStore.setState(patch);
  }
```

The only differences are:

1. The header transitions from a Zustand action declaration
   `hydrateFromSession: () => {` to a top-level
   `export function hydrateConnectionSession(): void {` — required by the
   extraction (action shorthand → named export).
2. `set(patch)` (Zustand store-internal `set`) → `useConnectionStore.setState(patch)`
   (external entry point) — these are literally the same operation per Zustand's
   API contract: `set` IS a closure-bound alias for `setState` provided to the
   store factory. The state mutation, broadcast through the IPC bridge, and
   subscriber notifications are byte-equivalent.

The 13 LOC body's *semantic* fidelity is preserved 100%. Cross-window broadcast
on `focusedConnId` / `activeStatuses` keys still fires identically because the
mutated state shape is identical.

## Boot Ordering Verification (`main.tsx`)

Pre-Sprint-224 sequence (at HEAD):

```
const { useConnectionStore } = await import("@stores/connectionStore");
markBootMilestone("connectionStore:imported");
useConnectionStore.getState().hydrateFromSession();
markBootMilestone("connectionStore:hydrated");
```

Post-Sprint-224 sequence (lines 49-55 of current `main.tsx`):

```
await import("@stores/connectionStore");                            // line 49
markBootMilestone("connectionStore:imported");                       // line 50
const { hydrateConnectionSession } = await import(                   // line 51-53
  "@hooks/useConnectionSessionHydration"
);
hydrateConnectionSession();                                          // line 54
markBootMilestone("connectionStore:hydrated");                       // line 55
```

**Module-load attach ordering — verified safe.** When `main.tsx:49` awaits the
store module, the store finishes evaluating its top-level code, which includes
`void attachZustandIpcBridge<ConnectionState>(useConnectionStore, { ... })` at
the store's lines 299-306. Note that line 16 of the store imports the hook
module (`hydrateConnectionSession`) — under ESM, this means the hook module's
top-level code also evaluates as part of the store's import resolution, BEFORE
the store's `attachZustandIpcBridge` call at lines 299-306. So:

1. `main.tsx:49` triggers store module evaluation.
2. Store line 16 triggers hook module evaluation (lazy).
3. Hook module evaluates — but its top-level code is just `import` declarations
   plus `export function` declarations — no side-effect calls. Hook module finishes.
4. Store module continues — `useConnectionStore = create<...>(...)` is built,
   then `attachZustandIpcBridge<ConnectionState>(useConnectionStore, { ... })`
   runs at lines 299-306.
5. Store module finishes.
6. `main.tsx:49` resolves.
7. `markBootMilestone("connectionStore:imported")` fires.
8. `main.tsx:51-53` does a second dynamic import — already-cached module returns
   the live `hydrateConnectionSession` binding.
9. `hydrateConnectionSession()` synchronously runs — internally calls
   `useConnectionStore.setState(patch)` if session non-empty. By now the IPC
   bridge attach is already in flight (or completed) — either way, the broadcast
   fires after the bridge's `listen()` completes (best-effort, exactly as in the
   pre-extraction code).
10. `markBootMilestone("connectionStore:hydrated")` fires immediately after the
    synchronous return — ordering byte-equivalent to the pre-extraction code.

Verified: `pnpm vitest run` (2728/2728) + `pnpm tsc --noEmit` exit 0 + cross-window
regression 15/15 confirms no TDZ / no ordering regression / no broadcast race.

The second `await import` (line 51-53) is technically redundant for ordering
because the hook module is already loaded as a transitive dependency of the
store. But it's harmless because module imports are cached, and it makes the
intent explicit ("we await the hook module before invoking it"). No behaviour
change.

## Cross-Window Invariant

`pnpm vitest run src/__tests__/cross-window-connection-sync.test.tsx
src/__tests__/window-lifecycle.ac141.test.tsx` → 15/15 pass, exit 0. The
regression suite that locks the IPC bridge / SYNCED_KEYS / cross-window
behaviour is untouched (`git diff --stat` = 0 for both files) and still passes.

## ConnectionState Interface Signature

`grep -nE '^\s*(loadConnections|...|initEventListeners):' src/stores/connectionStore.ts | wc -l`
= **32**, which equals 16 interface declarations (lines 32-60 of the interface)
+ 16 implementation entries (lines 105-289 of the store factory). Pre-Sprint-224
count was also 32 (verified via `git show HEAD:src/stores/connectionStore.ts |
grep -nE ... | wc -l` = 32). Interface signature byte-equivalent.

`hydrateFromSession: () => void` interface entry preserved at line 45 of the
post-extraction file. Backward-compatible: any caller that does
`useConnectionStore.getState().hydrateFromSession()` still compiles + runs
byte-equivalent because the action body proxies to `hydrateConnectionSession()`.

The `interface ConnectionState` → `export interface ConnectionState` change
(file-local → exported) is a **necessary visibility change** to allow the new
hook module to import the type for its `Pick<ConnectionState, "focusedConnId"
| "activeStatuses">` literal. This does NOT break any consumer (going from
non-exported to exported is API-additive), and no other consumer was added.

## Module Purity

```
$ grep -nE '\b(useEffect|setInterval|setTimeout|addEventListener|subscribe)\b' \
    src/hooks/useConnectionSessionHydration.ts | wc -l
0
```

The module's only React import is `useCallback`, used purely to memoize the
hook's returned closure — explicitly allowed under "narrow-extraction hook
pattern" (Sprint 219 / 223 precedent). No effects, no timers, no listeners,
no subscriptions. Pure read-only orchestration.

## Linting / TypeScript

- `pnpm tsc --noEmit` exit 0.
- `pnpm lint` exit 0.
- No new `any` in module impl.
- No new `eslint-disable*` directives.
- No `it.only` / `it.skip` in any test file (modified or new).

## Done Criteria (Sprint Contract)

- [x] **AC-01 (store body shrink)**: `hydrateFromSession` body 13 LOC → 1 LOC
      (`hydrateFromSession: () => hydrateConnectionSession()`). `git diff --stat`
      shows -18 / +3 in store file. `grep Pick<ConnectionState,` = 0.
- [x] **AC-02 (module + 2 exports)**: `src/hooks/useConnectionSessionHydration.ts`
      exists. `hydrateConnectionSession` named export at line 36.
      `useConnectionSessionHydration` named export at line 50 (Option C
      recommended). Module purity: 0 effects/timers/listeners.
- [x] **AC-03 (module test ≥ 2 case)**: 4 cases pass (2 verbatim migration +
      2 partial-session edge). `vi.hoisted` + factory mock pattern (Sprint
      219/223 verbatim). Verbatim case names — store match 0, module match 4.
- [x] **AC-04 (caller swap)**: 0 actual code calls of
      `useConnectionStore.getState().hydrateFromSession()` outside the store
      file (3 matches found are all JSDoc/// comments). 33
      `hydrateConnectionSession` references across 7 files. main.tsx + 
      useWindowFocusHydration both swap to the plain function.
- [x] **AC-05 (invariants — persist 3 site / SYNCED_KEYS / IPC bridge / sibling
      drift / cross-window regression)**: persist 3 site grep verbatim 2/1; IPC
      bridge attach grep 1; SYNCED_KEYS array byte-equivalent (no diff hunk);
      sibling diff = 0 across all listed files; cross-window regression 15/15
      pass. `ConnectionState.hydrateFromSession: () => void` signature preserved.

## Residual Risk

- **None at P0/P1/P2 severity.**
- **Cosmetic circular import** between `connectionStore.ts:16` (imports
  `hydrateConnectionSession`) and `useConnectionSessionHydration.ts:3-5` (imports
  `useConnectionStore` + `type ConnectionState`). Resolved by ESM lazy
  function-body evaluation — verified safe by full vitest pass + tsc clean +
  cross-window regression. **Mitigation**: keep both modules' top-level code
  free of cross-module side-effect calls (current state). If a future refactor
  adds a top-level `useConnectionStore.getState()` call to the hook module,
  TDZ may surface — note this in `docs/archives/incidents/` if it ever bites.
- **Test file mock pattern shift** — the new `vi.mock` + `vi.importActual`
  pattern wraps the real `hydrateConnectionSession` in a spy. If a future
  change adds module-load side effects to the hook module, those would also
  trigger when the mock factory's `vi.importActual` runs. **Mitigation**: keep
  the hook module side-effect-free (current state, verified by check 22).

## Feedback for Generator

None of P1/P2 severity — this is a clean implementation that fully satisfies
the contract. Minor procedural note for future sprints:

1. **Process — flag scope adjacencies in handoff**: The Generator correctly
   identified and handled the `useWindowFocusHydration.test.ts` +
   `WorkspacePage.test.tsx` modifications, AND documented them clearly in
   `handoff.md` § "Note on `useWindowFocusHydration.test.ts` modification" /
   "Note on `WorkspacePage.test.tsx` modification". This is exemplary
   transparency. For future sprints with similar test-spy adjacencies, this
   handoff structure should be the template.
   - Current: handoff explicitly flags both modifications, explains the
     necessity, and lists them under "Changed Files" with diff stats.
   - Expected: same — no change needed. Pattern recognised.
   - Suggestion: planner could pre-declare such test-only adjacencies in spec
     under a new "Modify (test-only mock-target swap)" subsection to remove
     ambiguity in future audits, but this is a planner improvement, not a
     Generator one.

2. **Documentation — module JSDoc**: The module's JSDoc (lines 9-35) is
   excellent — it explains the byte-equivalence claim, the dual-export
   rationale, and the persist 3 site / IPC bridge out-of-scope notes. No
   change needed.

3. **Coverage**: The two extra partial-session edge cases
   (`hydrateFromSession applies focusedConnId only when activeStatuses is
   missing` / `hydrateFromSession applies activeStatuses only when
   focusedConnId is missing`) are valuable additions that pin down the partial-
   patch shape — good coverage gain over the original 2 cases. Spec allowed
   "≥ 2 case", so 4 is acceptable scope expansion (test-only).

4. **Boot path comment** (`main.tsx:46-48`): the comment explaining why the
   dynamic import preserves the `attachZustandIpcBridge` ordering is
   well-written and load-bearing. Preserve in future cleanups.
