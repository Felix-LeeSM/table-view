/**
 * Written 2026-05-17 (state-management-strategy Phase 5) — locks the IPC +
 * event-reception scenarios of the `useQueryHistory` hook.
 *
 * Reason: the user-flow paths of AC-372-01 / AC-372-05 / AC-372-06 /
 * AC-372-07 (mount → list IPC, first-page refetch / cursor-mode badge on a
 * create event, emptying rows on a clear event). The tests expect invoke
 * args byte-equivalent to the backend wire shape
 * (`src/lib/tauri/history.test.ts`), interlocking the two so both break
 * together.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  dispatchStateChangedPayload,
  resetStateChangedRegistryForTests,
} from "@lib/events/stateChanged";
import { QUERY_HISTORY_LOCAL_CREATED_EVENT } from "@stores/queryHistoryStore";
import { useQueryHistory } from "./useQueryHistory";

const row = (id: number, sqlRedacted = `SELECT ${id}`) => ({
  id,
  connectionId: "conn-1",
  paradigm: "rdb" as const,
  queryMode: "sql",
  source: "raw",
  sqlRedacted,
  status: "success",
  durationMs: 5,
  executedAt: 1_700_000_000_000 + id,
});

describe("useQueryHistory event + IPC flow (sprint-372)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    resetStateChangedRegistryForTests();
  });

  // AC-372-01 — one list_history IPC on mount.
  // Written 2026-05-17. Reason: a panel mount filling the first page with a
  // single IPC is the entry point of the user flow. Locking the invoke args
  // interlocks them with the backend wire shape.
  it("[AC-372-01] mount calls list_history once with the supplied filter", async () => {
    invokeMock.mockResolvedValueOnce({ rows: [row(1), row(2)] });
    const { result } = renderHook(() =>
      useQueryHistory({ connectionId: "conn-1", tabId: "tab-1" }),
    );

    await waitFor(() => {
      expect(result.current.rows).toHaveLength(2);
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("list_history", {
      req: { connectionId: "conn-1", tabId: "tab-1", limit: 100 },
    });
    expect(result.current.hasMore).toBe(false);
  });

  // AC-372-05 — refetch on a history.create event while on the first page.
  // Written 2026-05-17. Reason: an entry another window INSERTs must be
  // prepended to this hook's visible list so the user sees it immediately.
  it("[AC-372-05] create event while on first page triggers refetch + prepend", async () => {
    invokeMock.mockResolvedValueOnce({ rows: [row(1)] });
    const { result } = renderHook(() =>
      useQueryHistory({ connectionId: "conn-1" }),
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    // Second IPC — the refetch response
    invokeMock.mockResolvedValueOnce({ rows: [row(2), row(1)] });

    await act(async () => {
      dispatchStateChangedPayload("this-window", {
        domain: "history",
        op: "create",
        entityId: "2",
        version: 1,
        snapshotVersion: 0,
        originWindow: "other-window",
        emittedAt: 1_700_000_000_000,
      });
    });

    await waitFor(() => {
      expect(result.current.rows).toHaveLength(2);
    });
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(result.current.rows[0]?.id).toBe(2);
    expect(result.current.newEntryAvailable).toBe(false);
  });

  it("same-window committed history event refreshes the visible first page", async () => {
    invokeMock.mockResolvedValueOnce({ rows: [{ ...row(1), tabId: "tab-1" }] });
    const { result } = renderHook(() =>
      useQueryHistory({ connectionId: "conn-1", tabId: "tab-1" }),
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    const cancelled = {
      ...row(2),
      tabId: "tab-1",
      status: "cancelled",
    };
    invokeMock.mockResolvedValueOnce({
      rows: [cancelled, { ...row(1), tabId: "tab-1" }],
    });

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(QUERY_HISTORY_LOCAL_CREATED_EVENT, {
          detail: { row: cancelled },
        }),
      );
    });

    await waitFor(() => {
      expect(result.current.rows.map((entry) => entry.status)).toEqual([
        "cancelled",
        "success",
      ]);
    });
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  // AC-372-06 — history.create during cursor pagination → no refetch + badge.
  // Written 2026-05-17. Reason: once the user has paged to page 2 or later,
  // an automatic refetch would wreck the view position. The "New entry" badge
  // prompts the user to refresh on their own.
  it("[AC-372-06] create event while paginated → no refetch, newEntryAvailable=true", async () => {
    // First-page response — nextCursor is present, so hasMore=true
    invokeMock.mockResolvedValueOnce({ rows: [row(10)], nextCursor: 10 });
    const { result } = renderHook(() =>
      useQueryHistory({ connectionId: "conn-1" }),
    );
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    // loadMore — enters cursor mode
    invokeMock.mockResolvedValueOnce({ rows: [row(9)], nextCursor: 9 });
    await act(async () => {
      await result.current.loadMore();
    });
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(result.current.rows).toHaveLength(2);

    // create event — no refetch, only the badge is set
    await act(async () => {
      dispatchStateChangedPayload("this-window", {
        domain: "history",
        op: "create",
        entityId: "11",
        version: 1,
        snapshotVersion: 0,
        originWindow: "other-window",
        emittedAt: 1_700_000_000_000,
      });
    });

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(result.current.newEntryAvailable).toBe(true);
  });

  // AC-372-07 — clear event → rows=[] + cursor reset.
  // Written 2026-05-17. Reason: a clear_history call from another window must
  // empty this window's visible list exactly. cursor/page also reset to the
  // first page.
  it("[AC-372-07] clear event resets rows + cursor + newEntryAvailable", async () => {
    invokeMock.mockResolvedValueOnce({ rows: [row(10)], nextCursor: 10 });
    const { result } = renderHook(() =>
      useQueryHistory({ connectionId: "conn-1" }),
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    // Enter cursor mode via loadMore
    invokeMock.mockResolvedValueOnce({ rows: [row(9)] });
    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.rows).toHaveLength(2);

    // Set newEntryAvailable=true with a create event
    await act(async () => {
      dispatchStateChangedPayload("this-window", {
        domain: "history",
        op: "create",
        entityId: "11",
        version: 1,
        snapshotVersion: 0,
        originWindow: "other-window",
        emittedAt: 1_700_000_000_000,
      });
    });
    expect(result.current.newEntryAvailable).toBe(true);

    // clear event
    await act(async () => {
      dispatchStateChangedPayload("this-window", {
        domain: "history",
        op: "clear",
        entityId: null,
        version: 1,
        snapshotVersion: 0,
        originWindow: "other-window",
        emittedAt: 1_700_000_000_001,
      });
    });

    expect(result.current.rows).toEqual([]);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.newEntryAvailable).toBe(false);
  });

  // Extra happy path — locks that cursor-pagination loadMore appends.
  // Written 2026-05-17. Reason: page 2+ must append rows, not prepend them,
  // to keep the rows in time order.
  it("loadMore appends to existing rows (no duplicate prepend)", async () => {
    invokeMock.mockResolvedValueOnce({
      rows: [row(20), row(19)],
      nextCursor: 19,
    });
    const { result } = renderHook(() =>
      useQueryHistory({ connectionId: "conn-1" }),
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    invokeMock.mockResolvedValueOnce({ rows: [row(18), row(17)] });
    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.rows.map((r) => r.id)).toEqual([20, 19, 18, 17]);
    expect(result.current.hasMore).toBe(false);
    // The second call must send cursor=19
    const lastCall = invokeMock.mock.calls[1];
    expect(lastCall?.[0]).toBe("list_history");
    expect(lastCall?.[1]).toEqual({
      req: { connectionId: "conn-1", cursor: 19, limit: 100 },
    });
  });

  // Error path — an IPC reject fills the error state without breaking rows.
  // Written 2026-05-17. Reason: when the backend rejects with Validation, the
  // user is guaranteed to see an empty view plus a diagnostic message.
  it("propagates IPC failure to error state without breaking rows", async () => {
    invokeMock.mockRejectedValueOnce(new Error("backend Validation"));
    const { result } = renderHook(() => useQueryHistory({}));

    await waitFor(() => {
      expect(result.current.error).toMatch(/Validation/);
    });
    expect(result.current.rows).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});
