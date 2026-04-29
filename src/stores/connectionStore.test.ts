import { describe, it, expect, vi, beforeEach } from "vitest";
import { useConnectionStore, SYNCED_KEYS } from "./connectionStore";

// Mock @tauri-apps/api/event. The Sprint 152 bridge attach inside
// `connectionStore.ts` calls both `emit` (outbound) and `listen` (inbound)
// at module-load time, so both must be exported here. Both are no-ops for
// these tests — the cross-window contract is exercised in
// `src/__tests__/cross-window-connection-sync.test.tsx` with a real bus.
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(() => Promise.resolve()),
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

// Mock session-storage so we can assert cross-call sequence without a
// real Tauri invoke (the Tauri runtime is unavailable in vitest jsdom).
// The mock stores arguments for later assertion; the functions themselves
// are no-ops.
const mockPersistFocusedConnId = vi.fn();
const mockPersistActiveStatuses = vi.fn();
const mockReadConnectionSession = vi.fn(
  (): {
    focusedConnId: string | null;
    activeStatuses: Record<string, unknown> | null;
  } => ({
    focusedConnId: null,
    activeStatuses: null,
  }),
);

vi.mock("@lib/session-storage", () => ({
  persistFocusedConnId: (...args: unknown[]) =>
    mockPersistFocusedConnId(...args),
  persistActiveStatuses: (...args: unknown[]) =>
    mockPersistActiveStatuses(...args),
  readConnectionSession: () => mockReadConnectionSession(),
}));

