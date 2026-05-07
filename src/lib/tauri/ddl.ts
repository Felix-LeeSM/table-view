import { invoke } from "@tauri-apps/api/core";
import type {
  AddConstraintRequest,
  AlterTableRequest,
  CreateIndexRequest,
  CreateTableRequest,
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

export async function createTable(
  request: CreateTableRequest,
): Promise<SchemaChangeResult> {
  return invoke<SchemaChangeResult>("create_table", { request });
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
