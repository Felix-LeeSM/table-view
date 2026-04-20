import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import type {
  ConnectionConfig,
  ConnectionDraft,
  ConnectionGroup,
  ConnectionStatus,
} from "@/types/connection";
import * as tauri from "@lib/tauri";

interface ConnectionState {
  connections: ConnectionConfig[];
  groups: ConnectionGroup[];
  activeStatuses: Record<string, ConnectionStatus>;
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
  addGroup: (group: ConnectionGroup) => Promise<ConnectionGroup>;
  updateGroup: (group: ConnectionGroup) => Promise<void>;
  removeGroup: (id: string) => Promise<void>;
  moveConnectionToGroup: (
    connectionId: string,
    groupId: string | null,
  ) => Promise<void>;
  initEventListeners: () => Promise<void>;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: [],
  groups: [],
  activeStatuses: {},
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
      return {
        connections: state.connections.filter((c) => c.id !== id),
        activeStatuses: newStatuses,
      };
    });
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
      set((state) => ({
        activeStatuses: {
          ...state.activeStatuses,
          [id]: { type: "connected" as const },
        },
      }));
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
  },

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
