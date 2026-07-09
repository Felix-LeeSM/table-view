import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QueryResultGrid from "./QueryResultGrid";
import type { QueryResult } from "@/types/query";
import { useSchemaStore } from "@stores/schemaStore";
import { useConnectionStore } from "@stores/connectionStore";

// Issue #1297 — the editability gate parses through the real sql-parser-core
// WASM AST; load the checked-in bytes so `preloadSqlWasm` resolves in jsdom
// and the Editable badge can appear.
vi.mock("@lib/sql/wasm/sql_parser_core.js", async () =>
  (await import("@lib/sql/realSqlWasmTestMock")).realSqlWasmModuleMock(),
);

const mockSave = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (opts: unknown) => mockSave(opts),
}));
const writeText = vi.fn<(text: string) => Promise<void>>(() =>
  Promise.resolve(),
);

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
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  it("shows idle prompt when status is idle", () => {
    render(<QueryResultGrid queryState={{ status: "idle" }} />);
    expect(screen.getByText(/Cmd\+Return/i)).toBeInTheDocument();
  });

  it("shows spinner when status is running", () => {
    render(
      <QueryResultGrid queryState={{ status: "running", queryId: "q1" }} />,
    );
    expect(
      screen.getByText(
        (_content, el) =>
          el?.tagName === "P" &&
          (el.textContent?.startsWith("Executing query...") ?? false),
      ),
    ).toBeInTheDocument();
    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("running state shows live elapsed time anchored to startedAt", () => {
    vi.useFakeTimers();
    const startedAt = Date.now();
    vi.setSystemTime(startedAt);
    render(
      <QueryResultGrid
        queryState={{
          status: "running",
          queryId: "q1",
          startedAt,
        }}
      />,
    );
    // Initial render: ~0.0s elapsed.
    expect(screen.getByText(/Executing query\.\.\. 0\.0s/)).toBeInTheDocument();
    // After 5s the timer text reflects the elapsed duration.
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByText(/Executing query\.\.\. 5\.0s/)).toBeInTheDocument();
    vi.useRealTimers();
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

  // #1060 — permission-denied errors get a dedicated centered state (title +
  // "ask your DBA" guidance) sharing #1056's classifyDriverError mapping.
  it.each([
    ["pg 42501", "permission denied for table users (42501)"],
    [
      "mysql 1142",
      "ERROR 1142: SELECT command denied to user 'app'@'%' for table 'users'",
    ],
  ])("renders dedicated permission-denied state for %s", (_label, error) => {
    render(<QueryResultGrid queryState={{ status: "error", error }} />);
    const state = screen.getByTestId("query-permission-denied-state");
    expect(state).toHaveTextContent(/Permission denied/i);
    expect(state).toHaveTextContent(/database administrator/i);
    expect(state).toHaveTextContent(error);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does NOT render permission-denied state for a generic error", () => {
    render(
      <QueryResultGrid
        queryState={{ status: "error", error: "syntax error near 'FROM'" }}
      />,
    );
    expect(
      screen.queryByTestId("query-permission-denied-state"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("syntax error");
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

  it("exposes copy and export actions for scalar results", async () => {
    const countResult: QueryResult = {
      columns: [{ name: "count", dataType: "Int64", category: "int" }],
      rows: [[42]],
      totalCount: 1,
      executionTimeMs: 3,
      queryType: "select",
      resultKind: "scalar",
    };
    render(
      <QueryResultGrid
        queryState={{ status: "completed", result: countResult }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /copy result values/i }),
    );
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("42");
    });

    await userEvent.click(screen.getByRole("button", { name: /export/i }));
    expect(
      await screen.findByRole("menuitem", { name: /CSV/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /TSV/i })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /SQL INSERT/i }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("disables copy and export for empty findOne scalar results", () => {
    const emptyResult: QueryResult = {
      columns: [],
      rows: [],
      totalCount: 0,
      executionTimeMs: 2,
      queryType: "select",
      resultKind: "scalar",
    };
    render(
      <QueryResultGrid
        queryState={{ status: "completed", result: emptyResult }}
      />,
    );

    expect(
      screen.getByRole("button", { name: /copy result values/i }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: /export/i })).toBeDisabled();
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

  // Purpose: edit-ability must be judged against the EXECUTED SQL snapshot
  // stored on `queryState.completed.sql`, not the live `sql` prop. The store
  // snapshot survives a QueryTab remount (tab switch) where the pre-fix
  // component-local approach reset and fell back to the live editor text,
  // which could flip a JOIN result to falsely-editable → wrong-row write.
  // PR #1236 review, issue #1226 (2026-07-03).
  it("judges edit-ability on queryState.sql snapshot, ignoring a live JOIN prop", async () => {
    render(
      <QueryResultGrid
        queryState={{
          status: "completed",
          result: SELECT_RESULT,
          sql: "SELECT id, name FROM public.users",
        }}
        connectionId="conn1"
        database="db1"
        // Live editor text (parent passes it) is a JOIN — must be ignored.
        sql="SELECT * FROM users u JOIN orders o ON u.id = o.uid"
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/Editable/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Read-only/)).not.toBeInTheDocument();
  });

  it("keeps a JOIN result read-only even when the live sql prop is single-table", () => {
    render(
      <QueryResultGrid
        queryState={{
          status: "completed",
          result: SELECT_RESULT,
          sql: "SELECT * FROM users u JOIN orders o ON u.id = o.uid",
        }}
        connectionId="conn1"
        // Live editor was edited to a single-table SELECT after the JOIN run —
        // must NOT make the already-shown JOIN result editable.
        sql="SELECT id, name FROM users"
      />,
    );
    expect(screen.getByText(/Read-only/)).toBeInTheDocument();
    expect(screen.getByText(/single-table/)).toBeInTheDocument();
    expect(screen.queryByText(/Editable/)).not.toBeInTheDocument();
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

    await userEvent.click(screen.getByRole("button", { name: /export/i }));
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

    await userEvent.click(screen.getByRole("button", { name: /export/i }));
    await act(async () => {
      await userEvent.click(
        await screen.findByRole("menuitem", { name: /CSV/i }),
      );
    });

    expect(exportGridRows).toHaveBeenCalledWith(
      "csv",
      "/tmp/sales.csv",
      ["id", "name"],
      [
        [1, "Alice"],
        [2, null],
      ],
      { kind: "query", source_table: null },
      // #1269 — ExportButton now mints a cancel-token id per run so the Stop
      // button can abort the export.
      expect.stringMatching(/^export-/),
    );
  });

  // Purpose: lock the QueryResultGrid → resolveDefaultSchema wiring so an
  // unqualified single-table SELECT resolves to each DBMS's real default
  // schema, not PostgreSQL "public". The 6 analyzer unit tests call the
  // resolver directly, so reverting the QueryResultGrid.tsx connection→resolver
  // wiring leaves them green — these component tests fail instead. A
  // schema-aware getTableColumns mock only yields PK metadata for the
  // *expected* schema, so a mis-resolved schema drops the result to read-only.
  // Issue #1066 (bug, area:frontend, P1).
  describe("per-DBMS default-schema wiring (#1066)", () => {
    const PK_COLUMNS = [
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
    ];

    // getTableColumns is invoked as (connId, table, schema, db); hand back PK
    // metadata only when the resolver produced `expectedSchema`, so a wrong
    // default schema yields an empty column set → not editable.
    function mockColumnsForSchema(expectedSchema: string) {
      setupTauriMock({
        getTableColumns: vi.fn(
          async (_connId: string, _table: string, schema: string) =>
            schema === expectedSchema ? PK_COLUMNS : [],
        ),
      });
    }

    function seedRdbConnection(
      id: string,
      dbType: "mssql" | "oracle" | "mysql",
      database: string,
      user: string,
    ) {
      useConnectionStore.setState({
        connections: [
          {
            id,
            name: id,
            dbType,
            host: "localhost",
            port: 1433,
            user,
            database,
            groupId: null,
            color: null,
            hasPassword: false,
            paradigm: "rdb",
          },
        ],
      });
    }

    // Reason: bug #1066 — mssql's default schema is "dbo"; the pre-fix ternary
    // resolved every non-sqlite engine to "public" so PK lookup missed the
    // cached "dbo" columns and edit judgment flipped (2026-07-03).
    it("resolves an unqualified mssql SELECT to dbo and enables editing", async () => {
      mockColumnsForSchema("dbo");
      seedRdbConnection("conn-mssql", "mssql", "master", "sa");
      render(
        <QueryResultGrid
          queryState={{ status: "completed", result: SELECT_RESULT }}
          connectionId="conn-mssql"
          database="master"
          sql="SELECT id, name FROM mytable"
        />,
      );
      await waitFor(() => {
        expect(screen.getByText(/Editable/)).toBeInTheDocument();
      });
      expect(screen.queryByText(/Read-only/)).not.toBeInTheDocument();
    });

    // Reason: bug #1066 — Oracle's default schema is the connecting user, stored
    // upper-case in the catalog; the connection user must be upper-cased before
    // matching the cached schema (2026-07-03).
    it("resolves an unqualified oracle SELECT to the upper-cased connecting user", async () => {
      mockColumnsForSchema("SYSTEM");
      seedRdbConnection("conn-oracle", "oracle", "FREEPDB1", "system");
      render(
        <QueryResultGrid
          queryState={{ status: "completed", result: SELECT_RESULT }}
          connectionId="conn-oracle"
          database="FREEPDB1"
          sql="SELECT id, name FROM mytable"
        />,
      );
      await waitFor(() => {
        expect(screen.getByText(/Editable/)).toBeInTheDocument();
      });
      expect(screen.queryByText(/Read-only/)).not.toBeInTheDocument();
    });

    // Reason: bug #1066 fail-safe — MySQL schema == database; with no active
    // database the schema is unknown, so the result must stay read-only rather
    // than risk a false-positive edit against the wrong table (2026-07-03).
    it("keeps a mysql result read-only when no active database is selected", async () => {
      mockColumnsForSchema("shop");
      seedRdbConnection("conn-mysql", "mysql", "", "root");
      render(
        <QueryResultGrid
          queryState={{ status: "completed", result: SELECT_RESULT }}
          connectionId="conn-mysql"
          database=""
          sql="SELECT id, name FROM mytable"
        />,
      );
      await waitFor(() => {
        expect(screen.getByText(/Read-only/)).toBeInTheDocument();
      });
      expect(screen.queryByText(/Editable/)).not.toBeInTheDocument();
    });

    // Reason: bug #1066 fail-safe — a quoted, case-sensitive Oracle username
    // ("MyUser") does not fold to upper-case in the catalog, so the resolver's
    // "MYUSER" misses. That mismatch must degrade to read-only (no false edit),
    // not silently edit a phantom schema (2026-07-03).
    it("keeps an oracle result read-only when the quoted username case mismatches", async () => {
      // Real catalog schema is the quoted "MyUser"; resolver yields "MYUSER".
      mockColumnsForSchema("MyUser");
      seedRdbConnection("conn-oracle-q", "oracle", "ORCLPDB", "MyUser");
      render(
        <QueryResultGrid
          queryState={{ status: "completed", result: SELECT_RESULT }}
          connectionId="conn-oracle-q"
          database="ORCLPDB"
          sql="SELECT id, name FROM mytable"
        />,
      );
      await waitFor(() => {
        expect(screen.getByText(/Read-only/)).toBeInTheDocument();
      });
      expect(screen.queryByText(/Editable/)).not.toBeInTheDocument();
    });
  });
});
