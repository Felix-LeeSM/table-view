import { useCallback, useMemo } from "react";
import type { SortInfo } from "@/types/schema";
import {
  useCurrentWorkspaceKey,
  useWorkspaceStore,
} from "@stores/workspaceStore";

type SortsUpdater = SortInfo[] | ((prev: SortInfo[]) => SortInfo[]);

export interface RdbDataGridSorts {
  sorts: SortInfo[];
  setSorts: (updater: SortsUpdater) => void;
}

export function useRdbDataGridSorts(): RdbDataGridSorts {
  const updateTabSorts = useWorkspaceStore((s) => s.updateTabSorts);
  const workspaceKey = useCurrentWorkspaceKey();
  const activeTabSorts = useWorkspaceStore((s) => {
    if (!workspaceKey) return undefined;
    const ws = s.workspaces[workspaceKey.connId]?.[workspaceKey.db];
    if (!ws || !ws.activeTabId) return undefined;
    const tab = ws.tabs.find((t) => t.id === ws.activeTabId);
    if (!tab || tab.type !== "table") return undefined;
    return tab.sorts;
  });

  const emptySorts = useMemo<SortInfo[]>(() => [], []);
  const sorts = activeTabSorts ?? emptySorts;

  const setSorts = useCallback(
    (updater: SortsUpdater) => {
      if (!workspaceKey) return;

      // The click and context-menu sort handlers can issue synchronous
      // updates; read from the store so those updates compose.
      const state = useWorkspaceStore.getState();
      const ws = state.workspaces[workspaceKey.connId]?.[workspaceKey.db];
      const tabId = ws?.activeTabId ?? null;
      if (!tabId) return;

      const tab = ws?.tabs.find((candidate) => candidate.id === tabId);
      const prev: SortInfo[] =
        tab && tab.type === "table" ? (tab.sorts ?? []) : [];
      const next = typeof updater === "function" ? updater(prev) : updater;
      updateTabSorts(workspaceKey.connId, workspaceKey.db, tabId, next);
    },
    [workspaceKey, updateTabSorts],
  );

  return { sorts, setSorts };
}
