/**
 * 작성 2026-05-17 (Phase 5 sprint-372) — `useQueryHistory` hook 의 IPC
 * + event 수신 시나리오 lock.
 *
 * 사유: AC-372-01 / AC-372-05 / AC-372-06 / AC-372-07 의 user-flow path
 * (mount → list IPC, create event 시 first-page refetch / cursor mode
 * 배지, clear event 시 rows 비우기). backend 의 wire shape
 * (`src/lib/tauri/history.test.ts`) 와 byte-equivalent 한 invoke arg 를
 * 기대해 양쪽이 동시에 깨지도록 lego 한다.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useQueryHistory } from "./useQueryHistory";
import {
  dispatchStateChangedPayload,
  resetStateChangedRegistryForTests,
} from "@lib/events/stateChanged";

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

  // AC-372-01 — mount 시 list_history IPC 1회.
  // 작성 2026-05-17. 사유: panel mount 가 단일 IPC 로 첫 page 를 채우는
  // user flow 의 진입점. invoke 호출 args 를 잠가 sprint-371 backend
  // 의 wire shape 과 lego.
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

  // AC-372-05 — first-page 상태에서 history.create event 수신 시 refetch.
  // 작성 2026-05-17. 사유: 다른 window 가 INSERT 한 entry 가 본 hook 의
  // visible list 에 prepend 되어야 user 가 새 entry 를 즉시 볼 수 있다.
  it("[AC-372-05] create event while on first page triggers refetch + prepend", async () => {
    invokeMock.mockResolvedValueOnce({ rows: [row(1)] });
    const { result } = renderHook(() =>
      useQueryHistory({ connectionId: "conn-1" }),
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    // 두 번째 IPC — refetch 응답
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

  // AC-372-06 — cursor pagination 중 history.create → refetch 0 + 배지.
  // 작성 2026-05-17. 사유: 사용자가 2 page 이상으로 paging 한 상태에서
  // 자동 refetch 는 view position 을 망친다. "New entry" 배지로 사용자
  // 능동 갱신을 유도한다.
  it("[AC-372-06] create event while paginated → no refetch, newEntryAvailable=true", async () => {
    // 첫 page 응답 — nextCursor 가 있어 hasMore=true
    invokeMock.mockResolvedValueOnce({ rows: [row(10)], nextCursor: 10 });
    const { result } = renderHook(() =>
      useQueryHistory({ connectionId: "conn-1" }),
    );
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    // loadMore — cursor mode 진입
    invokeMock.mockResolvedValueOnce({ rows: [row(9)], nextCursor: 9 });
    await act(async () => {
      await result.current.loadMore();
    });
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(result.current.rows).toHaveLength(2);

    // create event — refetch 0 회, 배지만 set
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
  // 작성 2026-05-17. 사유: clear_history 다른 창 호출이 본 창의 visible
  // list 를 정확히 비워야 한다. cursor/page 도 첫 page 로 reset.
  it("[AC-372-07] clear event resets rows + cursor + newEntryAvailable", async () => {
    invokeMock.mockResolvedValueOnce({ rows: [row(10)], nextCursor: 10 });
    const { result } = renderHook(() =>
      useQueryHistory({ connectionId: "conn-1" }),
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    // loadMore 로 cursor mode 진입
    invokeMock.mockResolvedValueOnce({ rows: [row(9)] });
    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.rows).toHaveLength(2);

    // create 로 newEntryAvailable=true 만들기
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

  // 추가 happy path — cursor pagination 의 loadMore 가 append 임을 잠근다.
  // 작성 2026-05-17. 사유: page 2+ 가 rows 를 prepend 가 아니라 append 해야
  // 시간순 정렬이 유지된다.
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
    // 두 번째 호출은 cursor=19 로 보내져야 함
    const lastCall = invokeMock.mock.calls[1];
    expect(lastCall?.[0]).toBe("list_history");
    expect(lastCall?.[1]).toEqual({
      req: { connectionId: "conn-1", cursor: 19, limit: 100 },
    });
  });

  // Error path — IPC reject 시 error state 가 채워지고 rows 가 깨지지 않음.
  // 작성 2026-05-17. 사유: backend 가 Validation 으로 reject 했을 때 user
  // 가 빈 화면 + 진단 메시지를 보도록 보장.
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
