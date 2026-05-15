// Sprint 340 (2026-05-15) — U5 live wire. Verifies SlowQueryPanel
// dispatches the paradigm-neutral `slow_queries` IPC through
// `@/lib/api/slowQueries` and renders the top-N table.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

const sqMock = vi.fn();

vi.mock("@/lib/api/slowQueries", () => ({
  slowQueries: (...args: unknown[]) => sqMock(...args),
}));

import { SlowQueryPanel } from "./SlowQueryPanel";

const pgStub = [
  {
    query: "SELECT * FROM users WHERE id = $1",
    calls: 1024,
    totalExecTimeMs: 5120.5,
    meanExecTimeMs: 5.0,
    rows: 1024,
    extras: {},
  },
];

const mongoStub = [
  {
    query: '{"find":"users","filter":{"x":1}}',
    calls: 1,
    totalExecTimeMs: 87.0,
    meanExecTimeMs: 87.0,
    rows: 5,
    extras: { keysExamined: 100, docsExamined: 500, ns: "app.users" },
  },
];

describe("SlowQueryPanel (Sprint 340 U5 live wire)", () => {
  beforeEach(() => {
    sqMock.mockReset();
  });

  it("renders RDB slow query table after slow_queries resolves", async () => {
    sqMock.mockResolvedValueOnce(pgStub);
    render(<SlowQueryPanel connectionId="conn-pg" paradigm="table" />);
    await waitFor(() =>
      expect(screen.getByTestId("slow-query-table")).toBeInTheDocument(),
    );
    expect(sqMock).toHaveBeenCalledWith("conn-pg", 25);
    expect(screen.getByText(/SELECT \* FROM users/)).toBeInTheDocument();
    // calls + rows both render 1,024 — assertGenerally that at least one matches.
    expect(screen.getAllByText("1,024").length).toBeGreaterThan(0);
    expect(screen.getByText("5.00")).toBeInTheDocument();
  });

  it("renders Mongo profile rows with extras drawer", async () => {
    sqMock.mockResolvedValueOnce(mongoStub);
    render(<SlowQueryPanel connectionId="conn-m" paradigm="document" />);
    await waitFor(() =>
      expect(screen.getByTestId("slow-query-table")).toBeInTheDocument(),
    );
    expect(sqMock).toHaveBeenCalledWith("conn-m", 25);
    expect(screen.getByText(/find/)).toBeInTheDocument();
    expect(screen.getByTestId("slow-query-extras").textContent).toMatch(
      /keysExamined/,
    );
  });

  it("renders empty state when no rows returned (Mongo profiling off)", async () => {
    sqMock.mockResolvedValueOnce([]);
    render(<SlowQueryPanel connectionId="conn-m" paradigm="document" />);
    await waitFor(() =>
      expect(screen.getByTestId("slow-query-empty")).toBeInTheDocument(),
    );
    expect(screen.getByText(/setProfilingLevel/)).toBeInTheDocument();
  });

  it("renders error alert when fetch rejects", async () => {
    sqMock.mockRejectedValueOnce(
      new Error("pg_stat_statements extension not enabled."),
    );
    render(<SlowQueryPanel connectionId="conn-pg" paradigm="table" />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/pg_stat_statements/);
    expect(screen.queryByTestId("slow-query-table")).toBeNull();
  });

  it("re-fetches when Refresh is clicked", async () => {
    sqMock.mockResolvedValue(pgStub);
    const user = userEvent.setup();
    render(<SlowQueryPanel connectionId="conn-pg" paradigm="table" />);
    await waitFor(() => expect(sqMock).toHaveBeenCalledTimes(1));
    await user.click(screen.getByTestId("slow-query-refresh"));
    await waitFor(() => expect(sqMock).toHaveBeenCalledTimes(2));
  });
});
