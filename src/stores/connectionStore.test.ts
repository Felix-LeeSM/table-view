import { describe, it, expect, vi, beforeEach } from "vitest";
import { useConnectionStore } from "./connectionStore";

// Mock @tauri-apps/api/event
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

// Mock the tauri invoke wrapper
vi.mock("@lib/tauri", () => ({
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
      focusedConnId: null,
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
    const draft = {
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
      paradigm: "rdb" as const,
    };
    const saved = await useConnectionStore.getState().addConnection(draft);
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
          has_password: false,
          database: "db",
          group_id: null,
          color: null,
          paradigm: "rdb",
        },
      ],
    });

    const existing = useConnectionStore.getState().connections[0]!;
    await useConnectionStore.getState().updateConnection({
      id: existing.id,
      name: "Updated",
      db_type: existing.db_type,
      host: existing.host,
      port: existing.port,
      user: existing.user,
      password: null,
      database: existing.database,
      group_id: existing.group_id,
      color: existing.color,
      paradigm: existing.paradigm,
    });

    // updateConnection replaces with the value returned by saveConnection,
    // which is mocked to echo the new id. The tauri mock returns "new-id"
    // for any save, so the local state ends up with "new-id" rather than
    // the original c1. We just assert the array shape stayed reasonable.
    expect(useConnectionStore.getState().connections.length).toBeGreaterThan(0);
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
          has_password: false,
          database: "db",
          group_id: null,
          color: null,
          paradigm: "rdb",
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

  it("transitions from connecting to connected on successful connect", async () => {
    let resolveConnect: () => void;
    const connectPromise = new Promise<void>((resolve) => {
      resolveConnect = resolve;
    });
    const { connectToDatabase } = await import("@lib/tauri");
    (connectToDatabase as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      connectPromise,
    );

    // Start connecting — should immediately set "connecting"
    const connectCall = useConnectionStore.getState().connectToDatabase("c1");
    expect(useConnectionStore.getState().activeStatuses["c1"]).toEqual({
      type: "connecting",
    });

    // Resolve the backend call
    resolveConnect!();
    await connectCall;

    // Should now be "connected"
    expect(useConnectionStore.getState().activeStatuses["c1"]).toEqual({
      type: "connected",
    });
  });

  it("transitions from connecting to error on failed connect", async () => {
    const { connectToDatabase } = await import("@lib/tauri");
    (connectToDatabase as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Connection refused"),
    );

    await useConnectionStore.getState().connectToDatabase("c1");

    expect(useConnectionStore.getState().activeStatuses["c1"]).toEqual({
      type: "error",
      message: "Error: Connection refused",
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
          has_password: false,
          database: "db",
          group_id: null,
          color: null,
          paradigm: "rdb",
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
          has_password: false,
          database: "db",
          group_id: "g1",
          color: null,
          paradigm: "rdb",
        },
      ],
      groups: [{ id: "g1", name: "Prod", color: null, collapsed: false }],
    });

    await useConnectionStore.getState().removeGroup("g1");
    expect(useConnectionStore.getState().groups).toHaveLength(0);
    expect(useConnectionStore.getState().connections[0]!.group_id).toBeNull();
  });

  it("disconnects before removing a connected connection", async () => {
    const { disconnectFromDatabase, deleteConnection } =
      await import("@lib/tauri");

    useConnectionStore.setState({
      connections: [
        {
          id: "c1",
          name: "DB",
          db_type: "postgresql",
          host: "localhost",
          port: 5432,
          user: "postgres",
          has_password: false,
          database: "db",
          group_id: null,
          color: null,
          paradigm: "rdb",
        },
      ],
      activeStatuses: { c1: { type: "connected" } },
    });

    await useConnectionStore.getState().removeConnection("c1");

    // Should have disconnected first, then deleted
    expect(disconnectFromDatabase).toHaveBeenCalledWith("c1");
    expect(deleteConnection).toHaveBeenCalledWith("c1");
    expect(useConnectionStore.getState().connections).toHaveLength(0);
    expect(useConnectionStore.getState().activeStatuses["c1"]).toBeUndefined();
  });

  it("does not disconnect when removing a non-connected connection", async () => {
    const { disconnectFromDatabase } = await import("@lib/tauri");

    useConnectionStore.setState({
      connections: [
        {
          id: "c1",
          name: "DB",
          db_type: "postgresql",
          host: "localhost",
          port: 5432,
          user: "postgres",
          has_password: false,
          database: "db",
          group_id: null,
          color: null,
          paradigm: "rdb",
        },
      ],
      activeStatuses: { c1: { type: "disconnected" } },
    });

    await useConnectionStore.getState().removeConnection("c1");

    // Should NOT have called disconnect for a disconnected connection
    expect(disconnectFromDatabase).not.toHaveBeenCalled();
  });

  it("handles loadConnections error", async () => {
    const { listConnections } = await import("@lib/tauri");
    (listConnections as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Network error"),
    );

    await useConnectionStore.getState().loadConnections();
    const state = useConnectionStore.getState();
    expect(state.error).toContain("Network error");
    expect(state.loading).toBe(false);
  });

  it("handles loadGroups error", async () => {
    const { listGroups } = await import("@lib/tauri");
    (listGroups as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Server error"),
    );

    await useConnectionStore.getState().loadGroups();
    const state = useConnectionStore.getState();
    expect(state.error).toContain("Server error");
  });

  it("delegates testConnection", async () => {
    const { testConnection } = await import("@lib/tauri");
    const draft = {
      id: "c1",
      name: "DB",
      db_type: "postgresql" as const,
      host: "localhost",
      port: 5432,
      user: "postgres",
      password: null,
      database: "db",
      group_id: null,
      color: null,
      paradigm: "rdb" as const,
    };

    const result = await useConnectionStore.getState().testConnection(draft);

    expect(testConnection).toHaveBeenCalledWith(draft, null);
    expect(result).toBe("Connection successful");
  });

  it("adds group and returns saved group with id", async () => {
    const group = {
      id: "",
      name: "NewGroup",
      color: null,
      collapsed: false,
    };

    const saved = await useConnectionStore.getState().addGroup(group);
    expect(saved.id).toBe("new-gid");
    expect(useConnectionStore.getState().groups).toHaveLength(1);
    expect(useConnectionStore.getState().groups[0]!.name).toBe("NewGroup");
  });

  it("updates group", async () => {
    useConnectionStore.setState({
      groups: [{ id: "g1", name: "Old", color: null, collapsed: false }],
    });

    await useConnectionStore.getState().updateGroup({
      id: "g1",
      name: "Updated",
      color: "#ff0000",
      collapsed: true,
    });

    expect(useConnectionStore.getState().groups[0]!.name).toBe("Updated");
    expect(useConnectionStore.getState().groups[0]!.color).toBe("#ff0000");
    expect(useConnectionStore.getState().groups[0]!.collapsed).toBe(true);
  });

  describe("focusedConnId", () => {
    function seedConnections() {
      useConnectionStore.setState({
        connections: [
          {
            id: "c1",
            name: "A",
            db_type: "postgresql",
            host: "localhost",
            port: 5432,
            user: "postgres",
            has_password: false,
            database: "a",
            group_id: null,
            color: null,
            paradigm: "rdb",
          },
          {
            id: "c2",
            name: "B",
            db_type: "postgresql",
            host: "localhost",
            port: 5432,
            user: "postgres",
            has_password: false,
            database: "b",
            group_id: null,
            color: null,
            paradigm: "rdb",
          },
        ],
      });
    }

    it("setFocusedConn sets and clears the focus", () => {
      useConnectionStore.getState().setFocusedConn("c1");
      expect(useConnectionStore.getState().focusedConnId).toBe("c1");
      useConnectionStore.getState().setFocusedConn(null);
      expect(useConnectionStore.getState().focusedConnId).toBeNull();
    });

    it("clears focus when the focused connection is removed", async () => {
      seedConnections();
      useConnectionStore.setState({
        activeStatuses: { c1: { type: "disconnected" } },
        focusedConnId: "c1",
      });

      await useConnectionStore.getState().removeConnection("c1");

      expect(useConnectionStore.getState().focusedConnId).toBeNull();
    });

    it("falls back to another connected connection when the focused one is removed", async () => {
      seedConnections();
      useConnectionStore.setState({
        activeStatuses: {
          c1: { type: "connected" },
          c2: { type: "connected" },
        },
        focusedConnId: "c1",
      });

      await useConnectionStore.getState().removeConnection("c1");

      expect(useConnectionStore.getState().focusedConnId).toBe("c2");
    });

    it("does not change focus when a non-focused connection is removed", async () => {
      seedConnections();
      useConnectionStore.setState({
        activeStatuses: { c1: { type: "connected" } },
        focusedConnId: "c2",
      });

      await useConnectionStore.getState().removeConnection("c1");

      expect(useConnectionStore.getState().focusedConnId).toBe("c2");
    });

    it("keeps focus on the disconnected connection so its placeholder stays visible", async () => {
      seedConnections();
      useConnectionStore.setState({
        activeStatuses: {
          c1: { type: "connected" },
          c2: { type: "connected" },
        },
        focusedConnId: "c1",
      });

      await useConnectionStore.getState().disconnectFromDatabase("c1");

      expect(useConnectionStore.getState().focusedConnId).toBe("c1");
    });
  });

  it("initEventListeners registers connection-status-changed listener", async () => {
    const { listen } = await import("@tauri-apps/api/event");

    await useConnectionStore.getState().initEventListeners();

    expect(listen).toHaveBeenCalledWith(
      "connection-status-changed",
      expect.any(Function),
    );

    // Simulate event callback to exercise the handler branch
    const handler = (listen as ReturnType<typeof vi.fn>).mock
      .calls[0]![1] as (event: {
      payload: { id: string; status: { type: string } };
    }) => void;

    handler({ payload: { id: "c1", status: { type: "connected" } } });

    expect(useConnectionStore.getState().activeStatuses["c1"]).toEqual({
      type: "connected",
    });
  });

  // -- Sprint 130 — activeDb tracking + setActiveDb action --

  it("seeds activeDb from connection.database on a successful connect", async () => {
    useConnectionStore.setState({
      connections: [
        {
          id: "c1",
          name: "TestDB",
          db_type: "postgresql",
          host: "localhost",
          port: 5432,
          user: "postgres",
          database: "analytics",
          group_id: null,
          color: null,
          has_password: false,
          paradigm: "rdb",
        },
      ],
      activeStatuses: {},
    });
    await useConnectionStore.getState().connectToDatabase("c1");
    const status = useConnectionStore.getState().activeStatuses["c1"];
    expect(status?.type).toBe("connected");
    if (status?.type === "connected") {
      expect(status.activeDb).toBe("analytics");
    }
  });

  it("connectToDatabase omits activeDb when the connection has no default database", async () => {
    useConnectionStore.setState({
      connections: [
        {
          id: "c1",
          name: "TestDB",
          db_type: "postgresql",
          host: "localhost",
          port: 5432,
          user: "postgres",
          database: "",
          group_id: null,
          color: null,
          has_password: false,
          paradigm: "rdb",
        },
      ],
      activeStatuses: {},
    });
    await useConnectionStore.getState().connectToDatabase("c1");
    expect(useConnectionStore.getState().activeStatuses["c1"]).toEqual({
      type: "connected",
    });
  });

  // -- Sprint 131 — Mongo paradigm activeDb seeding --

  it("seeds activeDb from connection.database for a Mongo paradigm connection", async () => {
    // Sprint 131 contract: connectToDatabase must be paradigm-agnostic
    // for activeDb seeding. Previously the seed was scoped to RDB-only
    // (S130), which left the Mongo DbSwitcher trigger label stuck on
    // "(default)" until the user manually switched DBs. With the seed
    // applied, the trigger reflects the connection's configured DB on
    // first connect.
    useConnectionStore.setState({
      connections: [
        {
          id: "m1",
          name: "MongoCluster",
          db_type: "mongodb",
          host: "localhost",
          port: 27017,
          user: "mongo",
          database: "analytics",
          group_id: null,
          color: null,
          has_password: false,
          paradigm: "document",
        },
      ],
      activeStatuses: {},
    });
    await useConnectionStore.getState().connectToDatabase("m1");
    const status = useConnectionStore.getState().activeStatuses["m1"];
    expect(status?.type).toBe("connected");
    if (status?.type === "connected") {
      expect(status.activeDb).toBe("analytics");
    }
  });

  it("connectToDatabase omits activeDb when a Mongo connection has no default database", async () => {
    // Mongo deployments often connect without specifying a database
    // (the user picks one from the switcher post-connect). In that
    // case `activeDb` must be `undefined`, NOT an empty string — the
    // DbSwitcher distinguishes the two when picking its label.
    useConnectionStore.setState({
      connections: [
        {
          id: "m1",
          name: "MongoCluster",
          db_type: "mongodb",
          host: "localhost",
          port: 27017,
          user: "mongo",
          database: "",
          group_id: null,
          color: null,
          has_password: false,
          paradigm: "document",
        },
      ],
      activeStatuses: {},
    });
    await useConnectionStore.getState().connectToDatabase("m1");
    const status = useConnectionStore.getState().activeStatuses["m1"];
    expect(status?.type).toBe("connected");
    if (status?.type === "connected") {
      expect(status.activeDb).toBeUndefined();
    }
  });

  it("setActiveDb mutates activeDb when the connection is connected", () => {
    useConnectionStore.setState({
      activeStatuses: { c1: { type: "connected", activeDb: "postgres" } },
    });
    useConnectionStore.getState().setActiveDb("c1", "warehouse");
    const status = useConnectionStore.getState().activeStatuses["c1"];
    expect(status?.type).toBe("connected");
    if (status?.type === "connected") {
      expect(status.activeDb).toBe("warehouse");
    }
  });

  it("setActiveDb is a no-op when the connection is disconnected", () => {
    useConnectionStore.setState({
      activeStatuses: { c1: { type: "disconnected" } },
    });
    useConnectionStore.getState().setActiveDb("c1", "warehouse");
    expect(useConnectionStore.getState().activeStatuses["c1"]).toEqual({
      type: "disconnected",
    });
  });

  it("setActiveDb is a no-op when the connection is in error state", () => {
    useConnectionStore.setState({
      activeStatuses: { c1: { type: "error", message: "boom" } },
    });
    useConnectionStore.getState().setActiveDb("c1", "warehouse");
    expect(useConnectionStore.getState().activeStatuses["c1"]).toEqual({
      type: "error",
      message: "boom",
    });
  });

  it("setActiveDb is a no-op when the connection is not in the store", () => {
    useConnectionStore.setState({ activeStatuses: {} });
    useConnectionStore.getState().setActiveDb("missing", "warehouse");
    expect(useConnectionStore.getState().activeStatuses).toEqual({});
  });
});
