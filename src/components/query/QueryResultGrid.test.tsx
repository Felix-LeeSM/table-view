import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import QueryResultGrid from "./QueryResultGrid";
import type { QueryResult } from "@/types/query";
import { useSchemaStore } from "@stores/schemaStore";

vi.mock("@lib/tauri", async () => {
  const mod = await vi.importActual<typeof import("@lib/tauri")>("@lib/tauri");
  return {
    ...mod,
    getTableColumns: vi.fn(async () => [
      {
        name: "id",
        data_type: "integer",
        nullable: false,
        default_value: null,
        is_primary_key: true,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      },
      {
        name: "name",
        data_type: "text",
        nullable: true,
        default_value: null,
        is_primary_key: false,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      },
    ]),
    executeQuery: vi.fn(async () => ({})),
  };
});

const SELECT_RESULT: QueryResult = {
  columns: [
    { name: "id", data_type: "integer" },
    { name: "name", data_type: "text" },
  ],
  rows: [
    [1, "Alice"],
    [2, null],
  ],
  total_count: 2,
  execution_time_ms: 15,
  query_type: "select",
};

const DML_RESULT: QueryResult = {
  columns: [],
  rows: [],
  total_count: 5,
  execution_time_ms: 8,
  query_type: { dml: { rows_affected: 5 } },
};

const DDL_RESULT: QueryResult = {
  columns: [],
  rows: [],
  total_count: 0,
  execution_time_ms: 120,
  query_type: "ddl",
};

describe("QueryResultGrid", () => {
  beforeEach(() => {
    // Reset the per-connection PK metadata cache between tests so the
    // editable-vs-read-only paths fetch fresh.
    useSchemaStore.setState({ tableColumnsCache: {} });
  });

  it("shows idle prompt when status is idle", () => {
    render(<QueryResultGrid queryState={{ status: "idle" }} />);
    expect(screen.getByText(/Cmd\+Return/i)).toBeInTheDocument();
  });

  it("shows spinner when status is running", () => {
    render(
      <QueryResultGrid queryState={{ status: "running", queryId: "q1" }} />,
    );
    expect(screen.getByText("Executing query...")).toBeInTheDocument();
    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("shows error message when status is error", () => {
    render(
      <QueryResultGrid
        queryState={{ status: "error", error: "Connection lost" }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Connection lost");
  });

  it("renders SELECT result with column headers and rows", () => {
    render(
      <QueryResultGrid
        queryState={{ status: "completed", result: SELECT_RESULT }}
      />,
    );
    // Column headers
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
    // Data
    expect(screen.getByText("Alice")).toBeInTheDocument();
    // Row count
    expect(screen.getByText(/2 rows/)).toBeInTheDocument();
    // Execution time
    expect(screen.getByText("15 ms")).toBeInTheDocument();
    // [AC-181-10] Sprint 181 ExportButton mounted into the SELECT toolbar.
    // 2026-05-01 — regression guard so future toolbar refactors don't drop it.
    expect(screen.getByRole("button", { name: /export/i })).toBeInTheDocument();
  });

  it("renders NULL values as italic text for SELECT", () => {
    render(
      <QueryResultGrid
        queryState={{ status: "completed", result: SELECT_RESULT }}
      />,
    );
    const nulls = screen.getAllByText("NULL");
    expect(nulls.length).toBeGreaterThan(0);
  });

  it("shows DML result with rows affected message", () => {
    render(
      <QueryResultGrid
        queryState={{ status: "completed", result: DML_RESULT }}
      />,
    );
    expect(screen.getByText(/5 rows affected/)).toBeInTheDocument();
  });

  it("shows DDL result with success message", () => {
    render(
      <QueryResultGrid
        queryState={{ status: "completed", result: DDL_RESULT }}
      />,
    );
    expect(screen.getByText("Query executed successfully")).toBeInTheDocument();
  });

  it("shows execution time for DDL", () => {
    render(
      <QueryResultGrid
        queryState={{ status: "completed", result: DDL_RESULT }}
      />,
    );
    expect(screen.getByText("120 ms")).toBeInTheDocument();
  });

  it("opens cell detail dialog on double-click in SELECT result", () => {
    render(
      <QueryResultGrid
        queryState={{ status: "completed", result: SELECT_RESULT }}
      />,
    );

    // Double-click the first row's name cell ("Alice").
    const firstRowCells = document.querySelectorAll("tbody tr:first-child td");
    act(() => {
      fireEvent.doubleClick(firstRowCells[1]!);
    });

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("name");
    expect(dialog.textContent).toContain("(text)");
    expect(dialog.textContent).toContain("Alice");
  });

  it("shows Editable badge when result is single-table SELECT with PK", async () => {
    render(
      <QueryResultGrid
        queryState={{ status: "completed", result: SELECT_RESULT }}
        connectionId="conn1"
        sql="SELECT id, name FROM public.users"
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/Editable/)).toBeInTheDocument();
    });
  });

  it("shows Read-only banner when SQL contains a JOIN", () => {
    render(
      <QueryResultGrid
        queryState={{ status: "completed", result: SELECT_RESULT }}
        connectionId="conn1"
        sql="SELECT * FROM users JOIN orders ON users.id = orders.uid"
      />,
    );
    expect(screen.getByText(/Read-only/)).toBeInTheDocument();
    expect(screen.getByText(/single-table/)).toBeInTheDocument();
  });

  it("renders read-only table when no SQL/connectionId is supplied (back-compat)", () => {
    render(
      <QueryResultGrid
        queryState={{ status: "completed", result: SELECT_RESULT }}
      />,
    );
    expect(screen.queryByText(/Editable/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Read-only/)).not.toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("shows 'No data' for SELECT with empty rows", () => {
    const emptyResult: QueryResult = {
      ...SELECT_RESULT,
      rows: [],
      total_count: 0,
    };
    render(
      <QueryResultGrid
        queryState={{ status: "completed", result: emptyResult }}
      />,
    );
    expect(screen.getByText("No data")).toBeInTheDocument();
  });
});
