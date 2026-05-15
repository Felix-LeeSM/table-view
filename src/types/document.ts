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
 * `raw_documents` for the Quick Look panel.
 */

/**
 * A MongoDB database — the `list_mongo_databases` response item. Mirrors
 * `DatabaseInfo { name }` on the backend.
 */
export interface DatabaseInfo {
  name: string;
}

/**
 * Sprint 346 — MongoDB 의 시스템 데이터베이스 (사용자가 평소 안 건드림).
 * `admin` 은 인증 / role / runCommand 의 출입구, `config` 는 sharded
 * cluster metadata (단일 노드에선 거의 비어있음), `local` 은 replication
 * oplog. sidebar 에선 사용자 DB 와 시각 구분 (italic + muted) 하고 정렬
 * 시 맨 아래로.
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
  document_count: number | null;
}

/**
 * A single DataGrid column description surfaced by the document read-path.
 * Mirrors the Rust `QueryColumn` struct (Sprint 238 added `category`).
 */
export interface DocumentColumn {
  name: string;
  data_type: string;
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
 * Request body for `aggregate_documents`. The backend expects a JSON array
 * of stages; each element is passed through to `bson::Document` via serde.
 * This type exists so call sites can spell the shape once
 * (`AggregateBody["pipeline"]`) rather than re-typing the
 * `Record<string, unknown>[]` at every boundary.
 */
export interface AggregateBody {
  pipeline: Record<string, unknown>[];
}

/**
 * The flattened result shape consumed by the DataGrid. `rows` carry
 * already-sentinelised cell values; `raw_documents` preserve the original
 * document so the Quick Look panel can render the full tree.
 */
export interface DocumentQueryResult {
  columns: DocumentColumn[];
  rows: unknown[][];
  raw_documents: Record<string, unknown>[];
  total_count: number;
  execution_time_ms: number;
}

/**
 * Sprint 308 (2026-05-14) — single-document projection.
 *
 * 작성 이유: A1 mongosh 파서가 `db.coll.findOne(<filter>)` 을 dispatch 했을
 * 때 Rust 측 `DocumentRow` 가 grid (단일 row 모드) 또는 scalar panel 로
 * 렌더링 가능한 wire shape. `columns` 는 `DocumentQueryResult` 와 동일하게
 * BFS-ordered `_id` first, `row` 는 sentinel-flattened 셀 배열, `raw` 는
 * 원본 BSON (Quick Look 트리 뷰어가 그대로 consumed).
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
