import { vi } from "vitest";
import { useConnectionStore } from "../connectionStore";
import {
  useWorkspaceStore,
  type QueryTab,
  type Tab,
  type TableTab,
  type WorkspaceState,
  type WorkspaceStoreState,
} from "../workspaceStore";

export const DEFAULT_TEST_CONN = "conn1";
export const DEFAULT_TEST_DB = "db1";

export function makeTableTab(
  overrides: Partial<Omit<TableTab, "id" | "isPreview">> & {
    id?: string;
    permanent?: boolean;
  },
): Omit<TableTab, "id" | "isPreview"> & { permanent?: boolean } {
  return {
    title: "Test Tab",
    connectionId: "conn1",
    type: "table",
    closable: true,
    schema: "public",
    table: "users",
    subView: "records" as const,
    ...overrides,
  };
}

export function getTableTab(state: { tabs: Tab[] }, index: number): TableTab {
  const tab = state.tabs[index];
  if (!tab || tab.type !== "table") throw new Error("Expected TableTab");
  return tab;
}

export function getQueryTab(state: { tabs: Tab[] }, index: number): QueryTab {
  const tab = state.tabs[index];
  if (!tab || tab.type !== "query") throw new Error("Expected QueryTab");
  return tab;
}

/** Build an empty per-(connId, db) workspace slot. */
export function emptyWorkspace(): WorkspaceState {
  return {
    tabs: [],
    activeTabId: null,
    closedTabHistory: [],
    dirtyTabIds: [],
    sidebar: { selectedNode: null, expanded: [], scrollTop: 0 },
  };
}

/** Empty `useWorkspaceStore.setState()` payload. */
export function emptyWorkspacesState(): Pick<
  WorkspaceStoreState,
  "workspaces"
> {
  return { workspaces: {} };
}

/**
 * Align `connectionStore.focusedConnId` + `activeStatuses` with a
 * (connId, db) pair so `useCurrentWorkspaceKey()` derives the seeded
 * workspace correctly. Standalone helper for tests that drive
 * `addTab` / `addQueryTab` directly (rather than via `seedWorkspace`).
 */
export function seedConnection(
  connId: string = DEFAULT_TEST_CONN,
  db: string = DEFAULT_TEST_DB,
): void {
  useConnectionStore.setState((state) => ({
    focusedConnId: connId,
    activeStatuses: {
      ...state.activeStatuses,
      [connId]: { type: "connected", activeDb: db },
    },
  }));
}

/**
 * Seed a single workspace at (connId, db) with tabs + activeTabId.
 * Convenience for tests that previously did
 * `useTabStore.setState({ tabs, activeTabId })`.
 *
 * Also seeds the `connectionStore` so production callers that resolve
 * `(focusedConnId, activeDb)` via `useCurrentWorkspaceKey()` find the
 * seeded workspace. Without this, tests that drive the UI through a
 * rendered component would observe an empty workspace because
 * `focusedConnId` defaults to `null`.
 */
