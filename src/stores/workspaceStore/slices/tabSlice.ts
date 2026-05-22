import type { QueryTab, Tab, TableTab, WorkspaceStoreState } from "../types";
import {
  nextQueryId,
  nextTabId,
  patchExistingWorkspace,
  resolveActiveDb,
  withWorkspace,
  type WorkspaceGet,
  type WorkspaceSet,
} from "../shared";

// dataGridEditStore purge is a one-way lifecycle write at `removeTab` /
// `clearForConnection`, matching the pre-split workspaceStore contract.
/* eslint-disable no-restricted-imports */
import {
  entryKey as makeDataGridEditKey,
  useDataGridEditStore,
} from "../../dataGridEditStore";
/* eslint-enable no-restricted-imports */

type TabSlice = Pick<
  WorkspaceStoreState,
  | "addTab"
  | "removeTab"
  | "setActiveTab"
  | "setSubView"
  | "promoteTab"
  | "updateTabSorts"
  | "setTabDirty"
  | "moveTab"
  | "reopenLastClosedTab"
  | "clearForConnection"
>;

export function createTabSlice(set: WorkspaceSet, get: WorkspaceGet): TabSlice {
  return {
    addTab: (connId, init) => {
      const id = nextTabId();
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
        (():
          | { workspaces: WorkspaceStoreState["workspaces"] }
          | typeof state => {
          const next = patchExistingWorkspace(state, connId, db, (ws) => {
            const remaining = ws.tabs.filter((t) => t.id !== tabId);
            if (remaining.length === ws.tabs.length) return ws;
            const newActive =
              ws.activeTabId === tabId
                ? (remaining[remaining.length - 1]?.id ?? null)
                : ws.activeTabId;
            const newHistory = [closingTab, ...ws.closedTabHistory].slice(
              0,
              25,
            );
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

      if (closingTab.type === "table") {
        const closingDatabase = closingTab.database ?? db;
        const closingSchema = closingTab.schema;
        const closingTable = closingTab.table;
        if (closingDatabase && closingSchema && closingTable) {
          const key = makeDataGridEditKey(
            closingTab.connectionId,
            closingDatabase,
            closingSchema,
            closingTable,
          );
          const stillUsed = survivors.some(
            (t) =>
              t.type === "table" &&
              t.connectionId === closingTab.connectionId &&
              (t.database ?? db) === closingDatabase &&
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
            restored!.type === "table" ? nextTabId() : nextQueryId();
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
  };
}
