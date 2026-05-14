import { create } from "zustand";
import type { Paradigm } from "@/types/connection";
import type { QueryMode } from "@stores/workspaceStore";

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

  addHistoryEntry: (entry: AddHistoryEntryPayload) => void;
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
