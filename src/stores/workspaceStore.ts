/**
 * `workspaceStore` — per-workspace state keyed by `(connId, db)`. ADR 0027.
 *
 * Absorbs the former `tabStore`: tabs, active tab, closed-tab history,
 * dirty markers, and sidebar (selected node / expanded set / scroll
 * position) all live in a cohesive `WorkspaceState` keyed by the
 * `(connId, db)` tuple.
 *
 * Active workspace identity is *not* owned here — `useCurrentWorkspaceKey`
 * derives it from `connectionStore.focusedConnId +
 * activeStatuses[id].activeDb`, keeping a single source of truth.
 *
 * Write actions are independent of `connectionStore`; every mutating
 * action takes `(connId, db)` explicitly (Q7 'a' lock from ADR 0027).
 */
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { paradigmOf, type Paradigm } from "@/types/connection";
import type { QueryState } from "@/types/query";
import { attachZustandIpcBridge } from "@lib/zustand-ipc-bridge";
import { getCurrentWindowLabel } from "@lib/window-label";
import type {
  QueryMode,
  QueryTab,
  Tab,
  TableTab,
  WorkspaceState,
  WorkspaceStoreState,
} from "./workspaceStore/types";
// `workspaceStore` reads `connectionStore` only at the selector seam to
// derive `(focusedConnId, activeDb)` — write actions stay independent.
// The `dataGridEditStore` purge is a one-way write at the natural
// lifecycle seam (`removeTab` / `clearForConnection`), matching the
// sprint-251 contract.
/* eslint-disable no-restricted-imports */
import {
  useDataGridEditStore,
  entryKey as makeDataGridEditKey,
} from "./dataGridEditStore";
import { useConnectionStore } from "./connectionStore";
import {
  STORAGE_KEY,
  debouncePersistWorkspaces,
  migrateLoadedWorkspaces,
} from "./workspaceStore/persistence";
/* eslint-enable no-restricted-imports */

export type {
  QueryMode,
  QueryTab,
  SidebarState,
  Tab,
  TableTab,
  TableTabInit,
  TabObjectKind,
  TabSubView,
  WorkspaceState,
  WorkspaceStoreState,
} from "./workspaceStore/types";

function emptyWorkspace(): WorkspaceState {
  return {
    tabs: [],
    activeTabId: null,
    closedTabHistory: [],
    dirtyTabIds: [],
    sidebar: { selectedNode: null, expanded: [], scrollTop: 0 },
  };
}

let tabCounter = 0;
let queryCounter = 0;

/**
 * Resolve the active database for `connectionId`. Prefers the live
 * `activeDb` (set by `switchActiveDb` after a successful pool open) and
 * falls back to the connection's stored default `database`. Returns
 * `""` when nothing matches — keeps `addTab` autofill crash-free for
 * connections that haven't completed `connectToDatabase` yet.
 *
 * Mirrors the original `tabStore/persistence.ts` lookup. Cross-store
 * dependency is read-only and contained to the one path that needs
 * autofill (addTab / addQueryTab); explicit-API callers pass `db`
 * directly and bypass this entirely.
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
 * Derive the paradigm for `connectionId` from its `db_type`. Used as the
 * `addQueryTab` paradigm fallback when the caller (sidebar "+ Query"
 * button, Cmd+N) does not pass an explicit paradigm. Previously the
 * store hard-coded `"rdb"` here, which produced an RDB query tab on
 * Mongo connections and immediately failed at execute time with
 * `Operation requires a relational (RDB) connection`. Returns `"rdb"`
 * when the connection is not found (defensive — keeps tab creation
 * crash-free; the live `useConnectionStore` lookup mirrors
 * `resolveActiveDb` above).
 */
function resolveParadigmForConnection(connectionId: string): Paradigm {
  const conn = useConnectionStore.getState();
  const dbType = conn.connections.find((c) => c.id === connectionId)?.db_type;
  return dbType ? paradigmOf(dbType) : "rdb";
}

/**
 * Patch a single workspace at `(connId, db)`. Lazy-creates the workspace
 * when missing; the updater receives a fresh empty workspace in that
 * case. Returns the new `workspaces` map, or the unchanged one when the
 * updater returns the same reference (identity short-circuit so
 * subscribers don't re-render).
 */
