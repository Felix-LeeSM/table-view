import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConnectionId, TabId } from "@/types/branded";
import {
  getTestWorkspace,
  seedWorkspace,
} from "@/stores/__tests__/workspaceStoreTestHelpers";
import { renderHook, act } from "@testing-library/react";
import { useConnectionStore } from "@stores/connectionStore";
import { useDataGridEditStore } from "@stores/dataGridEditStore";
import { makeEntryKey } from "@/test-utils/brandedKeys";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { hydrateConnectionSession } from "@lib/runtime/connection/hydrateConnectionSession";
import { useWindowFocusHydration } from "./useWindowFocusHydration";

// Mock scopedLocalStorage so hydrateConnectionSession's readConnectionSession
// dependency resolves without a real Tauri runtime.
const mockReadConnectionSession = vi.fn(
  (): {
    focusedConnId: string | null;
    activeStatuses: Record<string, unknown> | null;
    hasFocusedConnId?: boolean;
    hasActiveStatuses?: boolean;
  } => ({
    focusedConnId: null,
    activeStatuses: null,
  }),
);

vi.mock("@lib/scopedLocalStorage", () => ({
  persistFocusedConnId: vi.fn(),
  persistActiveStatuses: vi.fn(),
  readConnectionSession: () => mockReadConnectionSession(),
}));

// The hook calls the runtime `hydrateConnectionSession` entrypoint directly.
// Wrap the real implementation in a spy so call-count assertions still work
// while the store-mutation behaviour is preserved.
vi.mock("@lib/runtime/connection/hydrateConnectionSession", async () => {
  const actual = await vi.importActual<
    typeof import("@lib/runtime/connection/hydrateConnectionSession")
  >("@lib/runtime/connection/hydrateConnectionSession");
  return {
    ...actual,
    hydrateConnectionSession: vi.fn(actual.hydrateConnectionSession),
  };
});

// Mock the IPC bridge and window-label so connectionStore module loads cleanly.
vi.mock("@lib/zustand-ipc-bridge", () => ({
  attachZustandIpcBridge: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@lib/window-label", async () => {
  // sprint-366 (2026-05-16) — preserve the real parseWorkspaceLabel /
  // formatWorkspaceLabel exports so transitive imports of
  // `useCurrentWindowConnectionId` resolve.
  const actual =
    await vi.importActual<typeof import("@lib/window-label")>(
      "@lib/window-label",
    );
  return {
    ...actual,
    getCurrentWindowLabel: () => "test",
  };
});

// Mock localStorage for tab persistence
const localStorageStore: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem: (key: string) => localStorageStore[key] ?? null,
  setItem: (key: string, value: string) => {
    localStorageStore[key] = value;
  },
  removeItem: (key: string) => {
    delete localStorageStore[key];
  },
});

// Reason: verify useWindowFocusHydration's mount, focus, and edge-case behavior.
// Covers: rapid focus bursts, idempotency, stale listener cleanup, and session
// data propagation to the store. (2026-04-29)

