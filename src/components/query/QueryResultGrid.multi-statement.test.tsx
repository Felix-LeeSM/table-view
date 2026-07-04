import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import QueryResultGrid from "./QueryResultGrid";
import type { QueryResult, QueryStatementResult } from "@/types/query";
import { useSchemaStore } from "@stores/schemaStore";
beforeEach(() => {
  setupTauriMock({
    getTableColumns: vi.fn(async () => []),
    executeQuery: vi.fn(async () => ({})),
  });
});

const SELECT_RESULT_A: QueryResult = {
  columns: [
    { name: "id", dataType: "integer", category: "unknown" },
    { name: "name", dataType: "text", category: "unknown" },
  ],
  rows: [
    [1, "Alice"],
    [2, "Bob"],
  ],
  totalCount: 2,
  executionTimeMs: 5,
  queryType: "select",
};

const DDL_RESULT: QueryResult = {
  columns: [],
  rows: [],
  totalCount: 0,
  executionTimeMs: 11,
  queryType: "ddl",
};

const SUCCESS_STMT_A: QueryStatementResult = {
  sql: "SELECT id, name FROM t1",
  status: "success",
  result: SELECT_RESULT_A,
  durationMs: 5,
};

const SUCCESS_STMT_DDL: QueryStatementResult = {
  sql: "CREATE TABLE t2 (id INT)",
  status: "success",
  result: DDL_RESULT,
  durationMs: 11,
};

const ERROR_STMT: QueryStatementResult = {
  sql: "DROP TABLE missing",
  status: "error",
  error: 'relation "missing" does not exist',
  durationMs: 3,
};

// #1089 — a stop-on-error skipped statement: never sent to the driver.
const SKIPPED_STMT: QueryStatementResult = {
  sql: "DELETE FROM t1 WHERE id = 1",
  status: "skipped",
  durationMs: 0,
};

