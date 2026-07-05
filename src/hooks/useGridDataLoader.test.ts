import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  type GridDataLoaderRunContext,
  useGridDataLoader,
} from "./useGridDataLoader";

// #1359 — the shared grid loader owns the stale-response guard and the
// two-step (cooperative -> native) cancel that rdb/document browses reuse.
// These lock the contract the extraction preserved: a superseded browse
// never ghost-writes, and cancel fires the cooperative token before native.

/** A promise the test releases on demand so the browse stays in-flight. */
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((r) => {
    release = r;
  });
  return { promise, release };
}

describe("useGridDataLoader (#1359)", () => {
  const cancelQuery = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    setupTauriMock({ cancelQuery: (...a: unknown[]) => cancelQuery(...a) });
    cancelQuery.mockResolvedValue("cancelled");
  });

  it("drops a stale runQuery resolve after cancel (no ghost write)", async () => {
    const g = gate();
    const onLiveWrite = vi.fn();
    const runQuery = vi.fn(async ({ isStale }: GridDataLoaderRunContext) => {
      await g.promise;
      if (!isStale()) onLiveWrite();
    });
    const cancelNative = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useGridDataLoader({ runQuery, cancelNative }),
    );

    await waitFor(() => expect(runQuery).toHaveBeenCalled());
    expect(result.current.loading).toBe(true);

    act(() => {
      result.current.handleCancelRefetch();
    });
    // Cancel clears loading synchronously.
    expect(result.current.loading).toBe(false);

    // The cancelled browse resolves late — its write must be dropped.
    await act(async () => {
      g.release();
      await g.promise;
    });

    expect(onLiveWrite).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it("lets a live resolve settle loading when nothing supersedes it", async () => {
    const g = gate();
    const onLiveWrite = vi.fn();
    const runQuery = vi.fn(async ({ isStale }: GridDataLoaderRunContext) => {
      await g.promise;
      if (!isStale()) onLiveWrite();
    });
    const cancelNative = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useGridDataLoader({ runQuery, cancelNative }),
    );
    await waitFor(() => expect(result.current.loading).toBe(true));

    await act(async () => {
      g.release();
      await g.promise;
    });

    expect(onLiveWrite).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("fires the cooperative cancel before the native cancel", async () => {
    const order: string[] = [];
    cancelQuery.mockImplementation(async () => {
      order.push("cooperative");
      return "cancelled";
    });
    const runQuery = vi.fn(async () => {
      await new Promise(() => {}); // never settles; stays in-flight
    });
    const cancelNative = vi.fn(async () => {
      order.push("native");
    });

    const { result } = renderHook(() =>
      useGridDataLoader({ runQuery, cancelNative }),
    );
    await waitFor(() => expect(runQuery).toHaveBeenCalled());

    await act(async () => {
      result.current.handleCancelRefetch();
    });

    await waitFor(() => expect(cancelNative).toHaveBeenCalled());
    expect(order).toEqual(["cooperative", "native"]);
  });

  it("no-ops cancel when there is no in-flight query id", async () => {
    // runQuery resolves immediately -> queryIdRef cleared -> cancel is a no-op.
    const runQuery = vi.fn().mockResolvedValue(undefined);
    const cancelNative = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useGridDataLoader({ runQuery, cancelNative }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.handleCancelRefetch();
    });

    expect(cancelQuery).not.toHaveBeenCalled();
    expect(cancelNative).not.toHaveBeenCalled();
  });
});
