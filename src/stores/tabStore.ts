/**
 * `tabStore` entry. Composes three sub-files:
 *   - `tabStore/types.ts` — Tab union types + `TabState` interface.
 *   - `tabStore/persistence.ts` — STORAGE_KEY, persist helpers,
 *     migrations, and the `resolveActiveDb` cross-store lookup.
 *   - `tabStore/tracker.ts` — per-connection last-active-tab tracker.
 *
 * Entry retains: zustand `create()` + all actions, persist subscribe,
 * IPC bridge attach (workspace-only), `useActiveTab` selector, tracker
 * init + subscribe.
 *
 * Cross-store coupling is intentionally one-way: this store owns tab list
 * mutation only; MRU marking and query-history recording are caller-side.
 */
import { create } from "zustand";
import type { Paradigm } from "@/types/connection";
import type { QueryState } from "@/types/query";
import { attachZustandIpcBridge } from "@lib/zustand-ipc-bridge";
import { getCurrentWindowLabel } from "@lib/window-label";

import type {
  TableTab,
  QueryTab,
  Tab,
  TabState,
  TabSubView,
  TabObjectKind,
  QueryMode,
} from "./tabStore/types";
// Same-store sub-files. The `./*Store` glob in `no-restricted-imports`
// matches `./tabStore/persistence` because the rule uses directory-style
// matching, but the entry-pattern is the legitimate composition point —
// external callers still import only from `@stores/tabStore`.
/* eslint-disable no-restricted-imports */
import {
  STORAGE_KEY,
  debouncePersist,
  migrateLoadedTabs,
  resolveActiveDb,
} from "./tabStore/persistence";
import {
  initTracker,
  recordActiveTab,
  getLastActiveTabIdForConnection,
  __resetLastActiveTabsForTests,
} from "./tabStore/tracker";
/* eslint-enable no-restricted-imports */

// Re-export types + tracker helpers so external callers (51 importers)
// keep their `import { Tab, useTabStore, ... } from "@stores/tabStore"`
// paths unchanged.
export type {
  TableTab,
  QueryTab,
  Tab,
  TabState,
  TabSubView,
  TabObjectKind,
  QueryMode,
};
export { getLastActiveTabIdForConnection, __resetLastActiveTabsForTests };

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

let tabCounter = 0;
let queryCounter = 0;

