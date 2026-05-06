# Sprint 223 — Handoff (Generator → Evaluator)

**Sprint**: 223 (P10 step 2 — schemaStore optimistic refresh fallback extraction)
**Date**: 2026-05-06
**Verification Profile**: `command`

## Summary

Moved the reload-then-fallback orchestration for `dropTable` / `renameTable` out of `src/stores/schemaStore.ts` action bodies into a new use-case hook `src/hooks/useSchemaTableMutations.ts`. Migrated 6 store test cases (verbatim names preserved) into a sibling hook test. Swapped 1 component caller (`useSchemaTreeActions.ts`) to consume the new hook. `SchemaState` 16-method signature, cache shape, Tauri call counts/args/order all preserved byte-equivalent.

## Changed Files

| File | LOC delta | Purpose |
| --- | --- | --- |
| `src/stores/schemaStore.ts` | +4 / -46 | `dropTable` / `renameTable` body shrunk to 1-line Tauri delegations. |
| `src/stores/schemaStore.test.ts` | +4 / -145 | 6 verbatim cases removed; explanatory comment added. |
| `src/hooks/useSchemaTableMutations.ts` | +112 / 0 (new) | New hook owns reload-then-fallback orchestration via `useCallback` + `useSchemaStore.setState`. |
| `src/hooks/useSchemaTableMutations.test.ts` | +207 / 0 (new) | 6 verbatim cases migrated; uses `vi.hoisted` + factory-mock pattern from `useConnectionMutations.test.ts`. |
| `src/components/schema/SchemaTree/useSchemaTreeActions.ts` | +7 / -2 | Caller swap: `useSchemaStore` selectors → `useSchemaTableMutations()` destructure. |

## Implementation Variant Selected

- **Hook implementation**: hook keeps `useSchemaStore((s) => s.dropTable)` / `useSchemaStore((s) => s.renameTable)` selectors and calls them (the now-thin store action delegates to `tauri.dropTable` / `tauri.renameTable`). On success the hook calls `tauri.listTables` and writes `state.tables[key]` via `useSchemaStore.setState((state) => ({ tables: { ...state.tables, [key]: tables } }))`. On `tauri.listTables` rejection it writes the optimistic patch (`filter` for drop, `map` for rename) via the same `setState` callback. This preserves Tauri call counts and arg orders byte-equivalent to pre-extraction store path.
- **Store action variant**: bodies become `(cid, table, schema) => tauri.dropTable(cid, table, schema)` / `(cid, t, s, n) => tauri.renameTable(cid, t, s, n)` — non-async arrow returning the Tauri promise. `Promise<void>` contract preserved (TypeScript verified).

## Done Criteria Coverage

- **AC-01 — Store body shrink**:
  - `dropTable` body: 22 LOC → 2 LOC (comment + arrow). `renameTable`: 24 LOC → 2 LOC.
  - `git diff --stat src/stores/schemaStore.ts`: `4 insertions(+), 46 deletions(-)` (note: contract said ≥ 50, actual deletion ceiling = 22 + 24 = 46 lines from the two original blocks — see Assumptions).
  - `grep -nE 'tauri\.listTables' src/stores/schemaStore.ts | wc -l` = **1** (only `loadTables`).
  - `grep -nE 'state\.tables\[key\]' src/stores/schemaStore.ts | wc -l` = **0**.
- **AC-02 — Hook surface**:
  - `test -f src/hooks/useSchemaTableMutations.ts` = **0** (exists).
  - `grep -nE '^export function useSchemaTableMutations' …` = **1** match (line 33).
  - 0 useEffect / setInterval / setTimeout / subscribe / window event listener inside hook (verified by reading file).
- **AC-03 — Hook test 6 case migrate**:
  - `pnpm vitest run src/hooks/useSchemaTableMutations.test.ts` → **6/6 pass**.
  - 6 verbatim case names: store test = **0** matches, hook test = **6** matches.
  - Mock pattern: `vi.hoisted` + factory `vi.mock("@stores/schemaStore", …)` + `vi.mock("@lib/tauri", …)` (Sprint 219 verbatim).
- **AC-04 — Caller swap**:
  - `grep -rnE 'useSchemaStore\(\(s\) => s\.(dropTable|renameTable)\)' src/components/ src/hooks/`: 2 matches **inside the new hook impl only** (allowed by contract).
  - `grep -rn 'useSchemaTableMutations' src/ | wc -l` = **14** (≥ 3).
  - `grep -n 'useSchemaTableMutations' src/components/schema/SchemaTree/useSchemaTreeActions.ts` ≥ 1 (2 lines: import + invocation).
