import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import type {
  ConnectionConfig,
  ConnectionDraft,
  ConnectionGroup,
  ConnectionStatus,
} from "./model";
import * as tauri from "@lib/tauri";
import { attachZustandIpcBridge } from "@lib/zustand-ipc-bridge";
import { getCurrentWindowLabel } from "@lib/window-label";
import {
  persistFocusedConnId,
  persistActiveStatuses,
  readConnectionSession,
} from "@lib/scopedLocalStorage";
import { normalizeActiveStatuses } from "@lib/wireCamelCase";
import { cleanupConnectionFrontendState } from "@lib/runtime/connection/cleanup";

export interface ConnectionState {
  connections: ConnectionConfig[];
  groups: ConnectionGroup[];
  activeStatuses: Record<string, ConnectionStatus>;
  /**
   * The connection the user is currently focused on — drives the schema tree,
   * the "+ Query" button, and any future UI that needs to know "which one am
   * I looking at". Backend still supports multiple simultaneous connections;
   * this field only tracks UI focus, not the set of live connections.
   */
  focusedConnId: string | null;
  loading: boolean;
  /**
   * Sprint 270 — has `loadConnections` ever resolved (success OR error) in
   * this window's lifetime. Distinct from `loading`: `loading` is "actively
   * in flight", `hasLoadedOnce` is "ever finished". The skeleton at first
   * paint is gated on this flag — once it flips, the skeleton swaps out
   * and stays out for the rest of the session. Runtime-only: NOT persisted,
   * NOT broadcast through the cross-window bridge (`SYNCED_KEYS`).
   */
  hasLoadedOnce: boolean;
  error: string | null;

  loadConnections: () => Promise<void>;
  loadGroups: () => Promise<void>;
  addConnection: (draft: ConnectionDraft) => Promise<ConnectionConfig>;
  updateConnection: (draft: ConnectionDraft) => Promise<void>;
  removeConnection: (id: string) => Promise<void>;
  testConnection: (
    draft: ConnectionDraft,
    existingId?: string | null,
  ) => Promise<string>;
  connectToDatabase: (id: string) => Promise<void>;
  disconnectFromDatabase: (id: string) => Promise<void>;
  setFocusedConn: (id: string | null) => void;
  /** Hydrate focusedConnId + activeStatuses from session-scoped localStorage. */
  hydrateFromSession: () => void;
  hydrateConnectionsFromSnapshot: (
    connections: ConnectionConfig[],
    groups: ConnectionGroup[],
  ) => void;
  hydrateActiveStatusesFromSnapshot: (
    activeStatuses: Record<string, ConnectionStatus>,
  ) => void;
  /**
   * Record the active database for the connection. No-op when the
   * connection isn't in the `connected` variant — `activeDb` only makes
   * sense alongside a live adapter pool. Callers (DbSwitcher) invoke
   * this on a successful `switchActiveDb` dispatch.
   */
  setActiveDb: (id: string, dbName: string) => void;
  addGroup: (group: ConnectionGroup) => Promise<ConnectionGroup>;
  updateGroup: (group: ConnectionGroup) => Promise<void>;
  removeGroup: (id: string) => Promise<void>;
  moveConnectionToGroup: (
    connectionId: string,
    groupId: string | null,
  ) => Promise<void>;
  initEventListeners: () => Promise<void>;
}

/** Pick another "connected" id to fall back to, or null if none available. */
function pickFallbackFocus(
  connections: ConnectionConfig[],
  statuses: Record<string, ConnectionStatus>,
  excludeId: string,
): string | null {
  const next = connections.find(
    (c) => c.id !== excludeId && statuses[c.id]?.type === "connected",
  );
  return next?.id ?? null;
}

function collectConnectionCleanupIds(
  previous: Pick<ConnectionState, "connections" | "activeStatuses">,
  current: Pick<ConnectionState, "connections" | "activeStatuses">,
): string[] {
  const ids = new Set<string>();
  const currentConnectionIds = new Set(current.connections.map((c) => c.id));

  for (const connection of previous.connections) {
    if (!currentConnectionIds.has(connection.id)) {
      ids.add(connection.id);
    }
  }

  for (const [id, status] of Object.entries(current.activeStatuses)) {
    const previousStatus = previous.activeStatuses[id];
    if (
      status.type === "disconnected" &&
      previousStatus?.type !== "disconnected"
    ) {
      ids.add(id);
    }
  }

  for (const id of Object.keys(previous.activeStatuses)) {
    if (!(id in current.activeStatuses)) {
      ids.add(id);
    }
  }

  return [...ids];
}

