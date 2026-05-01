import { invoke } from "@tauri-apps/api/core";
import type {
  ConnectionConfig,
  ConnectionDraft,
  ConnectionGroup,
} from "@/types/connection";
import type { QueryResult } from "@/types/query";
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
} from "@/types/schema";
import type {
  CollectionInfo,
  DatabaseInfo,
  DocumentQueryResult,
  FindBody,
} from "@/types/document";
import type { DocumentId } from "@/types/documentMutate";

export async function listConnections(): Promise<ConnectionConfig[]> {
  return invoke<ConnectionConfig[]>("list_connections");
}

/**
 * Save a connection. The `draft` carries everything except `password`, which
 * has its own three-way semantics: `null` → keep existing, `""` → clear,
 * non-empty → set new. The backend never echoes the password back.
 */
export async function saveConnection(
  draft: ConnectionDraft,
  isNew: boolean,
): Promise<ConnectionConfig> {
  const { password, ...connection } = draft;
  return invoke<ConnectionConfig>("save_connection", {
    req: {
      connection: { ...connection, has_password: false },
      password,
      is_new: isNew,
    },
  });
}

export async function deleteConnection(id: string): Promise<void> {
  return invoke("delete_connection", { id });
}

/**
 * Test a connection. When editing an existing connection the dialog should
 * pass `existingId` so the backend can substitute the stored password if
 * the user left the password input empty.
 */
