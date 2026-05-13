import { invoke } from "@tauri-apps/api/core";
import type {
  ColumnInfo,
  ConstraintInfo,
  FunctionInfo,
  IndexInfo,
  PostgresTypeInfo,
  SchemaInfo,
  TableInfo,
  TriggerInfo,
  ViewInfo,
} from "@/types/schema";

/**
 * Sprint 271a (2026-05-13) — every wrapper accepts an optional
 * `expectedDatabase`. When provided, the backend probes the adapter's
 * active db inside the same `active_connections.lock()` acquisition that
 * wraps the dispatch and rejects with `AppError::DbMismatch` BEFORE
 * invoking the underlying trait. Pre-existing call sites that omit the
 * argument hit the byte-equivalent pre-Sprint-271 path. Mirrors the
 * Sprint 266 `executeQuery` wrapper shape (`expectedDatabase ?? null`).
 */

// Schema exploration
export async function listSchemas(
  connectionId: string,
  expectedDatabase?: string,
): Promise<SchemaInfo[]> {
  return invoke<SchemaInfo[]>("list_schemas", {
    connectionId,
    expectedDatabase: expectedDatabase ?? null,
  });
}

export async function listTables(
  connectionId: string,
  schema: string,
  expectedDatabase?: string,
): Promise<TableInfo[]> {
  return invoke<TableInfo[]>("list_tables", {
    connectionId,
    schema,
    expectedDatabase: expectedDatabase ?? null,
  });
}

export async function getTableColumns(
  connectionId: string,
  table: string,
  schema: string,
  expectedDatabase?: string,
): Promise<ColumnInfo[]> {
  return invoke<ColumnInfo[]>("get_table_columns", {
    connectionId,
    table,
    schema,
    expectedDatabase: expectedDatabase ?? null,
  });
}

export async function listSchemaColumns(
  connectionId: string,
  schema: string,
  expectedDatabase?: string,
): Promise<Record<string, ColumnInfo[]>> {
  return invoke<Record<string, ColumnInfo[]>>("list_schema_columns", {
    connectionId,
    schema,
    expectedDatabase: expectedDatabase ?? null,
  });
}

export async function getTableIndexes(
  connectionId: string,
  table: string,
  schema: string,
  expectedDatabase?: string,
): Promise<IndexInfo[]> {
  return invoke<IndexInfo[]>("get_table_indexes", {
    connectionId,
    table,
    schema,
    expectedDatabase: expectedDatabase ?? null,
  });
}

export async function getTableConstraints(
  connectionId: string,
  table: string,
  schema: string,
  expectedDatabase?: string,
): Promise<ConstraintInfo[]> {
  return invoke<ConstraintInfo[]>("get_table_constraints", {
    connectionId,
    table,
    schema,
    expectedDatabase: expectedDatabase ?? null,
  });
}

// Views & Functions
export async function listViews(
  connectionId: string,
  schema: string,
  expectedDatabase?: string,
): Promise<ViewInfo[]> {
  return invoke<ViewInfo[]>("list_views", {
    connectionId,
    schema,
    expectedDatabase: expectedDatabase ?? null,
  });
}

export async function listFunctions(
  connectionId: string,
  schema: string,
  expectedDatabase?: string,
): Promise<FunctionInfo[]> {
  return invoke<FunctionInfo[]>("list_functions", {
    connectionId,
    schema,
    expectedDatabase: expectedDatabase ?? null,
  });
}

export async function getViewDefinition(
  connectionId: string,
  schema: string,
  viewName: string,
  expectedDatabase?: string,
): Promise<string> {
  return invoke<string>("get_view_definition", {
    connectionId,
    schema,
    viewName,
    expectedDatabase: expectedDatabase ?? null,
  });
}

export async function getViewColumns(
  connectionId: string,
  schema: string,
  viewName: string,
  expectedDatabase?: string,
): Promise<ColumnInfo[]> {
  return invoke<ColumnInfo[]>("get_view_columns", {
    connectionId,
    schema,
    viewName,
    expectedDatabase: expectedDatabase ?? null,
  });
}

export async function getFunctionSource(
  connectionId: string,
  schema: string,
  functionName: string,
  expectedDatabase?: string,
): Promise<string> {
  return invoke<string>("get_function_source", {
    connectionId,
    schema,
    functionName,
    expectedDatabase: expectedDatabase ?? null,
  });
}

/**
 * Sprint 272 — list triggers attached to `(schema, table)`. PG-only;
 * non-PG RDB adapters return an empty array. Pass `expectedDatabase` to
 * opt into the Sprint 271c DbMismatch guard.
 */
export async function listTriggers(
  connectionId: string,
  schema: string,
  table: string,
  expectedDatabase?: string,
): Promise<TriggerInfo[]> {
  return invoke<TriggerInfo[]>("list_triggers", {
    connectionId,
    schema,
    table,
    expectedDatabase: expectedDatabase ?? null,
  });
}

/**
 * Sprint 272 — `pg_get_triggerdef(t.oid)` for one trigger. Returns the
 * canonical CREATE TRIGGER source. Non-PG RDB adapters reject with
 * `AppError::Unsupported` — there is no sane empty-string default.
 */
export async function getTriggerSource(
  connectionId: string,
  schema: string,
  table: string,
  triggerName: string,
  expectedDatabase?: string,
): Promise<string> {
  return invoke<string>("get_trigger_source", {
    connectionId,
    schema,
    table,
    triggerName,
    expectedDatabase: expectedDatabase ?? null,
  });
}

// ── Sprint 230 — dynamic Postgres type list ────────────────────────────

/**
 * Sprint 230 — list every Postgres-style data type visible to the
 * connection (built-ins from `pg_catalog`, extension types like
 * PostGIS `geometry`, user-defined enums / domains / ranges /
 * composites). Read-only catalog query — same paradigm as
 * `listSchemas` / `listTables`. The wrapper lives in `schema.ts`
 * (NOT `ddl.ts` — that file is reserved for mutation wrappers like
 * `createTable` / `addConstraint`).
 *
 * The returned shape is consumed by `usePostgresTypes` (which merges
 * the live list with the canonical `POSTGRES_COMMON_TYPES` so the
 * combobox stays usable when the call fails or resolves slowly).
 *
 * Sprint 271a — opt-in `expectedDatabase` mismatch guard. See module doc.
 */
export async function listPostgresTypes(
  connectionId: string,
  expectedDatabase?: string,
): Promise<PostgresTypeInfo[]> {
  return invoke<PostgresTypeInfo[]>("list_postgres_types", {
    connectionId,
    expectedDatabase: expectedDatabase ?? null,
  });
}
