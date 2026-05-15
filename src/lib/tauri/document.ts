// ── Document paradigm ──────────────────────────────────────────────────────
// Thin JSON passthroughs to the matching Rust commands. The backend
// enforces paradigm via `ActiveAdapter::as_document()`, so calling these
// against an RDB connection surfaces `AppError::Unsupported` rather than
// silently returning empty results.

import { invoke } from "@tauri-apps/api/core";
import type {
  CollectionInfo,
  DatabaseInfo,
  DocumentQueryResult,
  DocumentRow,
  FindBody,
} from "@/types/document";
import type {
  BulkWriteOp,
  BulkWriteResult,
  DocumentId,
} from "@/types/documentMutate";
import type { ColumnInfo, IndexInfo } from "@/types/schema";

import { wrapNumericCells } from "./numericWrap";

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
 * Sprint 332 (Slice J live wire) — list every index on `collection`. Returns
 * the same `IndexInfo` shape as the RDB `getTableIndexes` so the index grid
 * is paradigm-agnostic.
 */
export async function listMongoIndexes(
  connectionId: string,
  database: string,
  collection: string,
): Promise<IndexInfo[]> {
  return invoke<IndexInfo[]>("list_mongo_indexes", {
    connectionId,
    database,
    collection,
  });
}

/**
 * Sprint 333 (Slice K live wire) — read the validator stored on
 * `collection` (Mongo `listCollections.options.validator`). Returns
 * `null` when the collection has no validator configured.
 */
export async function getMongoValidator(
  connectionId: string,
  database: string,
  collection: string,
): Promise<Record<string, unknown> | null> {
  return invoke<Record<string, unknown> | null>("get_mongo_validator", {
    connectionId,
    database,
    collection,
  });
}

/**
 * Sprint 333 (Slice K live wire) — apply (`validator !== null`) or
 * clear (`validator === null`) the collection validator. validationLevel
 * + validationAction are server-side defaulted to "moderate" / "error".
 */
export async function setMongoValidator(
  connectionId: string,
  database: string,
  collection: string,
  validator: Record<string, unknown> | null,
): Promise<void> {
  return invoke<void>("set_mongo_validator", {
    connectionId,
    database,
    collection,
    validator,
  });
}

/**
 * Sprint 334 (Slice L live wire) — create a Mongo collection. `options`
 * (capped, timeseries, validator, …) passes through to `runCommand
 * create` unchanged.
 */
export async function createCollection(
  connectionId: string,
  database: string,
  collection: string,
  options: Record<string, unknown> | null = null,
): Promise<void> {
  return invoke<void>("create_collection", {
    connectionId,
    database,
    collection,
    options,
  });
}

/**
 * Sprint 334 (Slice L live wire) — rename a Mongo collection in-place
 * (same database). Cross-DB rename is deferred — backend rejects.
 */
export async function renameCollection(
  connectionId: string,
  database: string,
  from: string,
  to: string,
): Promise<void> {
  return invoke<void>("rename_collection", {
    connectionId,
    database,
    from,
    to,
  });
}

/**
 * Sprint 335 (Slice M live wire) — drop the entire Mongo database. The
 * driver is idempotent (dropping a non-existent DB succeeds).
 */
export async function dropMongoDatabase(
  connectionId: string,
  name: string,
): Promise<void> {
  return invoke<void>("drop_mongo_database", { connectionId, name });
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
  const result = await invoke<DocumentQueryResult>("find_documents", {
    connectionId,
    database,
    collection,
    body: body ?? null,
  });
  return wrapNumericCells(result);
}

/**
 * Execute a MongoDB aggregation pipeline and return the flattened
 * DataGrid-ready result. The backend expects `pipeline` as a JSON array
 * of stages, each serialisable into `bson::Document`.
 */
export async function aggregateDocuments(
  connectionId: string,
  database: string,
  collection: string,
  pipeline: Record<string, unknown>[],
): Promise<DocumentQueryResult> {
  const result = await invoke<DocumentQueryResult>("aggregate_documents", {
    connectionId,
    database,
    collection,
    pipeline,
  });
  return wrapNumericCells(result);
}

// ── Document paradigm — mutate ─────────────────────────────────────────────
// Wrappers for the `insert_document` / `update_document` / `delete_document`
// commands. Payloads use the `DocumentId` tagged union from
// `@/types/documentMutate`, whose shape matches Rust's default serde
// encoding (`{"ObjectId": "<hex>"}`, …) so no translation layer is needed.

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

// ── Document paradigm — bulk-write ─────────────────────────────────────────
// Plain invoke wrappers. The Safe Mode gate runs at each call site
// (SchemaTree drop / DocumentDataGrid toolbar) before invoke, so this
// layer has no gate responsibility.

