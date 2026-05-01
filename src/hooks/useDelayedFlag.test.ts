/**
 * Reason: Sprint-180 (AC-180-01) — the threshold gate that powers the
 * shared `AsyncProgressOverlay`. Validates Doherty (1s threshold) and the
 * synchronous-reset invariant so rapid cancel→retry cycles don't leak
 * timers or paint a stale "true" after the source op resolves.
 *
 * Date: 2026-04-30
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDelayedFlag } from "./useDelayedFlag";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDelayedFlag", () => {
  // [AC-180-01c] returns false before the delay elapses — the load-bearing
  // sub-second guarantee. If this regresses, fast fetches paint an overlay
  // flicker.
  // Date: 2026-04-30
  it("[AC-180-01c] returns false before delay elapsed", () => {
    const { result } = renderHook(() => useDelayedFlag(true, 1000));
    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toBe(false);
  });

  // [AC-180-01d] returns true after the delay elapses — the overlay
  // materialises post-1s.
  // Date: 2026-04-30
  it("[AC-180-01d] returns true after delay elapsed", () => {
    const { result } = renderHook(() => useDelayedFlag(true, 1000));

    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(result.current).toBe(true);
  });

  // [AC-180-01e] resets to false synchronously when active toggles to
  // false. This is what guarantees a cancel→retry cycle re-arms the
  // threshold rather than carrying the previous "true" forward.
  // Date: 2026-04-30
  it("[AC-180-01e] resets to false synchronously when active toggles to false", () => {
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useDelayedFlag(active, 1000),
      { initialProps: { active: true } },
    );

    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(result.current).toBe(true);

    // Now toggle off — the hook must drop to false on the next render
    // without waiting for the timer.
    rerender({ active: false });
    expect(result.current).toBe(false);
  });

  // Edge case: rapid on/off cycles before threshold should never paint
  // a true value. This guards AC-180-05 (cancel→retry) at the hook level —
  // the production cancel handler clears the parent loading flag inside
  // a single frame, and we must never observe a transient `true`.
  // Date: 2026-04-30
  it("never reaches true if active toggles off before delay", () => {
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useDelayedFlag(active, 1000),
      { initialProps: { active: true } },
    );

    act(() => {
      vi.advanceTimersByTime(500);
    });
    rerender({ active: false });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current).toBe(false);
  });

  // Edge case: re-arming after a complete cycle. Guards a regression
  // where a stale module-scoped timer leaked between cycles. The hook
  // owns its timer in the `useEffect` cleanup, so a new active=true
  // schedules a fresh timeout each time.
  // Date: 2026-04-30
  it("re-arms after a full off→on cycle", () => {
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useDelayedFlag(active, 1000),
      { initialProps: { active: true } },
    );

    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(result.current).toBe(true);

    rerender({ active: false });
    expect(result.current).toBe(false);

    rerender({ active: true });
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(result.current).toBe(true);
  });
});
