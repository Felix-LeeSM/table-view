// Sprint 337 (2026-05-15) — U2 live wire. Verify ExplainViewer dispatches
// to explain_rdb_query / explain_mongo_find via the @/lib/api/explain
// wrappers and renders PostgreSQL plans as a readable tree with raw JSON
// retained as fallback.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const explainRdbMock = vi.fn();
const explainMongoMock = vi.fn();
const explainSearchMock = vi.fn();
const cancelQueryMock = vi.fn();

vi.mock("@/lib/api/explain", () => ({
  explainRdbQuery: (...args: unknown[]) => explainRdbMock(...args),
  explainMongoFind: (...args: unknown[]) => explainMongoMock(...args),
  explainSearchQuery: (...args: unknown[]) => explainSearchMock(...args),
}));

vi.mock("@/lib/tauri", () => ({
  cancelQuery: (...args: unknown[]) => cancelQueryMock(...args),
}));

// #2153 — the search branch is asserted against the recorded cluster profile
// (#2198), the same file the parser test and the Rust live-query test read.
import profileFixtureRaw from "../../../tests/fixtures/search-profile-response.json?raw";
import { ExplainViewer } from "./ExplainViewer";

const elasticsearchProfile = (
  JSON.parse(profileFixtureRaw) as {
    captures: Array<{ product: string; profile: unknown }>;
  }
).captures.find((capture) => capture.product === "elasticsearch")?.profile;