function withWorkspace(
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

function patchExistingWorkspace(
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

export const useWorkspaceStore = create<WorkspaceStoreState>((set, get) => ({
  workspaces: {},

  // -- Table tab actions ----------------------------------------------------

  addTab: (connId, init) => {
    tabCounter++;
    const id = `tab-${tabCounter}`;
    // Autofill db for RDB tabs when caller omitted it. Document tabs
    // always carry their own db (set by callers that know the Mongo
    // database name); leaving those untouched preserves the original
    // tabStore semantics.
    const isRdb = (init.paradigm ?? "rdb") === "rdb";
    const db = init.database ?? (isRdb ? resolveActiveDb(connId) : "");
    const { permanent, ...rest } = init;
    const tabFields = { ...rest, database: db };
    set((state) => {
      const next = withWorkspace(state, connId, db, (ws) => {
        // 1. Existing tab matching (table, subView). Reactivate (or
        //    promote in-place when caller requested permanent).
        const exists = ws.tabs.find(
          (t): t is TableTab =>
            t.type === "table" &&
            t.connectionId === tabFields.connectionId &&
            t.table === tabFields.table &&
            t.table !== undefined &&
            (t.subView ?? "records") === (tabFields.subView ?? "records"),
        );
        if (exists) {
          if (permanent && exists.isPreview) {
            return {
              ...ws,
              tabs: ws.tabs.map((t) =>
                t.id === exists.id ? { ...t, isPreview: false } : t,
              ),
              activeTabId: exists.id,
            };
          }
          if (ws.activeTabId === exists.id) return ws;
          return { ...ws, activeTabId: exists.id };
        }

        // 2. Preview slot replacement — non-permanent additions reuse
        //    any existing preview slot for the same (connectionId,
        //    subView). 두 조건이 모두 맞는 preview 만 재사용해서, 다른
        //    connection 의 preview 가 잘못 덮어써지지 않도록 한다 (legacy
        //    tabStore 와 동일한 의미).
        if (!permanent) {
          const previewIdx = ws.tabs.findIndex(
            (t): t is TableTab =>
              t.type === "table" &&
              t.connectionId === tabFields.connectionId &&
              t.isPreview === true &&
              (t.subView ?? "records") === (tabFields.subView ?? "records"),
          );
          if (previewIdx !== -1) {
            const tabs = [...ws.tabs];
            tabs[previewIdx] = {
              ...tabFields,
              id,
              isPreview: true,
            } as TableTab;
            return { ...ws, tabs, activeTabId: id };
          }
        }

        // 3. Plain append.
        const newTab: TableTab = {
          ...tabFields,
          id,
          isPreview: !permanent,
        };
        return {
          ...ws,
          tabs: [...ws.tabs, newTab],
          activeTabId: id,
        };
      });
      return next ? { workspaces: next } : state;
    });
  },

  removeTab: (connId, db, tabId) => {
    const stateBefore = get();
    const wsBefore = stateBefore.workspaces[connId]?.[db];
    if (!wsBefore) return;
    const closingTab = wsBefore.tabs.find((t) => t.id === tabId);
    if (!closingTab) return;
    const survivors = wsBefore.tabs.filter((t) => t.id !== tabId);

    set((state) =>
      ((): { workspaces: WorkspaceStoreState["workspaces"] } | typeof state => {
        const next = patchExistingWorkspace(state, connId, db, (ws) => {
          const remaining = ws.tabs.filter((t) => t.id !== tabId);
          if (remaining.length === ws.tabs.length) return ws;
          const newActive =
            ws.activeTabId === tabId
              ? (remaining[remaining.length - 1]?.id ?? null)
              : ws.activeTabId;
          const newHistory = [closingTab, ...ws.closedTabHistory].slice(0, 20);
          const dirtyTabIds = ws.dirtyTabIds.includes(tabId)
            ? ws.dirtyTabIds.filter((id) => id !== tabId)
            : ws.dirtyTabIds;
          return {
            ...ws,
            tabs: remaining,
            activeTabId: newActive,
            closedTabHistory: newHistory,
            dirtyTabIds,
          };
        });
        return next ? { workspaces: next } : state;
      })(),
    );

    // dataGridEditStore purge — fire only when no surviving tab still
    // targets the same `(connectionId, schema, table)` key.
    if (closingTab.type === "table") {
      const closingSchema = closingTab.schema;
      const closingTable = closingTab.table;
      if (closingSchema && closingTable) {
        const key = makeDataGridEditKey(
          closingTab.connectionId,
          closingSchema,
          closingTable,
        );
        const stillUsed = survivors.some(
          (t) =>
            t.type === "table" &&
            t.connectionId === closingTab.connectionId &&
            t.schema === closingSchema &&
            t.table === closingTable,
        );
        if (!stillUsed) {
          useDataGridEditStore.getState().purgeKey(key);
        }
      }
    }
  },

  setActiveTab: (connId, db, tabId) => {
    set((state) => {
      const next = patchExistingWorkspace(state, connId, db, (ws) =>
        ws.activeTabId === tabId ? ws : { ...ws, activeTabId: tabId },
      );
      return next ? { workspaces: next } : state;
    });
  },

  setSubView: (connId, db, tabId, subView) => {
    set((state) => {
      const next = patchExistingWorkspace(state, connId, db, (ws) => {
        let changed = false;
        const tabs = ws.tabs.map((t) => {
          if (t.id !== tabId || t.type !== "table") return t;
          if (t.subView === subView) return t;
          changed = true;
          return { ...t, subView };
        });
        return changed ? { ...ws, tabs } : ws;
      });
      return next ? { workspaces: next } : state;
    });
  },

  promoteTab: (connId, db, tabId) => {
    set((state) => {
      const next = patchExistingWorkspace(state, connId, db, (ws) => {
        let changed = false;
        const tabs = ws.tabs.map((t) => {
          if (t.id !== tabId || t.type !== "table") return t;
          if (!t.isPreview) return t;
          changed = true;
          return { ...t, isPreview: false };
        });
        return changed ? { ...ws, tabs } : ws;
      });
      return next ? { workspaces: next } : state;
    });
  },

  updateTabSorts: (connId, db, tabId, sorts) => {
    set((state) => {
      const next = patchExistingWorkspace(state, connId, db, (ws) => {
        let changed = false;
        const tabs = ws.tabs.map((t) => {
          if (t.id !== tabId || t.type !== "table") return t;
          changed = true;
          return { ...t, sorts };
        });
        return changed ? { ...ws, tabs } : ws;
      });
      return next ? { workspaces: next } : state;
    });
  },

  setTabDirty: (connId, db, tabId, dirty) => {
    set((state) => {
      const next = patchExistingWorkspace(state, connId, db, (ws) => {
        const has = ws.dirtyTabIds.includes(tabId);
        if (dirty === has) return ws;
        const dirtyTabIds = dirty
          ? [...ws.dirtyTabIds, tabId]
          : ws.dirtyTabIds.filter((id) => id !== tabId);
        return { ...ws, dirtyTabIds };
      });
      return next ? { workspaces: next } : state;
    });
  },

  moveTab: (connId, db, fromId, toId, position = "before") => {
    if (fromId === toId) return;
    set((state) => {
      const next = patchExistingWorkspace(state, connId, db, (ws) => {
        const tabs = [...ws.tabs];
        const fromIdx = tabs.findIndex((t) => t.id === fromId);
        const toIdx = tabs.findIndex((t) => t.id === toId);
        if (fromIdx === -1 || toIdx === -1) return ws;
        const [moved] = tabs.splice(fromIdx, 1);
        const adjustedToIdx = toIdx > fromIdx ? toIdx - 1 : toIdx;
        const insertIdx =
          position === "before" ? adjustedToIdx : adjustedToIdx + 1;
        tabs.splice(insertIdx, 0, moved!);
        return { ...ws, tabs };
      });
      return next ? { workspaces: next } : state;
    });
  },

  reopenLastClosedTab: (connId, db) => {
    set((state) => {
      const next = patchExistingWorkspace(state, connId, db, (ws) => {
        if (ws.closedTabHistory.length === 0) return ws;
        const [restored, ...rest] = ws.closedTabHistory;
        const newId =
          restored!.type === "table"
            ? `tab-${++tabCounter}`
            : `query-${++queryCounter}`;
        const reopened: Tab =
          restored!.type === "table"
            ? { ...(restored as TableTab), id: newId }
            : { ...(restored as QueryTab), id: newId };
        return {
          ...ws,
          tabs: [...ws.tabs, reopened],
          activeTabId: newId,
          closedTabHistory: rest,
        };
      });
      return next ? { workspaces: next } : state;
    });
  },

  // -- Query tab actions ----------------------------------------------------

  addQueryTab: (connId, db, opts = {}) => {
    queryCounter++;
    const id = `query-${queryCounter}`;
    const title = `Query ${queryCounter}`;
    const paradigm: Paradigm =
      opts.paradigm ?? resolveParadigmForConnection(connId);
    // Sprint 309 — Find/Aggregate toggle removed. RDB tabs still need
    // `"sql"` (history filtering + dispatch read it); document tabs no
    // longer default to `"find"` so the field stays `undefined` on new
    // tabs. The legacy `useQueryExecution` dispatch branch checks
    // `=== "aggregate"`, which `undefined` short-circuits — routing new
    // doc tabs through the default find dispatch until A5 (sprint-311)
    // replaces the branch with parser-driven dispatch.
    const queryMode: QueryMode | undefined =
      paradigm === "rdb" ? "sql" : opts.queryMode;
    set((state) => {
      const next = withWorkspace(state, connId, db, (ws) => {
        const newTab: QueryTab = {
          type: "query" as const,
          id,
          title,
          connectionId: connId,
          closable: true,
          sql: "",
          queryState: { status: "idle" } as QueryState,
          paradigm,
          queryMode,
          database: opts.database ?? (paradigm === "rdb" ? db : undefined),
          collection: opts.collection,
        };
        return {
          ...ws,
          tabs: [...ws.tabs, newTab],
          activeTabId: id,
        };
      });
      return next ? { workspaces: next } : state;
    });
  },

  updateQuerySql: (connId, db, tabId, sql) => {
    set((state) => {
      const next = patchExistingWorkspace(state, connId, db, (ws) => {
        let changed = false;
        const tabs = ws.tabs.map((t) => {
          if (t.id !== tabId || t.type !== "query") return t;
          if (t.sql === sql) return t;
          changed = true;
          return { ...t, sql };
        });
        return changed ? { ...ws, tabs } : ws;
      });
      return next ? { workspaces: next } : state;
    });
  },

  updateQueryState: (connId, db, tabId, queryState) => {
    set((state) => {
      const next = patchExistingWorkspace(state, connId, db, (ws) => {
        let changed = false;
        const tabs = ws.tabs.map((t) => {
          if (t.id !== tabId || t.type !== "query") return t;
          changed = true;
          return { ...t, queryState };
        });
        return changed ? { ...ws, tabs } : ws;
      });
      return next ? { workspaces: next } : state;
    });
  },

  setQueryTabDatabase: (connId, db, tabId, nextDatabase) => {
    set((state) => {
      const next = patchExistingWorkspace(state, connId, db, (ws) => {
        let changed = false;
        const tabs = ws.tabs.map((t) => {
          if (t.id !== tabId || t.type !== "query") return t;
          if (t.database === nextDatabase) return t;
          changed = true;
          // Clear the collection binding when the database changes —
          // a stale `(database, collection)` pair would otherwise reject
          // queries that the user composes against the new database.
          // queryState is reset to idle so the previous database's result
          // grid doesn't linger and mislead the user.
          return {
            ...t,
            database: nextDatabase,
            collection: undefined,
            queryState: { status: "idle" } as QueryState,
          };
        });
        return changed ? { ...ws, tabs } : ws;
      });
      return next ? { workspaces: next } : state;
    });
  },

  setQueryMode: (connId, db, tabId, mode) => {
    set((state) => {
      const next = patchExistingWorkspace(state, connId, db, (ws) => {
        let changed = false;
        const tabs = ws.tabs.map((t) => {
          if (t.id !== tabId || t.type !== "query") return t;
          if (t.paradigm === "rdb" && mode !== "sql") return t;
          if (t.queryMode === mode) return t;
          changed = true;
          return { ...t, queryMode: mode };
        });
        return changed ? { ...ws, tabs } : ws;
      });
      return next ? { workspaces: next } : state;
    });
  },

  completeQuery: (connId, db, tabId, queryId, result) => {
    set((state) => {
      const next = patchExistingWorkspace(state, connId, db, (ws) => {
        const current = ws.tabs.find((t) => t.id === tabId);
        if (
          !current ||
          current.type !== "query" ||
          current.queryState.status !== "running" ||
          !("queryId" in current.queryState) ||
          current.queryState.queryId !== queryId
        ) {
          return ws;
        }
        const tabs = ws.tabs.map((t) =>
          t.id === tabId && t.type === "query"
            ? { ...t, queryState: { status: "completed" as const, result } }
            : t,
        );
        return { ...ws, tabs };
      });
      return next ? { workspaces: next } : state;
    });
  },

  failQuery: (connId, db, tabId, queryId, errorMessage) => {
    set((state) => {
      const next = patchExistingWorkspace(state, connId, db, (ws) => {
        const current = ws.tabs.find((t) => t.id === tabId);
        if (
          !current ||
          current.type !== "query" ||
          current.queryState.status !== "running" ||
          !("queryId" in current.queryState) ||
          current.queryState.queryId !== queryId
        ) {
          return ws;
        }
        const tabs = ws.tabs.map((t) =>
          t.id === tabId && t.type === "query"
            ? {
                ...t,
                queryState: {
                  status: "error" as const,
                  error: errorMessage,
                },
              }
            : t,
        );
        return { ...ws, tabs };
      });
      return next ? { workspaces: next } : state;
    });
  },

  completeMultiStatementQuery: (connId, db, tabId, queryId, payload) => {
    set((state) => {
      const next = patchExistingWorkspace(state, connId, db, (ws) => {
        const current = ws.tabs.find((t) => t.id === tabId);
        if (
          !current ||
          current.type !== "query" ||
          current.queryState.status !== "running" ||
          !("queryId" in current.queryState) ||
          current.queryState.queryId !== queryId
        ) {
          return ws;
        }
        const { statementResults, lastResult, allFailed, joinedErrorMessage } =
          payload;
        const tabs = ws.tabs.map((t) => {
          if (t.id !== tabId || t.type !== "query") return t;
          if (allFailed) {
            return {
              ...t,
              queryState: {
                status: "error" as const,
                error: joinedErrorMessage,
              },
            };
          }
          if (!lastResult) {
            return {
              ...t,
              queryState: {
                status: "error" as const,
                error: joinedErrorMessage,
              },
            };
          }
          return {
            ...t,
            queryState: {
              status: "completed" as const,
              result: lastResult,
              statements: statementResults,
            },
          };
        });
        return { ...ws, tabs };
      });
      return next ? { workspaces: next } : state;
    });
  },

  completeQueryDryRun: (connId, db, tabId, queryId, result, statements) => {
    set((state) => {
      const next = patchExistingWorkspace(state, connId, db, (ws) => {
        const current = ws.tabs.find((t) => t.id === tabId);
        if (
          !current ||
          current.type !== "query" ||
          current.queryState.status !== "running" ||
          !("queryId" in current.queryState) ||
          current.queryState.queryId !== queryId
        ) {
          return ws;
        }
        const tabs = ws.tabs.map((t) =>
          t.id === tabId && t.type === "query"
            ? {
                ...t,
                queryState:
                  statements === undefined
                    ? {
                        status: "completed" as const,
                        result,
                        isDryRun: true,
                      }
                    : {
                        status: "completed" as const,
                        result,
                        statements,
                        isDryRun: true,
                      },
              }
            : t,
        );
        return { ...ws, tabs };
      });
      return next ? { workspaces: next } : state;
    });
  },

  loadQueryIntoTab: (payload) => {
    const { connectionId, paradigm, queryMode, database, collection, sql } =
      payload;
    // Resolve target workspace key. Mongo callers supply `database`
    // explicitly; RDB callers may omit it (in which case the active DB
    // for the focused connection wins — matches sprint-261 behavior).
    const resolvedDb =
      database ??
      (() => {
        const status =
          useConnectionStore.getState().activeStatuses[connectionId];
        if (status?.type === "connected" && status.activeDb) {
          return status.activeDb;
        }
        return (
          useConnectionStore
            .getState()
            .connections.find((c) => c.id === connectionId)?.database ?? ""
        );
      })();

    const ws = get().workspaces[connectionId]?.[resolvedDb];
    const activeTab =
      ws && ws.activeTabId
        ? (ws.tabs.find((t) => t.id === ws.activeTabId) ?? null)
        : null;

    const canInPlace =
      activeTab !== null &&
      activeTab.type === "query" &&
      activeTab.connectionId === connectionId &&
      activeTab.paradigm === paradigm;

    if (!canInPlace) {
      get().addQueryTab(connectionId, resolvedDb, {
        paradigm,
        queryMode,
        database,
        collection,
      });
      const newTabId =
        get().workspaces[connectionId]?.[resolvedDb]?.activeTabId;
      if (newTabId) {
        get().updateQuerySql(connectionId, resolvedDb, newTabId, sql);
      }
      return;
    }

    const targetId = activeTab.id;
    get().updateQuerySql(connectionId, resolvedDb, targetId, sql);
    get().setQueryMode(connectionId, resolvedDb, targetId, queryMode);
  },

  // -- Cleanup --------------------------------------------------------------

  clearForConnection: (connId) => {
    const hadAny = connId in get().workspaces;
    set((state) => {
      if (!(connId in state.workspaces)) return state;
      const next = { ...state.workspaces };
      delete next[connId];
      return { workspaces: next };
    });
    if (hadAny) {
      useDataGridEditStore.getState().purgeForConnection(connId);
    }
  },

  // -- Sidebar actions ------------------------------------------------------

  toggleExpand: (connId, db, nodeId) => {
    set((state) => {
      const next = withWorkspace(state, connId, db, (ws) => {
        const has = ws.sidebar.expanded.includes(nodeId);
        const expanded = has
          ? ws.sidebar.expanded.filter((n) => n !== nodeId)
          : [...ws.sidebar.expanded, nodeId];
        return { ...ws, sidebar: { ...ws.sidebar, expanded } };
      });
      return next ? { workspaces: next } : state;
    });
  },

  setExpanded: (connId, db, nodes) => {
    set((state) => {
      const next = withWorkspace(state, connId, db, (ws) => {
        if (
          ws.sidebar.expanded.length === nodes.length &&
          ws.sidebar.expanded.every((n, i) => n === nodes[i])
        ) {
          return ws;
        }
        return { ...ws, sidebar: { ...ws.sidebar, expanded: [...nodes] } };
      });
      return next ? { workspaces: next } : state;
    });
  },

  setScrollTop: (connId, db, px) => {
    set((state) => {
      const next = withWorkspace(state, connId, db, (ws) =>
        ws.sidebar.scrollTop === px
          ? ws
          : { ...ws, sidebar: { ...ws.sidebar, scrollTop: px } },
      );
      return next ? { workspaces: next } : state;
    });
  },

  setSelectedNode: (connId, db, nodeId) => {
    set((state) => {
      const next = withWorkspace(state, connId, db, (ws) =>
        ws.sidebar.selectedNode === nodeId
          ? ws
          : { ...ws, sidebar: { ...ws.sidebar, selectedNode: nodeId } },
      );
      return next ? { workspaces: next } : state;
    });
  },

  loadPersistedWorkspaces: () => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as {
        workspaces?: Parameters<typeof migrateLoadedWorkspaces>[0];
      };
      if (!data.workspaces) return;
      set({ workspaces: migrateLoadedWorkspaces(data.workspaces) });
    } catch {
      // Corrupted localStorage — start fresh; matches tabStore's policy.
      set({ workspaces: {} });
    }
  },
}));

