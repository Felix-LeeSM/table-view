# Sprint 438 Contract: Harden Data Grid Empty Entry

## Goal

Resolve code-smell audit L10 by making the shared
`dataGridEditStore.EMPTY_ENTRY` sentinel safe against accidental runtime
mutation while preserving its missing-key reference identity.

## Scope

- Harden only the shared empty sentinel used by `getEntry` for missing keys.
- Keep normal pending-edit writes routed through `setSlice` and `clearEntry`.
- Preserve `getEntry(missing) === EMPTY_ENTRY`.
- Add runtime guards so direct mutation attempts on `EMPTY_ENTRY.pendingEdits`,
  `EMPTY_ENTRY.pendingDeletedRowKeys`, `EMPTY_ENTRY.pendingNewRows`, and
  `EMPTY_ENTRY.undoStack` fail immediately.
- Tighten the store-facing TypeScript surface with readonly collection types
  where it does not require broad caller churn.
- Keep documentation limited to `docs/sprints/sprint-438/`.

## Acceptance Criteria

- AC-438-01: `getEntry` returns the same `EMPTY_ENTRY` reference for any missing
  key.
- AC-438-02: Direct mutation attempts on `EMPTY_ENTRY.pendingEdits` throw and
  leave the map empty.
- AC-438-03: Direct mutation attempts on
  `EMPTY_ENTRY.pendingDeletedRowKeys` throw and leave the set empty.
- AC-438-04: Direct mutation attempts on the sentinel array fields
  `pendingNewRows` and `undoStack` throw and leave them empty.
- AC-438-05: `setSlice` and `clearEntry` still allocate normal fresh entries and
  preserve existing data grid edit store behavior.
- AC-438-06: The TypeScript read surface exposes readonly containers at the
  store boundary without forcing unrelated data grid caller rewrites.

## Out Of Scope

- Changing pending-edit key shape.
- Replacing the shared empty sentinel with fresh empty entries.
- Changing localStorage, cross-window sync, schema, parser, or workspace logic.
- Editing `docs/RISKS.md` or `docs/PLAN.md`.

## Verification Plan

1. Add focused store regression tests for missing-key identity and sentinel
   mutation attempts.
2. Harden the sentinel internals and readonly store-facing types.
3. Run `pnpm exec vitest run src/stores/dataGridEditStore.test.ts`.
4. Run `pnpm exec tsc -b --pretty false`.
5. Run `git diff --check`.
6. Run `pnpm exec lefthook validate`.
