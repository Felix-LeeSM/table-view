// AC-193-01 — unit tests for the `useCommitFlash` sub-hook. The commit flash
// (shown right after Cmd+S, with a 400ms safety net) moved out of the
// useDataGridEdit facade into this hook, and these tests assert that
// responsibility directly. `useDataGridEdit.commit-flash.test.ts` keeps the
// integration assertions, while this file pins the hook's branches (initial /
// synchronous set / safety expiry / cancel on consecutive calls) at the hook
// level.
// date 2026-05-02.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCommitFlash } from "./useCommitFlash";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useCommitFlash", () => {
  // [AC-193-01-1] isCommitFlashing starts false. Baseline assertion that the
  // toolbar shows no spinner at rest.
  // date 2026-05-02
  it("[AC-193-01-1] initial isCommitFlashing is false", () => {
    const { result } = renderHook(() => useCommitFlash());
    expect(result.current.isCommitFlashing).toBe(false);
  });

  // [AC-193-01-2] beginCommitFlash() flips to true synchronously. To fit
  // the 200ms visual-feedback budget, no setTimeout/promise tick may come
  // in between.
  // date 2026-05-02
  it("[AC-193-01-2] beginCommitFlash flips to true synchronously", () => {
    const { result } = renderHook(() => useCommitFlash());
    act(() => {
      result.current.beginCommitFlash();
    });
    expect(result.current.isCommitFlashing).toBe(true);
  });

  // [AC-193-01-3] Auto-clears to false after 400ms. A safety net that keeps
  // the spinner from getting stuck on paths where no explicit clear arrives
  // via preview/error (validation-only no-op, etc.).
  // date 2026-05-02
  it("[AC-193-01-3] auto-clears to false after 400ms safety timeout", () => {
    const { result } = renderHook(() => useCommitFlash());
    act(() => {
      result.current.beginCommitFlash();
    });
    expect(result.current.isCommitFlashing).toBe(true);

    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(result.current.isCommitFlashing).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.isCommitFlashing).toBe(false);
  });

  // [AC-193-01-4] Consecutive beginCommitFlash() calls cancel the previous
  // timer, so only the last call's 400ms is active. Guards against a
  // regression where, when the user attempts two quick commits, the first
  // timer ends the second flash early.
  // date 2026-05-02
  it("[AC-193-01-4] consecutive begin calls reset the safety timer", () => {
    const { result } = renderHook(() => useCommitFlash());
    act(() => {
      result.current.beginCommitFlash();
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    // Second call — the first call's remaining 100ms timer must be voided.
    act(() => {
      result.current.beginCommitFlash();
    });
    // 400ms have passed since the first call but only 100ms since the
    // second, so it must still be true.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.isCommitFlashing).toBe(true);
    // It turns false only once 400ms have passed since the second call.
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.isCommitFlashing).toBe(false);
  });

  // [AC-193-01-5] clearCommitFlash() is the escape hatch the facade calls
  // on an external terminal signal (a preview opened or a commit error
  // surfaced). It flips to false synchronously and also drains the
  // remaining safety timer (a later timer expiry setting false again would
  // be harmless).
  // date 2026-05-02
  it("[AC-193-01-5] clearCommitFlash drops to false and drains pending timer", () => {
    const { result } = renderHook(() => useCommitFlash());
    act(() => {
      result.current.beginCommitFlash();
    });
    expect(result.current.isCommitFlashing).toBe(true);

    act(() => {
      result.current.clearCommitFlash();
    });
    expect(result.current.isCommitFlashing).toBe(false);

    // Check that the safety timer was drained — no extra set may happen
    // after 400ms (the value staying false is OK).
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.isCommitFlashing).toBe(false);
  });
});
