import { invoke } from "@tauri-apps/api/core";
import type {
  ColumnInfo,
  ConstraintInfo,
  FunctionInfo,
  IndexInfo,
  PostgresTypeInfo,
  SchemaInfo,
  TableInfo,
  ViewInfo,
} from "@/types/schema";

// Schema exploration
export async function listSchemas(connectionId: string): Promise<SchemaInfo[]> {
  return invoke<SchemaInfo[]>("list_schemas", { connectionId });
}

export async function listTables(
  connectionId: string,
  schema: string,
): Promise<TableInfo[]> {
  return invoke<TableInfo[]>("list_tables", { connectionId, schema });
}

export async function getTableColumns(
  connectionId: string,
  table: string,
  schema: string,
): Promise<ColumnInfo[]> {
  return invoke<ColumnInfo[]>("get_table_columns", {
    connectionId,
    table,
    schema,
  });
}

export async function listSchemaColumns(
  connectionId: string,
  schema: string,
): Promise<Record<string, ColumnInfo[]>> {
  return invoke<Record<string, ColumnInfo[]>>("list_schema_columns", {
    connectionId,
    schema,
  });
}

export async function getTableIndexes(
  connectionId: string,
  table: string,
  schema: string,
): Promise<IndexInfo[]> {
  return invoke<IndexInfo[]>("get_table_indexes", {
    connectionId,
    table,
    schema,
  });
}

export async function getTableConstraints(
  connectionId: string,
  table: string,
  schema: string,
): Promise<ConstraintInfo[]> {
  return invoke<ConstraintInfo[]>("get_table_constraints", {
    connectionId,
    table,
    schema,
  });
}

// Views & Functions
export async function listViews(
  connectionId: string,
  schema: string,
): Promise<ViewInfo[]> {
  return invoke<ViewInfo[]>("list_views", { connectionId, schema });
}

export async function listFunctions(
  connectionId: string,
  schema: string,
): Promise<FunctionInfo[]> {
  return invoke<FunctionInfo[]>("list_functions", { connectionId, schema });
}

export async function getViewDefinition(
  connectionId: string,
  schema: string,
  viewName: string,
): Promise<string> {
  return invoke<string>("get_view_definition", {
    connectionId,
    schema,
    viewName,
  });
}

export async function getViewColumns(
  connectionId: string,
  schema: string,
  viewName: string,
): Promise<ColumnInfo[]> {
  return invoke<ColumnInfo[]>("get_view_columns", {
    connectionId,
    schema,
    viewName,
  });
}

export async function getFunctionSource(
  connectionId: string,
  schema: string,
  functionName: string,
): Promise<string> {
  return invoke<string>("get_function_source", {
    connectionId,
    schema,
    functionName,
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
 */
export async function listPostgresTypes(
  connectionId: string,
): Promise<PostgresTypeInfo[]> {
  return invoke<PostgresTypeInfo[]>("list_postgres_types", { connectionId });
}
