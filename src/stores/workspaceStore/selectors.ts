import { useShallow } from "zustand/react/shallow";
import { useCurrentWindowConnectionId } from "@hooks/useCurrentWindowConnectionId";
import type { Tab, WorkspaceState } from "./types";

// Selector hooks are the intentional read seam between connectionStore and
// workspaceStore. They stay co-located with workspaceStore to keep ADR 0027's
// `(connId, db)` key derivation visible.
/* eslint-disable no-restricted-imports */
import { useConnectionStore } from "../connectionStore";
import { useWorkspaceStore } from "../workspaceStore";
import { useDataGridEditStore } from "../dataGridEditStore";
import { useRawQueryGridEditStore } from "../rawQueryGridEditStore";
/* eslint-enable no-restricted-imports */

export type WorkspaceKey = { connId: string; db: string };

/**
 * Derive the current `(connId, db)` workspace coordinate.
 *
 * Sprint-366 (Phase 4, Q15 lock): `connId` comes from the Tauri window
 * label via `useCurrentWindowConnectionId()` — each workspace window is
 * pinned to one connection. The `db` half still resolves from
 * `connectionStore.activeStatuses[connId].activeDb` because the active
 * sub-pool is mutated at runtime (e.g. RDB DB switcher).
 */
export function useCurrentWorkspaceKey(): WorkspaceKey | null {
  const connId = useCurrentWindowConnectionId();
  return useConnectionStore(
    useShallow((state) => {
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
 * Resolve the `(connId, db)` workspace key for an explicit connection.
 * Picks `activeStatuses[connId].activeDb` first, then the connection's
 * stored default `database`.
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

export function useCurrentWorkspace(): WorkspaceState | null {
  const key = useCurrentWorkspaceKey();
  return useWorkspaceStore((state) => {
    if (!key) return null;
    return state.workspaces[key.connId]?.[key.db] ?? null;
  });
}

export function useWorkspaceFor(
  connId: string | null,
  db: string | null,
): WorkspaceState | null {
  return useWorkspaceStore((state) => {
    if (!connId || !db) return null;
    return state.workspaces[connId]?.[db] ?? null;
  });
}

export function useActiveTab(): Tab | null {
  const ws = useCurrentWorkspace();
  if (!ws || !ws.activeTabId) return null;
  return ws.tabs.find((t) => t.id === ws.activeTabId) ?? null;
}

const EMPTY_TABS: readonly Tab[] = Object.freeze([]);
const EMPTY_STRINGS: readonly string[] = Object.freeze([]);

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

/**
 * #1101 / #1204 — does `connId` have any unsaved change that a whole-connection
 * / whole-window close would discard? Three sources, OR'd, all deriving dirty
 * from *pending edits existing* rather than a grid being mounted:
 *
 * 1. `workspaceStore.dirtyTabIds` — the per-tab marker. #1204 stopped the grid
 *    hooks clearing it on unmount, so it now survives a tab switch and covers
 *    inactive dirty tabs. Still OR'd with the store scans below because a
 *    hydrated workspace may omit the window-local marker (#1091).
 * 2. `dataGridEditStore` pending entries — the durable window-local buffer for
 *    table grids, keyed `${connId}::${db}::${schema}::${table}`.
 * 3. `rawQueryGridEditStore` pending entries — the same for raw-query result
 *    grids, keyed `${connId}::${tabId}` (#1102).
 *
 * A store entry counts only when it holds real pending content, matching each
 * grid hook's own dirty predicate.
 */
export function useConnectionHasDirtyTabs(connId: string | null): boolean {
  const tabMarkerDirty = useWorkspaceStore((state) => {
    if (!connId) return false;
    const dbs = state.workspaces[connId];
    if (!dbs) return false;
    // `?? 0` mirrors the `?? EMPTY_STRINGS` guard above — a hydrated workspace
    // may omit the window-local dirtyTabIds marker (#1091), and reading
    // `.length` on undefined would unmount the workspace window.
    return Object.values(dbs).some((ws) => (ws.dirtyTabIds?.length ?? 0) > 0);
  });
  const pendingEditDirty = useDataGridEditStore((state) => {
    if (!connId) return false;
    const prefix = `${connId}::`;
    for (const [key, entry] of state.entries) {
      if (!key.startsWith(prefix)) continue;
      if (
        entry.pendingEdits.size > 0 ||
        entry.pendingNewRows.length > 0 ||
        entry.pendingDeletedRowKeys.size > 0
      ) {
        return true;
      }
    }
    return false;
  });
  const rawPendingEditDirty = useRawQueryGridEditStore((state) => {
    if (!connId) return false;
    const prefix = `${connId}::`;
    for (const [key, entry] of state.entries) {
      if (!key.startsWith(prefix)) continue;
      if (entry.pendingEdits.size > 0 || entry.pendingDeletedRowKeys.size > 0) {
        return true;
      }
    }
    return false;
  });
  return tabMarkerDirty || pendingEditDirty || rawPendingEditDirty;
}

export function useClosedTabHistory(): readonly Tab[] {
  const ws = useCurrentWorkspace();
  return ws?.closedTabHistory ?? EMPTY_TABS;
}
