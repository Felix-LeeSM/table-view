import { create } from "zustand";

export interface QueryHistoryEntry {
  id: string;
  sql: string;
  executedAt: number;
  duration: number;
  status: "success" | "error";
  connectionId: string;
}

const MAX_GLOBAL_LOG = 500;

interface QueryHistoryState {
  entries: QueryHistoryEntry[];
  globalLog: QueryHistoryEntry[];
  searchFilter: string;
  connectionFilter: string | null;

  addHistoryEntry: (entry: Omit<QueryHistoryEntry, "id">) => void;
  clearHistory: () => void;
  clearGlobalLog: () => void;
  setSearchFilter: (filter: string) => void;
  setConnectionFilter: (connectionId: string | null) => void;
  filteredGlobalLog: () => QueryHistoryEntry[];
  copyEntry: (entryId: string) => Promise<void>;
}

let historyCounter = 0;

export const useQueryHistoryStore = create<QueryHistoryState>((set, get) => ({
  entries: [],
  globalLog: [],
  searchFilter: "",
  connectionFilter: null,

  addHistoryEntry: (entry) => {
    historyCounter++;
    const newEntry = { ...entry, id: `history-${historyCounter}` };
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
    return globalLog.filter((entry) => {
      const matchesSearch =
        !searchFilter ||
        entry.sql.toLowerCase().includes(searchFilter.toLowerCase());
      const matchesConnection =
        !connectionFilter || entry.connectionId === connectionFilter;
      return matchesSearch && matchesConnection;
    });
  },

  copyEntry: async (entryId) => {
    const entry = get().globalLog.find((e) => e.id === entryId);
    if (entry) {
      await navigator.clipboard.writeText(entry.sql);
    }
  },
}));