// Persist on every state change via subscribe. Debounced (200ms) to
// coalesce rapid bursts (e.g. typing in a query tab).
useWorkspaceStore.subscribe((state) => {
  debouncePersistWorkspaces(state.workspaces);
});

// ---------------------------------------------------------------------------
// IPC bridge — workspace-only, mirrors the tabStore bridge contract.
// ---------------------------------------------------------------------------

/**
 * Cross-window broadcast allowlist. Only `workspaces` is synchronized;
 * action members and selector hooks are not state, so the bridge skips
 * them automatically. The pre-existing fields that the tabStore bridge
 * excluded (`closedTabHistory`, `dirtyTabIds`) are now nested *inside*
 * `workspaces`; cross-window divergence on those nested fields is
 * acceptable since reopen stacks + grid edit markers are window-local
 * by intent (matches the original tabStore exclusion rationale).
 */
export const SYNCED_KEYS: ReadonlyArray<keyof WorkspaceStoreState> = [
  "workspaces",
] as const;

if (getCurrentWindowLabel() === "workspace") {
  void attachZustandIpcBridge<WorkspaceStoreState>(useWorkspaceStore, {
    channel: "workspace-sync",
    syncKeys: SYNCED_KEYS,
    originId: getCurrentWindowLabel() ?? "unknown",
  }).catch(() => {
    // best-effort: see mruStore.ts for the trade-off rationale.
  });
}

