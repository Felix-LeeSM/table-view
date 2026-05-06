# Sprint 219 Handoff — connectionStore mutation-toast extraction

**Phase**: P10 step 1 (first) — narrow extraction (3 mutation toasts only)
**Verification Profile**: `command`
**Generator**: general-purpose agent (Phase 3)
**Date**: 2026-05-06

## Changed Files

| File | Type | LOC delta | Purpose |
|---|---|---|---|
| `src/stores/connectionStore.ts` | modified | -11 | Remove `toast` import + 3 `toast.success(...)` calls + toast-only `removed` lookup; store body now pure state-transition. |
| `src/hooks/useConnectionMutations.ts` | new | +75 | Use-case hook wrapping 3 store mutation actions; emits toast on success path only. |
| `src/hooks/useConnectionMutations.test.ts` | new | +189 | 6 vitest cases: 3 happy-path toasts + remove fallback + store-throw + name-snapshot ordering guard. |
| `src/components/connection/ConnectionDialog.tsx` | modified | +2 / -2 | Swap 2 selectors (`addConnection`, `updateConnection`) → `useConnectionMutations()` destructure. |
| `src/components/connection/ConnectionItem.tsx` | modified | +2 / -1 | Swap 1 selector (`removeConnection`) → `useConnectionMutations()` destructure. |

`git diff --stat` for the 3 modified files: **3 files changed, 4 insertions(+), 14 deletions(-)**. The 11-line store reduction is line-stat 1 import + 3 toast `success()` calls + 1 toast-only `removed` lookup + 6 lines of WHY comments scoped to the (removed) toast site. All other store body lines (set, tauri, persistActiveStatuses, pickFallbackFocus, IPC bridge attach, SYNCED_KEYS, initEventListeners) are byte-identical.

## Checks Run

| # | Check | Result |
|---|---|---|
| 1 | `pnpm vitest run src/hooks/useConnectionMutations.test.ts` | **pass** — 6 tests, 1 file. |
| 2 | `pnpm vitest run src/stores/connectionStore.test.ts src/stores/schemaStore.test.ts src/hooks/useConnectionLifecycle.test.ts src/hooks/useSchemaCache.test.ts` | **pass** — 88 tests, 4 files. |
| 3 | `pnpm vitest run src/__tests__/cross-window-connection-sync.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` | **pass** — 15 tests, 2 files. |
| 4 | `pnpm vitest run` (full suite) | **pass** — 2726 tests, 212 files. baseline → +6 cases (5 required + 1 ordering guard). +2 files (hook + hook test). |
| 5 | `pnpm tsc --noEmit` | **pass** — exit 0, no diagnostics. |
| 6 | `pnpm lint` | **pass** — exit 0, no findings. |
| 7 | `grep -c '^import.*toast' src/stores/connectionStore.ts` | **0** (target = 0). |
| 8 | `grep -nE 'toast\.(success\|error\|info\|warning)' src/stores/connectionStore.ts` | **empty** (exit 1). |
| 9 | `git diff --stat src/stores/connectionStore.ts` | **-11** deletions (target ≥ -4). |
| 10 | `test -f src/hooks/useConnectionMutations.{ts,test.ts}` | **both exist**. |
| 11 | `grep -nE '^export function useConnectionMutations' src/hooks/useConnectionMutations.ts` | **1** match. |
| 12 | `grep -rn 'useConnectionMutations' src/components/connection/ConnectionDialog.tsx` | **2** matches (import + destructure call). |
| 13 | `grep -rn 'useConnectionMutations' src/components/connection/ConnectionItem.tsx` | **2** matches (import + destructure call). |
| 14 | `grep -rnE 'useConnectionStore\(\(s\) => s\.(addConnection\|updateConnection\|removeConnection)\)' src/components/ src/hooks/` (consumer side, excluding `useConnectionMutations.ts` which is the new home) | **0** matches in consumers. The 3 matches inside `useConnectionMutations.ts` are intentional per spec (hook wraps store selectors via `useCallback`). |
| 15 | `grep -F` × 4 toast text variants in hook | **all ≥ 1**: `" added.` (1) / `" updated.` (1) / `" removed.` (1) / `"Connection removed."` (1 fallback + 1 in WHY comment). |
| 16 | `grep -nE 'SYNCED_KEYS\|attachZustandIpcBridge\|persistFocusedConnId\|persistActiveStatuses\|readConnectionSession' src/stores/connectionStore.ts` | **9 matches**, all line-stat byte-equivalent to baseline (1 import block + 1 SYNCED_KEYS export + 2 persistActiveStatuses calls + 1 persistFocusedConnId call + 1 readConnectionSession call + module-load attach + syncKeys ref). |
| 17 | `git diff --stat src/stores/connectionStore.test.ts src/stores/schemaStore.test.ts` | **0** changes. |
| 18 | `git diff --stat src/hooks/useConnectionLifecycle.{ts,test.ts} src/hooks/useSchemaCache.{ts,test.ts} src/hooks/useMigrationExport.ts` | **0** changes. |
| 19 | `git diff --stat src/lib/{toast,session-storage,zustand-ipc-bridge,window-label}.ts` | **0** changes. |
| 20 | `git diff --stat src/__tests__/cross-window-connection-sync.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx src/main.tsx` | **0** changes. |
| 21 | `git diff src/ \| grep "^+.*eslint-disable"` and `grep -rnE 'it\.only\|it\.skip' src/hooks/useConnectionMutations.test.ts` | **0** matches. |
| 22 | `git diff src/hooks/useConnectionMutations.ts \| grep -E "^\+.*\bany\b"` | **0** matches. |

