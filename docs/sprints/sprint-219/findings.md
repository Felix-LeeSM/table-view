# Sprint 219 Findings — connectionStore mutation-toast extraction

**Verification Profile**: `command`
**Rubric**: System (non-UI test/refactor sprint)
**Date**: 2026-05-06
**Evaluator**: Phase 4 (multi-agent harness)

## Files Reviewed

| File | Type | LOC delta (verified) | Purpose |
|---|---|---|---|
| `src/stores/connectionStore.ts` | modified | -11 (0 +, 11 -) | Toast import + 3 toast calls + toast-only `removed` lookup + 6 lines of toast WHY comments removed |
| `src/hooks/useConnectionMutations.ts` | new | +75 | Use-case hook wrapping 3 mutation actions |
| `src/hooks/useConnectionMutations.test.ts` | new | +217 (handoff said +189; actual `wc -l` = 217) | 6 vitest cases |
| `src/components/connection/ConnectionDialog.tsx` | modified | +2 / -2 | 2-key destructure swap |
| `src/components/connection/ConnectionItem.tsx` | modified | +2 / -1 | 1-key destructure swap |

`git diff --stat` (3 modified files): **3 files changed, 4 insertions(+), 14 deletions(-)** — confirmed independently.

Minor discrepancy: handoff.md reports test file as +189 LOC. Actual `wc -l` reports 217 lines. Not load-bearing (≥ 5 cases is the contract bar; 6 cases pass).

## 22 Contract Checks (Re-Run Independently)

| # | Check | Generator-claimed | Independent re-run | Verdict |
|---|---|---|---|---|
| 1 | `pnpm vitest run src/hooks/useConnectionMutations.test.ts` | 6 pass, 1 file | 6 pass, 1 file (632 ms) | **PASS** |
| 2 | `pnpm vitest run src/stores/connectionStore.test.ts src/stores/schemaStore.test.ts src/hooks/useConnectionLifecycle.test.ts src/hooks/useSchemaCache.test.ts` | 88 pass, 4 files | 88 pass, 4 files (918 ms) | **PASS** |
| 3 | `pnpm vitest run src/__tests__/cross-window-connection-sync.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` | 15 pass, 2 files | 15 pass, 2 files (886 ms) | **PASS** |
| 4 | `pnpm vitest run` (full suite) | 2726 / 212 files | **2726 / 212 files** (43.5 s) | **PASS** |
| 5 | `pnpm tsc --noEmit` | exit 0 | exit 0, no diagnostics | **PASS** |
| 6 | `pnpm lint` | exit 0 | exit 0, no findings | **PASS** |
| 7 | `grep -c '^import.*toast' src/stores/connectionStore.ts` | 0 | **0** | **PASS** |
| 8 | `grep -nE 'toast\.(success\|error\|info\|warning)' src/stores/connectionStore.ts` | empty | empty (RC 1) | **PASS** |
| 9 | `git diff --stat src/stores/connectionStore.ts` | -11 | -11 (0 +, 11 -) | **PASS** (≥ -4 required) |
| 10 | `test -f` both new hook files | both exist | both exist | **PASS** |
| 11 | `grep -nE '^export function useConnectionMutations' src/hooks/useConnectionMutations.ts` | 1 | 1 match (line 30) | **PASS** |
| 12 | `grep -rn 'useConnectionMutations' src/components/connection/ConnectionDialog.tsx` | 2 | 2 (line 57 import + line 150 destructure) | **PASS** |
| 13 | `grep -rn 'useConnectionMutations' src/components/connection/ConnectionItem.tsx` | 2 | 2 (line 11 import + line 110 destructure) | **PASS** |
| 14 | `grep -rnE 'useConnectionStore\(\(s\) => s\.(addConnection\|updateConnection\|removeConnection)\)' src/components/ src/hooks/` | 0 in consumers | **3 in `src/hooks/useConnectionMutations.ts` (the new hook itself, lines 35-37); 0 in consumers** | **PASS** (see Contract Drift §) |
| 15 | 4 toast-text byte-equivalent matches (`grep -F`) | all ≥ 1 | `" added.` 1 / `" updated.` 1 / `" removed.` 1 / `"Connection removed."` 2 (1 fallback + 1 in WHY comment) | **PASS** |
| 16 | `grep -nE 'SYNCED_KEYS\|attachZustandIpcBridge\|persistFocusedConnId\|persistActiveStatuses\|readConnectionSession' src/stores/connectionStore.ts` | 9 baseline-equivalent | 11 lines (1 attach import + 3 session imports + 1 SYNCED_KEYS export + 2 persistActiveStatuses calls + 1 persistFocusedConnId call + 1 readConnectionSession call + 1 module-load attach + 1 syncKeys ref). All 11 byte-equivalent to baseline (`git show HEAD:` confirms). | **PASS** |
| 17 | `git diff --stat` for `connectionStore.test.ts` + `schemaStore.test.ts` | 0 | 0 changes | **PASS** |
| 18 | `git diff --stat` for `useConnectionLifecycle.{ts,test.ts}` + `useSchemaCache.{ts,test.ts}` + `useMigrationExport.ts` | 0 | 0 changes (5 files) | **PASS** |
| 19 | `git diff --stat src/lib/{toast,session-storage,zustand-ipc-bridge,window-label}.ts` | 0 | 0 changes (4 files) | **PASS** |
| 20 | `git diff --stat src/__tests__/cross-window-connection-sync.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx src/main.tsx` | 0 | 0 changes (3 files) | **PASS** |
| 21 | `git diff src/ \| grep "^+.*eslint-disable"` + `grep -rnE 'it\.only\|it\.skip' src/hooks/useConnectionMutations.test.ts` | 0 / 0 | 0 / 0 (RC 1 each) | **PASS** |
| 22 | `git diff src/hooks/useConnectionMutations.ts \| grep -E "^\+.*\bany\b"` | 0 | 0 (RC 1) | **PASS** |