// ---------------------------------------------------------------------------
// Selector helpers — component-level glue between connectionStore and
// workspaceStore. Hooks live here (not in `hooks/`) so the cross-store
// dependency is co-located with the store that owns the read shape.
// ---------------------------------------------------------------------------

export type WorkspaceKey = { connId: string; db: string };

/**
 * Derive the current `(connId, db)` workspace coordinate from
 * `connectionStore.focusedConnId` + the corresponding
 * `activeStatuses[id].activeDb`. Returns `null` when either is missing.
 */
export function useCurrentWorkspaceKey(): WorkspaceKey | null {
  // `useShallow` keeps the returned `{ connId, db }` object referentially
  // stable across renders when both fields are unchanged — required for
  // React 19 strict mode + zustand v5's `useSyncExternalStore` snapshot
  // identity check.
  return useConnectionStore(
    useShallow((state) => {
      const connId = state.focusedConnId;
      if (!connId) return null;
      const status = state.activeStatuses[connId];
      if (!status || status.type !== "connected") return null;
      const db = status.activeDb;
      if (!db) return null;
      return { connId, db };
    }),
  );
}

/**
 * Resolve the `(connId, db)` workspace key for an explicit connection —
 * mirrors `useCurrentWorkspaceKey()` but lets the caller name the
 * connection (e.g. `SchemaTree` receives `connectionId` as a prop and
 * must key sidebar state by *that* connection, not whichever one is
 * focused). Picks `activeStatuses[connId].activeDb` first, then the
 * connection's stored default `database`. `null` when neither resolves.
 */
