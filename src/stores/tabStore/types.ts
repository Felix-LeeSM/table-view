/**
 * `tabStore` Tab union types + `TabState` interface. Pure type module:
 * no runtime imports beyond type-only `@/types/...` and `@stores/...`.
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
   * MongoDB database name (document paradigm only). Optional because RDB
   * tabs never set it; legacy persisted document tabs that recorded the
   * database in `schema` are migrated in `loadPersistedTabs`.
   */
  database?: string;
  /**
   * MongoDB collection name (document paradigm only). Optional for the
   * same reason as {@link database}; legacy tabs are backfilled from
   * `table` on load.
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
   * Paradigm of the connection. Routes the tab to the correct read path
   * (RDB vs document) without re-inspecting connection state. Optional;
   * legacy persisted tabs are migrated to `"rdb"` in `loadPersistedTabs`.
   */
  paradigm?: Paradigm;
  /**
   * Per-tab sort state. Owned by the store (not the grid) so column
   * ordering survives the unmount/remount that happens on every tab
   * switch and persists alongside the tab itself. `loadPersistedTabs`
   * normalises missing values to `[]`.
   */
  sorts?: SortInfo[];
}

/** Execution mode for a query tab. SQL statements belong to `"sql"`,
 *  while document paradigms split into a MongoDB `find` body and an
 *  aggregation `pipeline`. Routes the editor + execute path. */
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
   * Paradigm of the connection. Drives CodeMirror language selection
   * (SQL ↔ JSON) and execute dispatch. Legacy persisted tabs default
   * to `"rdb"`.
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
   * Tab ids whose grid has unsaved edits. Published by the grid hook via
   * `setTabDirty` so consumers (`TabBar` dirty dot + close gate, debug
   * tooling) can read dirty state without depending on the hook itself.
   *
   * Idempotent: `setTabDirty(id, true)` on an already-dirty tab is a
   * no-op (Set identity preserved) so subscribers don't re-render on
   * every keystroke.
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
   * Publish dirty state for a single tab. Cheap when no membership
   * change is needed — the implementation skips the Set replacement so
   * effect publishers don't re-render every keystroke.
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
   * Transition: running → completed. Guards on tab existence, query
   * type, running status, and matching `queryId`; stale or mis-targeted
   * dispatches are a silent no-op so late responses can't overwrite a
   * fresher query's result.
   */
  completeQuery: (tabId: string, queryId: string, result: QueryResult) => void;
  /** Transition: running → error. Same guards as {@link completeQuery}. */
  failQuery: (tabId: string, queryId: string, errorMessage: string) => void;
  /**
   * Multi-statement batch completion. `allFailed === true` collapses to
   * `error` with a joined message; otherwise → `completed` with
   * `lastResult` plus the per-statement breakdown. Same stale-response
   * guards as {@link completeQuery}.
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
   * Sprint 248 (ADR 0022 Phase 4) — explicit dry-run completion. Called
   * by the "Dry Run" toolbar button / `Cmd+Shift+Enter` shortcut after
   * `executeQueryDryRun` resolves. Stamps `isDryRun: true` onto the
   * completed payload so `<QueryResultGrid>` can surface the
   * "rolled back. No data was changed." banner. Same stale-response /
   * `queryId` guards as {@link completeQuery}; single-statement runs
   * leave `statements` undefined, multi-statement runs populate it the
   * same way `completeMultiStatementQuery` does.
   */
  completeQueryDryRun: (
    tabId: string,
    queryId: string,
    result: QueryResult,
    statements?: QueryStatementResult[],
  ) => void;
  /**
   * Paradigm-aware history-entry restore. Updates the active query tab
   * in place when it matches connection + paradigm; otherwise spawns a
   * new tab that inherits paradigm / queryMode (and database/collection
   * for document paradigms). See the implementation for branch details.
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
   * Close every tab belonging to `connectionId`. Used by the activation
   * flow when the user swaps connections from the launcher; clean-close
   * is intentional (cross-DBMS migration is deferred).
   *
   * Closed tabs are NOT pushed onto `closedTabHistory` — reopen-last-closed
   * recovers accidental closes within a workspace, not tabs from a
   * connection the user actively swapped away from.
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
