// Sprint 337 (2026-05-15) — U2 live wire. Verify ExplainViewer dispatches
// to explain_rdb_query / explain_mongo_find via the @/lib/api/explain
// wrappers and renders the returned plan as a pretty-printed JSON tree.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

const explainRdbMock = vi.fn();
const explainMongoMock = vi.fn();

vi.mock("@/lib/api/explain", () => ({
  explainRdbQuery: (...args: unknown[]) => explainRdbMock(...args),
  explainMongoFind: (...args: unknown[]) => explainMongoMock(...args),
}));

import { ExplainViewer } from "./ExplainViewer";

describe("ExplainViewer (Sprint 337 U2 live wire)", () => {
  beforeEach(() => {
    explainRdbMock.mockReset();
    explainMongoMock.mockReset();
  });

  it("renders RDB plan after explain_rdb_query resolves", async () => {
    explainRdbMock.mockResolvedValueOnce([
      { Plan: { "Node Type": "Seq Scan", "Total Cost": 12.5 } },
    ]);
    render(
      <ExplainViewer
        connectionId="conn-pg"
        paradigm="table"
        rdbSql="SELECT 1"
      />,
    );
    expect(screen.getByTestId("explain-viewer")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("explain-plan")).toBeInTheDocument(),
    );
    expect(explainRdbMock).toHaveBeenCalledWith("conn-pg", "SELECT 1");
    expect(screen.getByTestId("explain-plan").textContent).toMatch(/Seq Scan/);
  });

  it("dispatches Mongo explain with the spec on paradigm=document", async () => {
    explainMongoMock.mockResolvedValueOnce({ ok: 1, winningPlan: {} });
    render(
      <ExplainViewer
        connectionId="conn-m"
        paradigm="document"
        mongoSpec={{
          database: "mydb",
          collection: "mycoll",
          filter: { x: 1 },
          verbosity: "executionStats",
        }}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("explain-plan")).toBeInTheDocument(),
    );
    expect(explainMongoMock).toHaveBeenCalledWith("conn-m", {
      database: "mydb",
      collection: "mycoll",
      filter: { x: 1 },
      verbosity: "executionStats",
    });
  });

  it("renders error alert when explain rejects", async () => {
    explainRdbMock.mockRejectedValueOnce(new Error("syntax error"));
    render(
      <ExplainViewer
        connectionId="conn-pg"
        paradigm="table"
        rdbSql="SELECT FROM"
      />,
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/syntax error/);
    expect(screen.queryByTestId("explain-plan")).toBeNull();
  });

  it("re-fetches when Refresh is clicked", async () => {
    explainRdbMock.mockResolvedValue([{ Plan: { "Node Type": "Index Scan" } }]);
    const user = userEvent.setup();
    render(
      <ExplainViewer
        connectionId="conn-pg"
        paradigm="table"
        rdbSql="SELECT 1"
      />,
    );
    await waitFor(() => expect(explainRdbMock).toHaveBeenCalledTimes(1));
    await user.click(screen.getByTestId("explain-refresh"));
    await waitFor(() => expect(explainRdbMock).toHaveBeenCalledTimes(2));
  });
});
