import type { Paradigm } from "@/types/connection";
import type { QueryState } from "@/types/query";
import type {
  QueryTab,
  WorkspaceQueryMode,
  WorkspaceState,
  WorkspaceStoreState,
} from "../types";
import { toWorkspaceQueryLanguage, toWorkspaceQueryMode } from "../queryMode";
import {
  nextQueryTabIdentity,
  patchExistingWorkspace,
  resolveActiveDb,
  resolveParadigmForConnection,
  withWorkspace,
  type WorkspaceGet,
  type WorkspaceSet,
} from "../shared";

type QuerySlice = Pick<
  WorkspaceStoreState,
  | "addQueryTab"
  | "updateQuerySql"
  | "updateQueryState"
  | "setQueryTabDatabase"
  | "setQueryMode"
  | "completeQuery"
  | "completeSearchQuery"
  | "failQuery"
  | "cancelRunningQuery"
  | "completeMultiStatementQuery"
  | "completeQueryDryRun"
  | "loadQueryIntoTab"
>;

function isRunningQueryTab(
  tab: WorkspaceState["tabs"][number] | undefined,
  queryId: string,
): tab is QueryTab {
  return (
    tab?.type === "query" &&
    tab.queryState.status === "running" &&
    tab.queryState.queryId === queryId
  );
}

function patchRunningQueryTab(
  ws: WorkspaceState,
  tabId: string,
  queryId: string,
  update: (tab: QueryTab) => QueryTab,
): WorkspaceState {
  const current = ws.tabs.find((t) => t.id === tabId);
  if (!isRunningQueryTab(current, queryId)) {
    return ws;
  }

  return {
    ...ws,
    tabs: ws.tabs.map((t) =>
      t.id === tabId && t.type === "query" ? update(t) : t,
    ),
  };
}

function patchQueryCompatibilityMetadata(
  ws: WorkspaceState,
  tabId: string,
  queryMode: QueryTab["queryMode"],
  queryLanguage: QueryTab["queryLanguage"],
): WorkspaceState {
  let changed = false;
  const tabs = ws.tabs.map((t) => {
    if (t.id !== tabId || t.type !== "query") return t;
    if (t.queryMode === queryMode && t.queryLanguage === queryLanguage) {
      return t;
    }
    changed = true;
    return { ...t, queryMode, queryLanguage };
  });
  return changed ? { ...ws, tabs } : ws;
}

export function createQuerySlice(
  set: WorkspaceSet,
  get: WorkspaceGet,
): QuerySlice {
  return {
    addQueryTab: (connId, db, opts = {}) => {
      const { id, title } = nextQueryTabIdentity();
      const paradigm: Paradigm =
        opts.paradigm ?? resolveParadigmForConnection(connId);
      // Sprint 309 — Find/Aggregate toggle removed. RDB tabs still need
      // `"sql"`; document tabs leave the field undefined on new tabs.
      const queryMode: WorkspaceQueryMode | undefined =
        paradigm === "rdb" ? "sql" : opts.queryMode;
      const queryLanguage = toWorkspaceQueryLanguage({
        paradigm,
        queryLanguage: opts.queryLanguage,
      });
      set((state) => {
        const next = withWorkspace(state, connId, db, (ws) => {
          const newTab: QueryTab = {
            type: "query" as const,
            id,
            title: opts.title ?? title,
            connectionId: connId,
            closable: true,
            sql: opts.sql ?? "",
            queryState: { status: "idle" } as QueryState,
            paradigm,
            queryMode,
            queryLanguage,
            searchTarget: paradigm === "search" ? opts.searchTarget : undefined,
            database:
              opts.database ??
              (paradigm === "rdb" || paradigm === "document" ? db : undefined),
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
            // Clear stale collection/results when the database changes.
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
          return patchRunningQueryTab(ws, tabId, queryId, (tab) => ({
            ...tab,
            queryState: { status: "completed" as const, result },
          }));
        });
        return next ? { workspaces: next } : state;
      });
    },

    completeSearchQuery: (connId, db, tabId, queryId, result) => {
      set((state) => {
        const next = patchExistingWorkspace(state, connId, db, (ws) => {
          return patchRunningQueryTab(ws, tabId, queryId, (tab) => ({
            ...tab,
            queryState: { status: "completedSearch" as const, result },
          }));
        });
        return next ? { workspaces: next } : state;
      });
    },

    failQuery: (connId, db, tabId, queryId, errorMessage) => {
      set((state) => {
        const next = patchExistingWorkspace(state, connId, db, (ws) => {
          return patchRunningQueryTab(ws, tabId, queryId, (tab) => ({
            ...tab,
            queryState: {
              status: "error" as const,
              error: errorMessage,
            },
          }));
        });
        return next ? { workspaces: next } : state;
      });
    },

    cancelRunningQuery: (connId, db, tabId, queryId, message) => {
      set((state) => {
        const next = patchExistingWorkspace(state, connId, db, (ws) => {
          return patchRunningQueryTab(ws, tabId, queryId, (tab) => ({
            ...tab,
            queryState:
              message === undefined
                ? { status: "cancelled" as const }
                : { status: "cancelled" as const, message },
          }));
        });
        return next ? { workspaces: next } : state;
      });
    },

    completeMultiStatementQuery: (connId, db, tabId, queryId, payload) => {
      set((state) => {
        const next = patchExistingWorkspace(state, connId, db, (ws) => {
          const {
            statementResults,
            lastResult,
            allFailed,
            joinedErrorMessage,
          } = payload;
          return patchRunningQueryTab(ws, tabId, queryId, (tab) => {
            if (allFailed) {
              return {
                ...tab,
                queryState: {
                  status: "error" as const,
                  error: joinedErrorMessage,
                },
              };
            }
            if (!lastResult) {
              return {
                ...tab,
                queryState: {
                  status: "error" as const,
                  error: joinedErrorMessage,
                },
              };
            }
            return {
              ...tab,
              queryState: {
                status: "completed" as const,
                result: lastResult,
                statements: statementResults,
              },
            };
          });
        });
        return next ? { workspaces: next } : state;
      });
    },

    completeQueryDryRun: (connId, db, tabId, queryId, result, statements) => {
      set((state) => {
        const next = patchExistingWorkspace(state, connId, db, (ws) => {
          return patchRunningQueryTab(ws, tabId, queryId, (tab) => ({
            ...tab,
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
          }));
        });
        return next ? { workspaces: next } : state;
      });
    },

    loadQueryIntoTab: (payload) => {
      const {
        connectionId,
        paradigm,
        queryMode,
        queryLanguage,
        database,
        collection,
        sql,
      } = payload;
      const resolvedDb = database ?? resolveActiveDb(connectionId);
      const workspaceQueryMode =
        paradigm === "rdb"
          ? toWorkspaceQueryMode({ paradigm, queryMode })
          : undefined;
      const workspaceQueryLanguage = toWorkspaceQueryLanguage({
        paradigm,
        queryLanguage,
      });
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
          queryMode: workspaceQueryMode,
          queryLanguage: workspaceQueryLanguage,
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
      set((state) => {
        const next = patchExistingWorkspace(
          state,
          connectionId,
          resolvedDb,
          (workspace) =>
            patchQueryCompatibilityMetadata(
              workspace,
              targetId,
              workspaceQueryMode,
              workspaceQueryLanguage,
            ),
        );
        return next ? { workspaces: next } : state;
      });
    },
  };
}
