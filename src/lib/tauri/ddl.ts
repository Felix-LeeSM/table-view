import { invoke } from "@tauri-apps/api/core";
import type {
  AddColumnRequest,
  AddConstraintRequest,
  AlterTableRequest,
  CreateIndexRequest,
  CreateTablePlanRequest,
  CreateTableRequest,
  DropColumnRequest,
  DropConstraintRequest,
  DropIndexRequest,
  DropTableRequest,
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

/**
 * Sprint 235 — request-shaped DROP TABLE wrapper. Returns the SQL the
 * backend ran (or, when `previewOnly: true`, the SQL it WOULD run).
 */
export async function dropTableRequest(
  request: DropTableRequest,
): Promise<SchemaChangeResult> {
  return invoke<SchemaChangeResult>("drop_table", { request });
}

/**
 * Sprint 235 — request-shaped RENAME TABLE wrapper. Same semantics as
 * `dropTableRequest`.
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
 */
export async function dropTable(
  connectionId: string,
  table: string,
  schema: string,
): Promise<void> {
  await dropTableRequest({
    connectionId,
    schema,
    table,
    cascade: false,
    previewOnly: false,
  });
}

/**
 * Compat wrapper — same shape as `dropTable`.
 */
export async function renameTable(
  connectionId: string,
  table: string,
  schema: string,
  newName: string,
): Promise<void> {
  await renameTableRequest({
    connectionId,
    schema,
    table,
    newName,
    previewOnly: false,
  });
}

// Schema change operations
export async function alterTable(
  request: AlterTableRequest,
): Promise<SchemaChangeResult> {
  return invoke<SchemaChangeResult>("alter_table", { request });
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
 */
export async function dropColumnRequest(
  request: DropColumnRequest,
): Promise<SchemaChangeResult> {
  return invoke<SchemaChangeResult>("drop_column", { request });
}

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
 */
export async function createTablePlan(
  request: CreateTablePlanRequest,
): Promise<SchemaChangeResult> {
  return invoke<SchemaChangeResult>("create_table_plan", { request });
}

export async function createIndex(
  request: CreateIndexRequest,
): Promise<SchemaChangeResult> {
  return invoke<SchemaChangeResult>("create_index", { request });
}

export async function dropIndex(
  request: DropIndexRequest,
): Promise<SchemaChangeResult> {
  return invoke<SchemaChangeResult>("drop_index", { request });
}

export async function addConstraint(
  request: AddConstraintRequest,
): Promise<SchemaChangeResult> {
  return invoke<SchemaChangeResult>("add_constraint", { request });
}

export async function dropConstraint(
  request: DropConstraintRequest,
): Promise<SchemaChangeResult> {
  return invoke<SchemaChangeResult>("drop_constraint", { request });
}
