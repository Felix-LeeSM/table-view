import { create } from "zustand";
import type { QueryState } from "../types/query";

// ---------------------------------------------------------------------------
// Tab types — discriminated union so consumers can narrow on `tab.type`
// ---------------------------------------------------------------------------

export type TabSubView = "records" | "structure";

/** A tab that shows table data / structure. */
export interface TableTab {
  type: "table";
  id: string;
  title: string;
  connectionId: string;
  closable: boolean;
  schema?: string;
  table?: string;
  subView: TabSubView;
  /** When true, clicking another table in the same connection replaces this tab. */
  isPreview?: boolean;
}

/** A tab that hosts the SQL query editor. */
export interface QueryTab {
  type: "query";
  id: string;
  title: string;
  connectionId: string;
  closable: boolean;
  sql: string;
  queryState: QueryState;
}

export type Tab = TableTab | QueryTab;

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = "view-table-tabs";
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function persistTabs(tabs: Tab[], activeTabId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const data = JSON.stringify({ tabs, activeTabId });
    window.localStorage.setItem(STORAGE_KEY, data);
  } catch {
    // localStorage may be unavailable (SSR, quota exceeded, etc.)
  }
}

function debouncePersist(tabs: Tab[], activeTabId: string | null): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTabs(tabs, activeTabId);
    persistTimer = null;
  }, 200);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface TabState {
  tabs: Tab[];
  activeTabId: string | null;

  // Table-tab actions
  addTab: (tab: Omit<TableTab, "id">) => void;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  setSubView: (tabId: string, subView: TabSubView) => void;
  promoteTab: (tabId: string) => void;

  // Query-tab actions
  addQueryTab: (connectionId: string) => void;
  updateQuerySql: (tabId: string, sql: string) => void;
  updateQueryState: (tabId: string, state: QueryState) => void;

  // Persistence
  loadPersistedTabs: () => void;
}

let tabCounter = 0;
let queryCounter = 0;

export const useTabStore = create<TabState>((set) => ({
  tabs: [],
  activeTabId: null,

  // -- Table tab actions ----------------------------------------------------

  addTab: (tab) => {
    tabCounter++;
    set((state) => {
      const exists = state.tabs.find(
        (t): t is TableTab =>
          t.type === "table" &&
          t.connectionId === tab.connectionId &&
          t.table === tab.table &&
          t.table !== undefined,
      );
      if (exists) {
        return { activeTabId: exists.id };
      }

      // Check if there is a preview tab for the same connection to replace
      const previewIdx = state.tabs.findIndex(
        (t): t is TableTab =>
          t.type === "table" &&
          t.connectionId === tab.connectionId &&
          t.isPreview === true,
      );

      if (previewIdx !== -1) {
        const newId = `tab-${tabCounter}`;
        const newTabs = [...state.tabs];
        newTabs[previewIdx] = {
          ...tab,
          id: newId,
          isPreview: true,
        } as TableTab;
        return { tabs: newTabs, activeTabId: newId };
      }

      return {
        tabs: [
          ...state.tabs,
          { ...tab, id: `tab-${tabCounter}`, isPreview: true },
        ],
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

  promoteTab: (tabId) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId && t.type === "table" ? { ...t, isPreview: false } : t,
      ),
    })),

  setSubView: (tabId, subView) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId && t.type === "table" ? { ...t, subView } : t,
      ),
    })),

  // -- Query tab actions ----------------------------------------------------

  addQueryTab: (connectionId) => {
    queryCounter++;
    const id = `query-${queryCounter}`;
    const title = `Query ${queryCounter}`;
    set((state) => ({
      tabs: [
        ...state.tabs,
        {
          type: "query" as const,
          id,
          title,
          connectionId,
          closable: true,
          sql: "",
          queryState: { status: "idle" } as QueryState,
        },
      ],
      activeTabId: id,
    }));
  },

  updateQuerySql: (tabId, sql) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId && t.type === "query" ? { ...t, sql } : t,
      ),
    })),

  updateQueryState: (tabId, queryState) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId && t.type === "query" ? { ...t, queryState } : t,
      ),
    })),

  loadPersistedTabs: () => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as {
        tabs: Tab[];
        activeTabId: string | null;
      };
      // Reset all query states to idle (can't resume running queries)
      const tabs = data.tabs.map((t) => {
        if (t.type === "query") {
          return { ...t, queryState: { status: "idle" as const } };
        }
        // Reset preview flag on persisted tabs
        if (t.type === "table") {
          return { ...t, isPreview: false };
        }
        return t;
      });
      set({ tabs, activeTabId: data.activeTabId });
    } catch {
      // Corrupted localStorage — start fresh
      set({ tabs: [], activeTabId: null });
    }
  },
}));

// Persist on every state change via subscribe
useTabStore.subscribe((state) => {
  debouncePersist(state.tabs, state.activeTabId);
});
