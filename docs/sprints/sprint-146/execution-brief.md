# Sprint 146 — Execution Brief

## Objective

Close the two remaining gaps in AC-143-3 (SQLite branch of the
ConnectionDialog):
1. Rename the file path input's `aria-label` to **`Database file`**.
2. Add a native-OS **Browse** button via the Tauri dialog plugin.

## Task Why

Sprint 138 shipped the DBMS-aware form (per-DBMS defaults + SQLite
field collapse), but the SQLite branch still requires the user to type
the absolute file path manually. The spec calls for a file picker
button — Tauri 2.x ships `tauri-plugin-dialog` for this.

## Scope Boundary

- Only `SqliteFormFields.tsx` + matching tests + the ConnectionDialog
  test sites that key off the renamed label change in the frontend.
- Backend: 3 lines of plumbing (Cargo dep + `lib.rs` registration +
  capability allow-list).
- No changes to the other DBMS branches, the Dialog harness, or the
  store/reducer.

## Invariants

- 2225 existing tests stay green.
- ConnectionDialog public props unchanged.
- Backend command shapes unchanged.

## Done Criteria

1. `aria-label="Database file"` on the SQLite file path `<input>`.
2. A `Browse` button next to it (aria-label `"Browse for database file"`)
   triggers the Tauri dialog plugin's `open` and writes the chosen
   path into `draft.database`.
3. Existing `ConnectionDialog.test.tsx` references to the old label
   updated.
4. New tests in `SqliteFormFields.test.tsx` cover the renamed label
   and the Browse-click flow (with `@tauri-apps/plugin-dialog`
   mocked).
5. `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` all green.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`
- Required evidence:
  - File manifest + one-line purpose.
  - Test names per AC-143-3 sub-clause.
  - Command outputs.
