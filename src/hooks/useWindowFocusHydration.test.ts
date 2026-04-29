import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useConnectionStore } from "@stores/connectionStore";
import { useWindowFocusHydration } from "./useWindowFocusHydration";

// Mock session-storage so hydrateFromSession's readConnectionSession
// dependency resolves without a real Tauri runtime.
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
  persistFocusedConnId: vi.fn(),
  persistActiveStatuses: vi.fn(),
  readConnectionSession: () => mockReadConnectionSession(),
}));

// Mock the IPC bridge and window-label so connectionStore module loads cleanly.
vi.mock("@lib/zustand-ipc-bridge", () => ({
  attachZustandIpcBridge: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@lib/window-label", () => ({
  getCurrentWindowLabel: () => "test",
}));

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
    mockReadConnectionSession.mockReturnValue({
      focusedConnId: null,
      activeStatuses: null,
    });
  });

  // -- Core behavior --

  // Reason: hydration on mount ensures the store has the latest session data
  // even if the IPC bridge event was missed while this window was hidden.
  it("calls hydrateFromSession on mount", () => {
    const spy = vi.spyOn(useConnectionStore.getState(), "hydrateFromSession");
    const { unmount } = renderHook(() => useWindowFocusHydration());
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    unmount();
  });

  // Reason: every focus event is a potential state-change signal from another
  // window; the hook must call hydrateFromSession each time without skipping.
  it("calls hydrateFromSession on each window focus event", () => {
    const spy = vi.spyOn(useConnectionStore.getState(), "hydrateFromSession");
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
    spy.mockRestore();
    unmount();
  });

  // Reason: listener cleanup prevents stale hydration calls after the
  // component unmounts, avoiding memory leaks and phantom dispatches.
  it("removes the focus listener on unmount", () => {
    const spy = vi.spyOn(useConnectionStore.getState(), "hydrateFromSession");
    const { unmount } = renderHook(() => useWindowFocusHydration());
    spy.mockClear();
    unmount();

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  // -- Edge cases --

  // Reason: rapid focus/blur bursts (e.g. Alt+Tab) should each trigger
  // hydration — no debounce. Each focus is a potential state-change signal.
  it("handles rapid consecutive focus events without skipping", () => {
    const spy = vi.spyOn(useConnectionStore.getState(), "hydrateFromSession");
    const { unmount } = renderHook(() => useWindowFocusHydration());
    spy.mockClear();

    // Simulate rapid Alt+Tab oscillation
    for (let i = 0; i < 10; i++) {
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
    }

    expect(spy).toHaveBeenCalledTimes(10);
    spy.mockRestore();
    unmount();
  });

  // Reason: hydrateFromSession is idempotent — calling it when session data
  // hasn't changed should not cause observable side effects or extra renders.
  it("hydrateFromSession is called even when session data is unchanged (idempotent path)", () => {
    const spy = vi.spyOn(useConnectionStore.getState(), "hydrateFromSession");
    const { unmount } = renderHook(() => useWindowFocusHydration());
    spy.mockClear();

    // No session data — hydrateFromSession is a no-op internally, but the
    // hook still calls it. This verifies the hook doesn't short-circuit.
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    unmount();
  });

  // Reason: verify that hydration actually propagates session data to the store
  // — the end-to-end contract, not just the function call.
  it("propagates session data to the store after focus", () => {
    mockReadConnectionSession.mockReturnValue({
      focusedConnId: "conn-42",
      activeStatuses: { "conn-42": { type: "connected" } },
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
    });
    const { unmount } = renderHook(() => useWindowFocusHydration());
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");

    // Simulate another window updating session data.
    mockReadConnectionSession.mockReturnValue({
      focusedConnId: "c2",
      activeStatuses: { c2: { type: "connected", activeDb: "mydb" } },
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
    const spy = vi.spyOn(useConnectionStore.getState(), "hydrateFromSession");
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
    spy.mockRestore();
  });

  // Reason: after unmount, a new mount should re-register and work correctly.
  it("re-registering after unmount works correctly", () => {
    const spy = vi.spyOn(useConnectionStore.getState(), "hydrateFromSession");
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
    spy.mockRestore();
  });
});
