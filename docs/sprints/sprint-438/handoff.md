# Sprint 438 Handoff: Harden Data Grid Empty Entry

## Status

Complete. `EMPTY_ENTRY` keeps its missing-key reference identity and its nested
containers now reject direct mutation attempts.

## What Changed

- `EMPTY_ENTRY.pendingEdits` now uses a read-only `Map` proxy whose mutators
  throw.
- `EMPTY_ENTRY.pendingDeletedRowKeys` now uses a read-only `Set` proxy whose
  mutators throw.
- `EMPTY_ENTRY.pendingNewRows` and `EMPTY_ENTRY.undoStack` are frozen empty
  arrays.
- `PendingEntry` and `EditSnapshot` now expose readonly collection types at the
  store boundary.
- `useDataGridEditPendingState` accepts readonly previous values in updater
  callbacks while preserving the existing public hook return shape.
- Store tests now lock the stable missing-key sentinel identity and direct
  mutation failure behavior.

## Acceptance Evidence

- AC-438-01: `src/stores/dataGridEditStore.test.ts` asserts multiple missing
  keys return the exported `EMPTY_ENTRY` reference.
- AC-438-02 to AC-438-04: `src/stores/dataGridEditStore.test.ts` casts through
  the runtime surface, attempts direct mutations on the sentinel internals, and
  asserts the containers remain empty.
- AC-438-05: Existing AC-251 store tests still cover `setSlice`, `clearEntry`,
  `purgeKey`, and `purgeForConnection`.
- AC-438-06: `src/stores/dataGridEditStore.ts` exposes `ReadonlyMap`,
  `ReadonlySet`, and `ReadonlyArray` on `PendingEntry`.

## Verification

- `pnpm exec vitest run src/stores/dataGridEditStore.test.ts`
  - Pass: 1 file, 9 tests.
- `pnpm exec tsc -b --pretty false`
  - Pass.
- `git diff --check`
  - Pass.
- `pnpm exec lefthook validate`
  - Pass.

## Notes

- The sentinel is still shared intentionally; changing that behavior would risk
  selector churn for missing-key reads.
- Normal store writes are unchanged: `setSlice` and `clearEntry` create fresh
  mutable entries rather than mutating or reusing the sentinel.
