import { useShallow } from "zustand/react/shallow";
import { useCurrentWindowConnectionId } from "@hooks/useCurrentWindowConnectionId";
// Same-store internal leaf: the store instance lives in `./store`, not the root
// barrel, so selectors no longer import back through `../workspaceStore` (the
// old runtime cycle — #1361). Still flagged by the store-boundary rule because
// its path sits under the `workspaceStore` dir, so keep a justified line disable.
// eslint-disable-next-line no-restricted-imports -- same-store internal: store instance leaf, no cycle (#1361)
import { useWorkspaceStore } from "./store";
import type {
  QueryTab,
  Tab,
  WorkspaceState,
  WorkspaceStoreState,
} from "./types";

// Selector hooks are the intentional read seam between workspaceStore and the
// sibling stores below. They stay co-located with workspaceStore to keep ADR
// 0027's `(connId, db)` key derivation visible. The store-boundary rule
// (`no-restricted-imports`, eslint.config.js) is disabled per-line only for
// these deliberate cross-store reads — the guardrail stays live for anything
// else (a new, unjustified cross-store import re-triggers the error).
// eslint-disable-next-line no-restricted-imports -- read seam: derive workspace key from connectionStore
import { useConnectionStore } from "../connectionStore";
// eslint-disable-next-line no-restricted-imports -- read seam: OR table-grid pending edits into connection dirtiness
import { useDataGridEditStore } from "../dataGridEditStore";
// eslint-disable-next-line no-restricted-imports -- read seam: OR raw-query grid pending edits into connection dirtiness
import { useRawQueryGridEditStore } from "../rawQueryGridEditStore";

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

// #1447 — the derived hooks below subscribe to their narrow slice directly
// instead of composing `useCurrentWorkspace()`. The whole-`WorkspaceState`
// subscription made every keystroke (`updateQuerySql` → new `ws` identity)
// re-render all consumers, even those reading keystroke-stable fields
// (`activeTabId`, `dirtyTabIds`, `closedTabHistory`). `updateQuerySql` only
// replaces the edited tab + the `tabs` array, so narrow selections keep
// their identity and skip the re-render.

function selectWorkspace(
  state: { workspaces: WorkspaceStoreState["workspaces"] },
  key: WorkspaceKey | null,
): WorkspaceState | null {
  if (!key) return null;
  return state.workspaces[key.connId]?.[key.db] ?? null;
}

export function useActiveTab(): Tab | null {
  const key = useCurrentWorkspaceKey();
  return useWorkspaceStore((state) => {
    const ws = selectWorkspace(state, key);
    if (!ws?.activeTabId) return null;
    return ws.tabs.find((t) => t.id === ws.activeTabId) ?? null;
  });
}

/**
 * #1447 — the active tab minus the per-keystroke `sql` field. `useActiveTab`
 * consumers that never read the query text (App chrome, SchemaTree
 * highlight, DbSwitcher, WorkspaceSidebar) re-rendered on every SQL editor
 * keystroke because the edited tab object is replaced wholesale. All other
 * tab fields keep their identity across an sql edit, so the `useShallow`
 * projection returns the previous object and skips the re-render.
 */
export type ActiveTabSansSql = Exclude<Tab, QueryTab> | Omit<QueryTab, "sql">;

export function useActiveTabSansSql(): ActiveTabSansSql | null {
  const key = useCurrentWorkspaceKey();
  return useWorkspaceStore(
    useShallow((state): ActiveTabSansSql | null => {
      const ws = selectWorkspace(state, key);
      if (!ws?.activeTabId) return null;
      const tab = ws.tabs.find((t) => t.id === ws.activeTabId) ?? null;
      if (!tab || tab.type !== "query") return tab;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- rest-omit drops the per-keystroke `sql` field
      const { sql: _sql, ...sansSql } = tab;
      return sansSql;
    }),
  );
}

const EMPTY_TABS: readonly Tab[] = Object.freeze([]);
const EMPTY_STRINGS: readonly string[] = Object.freeze([]);

export function useCurrentTabs(): readonly Tab[] {
  const key = useCurrentWorkspaceKey();
  return useWorkspaceStore(
    (state) => selectWorkspace(state, key)?.tabs ?? EMPTY_TABS,
  );
}

/**
 * #1447 — open tab ids in strip order. Keystroke-stable alternative to
 * `useCurrentTabs` for consumers that only need identity/order (e.g. the
 * App Cmd+1..9 switcher).
 */
export function useCurrentTabIds(): readonly string[] {
  const key = useCurrentWorkspaceKey();
  return useWorkspaceStore(
    useShallow(
      (state) =>
        selectWorkspace(state, key)?.tabs.map((t) => t.id) ?? EMPTY_STRINGS,
    ),
  );
}

export function useActiveTabId(): string | null {
  const key = useCurrentWorkspaceKey();
  return useWorkspaceStore(
    (state) => selectWorkspace(state, key)?.activeTabId ?? null,
  );
}

export function useDirtyTabIds(): readonly string[] {
  const key = useCurrentWorkspaceKey();
  return useWorkspaceStore(
    (state) => selectWorkspace(state, key)?.dirtyTabIds ?? EMPTY_STRINGS,
  );
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
 * #1364 — each pending-edit store owns its own `hasDirtyEntries(prefix)`
 * predicate (dirty = it holds real pending content, matching that grid hook's
 * own predicate). This aggregator only ORs the store-owned selectors, so a new
 * edit surface adds its own `hasDirtyEntries` here instead of re-implementing
 * the pending-content scan.
 */
export function useConnectionHasDirtyTabs(connId: string | null): boolean {
  const prefix = connId ? `${connId}::` : null;
  const tabMarkerDirty = useWorkspaceStore((state) => {
    if (!connId) return false;
    const dbs = state.workspaces[connId];
    if (!dbs) return false;
    // `?? 0` mirrors the `?? EMPTY_STRINGS` guard above — a hydrated workspace
    // may omit the window-local dirtyTabIds marker (#1091), and reading
    // `.length` on undefined would unmount the workspace window.
    return Object.values(dbs).some((ws) => (ws.dirtyTabIds?.length ?? 0) > 0);
  });
  const pendingEditDirty = useDataGridEditStore((state) =>
    prefix ? state.hasDirtyEntries(prefix) : false,
  );
  const rawPendingEditDirty = useRawQueryGridEditStore((state) =>
    prefix ? state.hasDirtyEntries(prefix) : false,
  );
  return tabMarkerDirty || pendingEditDirty || rawPendingEditDirty;
}

export function useClosedTabHistory(): readonly Tab[] {
  const key = useCurrentWorkspaceKey();
  return useWorkspaceStore(
    (state) => selectWorkspace(state, key)?.closedTabHistory ?? EMPTY_TABS,
  );
}
