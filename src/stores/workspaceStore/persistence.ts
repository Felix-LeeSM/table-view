/**
 * `workspaceStore` persistence helpers — ADR 0027.
 *
 *   - `STORAGE_KEY = "table-view-workspaces"` (split from
 *     `table-view-tabs`; old key left as fossil).
 *   - Raw `persistWorkspaces` + 200ms debounce wrapper.
 *   - `migrateLoadedWorkspaces` rehydration step: collapses in-flight
 *     `QueryTab.queryState` to idle and backfills `sidebar` defaults so
 *     downstream consumers can drop guards.
 */
import type { Paradigm } from "@/types/connection";
import type { QueryMode, Tab, WorkspaceState } from "./types";

export const STORAGE_KEY = "table-view-workspaces";

/**
 * Sprint 353 (Phase 0 dehydration, state-management-strategy Q16/M-1).
 * Strips memory-only fields from a `WorkspaceState` before LS write so
 * the persisted blob carries no transient invariants.
 */
function stripQueryState(tab: Tab): Tab {
  if (tab.type !== "query") return tab;
  return { ...tab, queryState: { status: "idle" as const } };
}

export function dehydrate(state: WorkspaceState): WorkspaceState {
  return {
    ...state,
    dirtyTabIds: [],
    sidebar: {
      ...state.sidebar,
      selectedNode: null,
      scrollTop: 0,
    },
    tabs: state.tabs.map(stripQueryState),
    closedTabHistory: state.closedTabHistory.slice(0, 25).map(stripQueryState),
  };
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

export type WorkspacesShape = Record<string, Record<string, WorkspaceState>>;

function dehydrateAll(workspaces: WorkspacesShape): WorkspacesShape {
  const out: WorkspacesShape = {};
  for (const connId of Object.keys(workspaces)) {
    const byDb = workspaces[connId];
    if (!byDb) continue;
    const conn: Record<string, WorkspaceState> = {};
    for (const db of Object.keys(byDb)) {
      const ws = byDb[db];
      if (!ws) continue;
      conn[db] = dehydrate(ws);
    }
    out[connId] = conn;
  }
  return out;
}

export function persistWorkspaces(workspaces: WorkspacesShape): void {
  if (typeof window === "undefined") return;
  try {
    const data = JSON.stringify({ workspaces: dehydrateAll(workspaces) });
    window.localStorage.setItem(STORAGE_KEY, data);
  } catch {
    // localStorage unavailable (SSR, quota); persistence is best-effort.
  }
}

export function debouncePersistWorkspaces(workspaces: WorkspacesShape): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistWorkspaces(workspaces);
    persistTimer = null;
  }, 200);
}

function migrateTab(t: Tab): Tab {
  if (t.type === "query") {
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
  if (t.type === "table") {
    const paradigm = t.paradigm ?? ("rdb" as const);
    const isDocument = paradigm === "document";
    const database = isDocument ? (t.database ?? t.schema) : t.database;
    const collection = isDocument ? (t.collection ?? t.table) : t.collection;
    return {
      ...t,
      isPreview: false,
      paradigm,
      sorts: t.sorts ?? [],
      database,
      collection,
    };
  }
  return t;
}

function migrateWorkspace(raw: Partial<WorkspaceState>): WorkspaceState {
  return {
    tabs: (raw.tabs ?? []).map(migrateTab),
    activeTabId: raw.activeTabId ?? null,
    closedTabHistory: raw.closedTabHistory ?? [],
    dirtyTabIds: raw.dirtyTabIds ?? [],
    sidebar: {
      selectedNode: raw.sidebar?.selectedNode ?? null,
      expanded: raw.sidebar?.expanded ?? [],
      scrollTop: raw.sidebar?.scrollTop ?? 0,
    },
  };
}

export function migrateLoadedWorkspaces(
  raw: Record<string, Record<string, Partial<WorkspaceState>>>,
): WorkspacesShape {
  const out: WorkspacesShape = {};
  for (const connId of Object.keys(raw)) {
    const byDb = raw[connId];
    if (!byDb) continue;
    const conn: Record<string, WorkspaceState> = {};
    for (const db of Object.keys(byDb)) {
      const ws = byDb[db];
      if (!ws) continue;
      conn[db] = migrateWorkspace(ws);
    }
    out[connId] = conn;
  }
  return out;
}
