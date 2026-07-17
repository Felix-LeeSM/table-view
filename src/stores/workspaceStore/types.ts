/**
 * `workspaceStore` types. Per-workspace state keyed by (connId, db) —
 * ADR 0027.
 */
import type { ConnectionId, TabId } from "@/types/branded";
import type { Paradigm } from "@/types/connection";
import type { QueryLanguageId } from "@/types/dataSource";
import type {
  QueryResult,
  QueryState,
  QueryStatementResult,
} from "@/types/query";
import type { SearchResultEnvelope } from "@/types/search";
import type { FilterCondition, SortInfo } from "@/types/schema";
import type {
  DocumentWorkspaceQueryModeInput,
  WorkspaceQueryMode,
} from "./queryMode";
export type { WorkspaceQueryMode } from "./queryMode";

// ---------------------------------------------------------------------------
// Tab types — discriminated union so consumers can narrow on `tab.type`
// ---------------------------------------------------------------------------

export type TabSubView = "records" | "structure";

/**
 * Sprint 272 — sub-tab of the Structure pane. Extends the
 * `StructurePanel` `SubTab` enum verbatim. `undefined` keeps the default
 * "columns" route so existing tabs / persisted payloads are
 * byte-equivalent. Only consumed when `subView === "structure"`.
 */
export type StructureSubTab =
  | "columns"
  | "indexes"
  | "constraints"
  | "triggers";

/**
 * Distinguishes between a base table and a view. Both share the tab
 * shape, but the Structure sub-view renders differently (read-only
 * columns + definition SQL for views vs. editable columns + indexes +
 * constraints for tables). Defaults to "table" when omitted (legacy
 * persisted tabs).
 */
export type TabObjectKind = "table" | "view";

/** A tab that shows table data / structure. */
export interface TableTab {
  type: "table";
  id: TabId;
  title: string;
  connectionId: ConnectionId;
  closable: boolean;
  schema?: string;
  table?: string;
  /** MongoDB database name (document paradigm only). */
  database?: string;
  /** MongoDB collection name (document paradigm only). */
  collection?: string;
  subView: TabSubView;
  /**
   * Sprint 272 — initial Structure sub-tab when `subView === "structure"`.
   * The "View Triggers" right-click affordance threads `"triggers"` here
   * so `StructurePanel` mounts on the Triggers sub-tab. `undefined`
   * preserves the default "columns" route (existing call sites byte-
   * equivalent).
   */
  initialStructureSubTab?: StructureSubTab;
  /** Whether this tab points at a base table or a view. */
  objectKind?: TabObjectKind;
  /** When true, clicking another table in the same connection replaces this tab. */
  isPreview?: boolean;
  /** Pre-applied filters when the tab is opened (e.g. from FK navigation). */
  initialFilters?: FilterCondition[];
  /** Paradigm of the connection. */
  paradigm?: Paradigm;
  /** Per-tab sort state. */
  sorts?: SortInfo[];
}

/** A tab that hosts the SQL / document query editor. */
export interface QueryTab {
  type: "query";
  id: TabId;
  title: string;
  connectionId: ConnectionId;
  closable: boolean;
  sql: string;
  queryState: QueryState;
  paradigm: Paradigm;
  /**
   * @deprecated Sprint 309 (Phase 28 Slice A3) — Find/Aggregate toggle
   * removed from the editor surface, so the editor and toolbar no longer
   * consume this field. RDB tabs continue to carry `"sql"`; legacy
   * persisted document tabs may still carry `"find" | "aggregate"` and
   * `useQueryExecution` (sprint-311 A5 target) still branches on
   * `=== "aggregate"` until parser-driven dispatch lands. New document
   * tabs created in sprint-309 leave this field `undefined` — that
   * deliberately falls through the legacy `aggregate` check into the
   * default find dispatch. The type union itself will be removed in a
   * later sprint once A5 lands and no consumer remains.
   */
  queryMode?: WorkspaceQueryMode;
  /** Canonical query language metadata for future routing. */
  queryLanguage?: QueryLanguageId;
  searchTarget?: SearchQueryTarget;
  database?: string;
  collection?: string;
}

/**
 * A database-level ERD tab. The entity-relationship diagram is a whole-
 * database concept, so this tab is keyed by `(connectionId, database)`
 * only — it carries no schema/table. Opened from the schema-tree header
 * (`openErdTab`), rendered by `SchemaErdPanel`.
 */
export interface ErdTab {
  type: "erd";
  id: TabId;
  title: string;
  connectionId: ConnectionId;
  closable: boolean;
  /** Database whose schema graph the ERD renders. */
  database: string;
}

export type Tab = TableTab | QueryTab | ErdTab;

export type SidebarState = {
  selectedNode: string | null;
  // #1217 — `null` means "never seeded" (fresh in-memory cell); an array
  // (including `[]`) means the sidebar has been seeded or the user set it.
  // The SchemaTree first-schema seed only fires while this is `null`, so a
  // user who collapses everything (`[]`) is not re-seeded on restart.
  expanded: string[] | null;
  scrollTop: number;
};

export type WorkspaceState = {
  tabs: Tab[];
  activeTabId: string | null;
  closedTabHistory: Tab[];
  /** localStorage round-trip 위해 array (`Set` 직렬화 X). */
  dirtyTabIds: string[];
  sidebar: SidebarState;
};