export const useTabStore = create<TabState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  closedTabHistory: [],
  dirtyTabIds: new Set<string>(),

  // -- Table tab actions ----------------------------------------------------

  addTab: (tab) => {
    tabCounter++;
    // `permanent` is an instruction to addTab, not a field stored on the
    // tab itself, so strip it before constructing the stored shape.
    const { permanent, ...tabFields } = tab;
    // Autofill `database` for new RDB tabs from the active sub-pool.
    // Document tabs carry their own `database` (set by callers that know
    // the Mongo db name); leave those untouched. Legacy persisted RDB
    // tabs are not migrated — only fresh tabs get the autofill.
    const isRdbTab = (tabFields.paradigm ?? "rdb") === "rdb";
    const tabWithDb: Omit<TableTab, "id" | "isPreview"> =
      isRdbTab && tabFields.database === undefined
        ? { ...tabFields, database: resolveActiveDb(tabFields.connectionId) }
        : tabFields;
    set((state) => {
      const exists = state.tabs.find(
        (t): t is TableTab =>
          t.type === "table" &&
          t.connectionId === tabWithDb.connectionId &&
          t.table === tabWithDb.table &&
          t.table !== undefined &&
          (t.subView ?? "records") === (tabWithDb.subView ?? "records"),
      );
      if (exists) {
        // If the caller wants a permanent tab and the existing one is a
        // preview, promote it in-place rather than just activating.
        if (permanent && (exists as TableTab).isPreview) {
          const newTabs = state.tabs.map((t) =>
            t.id === exists.id ? { ...t, isPreview: false } : t,
          );
          return { tabs: newTabs, activeTabId: exists.id };
        }
        return { activeTabId: exists.id };
      }

      // Preview slot replacement — only for non-permanent (preview) tabs.
      // A permanent tab never replaces an existing preview slot; it always
      // appends as a new persistent tab.
      if (!permanent) {
        const previewIdx = state.tabs.findIndex(
          (t): t is TableTab =>
            t.type === "table" &&
            t.connectionId === tabWithDb.connectionId &&
            t.isPreview === true &&
            (t.subView ?? "records") === (tabWithDb.subView ?? "records"),
        );

        if (previewIdx !== -1) {
          const newId = `tab-${tabCounter}`;
          const newTabs = [...state.tabs];
          newTabs[previewIdx] = {
            ...tabWithDb,
            id: newId,
            isPreview: true,
          } as TableTab;
          return { tabs: newTabs, activeTabId: newId };
        }
      }

      return {
        tabs: [
          ...state.tabs,
          { ...tabWithDb, id: `tab-${tabCounter}`, isPreview: !permanent },
        ],
        activeTabId: `tab-${tabCounter}`,
      };
    });
  },

  removeTab: (id) =>
    set((state) => {
      const tabToRemove = state.tabs.find((t) => t.id === id);
      const filtered = state.tabs.filter((t) => t.id !== id);
      const newActive =
        state.activeTabId === id
          ? (filtered[filtered.length - 1]?.id ?? null)
          : state.activeTabId;
      const newHistory = tabToRemove
        ? [tabToRemove, ...state.closedTabHistory].slice(0, 20)
        : state.closedTabHistory;
      // Drop the dirty marker so it can't linger after the tab is gone.
      // Only allocate a new Set when the entry was actually present.
      const dirtyTabIds = state.dirtyTabIds.has(id)
        ? (() => {
            const next = new Set(state.dirtyTabIds);
            next.delete(id);
            return next;
          })()
        : state.dirtyTabIds;
      return {
        tabs: filtered,
        activeTabId: newActive,
        closedTabHistory: newHistory,
        dirtyTabIds,
      };
    }),

  setActiveTab: (id) => set({ activeTabId: id }),

  promoteTab: (tabId) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId && t.type === "table" ? { ...t, isPreview: false } : t,
      ),
    })),

  reopenLastClosedTab: () =>
    set((state) => {
      if (state.closedTabHistory.length === 0) return state;
      const [restored, ...rest] = state.closedTabHistory;
      // Generate a fresh ID to avoid conflicts
      const newId =
        restored!.type === "table"
          ? `tab-${++tabCounter}`
          : `query-${++queryCounter}`;
      const reopened: Tab =
        restored!.type === "table"
          ? { ...(restored as TableTab), id: newId }
          : { ...(restored as QueryTab), id: newId };
      return {
        tabs: [...state.tabs, reopened],
        activeTabId: newId,
        closedTabHistory: rest,
      };
    }),

  clearTabsForConnection: (connectionId) =>
    set((state) => {
      const remaining = state.tabs.filter(
        (t) => t.connectionId !== connectionId,
      );
      if (remaining.length === state.tabs.length) {
        // No tab from this connection — short-circuit to keep Set/array
        // identities stable so subscribers don't re-render.
        return state;
      }
      const removedIds = new Set(
        state.tabs
          .filter((t) => t.connectionId === connectionId)
          .map((t) => t.id),
      );
      const activeStillPresent =
        state.activeTabId !== null &&
        remaining.some((t) => t.id === state.activeTabId);
      const newActive = activeStillPresent
        ? state.activeTabId
        : (remaining[remaining.length - 1]?.id ?? null);
      // Drop dirty markers for the removed tabs only — leave others alone.
      let dirtyTabIds = state.dirtyTabIds;
      let dirtyMutated = false;
      for (const id of removedIds) {
        if (dirtyTabIds.has(id)) {
          if (!dirtyMutated) {
            dirtyTabIds = new Set(dirtyTabIds);
            dirtyMutated = true;
          }
          dirtyTabIds.delete(id);
        }
      }
      return {
        tabs: remaining,
        activeTabId: newActive,
        dirtyTabIds,
      };
    }),

  setSubView: (tabId, subView) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId && t.type === "table" ? { ...t, subView } : t,
      ),
    })),

  updateTabSorts: (tabId, sorts) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId && t.type === "table" ? { ...t, sorts } : t,
      ),
    })),

  setTabDirty: (tabId, dirty) =>
    set((state) => {
      const has = state.dirtyTabIds.has(tabId);
      // No-op when the membership already matches the requested value so
      // the Set identity (and therefore subscriber renders) stay stable
      // when the publisher effect re-runs without a real transition.
      if (dirty === has) return state;
      const next = new Set(state.dirtyTabIds);
      if (dirty) {
        next.add(tabId);
      } else {
        next.delete(tabId);
      }
      return { dirtyTabIds: next };
    }),

  // -- Query tab actions ----------------------------------------------------

  addQueryTab: (connectionId, opts = {}) => {
    queryCounter++;
    const id = `query-${queryCounter}`;
    const title = `Query ${queryCounter}`;
    const paradigm: Paradigm = opts.paradigm ?? "rdb";
    // RDB tabs force "sql"; document tabs default to "find" so users land
    // on the simpler of the two Mongo modes.
    const queryMode: QueryMode =
      paradigm === "rdb" ? "sql" : (opts.queryMode ?? "find");
    // Autofill `database` for new RDB query tabs only when the caller
    // didn't supply one (e.g. paradigm-aware history restore carries its
    // own db). Document tabs keep `opts.database` as-is (the Mongo db
    // the user picked in the switcher).
    const database =
      paradigm === "rdb" && opts.database === undefined
        ? resolveActiveDb(connectionId)
        : opts.database;
    set((state) => ({
      tabs: [
        ...state.tabs,
        {
          type: "query" as const,
          id,
          title,
          connectionId,
          closable: true,
          sql: "",
          queryState: { status: "idle" } as QueryState,
          paradigm,
          queryMode,
          database,
          collection: opts.collection,
        },
      ],
      activeTabId: id,
    }));
  },

  updateQuerySql: (tabId, sql) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId && t.type === "query" ? { ...t, sql } : t,
      ),
    })),

  updateQueryState: (tabId, queryState) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId && t.type === "query" ? { ...t, queryState } : t,
      ),
    })),

  setQueryMode: (tabId, mode) =>
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId || t.type !== "query") return t;
        // RDB tabs only speak SQL; reject `"find"`/`"aggregate"` writes so
        // the tab state can't drift out of sync with its paradigm. Other
        // mode writes are accepted as-is (including re-setting to "sql").
        if (t.paradigm === "rdb" && mode !== "sql") return t;
        if (t.queryMode === mode) return t;
        return { ...t, queryMode: mode };
      }),
    })),

  completeQuery: (tabId, queryId, result) =>
    set((state) => {
      const current = state.tabs.find((t) => t.id === tabId);
      if (
        !current ||
        current.type !== "query" ||
        current.queryState.status !== "running" ||
        !("queryId" in current.queryState) ||
        current.queryState.queryId !== queryId
      ) {
        return state;
      }
      return {
        tabs: state.tabs.map((t) =>
          t.id === tabId && t.type === "query"
            ? { ...t, queryState: { status: "completed" as const, result } }
            : t,
        ),
      };
    }),

  failQuery: (tabId, queryId, errorMessage) =>
    set((state) => {
      const current = state.tabs.find((t) => t.id === tabId);
      if (
        !current ||
        current.type !== "query" ||
        current.queryState.status !== "running" ||
        !("queryId" in current.queryState) ||
        current.queryState.queryId !== queryId
      ) {
        return state;
      }
      return {
        tabs: state.tabs.map((t) =>
          t.id === tabId && t.type === "query"
            ? {
                ...t,
                queryState: {
                  status: "error" as const,
                  error: errorMessage,
                },
              }
            : t,
        ),
      };
    }),

  completeMultiStatementQuery: (tabId, queryId, payload) =>
    set((state) => {
      const current = state.tabs.find((t) => t.id === tabId);
      if (
        !current ||
        current.type !== "query" ||
        current.queryState.status !== "running" ||
        !("queryId" in current.queryState) ||
        current.queryState.queryId !== queryId
      ) {
        return state;
      }
      const { statementResults, lastResult, allFailed, joinedErrorMessage } =
        payload;
      return {
        tabs: state.tabs.map((t) => {
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
          // `lastResult` is non-null when at least one statement succeeded —
          // the caller's `allFailed` derivation guarantees it. The QueryState
          // contract expects a `result: QueryResult` (not nullable) on the
          // completed branch, so we collapse to error when lastResult slipped
          // through as null (defensive — never observed in practice).
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
        }),
      };
    }),

  // Sprint 248 (ADR 0022 Phase 4) — explicit dry-run completion. Called
  // when the "Dry Run" button / `Cmd+Shift+Enter` shortcut finishes a
  // BEGIN/ROLLBACK preview. Same stale-response guard as `completeQuery`
  // / `completeMultiStatementQuery`; the only payload delta is
  // `isDryRun: true`, which the result grid reads to surface the
  // "rolled back. No data was changed." banner. Single-statement runs
  // leave `statements` undefined; multi-statement runs populate it the
  // same way the multi-statement action does.
  completeQueryDryRun: (tabId, queryId, result, statements) =>
    set((state) => {
      const current = state.tabs.find((t) => t.id === tabId);
      if (
        !current ||
        current.type !== "query" ||
        current.queryState.status !== "running" ||
        !("queryId" in current.queryState) ||
        current.queryState.queryId !== queryId
      ) {
        return state;
      }
      return {
        tabs: state.tabs.map((t) =>
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
        ),
      };
    }),

  loadQueryIntoTab: (payload) => {
    const { connectionId, paradigm, queryMode, database, collection, sql } =
      payload;
    const state = get();
    const activeTab =
      state.activeTabId === null
        ? null
        : (state.tabs.find((t) => t.id === state.activeTabId) ?? null);

    // Branch decision — the restore is paradigm-aware:
    //   1. No active tab                       → spawn new query tab.
    //   2. Active tab is not a query tab       → spawn new query tab.
    //   3. Active tab targets a different
    //      connectionId                        → spawn new query tab.
    //   4. Active tab's paradigm differs       → spawn new query tab.
    //   5. Otherwise (same paradigm + same
    //      connectionId)                       → in-place update of the
    //                                            active tab's sql + queryMode.
    const canInPlace =
      activeTab !== null &&
      activeTab.type === "query" &&
      activeTab.connectionId === connectionId &&
      activeTab.paradigm === paradigm;

    if (!canInPlace) {
      // Delegating to `addQueryTab` keeps the `queryCounter` tick +
      // activeTabId promotion logic in one place. `addQueryTab` updates
      // `activeTabId` synchronously via `set`, so we can recover the new
      // tab id by reading `getState().activeTabId` immediately after.
      get().addQueryTab(connectionId, {
        paradigm,
        queryMode,
        database,
        collection,
      });
      const newTabId = get().activeTabId;
      if (newTabId) {
        get().updateQuerySql(newTabId, sql);
      }
      return;
    }

    // Same paradigm + same connection — stamp the payload onto the active
    // tab. `database` / `collection` are intentionally preserved: the
    // user's current context (e.g. a Mongo tab focused on a collection)
    // must not be overwritten by the entry's originally-executed
    // collection, which may differ. Only sql + queryMode change.
    const targetId = activeTab.id;
    get().updateQuerySql(targetId, sql);
    get().setQueryMode(targetId, queryMode);
  },

  moveTab: (fromId, toId, position = "before") => {
    if (fromId === toId) return;
    set((state) => {
      const tabs = [...state.tabs];
      const fromIdx = tabs.findIndex((t) => t.id === fromId);
      const toIdx = tabs.findIndex((t) => t.id === toId);
      if (fromIdx === -1 || toIdx === -1) return state;
      const [moved] = tabs.splice(fromIdx, 1);
      // toIdx shifts left by 1 if the removed element was before it
      const adjustedToIdx = toIdx > fromIdx ? toIdx - 1 : toIdx;
      const insertIdx =
        position === "before" ? adjustedToIdx : adjustedToIdx + 1;
      tabs.splice(insertIdx, 0, moved!);
      return { tabs };
    });
  },

  loadPersistedTabs: () => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as {
        tabs: Tab[];
        activeTabId: string | null;
      };
      const tabs = migrateLoadedTabs(data.tabs);
      set({ tabs, activeTabId: data.activeTabId });
    } catch {
      // Corrupted localStorage — start fresh
      set({ tabs: [], activeTabId: null });
    }
  },
}));

