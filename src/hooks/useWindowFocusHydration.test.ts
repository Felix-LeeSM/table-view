import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useConnectionStore } from "@stores/connectionStore";
import { useWindowFocusHydration } from "./useWindowFocusHydration";

// Reason: verify that useWindowFocusHydration calls hydrateFromSession on
// mount and when the window gains focus, ensuring cross-window state stays
// in sync even when IPC bridge events are missed while a window is hidden.
// (2026-04-29)

describe("useWindowFocusHydration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls hydrateFromSession on mount", () => {
    const spy = vi.spyOn(useConnectionStore.getState(), "hydrateFromSession");
    const { unmount } = renderHook(() => useWindowFocusHydration());
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    unmount();
  });

  it("calls hydrateFromSession on window focus", () => {
    const spy = vi.spyOn(useConnectionStore.getState(), "hydrateFromSession");
    const { unmount } = renderHook(() => useWindowFocusHydration());
    spy.mockClear();

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    unmount();
  });

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
});