export function seedWorkspace(
  tabs: Tab[],
  activeTabId: string | null = null,
  connId?: string,
  db?: string,
  extras: Partial<WorkspaceState> = {},
): Pick<WorkspaceStoreState, "workspaces"> {
  // ADR 0027 — workspace key is `(connectionId, database)`. When the
  // caller omits the slot, derive it from the first tab so per-tab
  // actions in `useQueryExecution` (which dispatch via
  // `(tab.connectionId, tab.database)`) hit the same workspace where
  // the tab actually lives. Falls back to `(conn1, db1)` for tabs that
  // pre-date the migration and don't carry `database`.
  const firstTab = tabs[0];
  const resolvedConnId = connId ?? firstTab?.connectionId ?? DEFAULT_TEST_CONN;
  const resolvedDb =
    db ??
    (firstTab && firstTab.type === "table"
      ? (firstTab.database ?? DEFAULT_TEST_DB)
      : firstTab && firstTab.type === "query"
        ? (firstTab.database ?? DEFAULT_TEST_DB)
        : DEFAULT_TEST_DB);
  connId = resolvedConnId;
  db = resolvedDb;
  // Side-effect: align the connection store with the seeded workspace so
  // `useCurrentWorkspaceKey()` derives `(connId, db)` correctly. Skip
  // when the test already wrote a connected status for `connId` — those
  // tests set a specific `activeDb` (e.g. `"db"` for `\c admin` flows)
  // and seedWorkspace must not clobber it.
  useConnectionStore.setState((state) => {
    const existing = state.activeStatuses[connId];
    if (existing?.type === "connected" && existing.activeDb) {
      return { focusedConnId: connId };
    }
    return {
      focusedConnId: connId,
      activeStatuses: {
        ...state.activeStatuses,
        [connId]: { type: "connected", activeDb: db },
      },
    };
  });
  // Sprint 262 Slice B — preserve prior sidebar/closedTabHistory/dirtyTabIds
  // on re-seed. Without this, tests that call `seedWorkspace(...)` a second
  // time mid-test to update tabs/activeTabId would silently wipe the
  // SchemaTree's per-workspace sidebar state (now stored here, no longer
  // in component-local useState). Tests that *intend* a full reset call
  // `useWorkspaceStore.setState({ workspaces: {} })` in `beforeEach`.
  const priorWorkspace = useWorkspaceStore.getState().workspaces[connId]?.[db];
  const baseWorkspace = priorWorkspace ?? emptyWorkspace();
  return {
    workspaces: {
      [connId]: {
        [db]: {
          ...baseWorkspace,
          tabs,
          activeTabId,
          ...extras,
        },
      },
    },
  };
}

export function installFakeLocalStorage(): { storage: Record<string, string> } {
  const ref: { storage: Record<string, string> } = { storage: {} };
  vi.useFakeTimers();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => ref.storage[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      ref.storage[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete ref.storage[key];
    }),
    clear: vi.fn(() => {
      ref.storage = {};
    }),
    get length() {
      return Object.keys(ref.storage).length;
    },
    key: vi.fn(() => null),
  });
  return ref;
}

export function restoreLocalStorage(): void {
  vi.useRealTimers();
}

/**
 * Read the default test workspace slot (`conn1` / `db1`). Returns an
 * empty workspace when the slot has not been seeded. Replaces the
 * legacy `useTabStore.getState()` reads for tests that previously
 * inspected `tabs` / `activeTabId` / `closedTabHistory` / `dirtyTabIds`
 * directly off the flat tab store.
 */
export function getTestWorkspace(
  connId: string = DEFAULT_TEST_CONN,
  db: string = DEFAULT_TEST_DB,
): WorkspaceState {
  return (
    useWorkspaceStore.getState().workspaces[connId]?.[db] ?? emptyWorkspace()
  );
}

/**
 * Flatten every tab across every workspace slot under `connId`. Used by
 * DocumentDatabaseTree / DbSwitcher tests that previously relied on the
 * flat `useTabStore().tabs` list — now that tabs are partitioned per
 * `(connId, db)`, a "global" view across a connection's databases has
 * to walk every slot. Returns the tabs in workspace-iteration order.
 */
export function getAllTabsForConnection(connId: string): readonly Tab[] {
  const conn = useWorkspaceStore.getState().workspaces[connId];
  if (!conn) return [];
  const out: Tab[] = [];
  for (const ws of Object.values(conn)) {
    if (ws?.tabs) out.push(...ws.tabs);
  }
  return out;
}

/**
 * Build a `setState` payload that seeds a single running query tab in
 * the default test workspace. Replaces the legacy
 * `buildRunningQueryTabState()`.
 */
export function buildRunningQueryWorkspaceState(
  tabId = "q1",
  queryId = "q1-1700000000",
  connId: string = DEFAULT_TEST_CONN,
  db: string = DEFAULT_TEST_DB,
): Pick<WorkspaceStoreState, "workspaces"> {
  const tab: QueryTab = {
    type: "query",
    id: tabId,
    title: "Query 1",
    connectionId: connId,
    closable: true,
    sql: "SELECT 1",
    queryState: { status: "running", queryId },
    paradigm: "rdb",
    queryMode: "sql",
  } as QueryTab;
  return seedWorkspace([tab], tabId, connId, db);
}
