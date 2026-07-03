import { invoke } from "@tauri-apps/api/core";
import type {
  AddColumnRequest,
  AddConstraintRequest,
  AlterTableRequest,
  CreateIndexRequest,
  CreateTablePlanRequest,
  CreateTableRequest,
  CreateTriggerRequest,
  DropColumnRequest,
  DropConstraintRequest,
  DropIndexRequest,
  DropTableRequest,
  DropTriggerRequest,
  RenameTableRequest,
  SchemaChangeResult,
} from "@/types/schema";

// Table management — Sprint 235 dual export.
//
// `dropTableRequest` / `renameTableRequest` take the new request object
// shape and return `SchemaChangeResult { sql }` so the new
// RenameTableDialog / DropTableDialog can drive the preview/execute
// lifecycle through `useDdlPreviewExecution`.
//
// `dropTable` / `renameTable` retain their pre-Sprint 235 positional
// signatures — `schemaStore.dropTable` / `.renameTable` actions still
// call them and the diff = 0 invariant on `src/stores/schemaStore.ts`
// holds. These wrappers build the request object internally with
// `previewOnly: false` and discard the returned `sql` (only the new
// modals need it).
//
// Sprint 271c (2026-05-13) — every wrapper threads the Request object's
// `expectedDatabase?: string` field straight to the backend (Tauri's
// camelCase↔snake_case auto-conversion handles the rename to
// `expected_database`). Existing call sites that omit the field stay
// byte-equivalent; new call sites populate it from the workspace
// `(connId, db)` coordinate. Mismatch surfaces as a typed
// `AppError::DbMismatch` envelope with stable legacy message text.

/**
 * Sprint 235 — request-shaped DROP TABLE wrapper. Returns the SQL the
 * backend ran (or, when `previewOnly: true`, the SQL it WOULD run).
 *
 * Sprint 271c — `request.expectedDatabase` triggers the backend
 * DbMismatch guard.
 */
// Issue #1112 — `safetyConfirmed` is the Safe Mode confirmation proof. The
// backend gate is skipped for `previewOnly: true` calls (they never execute);
// commit calls (`previewOnly: false`) must pass `true` after the user's
// confirm dialog so a destructive DDL in a confirm-required context (prod, or
// non-prod + strict) is accepted. A direct IPC bypass omits it → rejected.
export async function dropTableRequest(
  request: DropTableRequest,
  safetyConfirmed?: boolean,
): Promise<SchemaChangeResult> {
  return invoke<SchemaChangeResult>("drop_table", {
    request,
    safetyConfirmed: safetyConfirmed ?? false,
  });
}

/**
 * Sprint 235 — request-shaped RENAME TABLE wrapper. Same semantics as
 * `dropTableRequest`.
 *
 * Sprint 271c — `request.expectedDatabase` opt-in DbMismatch guard.
 */
export async function renameTableRequest(
  request: RenameTableRequest,
): Promise<SchemaChangeResult> {
  return invoke<SchemaChangeResult>("rename_table", { request });
}

/**
 * Compat wrapper — `schemaStore.dropTable` action body remains byte-
 * equivalent (Sprint 235 invariant on `src/stores/schemaStore.ts`).
 * Builds the request object internally + discards the SQL string.
 *
 * Sprint 271c — optional `expectedDatabase` last-positional propagates
 * to the underlying request struct so a swapped backend pool rejects
 * with `AppError::DbMismatch` before the table is dropped.
 */
export async function dropTable(
  connectionId: string,
  table: string,
  schema: string,
  expectedDatabase?: string,
): Promise<void> {
  await dropTableRequest(
    {
      connectionId,
      schema,
      table,
      cascade: false,
      previewOnly: false,
      expectedDatabase,
    },
    // Commit-only compat wrapper — the caller's context menu / dialog is the
    // confirmation surface (issue #1112).
    true,
  );
}

/**
 * Compat wrapper — same shape as `dropTable`.
 *
 * Sprint 271c — see `dropTable`.
 */
export async function renameTable(
  connectionId: string,
  table: string,
  schema: string,
  newName: string,
  expectedDatabase?: string,
): Promise<void> {
  await renameTableRequest({
    connectionId,
    schema,
    table,
    newName,
    previewOnly: false,
    expectedDatabase,
  });
}

/**
 * Sprint 271c — `request.expectedDatabase` opt-in DbMismatch guard.
 */