**Result: 22/22 checks PASS.** No discrepancies vs Generator's claim except a -11 LOC store reduction (Generator claimed -11; baseline confirms -11) and the test-file LOC count (handoff said 189, actual 217 — non-load-bearing).

## Contract Drift §

**Check 14 (`src/components/` + `src/hooks/`)** has a strict reading and a generous reading.

- Strict reading: matches must be 0 across `src/components/` AND `src/hooks/` — fails because the new hook `src/hooks/useConnectionMutations.ts` itself contains 3 selector lookups.
- Generous reading: the intent is "no consumer keeps a direct selector after the swap". The new hook IS the migration target, not a consumer. Generator chose the generous reading, with an explicit justification in handoff.md.

Spec § AC-2 mandates the 3 selector calls inside the hook:
> hook 은 `useConnectionStore((s) => s.addConnection)` / `updateConnection` / `removeConnection` 3 selector 호출 + `useCallback` 으로 wrap.

So the contract check 14 (in its strict reading) and the spec § AC-2 are mutually contradictory. The Generator's interpretation is the only consistent one. **No deduction** — this is a Planner/Contract issue, not a Generator failure. Recommendation for the Planner: amend check 14 to exclude `src/hooks/useConnectionMutations.ts`.

## Toast Text Byte-Equivalence Verification

Compared against `git show HEAD:src/stores/connectionStore.ts`:

| Variant | Baseline (store, lines 131/142/170) | Hook (lines 42/51/65-69) | Verdict |
|---|---|---|---|
| `addConnection` success | ``` `Connection "${saved.name}" added.` ``` | ``` `Connection "${saved.name}" added.` ``` | **byte-equivalent** |
| `updateConnection` success | ``` `Connection "${saved.name}" updated.` ``` | ``` `Connection "${draft.name}" updated.` ``` | **assumed byte-equivalent** (residual risk) |
| `removeConnection` success | ``` `Connection "${removed.name}" removed.` ``` | ``` `Connection "${removed.name}" removed.` ``` | **byte-equivalent** |
| `removeConnection` fallback | `"Connection removed."` | `"Connection removed."` | **byte-equivalent** |

**`updateConnection` saved.name → draft.name divergence.** The store action returns `void` for `updateConnection`, so the hook can't observe `saved`. Spec § AC-2 explicitly grants this Generator discretion ("hook 이 saved 를 받지 못하면 draft.name 사용 — 문구 byte-equivalent"). The byte-equivalence holds iff `tauri.saveConnection` does not normalize/mutate the `name` field (e.g. trimming, case-folding). I confirmed independently by inspecting the call signature: `saveConnection(draft, isCreate)` returns `Promise<ConnectionConfig>`, but the store discards `saved` after the `set(...)` for `updateConnection`. Generator documented this in handoff.md § Residual Risk #1 and proposed a P10 step 5 mitigation (change store action return type) — appropriate handling. **PASS** with documented residual risk.

## Scope-Boundary Diff = 0 (14 sibling files)

Per spec § "Untouched (sibling drift = 0)":