export function useWorkspaceKeyForConnection(
  connId: string | null,
): WorkspaceKey | null {
  return useConnectionStore(
    useShallow((state) => {
      if (!connId) return null;
      const status = state.activeStatuses[connId];
      if (status?.type === "connected" && status.activeDb) {
        return { connId, db: status.activeDb };
      }
      const fallback = state.connections.find((c) => c.id === connId)?.database;
      if (!fallback) return null;
      return { connId, db: fallback };
    }),
  );
}

/**
 * Read the `WorkspaceState` for the currently focused `(connId, db)`,
 * or `null` when no key resolves or no workspace has been written yet
 * (lazy create — `addTab` / `toggleExpand` / etc. seed the entry).
 */
export function useCurrentWorkspace(): WorkspaceState | null {
  const key = useCurrentWorkspaceKey();
  return useWorkspaceStore((state) => {
    if (!key) return null;
    return state.workspaces[key.connId]?.[key.db] ?? null;
  });
}

/**
 * Read a specific `(connId, db)` workspace. `null` when either argument
 * is `null` (caller hasn't picked a workspace yet) or no entry exists.
 */
export function useWorkspaceFor(
  connId: string | null,
  db: string | null,
): WorkspaceState | null {
  return useWorkspaceStore((state) => {
    if (!connId || !db) return null;
    return state.workspaces[connId]?.[db] ?? null;
  });
}

