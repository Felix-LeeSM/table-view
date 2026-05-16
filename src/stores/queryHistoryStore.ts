import { create } from "zustand";
import type { Paradigm } from "@/types/connection";
import type { QueryMode } from "@stores/workspaceStore";
import {
  addHistoryEntry as addHistoryEntryIpc,
  type AddHistoryEntryRequest,
  type HistoryListRow,
} from "@lib/tauri/history";
import { logger } from "@lib/logger";

/**
 * `"cancelled"` widens the status so a user-aborted query records
 * distinctly from success/error. The QueryLog / GlobalQueryLogPanel
 * render branches surface a calm muted treatment for it.
 */
export type QueryHistoryStatus = "success" | "error" | "cancelled";

/**
 * Origin of the recorded query/operation. Lets the UI distinguish a raw
 * query the user typed from generated SQL emitted by another surface.
 *
 * - `raw`            — user-typed SQL / MQL from the QueryTab editor.
 * - `grid-edit`      — DataGrid pending-edit commit (RDB batch / Mongo
 *                     dispatchMqlCommand) + EditableQueryResultGrid edits.
 * - `ddl-structure`  — StructurePanel editors + SchemaTree drop-table.
 * - `mongo-op`       — Mongo-specific direct ops that bypass the grid
 *                     pending pipeline (e.g. Add Document modal).
 *
 * Optional on the type because legacy fixtures and persisted entries
 * may lack the field; the write/read paths normalise to `"raw"`.
 */
export type QueryHistorySource =
  | "raw"
  | "grid-edit"
  | "ddl-structure"
  | "mongo-op";

export interface QueryHistoryEntry {
  id: string;
  sql: string;
  executedAt: number;
  duration: number;
  status: QueryHistoryStatus;
  connectionId: string;
  /** Paradigm of the connection the query ran against. */
  paradigm: Paradigm;
  /**
   * Execution mode within the paradigm.
   *
   * - RDB: always `"sql"`.
   * - Document (Sprint 311, Phase 28 Slice A5): the **parsed mongosh method
   *   name** (`"find"`, `"findOne"`, `"aggregate"`, `"countDocuments"`,
   *   `"estimatedDocumentCount"`, `"distinct"`, plus write methods landed in
   *   A6). The legacy `"find" | "aggregate"` toggle was removed in Sprint
   *   309; the field is now wholly driven by `parseMongoshExpression`.
   *
   * History filter / search UI keeps working because the values widen
   * superset-style — any consumer that previously matched
   * `queryMode === "aggregate"` continues to see the aggregate entries
   * unchanged. Legacy persisted entries (pre-A5) still deserialise via the
   * `normaliseEntry` defaulting to `"sql"`.
   */
  queryMode: QueryMode;
  /** MongoDB database name when the entry originated from a document paradigm tab. */
  database?: string;
  /** MongoDB collection name when the entry originated from a document paradigm tab. */
  collection?: string;
  /**
   * Origin of the entry. Optional on the type for legacy compatibility;
   * `addHistoryEntry` always populates to `"raw"` when the caller omits
   * it. Direct readers of `entries` (bypassing `filteredGlobalLog`)
   * should default with `?? "raw"` defensively.
   */
  source?: QueryHistorySource;
}

const MAX_GLOBAL_LOG = 500;

/**
 * Payload shape accepted by `addHistoryEntry`. `paradigm` / `queryMode`
 * are optional on input and defaulted inside the store so legacy call
 * sites (without paradigm metadata) continue to compile.
 */
type AddHistoryEntryPayload = Omit<
  QueryHistoryEntry,
  "id" | "paradigm" | "queryMode" | "source"
> & {
  paradigm?: Paradigm;
  queryMode?: QueryMode;
  source?: QueryHistorySource;
};

interface QueryHistoryState {
  entries: QueryHistoryEntry[];
  globalLog: QueryHistoryEntry[];
  searchFilter: string;
  connectionFilter: string | null;
  /**
   * sprint-372 (Phase 5 F.5) — thin-wrapper field. Visible history rows
   * after a backend `list_history` fetch. Populated/managed by the
   * `useQueryHistory` hook + cross-window `history.create` / `clear`
   * receivers. The store itself only holds the slot so consumers that
   * still read off zustand (transient, until sprint-373 retires the
   * legacy `entries` / `globalLog`) can subscribe to it.
   */
  recentVisible: HistoryListRow[];