// `connectionId` is accepted as a plain `string` here (call sites read it off
// component props / DOM CustomEvent details, not an already-branded source) and
// minted to `ConnectionId` once inside `addTab` at the tab-creation boundary.
export type TableTabInit = Omit<
  TableTab,
  "id" | "isPreview" | "connectionId"
> & {
  connectionId: string;
  permanent?: boolean;
};

export type QueryTabOptions = {
  paradigm?: Paradigm;
  queryMode?: WorkspaceQueryMode;
  queryLanguage?: QueryLanguageId;
  title?: string;
  sql?: string;
  searchTarget?: SearchQueryTarget;
  database?: string;
  collection?: string;
};

export type SearchQueryTarget = {
  kind: "index" | "alias";
  name: string;
};

export type LoadQueryPayload = {
  connectionId: string;
  paradigm: Paradigm;
  queryMode?: WorkspaceQueryMode | DocumentWorkspaceQueryModeInput;
  queryLanguage?: QueryLanguageId;
  database?: string;
  collection?: string;
  sql: string;
};

export type MultiStatementPayload = {
  statementResults: QueryStatementResult[];
  lastResult: QueryResult | null;
  allFailed: boolean;
  joinedErrorMessage: string;
};

export interface WorkspaceStoreState {
  workspaces: Record<string, Record<string, WorkspaceState>>;

  // -- Table tab actions --------------------------------------------------
  addTab: (connId: string, init: TableTabInit) => void;
  removeTab: (connId: string, db: string, tabId: string) => void;
  setActiveTab: (connId: string, db: string, tabId: string) => void;
  setSubView: (
    connId: string,
    db: string,
    tabId: string,
    subView: TabSubView,
  ) => void;
  promoteTab: (connId: string, db: string, tabId: string) => void;
  /**
   * Open (or re-focus) the database-level ERD tab for `(connId, db)`.
   * Dedups on the workspace bucket: an existing erd tab there already
   * targets this same database, so it is reactivated instead of duplicated.
   */
  openErdTab: (connId: string, db: string) => void;
  updateTabSorts: (
    connId: string,
    db: string,
    tabId: string,
    sorts: SortInfo[],
  ) => void;
  setTabDirty: (
    connId: string,
    db: string,
    tabId: string,
    dirty: boolean,
  ) => void;
  moveTab: (
    connId: string,
    db: string,
    fromId: string,
    toId: string,
    position?: "before" | "after",
  ) => void;
  reopenLastClosedTab: (connId: string, db: string) => void;

  // -- Query tab actions --------------------------------------------------
  addQueryTab: (connId: string, db: string, opts?: QueryTabOptions) => void;
  updateQuerySql: (
    connId: string,
    db: string,
    tabId: string,
    sql: string,
  ) => void;
  updateQueryState: (
    connId: string,
    db: string,
    tabId: string,
    state: QueryState,
  ) => void;
  // Issue #1230 — attach the native server pid to a running query so the
  // Cancel button can fire `cancelQueryNative`. No-op unless the tab is still
  // running the same `queryId`.
  setRunningQueryServerPid: (
    connId: string,
    db: string,
    tabId: string,
    queryId: string,
    serverPid: number,
  ) => void;
  setQueryTabDatabase: (
    connId: string,
    db: string,
    tabId: string,
    nextDatabase: string,
  ) => void;
  setQueryMode: (
    connId: string,
    db: string,
    tabId: string,
    mode: WorkspaceQueryMode,
  ) => void;
  completeQuery: (
    connId: string,
    db: string,
    tabId: string,
    queryId: string,
    result: QueryResult,
    // #1226 — executed SQL snapshot for single-statement RDB results, so the
    // grid judges edit-ability against the run (not the live editor). Omitted
    // by document / kv completions whose results are never edit-mapped.
    sql?: string,
  ) => void;
  completeSearchQuery: (
    connId: string,
    db: string,
    tabId: string,
    queryId: string,
    result: SearchResultEnvelope,
  ) => void;
  failQuery: (
    connId: string,
    db: string,
    tabId: string,
    queryId: string,
    errorMessage: string,
  ) => void;
  cancelRunningQuery: (
    connId: string,
    db: string,
    tabId: string,
    queryId: string,
    message?: string,
  ) => void;
  completeMultiStatementQuery: (
    connId: string,
    db: string,
    tabId: string,
    queryId: string,
    payload: MultiStatementPayload,
  ) => void;
  completeQueryDryRun: (
    connId: string,
    db: string,
    tabId: string,
    queryId: string,
    result: QueryResult,
    statements?: QueryStatementResult[],
    // #1226 — executed SQL snapshot for a single-statement dry-run result
    // (same edit-ability rationale as `completeQuery`). Multi-statement
    // dry-runs pass `statements` and leave this undefined.
    sql?: string,
  ) => void;
  loadQueryIntoTab: (payload: LoadQueryPayload) => void;

  clearForConnection: (connId: string) => void;
  hydrateWorkspacesFromSnapshot: (
    workspaces: Record<string, Record<string, WorkspaceState>>,
  ) => void;

  toggleExpand: (connId: string, db: string, nodeId: string) => void;
  setExpanded: (connId: string, db: string, nodes: string[]) => void;
  setScrollTop: (connId: string, db: string, px: number) => void;
  setSelectedNode: (connId: string, db: string, nodeId: string | null) => void;

  loadPersistedWorkspaces: () => void;
}