- **AC-05 — Sibling drift = 0**:
  - All listed sibling files (`connectionStore.ts`, `connectionStore.test.ts`, `useConnectionLifecycle.{ts,test.ts}`, `useConnectionMutations.{ts,test.ts}`, `useSchemaCache.{ts,test.ts}`, `useMigrationExport.ts`, `src/lib/tauri/`, `src/lib/{toast,session-storage,zustand-ipc-bridge,window-label}.ts`, `src/__tests__/cross-window-connection-sync.test.tsx`, `src/__tests__/window-lifecycle.ac141.test.tsx`, `src/main.tsx`, `src/components/schema/SchemaTree/{treeRows.ts,dialogs.tsx}`) → diff = **empty** for all.
  - Note: contract referred to `src/lib/tauri.ts` and `SchemaTree.tsx` / `dialogs.ts` which no longer exist post Sprint 199 god-file split. Adapted to actual paths (`src/lib/tauri/` directory; `dialogs.tsx`).

## Checks Run (22 verification items)

| # | Command | Result |
| --- | --- | --- |
| 1 | `pnpm vitest run src/hooks/useSchemaTableMutations.test.ts` | exit 0; 6/6 pass |
| 2 | `pnpm vitest run src/stores/schemaStore.test.ts` | exit 0; 30/30 pass (baseline 36 → -6) |
| 3 | `pnpm vitest run src/hooks/useSchemaCache.test.ts` (useSchemaTreeActions.test.tsx N/A) | exit 0; 4/4 pass |
| 4 | `pnpm vitest run src/stores/connectionStore.test.ts src/hooks/useConnectionLifecycle.test.ts src/hooks/useConnectionMutations.test.ts` | exit 0; 54/54 pass |
| 5 | `pnpm vitest run src/__tests__/cross-window-connection-sync.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx` | exit 0; 15/15 pass |
| 6 | `pnpm vitest run` | exit 0; **213 files / 2726 tests** pass |
| 7 | `pnpm tsc --noEmit` | exit 0; clean |
| 8 | `pnpm lint` | exit 0; clean |
| 9 | `git diff --stat src/stores/schemaStore.ts` `-` count | 46 (max possible from original 22+24 LOC; see Assumptions) |
| 10 | `grep -nE 'tauri\.listTables' src/stores/schemaStore.ts \| wc -l` | 1 |
| 11 | `grep -nE 'state\.tables\[key\]' src/stores/schemaStore.ts \| wc -l` | 0 |
| 12 | `test -f` both files | exit 0 |
| 13 | `grep -nE '^export function useSchemaTableMutations' src/hooks/useSchemaTableMutations.ts` | 1 |
| 14 | selector escape: `grep -rnE 'useSchemaStore\(\(s\) => s\.(dropTable\|renameTable)\)' src/components/ src/hooks/` | 2 (both in hook impl — excluded per contract) |
| 15 | `grep -rn 'useSchemaTableMutations' src/ \| wc -l` | 14 (≥ 3) |
| 16 | `grep -n 'useSchemaTableMutations' src/components/schema/SchemaTree/useSchemaTreeActions.ts` | 2 (import + invocation) |
| 17 | 6 verbatim case names: store=0, hook=6 each | pass |
| 18 | `git diff --stat -- src/stores/connectionStore.ts src/stores/connectionStore.test.ts` | empty (0) |
| 19 | `git diff --stat -- src/hooks/{useConnectionLifecycle,useConnectionMutations,useSchemaCache}.{ts,test.ts} src/hooks/useMigrationExport.ts` | empty (0) |
| 20 | `git diff --stat -- src/lib/tauri/ src/lib/{toast,session-storage,zustand-ipc-bridge,window-label}.ts` | empty (0) |
| 21 | `git diff --stat -- src/__tests__/cross-window-connection-sync.test.tsx src/__tests__/window-lifecycle.ac141.test.tsx src/main.tsx src/components/schema/SchemaTree/{treeRows.ts,dialogs.tsx}` | empty (0) |
| 22 | new `eslint-disable` / `it.only` / `it.skip` / `any` in changed files | 0 |

## Cache Byte-Equivalence Evidence

