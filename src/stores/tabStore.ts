import { create } from "zustand";
import type { Paradigm } from "@/types/connection";
import type { QueryState } from "@/types/query";
import type { FilterCondition } from "@/types/schema";

// ---------------------------------------------------------------------------
// Tab types — discriminated union so consumers can narrow on `tab.type`
// ---------------------------------------------------------------------------

export type TabSubView = "records" | "structure";

/**
 * Distinguishes between a base table and a view.
 *
 * Both objects share the same tab shape (records + structure), but the
 * Structure sub-view renders different content for views (read-only columns
 * + definition SQL) versus tables (editable columns + indexes + constraints).
 *
 * Defaults to "table" when omitted (legacy persisted tabs).
 */
export type TabObjectKind = "table" | "view";

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
  /** Whether this tab points at a base table or a view. */
  objectKind?: TabObjectKind;
  /** When true, clicking another table in the same connection replaces this tab. */
  isPreview?: boolean;
  /** Pre-applied filters when the tab is opened (e.g. from FK navigation). Consumed once on mount. */
  initialFilters?: FilterCondition[];
  /**
   * Paradigm of the connection this tab belongs to. Sprint 66 introduces
   * this field so the MainArea / DataGrid can route a document-paradigm
   * tab through the MongoDB read path without inspecting connection state.
   *
   * Optional on the type for backwards compatibility; legacy persisted
   * tabs without this field are migrated to `"rdb"` in `loadPersistedTabs`.
   */
  paradigm?: Paradigm;
}

/** Execution mode for a query tab. SQL statements belong to `"sql"`, while
 * document paradigms split into a MongoDB `find` body and an aggregation
 * `pipeline`. Sprint 73 introduced the field so the editor + handleExecute
 * branch can route the user's payload to the right Tauri command. */
export type QueryMode = "sql" | "find" | "aggregate";

/** A tab that hosts the SQL / document query editor. */
export interface QueryTab {
  type: "query";
  id: string;
  title: string;
  connectionId: string;
  closable: boolean;
  sql: string;
  queryState: QueryState;
  /**
   * Paradigm of the connection this tab is bound to. Sprint 73 introduced
   * this field so the editor can swap CodeMirror language extensions
   * (SQL ↔ JSON) and `handleExecute` can dispatch to the correct backend
   * command. Defaults to `"rdb"` for legacy persisted tabs.
   */
  paradigm: Paradigm;
  /**
   * Execution mode within the paradigm. RDB tabs are always `"sql"`;
   * document tabs toggle between `"find"` (filter body) and `"aggregate"`
   * (pipeline array). Legacy persisted tabs default to `"sql"`.
   */
  queryMode: QueryMode;
  /** Optional MongoDB database name for document paradigm execution. */
  database?: string;
  /** Optional MongoDB collection name for document paradigm execution. */
  collection?: string;
}

export type Tab = TableTab | QueryTab;

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = "table-view-tabs";
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
  closedTabHistory: Tab[];

  // Table-tab actions
  addTab: (tab: Omit<TableTab, "id">) => void;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  setSubView: (tabId: string, subView: TabSubView) => void;
  promoteTab: (tabId: string) => void;

  // Query-tab actions
  addQueryTab: (
    connectionId: string,
    opts?: {
      paradigm?: Paradigm;
      queryMode?: QueryMode;
      database?: string;
      collection?: string;
    },
  ) => void;
  updateQuerySql: (tabId: string, sql: string) => void;
  updateQueryState: (tabId: string, state: QueryState) => void;
  setQueryMode: (tabId: string, mode: QueryMode) => void;

  // Reopen last closed tab
  reopenLastClosedTab: () => void;

  // Reorder tabs by drag-and-drop
  moveTab: (
    fromId: string,
    toId: string,
    position?: "before" | "after",
  ) => void;

  // Persistence
  loadPersistedTabs: () => void;
}

let tabCounter = 0;
let queryCounter = 0;

