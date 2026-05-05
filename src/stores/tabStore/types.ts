/**
 * Sprint 208 — `tabStore` Tab union types + `TabState` interface.
 *
 * Extracted from the 1009-line `tabStore.ts` god file. Pure type module:
 * no runtime imports beyond type-only `@/types/...` and `@stores/...`.
 *
 * Sprint 212 — the legacy query-history wrapper signature was removed; the
 * cross-store query-history type imports were retired alongside it. The
 * `useQueryExecution.ts` 8 call sites now build the history payload
 * directly so the tab store no longer participates in query history
 * persistence.
 */
import type { Paradigm } from "@/types/connection";
import type {
  QueryResult,
  QueryState,
  QueryStatementResult,
} from "@/types/query";
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
  /**
   * Sprint 129 — document-paradigm-specific MongoDB database name. Optional
   * because RDB tabs never set this field; legacy persisted document tabs
   * (sprint <129) recorded the database as `schema` and are migrated in
   * `loadPersistedTabs` so this field is always populated on load.
   */
  database?: string;
  /**
   * Sprint 129 — document-paradigm-specific MongoDB collection name. Optional
   * for the same reason as {@link database}: RDB tabs never set this, and
   * legacy persisted document tabs are backfilled from `table` on load.
   */
  collection?: string;
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
// Store interface
// ---------------------------------------------------------------------------

export interface TabState {
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
  addTab: (
    tab: Omit<TableTab, "id" | "isPreview"> & { permanent?: boolean },
  ) => void;
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
   * Sprint 195 — intent-revealing transition: running → completed. Guards
   * (a) tab existence, (b) `type === "query"`, (c) `queryState.status ===
   * "running"`, (d) `queryState.queryId === queryId`. Stale or mis-targeted
   * dispatches are a no-op (preserves prior `useTabStore.setState` inline
   * guard semantics so racing /late responses can't overwrite a fresher
   * query's result).
   */
  completeQuery: (tabId: string, queryId: string, result: QueryResult) => void;
  /**
   * Sprint 195 — intent-revealing transition: running → error. Guards are
   * identical to {@link completeQuery}.
   */
  failQuery: (tabId: string, queryId: string, errorMessage: string) => void;
  /**
   * Sprint 195 — multi-statement batch completion. `allFailed === true`
   * collapses to `error` (with a joined error message); otherwise transitions
   * to `completed` with `lastResult` and the per-statement breakdown. Same
   * stale-response guards as {@link completeQuery}.
   */
  completeMultiStatementQuery: (
    tabId: string,
    queryId: string,
    payload: {
      statementResults: QueryStatementResult[];
      lastResult: QueryResult | null;
      allFailed: boolean;
      joinedErrorMessage: string;
    },
  ) => void;
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

  /**
   * Sprint 148 (AC-142-2) — close every tab belonging to `connectionId`.
   * Used by the activation flow when the user swaps to a different
   * connection from the launcher: spec calls for "close or graceful
   * migrate" of the previous connection's tabs and we adopt clean-close
   * (cross-DBMS migration is deferred). Same-id reactivation is a no-op
   * because the caller filters by id before invoking.
   *
   * Closed tabs are NOT pushed onto `closedTabHistory`: reopen-last-closed
   * is meant to recover from accidental close *within* a workspace, not to
   * resurrect tabs from a connection the user actively swapped away from.
   */
  clearTabsForConnection: (connectionId: string) => void;

  // Reorder tabs by drag-and-drop
  moveTab: (
    fromId: string,
    toId: string,
    position?: "before" | "after",
  ) => void;

  // Persistence
  loadPersistedTabs: () => void;
}
