// #1077 admin-parity Stage 3 (2026-07-25) — guards the ops dashboard
// polling primitives: deterministic auto-refresh cadence, ring-buffer
// capacity clamp, and reset-on-connection-change.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAutoRefresh, useTrendBuffer } from "./opsPolling";

describe("useAutoRefresh", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("invokes the callback once per interval while enabled", () => {
    const cb = vi.fn();
    renderHook(() => useAutoRefresh(cb, 5000, true));

    expect(cb).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(5000));
    expect(cb).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(10000));
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("does not schedule anything while disabled", () => {
    const cb = vi.fn();
    renderHook(() => useAutoRefresh(cb, 5000, false));
    act(() => vi.advanceTimersByTime(20000));
    expect(cb).not.toHaveBeenCalled();
  });

  it("always calls the latest callback without restarting the timer", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ cb }: { cb: () => void }) => useAutoRefresh(cb, 5000, true),
      { initialProps: { cb: first } },
    );

    act(() => vi.advanceTimersByTime(2500));
    rerender({ cb: second });
    // Timer keeps its original phase; only the newest callback fires.
    act(() => vi.advanceTimersByTime(2500));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("useTrendBuffer", () => {
  it("appends samples and clamps to capacity", () => {
    const { result } = renderHook(() => useTrendBuffer(3, "conn-a"));

    act(() => result.current.push(1));
    act(() => result.current.push(2));
    act(() => result.current.push(3));
    expect(result.current.samples).toEqual([1, 2, 3]);

    act(() => result.current.push(4));
    expect(result.current.samples).toEqual([2, 3, 4]);
  });

  it("resets the buffer when the reset key changes", () => {
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useTrendBuffer(5, key),
      { initialProps: { key: "conn-a" } },
    );

    act(() => result.current.push(10));
    act(() => result.current.push(20));
    expect(result.current.samples).toEqual([10, 20]);

    rerender({ key: "conn-b" });
    expect(result.current.samples).toEqual([]);
  });
});