// Issue #1112 — `alterTable` is destructive only when a change drops a column;
// the backend gates that case. Commit callers (`previewOnly: false`) pass
// `safetyConfirmed: true`. See `dropTableRequest`.
export async function alterTable(
  request: AlterTableRequest,
  safetyConfirmed?: boolean,
): Promise<SchemaChangeResult> {
  return invoke<SchemaChangeResult>("alter_table", {
    request,
    safetyConfirmed: safetyConfirmed ?? false,
  });
}

/**
 * Sprint 236 — request-shaped ADD COLUMN wrapper. Returns the SQL the
 * backend ran (or, when `previewOnly: true`, the SQL it WOULD run).
 * The Sprint 236 `AddColumnDialog` calls this twice: first with
 * `previewOnly: true` for the Show DDL preview pane, then with
 * `previewOnly: false` for the commit (mirrors Sprint 226 `createTable`
 * + Sprint 235 `dropTableRequest`).
 *
 * Note: per Sprint 236 contract Open Question §1, no positional
 * `addColumn` compat wrapper is exported — `grep -rn 'tauri\.addColumn\b'
 * src/` returns 0 hits in production code, so the request-shaped
 * function is the sole public API surface.
 *
 * Sprint 271c — `request.expectedDatabase` opt-in DbMismatch guard.
 */
export async function addColumnRequest(
  request: AddColumnRequest,
): Promise<SchemaChangeResult> {
  return invoke<SchemaChangeResult>("add_column", { request });
}

/**
 * Sprint 236 — request-shaped DROP COLUMN wrapper. Same shape as
 * `addColumnRequest`. No positional compat wrapper (see Sprint 236
 * Open Question §1).
 *
 * Sprint 271c — `request.expectedDatabase` opt-in DbMismatch guard.
 */
// Issue #1112 — commit callers pass `safetyConfirmed: true`. See
// `dropTableRequest`.
export async function dropColumnRequest(
  request: DropColumnRequest,
  safetyConfirmed?: boolean,
): Promise<SchemaChangeResult> {
  return invoke<SchemaChangeResult>("drop_column", {
    request,
    safetyConfirmed: safetyConfirmed ?? false,
  });
}

/**
 * Sprint 271c — `request.expectedDatabase` opt-in DbMismatch guard.
 */
export async function createTable(
  request: CreateTableRequest,
): Promise<SchemaChangeResult> {
  return invoke<SchemaChangeResult>("create_table", { request });
}

/**
 * Sprint 240 — unified `CREATE TABLE + indexes + constraints` wrapper.
 * Single round-trip preview / execute for the multi-tab
 * `CreateTableDialog`. Returns the joined SQL plan as a single string
 * (statements separated by `;\n`); the dialog renders it verbatim in
 * the preview pane.
 *
 * Sprint 271c — `request.expectedDatabase` opt-in DbMismatch guard.
 */
export async function createTablePlan(
  request: CreateTablePlanRequest,
): Promise<SchemaChangeResult> {
  return invoke<SchemaChangeResult>("create_table_plan", { request });
}

/**
 * Sprint 271c — `request.expectedDatabase` opt-in DbMismatch guard.
 */
export async function createIndex(
  request: CreateIndexRequest,
): Promise<SchemaChangeResult> {
  return invoke<SchemaChangeResult>("create_index", { request });
}

/**
 * Sprint 271c — `request.expectedDatabase` opt-in DbMismatch guard.
 */
// Issue #1112 — commit callers pass `safetyConfirmed: true`. See
// `dropTableRequest`.
export async function dropIndex(
  request: DropIndexRequest,
  safetyConfirmed?: boolean,
): Promise<SchemaChangeResult> {
  return invoke<SchemaChangeResult>("drop_index", {
    request,
    safetyConfirmed: safetyConfirmed ?? false,
  });
}

/**
 * Sprint 271c — `request.expectedDatabase` opt-in DbMismatch guard.
 */
export async function addConstraint(
  request: AddConstraintRequest,
): Promise<SchemaChangeResult> {
  return invoke<SchemaChangeResult>("add_constraint", { request });
}

/**
 * Sprint 271c — `request.expectedDatabase` opt-in DbMismatch guard.
 */
