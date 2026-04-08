import { create } from "zustand";

export interface Tab {
  id: string;
  title: string;
  connectionId: string;
  type: "query" | "table";
  closable: boolean;
}

interface TabState {
  tabs: Tab[];
  activeTabId: string | null;

  addTab: (tab: Tab) => void;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
}

let tabCounter = 0;

export const useTabStore = create<TabState>((set) => ({
  tabs: [],
  activeTabId: null,

  addTab: (tab) => {
    tabCounter++;
    set((state) => {
      const exists = state.tabs.find(
        (t) => t.connectionId === tab.connectionId && t.type === tab.type,
      );
      if (exists) {
        return { activeTabId: exists.id };
      }
      return {
        tabs: [...state.tabs, { ...tab, id: `tab-${tabCounter}` }],
        activeTabId: `tab-${tabCounter}`,
      };
    });
  },

  removeTab: (id) =>
    set((state) => {
      const filtered = state.tabs.filter((t) => t.id !== id);
      const newActive =
        state.activeTabId === id
          ? (filtered[filtered.length - 1]?.id ?? null)
          : state.activeTabId;
      return { tabs: filtered, activeTabId: newActive };
    }),

  setActiveTab: (id) => set({ activeTabId: id }),
}));
