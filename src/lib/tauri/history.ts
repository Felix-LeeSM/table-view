/**
 * Sprint 371 (Phase 5 F.5) — `query_history` IPC frontend wrappers.
 *
 * 4 wrapper functions mirroring backend IPC:
 *   - `addHistoryEntry`   — `add_history_entry` (records execution).
 *   - `listHistory`       — `list_history` (paginated, no `sql`).
 *   - `getHistoryDetail`  — `get_history_detail` (single row with `sql`).
 *   - `clearHistory`      — `clear_history` (drops all + VACUUM).
 *
 * Wire contract (strategy doc F.5 line 535–605):
 *   - `paradigm` + `queryMode` are a discriminated union — invalid combos
 *     are rejected by serde at the backend before any handler logic.
 *   - `list_history` responses NEVER carry `sql` — only `sqlRedacted`.
 *   - `get_history_detail` is the only path that returns the original SQL.
 *   - `clear_history` returns `{deletedCount}` and emits `state-changed`
 *     with domain `history`, op `clear`.
 *
 * Frontend store wiring (`queryHistoryStore.recordExecution` →
 * `addHistoryEntry`, etc.) is sprint-372 — these wrappers expose the
 * surface but the call sites land in the next sprint.
 */

import { invoke } from "@tauri-apps/api/core";

// ---------------------------------------------------------------------------
// Discriminated union — paradigm + queryMode.
// ---------------------------------------------------------------------------

/** RDB paradigm — currently only `sql` query mode is supported. */
export type RdbQueryMode = "sql";

/** Document paradigm — mongosh command family. */
export type DocumentQueryMode =
  | "find"
  | "findOne"
  | "aggregate"
  | "count"
  | "estimatedDocumentCount"
  | "distinct"
  | "insertOne"
  | "insertMany"
  | "updateOne"
  | "updateMany"
  | "replaceOne"
  | "deleteOne"
  | "deleteMany"
  | "createIndex"
  | "dropIndex"
  | "bulkWrite";

/**
 * Paradigm-qualified query mode. The backend `HistoryQueryMode` is a serde
 * discriminated union keyed on `paradigm`; invalid combinations
 * (`rdb`+`find`, `document`+`sql`) are rejected with a 400.
 */
export type HistoryQueryMode =
  | { paradigm: "rdb"; queryMode: RdbQueryMode }
  | { paradigm: "document"; queryMode: DocumentQueryMode };

/**
 * Filter variant — same shape as `HistoryQueryMode` but with `queryMode`
 * optional (paradigm-only filtering is a common UI affordance: "show me
 * all RDB queries" / "all document queries").
 */
export type HistoryQueryModeFilter =
  | { paradigm: "rdb"; queryMode?: RdbQueryMode }
  | { paradigm: "document"; queryMode?: DocumentQueryMode };

// ---------------------------------------------------------------------------
// add_history_entry
// ---------------------------------------------------------------------------

/**
 * Common fields shared by every history entry, irrespective of paradigm.
 * Intersected with `HistoryQueryMode` to form `AddHistoryEntryRequest` —
 * the discriminated union keeps `paradigm` + `queryMode` together and
 * the intersection adds the connection / status / timing fields.
 */
export interface HistoryEntryCommonFields {
  connectionId: string;
  tabId?: string;
  database?: string;
  collection?: string;
  /** `raw` / `grid-edit` / etc — frontend-assigned trigger source label. */
  source: string;
  /** Original SQL / mongosh expression. Backend computes `sqlRedacted`. */
  sql: string;
  /** `success` | `error` | `cancelled`. */
  status: string;
  errorMessage?: string;
  rowsAffected?: number;
  durationMs: number;
  /**
   * Execution start time (unix ms). Backend validates `|now - executedAt|
   * <= 5min` and overrides with backend `now` on drift.
   */
  executedAt: number;
  serverPid?: number;
}

export type AddHistoryEntryRequest = HistoryEntryCommonFields &
  HistoryQueryMode;

export interface AddHistoryEntryResponse {
  id: number;
  executedAt: number;
  sqlRedacted: string;
}

export async function addHistoryEntry(
  req: AddHistoryEntryRequest,
): Promise<AddHistoryEntryResponse> {
  return await invoke<AddHistoryEntryResponse>("add_history_entry", { req });
}

// ---------------------------------------------------------------------------
// list_history
// ---------------------------------------------------------------------------

export interface ListHistoryRequest {
  connectionId?: string;
  /** Requires `connectionId` — backend rejects tabId-only requests with 400. */
  tabId?: string;
  filter?: HistoryQueryModeFilter;
  /** Pagination cursor — the previous response's `nextCursor`. */
  cursor?: number;
  /** Page size. Defaults 100. Clamped to 500. */
  limit?: number;
}

/**
 * List response row — **never** carries the original `sql`. The
 * `sqlRedacted` form replaces it for display. To inspect the original SQL,
 * the caller must `getHistoryDetail({ id })`.
 */
export interface HistoryListRow {
  id: number;
  connectionId: string;
  tabId?: string | null;
  paradigm: "rdb" | "document";
  queryMode: string;
  database?: string | null;
  collection?: string | null;
  source: string;
  sqlRedacted: string;
  status: string;
  errorMessage?: string | null;
  rowsAffected?: number | null;
  durationMs: number;
  executedAt: number;
  serverPid?: number | null;
}

export interface ListHistoryResponse {
  rows: HistoryListRow[];
  nextCursor?: number;
}

export async function listHistory(
  req: ListHistoryRequest,
): Promise<ListHistoryResponse> {
  return await invoke<ListHistoryResponse>("list_history", { req });
}

// ---------------------------------------------------------------------------
// get_history_detail
// ---------------------------------------------------------------------------

export interface GetHistoryDetailRequest {
  id: number;
}

/** Detail response — exactly 3 keys. The only path that exposes original `sql`. */
export interface HistoryDetailResponse {
  id: number;
  sql: string;
  sqlRedacted: string;
}

export async function getHistoryDetail(
  req: GetHistoryDetailRequest,
): Promise<HistoryDetailResponse> {
  return await invoke<HistoryDetailResponse>("get_history_detail", { req });
}

// ---------------------------------------------------------------------------
// clear_history
// ---------------------------------------------------------------------------

export interface ClearHistoryResponse {
  deletedCount: number;
}

/**
 * Drop every `query_history` row and reclaim disk via VACUUM. Backend emits
 * `state-changed` with domain `history`, op `clear` so all open windows
 * refresh their lists.
 */
export async function clearHistory(): Promise<ClearHistoryResponse> {
  return await invoke<ClearHistoryResponse>("clear_history");
}