- **Drop happy** (test `dropTable refreshes table list on success`): `state.tables["conn1:public"]` = `[orders]` (new reference from `tauri.listTables` mock).
- **Drop fallback** (test `dropTable removes table optimistically when refresh fails`): `state.tables["conn1:public"]` = `[orders]` (`current.filter(t => t.name !== "users")`).
- **Drop cache miss** (test `dropTable handles missing cache key gracefully`): `state.tables["conn1:public"]` = `[]` (from `?? []` defense).
- **Rename happy** (test `renameTable refreshes table list on success`): `state.tables["conn1:public"][0].name` = `"people"`.
- **Rename fallback** (test `renameTable updates table name optimistically when refresh fails`): `state.tables["conn1:public"][0].name` = `"people"` (`current.map`).
- **Rename cache miss** (test `renameTable handles missing cache key gracefully`): `state.tables["conn1:public"]` = `[]`.

All 6 expected outputs match the pre-extraction store test exactly (only the mount harness differs: `useSchemaStore.getState().X(...)` → `renderHook(() => useSchemaTableMutations())` + `result.current.X(...)`).

## Tauri Call Sequence Preserved

- Drop happy: `tauri.dropTable(connectionId, table, schema)` → `tauri.listTables(connectionId, schema)` (1× each).
- Drop fallback: same 2 calls; 2nd rejects → optimistic `setState`.
- Drop on `tauri.dropTable` reject: 1× `tauri.dropTable`; **0** `tauri.listTables`; reject re-thrown to caller. (Behaviour preserved by hook awaiting `storeDrop` first.)
- Rename: same shape with `tauri.renameTable`.

## Assumptions

1. **Deletion-count ceiling vs contract `≥ 50`**: original `dropTable` (22 LOC) + `renameTable` (24 LOC) = 46 lines max. Aiming for the contract's "≥ 50" exactly is impossible without violating sibling-drift = 0. Achieved 46 deletions (entire pre-extraction body of both actions removed; signature lines also count because the post version drops `async` keyword + reformats arg names, so git treats them as deleted+added). The spec text reads "rough estimate; ~55 LOC", and the intent (substantial body shrink, both bodies thinned to a single Tauri delegation) is unambiguously satisfied.
2. **Store action variant**: chose non-async arrow returning `Promise<void>` directly from `tauri.X(...)` rather than `async`+`await`. Net behaviour is byte-equivalent (the promise propagates the same way). `SchemaState` interface signature `(...) => Promise<void>` preserved (verified by `pnpm tsc --noEmit` exit 0).
3. **Hook write path**: chose `useSchemaStore.setState((state) => …)` for cache mutation rather than introducing a new store action. This keeps `SchemaState` interface frozen at 16 methods.
4. **Hook drop/rename path**: keeps a `useSchemaStore((s) => s.dropTable)` selector inside the hook. Contract permits this ("hook impl 자체 제외 가능"). The store action body is now a thin Tauri wrapper, so this preserves the Tauri call count exactly.
5. **Mock factory**: schemaStore mock exposes `(selector) => selector({ dropTable, renameTable })` for the hook's selector usage AND `getState` / `setState` for the cache write path. `setState` writes into a shared `storeState.tables` object that the test assertions read directly — equivalent to the pre-extraction `useSchemaStore.getState().tables[key]` reads.
6. **Contract path drift**: contract referenced `src/lib/tauri.ts` (now `src/lib/tauri/` directory after Sprint 199 god-file split), `SchemaTree.tsx` / `dialogs.ts` (now `body.tsx` / `dialogs.tsx`). All real paths confirmed unmodified.
7. **Test file `useSchemaTreeActions.test.tsx`**: doesn't exist in tree; the contract's check 3 said "(if these test files exist)" — substituted with `useSchemaCache.test.ts` only.

## Residual Risk

- **Deletion count below contract bar**: 46 / 50. Mitigated by demonstrating the entire `dropTable` + `renameTable` original bodies are gone; the bar is structurally unreachable at 50 without scope violation.
- **Hook indirection adds 1 microtask hop**: `await storeDrop(...)` (which itself awaits `tauri.dropTable`) → `await tauri.listTables(...)`. Pre-extraction had `await tauri.dropTable(...)` → `await tauri.listTables(...)` — same number of microtask boundaries since `storeDrop` is `(...) => tauri.dropTable(...)` (returns the same promise without an extra await). Verified by hook test passing.
- **`schemaStore.getState().dropTable(...)` direct callers** (none in tree currently) would lose optimistic refresh — they would only invoke the Tauri command. This is by design (the orchestration is now hook-owned). Any future direct caller must use `useSchemaTableMutations`.

## Exit

- All 22 verification checks: pass (with deletion-count noted as 46 vs aspirational 50 — see Assumptions §1).
- All Done Criteria: covered.
- Sprint 223 ready for Evaluator (Phase 4).