describe("useWindowFocusHydration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({
      focusedConnId: null,
      activeStatuses: {},
    });
    useWorkspaceStore.setState({ workspaces: {} });
    useDataGridEditStore.setState({ entries: new Map() });
    mockReadConnectionSession.mockReturnValue({
      focusedConnId: null,
      activeStatuses: null,
      hasFocusedConnId: false,
      hasActiveStatuses: false,
    });
  });

  // -- Core behavior --

  // Reason: hydration on mount ensures the store has the latest session data
  // even if the IPC bridge event was missed while this window was hidden.
  it("calls hydrateFromSession on mount", () => {
    const spy = hydrateConnectionSession as ReturnType<typeof vi.fn>;
    spy.mockClear();
    const { unmount } = renderHook(() => useWindowFocusHydration());
    expect(spy).toHaveBeenCalledTimes(1);
    unmount();
  });

  // Reason: every focus event is a potential state-change signal from another
  // window; the hook must call hydrateFromSession each time without skipping.
  it("calls hydrateFromSession on each window focus event", () => {
    const spy = hydrateConnectionSession as ReturnType<typeof vi.fn>;
    const { unmount } = renderHook(() => useWindowFocusHydration());
    spy.mockClear();

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(spy).toHaveBeenCalledTimes(3);
    unmount();
  });

  // Reason: listener cleanup prevents stale hydration calls after the
  // component unmounts, avoiding memory leaks and phantom dispatches.
  it("removes the focus listener on unmount", () => {
    const spy = hydrateConnectionSession as ReturnType<typeof vi.fn>;
    const { unmount } = renderHook(() => useWindowFocusHydration());
    spy.mockClear();
    unmount();

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(spy).not.toHaveBeenCalled();
  });

  // -- Edge cases --

  // Reason: verify that hydration actually propagates session data to the store
  // — the end-to-end contract, not just the function call.
  it("propagates session data to the store after focus", () => {
    mockReadConnectionSession.mockReturnValue({
      focusedConnId: "conn-42",
      activeStatuses: { "conn-42": { type: "connected" } },
      hasFocusedConnId: true,
      hasActiveStatuses: true,
    });

    const { unmount } = renderHook(() => useWindowFocusHydration());

    // Mount already called hydrateFromSession — check store state.
    expect(useConnectionStore.getState().focusedConnId).toBe("conn-42");
    expect(useConnectionStore.getState().activeStatuses["conn-42"]).toEqual({
      type: "connected",
    });

    unmount();
  });

  // Reason: when session data changes between focus events (another window
  // wrote new data), the next focus must pick up the latest values.
  it("picks up updated session data on subsequent focus events", () => {
    mockReadConnectionSession.mockReturnValue({
      focusedConnId: "c1",
      activeStatuses: null,
      hasFocusedConnId: true,
      hasActiveStatuses: false,
    });
    const { unmount } = renderHook(() => useWindowFocusHydration());
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");

    // Simulate another window updating session data.
    mockReadConnectionSession.mockReturnValue({
      focusedConnId: "c2",
      activeStatuses: { c2: { type: "connected", activeDb: "mydb" } },
      hasFocusedConnId: true,
      hasActiveStatuses: true,
    });

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(useConnectionStore.getState().focusedConnId).toBe("c2");
    expect(useConnectionStore.getState().activeStatuses["c2"]).toEqual({
      type: "connected",
      activeDb: "mydb",
    });

    unmount();
  });

  // Reason: multiple hook instances (e.g. if two pages somehow both mount)
  // should each work independently without double-counting or interference.
  it("supports multiple independent hook instances", () => {
    const spy = hydrateConnectionSession as ReturnType<typeof vi.fn>;
    spy.mockClear();
    const { unmount: unmount1 } = renderHook(() => useWindowFocusHydration());
    const { unmount: unmount2 } = renderHook(() => useWindowFocusHydration());

    // 2 mounts = 2 hydrateFromSession calls
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockClear();

    // 1 focus event = 2 calls (one per listener)
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(spy).toHaveBeenCalledTimes(2);

    unmount1();
    unmount2();
  });

  // Reason: after unmount, a new mount should re-register and work correctly.
  it("re-registering after unmount works correctly", () => {
    const spy = hydrateConnectionSession as ReturnType<typeof vi.fn>;
    spy.mockClear();
    const { unmount: unmount1 } = renderHook(() => useWindowFocusHydration());
    expect(spy).toHaveBeenCalledTimes(1);
    unmount1();

    spy.mockClear();
    const { unmount: unmount2 } = renderHook(() => useWindowFocusHydration());
    expect(spy).toHaveBeenCalledTimes(1); // new mount = new hydrate call
    spy.mockClear();

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(spy).toHaveBeenCalledTimes(1);

    unmount2();
  });

  // -- Connection switch: this window's tabs survive focus hydration (#1098) --

  // Reason: sprint-361 gives every connection its own `workspace-{connId}`
  // window, so a workspace window only ever holds its own connection's tabs.
  // When the launcher moves focus to connection B while this workspace-A
  // window is hidden, a focus event hydrates `focusedConnId = B`. The old
  // pre-361 wipe would then treat A as "stale" and clear A's own tabs — the
  // #1098 data-loss bug. Focus hydration must never destroy this window's
  // workspace; teardown belongs to disconnect/remove (cleanup.ts).
  it("keeps this window's tabs when focusedConnId hydrates to a different connection (#1098)", () => {
    // Pre-condition: workspace-A window has a PG tab active
    useWorkspaceStore.setState(
      seedWorkspace(
        [
          {
            id: "tab-pg-1" as TabId,
            connectionId: "conn-pg" as ConnectionId,
            title: "public.users",
            type: "table",
            closable: true,
            schema: "public",
            table: "users",
            subView: "records",
            isPreview: false,
            paradigm: "rdb",
            sorts: [],
          },
        ],
        "tab-pg-1",
        "conn-pg",
        "db1",
      ),
    );

    // Launcher switched focus to a different connection (MongoDB) while this
    // workspace-A window was hidden. conn-pg stays connected in the shared
    // activeStatuses pool — only focusedConnId moved — so the connectionStore
    // teardown subscription must NOT fire for conn-pg. The only thing that
    // could wipe A here is the removed focus-hydration block.
    mockReadConnectionSession.mockReturnValue({
      focusedConnId: "conn-mongo",
      activeStatuses: {
        "conn-pg": { type: "connected" },
        "conn-mongo": { type: "connected" },
      },
      hasFocusedConnId: true,
      hasActiveStatuses: true,
    });

    renderHook(() => useWindowFocusHydration());

    // A's own PG tab must survive — no focus-driven wipe.
    const wsAfter = useWorkspaceStore.getState().workspaces;
    const tabs = Object.values(wsAfter).flatMap((byDb) =>
      Object.values(byDb).flatMap((ws) => ws.tabs),
    );
    expect(tabs.find((t) => t.connectionId === "conn-pg")).toBeDefined();
    // focusedConnId reflects the hydrated session value.
    expect(useConnectionStore.getState().focusedConnId).toBe("conn-mongo");
  });

  // Reason: hydration that does not change the connection should not destroy tabs.
  it("keeps tabs when focusedConnId stays the same after hydration", () => {
    useConnectionStore.setState({ focusedConnId: "conn-pg" });
    useWorkspaceStore.setState(
      seedWorkspace(
        [
          {
            id: "tab-pg-1" as TabId,
            connectionId: "conn-pg" as ConnectionId,
            title: "public.users",
            type: "table",
            closable: true,
            schema: "public",
            table: "users",
            subView: "records",
            isPreview: false,
            paradigm: "rdb",
            sorts: [],
          },
        ],
        "tab-pg-1",
        "conn-pg",
        "db1",
      ),
    );

    mockReadConnectionSession.mockReturnValue({
      focusedConnId: "conn-pg",
      activeStatuses: { "conn-pg": { type: "connected" } },
      hasFocusedConnId: true,
      hasActiveStatuses: true,
    });

    renderHook(() => useWindowFocusHydration());

    expect(getTestWorkspace("conn-pg").tabs).toHaveLength(1);
    expect(getTestWorkspace("conn-pg").tabs[0]!.connectionId).toBe("conn-pg");
  });

  // Reason: a subsequent focus event that hydrates a different focusedConnId
  // must also leave this window's tabs intact (#1098). This is the exact
  // regression path: workspace-A stays open, the launcher switches focus to B,
  // A regains focus and hydrates focusedConnId=B — A's tabs must not vanish.
  it("keeps this window's tabs when focusedConnId changes on a subsequent focus event (#1098)", () => {
    // First hydration: PG
    useConnectionStore.setState({ focusedConnId: "conn-pg" });
    useWorkspaceStore.setState(
      seedWorkspace(
        [
          {
            id: "tab-pg-1" as TabId,
            connectionId: "conn-pg" as ConnectionId,
            title: "public.users",
            type: "table",
            closable: true,
            schema: "public",
            table: "users",
            subView: "records",
            isPreview: false,
            paradigm: "rdb",
            sorts: [],
          },
        ],
        "tab-pg-1",
        "conn-pg",
        "db1",
      ),
    );

    mockReadConnectionSession.mockReturnValue({
      focusedConnId: "conn-pg",
      activeStatuses: { "conn-pg": { type: "connected" } },
      hasFocusedConnId: true,
      hasActiveStatuses: true,
    });

    const { unmount } = renderHook(() => useWindowFocusHydration());
    expect(getTestWorkspace("conn-pg", "db1").tabs).toHaveLength(1);

    // Now the launcher switches focus to Mongo while this workspace-A window
    // is hidden. conn-pg is still connected in activeStatuses (focus moved,
    // connection did not drop), so no teardown subscription fires for it.
    mockReadConnectionSession.mockReturnValue({
      focusedConnId: "conn-mongo",
      activeStatuses: {
        "conn-pg": { type: "connected" },
        "conn-mongo": { type: "connected" },
      },
      hasFocusedConnId: true,
      hasActiveStatuses: true,
    });

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    // A's PG tab survives the focus hydration; focusedConnId is Mongo.
    expect(getTestWorkspace("conn-pg", "db1").tabs).toHaveLength(1);
    expect(useConnectionStore.getState().focusedConnId).toBe("conn-mongo");

    unmount();
  });

  it("[RISK-040] clears stale hidden-window state from an explicit last-removal session mirror", () => {
    useConnectionStore.setState({
      focusedConnId: "c1",
      activeStatuses: { c1: { type: "connected" } },
    });
    useWorkspaceStore.setState(
      seedWorkspace(
        [
          {
            id: "tab-c1" as TabId,
            connectionId: "c1" as ConnectionId,
            title: "public.users",
            type: "table",
            closable: true,
            schema: "public",
            table: "users",
            subView: "records",
            isPreview: false,
            paradigm: "rdb",
            sorts: [],
          },
        ],
        "tab-c1",
        "c1",
        "db1",
      ),
    );
    const pendingKey = makeEntryKey("c1", "db1", "public", "users");
    useDataGridEditStore
      .getState()
      .setSlice(pendingKey, "pendingEdits", new Map([["0-1", "dirty"]]));
    mockReadConnectionSession.mockReturnValue({
      focusedConnId: null,
      activeStatuses: {},
      hasFocusedConnId: true,
      hasActiveStatuses: true,
    });

    renderHook(() => useWindowFocusHydration());

    expect(useConnectionStore.getState().focusedConnId).toBeNull();
    expect(useConnectionStore.getState().activeStatuses).toEqual({});
    expect(getTestWorkspace("c1", "db1").tabs).toHaveLength(0);
    expect(useDataGridEditStore.getState().entries.has(pendingKey)).toBe(false);
  });
});