describe("ExplainViewer (Sprint 337 U2 live wire)", () => {
  beforeEach(() => {
    explainRdbMock.mockReset();
    explainMongoMock.mockReset();
    explainSearchMock.mockReset();
    cancelQueryMock.mockReset();
    cancelQueryMock.mockResolvedValue("cancelled");
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
        dbType="postgresql"
        rdbSql="SELECT 1"
        expectedDatabase="app"
      />,
    );
    expect(screen.getByTestId("explain-viewer")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("explain-plan")).toBeInTheDocument(),
    );
    expect(explainRdbMock).toHaveBeenCalledWith(
      "conn-pg",
      "SELECT 1",
      "app",
      expect.stringMatching(/^explain-/),
    );
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

  // #1053 regression — a non-PG rdb connection must show its own display
  // name in the header, never masquerade as "PG". The header interpolates
  // the dbType profile label (`DATABASE_TYPE_LABELS`), not a hardcoded
  // 2-engine string.
  it("labels a MySQL connection as MySQL, not PG", async () => {
    explainRdbMock.mockResolvedValueOnce({ ok: 1, plan: "custom" });
    render(
      <ExplainViewer
        connectionId="conn-mysql"
        dbType="mysql"
        rdbSql="SELECT 1"
      />,
    );
    await screen.findByTestId("explain-plan");
    const header = screen.getByTestId("explain-viewer").querySelector("header");
    expect(header).toHaveTextContent("Explain (MySQL)");
    expect(header).not.toHaveTextContent(/\bPG\b/);
  });

  it("dispatches Mongo explain with the full find body on paradigm=document", async () => {
    explainMongoMock.mockResolvedValueOnce({ ok: 1, winningPlan: {} });
    render(
      <ExplainViewer
        connectionId="conn-m"
        dbType="mongodb"
        mongoSpec={{
          database: "mydb",
          collection: "mycoll",
          body: { filter: { x: 1 }, sort: { x: -1 }, limit: 5 },
          verbosity: "executionStats",
        }}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("explain-plan")).toBeInTheDocument(),
    );
    expect(explainMongoMock).toHaveBeenCalledWith(
      "conn-m",
      {
        database: "mydb",
        collection: "mycoll",
        body: { filter: { x: 1 }, sort: { x: -1 }, limit: 5 },
        verbosity: "executionStats",
      },
      expect.stringMatching(/^explain-/),
    );
    expect(screen.queryByTestId("explain-plan-summary")).toBeNull();
    expect(screen.getByTestId("explain-plan")).toHaveTextContent("winningPlan");
  });

  it("falls back to raw JSON for unknown RDB explain payloads", async () => {
    explainRdbMock.mockResolvedValueOnce({ ok: 1, plan: "custom" });
    render(
      <ExplainViewer
        connectionId="conn-pg"
        dbType="postgresql"
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
        dbType="postgresql"
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
        dbType="postgresql"
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

  // #1269 — while a plan is in flight the Refresh control becomes a Stop
  // button that fires the same cooperative `cancelQuery` the query tab uses,
  // keyed by the id threaded into the explain call. A cancel-induced rejection
  // is swallowed (no error alert).
  it("shows a Stop button while loading and fires cancelQuery on click", async () => {
    let rejectExplain: (reason: unknown) => void = () => {};
    explainRdbMock.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectExplain = reject;
      }),
    );
    const user = userEvent.setup();
    render(
      <ExplainViewer
        connectionId="conn-pg"
        dbType="postgresql"
        rdbSql="SELECT 1"
      />,
    );

    const stop = await screen.findByTestId("explain-cancel");
    expect(screen.queryByTestId("explain-refresh")).toBeNull();

    await user.click(stop);
    expect(cancelQueryMock).toHaveBeenCalledTimes(1);
    expect(cancelQueryMock.mock.calls[0]![0]).toMatch(/^explain-/);

    // The backend aborts the awaited plan; the viewer must return to idle
    // without surfacing an error alert.
    rejectExplain(new Error("Database error: Operation cancelled"));
    await waitFor(() =>
      expect(screen.getByTestId("explain-refresh")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // ── #2153: the search paradigm renders the `_search` profile section ──

  it("dispatches the search request with profile and renders the recorded shard tree", async () => {
    explainSearchMock.mockResolvedValueOnce(elasticsearchProfile);
    const searchSpec = {
      index: "table-view-elastic-2026.05.24",
      body: { query: { match: { message: "fixture" } } },
    };
    render(
      <ExplainViewer
        connectionId="conn-es"
        dbType="elasticsearch"
        searchSpec={searchSpec}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("explain-plan")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("explain-viewer")).toHaveAttribute(
      "data-paradigm",
      "search",
    );
    expect(explainSearchMock).toHaveBeenCalledWith(
      "conn-es",
      searchSpec,
      expect.stringMatching(/^explain-/),
    );
    expect(explainRdbMock).not.toHaveBeenCalled();
    expect(explainMongoMock).not.toHaveBeenCalled();

    expect(screen.getByTestId("explain-plan-summary")).toHaveTextContent(
      "Profile Summary",
    );
    expect(screen.getByText("TermQuery")).toBeInTheDocument();
    expect(screen.getByText("message:fixture")).toBeInTheDocument();
    expect(screen.getByText("create_weight")).toBeInTheDocument();
    expect(
      screen.getByText("GlobalOrdinalsStringTermsAggregator"),
    ).toBeInTheDocument();
    // The untouched payload stays reachable — the smoke step and the result
    // panel both read the cluster's own key names out of it.
    expect(screen.getByTestId("explain-raw-json")).toHaveTextContent(
      '"time_in_nanos":',
    );
  });

  it("says so when the cluster answers a search explain without a profile", async () => {
    explainSearchMock.mockResolvedValueOnce(null);
    render(
      <ExplainViewer
        connectionId="conn-es"
        dbType="opensearch"
        searchSpec={{ index: "logs", body: {} }}
      />,
    );

    expect(await screen.findByTestId("explain-empty")).toHaveTextContent(
      /without a profile section/,
    );
    expect(screen.queryByTestId("explain-plan")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // #2153 regression — the Stop button renders for every paradigm, so a search
  // explain can be cancelled before the cluster answers. "Answered without a
  // profile" must not be what the user sees for a request they stopped: the
  // empty state above asserts something about the cluster's answer, and after
  // a cancel there is no answer to assert.
  it("does not claim a missing profile when a search explain is cancelled", async () => {
    let rejectExplain: (reason: unknown) => void = () => {};
    explainSearchMock.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectExplain = reject;
      }),
    );
    const user = userEvent.setup();
    render(
      <ExplainViewer
        connectionId="conn-es"
        dbType="opensearch"
        searchSpec={{ index: "logs", body: {} }}
      />,
    );

    await user.click(await screen.findByTestId("explain-cancel"));
    expect(cancelQueryMock).toHaveBeenCalledTimes(1);

    rejectExplain(new Error("Database error: Operation cancelled"));
    await waitFor(() =>
      expect(screen.getByTestId("explain-refresh")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("explain-empty")).toBeNull();
    expect(screen.queryByTestId("explain-plan")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("re-fetches when Refresh is clicked", async () => {
    explainRdbMock.mockResolvedValue([{ Plan: { "Node Type": "Index Scan" } }]);
    const user = userEvent.setup();
    render(
      <ExplainViewer
        connectionId="conn-pg"
        dbType="postgresql"
        rdbSql="SELECT 1"
      />,
    );
    await waitFor(() => expect(explainRdbMock).toHaveBeenCalledTimes(1));
    await user.click(screen.getByTestId("explain-refresh"));
    await waitFor(() => expect(explainRdbMock).toHaveBeenCalledTimes(2));
  });
});