// Issue #1112 — commit callers pass `safetyConfirmed: true`. See
// `dropTableRequest`.
export async function dropConstraint(
  request: DropConstraintRequest,
  safetyConfirmed?: boolean,
): Promise<SchemaChangeResult> {
  return invoke<SchemaChangeResult>("drop_constraint", {
    request,
    safetyConfirmed: safetyConfirmed ?? false,
  });
}

/**
 * Sprint 273 — `CREATE TRIGGER` wrapper. The `CreateTriggerDialog`
 * calls this twice: first with `previewOnly: true` for the inline DDL
 * preview pane, then with `previewOnly: false` for the commit. Backend
 * validates identifiers / whitelists, rejects `INSTEAD OF + STATEMENT`
 * and `INSTEAD OF + multi-event`, doubles `'` in `functionArguments`,
 * and (when `previewOnly === false`) wraps the statement in
 * `BEGIN/COMMIT`. Non-PG RDB adapters surface `AppError::Unsupported`.
 *
 * Sprint 271c — `request.expectedDatabase` opt-in DbMismatch guard.
 */
export async function createTrigger(
  request: CreateTriggerRequest,
): Promise<SchemaChangeResult> {
  return invoke<SchemaChangeResult>("create_trigger", { request });
}

/**
 * Sprint 274 — `DROP TRIGGER` wrapper. The `DropTriggerDialog` calls
 * this twice: first with `previewOnly: true` for the inline DDL preview
 * pane, then with `previewOnly: false` for the commit. Backend
 * validates `trigger_name` / `schema` / `table` identifiers, emits
 * `DROP TRIGGER "name" ON "schema"."table"` (+ trailing ` CASCADE` when
 * `cascade === true`), and (when `previewOnly === false`) wraps the
 * statement in `sqlx::Transaction::begin/commit`. Non-PG RDB adapters
 * surface `AppError::Unsupported`.
 *
 * Sprint 271c — `request.expectedDatabase` opt-in DbMismatch guard.
 */
// Issue #1112 — commit callers pass `safetyConfirmed: true`. See
// `dropTableRequest`.
export async function dropTrigger(
  request: DropTriggerRequest,
  safetyConfirmed?: boolean,
): Promise<SchemaChangeResult> {
  return invoke<SchemaChangeResult>("drop_trigger", {
    request,
    safetyConfirmed: safetyConfirmed ?? false,
  });
}

/**
 * Sprint 237 — count rows where `<column>` is `NULL` on
 * `"<schema>"."<table>"`. Backs the pre-execution warning that the
 * MODIFY editor surfaces when the user toggles a nullable column to
 * NOT NULL — a non-zero result means the eventual `ALTER COLUMN …
 * SET NOT NULL` will fail at the database. The probe is advisory
 * (never blocks preview / commit).
 *
 * Backend validates `schema` / `table` / `column` identifiers via the
 * shared `validate_identifier` helper (NAMEDATALEN-63 +
 * `[a-zA-Z_][a-zA-Z0-9_]*`) and runs the SQL through the active PG
 * pool. Non-PG RDB adapters surface `AppError::Unsupported` via the
 * trait default — the frontend swallows probe errors silently so this
 * is invisible to the user.
 *
 * Sprint 271c — optional `expectedDatabase` opt-in DbMismatch guard.
 * Omitting the parameter is byte-equivalent to no probe.
 */
export async function countNullRows(
  connectionId: string,
  schema: string,
  table: string,
  column: string,
  expectedDatabase?: string,
): Promise<number> {
  return invoke<number>("count_null_rows", {
    connectionId,
    schema,
    table,
    column,
    expectedDatabase: expectedDatabase ?? null,
  });
}

/**
 * Sprint 335 (Slice M live wire) — `CREATE DATABASE "<name>"`. PG only
 * for now; other RDB adapters surface `AppError::Unsupported`.
 */
export async function createRdbDatabase(
  connectionId: string,
  name: string,
): Promise<void> {
  return invoke<void>("create_rdb_database", { connectionId, name });
}

/**
 * Sprint 335 (Slice M live wire) — `DROP DATABASE "<name>"`. PG only;
 * caller is responsible for evicting active sessions on the target.
 */
export async function dropRdbDatabase(
  connectionId: string,
  name: string,
): Promise<void> {
  // Issue #1112 — `DROP DATABASE` is unconditionally destructive and reached
  // only through the `DbLifecycleDialog` confirm flow; forward the proof.
  return invoke<void>("drop_rdb_database", {
    connectionId,
    name,
    safetyConfirmed: true,
  });
}
