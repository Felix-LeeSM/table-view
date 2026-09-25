import type { ColumnCategory } from "@/lib/columnCategory";

/**
 * Document paradigm — wire types for the Tauri bridge.
 *
 * These mirror the Rust shapes defined in `commands/document/*` and
 * `db/mod.rs`. Shape naming stays paradigm-neutral (`DatabaseInfo`,
 * `CollectionInfo`) rather than mongo-specific so the same surface can be
 * reused by future document engines (CouchDB, Elasticsearch's _source, …).
 *
 * BSON-specific structures (`bson::Document`, `bson::Bson`) come across the
 * wire as JSON. The driver emits **canonical extended JSON** for any nested
 * scalar values — `ObjectId` → `{ "$oid": "..." }`, `DateTime` → `{ "$date":
 * ... }`, `Int64` → `{ "$numberLong": "..." }`, etc. Nested documents and
 * arrays in cell positions are flattened to sentinel strings (`"{...}"` and
 * `"[N items]"`) before reaching `rows`; the full value survives in
 * `rawDocuments` for the Quick Look panel.
 */

/**
 * A MongoDB database — the `list_mongo_databases` response item. Mirrors
 * `DatabaseInfo { name }` on the backend.
 */
export interface DatabaseInfo {
  name: string;
}

/**
 * MongoDB's system databases (users do not usually touch them). `admin` is
 * the gateway for auth / roles / runCommand, `config` holds sharded cluster
 * metadata (almost empty on a single node), and `local` holds the
 * replication oplog. The sidebar sets them apart visually from user DBs
 * (italic + muted) and sorts them to the bottom.
 */
export const MONGO_SYSTEM_DATABASES = ["admin", "config", "local"] as const;

export function isMongoSystemDatabase(name: string): boolean {
  return (MONGO_SYSTEM_DATABASES as readonly string[]).includes(name);
}

/**
 * A MongoDB collection — the `list_mongo_collections` response item. The
 * backend derives `document_count` from the server's cheap metadata
 * estimate when available; frontends must treat `null` as "unknown" rather
 * than zero.
 */
export interface CollectionInfo {
  name: string;
  database: string;
  collection_type: "collection" | "view" | "timeseries";
  document_count: number | null;
  read_only: boolean;
  options: Record<string, unknown>;
  id_index: Record<string, unknown> | null;
}

/**
 * A single DataGrid column description surfaced by the document read-path.
 * Mirrors the Rust `QueryColumn` struct, including `category`.
 */
export interface DocumentColumn {
  name: string;
  dataType: string;
  category: ColumnCategory;
}

/**
 * Request body for `find_documents`. Matches the Rust `FindBody`. All
 * fields are optional from the caller's perspective — the backend applies
 * `Default::default()` when absent (empty filter, no sort/projection, skip
 * 0, limit 0).
 *
 * `filter` / `sort` / `projection` use the same shape the MongoDB driver
 * consumes internally (`{ field: value }`); we keep them typed as
 * `Record<string, unknown>` so the frontend can build them idiomatically
 * without a BSON serialiser.
 */
export interface FindBody {
  filter?: Record<string, unknown>;
  sort?: Record<string, unknown>;
  projection?: Record<string, unknown>;
  skip?: number;
  limit?: number;
}

/**
 * The flattened result shape consumed by the DataGrid. `rows` carry
 * already-sentinelised cell values; `rawDocuments` preserve the original
 * document so the Quick Look panel can render the full tree.
 */
export interface DocumentQueryResult {
  columns: DocumentColumn[];
  rows: unknown[][];
  rawDocuments: Record<string, unknown>[];
  totalCount: number;
  executionTimeMs: number;
  /**
   * Issue #1231 — `true` when the find/aggregate cursor hit the raw-query row
   * cap and documents beyond the cap were dropped at fetch time.
   */
  truncated?: boolean;
}

/**
 * 2026-05-14 — single-document projection.
 *
 * Reason: the wire shape the Rust side returns when the A1 mongosh parser
 * dispatches `db.coll.findOne(<filter>)`; the result renders as a single-row
 * grid. `columns` is BFS-ordered with `_id` first, same as
 * `DocumentQueryResult`; `row` is the sentinel-flattened cell array; `raw`
 * is the original BSON.
 */
export interface DocumentRow {
  columns: DocumentColumn[];
  row: unknown[];
  raw: Record<string, unknown>;
}

/** Sentinel strings emitted by the backend when a cell holds a composite. */
export const DOCUMENT_SENTINELS = {
  DOCUMENT: "{...}",
  ARRAY_PREFIX: "[",
  ARRAY_SUFFIX: " items]",
} as const;

/**
 * Returns `true` when a cell value is a composite sentinel (nested
 * document or array) and therefore not directly editable by the DataGrid.
 */
export function isDocumentSentinel(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (value === DOCUMENT_SENTINELS.DOCUMENT) return true;
  // "[N items]" — accept any non-negative integer count.
  return /^\[\d+ items\]$/.test(value);
}
