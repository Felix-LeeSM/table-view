import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
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
import { useConnectionStore } from "@stores/connectionStore";

const mockSave = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (opts: unknown) => mockSave(opts),
}));

beforeEach(() => {
  setupTauriMock({
    getTableColumns: vi.fn(async () => [
      {
        name: "id",
        dataType: "integer",
        category: "unknown",
        nullable: false,
        default_value: null,
        is_primary_key: true,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      },
      {
        name: "name",
        dataType: "text",
        category: "unknown",
        nullable: true,
        default_value: null,
        is_primary_key: false,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      },
    ]),
    executeQuery: vi.fn(async () => ({})),
    exportGridRows: vi.fn(async () => ({
      rows_written: 2,
      bytes_written: 32,
    })),
  });
});

const SELECT_RESULT: QueryResult = {
  columns: [
    { name: "id", dataType: "integer", category: "unknown" },
    { name: "name", dataType: "text", category: "unknown" },
  ],
  rows: [
    [1, "Alice"],
    [2, null],
  ],
  totalCount: 2,
  executionTimeMs: 15,
  queryType: "select",
};

const DML_RESULT: QueryResult = {
  columns: [],
  rows: [],
  totalCount: 5,
  executionTimeMs: 8,
  queryType: { dml: { rows_affected: 5 } },
};

const DDL_RESULT: QueryResult = {
  columns: [],
  rows: [],
  totalCount: 0,
  executionTimeMs: 120,
  queryType: "ddl",
};

describe("QueryResultGrid", () => {
  beforeEach(() => {
    // Reset the per-connection PK metadata cache between tests so the
    // editable-vs-read-only paths fetch fresh.
    useSchemaStore.setState({
      tableColumnsCache: {},
      fileAnalyticsSources: {},
    });
    useConnectionStore.setState({ connections: [] });
    mockSave.mockReset();
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

  it("shows muted cancellation state when status is cancelled", () => {
    render(<QueryResultGrid queryState={{ status: "cancelled" }} />);

    expect(screen.getByRole("status")).toHaveTextContent("Query cancelled");
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
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

  it("renders Mongo document results without SQL editability wording", () => {
    useConnectionStore.setState({
      connections: [
        {
          id: "conn-mongo",
          name: "Mongo",
          dbType: "mongodb",
          host: "localhost",
          port: 27017,
          user: "",
          database: "table_view_test",
          groupId: null,
          color: null,
          hasPassword: false,
          paradigm: "document",
        },
      ],
    });
    const documentResult = {
      ...SELECT_RESULT,
      resultUnit: "document",
    } satisfies QueryResult & { resultUnit: "document" };

    render(
      <QueryResultGrid
        queryState={{ status: "completed", result: documentResult }}
        connectionId="conn-mongo"
        database="table_view_test"
        sql="db.users.find({ active: true })"
      />,
    );

    expect(screen.getByText(/2 documents/)).toBeInTheDocument();
    expect(screen.queryByText(/Read-only/)).not.toBeInTheDocument();
    expect(screen.queryByText(/row editing/i)).not.toBeInTheDocument();
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
    const firstRowCells = document.querySelectorAll(
      '[role="row"][aria-rowindex="2"] [role="gridcell"]',
    );
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
        database="db1"
        sql="SELECT id, name FROM public.users"
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/Editable/)).toBeInTheDocument();
    });
  });

  it("keeps SQLite read-only query results non-editable even when primary key metadata is available", async () => {
    useConnectionStore.setState({
      connections: [
        {
          id: "conn-sqlite",
          name: "SQLite read-only",
          dbType: "sqlite",
          host: "",
          port: 0,
          user: "",
          database: "/tmp/user.sqlite",
          readOnly: true,
          groupId: null,
          color: null,
          hasPassword: false,
          paradigm: "rdb",
        },
      ],
    });

    render(
      <QueryResultGrid
        queryState={{ status: "completed", result: SELECT_RESULT }}
        connectionId="conn-sqlite"
        database="/tmp/user.sqlite"
        sql="SELECT id, name FROM users"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Read-only/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Editable/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/read-only SQLite connection/i),
    ).toBeInTheDocument();
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
      totalCount: 0,
    };
    render(
      <QueryResultGrid
        queryState={{ status: "completed", result: emptyResult }}
      />,
    );
    expect(screen.getByText("No data")).toBeInTheDocument();
  });

  it("disables SQL export for DuckDB registered file alias query results", async () => {
    useConnectionStore.setState({
      connections: [
        {
          id: "conn-duck",
          name: "DuckDB",
          dbType: "duckdb",
          host: "",
          port: 0,
          user: "",
          database: "analytics.duckdb",
          groupId: null,
          color: null,
          hasPassword: false,
          paradigm: "rdb",
        },
      ],
    });
    useSchemaStore.setState({
      fileAnalyticsSources: {
        "conn-duck": [
          {
            source: {
              id: "source-1",
              alias: "sales_csv",
              fileName: "sales.csv",
              kind: "csv",
              sizeBytes: 128,
            },
            columns: [],
            previewSql: 'SELECT * FROM "sales_csv" LIMIT 100',
          },
        ],
      },
    });

    render(
      <QueryResultGrid
        queryState={{ status: "completed", result: SELECT_RESULT }}
        connectionId="conn-duck"
        database="analytics.duckdb"
        sql='SELECT id, name FROM "sales_csv"'
      />,
    );

    expect(screen.getByText(/Read-only/)).toBeInTheDocument();
    expect(
      screen.getByText(/active-session query sources/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Editable/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    const sqlItem = await screen.findByRole("menuitem", {
      name: /SQL INSERT/i,
    });
    expect(sqlItem).toHaveAttribute("aria-disabled", "true");
    expect(sqlItem.getAttribute("title")).toMatch(/registered file source/i);
    expect(screen.getByRole("menuitem", { name: /CSV/i })).not.toHaveAttribute(
      "aria-disabled",
    );
    expect(screen.getByRole("menuitem", { name: /TSV/i })).not.toHaveAttribute(
      "aria-disabled",
    );
  });

  it("exports DuckDB file alias query results as current grid rows without source-table context", async () => {
    mockSave.mockResolvedValueOnce("/tmp/sales.csv");
    const exportGridRows = vi.fn(async () => ({
      rows_written: 2,
      bytes_written: 32,
    }));
    setupTauriMock({ exportGridRows });
    useConnectionStore.setState({
      connections: [
        {
          id: "conn-duck",
          name: "DuckDB",
          dbType: "duckdb",
          host: "",
          port: 0,
          user: "",
          database: "analytics.duckdb",
          groupId: null,
          color: null,
          hasPassword: false,
          paradigm: "rdb",
        },
      ],
    });
    useSchemaStore.setState({
      fileAnalyticsSources: {
        "conn-duck": [
          {
            source: {
              id: "source-1",
              alias: "sales_csv",
              fileName: "sales.csv",
              kind: "csv",
              sizeBytes: 128,
            },
            columns: [],
            previewSql: 'SELECT * FROM "sales_csv" LIMIT 100',
          },
        ],
      },
    });

    render(
      <QueryResultGrid
        queryState={{ status: "completed", result: SELECT_RESULT }}
        connectionId="conn-duck"
        database="analytics.duckdb"
        sql='SELECT id, name FROM "sales_csv"'
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /CSV/i }));
    await act(async () => {});

    expect(exportGridRows).toHaveBeenCalledWith(
      "csv",
      "/tmp/sales.csv",
      ["id", "name"],
      [
        [1, "Alice"],
        [2, null],
      ],
      { kind: "query", source_table: null },
      null,
    );
  });
});