  addHistoryEntry: (entry: AddHistoryEntryPayload) => void;
  /**
   * sprint-372 — optimistic prepend after a user-triggered query, then
   * fire-and-forget the backend `add_history_entry` IPC. Backend emits
   * `history.create`; sprint-365 dispatcher self-echo-skips the origin
   * window so we don't double-insert. Errors are best-effort
   * (logger.warn only); the next backend list refetch is the recovery
   * path.
   */
  addOptimisticEntry: (req: AddHistoryEntryRequest) => Promise<void>;
  /** sprint-372 — `useQueryHistory` 의 list 결과를 store 에 저장. */
  setRecentVisible: (rows: HistoryListRow[]) => void;
  clearHistory: () => void;
  clearGlobalLog: () => void;
  setSearchFilter: (filter: string) => void;
  setConnectionFilter: (connectionId: string | null) => void;
  filteredGlobalLog: () => QueryHistoryEntry[];
  copyEntry: (entryId: string) => Promise<void>;
}

let historyCounter = 0;

/**
 * Normalise a single entry to the current shape. Legacy entries (tests,
 * future persisted migration) may lack `paradigm` / `queryMode` /
 * `source`; default them to `"rdb"` / `"sql"` / `"raw"` so downstream
 * consumers can treat the fields as required.
 */
function normaliseEntry(entry: QueryHistoryEntry): QueryHistoryEntry {
  const paradigm: Paradigm = entry.paradigm ?? "rdb";
  const queryMode: QueryMode = entry.queryMode ?? "sql";
  const source: QueryHistorySource = entry.source ?? "raw";
  if (entry.paradigm && entry.queryMode && entry.source) return entry;
  return { ...entry, paradigm, queryMode, source };
}

export const useQueryHistoryStore = create<QueryHistoryState>((set, get) => ({
  entries: [],
  globalLog: [],
  searchFilter: "",
  connectionFilter: null,
  recentVisible: [],

  setRecentVisible: (rows) => set({ recentVisible: rows }),

  addOptimisticEntry: async (req) => {
    // 1. Optimistic prepend — sql_redacted 가 backend 생성이므로 본
    //    시점에는 `sqlRedacted` 를 `sql` 로 채워둔다. backend 응답이
    //    오면 정상 redact 본으로 덮어쓴다 (아래 set 호출).
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

    // 2. Backend IPC — emits `history.create`; origin window self-echoes
    //    skip via sprint-365 dispatcher.
    try {
      const resp = await addHistoryEntryIpc(req);
      set((state) => ({
        recentVisible: state.recentVisible.map((r) =>
          r.id === tempId
            ? { ...r, id: resp.id, sqlRedacted: resp.sqlRedacted }
            : r,
        ),
      }));
    } catch (e) {
      // best-effort — backend 가 reject 하면 다음 refetch 가 truth 를
      // 다시 잡는다. optimistic row 는 그대로 두고 사용자에게는 보이는
      // 그대로 — 잠시 후 새 list 에서 빠진다. logger 만 남긴다.
      logger.warn(
        "[queryHistoryStore.addOptimisticEntry] backend reject",
        e instanceof Error ? e.message : e,
      );
    }
  },

  addHistoryEntry: (entry) => {
    historyCounter++;
    const paradigm: Paradigm = entry.paradigm ?? "rdb";
    const queryMode: QueryMode = entry.queryMode ?? "sql";
    const source: QueryHistorySource = entry.source ?? "raw";
    const newEntry: QueryHistoryEntry = {
      ...entry,
      paradigm,
      queryMode,
      source,
      id: `history-${historyCounter}`,
    };
    set((state) => {
      const updatedGlobalLog = [newEntry, ...state.globalLog].slice(
        0,
        MAX_GLOBAL_LOG,
      );
      return {
        entries: [newEntry, ...state.entries],
        globalLog: updatedGlobalLog,
      };
    });
  },

  clearHistory: () => set({ entries: [] }),

  clearGlobalLog: () => set({ globalLog: [] }),

  setSearchFilter: (filter) => set({ searchFilter: filter }),

  setConnectionFilter: (connectionId) =>
    set({ connectionFilter: connectionId }),

  filteredGlobalLog: () => {
    const { globalLog, searchFilter, connectionFilter } = get();
    return globalLog
      .filter((entry) => {
        const matchesSearch =
          !searchFilter ||
          entry.sql.toLowerCase().includes(searchFilter.toLowerCase());
        const matchesConnection =
          !connectionFilter || entry.connectionId === connectionFilter;
        return matchesSearch && matchesConnection;
      })
      .map(normaliseEntry);
  },

  copyEntry: async (entryId) => {
    const entry = get().globalLog.find((e) => e.id === entryId);
    if (entry) {
      await navigator.clipboard.writeText(entry.sql);
    }
  },
}));
