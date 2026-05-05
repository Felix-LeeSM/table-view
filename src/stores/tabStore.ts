/**
 * Sprint 208 — `tabStore` entry. 1009-line god file 를 4-way split.
 *
 * Sub-files:
 *   - `tabStore/types.ts` — Tab union types + `TabState` interface.
 *   - `tabStore/persistence.ts` — STORAGE_KEY + persist helpers + Sprint
 *     73/76/129 migrations + `resolveActiveDb` cross-store lookup.
 *   - `tabStore/tracker.ts` — per-connection last-active-tab tracker
 *     (`initTracker` injection + `recordActiveTab` /
 *     `getLastActiveTabIdForConnection` / `__resetLastActiveTabsForTests`).
 *
 * Entry retains: zustand `create()` + all actions, persist subscribe, IPC
 * bridge attach (workspace-only), `useActiveTab` selector, tracker init +
 * subscribe. 51 외부 caller import 경로 보존 (entry-pattern).
 *
 * Sprint 212 — cross-store coupling 제거. mru / query-history store 의 직접
 * import 가 사라지고 MRU marking 책임은 16 caller 로, query history recording
 * 책임은 `useQueryExecution.ts` 8 call site 로 이동. tabStore 는 tab list
 * mutation 만 책임지며 store 간 의존이 단방향이 된다.
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
// Sprint 208 — same-store sub-files (entry-pattern split). The
// "store 파일끼리 import 금지" rule targets cross-store coupling, but the
// `./*Store` glob also matches `./tabStore/persistence` because the rule
// uses gitignore-style directory matching. The entry of a god-file split
// is the legitimate composition surface and exists precisely so external
// callers see a single import path. Sprint 212 removed the cross-store
// imports above; this block stays because the same-store entry-pattern is
// unavoidable without an eslint config change (out of scope per Sprint
// 212 contract).
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
    // Sprint 119 (#SHELL-1) — opening a tab against a connection is the
    // strongest signal that the user is "actively working with" it, so MRU
    // marking fires alongside this action. MainArea's EmptyState reads the
    // MRU id to decide which connection the New Query CTA should default
    // to.
    //
    // Sprint 212 — the MRU mark call has moved to the 11 `addTab` caller
    // sites (SchemaTree handlers / DataGrid FK navigate /
    // DocumentDatabaseTree collection open / App.tsx navigate-table event
    // handler). The store no longer reaches into the MRU store so the
    // dependency graph stays unidirectional.
    // Extract `permanent` before constructing the stored tab shape.
    // `permanent` is an instruction to addTab (should this tab be
    // persistent from birth?), not a field stored on the tab itself.
    const { permanent, ...tabFields } = tab;
    // Sprint 130 — autofill `database` for new RDB tabs from the active
    // sub-pool selection. Document tabs already carry their own
    // `database` (set by callers that know the Mongo db name); we leave
    // those untouched. We do NOT migrate legacy persisted RDB tabs —
    // only fresh tabs created via this code path get the autofill.
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
      // Sprint 97 — drop the dirty marker when a tab is closed so a stale
      // entry can never linger after the tab disappears. Only allocate a
      // new Set when the entry was actually present.
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
    // Sprint 119 (#SHELL-1) — see comment in `addTab`. Query tab creation
    // is an equivalent MRU signal; both paths must mark or the EmptyState
    // would only update for table-tab opens.
    //
    // Sprint 212 — the MRU mark call moved to the 6 `addQueryTab` caller
    // sites (Cmd+T global shortcut / Sidebar "+ Query" / MainArea EmptyState
    // CTA / SchemaTree function-source / App.tsx quickopen-function event /
    // QueryTab `<HistoryPanel onLoad>` wrapper that calls `loadQueryIntoTab`).
    // `loadQueryIntoTab` itself stays MRU-neutral; its sole production caller
    // (HistoryPanel restore) wraps the call with `markConnectionUsed`.
    const id = `query-${queryCounter}`;
    const title = `Query ${queryCounter}`;
    const paradigm: Paradigm = opts.paradigm ?? "rdb";
    // RDB tabs force "sql"; document tabs default to "find" when omitted so
    // users land on the simpler of the two Mongo modes by default.
    const queryMode: QueryMode =
      paradigm === "rdb" ? "sql" : (opts.queryMode ?? "find");
    // Sprint 130 — autofill `database` for new RDB query tabs. Caller may
    // explicitly pass `opts.database` (notably for paradigm-aware history
    // restore that carries the original db); we only synthesise from
    // activeStatuses when the caller didn't supply one. Document
    // paradigm tabs keep their existing `opts.database` semantics (the
    // Mongo db the user picked in the switcher).
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
    // tab. Per the Sprint 84 execution brief, `database` / `collection`
    // on the tab are intentionally preserved: the user's current context
    // (e.g. a Mongo tab focused on a specific collection) should not be
    // overwritten by the entry's originally-executed collection, which may
    // differ. Only the editor contents (sql + queryMode) change.
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
// Last-active-tab tracker wiring (Sprint 127)
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
// IPC bridge (Sprint 153)
// ---------------------------------------------------------------------------

/**
 * Sprint 153 — cross-window broadcast allowlist for the tab store.
 *
 * Why these keys:
 *  - `tabs` — the workspace tab list. Must be identical across workspace
 *    instances so reopening the workspace window doesn't clobber state.
 *    Plain JSON-serializable (TableTab / QueryTab unions of primitives,
 *    arrays, optional records).
 *  - `activeTabId` — the focused tab's id (`string | null`). Required so
 *    the workspace surfaces the same active tab on either side.
 *
 * Why other keys are EXCLUDED:
 *  - `closedTabHistory` — window-local "reopen-last-closed" stack. A user
 *    closing a tab in one window should not surface that tab in another
 *    window's reopen history; that would conflate two timelines.
 *  - `dirtyTabIds` — Set instance, not JSON-serializable. The grid
 *    publisher effect re-marks dirty tabs locally as the user types, so
 *    the value always reflects the local edit buffer; broadcasting it
 *    would be both technically lossy (Set → empty object on the wire)
 *    and semantically wrong (other window's edits aren't this window's).
 */