export async function testConnection(
  draft: ConnectionDraft,
  existingId: string | null = null,
): Promise<string> {
  const { password, ...rest } = draft;
  return invoke<string>("test_connection", {
    req: {
      config: { ...rest, has_password: false },
      password,
      existing_id: existingId,
    },
  });
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

// --- Import / Export ---

export interface ImportRenamedEntry {
  original_name: string;
  new_name: string;
}

export interface ImportResult {
  imported: string[];
  renamed: ImportRenamedEntry[];
  created_groups: string[];
  skipped_groups: string[];
}

export async function exportConnections(ids: string[]): Promise<string> {
  return invoke<string>("export_connections", { ids });
}

export async function importConnections(json: string): Promise<ImportResult> {
  return invoke<ImportResult>("import_connections", { json });
}

/**
 * Sprint 140 — encrypted export. The backend wraps the plain `ExportPayload`
 * JSON in an `EncryptedEnvelope` (Argon2id KDF + AES-256-GCM AEAD) using
 * the supplied master password. Returns the envelope serialised as
 * pretty JSON. The backend rejects passwords shorter than 8 characters.
 */
export async function exportConnectionsEncrypted(
  ids: string[],
  masterPassword: string,
): Promise<string> {
  return invoke<string>("export_connections_encrypted", {
    ids,
    masterPassword,
  });
}

/**
 * Sprint 140 — encrypted import. Accepts either an `EncryptedEnvelope` JSON
 * (auto-detected via `kdf` + `ciphertext` fields) or a plain `ExportPayload`
 * JSON. When the payload is an envelope, `masterPassword` is required and
 * a wrong password surfaces the canonical message
 * `Incorrect master password — the file could not be decrypted`. For
 * plain JSON the password is ignored.
 */
export async function importConnectionsEncrypted(
  payload: string,
  masterPassword: string,
): Promise<ImportResult> {
  return invoke<ImportResult>("import_connections_encrypted", {
    payload,
    masterPassword,
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

export async function listSchemaColumns(
  connectionId: string,
  schema: string,
): Promise<Record<string, ColumnInfo[]>> {
  return invoke<Record<string, ColumnInfo[]>>("list_schema_columns", {
    connectionId,
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

// ── Document paradigm (Sprint 66) ──────────────────────────────────────────
// Each wrapper is a thin JSON passthrough to the matching Rust command. The
// backend enforces paradigm via `ActiveAdapter::as_document()`, so calling
// these against an RDB connection surfaces `AppError::Unsupported` rather
// than silently returning empty results.

/** List every database visible to the connected MongoDB user. */
export async function listMongoDatabases(
  connectionId: string,
): Promise<DatabaseInfo[]> {
  return invoke<DatabaseInfo[]>("list_mongo_databases", { connectionId });
}

/** List every collection inside `database` for the connected MongoDB client. */
export async function listMongoCollections(
  connectionId: string,
  database: string,
): Promise<CollectionInfo[]> {
  return invoke<CollectionInfo[]>("list_mongo_collections", {
    connectionId,
    database,
  });
}

/**
 * Infer the top-level column layout of `collection` by sampling up to
 * `sampleSize` documents. Defaults to 100 on the backend when omitted.
 */
export async function inferCollectionFields(
  connectionId: string,
  database: string,
  collection: string,
  sampleSize?: number,
): Promise<ColumnInfo[]> {
  return invoke<ColumnInfo[]>("infer_collection_fields", {
    connectionId,
    database,
    collection,
    sampleSize: sampleSize ?? null,
  });
}

/** Execute a MongoDB `find` and return a flattened DataGrid-ready result. */
export async function findDocuments(
  connectionId: string,
  database: string,
  collection: string,
  body?: FindBody,
): Promise<DocumentQueryResult> {
  return invoke<DocumentQueryResult>("find_documents", {
    connectionId,
    database,
    collection,
    body: body ?? null,
  });
}

/**
 * Execute a MongoDB aggregation pipeline and return the flattened
 * DataGrid-ready result. The backend (Sprint 72) expects `pipeline` as a
 * JSON array of stages, each serialisable into `bson::Document`.
 */
export async function aggregateDocuments(
  connectionId: string,
  database: string,
  collection: string,
  pipeline: Record<string, unknown>[],
): Promise<DocumentQueryResult> {
  return invoke<DocumentQueryResult>("aggregate_documents", {
    connectionId,
    database,
    collection,
    pipeline,
  });
}

// ── Document paradigm — mutate (Sprint 86) ─────────────────────────────────
// Wrappers for the Sprint 80 backend `insert_document` / `update_document` /
// `delete_document` Tauri commands. Payloads use the `DocumentId` tagged
// union from `@/types/documentMutate`, whose shape matches Rust's default
// serde encoding (`{"ObjectId": "<hex>"}`, `{"String": "<s>"}`, etc.) so no
// translation layer is needed between TS and the Tauri bridge.

/**
 * Insert a single document into `collection`. When the document carries an
 * `_id` field that value is used verbatim; otherwise the MongoDB server
 * generates one. The returned `DocumentId` is the inserted id in either case,
 * so the UI can pair the returned payload with the row the user just added.
 */
export async function insertDocument(
  connectionId: string,
  database: string,
  collection: string,
  document: Record<string, unknown>,
): Promise<DocumentId> {
  return invoke<DocumentId>("insert_document", {
    connectionId,
    database,
    collection,
    document,
  });
}

/**
 * Apply `{ $set: patch }` to the document identified by `documentId`. The
 * backend rejects a patch that contains a top-level `_id` field; the
 * frontend `mqlGenerator` also guards the same case so the preview never
 * contains an unexecutable statement.
 */
export async function updateDocument(
  connectionId: string,
  database: string,
  collection: string,
  documentId: DocumentId,
  patch: Record<string, unknown>,
): Promise<void> {
  return invoke<void>("update_document", {
    connectionId,
    database,
    collection,
    documentId,
    patch,
  });
}

/**
 * Delete the document identified by `documentId`. The backend surfaces an
 * `AppError::NotFound` when the filter matches nothing (deleted_count == 0);
 * callers should propagate that via the standard fetch-data error path.
 */
export async function deleteDocument(
  connectionId: string,
  database: string,
  collection: string,
  documentId: DocumentId,
): Promise<void> {
  return invoke<void>("delete_document", {
    connectionId,
    database,
    collection,
    documentId,
  });
}

// ── Sprint 181 — Export grid rows ──────────────────────────────────────────

export type ExportFormat = "csv" | "tsv" | "sql" | "json";

export type ExportContext =
  | { kind: "table"; schema: string; name: string }
  | { kind: "collection"; name: string }
  | {
      kind: "query";
      source_table: { schema: string; name: string } | null;
    };

export interface ExportSummary {
  rows_written: number;
  bytes_written: number;
}

/**
 * Stream the supplied rows to `targetPath` in the requested `format`. All
 * encoding decisions (CSV escape / SQL identifier quoting / Mongo Extended
 * JSON shape) live in the Rust handler so output is deterministic across
 * platforms. Pass `exportId` to register a cooperative cancel token in the
 * Sprint 180 query-token registry.
 */
export async function exportGridRows(
  format: ExportFormat,
  targetPath: string,
  headers: string[],
  rows: unknown[][],
  context: ExportContext,
  exportId: string | null = null,
): Promise<ExportSummary> {
  return invoke<ExportSummary>("export_grid_rows", {
    format,
    targetPath,
    headers,
    rows,
    context,
    exportId,
  });
}
