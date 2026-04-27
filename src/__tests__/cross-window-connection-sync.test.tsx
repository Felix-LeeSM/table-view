/**
 * Sprint 152 — TDD-FIRST cross-window connection-store sync tests.
 *
 * Authored BEFORE `connectionStore.ts` is opted into `attachZustandIpcBridge`.
 * Against pre-Sprint-152 code, these cases fail because the store does not
 * yet broadcast on `connection-sync` and does not apply inbound payloads.
 *
 * Contract surface verified (AC-152-02):
 *  - (a) workspace mutation of `activeStatuses["c1"]` propagates to the
 *    launcher's view of the same store via the simulated event bus.
 *  - (b) launcher write of `focusedConnId` reaches the workspace.
 *  - (c) sensitive / transient keys (`error`, `loading`) are NOT broadcast in
 *    either direction. The store does not carry a top-level `password` field
 *    — connection passwords live nested inside `connections[i].password`
 *    which is itself never sync-allowlisted at the top level (the whole
 *    `connections` blob is — see contract). The transient-flag check pins
 *    the broader contract that loading/error/UI flags stay window-local.
 *  - (d) AC-141-3 invariant: a workspace-side "Back to connections" signal
 *    (modeled as the workspace silently re-asserting `activeStatuses` /
 *    `focusedConnId` for the same connection — what Sprint 154 will tie to
 *    the real `WebviewWindow.show()/hide()`) leaves the launcher's view of
 *    `activeStatuses["c1"].type === "connected"` AND does NOT call
 *    `disconnectFromDatabase` on either side.
 *  - (e) error path: a malformed inbound payload (missing `state`, wrong
 *    shape, only non-allowlisted keys) does NOT throw and does NOT pollute
 *    store state.
 *
 * Pattern matches `src/lib/zustand-ipc-bridge.test.ts`: a module-scoped
 * Map-based event bus replaces `@tauri-apps/api/event` so two stores in the
 * same test process see each other.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";

// ---------------------------------------------------------------------------
// Shared in-process event bus mock for `@tauri-apps/api/event`.
//
// Hoisted via `vi.hoisted` so the bus map exists BEFORE the connectionStore
// module's load-time `attachZustandIpcBridge()` call (which immediately calls
// `listen()` through the mocked `@tauri-apps/api/event` adapter). Without
// hoisting, the bus would still be `undefined` when the bridge registers and
// the inbound-apply tests would silently pass against a no-op listener.
// ---------------------------------------------------------------------------

interface BusEnvelope {
  event: string;
  payload: unknown;
}

const busModule = vi.hoisted(() => {
  const bus = new Map<string, Set<(env: BusEnvelope) => void>>();
  return {
    bus,
    emit: vi.fn(async (event: string, payload?: unknown) => {
      const listeners = bus.get(event);
      if (!listeners) return;
      for (const listener of [...listeners]) {
        listener({ event, payload });
      }
    }),
    listen: vi.fn(async (event: string, handler: (e: BusEnvelope) => void) => {
      let set = bus.get(event);
      if (!set) {
        set = new Set<(env: BusEnvelope) => void>();
        bus.set(event, set);
      }
      set.add(handler);
      return () => {
        set?.delete(handler);
      };
    }),
  };
});

function busEmit(event: string, payload: unknown): void {
  const listeners = busModule.bus.get(event);
  if (!listeners) return;
  for (const listener of [...listeners]) {
    listener({ event, payload });
  }
}

vi.mock("@tauri-apps/api/event", () => ({
  emit: busModule.emit,
  listen: busModule.listen,
}));

// Mock the Tauri invoke wrapper so the bridge attach inside connectionStore
// does not try to call real backend commands during module import.
vi.mock("@lib/tauri", () => ({
  listConnections: vi.fn(() => Promise.resolve([])),
  listGroups: vi.fn(() => Promise.resolve([])),
  saveConnection: vi.fn((conn: unknown, isNew: boolean) =>
    Promise.resolve(isNew ? { ...(conn as object), id: "new-id" } : conn),
  ),
  deleteConnection: vi.fn(() => Promise.resolve()),
  testConnection: vi.fn(() => Promise.resolve("ok")),
  connectToDatabase: vi.fn(() => Promise.resolve()),
  disconnectFromDatabase: vi.fn(() => Promise.resolve()),
  saveGroup: vi.fn((group: unknown, isNew: boolean) =>
    Promise.resolve(isNew ? { ...(group as object), id: "new-gid" } : group),
  ),
  deleteGroup: vi.fn(() => Promise.resolve()),
  moveConnectionToGroup: vi.fn(() => Promise.resolve()),
}));

// Mock the window-label resolver so the bridge gets a deterministic origin id
// in the test process. The store falls back to "test" when the label is
// null, and individual scenarios can override via `mockReturnValueOnce` on
// the exported mock if needed. The default returns `"launcher"` so the
// store's bridge attach uses that as its origin id at module-load time.
vi.mock("@lib/window-label", () => ({
  getCurrentWindowLabel: vi.fn(() => "launcher"),
}));

// Import AFTER all mocks are registered.
import { emit, listen } from "@tauri-apps/api/event";
import { useConnectionStore } from "@stores/connectionStore";
import * as tauri from "@lib/tauri";
import type { ConnectionConfig, ConnectionStatus } from "@/types/connection";

const mockedEmit = emit as unknown as Mock;
const mockedListen = listen as unknown as Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConn(id: string, name = `${id} DB`): ConnectionConfig {
  return {
    id,
    name,
    db_type: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    has_password: false,
    database: "test",
    group_id: null,
    color: null,
    paradigm: "rdb",
  };
}

/**
 * Simulate a remote window emitting the given allowlisted slice on the
 * `connection-sync` channel. Mirrors what Sprint 151's bridge ships on the
 * wire: `{ origin, state }` envelope.
 */
