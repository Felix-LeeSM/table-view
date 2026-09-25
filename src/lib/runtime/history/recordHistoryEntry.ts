/**
 * F.5 — thin caller of the `add_history_entry` IPC.
 *
 * Written 2026-05-17. Shared by the callers of each `QueryHistorySource`
 * (raw / grid-edit / ddl-structure / mongo-op / explain / file-analytics /
 * sidebar-prefetch). Responsibilities:
 *
 *   1. Return early when `useHistorySettingsStore.queryHistoryEnabled` is
 *      false — the IPC call itself is skipped (AC-373-03 invariant).
 *   2. Normalise the history input shape the caller passes (`paradigm` +
 *      `queryMode` + `duration` + the rest) into the backend wire shape
 *      (discriminated union + `durationMs`).
 *   3. Delegate to `useQueryHistoryStore.addOptimisticEntry` — optimistic
 *      `recentVisible` prepend + backend IPC.
 *
 * The RDB paradigm's `queryMode` is always normalised to `"sql"` (the only
 * variant of the backend `RdbQueryMode`). The document paradigm's legacy
 * mode `"countDocuments"` maps to the backend `"count"`; the other modes
 * pass through unchanged.
 *
 * Why a plain function, not a hook: non-React modules and `useCallback`
 * bodies inside hooks can share the same entry point. A React component may
 * still subscribe with `useHistorySettingsStore((s) => s.queryHistoryEnabled)`
 * for extra selector caching when it needs to — this function reads the
 * truth directly with `useHistorySettingsStore.getState()` at call time, so
 * it is correct without selector caching.
 */

import type {
  AddHistoryEntryRequest,
  DocumentQueryMode,
  RdbQueryMode,
} from "@lib/tauri/history";
import { useHistorySettingsStore } from "@stores/historySettingsStore";
import {
  type QueryHistorySource,
  useQueryHistoryStore,
} from "@stores/queryHistoryStore";
import type { Paradigm } from "@/types/connection";

export type DocumentRecordHistoryQueryMode =
  | DocumentQueryMode
  | "countDocuments";

interface RecordHistoryEntryCommonArgs {
  /** Connection id; required (snapshot truth from tab/grid context). */
  connectionId: string;
  /** Optional db/collection (almost always set for the document paradigm). */
  database?: string;
  collection?: string;
  /** Source label — set explicitly by the caller. */
  source: QueryHistorySource;
  /** Raw SQL or mongosh expression. The backend derives `sql_redacted`. */
  sql: string;
  /** `"success" | "error" | "cancelled"`. */
  status: "success" | "error" | "cancelled";
  /** User clock, unix ms. The backend overrides it on a drift over 5 min. */
  executedAt: number;
  /** Legacy argument name — the backend wire uses `durationMs`. */
  duration: number;
  /** optional metadata. */
  tabId?: string;
  errorMessage?: string;
  rowsAffected?: number;
  serverPid?: number;
}

export type RecordHistoryEntryArgs = RecordHistoryEntryCommonArgs &
  (
    | { paradigm: "rdb"; queryMode?: RdbQueryMode }
    | {
        paradigm: "document";
        queryMode?: DocumentRecordHistoryQueryMode;
      }
    | {
        paradigm: Exclude<Paradigm, "rdb" | "document">;
        queryMode?: never;
      }
  );

/**
 * Maps the frontend history input to the backend `DocumentQueryMode`.
 * `countDocuments` is the only legacy method-name correction; the rest map
 * 1:1. `toAddHistoryEntryRequest` handles the `kv` / `search` paradigms
 * directly with a fixed query mode (`command` / `dsl`) (#1171) — this
 * function is document-only.
 */
function toDocumentQueryMode(
  mode: DocumentRecordHistoryQueryMode | undefined,
): DocumentQueryMode | null {
  if (mode === undefined) {
    return "find";
  }
  switch (mode) {
    case "countDocuments":
      return "count";
    case "find":
    case "findOne":
    case "aggregate":
    case "count":
    case "estimatedDocumentCount":
    case "distinct":
    case "insertOne":
    case "insertMany":
    case "updateOne":
    case "updateMany":
    case "replaceOne":
    case "deleteOne":
    case "deleteMany":
    case "createIndex":
    case "dropIndex":
    case "bulkWrite":
      return mode;
    default:
      return null;
  }
}

/**
 * Frontend history input → backend `AddHistoryEntryRequest`.
 * An invalid runtime pair is silently skipped (`null`), as before.
 */
function toAddHistoryEntryRequest(
  args: RecordHistoryEntryArgs,
): AddHistoryEntryRequest | null {
  const common = {
    connectionId: args.connectionId,
    tabId: args.tabId,
    database: args.database,
    collection: args.collection,
    source: args.source,
    sql: args.sql,
    status: args.status,
    errorMessage: args.errorMessage,
    rowsAffected: args.rowsAffected,
    durationMs: args.duration,
    executedAt: args.executedAt,
    serverPid: args.serverPid,
  } as const;

  if (args.paradigm === "rdb") {
    if (args.queryMode !== undefined && args.queryMode !== "sql") {
      return null;
    }
    return {
      ...common,
      paradigm: "rdb",
      queryMode: "sql",
    };
  }

  if (args.paradigm === "document") {
    const queryMode = toDocumentQueryMode(args.queryMode);
    if (!queryMode) {
      return null;
    }
    return {
      ...common,
      paradigm: "document",
      queryMode,
    };
  }

  // Issue #1171 — kv (Redis/Valkey) / search (ES/OpenSearch) now record. Each
  // paradigm has a single backend query mode; the display path labels by
  // paradigm (#1055/#1166), so the fixed mode is all the wire needs.
  if (args.paradigm === "kv") {
    return { ...common, paradigm: "kv", queryMode: "command" };
  }
  if (args.paradigm === "search") {
    return { ...common, paradigm: "search", queryMode: "dsl" };
  }

  return null;
}

/**
 * Main entry point. Every history caller calls this function or its
 * awaitable variant `recordHistoryEntryAsync`.
 *
 * The "Disable history" toggle (`query_history_enabled = false`) check is
 * the first statement of `recordHistoryEntryAsync`, which this function
 * delegates to — with the toggle OFF there is no IPC call path (the
 * AC-373-03 spy test locks this invariant).
 */
export function recordHistoryEntry(args: RecordHistoryEntryArgs): void {
  void recordHistoryEntryAsync(args);
}

/**
 * Awaitable variant for UI paths whose next visible state depends on the
 * backend list-history row being committed before they expose a history view.
 */
export async function recordHistoryEntryAsync(
  args: RecordHistoryEntryArgs,
): Promise<void> {
  if (!useHistorySettingsStore.getState().queryHistoryEnabled) {
    return;
  }

  const req = toAddHistoryEntryRequest(args);
  if (!req) {
    return;
  }

  // Errors surface only as a logger.warn inside the store (best-effort).
  await useQueryHistoryStore.getState().addOptimisticEntry(req);
}
