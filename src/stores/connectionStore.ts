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

/**
 * Sprint 143 (AC-148-4) — persist the user's `activeDb` pick across a
 * close/reopen cycle. Keyed by connection id so two connections never
 * share state. The hand-rolled localStorage path mirrors `mruStore` /
 * `favoritesStore` for consistency (no zustand-persist middleware).
 */
const ACTIVE_DB_PREFIX = "tableview:activeDb:";

function activeDbKey(id: string): string {
  return `${ACTIVE_DB_PREFIX}${id}`;
}

function persistActiveDb(id: string, dbName: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(activeDbKey(id), dbName);
  } catch {
    // localStorage may be unavailable (SSR, quota exceeded, private mode).
  }
}

function loadPersistedActiveDb(id: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(activeDbKey(id));
    return raw && raw.length > 0 ? raw : undefined;
  } catch {
    return undefined;
  }
}

function clearPersistedActiveDb(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(activeDbKey(id));
  } catch {
    // ignore
  }
}

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
  /**
   * Sprint 130 — record the active database for the connection. The action
   * is a no-op when the connection isn't currently in the `connected`
   * variant: an `activeDb` only makes sense alongside a live adapter pool.
   * UI callers (DbSwitcher) call this on a successful `switchActiveDb`
   * dispatch so the trigger label updates immediately and any tab that
   * reads `activeDb` next reflects the new context.
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
    // Sprint 94 — surface CRUD success so the user has confirmation that the
    // dialog "Save" actually persisted. AC-04. The toast lives outside the
    // dialog portal so it survives `onClose()`.
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
    // Sprint 94 — AC-04: connection-update success toast.
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
    // Sprint 94 — AC-04: connection-remove success toast.
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
        // Sprint 130 — seed the new `connected.activeDb` field with the
        // connection's default database so the DbSwitcher trigger label
        // and any newly-opened RDB tab pick it up immediately. If the
        // connection has no `database` (unusual — frontend draft
        // validation prevents it), we omit the field rather than write
        // an empty string.
        //
        // Sprint 143 (AC-148-4) — a previously-persisted activeDb (from
        // a prior session's DbSwitcher pick) wins over the connection's
        // default `database`. Mongo users in particular expect the DB
        // they last switched to in the workspace to come back on
        // reopen; pre-S143 it silently reverted to `connection.database`.
        const conn = state.connections.find((c) => c.id === id);
        const persisted = loadPersistedActiveDb(id);
        const activeDb =
          persisted ??
          (conn?.database && conn.database.length > 0
            ? conn.database
            : undefined);
        return {
          activeStatuses: {
            ...state.activeStatuses,
            [id]: activeDb
              ? { type: "connected" as const, activeDb }
              : { type: "connected" as const },
          },
        };
      });
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
    // Sprint 143 (AC-148-4) — clear the persisted activeDb so a deleted
    // or forgotten connection doesn't leave a dangling localStorage key.
    clearPersistedActiveDb(id);
    set((state) => ({
      activeStatuses: {
        ...state.activeStatuses,
        [id]: { type: "disconnected" as const },
      },
    }));
  },

  setFocusedConn: (id) => set({ focusedConnId: id }),

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
      // Sprint 143 (AC-148-4) — persist the new selection so it survives
      // a close/reopen cycle. Persistence is deliberately scoped to the
      // `connected` branch above; we never write while the connection is
      // disconnected or erroring (those branches are early-returned).
      persistActiveDb(id, dbName);
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
