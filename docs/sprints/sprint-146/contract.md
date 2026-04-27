# Sprint 146 Contract — DBMS-aware ConnectionDialog (AC-143-*)

## Pre-sprint discovery

Sprint 138 already shipped most of AC-143-*:

- **AC-143-1** (PG: user=postgres / port=5432) — ✅ via
  `DATABASE_DEFAULT_FIELDS.postgresql`.
- **AC-143-2** (MySQL: user=root / port=3306) — ✅ same.
- **AC-143-3** (SQLite: hide host/port/user/password) — ✅ via
  `SqliteFormFields.tsx`.
  - aria-label "Database file" (verbatim) — ❌ today's label is
    `"SQLite database file path"`.
  - File picker button — ❌ not present (text input only).
- **AC-143-4** (MongoDB: user="" / port=27017) — ✅ same defaults map.
- **AC-143-5** (DBMS switch retains compatible, resets incompatible) —
  ✅ via `applyDbTypeChange` confirm dialog + reset flow.

The work in this sprint is two narrow gaps inside AC-143-3:
1. Rename the aria-label of the SQLite file input to **`Database file`**
   (verbatim per spec).
2. Add a **`Browse`** button next to the file input that opens a native
   file picker via `@tauri-apps/plugin-dialog` and writes the chosen
   path back into `draft.database`.

## Decision

Add the dialog plugin (Cargo + npm + capability) and wire the Browse
button. In jsdom tests we mock the plugin; in production it pops a
real OS file picker. Plugin scope is single-file open.

## In Scope

- `src-tauri/Cargo.toml` — add `tauri-plugin-dialog = "2"`.
- `src-tauri/src/lib.rs` — register the plugin builder.
- `src-tauri/capabilities/default.json` — add `dialog:default`.
- `package.json` — add `@tauri-apps/plugin-dialog`.
- `src/components/connection/forms/SqliteFormFields.tsx`:
  - Change `aria-label="SQLite database file path"` →
    `aria-label="Database file"`.
  - Add a `Browse` button that calls `open({ multiple: false })`
    and writes the path to `onChange({ database: path })` on resolve.
  - Browse button must be discoverable via `aria-label="Browse for database file"`.
- `src/components/connection/forms/SqliteFormFields.test.tsx`:
  - Update existing tests' label expectation.
  - Add a Browse-click test (mock `@tauri-apps/plugin-dialog`).
- `src/components/connection/ConnectionDialog.test.tsx`:
  - Update the two `getByLabelText("SQLite database file path")` sites
    (lines 1101, 1295) to `"Database file"`.

## Out of Scope

- Multi-file selection / save dialogs.
- Backend file existence validation (deferred).
- Any change to PG/MySQL/Mongo/Redis form fields (already ship the
  expected defaults from Sprint 138).

## Invariants

- `pnpm vitest run` stays green.
- `pnpm tsc --noEmit` exits 0.
- `pnpm lint` exits 0.
- ConnectionDialog props/contracts unchanged.
- Backend connection_test / addConnection command shapes unchanged.

## Done Criteria

1. SQLite branch's file path input has `aria-label="Database file"`.
2. A `Browse` button is rendered next to the input, with
   `aria-label="Browse for database file"`.
3. Clicking Browse calls the Tauri dialog plugin's `open` and the
   selected path lands in `draft.database` via `onChange`.
4. `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` all green.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`
- Required evidence:
  - File-change manifest.
  - Test names that exercise the new Browse button + the renamed
    aria-label.
  - Commands' exit codes + counts.