export const SYNCED_KEYS: ReadonlyArray<keyof TabState> = [
  "tabs",
  "activeTabId",
] as const;

/**
 * Sprint 153 — opt the tab store into the Sprint 151 bridge with
 * **workspace-only** semantics. Two reasons we use an attach guard
 * (`getCurrentWindowLabel() === "workspace"`) rather than relying solely
 * on the bridge's loop guard:
 *
 *  1. **No leak into the launcher.** The launcher renders connection
 *     management UI, never the tab bar. If the launcher attached the
 *     bridge, every workspace tab mutation would write into the
 *     launcher's `tabs` field. That has no UI consequence today but is
 *     wasted memory and would surface the moment someone reads
 *     `useTabStore` from a launcher component.
 *
 *  2. **Explicit semantics.** Sprint 154's real-window lifecycle hands
 *     ownership of "tabs" to the workspace exclusively. Encoding that
 *     in the attach point makes the contract reviewable in this file
 *     instead of requiring grep-coverage of every `useTabStore` caller.
 *
 * Sprint 151 bridge primitive: `src/lib/zustand-ipc-bridge.ts`.
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
// Selector helpers (Sprint 127)
// ---------------------------------------------------------------------------

/**
 * Sprint 127 — selector hook returning the currently-active tab object (or
 * `null` when no tab is focused). The lookup runs against `tabs` +
 * `activeTabId` inside the selector so subscribers re-render whenever the
 * active tab changes or the active tab's own fields (paradigm, schema,
 * database, connectionId, …) update — i.e. the toolbar labels stay in sync
 * with the tab without requiring an extra `useEffect`.
 *
 * Returning `null` (rather than `undefined`) keeps the consumer-side
 * narrowing simple (`if (activeTab === null) …`).
 */
export function useActiveTab(): Tab | null {
  return useTabStore((state) => {
    const id = state.activeTabId;
    if (!id) return null;
    return state.tabs.find((t) => t.id === id) ?? null;
  });
}
