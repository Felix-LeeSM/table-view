import { describe, it, expect, vi, beforeEach } from "vitest";
import { useConnectionStore } from "./connectionStore";

// Mock @tauri-apps/api/event
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

// Mock the tauri invoke wrapper
vi.mock("../lib/tauri", () => ({
  listConnections: vi.fn(() =>
    Promise.resolve([
      {
        id: "c1",
        name: "TestDB",
        db_type: "postgresql",
        host: "localhost",
        port: 5432,
        user: "postgres",
        password: "secret",
        database: "test",
        group_id: null,
        color: null,
        connection_timeout: null,
        keep_alive_interval: null,
      },
    ]),
  ),
  listGroups: vi.fn(() =>
    Promise.resolve([
      { id: "g1", name: "Production", color: null, collapsed: false },
    ]),
  ),
  saveConnection: vi.fn((conn, isNew) =>
    Promise.resolve(isNew ? { ...conn, id: "new-id" } : conn),
  ),
  deleteConnection: vi.fn(() => Promise.resolve()),
  testConnection: vi.fn(() => Promise.resolve("Connection successful")),
  connectToDatabase: vi.fn(() => Promise.resolve()),
  disconnectFromDatabase: vi.fn(() => Promise.resolve()),
  saveGroup: vi.fn((group, isNew) =>
    Promise.resolve(isNew ? { ...group, id: "new-gid" } : group),
  ),
  deleteGroup: vi.fn(() => Promise.resolve()),
  moveConnectionToGroup: vi.fn(() => Promise.resolve()),
}));

describe("connectionStore", () => {
  beforeEach(() => {
    // Reset store state
    useConnectionStore.setState({
      connections: [],
      groups: [],
      activeStatuses: {},
      loading: false,
      error: null,
    });
    vi.clearAllMocks();
  });

  it("loads connections from backend", async () => {
    await useConnectionStore.getState().loadConnections();
    const state = useConnectionStore.getState();
    expect(state.connections).toHaveLength(1);
    expect(state.connections[0]!.name).toBe("TestDB");
  });

  it("loads groups from backend", async () => {
    await useConnectionStore.getState().loadGroups();
    const state = useConnectionStore.getState();
    expect(state.groups).toHaveLength(1);
    expect(state.groups[0]!.name).toBe("Production");
  });

  it("adds connection", async () => {
    const conn = {
      id: "",
      name: "NewDB",
      db_type: "postgresql" as const,
      host: "localhost",
      port: 5432,
      user: "postgres",
      password: "",
      database: "newdb",
      group_id: null,
      color: null,
    };
    const saved = await useConnectionStore.getState().addConnection(conn);
    expect(saved.id).toBe("new-id");
    expect(useConnectionStore.getState().connections).toHaveLength(1);
  });

  it("updates connection", async () => {
    useConnectionStore.setState({
      connections: [
        {
          id: "c1",
          name: "Old",
          db_type: "postgresql",
          host: "localhost",
          port: 5432,
          user: "postgres",
          password: "",
          database: "db",
          group_id: null,
          color: null,
        },
      ],
    });

    await useConnectionStore.getState().updateConnection({
      ...useConnectionStore.getState().connections[0]!,
      name: "Updated",
    });

    expect(useConnectionStore.getState().connections[0]!.name).toBe("Updated");
  });

  it("removes connection", async () => {
    useConnectionStore.setState({
      connections: [
        {
          id: "c1",
          name: "DB",
          db_type: "postgresql",
          host: "localhost",
          port: 5432,
          user: "postgres",
          password: "",
          database: "db",
          group_id: null,
          color: null,
        },
      ],
    });

    await useConnectionStore.getState().removeConnection("c1");
    expect(useConnectionStore.getState().connections).toHaveLength(0);
  });

  it("sets connected status on connect", async () => {
    await useConnectionStore.getState().connectToDatabase("c1");
    expect(useConnectionStore.getState().activeStatuses["c1"]).toEqual({
      type: "connected",
    });
  });

  it("sets disconnected status on disconnect", async () => {
    useConnectionStore.setState({
      activeStatuses: { c1: { type: "connected" } },
    });

    await useConnectionStore.getState().disconnectFromDatabase("c1");
    expect(useConnectionStore.getState().activeStatuses["c1"]).toEqual({
      type: "disconnected",
    });
  });

  it("moves connection to group", async () => {
    useConnectionStore.setState({
      connections: [
        {
          id: "c1",
          name: "DB",
          db_type: "postgresql",
          host: "localhost",
          port: 5432,
          user: "postgres",
          password: "",
          database: "db",
          group_id: null,
          color: null,
        },
      ],
    });

    await useConnectionStore.getState().moveConnectionToGroup("c1", "g1");
    expect(useConnectionStore.getState().connections[0]!.group_id).toBe("g1");
  });

  it("removes group and ungroups connections", async () => {
    useConnectionStore.setState({
      connections: [
        {
          id: "c1",
          name: "DB",
          db_type: "postgresql",
          host: "localhost",
          port: 5432,
          user: "postgres",
          password: "",
          database: "db",
          group_id: "g1",
          color: null,
        },
      ],
      groups: [{ id: "g1", name: "Prod", color: null, collapsed: false }],
    });

    await useConnectionStore.getState().removeGroup("g1");
    expect(useConnectionStore.getState().groups).toHaveLength(0);
    expect(useConnectionStore.getState().connections[0]!.group_id).toBeNull();
  });
});