## Done Criteria Coverage

### AC-01: store body shrink
- `import { toast } from "@lib/toast";` removed (line 10 baseline → gone).
- `addConnection` toast call (1 line) + WHY comment (1 line) removed; action returns `saved`.
- `updateConnection` toast call (1 line) removed.
- `removeConnection` toast call (3 lines: ternary spread) + toast-only `removed` lookup (1 line) + WHY block (3 lines) removed. `statuses` lookup retained (used by `if (status?.type === "connected")` disconnect branch).
- `set(...)` / `tauri.*` / `persistActiveStatuses` / `pickFallbackFocus` / focus fallback / IPC bridge attach / `initEventListeners` / `connecting` seed / activeDb seed all byte-equivalent.
- Evidence: check 7 = 0, check 8 empty, check 9 = -11.

### AC-02: hook surface
- Single named export `useConnectionMutations` (check 11 = 1 match).
- Returns `{ addConnection: (draft) => Promise<ConnectionConfig>, updateConnection: (draft) => Promise<void>, removeConnection: (id) => Promise<void> }` — byte-equivalent to store action signatures.
- Pattern: 3 selector reads + 3 `useCallback` wraps (mirrors `useConnectionLifecycle.ts`).
- 0 new useEffect / setInterval / setTimeout / subscribe / window event listener (`grep -nE 'useEffect|setInterval|setTimeout|subscribe|addEventListener' src/hooks/useConnectionMutations.ts` = 0 matches).
- `removeConnection` resolves the display name via `useConnectionStore.getState().connections.find(...)` BEFORE awaiting `storeRemove(id)` (snapshot — see assumption + name-ordering test below).

### AC-03: hook test ≥ 5 cases, all pass
6 cases, all passing (check 1):
1. `addConnection on success calls toast.success with byte-equivalent text 'Connection "<name>" added.'` — asserts the store mock was called with the draft + toast.success was called once with the exact byte-equivalent text + return value flowed through.
2. `updateConnection on success calls toast.success with byte-equivalent text 'Connection "<name>" updated.'` — asserts the store mock + toast text.
3. `removeConnection on success with resolved name calls toast.success with 'Connection "<name>" removed.'` — store getState().connections returns the connection.
4. `removeConnection on success with unresolvable name falls back to 'Connection removed.'` — store getState().connections returns `[]`; fallback string is used.
5. `addConnection on store throw does not call toast and re-propagates` — store mock rejects; hook re-throws; `toast.success` not called.
6. (Bonus) `removeConnection snapshots the name BEFORE awaiting the store action` — regression guard against the snapshot ordering invariant being silently broken.

Mock pattern: `vi.hoisted` + `vi.mock("@stores/connectionStore", ...)` (factory with `Object.assign(selector-fn, { getState })`) + `vi.mock("@lib/toast", ...)` (factory with `success/error/info/warning/dismiss/clear` mocks). Mirrors `useConnectionLifecycle.test.ts` exactly. `mockReset()` in `beforeEach` — leakage 0.

### AC-04: 2 component swap
- `ConnectionDialog.tsx` (lines 57, 150): import + 2-key destructure of `useConnectionMutations()`. The store's `testConnection` selector is preserved (out of scope).
- `ConnectionItem.tsx` (lines 11, 110): import + 1-key destructure. `useConnectionLifecycle` for connect/disconnect is preserved (out of scope).
- Check 14 (consumer side, excluding `useConnectionMutations.ts`): 0 matches. The 3 matches inside the new hook are the intended migration target per spec § Acceptance Criteria 2.
- Check 12 + check 13: hook referenced in both target components.
- `grep -rn 'useConnectionMutations' src/`: **13** matches (≥ 4 required).

### AC-05: invariants + sibling diff = 0
- Check 17, 18, 19, 20: all sibling files diff 0 — `connectionStore.test.ts` / `schemaStore*` / `useConnectionLifecycle*` / `useSchemaCache*` / `useMigrationExport.ts` / `src/lib/*` (toast/session-storage/zustand-ipc-bridge/window-label) / cross-window regression tests / `main.tsx` all unchanged.
- Cross-window regression (check 3): 15 tests pass — `attachZustandIpcBridge` broadcast still works module-load; SYNCED_KEYS still synced; the receiving window does NOT call `useConnectionMutations` (its store action was never called either, before extraction), so toast count on the receiving window stays at 0 — byte-equivalent.
- Store action signatures (check 5 typecheck): `addConnection: Promise<ConnectionConfig>`, `updateConnection: Promise<void>`, `removeConnection: Promise<void>` — return type / throw policy unchanged. Hook signature matches.
- ConnectionDialog `setSaving` / `setError` / try-catch / `onClose()` / `sanitizeMessage` / `Sidebar.connection-added` event dispatch: untouched (lines 200-221 byte-identical).