/**
 * Cross-window broadcast allowlist. Widening this list is a deliberate
 * audit step — regression-locked in the store's test so secrets can't be
 * silently broadcast.
 *
 *  - `connections`, `groups` — durable, user-visible state both windows
 *    render. Backend redacts passwords via `hasPassword: boolean`
 *    before populating `connections`, so the synced array is secret-free.
 *  - `activeStatuses` — workspace owns the live pool; launcher reads it
 *    so it never offers to connect what the workspace already owns.
 *  - `focusedConnId` — drives which connection the workspace operates on;
 *    a launcher double-click must focus the workspace's view too.
 *
 * Excluded: `loading` / `error` are window-local UX flags.
 */
export const SYNCED_KEYS: ReadonlyArray<keyof ConnectionState> = [
  "connections",
  "groups",
  "activeStatuses",
  "focusedConnId",
] as const;

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: [],
  groups: [],
  activeStatuses: {},
  focusedConnId: null,
  loading: false,
  hasLoadedOnce: false,
  error: null,

  loadConnections: async () => {
    set({ loading: true, error: null });
    try {
      const connections = await tauri.listConnections();
      // Sprint 270 — flip in BOTH success and error branches so the
      // skeleton swaps to the existing empty/error surface and never
      // gets stuck shimmering. `hasLoadedOnce` is a session "ever
      // finished" signal, NOT persisted, NOT in `SYNCED_KEYS`.
      set({ connections, loading: false, hasLoadedOnce: true });
    } catch (e) {
      set({ error: String(e), loading: false, hasLoadedOnce: true });
    }
  },

  loadGroups: async () => {
    try {
      const groups = await tauri.listGroups();
      set({ groups });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  addConnection: async (draft) => {
    const saved = await tauri.saveConnection(draft, true);
    set((state) => ({
      connections: [...state.connections, saved],
    }));
    return saved;
  },

  updateConnection: async (draft) => {
    const saved = await tauri.saveConnection(draft, false);
    set((state) => ({
      connections: state.connections.map((c) =>
        c.id === saved.id ? saved : c,
      ),
    }));
  },

  removeConnection: async (id) => {
    const statuses = get().activeStatuses;
    const status = statuses[id];
    if (status?.type === "connected") {
      await tauri.disconnectFromDatabase(id);
    }
    await tauri.deleteConnection(id);
    set((state) => {
      const newStatuses = { ...state.activeStatuses };
      delete newStatuses[id];
      const newConnections = state.connections.filter((c) => c.id !== id);
      const newFocused =
        state.focusedConnId === id
          ? pickFallbackFocus(newConnections, newStatuses, id)
          : state.focusedConnId;
      return {
        connections: newConnections,
        activeStatuses: newStatuses,
        focusedConnId: newFocused,
      };
    });
    const { activeStatuses, focusedConnId } = get();
    persistActiveStatuses(activeStatuses);
    persistFocusedConnId(focusedConnId);
  },

  testConnection: async (draft, existingId = null) => {
    return tauri.testConnection(draft, existingId);
  },

  connectToDatabase: async (id) => {
    set((state) => ({
      activeStatuses: {
        ...state.activeStatuses,
        [id]: { type: "connecting" as const },
      },
    }));
    try {
      await tauri.connectToDatabase(id);
      set((state) => {
        // Seed `activeDb` from `connection.database` (the backend just
        // opened a pool against that DB). Omit the field when the
        // connection has no default database so the DbSwitcher renders
        // "(default)" rather than an empty string.
        const conn = state.connections.find((c) => c.id === id);
        const activeDb =
          conn?.database && conn.database.length > 0
            ? conn.database
            : undefined;
        return {
          activeStatuses: {
            ...state.activeStatuses,
            [id]: activeDb
              ? { type: "connected" as const, activeDb }
              : { type: "connected" as const },
          },
        };
      });
      // Persist the updated activeStatuses to session localStorage so
      // the workspace can hydrate on boot.
      persistActiveStatuses(get().activeStatuses);
    } catch (e) {
      set((state) => ({
        activeStatuses: {
          ...state.activeStatuses,
          [id]: { type: "error" as const, message: String(e) },
        },
      }));
    }
  },

  disconnectFromDatabase: async (id) => {
    await tauri.disconnectFromDatabase(id);
    set((state) => ({
      activeStatuses: {
        ...state.activeStatuses,
        [id]: { type: "disconnected" as const },
      },
    }));
    persistActiveStatuses(get().activeStatuses);
  },

  setFocusedConn: (id) => {
    set({ focusedConnId: id });
    persistFocusedConnId(id);
  },

  hydrateFromSession: () => {
    const session = readConnectionSession();
    const patch: Partial<
      Pick<ConnectionState, "focusedConnId" | "activeStatuses">
    > = {};
    const hasFocusedConnId =
      session.hasFocusedConnId ?? Boolean(session.focusedConnId);
    const hasActiveStatuses =
      session.hasActiveStatuses ?? session.activeStatuses !== null;
    if (hasFocusedConnId) patch.focusedConnId = session.focusedConnId;
    if (hasActiveStatuses)
      patch.activeStatuses = normalizeActiveStatuses(
        session.activeStatuses ?? {},
      ) as Record<string, ConnectionStatus>;
    if (Object.keys(patch).length > 0) set(patch);
  },

  hydrateConnectionsFromSnapshot: (connections, groups) => {
    set({
      connections,
      groups,
      // Snapshot is the source of truth at boot, so the launcher skeleton can
      // switch to the hydrated empty/error surface immediately.
      hasLoadedOnce: true,
    });
  },

  hydrateActiveStatusesFromSnapshot: (activeStatuses) => {
    set({ activeStatuses });
  },

  setActiveDb: (id, dbName) =>
    set((state) => {
      const current = state.activeStatuses[id];
      // Only mutate when the connection is in the `connected` variant —
      // setting `activeDb` while disconnected/erroring would leak a stale
      // database name once the user reconnects, and setting it on
      // `connecting` would race the connectToDatabase seed above.
      if (current?.type !== "connected") {
        return {};
      }
      return {
        activeStatuses: {
          ...state.activeStatuses,
          [id]: { type: "connected" as const, activeDb: dbName },
        },
      };
    }),

  addGroup: async (group) => {
    const saved = await tauri.saveGroup(group, true);
    set((state) => ({
      groups: [...state.groups, saved],
    }));
    return saved;
  },

  updateGroup: async (group) => {
    await tauri.saveGroup(group, false);
    set((state) => ({
      groups: state.groups.map((g) => (g.id === group.id ? group : g)),
    }));
  },

  removeGroup: async (id) => {
    await tauri.deleteGroup(id);
    set((state) => ({
      groups: state.groups.filter((g) => g.id !== id),
      connections: state.connections.map((c) =>
        c.groupId === id ? { ...c, groupId: null } : c,
      ),
    }));
  },

  moveConnectionToGroup: async (connectionId, groupId) => {
    await tauri.moveConnectionToGroup(connectionId, groupId);
    set((state) => ({
      connections: state.connections.map((c) =>
        c.id === connectionId ? { ...c, groupId: groupId } : c,
      ),
    }));
  },

  initEventListeners: async () => {
    try {
      await listen<{ id: string; status: ConnectionStatus }>(
        "connection-status-changed",
        (event) => {
          const { id, status } = event.payload;
          set((state) => ({
            activeStatuses: { ...state.activeStatuses, [id]: status },
          }));
          persistActiveStatuses(get().activeStatuses);
        },
      );
    } catch {
      // Tauri event runtime is absent in plain-browser dev/test surfaces.
    }
  },
}));

useConnectionStore.subscribe((current, previous) => {
  for (const id of collectConnectionCleanupIds(previous, current)) {
    cleanupConnectionFrontendState(id);
  }
});

/**
 * Symmetric module-load attach. Both windows attach unconditionally so
 * neither starts unattached. `originId` falls back to `"test"` under
 * vitest (jsdom has no Tauri window label); tests override per-file via
 * `vi.mock("@lib/window-label")`. The dispose handle is intentionally
 * unretained — the bridge lives the renderer's lifetime.
 */
void attachZustandIpcBridge<ConnectionState>(useConnectionStore, {
  channel: "connection-sync",
  syncKeys: SYNCED_KEYS,
  originId: getCurrentWindowLabel() ?? "test",
}).catch(() => {
  // best-effort: if the listen registration fails (e.g. Tauri runtime not
  // available outside of vitest mocks), the store still works window-local.
});