// Persist on every state change via subscribe
useTabStore.subscribe((state) => {
  debouncePersist(state.tabs, state.activeTabId);
});

// ---------------------------------------------------------------------------
// Last-active-tab tracker wiring
// ---------------------------------------------------------------------------

initTracker(() => useTabStore.getState().tabs);

useTabStore.subscribe((state) => {
  const id = state.activeTabId;
  if (!id) return;
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) return;
  recordActiveTab(tab);
});

// ---------------------------------------------------------------------------
// IPC bridge
// ---------------------------------------------------------------------------

/**
 * Cross-window broadcast allowlist. Only `tabs` + `activeTabId` are
 * synchronized across workspace instances:
 *  - `closedTabHistory` is window-local — reopen stacks shouldn't blend
 *    across timelines.
 *  - `dirtyTabIds` is a `Set` (not JSON-serializable) and reflects the
 *    local edit buffer; broadcasting would be both lossy and incorrect.
 */
export const SYNCED_KEYS: ReadonlyArray<keyof TabState> = [
  "tabs",
  "activeTabId",
] as const;

/**
 * Workspace-only attach guard. The launcher renders connection-management
 * UI, never the tab bar; gating on `getCurrentWindowLabel() === "workspace"`
 * keeps tab mutations from accumulating in the launcher's mirror, and
 * encodes "tabs ownership = workspace" at the attach site rather than at
 * every `useTabStore` caller.
 */
if (getCurrentWindowLabel() === "workspace") {
  void attachZustandIpcBridge<TabState>(useTabStore, {
    channel: "tab-sync",
    syncKeys: SYNCED_KEYS,
    originId: getCurrentWindowLabel() ?? "unknown",
  }).catch(() => {
    // best-effort: see mruStore.ts for the trade-off rationale.
  });
}

// ---------------------------------------------------------------------------
// Selector helpers
// ---------------------------------------------------------------------------

/**
 * Currently-active tab object (or `null` when no tab is focused). The
 * lookup happens inside the selector so subscribers re-render whenever
 * either `activeTabId` or the active tab's own fields update — toolbars
 * stay in sync without an extra `useEffect`.
 */
export function useActiveTab(): Tab | null {
  return useTabStore((state) => {
    const id = state.activeTabId;
    if (!id) return null;
    return state.tabs.find((t) => t.id === id) ?? null;
  });
}
