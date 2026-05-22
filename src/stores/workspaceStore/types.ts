/**
 * `workspaceStore` types. Per-workspace state keyed by (connId, db) —
 * ADR 0027.
 */
import type { Paradigm } from "@/types/connection";
import type { QueryLanguageId } from "@/types/dataSource";
import type {
  QueryResult,
  QueryState,
  QueryStatementResult,
} from "@/types/query";
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
  id: string;
  title: string;
  connectionId: string;
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
  id: string;
  title: string;
  connectionId: string;
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
  database?: string;
  collection?: string;
}

export type Tab = TableTab | QueryTab;

export type SidebarState = {
  selectedNode: string | null;
  expanded: string[];
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

export type TableTabInit = Omit<TableTab, "id" | "isPreview"> & {
  permanent?: boolean;
};

export type QueryTabOptions = {
  paradigm?: Paradigm;
  queryMode?: WorkspaceQueryMode;
  queryLanguage?: QueryLanguageId;
  database?: string;
  collection?: string;
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
  ) => void;
  failQuery: (
    connId: string,
    db: string,
    tabId: string,
    queryId: string,
    errorMessage: string,
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
  ) => void;
  loadQueryIntoTab: (payload: LoadQueryPayload) => void;

  clearForConnection: (connId: string) => void;

  toggleExpand: (connId: string, db: string, nodeId: string) => void;
  setExpanded: (connId: string, db: string, nodes: string[]) => void;
  setScrollTop: (connId: string, db: string, px: number) => void;
  setSelectedNode: (connId: string, db: string, nodeId: string | null) => void;

  loadPersistedWorkspaces: () => void;
}
