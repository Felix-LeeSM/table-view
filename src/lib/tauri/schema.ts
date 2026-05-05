import { invoke } from "@tauri-apps/api/core";
import type {
  ColumnInfo,
  ConstraintInfo,
  FunctionInfo,
  IndexInfo,
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
