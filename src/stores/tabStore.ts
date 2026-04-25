import { create } from "zustand";
import type { Paradigm } from "@/types/connection";
import type { QueryState } from "@/types/query";
import type { FilterCondition, SortInfo } from "@/types/schema";

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
  /**
   * Per-tab sort state. Sprint 76 promotes sort ordering from `DataGrid`'s
   * local `useState<SortInfo[]>` to tab-scoped store state so a user's
   * column ordering survives tab switches (the grid unmounts/remounts
   * between tabs) and persists to localStorage alongside the tab itself.
   *
   * Optional for forward-compat with legacy persisted tabs; `loadPersistedTabs`
   * normalises missing values to `[]` so every downstream consumer can
   * treat the field as a plain array.
   */
  sorts?: SortInfo[];
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
  /**
   * Sprint 97 — set of tab ids whose underlying grid has unsaved edits
   * (`pendingEdits.size > 0 || pendingNewRows.length > 0 ||
   * pendingDeletedRowKeys.size > 0`). Owned by the store so consumers
   * (`TabBar` for the dirty dot + close gate, debug tooling, etc.) can read
   * dirty state without taking a hard dependency on the grid hook. The hook
   * publishes the value via `setTabDirty` from a `useEffect`.
   *
   * Membership semantics are idempotent — `setTabDirty(id, true)` on an
   * already-dirty tab is a no-op (referential equality preserved) so React
   * subscribers don't re-render on every keystroke.
   */
  dirtyTabIds: Set<string>;

  // Table-tab actions
  addTab: (tab: Omit<TableTab, "id">) => void;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  setSubView: (tabId: string, subView: TabSubView) => void;
  promoteTab: (tabId: string) => void;
  updateTabSorts: (tabId: string, sorts: SortInfo[]) => void;
  /**
   * Sprint 97 — publish dirty state for a single tab. `dirty=true` adds the
   * tab id to {@link dirtyTabIds}; `dirty=false` removes it. Callers
   * typically run this in an effect that mirrors a grid-local pending diff
   * to the store, so reads must stay cheap (no full Set replacement when
   * the value is already the requested one).
   */
  setTabDirty: (tabId: string, dirty: boolean) => void;

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
  /**
   * Sprint 84 — paradigm-aware restore helper used when the user loads a
   * history entry. Routes the payload to either an in-place update on the
   * active tab (when the active tab is a query tab on the same connection +
   * paradigm) or a brand-new query tab that inherits the entry's paradigm,
   * queryMode, and (for document paradigms) database/collection. See the
   * implementation below for branch details.
   */
  loadQueryIntoTab: (payload: {
    connectionId: string;
    paradigm: Paradigm;
    queryMode: QueryMode;
    database?: string;
    collection?: string;
    sql: string;
  }) => void;

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

export const useTabStore = create<TabState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  closedTabHistory: [],
  dirtyTabIds: new Set<string>(),

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
      // Sprint 97 — drop the dirty marker when a tab is closed so a stale
      // entry can never linger after the tab disappears. Only allocate a
      // new Set when the entry was actually present.
      const dirtyTabIds = state.dirtyTabIds.has(id)
        ? (() => {
            const next = new Set(state.dirtyTabIds);
            next.delete(id);
            return next;
          })()
        : state.dirtyTabIds;
      return {
        tabs: filtered,
        activeTabId: newActive,
        closedTabHistory: newHistory,
        dirtyTabIds,
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

  updateTabSorts: (tabId, sorts) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId && t.type === "table" ? { ...t, sorts } : t,
      ),
    })),

  setTabDirty: (tabId, dirty) =>
    set((state) => {
      const has = state.dirtyTabIds.has(tabId);
      // No-op when the membership already matches the requested value so
      // the Set identity (and therefore subscriber renders) stay stable
      // when the publisher effect re-runs without a real transition.
      if (dirty === has) return state;
      const next = new Set(state.dirtyTabIds);
      if (dirty) {
        next.add(tabId);
      } else {
        next.delete(tabId);
      }
      return { dirtyTabIds: next };
    }),

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

  loadQueryIntoTab: (payload) => {
    const { connectionId, paradigm, queryMode, database, collection, sql } =
      payload;
    const state = get();
    const activeTab =
      state.activeTabId === null
        ? null
        : (state.tabs.find((t) => t.id === state.activeTabId) ?? null);

    // Branch decision — the restore is paradigm-aware:
    //   1. No active tab                       → spawn new query tab.
    //   2. Active tab is not a query tab       → spawn new query tab.
    //   3. Active tab targets a different
    //      connectionId                        → spawn new query tab.
    //   4. Active tab's paradigm differs       → spawn new query tab.
    //   5. Otherwise (same paradigm + same
    //      connectionId)                       → in-place update of the
    //                                            active tab's sql + queryMode.
    const canInPlace =
      activeTab !== null &&
      activeTab.type === "query" &&
      activeTab.connectionId === connectionId &&
      activeTab.paradigm === paradigm;

    if (!canInPlace) {
      // Delegating to `addQueryTab` keeps the `queryCounter` tick +
      // activeTabId promotion logic in one place. `addQueryTab` updates
      // `activeTabId` synchronously via `set`, so we can recover the new
      // tab id by reading `getState().activeTabId` immediately after.
      get().addQueryTab(connectionId, {
        paradigm,
        queryMode,
        database,
        collection,
      });
      const newTabId = get().activeTabId;
      if (newTabId) {
        get().updateQuerySql(newTabId, sql);
      }
      return;
    }

    // Same paradigm + same connection — stamp the payload onto the active
    // tab. Per the Sprint 84 execution brief, `database` / `collection`
    // on the tab are intentionally preserved: the user's current context
    // (e.g. a Mongo tab focused on a specific collection) should not be
    // overwritten by the entry's originally-executed collection, which may
    // differ. Only the editor contents (sql + queryMode) change.
    const targetId = activeTab.id;
    get().updateQuerySql(targetId, sql);
    get().setQueryMode(targetId, queryMode);
  },

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
        //
        // Sprint 76: normalise the `sorts` field. Older serialised tabs
        // predate per-tab sort state and omit the key entirely, so we
        // default to `[]` here rather than threading an `undefined` guard
        // through every consumer (`DataGrid`, `DataGridTable`, `fetchData`).
        if (t.type === "table") {
          return {
            ...t,
            isPreview: false,
            paradigm: t.paradigm ?? ("rdb" as const),
            sorts: t.sorts ?? [],
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
