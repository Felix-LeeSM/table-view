/**
 * state-management-strategy F.5 — `queryHistoryStore` thin wrapper.
 *
 * Written 2026-05-17 — retires the leftover in-memory `entries` / `globalLog`
 * fields once the backend IPC and the `useQueryHistory` hook landed. The
 * backend `query_history` is the single source of truth — the store holds
 * only (a) the `recentVisible` cache that receives a row right after an
 * optimistic insert, (b) the write helper (`addOptimisticEntry`), and (c) a
 * setter for list refetch results (`setRecentVisible`).
 *
 * Reason (summary):
 *   - In-memory `entries` is confined to process memory — no cross-window
 *     sharing. The `state-changed` event + the `useQueryHistory` hook
 *     dispatch a single backend truth across windows.
 *   - The 500 cap of `globalLog` is replaced by disk-backed retention
 *     (`boot_vacuum_old_history` + the `query_history_retention_days`
 *     setting).
 *   - The "Disable history" toggle (`query_history_enabled`) is enforced by
 *     the caller checking `useHistorySettingsStore.queryHistoryEnabled`
 *     (`recordHistoryEntryAsync`) and not calling `addOptimisticEntry` at
 *     all — no branch inside the store.
 */

import { logger } from "@lib/logger";
import {
  type AddHistoryEntryRequest,
  addHistoryEntry as addHistoryEntryIpc,
  type HistoryListRow,
} from "@lib/tauri/history";
import { create } from "zustand";

export const QUERY_HISTORY_LOCAL_CREATED_EVENT = "query-history:local-created";

export interface QueryHistoryLocalCreatedDetail {
  row: HistoryListRow;
}

function emitLocalHistoryCreated(row: HistoryListRow): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<QueryHistoryLocalCreatedDetail>(
      QUERY_HISTORY_LOCAL_CREATED_EVENT,
      { detail: { row } },
    ),
  );
}

/**
 * Origin of the recorded query/operation. Lets the UI distinguish a raw
 * query the user typed from generated SQL emitted by another surface.
 *
 * - `raw`              — user-typed SQL / MQL from the QueryTab editor.
 * - `grid-edit`        — DataGrid pending-edit commit (RDB batch / Mongo
 *                       dispatchMqlCommand) + EditableQueryResultGrid edits.
 * - `ddl-structure`    — StructurePanel editors + SchemaTree drop-table.
 * - `mongo-op`         — Mongo-specific direct ops that bypass the grid
 *                       pending pipeline (e.g. Add Document modal).
 * - `explain`          — query editor Explain plan-inspection action.
 * - `file-analytics`   — DuckDB local-file source-scoped query dialog.
 * - `sidebar-prefetch` — Sidebar preview rows: when the user clicks a
 *                       table in the sidebar tree to open it in a DataGrid,
 *                       the prefetched rows are recorded as a backend
 *                       SELECT.
 */
export type QueryHistorySource =
  | "raw"
  | "grid-edit"
  | "ddl-structure"
  | "mongo-op"
  | "explain"
  | "file-analytics"
  | "sidebar-prefetch";

interface QueryHistoryState {
  /**
   * state-management-strategy F.5 — thin-wrapper field. History rows written
   * by `addOptimisticEntry` (optimistic prepend, then the committed row).
   * The `useQueryHistory` hook keeps its own `list_history` rows and does
   * not write this slot. The store itself only holds the slot so consumers
   * that still read off zustand can subscribe to it.
   */
  recentVisible: HistoryListRow[];

  /**
   * Optimistic prepend after a user-triggered query, then fire-and-forget
   * the backend `add_history_entry` IPC. Backend emits `history.create`;
   * `dispatchStateChangedPayload` self-echo-skips the origin window so we
   * don't double-insert. Errors are best-effort (logger.warn only); the
   * next backend list refetch is the recovery path.
   *
   * The only writer the store offers. Callers gate on
   * `useHistorySettingsStore.getState().queryHistoryEnabled` BEFORE invoking
   * (see `recordHistoryEntryAsync`) — when the user disabled history this
   * function is never reached and the backend IPC count is zero (AC-373-03).
   */
  addOptimisticEntry: (req: AddHistoryEntryRequest) => Promise<void>;
  /**
   * Stores a list result in `recentVisible`. `useQueryHistory` keeps its
   * rows in its own state and does not call this.
   */
  setRecentVisible: (rows: HistoryListRow[]) => void;
}

export const useQueryHistoryStore = create<QueryHistoryState>((set) => ({
  recentVisible: [],

  setRecentVisible: (rows) => set({ recentVisible: rows }),

  addOptimisticEntry: async (req) => {
    // 1. Optimistic prepend — the backend generates sql_redacted, so for
    //    now `sqlRedacted` is filled with `sql`. When the backend responds,
    //    the properly redacted text overwrites it (the set call below).
    const tempId = -Date.now();
    const tempRow: HistoryListRow = {
      id: tempId,
      connectionId: req.connectionId,
      tabId: req.tabId ?? null,
      paradigm: req.paradigm,
      queryMode: req.queryMode,
      database: req.database ?? null,
      collection: req.collection ?? null,
      source: req.source,
      sqlRedacted: req.sql,
      status: req.status,
      errorMessage: req.errorMessage ?? null,
      rowsAffected: req.rowsAffected ?? null,
      durationMs: req.durationMs,
      executedAt: req.executedAt,
      serverPid: req.serverPid ?? null,
    };
    set((state) => ({ recentVisible: [tempRow, ...state.recentVisible] }));

    // 2. Backend IPC — emits `history.create`; `dispatchStateChangedPayload`
    //    skips the origin window's self-echo.
    try {
      const resp = await addHistoryEntryIpc(req);
      const committedRow: HistoryListRow = {
        ...tempRow,
        id: resp.id,
        sqlRedacted: resp.sqlRedacted,
      };
      set((state) => ({
        recentVisible: state.recentVisible.map((r) =>
          r.id === tempId ? committedRow : r,
        ),
      }));
      emitLocalHistoryCreated(committedRow);
    } catch (e) {
      // Best-effort — on a backend reject, the next list refetch shows the
      // truth. The optimistic row stays in `recentVisible`; the backend list
      // never contains it. Only a log is left.
      logger.warn(
        "[queryHistoryStore.addOptimisticEntry] backend reject",
        e instanceof Error ? e.message : e,
      );
    }
  },
}));