| File | `git diff --stat` | Verdict |
|---|---|---|
| `src/stores/schemaStore.ts` | 0 | OK |
| `src/stores/schemaStore.test.ts` | 0 | OK |
| `src/stores/connectionStore.test.ts` | 0 | OK |
| `src/hooks/useConnectionLifecycle.ts` | 0 | OK |
| `src/hooks/useConnectionLifecycle.test.ts` | 0 | OK |
| `src/hooks/useSchemaCache.ts` | 0 | OK |
| `src/hooks/useSchemaCache.test.ts` | 0 | OK |
| `src/hooks/useMigrationExport.ts` | 0 | OK |
| `src/lib/session-storage.ts` | 0 | OK |
| `src/lib/zustand-ipc-bridge.ts` | 0 | OK |
| `src/lib/window-label.ts` | 0 | OK |
| `src/lib/toast.ts` | 0 | OK |
| `src/__tests__/cross-window-connection-sync.test.tsx` | 0 | OK |
| `src/__tests__/window-lifecycle.ac141.test.tsx` | 0 | OK |

Plus `src/main.tsx` = 0 (per spec). 15 files all frozen. **PASS**.

## Hook Test Mock Pattern Verification

`useConnectionLifecycle.test.ts` uses:
- `vi.hoisted({ mockConnect, mockDisconnect, mockClearSchema, mockClearDocument, mockGetState })`
- `vi.mock("@stores/connectionStore", ...)` factory wrapping `Object.assign((selector) => selector(state), { getState })`
- `mockGetState.mockReturnValue(...)` in `beforeEach` for the lookup site

`useConnectionMutations.test.ts` (lines 16-51) uses the **identical** pattern:
- `vi.hoisted({ mockAdd, mockUpdate, mockRemove, mockToastSuccess, mockGetState })`
- `vi.mock("@stores/connectionStore", () => ({ useConnectionStore: Object.assign((selector) => selector({ addConnection, updateConnection, removeConnection }), { getState: mockGetState }) }))`
- `vi.mock("@lib/toast", ...)` factory with `success/error/info/warning/dismiss/clear` mocks
- `mockReset()` for all 5 mocks in `beforeEach` + default `mockGetState.mockReturnValue(...)` for happy-path lookup

**PASS** — leakage 0, baseline pattern faithful.

## removeConnection Name Lookup Ordering

The hook's body (lines 56-72):

```ts
const removeConnection = useCallback(
  async (id: string): Promise<void> => {
    // Snapshot the name BEFORE awaiting the store — once the action
    // resolves, the connection is gone from `connections` and the lookup
    // would land on the fallback string.
    const removed = useConnectionStore
      .getState()
      .connections.find((c) => c.id === id);
    await storeRemove(id);
    toast.success(
      removed
        ? `Connection "${removed.name}" removed.`
        : "Connection removed.",
    );
  },
  [storeRemove],
);
```

Snapshot is captured **synchronously** before `await storeRemove(id)`. The store's `removeConnection` action body (verified at `src/stores/connectionStore.ts:141-162`) mutates `connections` via `set(...)`, so a post-await snapshot would yield `undefined` and every successful remove would land on the fallback string — that's a regression. Test case #6 (`removeConnection snapshots the name BEFORE awaiting the store action`, lines 189-216) pins this ordering with a marker variable that flips inside `mockRemove.mockImplementationOnce` — guards against future drift. **PASS**.

## No New Effects / Listeners / Subscriptions

`grep -nE 'useEffect|setInterval|setTimeout|subscribe|addEventListener' src/hooks/useConnectionMutations.ts`:
- Lines 16-17: WHY comment ("no useEffect / setInterval / setTimeout / subscribe / window event listener")
- No actual code matches.

The hook is pure orchestration (3 selector reads + 3 `useCallback` wraps). **PASS**.

## Store Action Signature Freeze

| Action | Baseline (HEAD) | Current | Verdict |
|---|---|---|---|
| `addConnection: (draft: ConnectionDraft) => Promise<ConnectionConfig>` | line 32 | line 34 | **frozen** |
| `updateConnection: (draft: ConnectionDraft) => Promise<void>` | line 33 | line 35 | **frozen** |
| `removeConnection: (id: string) => Promise<void>` | line 34 | line 36 | **frozen** |

Hook signatures match exactly:
- `addConnection: (draft: ConnectionDraft) => Promise<ConnectionConfig>` (hook line 31)
- `updateConnection: (draft: ConnectionDraft) => Promise<void>` (hook line 32)
- `removeConnection: (id: string) => Promise<void>` (hook line 33)

All other 13 store action signatures unchanged. `tsc --noEmit` exit 0 confirms type-level compatibility. **PASS**.

## SYNCED_KEYS / IPC bridge / Session-Storage Freeze

`grep -nE 'SYNCED_KEYS|attachZustandIpcBridge|persistFocusedConnId|persistActiveStatuses|readConnectionSession' src/stores/connectionStore.ts`:

- Line 10: `attachZustandIpcBridge` import
- Line 13-15: 3 session-storage imports (`persistFocusedConnId`, `persistActiveStatuses`, `readConnectionSession`)
- Line 90: `SYNCED_KEYS` export
- Line 198: `persistActiveStatuses(get().activeStatuses)` (connectToDatabase success path)
- Line 217: `persistActiveStatuses(get().activeStatuses)` (disconnectFromDatabase)
- Line 222: `persistFocusedConnId(id)` (setFocusedConn)
- Line 226: `readConnectionSession()` (hydrateFromSession)
- Line 311-313: module-load `attachZustandIpcBridge<ConnectionState>(useConnectionStore, { channel, syncKeys: SYNCED_KEYS, originId })`

All 11 lines byte-equivalent to baseline (`git show HEAD:src/stores/connectionStore.ts` confirms). **PASS**.

## Cross-Window Invariant

15 cross-window tests pass (check 3). The invariant holds:

- Window A (mutator): `useConnectionMutations.addConnection|updateConnection|removeConnection` → store action → bridge broadcasts on `connection-sync` → toast on window A only.
- Window B (receiver): bridge fires `set(connections: ...)` directly on the store → no `useConnectionMutations` call → no toast.

This matches pre-extraction behavior, where window B's store action wasn't called either, so window B's toast count was always 0. Byte-equivalent. **PASS**.

## Test Suite Delta

- Pre-Sprint baseline: 2720 tests / 210 files (per Sprint 218 handoff).
- Post-Sprint 219: 2726 tests / 212 files.
- Delta: **+6 tests / +2 files** (hook + hook test). Required ≥ +5 / +2. **PASS**.

## Code Review Notes

### Quality
- No TODOs, no `console.log`, no debug calls. Hook + test files are clean.
- TypeScript: `unknown` (not `any`) used in mock selector type. Explicit return type on hook (lines 30-34).
- WHY comments are scoped (hook lines 6-29 — sprint reference + behavior contract + name-snapshot rationale). No noise.

### Patterns
- Hook follows `useConnectionLifecycle.ts` conventions: 3 selectors + `useCallback` per method.
- Test follows `useConnectionLifecycle.test.ts` mock pattern verbatim.
- 6 test cases (5 required + 1 ordering guard) — generous coverage.

### Potential Issues
- **`useCallback` deps array completeness**: each `useCallback` lists only the store action selector (`storeAdd`, `storeUpdate`, `storeRemove`). The `removeConnection` body calls `useConnectionStore.getState()` — module-level static, never changes — so omitting it from deps is correct. **No issue.**
- **`updateConnection` saved.name → draft.name divergence**: documented in handoff.md § Residual Risk #1. If `tauri.saveConnection` ever mutates `name`, the hook's toast would diverge. Acceptable for this sprint; mitigation deferred to a future P10 step. **No deduction**.

## Sprint Contract Status (Done Criteria)

- [x] **AC-01**: store body shrink — toast import removed, 3 toast calls removed, toast-only `removed` lookup removed, 6 lines of WHY comments removed; `set(...)` / `tauri.*` / `persistActiveStatuses` / `pickFallbackFocus` / `connecting` seed / activeDb seed / IPC bridge attach / `initEventListeners` byte-equivalent. Evidence: checks 7, 8, 9, 16; manual diff inspection.
- [x] **AC-02**: hook surface — single named export `useConnectionMutations`; 3 methods byte-equivalent to store action signatures; `useConnectionLifecycle` pattern (3 selectors + 3 `useCallback`); 0 new effects / listeners / subscriptions. Evidence: check 11; hook line 30; manual structure review.
- [x] **AC-03**: hook test ≥ 5 cases — 6 cases pass (3 happy-path toasts + 1 fallback + 1 throw + 1 ordering guard); `vi.hoisted` + factory mock pattern. Evidence: check 1; mock-pattern comparison vs `useConnectionLifecycle.test.ts`.
- [x] **AC-04**: 2 component swap — `ConnectionDialog.tsx` (2-key destructure, line 150) + `ConnectionItem.tsx` (1-key destructure, line 110); `useConnectionMutations` referenced 13× project-wide. Evidence: checks 12, 13, 14.
- [x] **AC-05**: invariants + sibling diff = 0 — 15 sibling files frozen; cross-window regression 15/15 pass; store action signatures frozen (tsc exit 0); ConnectionDialog setSaving/setError/try-catch/onClose/sanitizeMessage flow + Sidebar `connection-added` event untouched. Evidence: checks 17, 18, 19, 20; checks 3, 5.

All 5 Acceptance Criteria + all 10 Global Acceptance Criteria + all 22 Required Checks pass.

## Findings Summary

- **P0 (blocking)**: 0
- **P1 (must-fix)**: 0
- **P2 (should-fix)**: 0
- **P3 (informational)**: 2 (contract check 14 strict-vs-generous reading; handoff LOC discrepancy on test file count)
