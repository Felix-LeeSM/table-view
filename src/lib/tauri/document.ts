// ── Document paradigm (Sprint 66) ──────────────────────────────────────────
// Each wrapper is a thin JSON passthrough to the matching Rust command. The
// backend enforces paradigm via `ActiveAdapter::as_document()`, so calling
// these against an RDB connection surfaces `AppError::Unsupported` rather
// than silently returning empty results.

import { invoke } from "@tauri-apps/api/core";
import type {
  CollectionInfo,
  DatabaseInfo,
  DocumentQueryResult,
  FindBody,
} from "@/types/document";
import type { DocumentId } from "@/types/documentMutate";
import type { ColumnInfo } from "@/types/schema";

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

// ── Document paradigm — bulk-write (Sprint 198) ────────────────────────────
// Sprint 197 의 mutations.rs 위에 얹은 3 신규 command 의 frontend shim.
// 각 caller (SchemaTree drop / DocumentDataGrid toolbar) 는 invoke 직전
// `analyzeMongoOperation(...)` → `useSafeModeGate.decide(...)` 으로 위험
// 분류를 통과시킨다. 본 shim 자체는 gate 책임 없음 — 단순 invoke wrapper.

/**
 * Sprint 198 — bulk-delete every document matching `filter`. Returns the
 * driver's `deleted_count` so the UI can surface a "N row(s) deleted" toast.
 * Empty filter (`{}`) is allowed at this layer; Safe Mode classifier gates.
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
 * Sprint 198 — bulk-apply `{ $set: patch }` to every document matching
 * `filter`. Returns the driver's `modified_count`. Backend rejects `_id` in
 * `patch` (identity mutation) — same contract as `updateDocument`.
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
 * Sprint 198 — drop the entire collection. Mongo parallel of RDB
 * `dropTable`; Safe Mode classifier always tags this as `danger`.
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