/**
 * Bulk-delete every document matching `filter`. Returns the driver's
 * `deleted_count` so the UI can surface "N row(s) deleted". Empty filter
 * (`{}`) is allowed here; the Safe Mode classifier gates upstream.
 */
export async function deleteMany(
  connectionId: string,
  database: string,
  collection: string,
  filter: Record<string, unknown>,
): Promise<number> {
  return invoke<number>("delete_many", {
    connectionId,
    database,
    collection,
    filter,
  });
}

/**
 * Bulk-apply `{ $set: patch }` to every document matching `filter`.
 * Returns the driver's `modified_count`. Backend rejects `_id` in
 * `patch` — same contract as `updateDocument`.
 */
export async function updateMany(
  connectionId: string,
  database: string,
  collection: string,
  filter: Record<string, unknown>,
  patch: Record<string, unknown>,
): Promise<number> {
  return invoke<number>("update_many", {
    connectionId,
    database,
    collection,
    filter,
    patch,
  });
}

/**
 * Drop the entire collection. Mongo parallel of RDB `dropTable`;
 * Safe Mode classifier always tags this as `danger`.
 */
export async function dropCollection(
  connectionId: string,
  database: string,
  collection: string,
): Promise<void> {
  return invoke<void>("drop_collection", {
    connectionId,
    database,
    collection,
  });
}

// ── Sprint 308 (2026-05-14) — mongosh dispatch wrappers ───────────────────
//
// 작성 이유: A1 mongosh 파서가 dispatch 할 6 신규 IPC. 각 함수는 단순
// `invoke<T>(...)` passthrough — Safe Mode / Run dispatch gate 는 A5/A6 가
// 호출 측에서 처리한다 (이 layer 는 thin wire layer).

/**
 * Execute `db.coll.findOne(<filter>)` and return a single
 * {@link DocumentRow} (columns + projected row + raw BSON) or `null` when
 * the filter matches nothing.
 */
export async function findOneDocument(
  connectionId: string,
  database: string,
  collection: string,
  filter?: Record<string, unknown>,
  queryId?: string,
): Promise<DocumentRow | null> {
  return invoke<DocumentRow | null>("find_one_document", {
    connectionId,
    database,
    collection,
    filter: filter ?? null,
    queryId: queryId ?? null,
  });
}

/**
 * Execute `db.coll.countDocuments(<filter>)` — exact match count via a
 * full scan. For the cheap metadata estimate use
 * {@link estimatedDocumentCount}.
 */
export async function countDocuments(
  connectionId: string,
  database: string,
  collection: string,
  filter?: Record<string, unknown>,
  queryId?: string,
): Promise<number> {
  return invoke<number>("count_documents", {
    connectionId,
    database,
    collection,
    filter: filter ?? null,
    queryId: queryId ?? null,
  });
}

/**
 * Execute `db.coll.estimatedDocumentCount()` — O(1) metadata estimate of
 * the total document count.
 */
export async function estimatedDocumentCount(
  connectionId: string,
  database: string,
  collection: string,
  queryId?: string,
): Promise<number> {
  return invoke<number>("estimated_document_count", {
    connectionId,
    database,
    collection,
    queryId: queryId ?? null,
  });
}

/**
 * Execute `db.coll.distinct(<field>, <filter>)` and return the unique
 * values flattened through the same `flatten_cell` helper the other read
 * commands use (canonical EJSON for non-numeric BSON discriminators,
 * plain JSON for scalars).
 */
export async function distinctDocuments(
  connectionId: string,
  database: string,
  collection: string,
  field: string,
  filter?: Record<string, unknown>,
  queryId?: string,
): Promise<unknown[]> {
  return invoke<unknown[]>("distinct_documents", {
    connectionId,
    database,
    collection,
    field,
    filter: filter ?? null,
    queryId: queryId ?? null,
  });
}

/**
 * Bulk-insert multiple documents. Returns the assigned `_id` for each
 * input document in **input order** (`DocumentId[]`). Empty input
 * short-circuits to `[]` without a driver round-trip.
 */
export async function insertManyDocuments(
  connectionId: string,
  database: string,
  collection: string,
  documents: Record<string, unknown>[],
): Promise<DocumentId[]> {
  return invoke<DocumentId[]>("insert_many_documents", {
    connectionId,
    database,
    collection,
    documents,
  });
}

/**
 * Execute `db.coll.bulkWrite([...])` — heterogeneous mix of insertOne /
 * updateOne / updateMany / deleteOne / deleteMany / replaceOne. Driver's
 * `ordered: true` default applies (first error short-circuits the
 * remaining ops). Empty input short-circuits to a zero-counter result.
 */
export async function bulkWriteDocuments(
  connectionId: string,
  database: string,
  collection: string,
  operations: BulkWriteOp[],
): Promise<BulkWriteResult> {
  return invoke<BulkWriteResult>("bulk_write_documents", {
    connectionId,
    database,
    collection,
    operations,
  });
}