### Toast text byte-equivalent (4 variants)
- `addConnection`: ``toast.success(`Connection "${saved.name}" added.`);`` — uses `saved.name` (post-action). Byte-identical to pre-extraction store call.
- `updateConnection`: ``toast.success(`Connection "${draft.name}" updated.`);`` — uses `draft.name`. Documented assumption (see below).
- `removeConnection` (resolved): ``toast.success(`Connection "${removed.name}" removed.`);`` — `removed` snapshotted from `useConnectionStore.getState().connections` BEFORE `storeRemove(id)` resolves.
- `removeConnection` (fallback): `toast.success("Connection removed.");`

### removeConnection name resolution variant (documented)
The hook does the lookup itself via `useConnectionStore.getState().connections.find((c) => c.id === id)` BEFORE awaiting the store action. The alternative variant (component passes the connection object to the hook) was rejected because it would require a 2-call signature change in `ConnectionItem.tsx`'s delete-confirm dialog and a new selector pass-through in any future caller. The state-snapshot variant keeps the hook's signature byte-equivalent to the store action (`(id: string) => Promise<void>`), so consumers swap selectors with zero call-site changes. Test #6 pins the ordering invariant.

## Assumptions

1. **`updateConnection` uses `draft.name` (not `saved.name`)**: the store action discards `saved` (returns `void`); the hook can't observe the post-tauri `saved.name`. In practice `tauri.saveConnection` echoes the name verbatim (the backend has no normalisation step that would mutate `name`), so `draft.name === saved.name` byte-equivalently. If the backend ever starts mutating `name`, the hook would surface the pre-mutation value while the store's set(...) would surface the post-mutation value — this is a documented residual risk (see below). Spec § AC-2 explicitly grants Generator discretion here.

2. **`removeConnection` snapshot lookup**: hook calls `useConnectionStore.getState().connections.find((c) => c.id === id)` BEFORE awaiting `storeRemove(id)`. Once the store removes the connection from `connections` as part of its action body, a post-await lookup would yield `undefined` and every successful remove would land on the fallback string — that's a regression. Test #6 asserts the call ordering.

3. **Mock pattern**: `vi.hoisted` + `Object.assign(selector-fn, { getState })` mirrors `useConnectionLifecycle.test.ts` exactly. The selector-fn intercepts `useConnectionStore((s) => s.addConnection)` etc., while `mockGetState` services `useConnectionStore.getState()` for the removeConnection name lookup.

4. **No new `any`**: hook + hook test use `ConnectionDraft`, `ConnectionConfig`, and the inline factory union types from `@/types/connection`. The mock's selector type is `(s: unknown) => unknown` (matches lifecycle hook test pattern) — `unknown`, not `any`.

## Residual Risk

1. **`updateConnection` toast uses `draft.name`**: as noted in assumption #1, if `tauri.saveConnection` ever starts mutating `name` (e.g. trimming whitespace already normalised at the dialog layer, or canonicalising case), the hook's toast would diverge from the persisted name. Mitigation: the store action returns `void` for `updateConnection` (signature frozen); changing it to return `ConnectionConfig` would break the public API contract (out of scope). If this becomes a real divergence, P10 step 5 (a separate sprint) can change the store action to return `ConnectionConfig` and the hook to use `saved.name`.

2. **Cross-window race for `removeConnection` name lookup**: if window B's IPC bridge `set(connections)` arrives BETWEEN the hook's `getState().connections.find(...)` and the user's click on the Delete button, the snapshot could be stale. In practice the user's click handler runs synchronously with the lookup (hook is called from the dialog's onClick), so the IPC race is a single-frame window — the same race already existed in the pre-extraction store action (which also did the lookup before `await tauri.deleteConnection(id)`). Behaviour preserved.

3. **`removeConnection` fallback fires on truly-stale ids**: if a stale id reaches the dialog (e.g. user kept the dialog open while window B removed the connection via cross-window sync), the snapshot lookup yields `undefined` → fallback "Connection removed." is shown. Same behaviour as pre-extraction store. Acceptable.

4. **Hook re-render on every store action ref change**: each `useConnectionStore((s) => s.X)` selector returns the action function ref. Zustand keeps action refs stable across renders, so `useCallback` deps are effectively stable too — no unnecessary re-renders. Verified by full vitest pass + cross-window regression pass.

## Sprint Status

- Open `P1`/`P2` findings: **0**
- Required checks (1-22): **all passing**
- Acceptance criteria evidence: linked above
- **P10 step 1 closed.** Sprint 223+ can take up the next P10 step (schemaStore optimistic refresh / connectionStore session persistence / IPC bridge separation).

## References

- Contract: `docs/sprints/sprint-219/contract.md`
- Spec: `docs/sprints/sprint-219/spec.md`
- Execution Brief: `docs/sprints/sprint-219/execution-brief.md`
- Pattern source: `src/hooks/useConnectionLifecycle.ts` + `useConnectionLifecycle.test.ts`
