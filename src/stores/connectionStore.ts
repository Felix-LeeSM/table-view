import { create } from "zustand";
import type {
  ConnectionConfig,
  ConnectionGroup,
  ConnectionStatus,
} from "../types/connection";
import * as tauri from "../lib/tauri";

interface ConnectionState {
  connections: ConnectionConfig[];
  groups: ConnectionGroup[];
  activeStatuses: Record<string, ConnectionStatus>;
  loading: boolean;
  error: string | null;

  loadConnections: () => Promise<void>;
  loadGroups: () => Promise<void>;
  addConnection: (conn: ConnectionConfig) => Promise<ConnectionConfig>;
  updateConnection: (conn: ConnectionConfig) => Promise<void>;
  removeConnection: (id: string) => Promise<void>;
  testConnection: (config: ConnectionConfig) => Promise<string>;
  connectToDatabase: (id: string) => Promise<void>;
  disconnectFromDatabase: (id: string) => Promise<void>;
  addGroup: (group: ConnectionGroup) => Promise<ConnectionGroup>;
  updateGroup: (group: ConnectionGroup) => Promise<void>;
  removeGroup: (id: string) => Promise<void>;
  moveConnectionToGroup: (
    connectionId: string,
    groupId: string | null,
  ) => Promise<void>;
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

  addConnection: async (conn) => {
    const saved = await tauri.saveConnection(conn, true);
    set((state) => ({
      connections: [...state.connections, saved],
    }));
    return saved;
  },

  updateConnection: async (conn) => {
    await tauri.saveConnection(conn, false);
    set((state) => ({
      connections: state.connections.map((c) => (c.id === conn.id ? conn : c)),
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

  testConnection: async (config) => {
    return tauri.testConnection(config);
  },

  connectToDatabase: async (id) => {
    await tauri.connectToDatabase(id);
    set((state) => ({
      activeStatuses: {
        ...state.activeStatuses,
        [id]: { type: "connected" as const },
      },
    }));
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
}));
