import { create } from "zustand";

export interface QueryHistoryEntry {
  id: string;
  sql: string;
  executedAt: number;
  duration: number;
  status: "success" | "error";
  connectionId: string;
}

interface QueryHistoryState {
  entries: QueryHistoryEntry[];
  addHistoryEntry: (entry: Omit<QueryHistoryEntry, "id">) => void;
  clearHistory: () => void;
}

let historyCounter = 0;

export const useQueryHistoryStore = create<QueryHistoryState>((set) => ({
  entries: [],

  addHistoryEntry: (entry) => {
    historyCounter++;
    set((state) => ({
      entries: [
        { ...entry, id: `history-${historyCounter}` },
        ...state.entries,
      ],
    }));
  },

  clearHistory: () => set({ entries: [] }),
}));
