import { invoke } from "@tauri-apps/api/core";
import type { ConnectionConfig, ConnectionGroup } from "../types/connection";
import type { QueryResult } from "../types/query";
import type {
  AddConstraintRequest,
  AlterTableRequest,
  ColumnInfo,
  ConstraintInfo,
  CreateIndexRequest,
  DropIndexRequest,
  DropConstraintRequest,
  FilterCondition,
  FunctionInfo,
  IndexInfo,
  SchemaChangeResult,
  SchemaInfo,
  TableData,
  TableInfo,
  ViewInfo,
} from "../types/schema";

export async function listConnections(): Promise<ConnectionConfig[]> {
  return invoke<ConnectionConfig[]>("list_connections");
}

export async function saveConnection(
  connection: ConnectionConfig,
  isNew: boolean,
): Promise<ConnectionConfig> {
  return invoke<ConnectionConfig>("save_connection", {
    connection,
    isNew,
  });
}

export async function deleteConnection(id: string): Promise<void> {
  return invoke("delete_connection", { id });
}

export async function testConnection(
  config: ConnectionConfig,
): Promise<string> {
  return invoke<string>("test_connection", { config });
}

export async function connectToDatabase(id: string): Promise<void> {
  return invoke("connect", { id });
}

export async function disconnectFromDatabase(id: string): Promise<void> {
  return invoke("disconnect", { id });
}

export async function listGroups(): Promise<ConnectionGroup[]> {
  return invoke<ConnectionGroup[]>("list_groups");
}

export async function saveGroup(
  group: ConnectionGroup,
  isNew: boolean,
): Promise<ConnectionGroup> {
  return invoke<ConnectionGroup>("save_group", { group, isNew });
}

export async function deleteGroup(id: string): Promise<void> {
  return invoke("delete_group", { id });
}

export async function moveConnectionToGroup(
  connectionId: string,
  groupId: string | null,
): Promise<void> {
  return invoke("move_connection_to_group", {
    connectionId,
    groupId,
  });
}

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

export async function queryTableData(
  connectionId: string,
  table: string,
  schema: string,
  page?: number,
  pageSize?: number,
  orderBy?: string,
  filters?: FilterCondition[],
  rawWhere?: string,
): Promise<TableData> {
  return invoke<TableData>("query_table_data", {
    connectionId,
    table,
    schema,
    page: page ?? null,
    pageSize: pageSize ?? null,
    orderBy: orderBy ?? null,
    filters: filters ?? null,
    rawWhere: rawWhere ?? null,
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

// Query execution
export async function executeQuery(
  connectionId: string,
  sql: string,
  queryId: string,
): Promise<QueryResult> {
  return invoke<QueryResult>("execute_query", {
    connectionId,
    sql,
    queryId,
  });
}

export async function cancelQuery(queryId: string): Promise<string> {
  return invoke<string>("cancel_query", { queryId });
}

// Table management
export async function dropTable(
  connectionId: string,
  table: string,
  schema: string,
): Promise<void> {
  return invoke("drop_table", { connectionId, table, schema });
}

export async function renameTable(
  connectionId: string,
  table: string,
  schema: string,
  newName: string,
): Promise<void> {
  return invoke("rename_table", { connectionId, table, schema, newName });
}

// Schema change operations
export async function alterTable(
  request: AlterTableRequest,
): Promise<SchemaChangeResult> {
  return invoke<SchemaChangeResult>("alter_table", { request });
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