/**
 * Active tab of the currently focused workspace. `null` when no
 * workspace is focused or the workspace has no tabs.
 */
export function useActiveTab(): Tab | null {
  const ws = useCurrentWorkspace();
  if (!ws || !ws.activeTabId) return null;
  return ws.tabs.find((t) => t.id === ws.activeTabId) ?? null;
}

const EMPTY_TABS: readonly Tab[] = Object.freeze([]);
const EMPTY_STRINGS: readonly string[] = Object.freeze([]);

/**
 * Stable empty-array fallbacks so callers iterating `tabs` /
 * `dirtyTabIds` / `closedTabHistory` don't churn renders when the
 * workspace is missing.
 */
export function useCurrentTabs(): readonly Tab[] {
  const ws = useCurrentWorkspace();
  return ws?.tabs ?? EMPTY_TABS;
}

export function useActiveTabId(): string | null {
  const ws = useCurrentWorkspace();
  return ws?.activeTabId ?? null;
}

export function useDirtyTabIds(): readonly string[] {
  const ws = useCurrentWorkspace();
  return ws?.dirtyTabIds ?? EMPTY_STRINGS;
}

export function useClosedTabHistory(): readonly Tab[] {
  const ws = useCurrentWorkspace();
  return ws?.closedTabHistory ?? EMPTY_TABS;
}