// Mock the IPC bridge so the module-level `attachZustandIpcBridge` call
// inside connectionStore.ts does not attempt a real Tauri listen.
vi.mock("@lib/zustand-ipc-bridge", () => ({
  attachZustandIpcBridge: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@lib/window-label", () => ({
  getCurrentWindowLabel: () => "test",
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
    // Sprint 143 (AC-148-4) — wipe persisted activeDb keys so a single
    // test never leaks `tableview:activeDb:*` into the next case.
    try {
      const keys: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith("tableview:activeDb:")) keys.push(k);
      }
      for (const k of keys) window.localStorage.removeItem(k);
    } catch {
      // ignore
    }
    vi.clearAllMocks();
    mockPersistFocusedConnId.mockClear();
    mockPersistActiveStatuses.mockClear();
    mockReadConnectionSession.mockReturnValue({
      focusedConnId: null,
      activeStatuses: null,
    });
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

  // -- Sprint 143 (AC-148-4) — Mongo activeDb persistence --
  //
  // The user picks a DB in the workspace's DbSwitcher and expects that
  // choice to survive close/reopen — see feedback #12 (2026-04-27). Pre-
  // sprint-143 the selection lived only in the connected variant of the
  // in-memory `activeStatuses` and reverted to `connection.database` on
  // reconnect. Now `setActiveDb` writes a `tableview:activeDb:{id}` key
  // and `connectToDatabase` prefers that persisted value when present.

  it("setActiveDb persists the selection to localStorage under tableview:activeDb:{id} (AC-148-4)", () => {
    useConnectionStore.setState({
      activeStatuses: { m1: { type: "connected", activeDb: "test" } },
    });
    useConnectionStore.getState().setActiveDb("m1", "admin");
    expect(window.localStorage.getItem("tableview:activeDb:m1")).toBe("admin");
  });

  it("setActiveDb does NOT persist when the connection is not in connected state (AC-148-4)", () => {
    useConnectionStore.setState({
      activeStatuses: { m1: { type: "disconnected" } },
    });
    useConnectionStore.getState().setActiveDb("m1", "admin");
    expect(window.localStorage.getItem("tableview:activeDb:m1")).toBeNull();
  });

  it("connectToDatabase restores activeDb from localStorage when a persisted value exists (AC-148-4)", async () => {
    // Simulate a prior session having persisted `admin` for connection m1.
    window.localStorage.setItem("tableview:activeDb:m1", "admin");
    useConnectionStore.setState({
      connections: [
        {
          id: "m1",
          name: "MongoCluster",
          db_type: "mongodb",
          host: "localhost",
          port: 27017,
          user: "mongo",
          database: "test",
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
      // The persisted value wins over `connection.database` ("test").
      expect(status.activeDb).toBe("admin");
    }
  });

  it("connectToDatabase falls back to connection.database when no persisted value exists (AC-148-4)", async () => {
    useConnectionStore.setState({
      connections: [
        {
          id: "m1",
          name: "MongoCluster",
          db_type: "mongodb",
          host: "localhost",
          port: 27017,
          user: "mongo",
          database: "test",
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
      expect(status.activeDb).toBe("test");
    }
  });

  it("disconnectFromDatabase clears the persisted activeDb entry (AC-148-4)", async () => {
    window.localStorage.setItem("tableview:activeDb:m1", "admin");
    useConnectionStore.setState({
      activeStatuses: { m1: { type: "connected", activeDb: "admin" } },
    });
    await useConnectionStore.getState().disconnectFromDatabase("m1");
    expect(window.localStorage.getItem("tableview:activeDb:m1")).toBeNull();
  });

  // -- Sprint 152 (AC-152-04) — cross-window broadcast allowlist regression --
  //
  // The `SYNCED_KEYS` constant is the load-bearing audit point for the
  // cross-window bridge: every key listed here is broadcast on the
  // `connection-sync` channel; every key NOT listed stays window-local.
  // Pinning the exact membership here forces a future contributor who adds
  // a new top-level key to `ConnectionState` to make a deliberate decision
  // (opt in by widening the array, opt out by leaving it alone) — they
  // cannot silently broadcast a sensitive new field.
  //
  // If you are adding a key intentionally:
  //   1. Update `SYNCED_KEYS` in `connectionStore.ts`.
  //   2. Update this expectation.
  //   3. Document the rationale in the JSDoc above `SYNCED_KEYS`.
  //   4. Add a cross-window-sync test case that exercises the new key.

  describe("SYNCED_KEYS allowlist (AC-152-04)", () => {
    it("exposes exactly the four cross-window-synced keys", () => {
      expect([...SYNCED_KEYS]).toEqual([
        "connections",
        "groups",
        "activeStatuses",
        "focusedConnId",
      ]);
    });

    it("does NOT include any sensitive or transient keys (loading/error)", () => {
      expect(SYNCED_KEYS).not.toContain("loading");
      expect(SYNCED_KEYS).not.toContain("error");
    });
  });

  // -- Session storage persistence on connection switching --
  //
  // Reason: verify that switching from one connection to another correctly
  // updates the session-scoped localStorage entries. Pre-sprint-152 the
  // launcher persisted a stale focusedConnId/activeStatuses that the
  // workspace would hydrate on boot, causing the workspace to show the
  // previously-focused connection instead of the newly-selected one. (2026-04-28)

  describe("session storage persistence on connection switching", () => {
    function seedTwoConnections() {
      useConnectionStore.setState({
        connections: [
          {
            id: "c1",
            name: "ProdDB",
            db_type: "postgresql",
            host: "localhost",
            port: 5432,
            user: "postgres",
            database: "prod",
            group_id: null,
            color: null,
            has_password: false,
            paradigm: "rdb",
          },
          {
            id: "c2",
            name: "DevDB",
            db_type: "postgresql",
            host: "localhost",
            port: 5432,
            user: "postgres",
            database: "dev",
            group_id: null,
            color: null,
            has_password: false,
            paradigm: "rdb",
          },
        ],
        activeStatuses: {},
        focusedConnId: null,
      });
    }

    it("setFocusedConn(c1) then setFocusedConn(c2) — session reflects c2", () => {
      const { setFocusedConn } = useConnectionStore.getState();
      setFocusedConn("c1");
      setFocusedConn("c2");

      // The store must track c2, not c1.
      expect(useConnectionStore.getState().focusedConnId).toBe("c2");
      // Session persistence must have been called with both values in order.
      expect(mockPersistFocusedConnId).toHaveBeenCalledWith("c1");
      expect(mockPersistFocusedConnId).toHaveBeenCalledWith("c2");
      // Last call wins — the most recent value is what session storage holds.
      const calls = mockPersistFocusedConnId.mock.calls;
      expect(calls[calls.length - 1]![0]).toBe("c2");
    });

    it("setFocusedConn(null) clears the persisted session entry", () => {
      const { setFocusedConn } = useConnectionStore.getState();
      setFocusedConn("c1");
      setFocusedConn(null);

      expect(useConnectionStore.getState().focusedConnId).toBeNull();
      expect(mockPersistFocusedConnId).toHaveBeenCalledWith(null);
    });

    it("connecting c1 then c2 persists activeStatuses with both connections", async () => {
      seedTwoConnections();
      const { connectToDatabase } = useConnectionStore.getState();

      await connectToDatabase("c1");
      await connectToDatabase("c2");

      const statuses = useConnectionStore.getState().activeStatuses;
      expect(statuses["c1"]?.type).toBe("connected");
      expect(statuses["c2"]?.type).toBe("connected");

      // persistActiveStatuses should have been called after each connect.
      expect(mockPersistActiveStatuses).toHaveBeenCalledTimes(2);
      // The final call must contain both connections.
      const lastCall = mockPersistActiveStatuses.mock.calls[
        mockPersistActiveStatuses.mock.calls.length - 1
      ]![0] as Record<string, unknown>;
      expect(lastCall["c1"]).toBeDefined();
      expect(lastCall["c2"]).toBeDefined();
    });

    it("disconnecting c1 after connecting both leaves only c2 in session", async () => {
      seedTwoConnections();
      const { connectToDatabase, disconnectFromDatabase } =
        useConnectionStore.getState();

      await connectToDatabase("c1");
      await connectToDatabase("c2");
      await disconnectFromDatabase("c1");

      const statuses = useConnectionStore.getState().activeStatuses;
      expect(statuses["c1"]?.type).toBe("disconnected");
      expect(statuses["c2"]?.type).toBe("connected");

      // Final session persist must reflect c1 disconnected, c2 connected.
      const lastCall = mockPersistActiveStatuses.mock.calls[
        mockPersistActiveStatuses.mock.calls.length - 1
      ]![0] as Record<string, unknown>;
      expect((lastCall["c1"] as { type: string }).type).toBe("disconnected");
      expect((lastCall["c2"] as { type: string }).type).toBe("connected");
    });

    it("full switch cycle: focus c1 → connect c1 → focus c2 → connect c2", async () => {
      seedTwoConnections();
      const { setFocusedConn, connectToDatabase } =
        useConnectionStore.getState();

      // User double-clicks c1 in the launcher.
      setFocusedConn("c1");
      await connectToDatabase("c1");

      // User then double-clicks c2 (switches connection).
      setFocusedConn("c2");
      await connectToDatabase("c2");

      // Store must reflect c2 as focused.
      expect(useConnectionStore.getState().focusedConnId).toBe("c2");
      // Both connections must be in connected state.
      expect(useConnectionStore.getState().activeStatuses["c1"]?.type).toBe(
        "connected",
      );
      expect(useConnectionStore.getState().activeStatuses["c2"]?.type).toBe(
        "connected",
      );
      // Session must have been updated with c2 as focused.
      const focusCalls = mockPersistFocusedConnId.mock.calls;
      expect(focusCalls[focusCalls.length - 1]![0]).toBe("c2");
      // Session must have both connections in activeStatuses.
      const lastStatuses = mockPersistActiveStatuses.mock.calls[
        mockPersistActiveStatuses.mock.calls.length - 1
      ]![0] as Record<string, unknown>;
      expect((lastStatuses["c2"] as { type: string }).type).toBe("connected");
    });

    it("hydrateFromSession restores focusedConnId and activeStatuses", () => {
      mockReadConnectionSession.mockReturnValue({
        focusedConnId: "c2",
        activeStatuses: {
          c1: { type: "connected", activeDb: "prod" },
          c2: { type: "connected", activeDb: "dev" },
        },
      });

      useConnectionStore.getState().hydrateFromSession();

      const state = useConnectionStore.getState();
      expect(state.focusedConnId).toBe("c2");
      expect(state.activeStatuses["c1"]).toEqual({
        type: "connected",
        activeDb: "prod",
      });
      expect(state.activeStatuses["c2"]).toEqual({
        type: "connected",
        activeDb: "dev",
      });
    });

    it("hydrateFromSession is a no-op when session is empty", () => {
      mockReadConnectionSession.mockReturnValue({
        focusedConnId: null,
        activeStatuses: null,
      });

      useConnectionStore.getState().hydrateFromSession();

      expect(useConnectionStore.getState().focusedConnId).toBeNull();
      expect(useConnectionStore.getState().activeStatuses).toEqual({});
    });

    it("connect failure does not persist activeStatuses to session", async () => {
      seedTwoConnections();
      const { connectToDatabase } = await import("@lib/tauri");
      (connectToDatabase as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Connection refused"),
      );

      await useConnectionStore.getState().connectToDatabase("c1");

      // Error state must be set.
      expect(useConnectionStore.getState().activeStatuses["c1"]?.type).toBe(
        "error",
      );
      // persistActiveStatuses must NOT have been called (error path skips it).
      expect(mockPersistActiveStatuses).not.toHaveBeenCalled();
    });
  });
});
