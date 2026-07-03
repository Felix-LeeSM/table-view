// Sprint 336 (2026-05-15) — U1 live wire guard. ServerActivityPanel 가
// `listServerActivity` / `killServerActivity` 를 호출하고 grid + Kill
// 버튼을 paradigm-neutral 로 렌더한다. (a) initial fetch + row 렌더,
// (b) refresh 클릭, (c) Kill 클릭 → kill + re-fetch, (d) empty state,
// (e) error state.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServerActivityPanel } from "./ServerActivityPanel";

const listServerActivityMock = vi.fn();
const killServerActivityMock = vi.fn();

vi.mock("@/lib/api/serverActivity", () => ({
  listServerActivity: (...args: unknown[]) => listServerActivityMock(...args),
  killServerActivity: (...args: unknown[]) => killServerActivityMock(...args),
}));

describe("ServerActivityPanel (Sprint 336 — U1 live wire)", () => {
  beforeEach(() => {
    listServerActivityMock.mockReset();
    killServerActivityMock.mockReset();
  });

  it("renders the activity grid after a successful fetch", async () => {
    listServerActivityMock.mockResolvedValueOnce([
      {
        id: 42,
        db: "analytics",
        user: "alice",
        state: "active",
        query: "SELECT 1",
        waitEvent: null,
        startedAt: "2026-05-15T10:00:00Z",
      },
    ]);

    render(<ServerActivityPanel connectionId="conn-pg" dbType="postgresql" />);

    await waitFor(() => {
      expect(listServerActivityMock).toHaveBeenCalledWith("conn-pg");
    });

    expect(await screen.findByText("42")).toBeInTheDocument();
    expect(screen.getByText("analytics")).toBeInTheDocument();
    expect(screen.getByText("SELECT 1")).toBeInTheDocument();
  });

  it("renders the empty state when no sessions are active", async () => {
    listServerActivityMock.mockResolvedValueOnce([]);

    render(<ServerActivityPanel connectionId="conn-pg" dbType="postgresql" />);

    expect(
      await screen.findByTestId("server-activity-empty"),
    ).toHaveTextContent(/no active sessions/i);
  });

  it("dispatches Kill and refreshes the grid", async () => {
    listServerActivityMock
      .mockResolvedValueOnce([
        {
          id: 42,
          db: "analytics",
          user: "alice",
          state: "active",
          query: "SELECT 1",
          waitEvent: null,
          startedAt: null,
        },
      ])
      .mockResolvedValueOnce([]);
    killServerActivityMock.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();

    render(<ServerActivityPanel connectionId="conn-pg" dbType="postgresql" />);

    await user.click(await screen.findByTestId("server-activity-kill-42"));

    await waitFor(() => {
      expect(killServerActivityMock).toHaveBeenCalledWith("conn-pg", 42);
    });
    expect(listServerActivityMock).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByTestId("server-activity-empty"),
    ).toBeInTheDocument();
  });

  it("re-fetches when Refresh is clicked", async () => {
    listServerActivityMock.mockResolvedValue([]);
    const user = userEvent.setup();

    render(<ServerActivityPanel connectionId="conn-pg" dbType="postgresql" />);
    await waitFor(() => {
      expect(listServerActivityMock).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByTestId("server-activity-refresh"));

    await waitFor(() => {
      expect(listServerActivityMock).toHaveBeenCalledTimes(2);
    });
  });

  it("surfaces fetch errors via role=alert", async () => {
    listServerActivityMock.mockRejectedValueOnce(
      new Error("permission denied"),
    );

    render(<ServerActivityPanel connectionId="conn-pg" dbType="postgresql" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /permission denied/i,
    );
  });
});
