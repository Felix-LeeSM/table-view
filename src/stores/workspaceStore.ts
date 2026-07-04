/**
 * `workspaceStore` — per-workspace state keyed by `(connId, db)`. ADR 0027.
 *
 * Absorbs the former `tabStore`: tabs, active tab, closed-tab history,
 * dirty markers, and sidebar (selected node / expanded set / scroll
 * position) all live in a cohesive `WorkspaceState` keyed by the
 * `(connId, db)` tuple.
 *
 * Active workspace identity is not owned here — selector hooks derive it
 * from the Tauri window label plus `connectionStore.activeStatuses`.
 * Mutating actions still take `(connId, db)` explicitly (Q7 'a' lock).
 */
import { create } from "zustand";
import { combine } from "zustand/middleware";
import { attachZustandIpcBridge } from "@lib/zustand-ipc-bridge";
import { getCurrentWindowLabel, parseWorkspaceLabel } from "@lib/window-label";
import type { WorkspaceStoreState } from "./workspaceStore/types";
// Same-store internals live under `./workspaceStore/*`; this exception keeps
// the root public module as the single composition point after the split.
/* eslint-disable no-restricted-imports -- same-store internal modules after sprint-410 split. */
import {
  STORAGE_KEY,
  debouncePersistWorkspaces,
  migrateLoadedWorkspaces,
} from "./workspaceStore/persistence";
import {
  seedCountersFromWorkspaces,
  type WorkspaceGet,
  type WorkspaceSet,
} from "./workspaceStore/shared";
import { createQuerySlice } from "./workspaceStore/slices/querySlice";
import { createSidebarSlice } from "./workspaceStore/slices/sidebarSlice";
import { createTabSlice } from "./workspaceStore/slices/tabSlice";
/* eslint-enable no-restricted-imports */

export type {
  QueryTab,
  SidebarState,
  Tab,
  TableTab,
  TableTabInit,
  TabObjectKind,
  TabSubView,
  WorkspaceQueryMode,
  WorkspaceState,
  WorkspaceStoreState,
} from "./workspaceStore/types";

/* eslint-disable no-restricted-imports -- same-store internal module re-exports. */
export {
  __resetCountersForTests,
  resolveActiveDb,
} from "./workspaceStore/shared";
export {
  useActiveTab,
  useActiveTabId,
  useClosedTabHistory,
  useConnectionHasDirtyTabs,
  useCurrentTabs,
  useCurrentWorkspace,
  useCurrentWorkspaceKey,
  useDirtyTabIds,
  useWorkspaceFor,
  useWorkspaceKeyForConnection,
  type WorkspaceKey,
} from "./workspaceStore/selectors";
/* eslint-enable no-restricted-imports */

const initialWorkspaceState: Pick<WorkspaceStoreState, "workspaces"> = {
  workspaces: {},
};

export const useWorkspaceStore = create<WorkspaceStoreState>()(
  combine(initialWorkspaceState, (set, get) => {
    const workspaceSet = set as WorkspaceSet;
    const workspaceGet = get as WorkspaceGet;

    return {
      ...createTabSlice(workspaceSet, workspaceGet),
      ...createQuerySlice(workspaceSet, workspaceGet),
      ...createSidebarSlice(workspaceSet),
      hydrateWorkspacesFromSnapshot: (workspaces) => {
        // #1091 — seed tab/query counters from the restored open-tab ids
        // BEFORE any subsequent addTab, so a fresh id can never collide with a
        // live tab (a collision duplicates React keys and makes removeTab's
        // id-filter drop both same-id tabs). seedCountersFromWorkspaces walks
        // `ws.tabs`; closedTabHistory ids are not live so they can't collide.
        // The real boot path is this snapshot hydrate — the counter seed used
        // to live only in the dead `loadPersistedWorkspaces` localStorage action.
        seedCountersFromWorkspaces(workspaces);
        workspaceSet({ workspaces });
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
          const hydrated = migrateLoadedWorkspaces(data.workspaces);
          // Seed counters before any subsequent add so fresh ids never
          // collide with persisted tab/query ids.
          seedCountersFromWorkspaces(hydrated);
          workspaceSet({ workspaces: hydrated });
        } catch {
          // Corrupted localStorage — start fresh; matches tabStore's policy.
          workspaceSet({ workspaces: {} });
        }
      },
    };
  }),
);

// Persist on every state change via subscribe. Debounced (200ms) to coalesce
// rapid bursts (e.g. typing in a query tab).
useWorkspaceStore.subscribe((state) => {
  debouncePersistWorkspaces(state.workspaces);
});

/**
 * Cross-window broadcast allowlist. Only `workspaces` is synchronized;
 * action members and selector hooks are not state, so the bridge skips them.
 */
export const SYNCED_KEYS: ReadonlyArray<keyof WorkspaceStoreState> = [
  "workspaces",
] as const;

// #1097 — attach only in workspace windows. sprint-361 renamed the window
// label from bare `"workspace"` to `workspace-{connection_id}`, so a strict
// `=== "workspace"` guard never matched and the bridge was dead code. Reuse
// `parseWorkspaceLabel` (the single label parser) so the guard tracks the real
// label format: non-null connection id → a workspace window; `"launcher"`,
// the pre-sprint-361 bare `"workspace"`, and `null` (vitest jsdom) → no attach.
const currentLabel = getCurrentWindowLabel();
if (currentLabel && parseWorkspaceLabel(currentLabel) !== null) {
  void attachZustandIpcBridge<WorkspaceStoreState>(useWorkspaceStore, {
    channel: "workspace-sync",
    syncKeys: SYNCED_KEYS,
    originId: currentLabel,
  }).catch(() => {
    // best-effort: see mruStore.ts for the trade-off rationale.
  });
}