export const useTabStore = create<TabState>((set) => ({
  tabs: [],
  activeTabId: null,
  closedTabHistory: [],

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
      const tabToRemove = state.tabs.find((t) => t.id === id);
      const filtered = state.tabs.filter((t) => t.id !== id);
      const newActive =
        state.activeTabId === id
          ? (filtered[filtered.length - 1]?.id ?? null)
          : state.activeTabId;
      const newHistory = tabToRemove
        ? [tabToRemove, ...state.closedTabHistory].slice(0, 20)
        : state.closedTabHistory;
      return {
        tabs: filtered,
        activeTabId: newActive,
        closedTabHistory: newHistory,
      };
    }),

  setActiveTab: (id) => set({ activeTabId: id }),

  promoteTab: (tabId) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId && t.type === "table" ? { ...t, isPreview: false } : t,
      ),
    })),

  reopenLastClosedTab: () =>
    set((state) => {
      if (state.closedTabHistory.length === 0) return state;
      const [restored, ...rest] = state.closedTabHistory;
      // Generate a fresh ID to avoid conflicts
      const newId =
        restored!.type === "table"
          ? `tab-${++tabCounter}`
          : `query-${++queryCounter}`;
      const reopened: Tab =
        restored!.type === "table"
          ? { ...(restored as TableTab), id: newId }
          : { ...(restored as QueryTab), id: newId };
      return {
        tabs: [...state.tabs, reopened],
        activeTabId: newId,
        closedTabHistory: rest,
      };
    }),

  setSubView: (tabId, subView) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId && t.type === "table" ? { ...t, subView } : t,
      ),
    })),

  // -- Query tab actions ----------------------------------------------------

  addQueryTab: (connectionId, opts = {}) => {
    queryCounter++;
    const id = `query-${queryCounter}`;
    const title = `Query ${queryCounter}`;
    const paradigm: Paradigm = opts.paradigm ?? "rdb";
    // RDB tabs force "sql"; document tabs default to "find" when omitted so
    // users land on the simpler of the two Mongo modes by default.
    const queryMode: QueryMode =
      paradigm === "rdb" ? "sql" : (opts.queryMode ?? "find");
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
          paradigm,
          queryMode,
          database: opts.database,
          collection: opts.collection,
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

  setQueryMode: (tabId, mode) =>
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId || t.type !== "query") return t;
        // RDB tabs only speak SQL; reject `"find"`/`"aggregate"` writes so
        // the tab state can't drift out of sync with its paradigm. Other
        // mode writes are accepted as-is (including re-setting to "sql").
        if (t.paradigm === "rdb" && mode !== "sql") return t;
        if (t.queryMode === mode) return t;
        return { ...t, queryMode: mode };
      }),
    })),

  moveTab: (fromId, toId, position = "before") => {
    if (fromId === toId) return;
    set((state) => {
      const tabs = [...state.tabs];
      const fromIdx = tabs.findIndex((t) => t.id === fromId);
      const toIdx = tabs.findIndex((t) => t.id === toId);
      if (fromIdx === -1 || toIdx === -1) return state;
      const [moved] = tabs.splice(fromIdx, 1);
      // toIdx shifts left by 1 if the removed element was before it
      const adjustedToIdx = toIdx > fromIdx ? toIdx - 1 : toIdx;
      const insertIdx =
        position === "before" ? adjustedToIdx : adjustedToIdx + 1;
      tabs.splice(insertIdx, 0, moved!);
      return { tabs };
    });
  },

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
          // Sprint 73: migrate pre-existing QueryTabs that predate the
          // paradigm / queryMode fields. Every legacy tab is a SQL tab
          // against an RDB connection, so defaulting is loss-free.
          const paradigm: Paradigm = t.paradigm ?? "rdb";
          const queryMode: QueryMode =
            t.queryMode ?? (paradigm === "rdb" ? "sql" : "find");
          return {
            ...t,
            queryState: { status: "idle" as const },
            paradigm,
            queryMode,
          };
        }
        // Reset preview flag on persisted tabs. Sprint 66: migrate
        // pre-existing TableTabs that were saved before the `paradigm`
        // field existed. Every legacy persisted tab targeted an RDB, so
        // defaulting to `"rdb"` matches user expectations.
        if (t.type === "table") {
          return {
            ...t,
            isPreview: false,
            paradigm: t.paradigm ?? ("rdb" as const),
          };
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
