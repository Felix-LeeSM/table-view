import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import type {
  ConnectionConfig,
  ConnectionDraft,
  ConnectionGroup,
  ConnectionStatus,
} from "@/types/connection";
import * as tauri from "@lib/tauri";
import { toast } from "@lib/toast";
import { attachZustandIpcBridge } from "@lib/zustand-ipc-bridge";
import { getCurrentWindowLabel } from "@lib/window-label";
import {
  persistFocusedConnId,
  persistActiveStatuses,
  readConnectionSession,
} from "@lib/session-storage";

interface ConnectionState {
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

/**
 * Cross-window broadcast allowlist. Widening this list is a deliberate
 * audit step — regression-locked in the store's test so secrets can't be
 * silently broadcast.
 *
 *  - `connections`, `groups` — durable, user-visible state both windows
 *    render. Backend redacts passwords via `has_password: boolean`
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
  error: null,

  loadConnections: async () => {
    set({ loading: true, error: null });
    try {
      const connections = await tauri.listConnections();
      set({ connections, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
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
    // Toast lives outside the dialog portal so it survives `onClose()`.
    toast.success(`Connection "${saved.name}" added.`);
    return saved;
  },

  updateConnection: async (draft) => {
    const saved = await tauri.saveConnection(draft, false);
    set((state) => ({
      connections: state.connections.map((c) =>
        c.id === saved.id ? saved : c,
      ),
    }));
    toast.success(`Connection "${saved.name}" updated.`);
  },

  removeConnection: async (id) => {
    // Resolve the display name before mutating state so the toast can name
    // the connection the user just removed (UX nicety — referring to "that
    // connection" is unhelpful when the sidebar entry is already gone).
    const removed = get().connections.find((c) => c.id === id);
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
    toast.success(
      removed ? `Connection "${removed.name}" removed.` : "Connection removed.",
    );
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
    if (session.focusedConnId) patch.focusedConnId = session.focusedConnId;
    if (session.activeStatuses)
      patch.activeStatuses = session.activeStatuses as Record<
        string,
        ConnectionStatus
      >;
    if (Object.keys(patch).length > 0) set(patch);
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
        c.group_id === id ? { ...c, group_id: null } : c,
      ),
    }));
  },

  moveConnectionToGroup: async (connectionId, groupId) => {
    await tauri.moveConnectionToGroup(connectionId, groupId);
    set((state) => ({
      connections: state.connections.map((c) =>
        c.id === connectionId ? { ...c, group_id: groupId } : c,
      ),
    }));
  },

  initEventListeners: async () => {
    await listen<{ id: string; status: ConnectionStatus }>(
      "connection-status-changed",
      (event) => {
        const { id, status } = event.payload;
        set((state) => ({
          activeStatuses: { ...state.activeStatuses, [id]: status },
        }));
      },
    );
  },
}));

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