describe("QueryResultGrid — multi-statement (sprint 100)", () => {
  beforeEach(() => {
    useSchemaStore.setState({ tableColumnsCache: {} });
  });

  // ── AC-01 ──
  it("renders one tab per statement with verb + rows-or-ms label", () => {
    render(
      <QueryResultGrid
        queryState={{
          status: "completed",
          result: DDL_RESULT,
          statements: [SUCCESS_STMT_A, SUCCESS_STMT_DDL],
        }}
      />,
    );

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);

    // Tab 1 — SELECT, should expose row count badge.
    expect(tabs[0]!).toHaveTextContent(/Statement 1/);
    expect(tabs[0]!).toHaveTextContent(/SELECT/);
    expect(tabs[0]!).toHaveTextContent(/2 rows/);

    // Tab 2 — DDL, should expose ms badge.
    expect(tabs[1]!).toHaveTextContent(/Statement 2/);
    expect(tabs[1]!).toHaveTextContent(/DDL/);
    expect(tabs[1]!).toHaveTextContent(/11 ms/);
  });

  // ── AC-02 ──
  it("partial failure → error tab carries data-status='error' and reveals the error message", () => {
    render(
      <QueryResultGrid
        queryState={{
          status: "completed",
          result: SELECT_RESULT_A,
          statements: [SUCCESS_STMT_A, ERROR_STMT],
        }}
      />,
    );

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);

    // The success tab is success; the error tab carries the destructive marker.
    expect(tabs[0]!).toHaveAttribute("data-status", "success");
    expect(tabs[1]!).toHaveAttribute("data-status", "error");
    expect(tabs[1]!).toHaveTextContent(/ERROR/);
    expect(tabs[1]!).toHaveTextContent(/✕/);

    // Activate the failed tab and verify the destructive banner is visible.
    // Radix Tabs activates on `mouseDown` rather than synthetic click — see
    // ImportExportDialog.test.tsx for the same pattern.
    fireEvent.mouseDown(tabs[1]!);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/Statement 2 failed/);
    expect(alert).toHaveTextContent(/relation "missing" does not exist/);
  });

  // #1089 — stop-on-error: statements after the first failure are `skipped`.
  // The skipped tab is muted (data-status='skipped', "—" badge) and its panel
  // explains it was not executed — no destructive error styling.
  it("stop-on-error → skipped tab is muted and explains it was not executed", () => {
    render(
      <QueryResultGrid
        queryState={{
          status: "completed",
          result: SELECT_RESULT_A,
          statements: [SUCCESS_STMT_A, ERROR_STMT, SKIPPED_STMT],
        }}
      />,
    );

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[2]!).toHaveAttribute("data-status", "skipped");
    expect(tabs[2]!).toHaveTextContent(/SKIPPED/);
    expect(tabs[2]!).toHaveTextContent(/—/);

    fireEvent.mouseDown(tabs[2]!);
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText(/was not executed/)).toBeInTheDocument();
    // No destructive alert for a skipped statement.
    expect(within(panel).queryByRole("alert")).toBeNull();
  });

  // ── AC-03 ──
  it("single-statement (no statements field) does NOT render any tabs", () => {
    render(
      <QueryResultGrid
        queryState={{ status: "completed", result: SELECT_RESULT_A }}
      />,
    );

    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    // The legacy single-result UI still renders.
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText(/2 rows/)).toBeInTheDocument();
  });

  it("statements length === 1 also skips Tabs (regression-free single-stmt path)", () => {
    render(
      <QueryResultGrid
        queryState={{
          status: "completed",
          result: SELECT_RESULT_A,
          statements: [SUCCESS_STMT_A],
        }}
      />,
    );

    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  // ── AC-04 ──
  it("ArrowRight on the active tab moves activation to the next tab", async () => {
    render(
      <QueryResultGrid
        queryState={{
          status: "completed",
          result: DDL_RESULT,
          statements: [SUCCESS_STMT_A, SUCCESS_STMT_DDL],
        }}
      />,
    );

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);

    // First tab is active by default (defaultValue="stmt-0").
    expect(tabs[0]!).toHaveAttribute("data-state", "active");
    expect(tabs[1]!).toHaveAttribute("data-state", "inactive");

    // Focus the first tab, then dispatch ArrowRight. Radix's automatic
    // activation moves the active tab on each arrow press.
    tabs[0]!.focus();
    fireEvent.keyDown(tabs[0]!, { key: "ArrowRight", code: "ArrowRight" });

    await waitFor(() => {
      expect(tabs[1]!).toHaveAttribute("data-state", "active");
      expect(tabs[0]!).toHaveAttribute("data-state", "inactive");
    });
  });

  it("ArrowLeft cycles back to the previous tab (Radix default keyboard nav)", async () => {
    render(
      <QueryResultGrid
        queryState={{
          status: "completed",
          result: DDL_RESULT,
          statements: [SUCCESS_STMT_A, SUCCESS_STMT_DDL],
        }}
      />,
    );

    const tabs = screen.getAllByRole("tab");
    // Move forward, then back.
    tabs[0]!.focus();
    fireEvent.keyDown(tabs[0]!, { key: "ArrowRight", code: "ArrowRight" });

    await waitFor(() => {
      expect(tabs[1]!).toHaveAttribute("data-state", "active");
    });

    fireEvent.keyDown(tabs[1]!, { key: "ArrowLeft", code: "ArrowLeft" });

    await waitFor(() => {
      expect(tabs[0]!).toHaveAttribute("data-state", "active");
    });
  });

  it("clicking a sibling tab swaps the rendered content", () => {
    // Verify the active TabsContent is the one keyed off the clicked tab —
    // this protects the per-stmt content rendering as users browse.
    render(
      <QueryResultGrid
        queryState={{
          status: "completed",
          result: DDL_RESULT,
          statements: [SUCCESS_STMT_A, SUCCESS_STMT_DDL],
        }}
      />,
    );

    // Initially first tab content is visible (SELECT rows).
    expect(screen.getByText("Alice")).toBeInTheDocument();

    const tabs = screen.getAllByRole("tab");
    // Radix Tabs activates on `mouseDown` rather than synthetic click.
    fireEvent.mouseDown(tabs[1]!);

    // Now the DDL "Query executed successfully" message is visible.
    const activePanel = screen.getByRole("tabpanel");
    expect(
      within(activePanel).getByText(/Query executed successfully/),
    ).toBeInTheDocument();
  });
});
