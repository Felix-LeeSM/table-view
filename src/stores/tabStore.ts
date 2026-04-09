import { create } from "zustand";

export type TabSubView = "records" | "structure";

export interface Tab {
  id: string;
  title: string;
  connectionId: string;
  type: "table";
  closable: boolean;
  schema?: string;
  table?: string;
  subView: TabSubView;
}

interface TabState {
  tabs: Tab[];
  activeTabId: string | null;

  addTab: (tab: Omit<Tab, "id">) => void;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  setSubView: (tabId: string, subView: TabSubView) => void;
}

let tabCounter = 0;

export const useTabStore = create<TabState>((set) => ({
  tabs: [],
  activeTabId: null,

  addTab: (tab) => {
    tabCounter++;
    set((state) => {
      const exists = state.tabs.find(
        (t) =>
          t.connectionId === tab.connectionId &&
          t.table === tab.table &&
          t.table !== undefined,
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

  setSubView: (tabId, subView) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, subView } : t)),
    })),
}));
