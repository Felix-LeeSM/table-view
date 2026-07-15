import type { TabId } from "@/types/branded";
import { paradigmOf, type Paradigm } from "@/types/connection";
import type { WorkspaceState, WorkspaceStoreState } from "./types";

// `workspaceStore` reads `connectionStore` only at resolver/selector seams.
// Write actions still take `(connId, db)` explicitly.
/* eslint-disable no-restricted-imports */
import { useConnectionStore } from "../connectionStore";
/* eslint-enable no-restricted-imports */

export type WorkspaceSet = (
  partial:
    | WorkspaceStoreState
    | Partial<WorkspaceStoreState>
    | ((
        state: WorkspaceStoreState,
      ) => WorkspaceStoreState | Partial<WorkspaceStoreState>),
) => void;

export type WorkspaceGet = () => WorkspaceStoreState;

export function emptyWorkspace(): WorkspaceState {
  return {
    tabs: [],
    activeTabId: null,
    closedTabHistory: [],
    dirtyTabIds: [],
    // #1217 — `expanded: null` marks a never-seeded sidebar so the
    // first-schema seed can distinguish it from a user-emptied `[]`.
    sidebar: { selectedNode: null, expanded: null, scrollTop: 0 },
  };
}

let tabCounter = 0;
let queryCounter = 0;

/**
 * Sprint 354 (M-2 fix) — seed `tabCounter` / `queryCounter` from persisted
 * tab ids so post-boot `addTab` / `addQueryTab` allocate fresh ids that
 * cannot collide with the persisted set.
 */
export function seedCountersFromWorkspaces(
  workspaces: Record<string, Record<string, { tabs: { id: string }[] }>>,
): void {
  let maxTab = tabCounter;
  let maxQuery = queryCounter;
  for (const conn of Object.values(workspaces)) {
    if (!conn) continue;
    for (const ws of Object.values(conn)) {
      if (!ws) continue;
      for (const tab of ws.tabs) {
        if (tab.id.startsWith("tab-")) {
          const n = parseInt(tab.id.slice(4), 10);
          if (!Number.isNaN(n) && n > maxTab) maxTab = n;
        } else if (tab.id.startsWith("query-")) {
          const n = parseInt(tab.id.slice(6), 10);
          if (!Number.isNaN(n) && n > maxQuery) maxQuery = n;
        }
      }
    }
  }
  tabCounter = maxTab;
  queryCounter = maxQuery;
}

/**
 * Sprint 354 — test-only escape hatch. Counters are module-scope (M-9 in
 * the strategy doc) so `setState({ workspaces: {} })` cannot reset them.
 */
export function __resetCountersForTests(): void {
  tabCounter = 0;
  queryCounter = 0;
}

// #1493 — tab-id mint boundary: brand once at the single allocation point so
// every tab constructed from these carries a `TabId`.
export function nextTabId(): TabId {
  tabCounter += 1;
  return `tab-${tabCounter}` as TabId;
}

export function nextQueryId(): TabId {
  queryCounter += 1;
  return `query-${queryCounter}` as TabId;
}

export function nextQueryTabIdentity(): { id: TabId; title: string } {
  const id = nextQueryId();
  return { id, title: `Query ${queryCounter}` };
}

/**
 * Resolve the active database for `connectionId`. Prefers the live
 * `activeDb` and falls back to the connection's stored default `database`.
 */
export function resolveActiveDb(connectionId: string): string {
  const conn = useConnectionStore.getState();
  const status = conn.activeStatuses[connectionId];
  if (status?.type === "connected" && status.activeDb) {
    return status.activeDb;
  }
  return conn.connections.find((c) => c.id === connectionId)?.database ?? "";
}

/**
 * Derive the paradigm for `connectionId` from its `dbType`. Used as the
 * `addQueryTab` fallback when callers do not pass an explicit paradigm.
 */
export function resolveParadigmForConnection(connectionId: string): Paradigm {
  const conn = useConnectionStore.getState();
  const dbType = conn.connections.find((c) => c.id === connectionId)?.dbType;
  return dbType ? paradigmOf(dbType) : "rdb";
}

/**
 * Patch a single workspace at `(connId, db)`. Lazy-creates the workspace
 * when missing; returns `null` when the updater preserves identity.
 */
export function withWorkspace(
  state: { workspaces: WorkspaceStoreState["workspaces"] },
  connId: string,
  db: string,
  updater: (ws: WorkspaceState) => WorkspaceState,
): WorkspaceStoreState["workspaces"] | null {
  const conn = state.workspaces[connId] ?? {};
  const existing = conn[db] ?? emptyWorkspace();
  const updated = updater(existing);
  if (updated === existing) return null;
  return {
    ...state.workspaces,
    [connId]: { ...conn, [db]: updated },
  };
}

export function patchExistingWorkspace(
  state: { workspaces: WorkspaceStoreState["workspaces"] },
  connId: string,
  db: string,
  updater: (ws: WorkspaceState) => WorkspaceState,
): WorkspaceStoreState["workspaces"] | null {
  const conn = state.workspaces[connId];
  const existing = conn?.[db];
  if (!existing) return null;
  const updated = updater(existing);
  if (updated === existing) return null;
  return {
    ...state.workspaces,
    [connId]: { ...conn, [db]: updated },
  };
}
