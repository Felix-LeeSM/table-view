/**
 * 작성 2026-05-17 (Phase 5 sprint-372 / AC-372-01, AC-372-05, AC-372-08).
 *
 * 사유: QueryLog 가 store `entries` 가 아닌 backend `list_history` IPC 를
 * 통해 row 를 채우는지, 그리고 detail click 이 `get_history_detail` IPC
 * 를 trigger 하는지 lock. user journey 의 출발점이라 mount/toggle 시점부터
 * detail modal 노출까지 outcome 단위로 따라간다.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import QueryLog from "./QueryLog";
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
  durationMs: 25,
  executedAt: Date.now() - id * 1000,
});

function toggleVisible() {
  act(() => {
    window.dispatchEvent(new CustomEvent("toggle-query-log"));
  });
}

describe("QueryLog list_history wire (sprint-372)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    resetStateChangedRegistryForTests();
  });

  // AC-372-01 — QueryLog mount 시 list_history IPC 1회.
  // 작성 2026-05-17. 사유: 본 dock panel 이 backend 단일 truth 로 가는
  // 전환의 첫 user touchpoint. 단일 IPC + sqlRedacted 도달까지 lock.
  it("[AC-372-01] toggle-query-log → list_history IPC + render rows", async () => {
    invokeMock.mockResolvedValueOnce({
      rows: [row(1, "SELECT * FROM users WHERE email = ?")],
    });
    render(<QueryLog />);

    toggleVisible();

    await waitFor(() => {
      expect(screen.getByTestId("query-log-panel")).toBeInTheDocument();
    });
    // Hook 가 mount 시 1회 호출
    expect(invokeMock).toHaveBeenCalledWith("list_history", {
      req: { limit: 100 },
    });
    // sqlRedacted (truncated) 가 표시됨
    await waitFor(() => {
      expect(screen.getByTestId("query-log-row-1")).toBeInTheDocument();
    });
  });

  // AC-372-08 — redact-only display. dock panel 어디에도 원문 sql 0 노출.
  // 작성 2026-05-17. 사유: privacy invariant strategy F.5. List 응답이
  // sqlRedacted 만 보내고, panel render 도 sqlRedacted 만 사용.
  it("[AC-372-08] panel never renders raw sql even if a fake row tried to leak", async () => {
    invokeMock.mockResolvedValueOnce({
      rows: [
        {
          ...row(1),
          // 백엔드가 보내지 않는 시나리오지만, 만약 누군가 row 에 sql
          // 필드를 박아도 component 가 화면에 안 그려야 한다.
          sqlRedacted: "SELECT * FROM users WHERE email = ?",
        },
      ],
    });
    render(<QueryLog />);
    toggleVisible();

    const panel = await screen.findByTestId("query-log-panel");
    await waitFor(() => {
      expect(panel).toHaveTextContent("?");
    });
    // 원문 leak 이 panel 안에 안 들어옴.
    expect(panel).not.toHaveTextContent("leak@example.com");
  });

  // AC-372-05 — first-page 상태에서 create event → refetch + prepend.
  // 작성 2026-05-17. 사유: 다른 window 에서 INSERT 한 entry 가 본 dock 의
  // 첫 위치에 prepend 되어야 사용자가 즉시 확인 가능.
  it("[AC-372-05] history.create event triggers refetch and prepends the new row", async () => {
    invokeMock.mockResolvedValueOnce({ rows: [row(1)] });
    render(<QueryLog />);
    toggleVisible();

    await waitFor(() => {
      expect(screen.getByTestId("query-log-row-1")).toBeInTheDocument();
    });

    // 두 번째 IPC — refetch 응답 (id=2 가 위, id=1 가 아래)
    invokeMock.mockResolvedValueOnce({ rows: [row(2), row(1)] });

    await act(async () => {
      dispatchStateChangedPayload("this-window", {
        domain: "history",
        op: "create",
        entityId: "2",
        version: 1,
        snapshotVersion: 0,
        originWindow: "other-window",
        emittedAt: Date.now(),
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("query-log-row-2")).toBeInTheDocument();
    });
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  // detail click 경로 — row 클릭 → modal mount → get_history_detail IPC.
  // 작성 2026-05-17. 사유: 원문 sql 의 유일한 노출 path (AC-372-03) 가
  // dock panel 에서 trigger 됨을 확인.
  it("row click opens detail modal and fires get_history_detail IPC", async () => {
    invokeMock.mockResolvedValueOnce({ rows: [row(7)] });
    render(<QueryLog />);
    toggleVisible();

    const rowBtn = await screen.findByTestId("query-log-row-7");

    invokeMock.mockResolvedValueOnce({
      id: 7,
      sql: "SELECT 7",
      sqlRedacted: "SELECT 7",
    });
    await act(async () => {
      rowBtn.click();
    });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_history_detail", {
        req: { id: 7 },
      });
    });
    expect(
      screen.getByTestId("query-history-detail-modal"),
    ).toBeInTheDocument();
  });

  // search filter — client side filter on sqlRedacted. 사용자 입력이
  // visible row 를 좁힌다 (backend search 는 sprint-373+).
  // 작성 2026-05-17. 사유: dock 의 검색 UX 가 유지됨을 회귀 가드.
  it("search input filters rows by sqlRedacted (client side)", async () => {
    invokeMock.mockResolvedValueOnce({
      rows: [row(1, "SELECT * FROM users"), row(2, "SELECT * FROM orders")],
    });
    render(<QueryLog />);
    toggleVisible();

    await screen.findByTestId("query-log-row-1");
    const searchInput = screen.getByPlaceholderText("Search queries...");

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "orders" } });
    });

    await waitFor(() => {
      expect(screen.queryByTestId("query-log-row-1")).not.toBeInTheDocument();
      expect(screen.getByTestId("query-log-row-2")).toBeInTheDocument();
    });
  });
});
