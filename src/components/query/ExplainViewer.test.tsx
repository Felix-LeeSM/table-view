// Sprint 337 (2026-05-15) — U2 live wire. Verify ExplainViewer dispatches
// to explain_rdb_query / explain_mongo_find via the @/lib/api/explain
// wrappers and renders PostgreSQL plans as a readable tree with raw JSON
// retained as fallback.

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

  it("renders a readable PostgreSQL plan after explain_rdb_query resolves", async () => {
    explainRdbMock.mockResolvedValueOnce([
      {
        Plan: {
          "Node Type": "Seq Scan",
          Schema: "public",
          "Relation Name": "users",
          "Startup Cost": 0,
          "Total Cost": 12.5,
          "Plan Rows": 3,
          "Actual Startup Time": 0.01,
          "Actual Total Time": 0.03,
          "Actual Rows": 3,
          "Rows Removed by Filter": 2,
          Filter: "(active = true)",
          Plans: [
            {
              "Node Type": "Index Scan",
              "Index Name": "users_pkey",
              "Relation Name": "users",
            },
          ],
        },
        "Planning Time": 0.12,
        "Execution Time": 1.75,
      },
    ]);
    render(
      <ExplainViewer
        connectionId="conn-pg"
        paradigm="table"
        rdbSql="SELECT 1"
        expectedDatabase="app"
      />,
    );
    expect(screen.getByTestId("explain-viewer")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("explain-plan")).toBeInTheDocument(),
    );
    expect(explainRdbMock).toHaveBeenCalledWith("conn-pg", "SELECT 1", "app");
    expect(screen.getByTestId("explain-plan-summary")).toHaveTextContent(
      "Plan Summary",
    );
    expect(screen.getAllByText("Seq Scan")).toHaveLength(2);
    expect(screen.getAllByText("on public.users")).toHaveLength(2);
    expect(screen.getByText("Index Scan")).toBeInTheDocument();
    expect(screen.getByText("Rows Removed by Filter")).toBeInTheDocument();
    expect(screen.getByText("(active = true)")).toBeInTheDocument();
    expect(screen.getByTestId("explain-raw-json")).toHaveTextContent(
      "Execution Time",
    );
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
    expect(screen.queryByTestId("explain-plan-summary")).toBeNull();
    expect(screen.getByTestId("explain-plan")).toHaveTextContent("winningPlan");
  });

  it("falls back to raw JSON for unknown RDB explain payloads", async () => {
    explainRdbMock.mockResolvedValueOnce({ ok: 1, plan: "custom" });
    render(
      <ExplainViewer
        connectionId="conn-pg"
        paradigm="table"
        rdbSql="SELECT 1"
      />,
    );

    const plan = await screen.findByTestId("explain-plan");
    expect(screen.queryByTestId("explain-plan-summary")).toBeNull();
    expect(plan.tagName).toBe("PRE");
    expect(plan).toHaveTextContent('"plan": "custom"');
  });

  it("renders error alert when explain rejects", async () => {
    explainRdbMock.mockRejectedValueOnce(new Error("syntax error"));
    const onPlanSettled = vi.fn();
    render(
      <ExplainViewer
        connectionId="conn-pg"
        paradigm="table"
        rdbSql="SELECT FROM"
        onPlanSettled={onPlanSettled}
      />,
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/syntax error/);
    expect(screen.queryByTestId("explain-plan")).toBeNull();
    expect(onPlanSettled).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        errorMessage: "syntax error",
        durationMs: expect.any(Number),
        executedAt: expect.any(Number),
      }),
    );
  });

  it("notifies the caller when a plan renders successfully", async () => {
    const onPlanSettled = vi.fn();
    explainRdbMock.mockResolvedValueOnce([
      { Plan: { "Node Type": "Index Scan" } },
    ]);
    render(
      <ExplainViewer
        connectionId="conn-pg"
        paradigm="table"
        rdbSql="SELECT 1"
        onPlanSettled={onPlanSettled}
      />,
    );

    await screen.findByTestId("explain-plan");
    expect(onPlanSettled).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "success",
        durationMs: expect.any(Number),
        executedAt: expect.any(Number),
      }),
    );
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
