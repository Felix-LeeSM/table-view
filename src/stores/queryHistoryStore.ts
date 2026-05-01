import { create } from "zustand";
import type { Paradigm } from "@/types/connection";
import type { QueryMode } from "@stores/tabStore";

/**
 * Sprint 84 — persist paradigm metadata alongside every executed query.
 *
 * The `paradigm` / `queryMode` fields are declared **required** so consumers
 * can read them without optional-chaining, but `addHistoryEntry` accepts the
 * payload with those fields optional and defaults them to `"rdb"` / `"sql"`
 * inside the store. This keeps legacy call sites and any future persisted
 * (pre-Sprint 84) entries safe: the store normalises at the write boundary,
 * and selectors in `filteredGlobalLog` defensively normalise again on read
 * in case the store was seeded directly with legacy shapes (e.g. via
 * `set({entries: [...]})` in tests or, later, via a localStorage migration
 * layer).
 */
/**
 * Sprint 180 (AC-180-03) — `"cancelled"` widens the status union so a
 * user-aborted query records distinctly from success/error. Existing
 * `"success" | "error"` callers continue to compile because the new
 * union is a strict superset; the rendering branches in QueryLog /
 * GlobalQueryLogPanel surface a calm muted treatment for the new
 * variant per the spec Visual Direction ("calm secondary, not
 * destructive").
 */
export type QueryHistoryStatus = "success" | "error" | "cancelled";

export interface QueryHistoryEntry {
  id: string;
  sql: string;
  executedAt: number;
  duration: number;
  status: QueryHistoryStatus;
  connectionId: string;
  /** Paradigm of the connection the query ran against. */
  paradigm: Paradigm;
  /** Execution mode within the paradigm (SQL statement, Mongo find, or aggregate). */
  queryMode: QueryMode;
  /** MongoDB database name when the entry originated from a document paradigm tab. */
  database?: string;
  /** MongoDB collection name when the entry originated from a document paradigm tab. */
  collection?: string;
}

const MAX_GLOBAL_LOG = 500;

/**
 * Payload shape accepted by `addHistoryEntry`. Paradigm / queryMode are
 * optional on the payload and defaulted inside the store so Sprint 83-era
 * callers (which don't yet pass paradigm metadata) continue to compile.
 */
type AddHistoryEntryPayload = Omit<
  QueryHistoryEntry,
  "id" | "paradigm" | "queryMode"
> & {
  paradigm?: Paradigm;
  queryMode?: QueryMode;
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
 * Normalise a single entry to the current shape. Legacy entries may be
 * seeded directly into the store (tests, future persisted migration) without
 * the paradigm / queryMode fields — we fill them with the pre-Sprint 84
 * defaults (`"rdb"` / `"sql"`) so downstream consumers can treat the fields
 * as required.
 */
function normaliseEntry(entry: QueryHistoryEntry): QueryHistoryEntry {
  const paradigm: Paradigm = entry.paradigm ?? "rdb";
  const queryMode: QueryMode = entry.queryMode ?? "sql";
  if (entry.paradigm && entry.queryMode) return entry;
  return { ...entry, paradigm, queryMode };
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
    const newEntry: QueryHistoryEntry = {
      ...entry,
      paradigm,
      queryMode,
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
