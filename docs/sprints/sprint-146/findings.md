# Sprint 146 — Findings

## Outcome

**PASS** — AC-143-3 closed in full. Sprint 138 had already shipped
AC-143-1/2/4/5 (per-DBMS user/port defaults + SQLite field collapse +
DBMS-switch reset flow); this sprint added the two narrow gaps:
verbatim aria-label and a native file picker button.

## Verification

- `pnpm vitest run` — 145 files / **2228 tests** (+3 from baseline).
- `pnpm tsc --noEmit` — exit 0.
- `pnpm lint` — exit 0.
- `cargo check` — exit 0 (Rust plugin registered cleanly).

## Changed Files

| File | Purpose |
|---|---|
| `src-tauri/Cargo.toml` | Add `tauri-plugin-dialog = "2"`. |
| `src-tauri/src/lib.rs` | Register `tauri_plugin_dialog::init()` on the Builder. |
| `src-tauri/capabilities/default.json` | Allow `dialog:default` permission for the main window. |
| `package.json` | Add `@tauri-apps/plugin-dialog ^2` (frontend bridge to the plugin). |
| `pnpm-lock.yaml` | Lockfile update. |
| `src/components/connection/forms/SqliteFormFields.tsx` | Rename input `aria-label` to `"Database file"` (verbatim per spec); add `Browse` button (`aria-label="Browse for database file"`) that opens the OS file picker via the dialog plugin and writes the chosen path into `draft.database`. |
| `src/components/connection/forms/SqliteFormFields.test.tsx` | Updated existing tests to the new label; added 3 new tests covering the Browse button (presence, picked-path round-trip, cancel returns null path). |
| `src/components/connection/ConnectionDialog.test.tsx` | Updated 2 sites that referenced the old `"SQLite database file path"` label. |

## AC Coverage (this sprint's deltas)

| AC | Status | Evidence |
|---|---|---|
| AC-143-1 (PG defaults) | ✅ (Sprint 138) | `DATABASE_DEFAULT_FIELDS.postgresql` → user="postgres", port=5432. |
| AC-143-2 (MySQL defaults) | ✅ (Sprint 138) | `DATABASE_DEFAULT_FIELDS.mysql` → user="root", port=3306. |
| AC-143-3 (SQLite hides host/port/user/password; `[aria-label="Database file"]`; file picker button) | ✅ **Sprint 146** | `SqliteFormFields.test.tsx`: 5 tests covering label, omitted fields, Browse button presence, Browse → onChange round-trip, cancel-no-overwrite. |
| AC-143-4 (Mongo defaults) | ✅ (Sprint 138) | `DATABASE_DEFAULT_FIELDS.mongodb` → user="", port=27017. |
| AC-143-5 (DBMS switch retains compatible / resets incompatible) | ✅ (Sprint 138) | `applyDbTypeChange` confirm flow in ConnectionDialog. |

## Assumptions

- The user-cancellation case (`open()` resolves null) MUST NOT
  overwrite an existing `draft.database`. Test pinned this invariant.
- `directory: false` + `multiple: false` is the right `open()` shape
  for picking a single SQLite file. No file extension filter applied
  yet — SQLite files appear with diverse extensions (.sqlite, .db,
  .db3, none) and a strict filter could mislead users.

## Risks / Deferred

- **Backend file existence validation** — the Browse button writes
  the path verbatim; `connection_test` is what surfaces a missing
  file today. A pre-flight stat could give faster feedback but
  belongs to a separate sprint.
- **File extension filter** — could be added with the dialog plugin's
  `filters` option once we agree on a canonical SQLite extension list.