function simulateRemoteEmit(
  origin: string,
  state: Record<string, unknown>,
): void {
  busEmit("connection-sync", { origin, state });
}

function resetStore(): void {
  useConnectionStore.setState({
    connections: [],
    groups: [],
    activeStatuses: {},
    focusedConnId: null,
    loading: false,
    error: null,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cross-window connection-store sync (Sprint 152)", () => {
  // NOTE: we deliberately do NOT call `busReset()` here. The bridge is
  // attached at module-load time inside `connectionStore.ts`, so its `listen`
  // registered exactly one entry in the in-process bus. Wiping the bus would
  // unregister that entry and the inbound-apply scenarios below would silently
  // pass against a no-op listener instead of the real bridge.
  beforeEach(async () => {
    resetStore();
    // The bridge's `listen()` registration is async; drain microtasks so the
    // listener is guaranteed to be in the bus before any test fires events.
    // (The store's module-load `void attach...` site doesn't await, so we do
    // it here as the test-side equivalent.)
    await Promise.resolve();
    await Promise.resolve();
    mockedEmit.mockClear();
    mockedListen.mockClear();
    (tauri.disconnectFromDatabase as Mock).mockClear();
  });

  afterEach(() => {
    resetStore();
  });

  // (a) workspace mutation propagates to the launcher's store view.
  it("AC-152-02a: a workspace-side mutation of activeStatuses['c1'] propagates to the launcher store", async () => {
    // Pre-condition: launcher store has c1 listed but not yet connected.
    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "disconnected" } },
    });

    // Simulate the workspace window broadcasting that c1 is now connected.
    simulateRemoteEmit("workspace", {
      activeStatuses: { c1: { type: "connected" } satisfies ConnectionStatus },
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(useConnectionStore.getState().activeStatuses["c1"]).toEqual({
      type: "connected",
    });
  });

  // (b) launcher write of focusedConnId reaches the workspace.
  it("AC-152-02b: a launcher-side write to focusedConnId emits on the connection-sync channel", async () => {
    useConnectionStore.setState({
      connections: [makeConn("c1")],
    });
    // Clear any emits from the seed setState above so we look at the new
    // setFocusedConn() emission specifically.
    mockedEmit.mockClear();

    useConnectionStore.getState().setFocusedConn("c1");
    await Promise.resolve();

    // The bridge must have emitted a payload that includes focusedConnId.
    expect(mockedEmit).toHaveBeenCalled();
    const channels = mockedEmit.mock.calls.map((call) => call[0]);
    expect(channels).toContain("connection-sync");

    const syncCall = mockedEmit.mock.calls.find(
      (call) => call[0] === "connection-sync",
    );
    expect(syncCall).toBeDefined();
    const payload = syncCall![1] as {
      origin: string;
      state: Record<string, unknown>;
    };
    expect(payload.state).toMatchObject({ focusedConnId: "c1" });
    // Origin id reflects the current window label.
    expect(payload.origin).toBe("launcher");
  });

  // (c-1) sensitive/transient `loading` flag is NOT broadcast outbound.
  it("AC-152-02c-out: setting `loading` on the store does NOT emit on the sync channel (window-local flag)", async () => {
    useConnectionStore.setState({ loading: true });
    await Promise.resolve();

    const syncCall = mockedEmit.mock.calls.find(
      (call) => call[0] === "connection-sync",
    );
    expect(syncCall).toBeUndefined();
  });

  // (c-2) sensitive/transient inbound key is NOT applied (defense in depth).
  it("AC-152-02c-in: an inbound payload carrying only `loading` / `error` is NOT applied locally", async () => {
    simulateRemoteEmit("workspace", { loading: true, error: "leaked" });
    await Promise.resolve();

    expect(useConnectionStore.getState().loading).toBe(false);
    expect(useConnectionStore.getState().error).toBeNull();
  });

  // (c-3) outbound writes that mix sensitive + sync-safe keys only carry the slice.
  it("AC-152-02c-mix: a mixed write only broadcasts the allowlisted slice (loading/error stay local)", async () => {
    mockedEmit.mockClear();
    useConnectionStore.setState({
      activeStatuses: { c1: { type: "connected" } },
      loading: true,
      error: "boom",
    });
    await Promise.resolve();

    const syncCall = mockedEmit.mock.calls.find(
      (call) => call[0] === "connection-sync",
    );
    expect(syncCall).toBeDefined();
    const payload = syncCall![1] as {
      origin: string;
      state: Record<string, unknown>;
    };
    expect(payload.state).not.toHaveProperty("loading");
    expect(payload.state).not.toHaveProperty("error");
    expect(payload.state).toHaveProperty("activeStatuses");
    expect(payload.state).toHaveProperty("focusedConnId");
    expect(payload.state).toHaveProperty("connections");
    expect(payload.state).toHaveProperty("groups");
    // Exactly the four allowlisted keys, nothing more.
    expect(Object.keys(payload.state).sort()).toEqual([
      "activeStatuses",
      "connections",
      "focusedConnId",
      "groups",
    ]);
  });

  // (d) AC-141-3: workspace's "Back to connections" signal preserves connected pool.
  it("AC-152-02d (AC-141-3): workspace re-asserting `activeStatuses['c1'] = connected` does NOT call disconnectFromDatabase on the launcher", async () => {
    // Launcher view: c1 is currently connected.
    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
    });

    // Workspace fires its "Back to connections" signal — modeled here as the
    // workspace re-broadcasting its current view of the connection (still
    // connected). Sprint 154 will tie this to the real lifecycle; the
    // invariant is that NO disconnect occurs on either side.
    simulateRemoteEmit("workspace", {
      activeStatuses: { c1: { type: "connected" } satisfies ConnectionStatus },
      focusedConnId: "c1",
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(useConnectionStore.getState().activeStatuses["c1"]).toEqual({
      type: "connected",
    });
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
    expect(tauri.disconnectFromDatabase as Mock).not.toHaveBeenCalled();
  });

  // (e-1) malformed inbound payload — missing state.
  it("AC-152-02e: a malformed inbound payload (missing `state`) does NOT throw and does NOT pollute store state", async () => {
    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
    });

    expect(() => {
      simulateRemoteEmit("workspace", {} as unknown as Record<string, unknown>);
      busEmit("connection-sync", null);
      busEmit("connection-sync", "not-an-object");
      busEmit("connection-sync", { origin: "workspace" });
      busEmit("connection-sync", { origin: "workspace", state: "string" });
      busEmit("connection-sync", { origin: "workspace", state: null });
    }).not.toThrow();

    await Promise.resolve();

    // Store state untouched.
    const s = useConnectionStore.getState();
    expect(s.connections).toHaveLength(1);
    expect(s.activeStatuses["c1"]).toEqual({ type: "connected" });
    expect(s.focusedConnId).toBe("c1");
    expect(s.error).toBeNull();
  });

  // (e-2) inbound state that ONLY contains non-allowlisted keys is dropped.
  it("AC-152-02e': an inbound payload with only non-allowlisted keys is silently ignored", async () => {
    useConnectionStore.setState({ loading: false, error: null });

    simulateRemoteEmit("workspace", {
      unknownKey: 42,
      privateField: "secret",
    });
    await Promise.resolve();

    expect(useConnectionStore.getState().loading).toBe(false);
    expect(useConnectionStore.getState().error).toBeNull();
  });

  // (extra) self-origin echo is dropped — no double-application loop.
  it("AC-152-02f: an inbound payload tagged with the local origin (launcher) is dropped (self-loop guard)", async () => {
    useConnectionStore.setState({
      activeStatuses: { c1: { type: "connected" } },
    });

    simulateRemoteEmit("launcher", {
      activeStatuses: {
        c1: { type: "disconnected" } satisfies ConnectionStatus,
      },
    });
    await Promise.resolve();

    // Launcher's own origin id, so the inbound apply must be skipped.
    expect(useConnectionStore.getState().activeStatuses["c1"]).toEqual({
      type: "connected",
    });
  });
});
