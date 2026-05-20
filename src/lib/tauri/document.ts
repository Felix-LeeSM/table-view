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
import {
  normalizeDocumentId,
  normalizeDocumentQueryResult,
  normalizeDocumentRow,
  normalizeBulkWriteResult,
} from "@lib/wireCamelCase";

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

// ── Sprint 351 (2026-05-15) — Mongo index CRUD ──────────────────────────
//
// Direction is a string enum on the wire so payloads are self-documenting;
// the Rust side maps `asc` / `desc` → `1` / `-1` when assembling the BSON
// key document.

export type MongoIndexDirection = "asc" | "desc";

export interface MongoIndexField {
  name: string;
  direction: MongoIndexDirection;
}

export interface MongoIndexCollation {
  locale: string;
  /** ICU level 1..=5. Omitted leaves the driver default (Tertiary). */
  strength?: number;
}

export interface CreateMongoIndexRequest {
  name?: string;
  fields: MongoIndexField[];
  unique?: boolean;
  sparse?: boolean;
  /** TTL — only valid on single-field indexes; backend rejects otherwise. */
  expireAfterSeconds?: number;
  /** Raw JSON object — backend rejects non-object payloads. */
  partialFilterExpression?: Record<string, unknown>;
  collation?: MongoIndexCollation;
}

export interface CreateMongoIndexResult {
  name: string;
}

/**
 * Sprint 351 — create a Mongo collection index with the full option set.
 * On success returns the canonical server-assigned name (so the toast can
 * carry e.g. `Index "email_1" created`).
 */
export async function createMongoIndex(
  connectionId: string,
  database: string,
  collection: string,
  request: CreateMongoIndexRequest,
): Promise<CreateMongoIndexResult> {
  return invoke<CreateMongoIndexResult>("create_mongo_index", {
    connectionId,
    database,
    collection,
    request,
  });
}

/**
 * Sprint 351 — drop a Mongo collection index by canonical name. Dropping
 * `_id_` is rejected at the Tauri layer with `AppError::Validation`.
 */
export async function dropMongoIndex(
  connectionId: string,
  database: string,
  collection: string,
  name: string,
): Promise<void> {
  return invoke<void>("drop_mongo_index", {
    connectionId,
    database,
    collection,
    name,
  });
}

/**
 * Sprint 352 — whitelisted MongoDB `validationLevel` values. `off`
 * disables validation, `strict` rejects every operation that violates
 * the rule, `moderate` only rejects operations on documents that
 * already matched the rule (migration pattern).
 */
export type MongoValidationLevel = "off" | "strict" | "moderate";

/**
 * Sprint 352 — whitelisted MongoDB `validationAction` values. `error`
 * rejects offending writes, `warn` accepts them and logs.
 */
export type MongoValidationAction = "error" | "warn";

/**
 * Sprint 352 — round-trip shape for {@link getMongoValidator}. The
 * three fields are independent: any field is `null` when MongoDB has
 * not persisted a custom value (the UI then falls back to the
 * MongoDB defaults `strict` / `error`).
 *
 * Backward compat note: a pre-Sprint-352 backend or test stub may
 * still return the legacy shape `{ validator } | null` — callers that
 * destructure should normalise via the `?? null` pattern so missing
 * `validationLevel` / `validationAction` cleanly fall through to the
 * MongoDB defaults.
 */
export interface MongoValidatorRead {
  validator: Record<string, unknown> | null;
  validationLevel: MongoValidationLevel | null;
  validationAction: MongoValidationAction | null;
}

/**
 * Sprint 333/352 (Slice K live wire) — read the validator stored on
 * `collection` (Mongo `listCollections.options.validator`) together
 * with the persisted `validationLevel` / `validationAction`. Each
 * field is `null` when MongoDB has not stored a value; the UI then
 * falls back to the MongoDB defaults (`strict` / `error`).
 */
export async function getMongoValidator(
  connectionId: string,
  database: string,
  collection: string,
): Promise<MongoValidatorRead> {
  return invoke<MongoValidatorRead>("get_mongo_validator", {
    connectionId,
    database,
    collection,
  });
}

/**
 * Sprint 333/352 (Slice K live wire) — apply (`validator !== null`)
 * or clear (`validator === null`) the collection validator. Sprint
 * 352 adds optional `validationLevel` / `validationAction` positional
 * args; legacy callers that pass only `(connectionId, database,
 * collection, validator)` keep working, since both optional fields
 * default to `null` and the backend then omits them from the
 * `collMod` doc — MongoDB applies its server-side defaults.
 */
export async function setMongoValidator(
  connectionId: string,
  database: string,
  collection: string,
  validator: Record<string, unknown> | null,
  validationLevel: MongoValidationLevel | null = null,
  validationAction: MongoValidationAction | null = null,
): Promise<void> {
  return invoke<void>("set_mongo_validator", {
    connectionId,
    database,
    collection,
    validator,
    validationLevel,
    validationAction,
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
  const result = await invoke<unknown>("find_documents", {
    connectionId,
    database,
    collection,
    body: body ?? null,
  });
  return wrapNumericCells(normalizeDocumentQueryResult(result));
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
  const result = await invoke<unknown>("aggregate_documents", {
    connectionId,
    database,
    collection,
    pipeline,
  });
  return wrapNumericCells(normalizeDocumentQueryResult(result));
}

// ── Document paradigm — mutate ─────────────────────────────────────────────
// Wrappers for the `insert_document` / `update_document` / `delete_document`
// commands. Payloads use the `DocumentId` tagged union from
// `@/types/documentMutate`, whose shape matches Rust's camelCase serde
// encoding (`{"objectId": "<hex>"}`, …).

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
  const id = await invoke<unknown>("insert_document", {
    connectionId,
    database,
    collection,
    document,
  });
  return normalizeDocumentId(id);
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
  const result = await invoke<unknown | null>("find_one_document", {
    connectionId,
    database,
    collection,
    filter: filter ?? null,
    queryId: queryId ?? null,
  });
  if (result === null) return null;
  const row = normalizeDocumentRow(result);
  wrapNumericCells({ columns: row.columns, rows: [row.row] });
  return row;
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
  const ids = await invoke<unknown[]>("insert_many_documents", {
    connectionId,
    database,
    collection,
    documents,
  });
  return ids.map(normalizeDocumentId);
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
  const result = await invoke<unknown>("bulk_write_documents", {
    connectionId,
    database,
    collection,
    operations,
  });
  return normalizeBulkWriteResult(result);
}

/**
 * Sprint 381 (2026-05-17) — generic `db.runCommand({...})` /
 * `db.adminCommand({...})` gateway. mongosh 의 모든 admin/diagnostic
 * helper 가 본질적으로 runCommand wrapper 이므로 single IPC 로 묶었다.
 *
 * `database`:
 *   - `null` ⇒ backend 가 driver 의 `admin` DB context 에서 실행
 *     (`adminCommand` / global commands).
 *   - 그 외 ⇒ 해당 db (`dbStats`, `collStats` 등 db-scoped).
 *
 * 결과는 driver 의 raw response 를 canonical EJSON 으로 직렬화한
 * `unknown` (JSON-compatible). 호출자가 paradigm-neutral JSON viewer 로
 * 렌더한다.
 */
export async function runMongoCommand(
  connectionId: string,
  database: string | null,
  command: Record<string, unknown>,
): Promise<unknown> {
  return invoke<unknown>("run_mongo_command", {
    connectionId,
    database,
    command,
  });
}
