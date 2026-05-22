// Sprint 218 — `toolbar` axis split from `QueryTab.test.tsx` (P11
// step 2). Covers Sprint 25 Run / Cancel button visibility, disabled
// state, shortcut hint, and the Run button click → handleExecute path.
// Cases are byte-equivalent to the originals — no behaviour change.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { seedWorkspace } from "@/stores/__tests__/workspaceStoreTestHelpers";
import { render, screen, act } from "@testing-library/react";
import QueryTab from "./QueryTab";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { useConnectionStore } from "@stores/connectionStore";
import {
  MOCK_RESULT,
  mockExecuteQuery,
  mockCancelQuery,
  mockFindDocuments,
  mockAggregateDocuments,
  mockVerifyActiveDb,
  mockEditorProps,
  makeConn,
  makeQueryTab,
  resetQueryTabStores,
} from "./__tests__/queryTabTestHelpers";
import type { SQLDialect } from "@codemirror/lang-sql";
import type { Extension } from "@codemirror/state";

// Sprint 248 — `executeQueryDryRun` mock for the new "Dry Run" button
// path. `vi.fn()` lives at module scope so individual tests can read
// `.mock.calls` after clicking the button.
const mockExecuteQueryDryRun = vi.fn();
beforeEach(() => {
  setupTauriMock({
    executeQuery: (...args: unknown[]) => mockExecuteQuery(...args),
    cancelQuery: (...args: unknown[]) => mockCancelQuery(...args),
    findDocuments: (...args: unknown[]) => mockFindDocuments(...args),
    aggregateDocuments: (...args: unknown[]) => mockAggregateDocuments(...args),
    executeQueryDryRun: (...args: unknown[]) => mockExecuteQueryDryRun(...args),
  });
});

// Sprint 132 — the QueryTab raw-query hook calls `verifyActiveDb` after
// optimistic `setActiveDb`. The wrapper itself is unit-tested in
// `verifyActiveDb.test.ts`; here we mock it so the test can fix the
// "backend says X" return value per scenario.
vi.mock("@lib/api/verifyActiveDb", () => ({
  verifyActiveDb: (...args: unknown[]) => mockVerifyActiveDb(...args),
}));

// Sprint 139 — QueryTab now routes directly to SqlQueryEditor /
// MongoQueryEditor based on `tab.paradigm`. Both editors are mocked to a
// shared DOM testbed (`data-testid="mock-editor"`) so the existing
// fixtures keep working — the mock records `paradigm` from a synthesised
// prop so the dialect / mongo / paradigm assertions stay meaningful.
vi.mock("./SqlQueryEditor", async () => {
  const React = await import("react");
  const MockSqlQueryEditor = React.forwardRef<
    unknown,
    {
      onExecute: () => void;
      sql: string;
      sqlDialect?: SQLDialect;
    }
  >(function MockSqlQueryEditor(props) {
    mockEditorProps.lastDialect = props.sqlDialect;
    mockEditorProps.dialectHistory.push(props.sqlDialect);
    mockEditorProps.lastMongoExtensions = undefined;
    mockEditorProps.mongoExtensionsHistory.push(undefined);
    mockEditorProps.lastParadigm = "rdb";
    mockEditorProps.lastQueryMode = "sql";
    return (
      <div data-testid="mock-editor" data-paradigm="rdb" data-sql={props.sql}>
        <button data-testid="execute-btn" onClick={props.onExecute}>
          Execute
        </button>
      </div>
    );
  });
  MockSqlQueryEditor.displayName = "MockSqlQueryEditor";
  return { default: MockSqlQueryEditor };
});

vi.mock("./MongoQueryEditor", async () => {
  const React = await import("react");
  const MockMongoQueryEditor = React.forwardRef<
    unknown,
    {
      onExecute: () => void;
      sql: string;
      mongoExtensions?: readonly Extension[];
      queryMode?: string;
    }
  >(function MockMongoQueryEditor(props) {
    mockEditorProps.lastDialect = undefined;
    mockEditorProps.dialectHistory.push(undefined);
    mockEditorProps.lastMongoExtensions = props.mongoExtensions;
    mockEditorProps.mongoExtensionsHistory.push(props.mongoExtensions);
    mockEditorProps.lastParadigm = "document";
    mockEditorProps.lastQueryMode = props.queryMode;
    return (
      <div
        data-testid="mock-editor"
        data-paradigm="document"
        data-sql={props.sql}
      >
        <button data-testid="execute-btn" onClick={props.onExecute}>
          Execute
        </button>
      </div>
    );
  });
  MockMongoQueryEditor.displayName = "MockMongoQueryEditor";
  return { default: MockMongoQueryEditor };
});

vi.mock("./QueryResultGrid", () => ({
  default: ({ queryState }: { queryState: unknown }) => (
    <div data-testid="mock-result" data-status={JSON.stringify(queryState)} />
  ),
}));

vi.mock("@hooks/useSqlAutocomplete", () => ({
  useSqlAutocomplete: () => ({}),
}));

vi.mock("@lib/sql/sqlUtils", () => ({
  splitSqlStatements: (sql: string) => {
    // Simple split by semicolons for testing
    const parts = sql
      .split(";")
      .map((s: string) => s.trim())
      .filter(Boolean);
    return parts.length > 0 ? parts : [];
  },
  formatSql: (sql: string) => sql.toUpperCase(),
  uglifySql: (sql: string) => sql.replace(/\s+/g, " ").trim(),
}));

describe("QueryTab — toolbar", () => {
  beforeEach(() => {
    resetQueryTabStores();
    mockExecuteQueryDryRun.mockReset();
  });

  // ── Sprint 25: Query Editor Toolbar ──

  it("renders Run button when idle", () => {
    const tab = makeQueryTab();
    render(<QueryTab tab={tab} />);

    const runBtn = screen.getByLabelText("Run query");
    expect(runBtn).toBeInTheDocument();
    expect(runBtn).not.toBeDisabled();
  });

  it("renders Cancel button when running", () => {
    const tab = makeQueryTab({
      queryState: { status: "running", queryId: "query-1-1234" },
    });
    render(<QueryTab tab={tab} />);

    const cancelBtn = screen.getByLabelText("Cancel query");
    expect(cancelBtn).toBeInTheDocument();
  });

  it("renders non-cancellable running state for DuckDB", () => {
    const tab = makeQueryTab({
      connectionId: "duckdb-conn",
      queryState: { status: "running", queryId: "query-1-1234" },
    });
    useConnectionStore.setState({
      connections: [makeConn({ id: "duckdb-conn", dbType: "duckdb" })],
    });
    render(<QueryTab tab={tab} />);

    expect(screen.queryByLabelText("Cancel query")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Query running")).toBeDisabled();
  });

  it("disables Run button when sql is empty", () => {
    const tab = makeQueryTab({ sql: "" });
    render(<QueryTab tab={tab} />);

    const runBtn = screen.getByLabelText("Run query");
    expect(runBtn).toBeDisabled();
  });

  it("shows shortcut hint on Run button", () => {
    const tab = makeQueryTab();
    render(<QueryTab tab={tab} />);

    expect(screen.getByText("\u2318\u23CE")).toBeInTheDocument();
  });

  it("Run button click triggers handleExecute", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    const tab = makeQueryTab();
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    render(<QueryTab tab={tab} />);

    const runBtn = screen.getByLabelText("Run query");
    await act(async () => {
      runBtn.click();
    });

    // Sprint 266 — 4th arg is `expectedDatabase` (opt-in db mismatch guard).
    expect(mockExecuteQuery).toHaveBeenCalledWith(
      "conn1",
      "SELECT 1",
      expect.any(String),
      expect.any(String),
    );
  });

  // ── Sprint 248 (ADR 0022 Phase 4): Dry Run button ──

  // [AC-248-T1] rdb + idle + non-empty SQL → enabled.
  it("[AC-248-T1] renders Dry Run button enabled for rdb + idle + non-empty SQL", () => {
    const tab = makeQueryTab();
    render(<QueryTab tab={tab} />);

    const dryRunBtn = screen.getByLabelText("Dry run query");
    expect(dryRunBtn).toBeInTheDocument();
    expect(dryRunBtn).not.toBeDisabled();
    // Shortcut hint surfaced for keyboard discoverability.
    expect(dryRunBtn).toHaveAttribute(
      "title",
      expect.stringContaining("Cmd+Shift+Enter"),
    );
  });

  // [AC-248-T2] document paradigm → button is not rendered at all
  // (Mongo has no dry-run IPC; the affordance was a dead surface).
  it("[AC-248-T2] hides Dry Run button on document paradigm", () => {
    const tab = makeQueryTab({
      paradigm: "document",
      queryMode: "find",
      sql: "{}",
      database: "test",
      collection: "users",
    });
    render(<QueryTab tab={tab} />);

    expect(screen.queryByLabelText("Dry run query")).toBeNull();
  });

  // [AC-248-T3] running queryState → disabled.
  it("[AC-248-T3] disables Dry Run button when running", () => {
    const tab = makeQueryTab({
      queryState: { status: "running", queryId: "q-1" },
    });
    render(<QueryTab tab={tab} />);

    const dryRunBtn = screen.getByLabelText("Dry run query");
    expect(dryRunBtn).toBeDisabled();
  });

  // [AC-248-T4] click triggers `executeQueryDryRun` IPC (i.e. the
  // `onDryRun` callback fires).
  it("[AC-248-T4] click triggers handleDryRun → executeQueryDryRun IPC", async () => {
    mockExecuteQueryDryRun.mockResolvedValueOnce([
      {
        columns: [],
        rows: [],
        totalCount: 0,
        executionTimeMs: 1,
        queryType: { dml: { rows_affected: 0 } },
      },
    ]);
    const tab = makeQueryTab({ sql: "DELETE FROM users WHERE id = 1" });
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    render(<QueryTab tab={tab} />);

    const dryRunBtn = screen.getByLabelText("Dry run query");
    await act(async () => {
      dryRunBtn.click();
    });

    expect(mockExecuteQueryDryRun).toHaveBeenCalledTimes(1);
    // Sprint 271b — workspaceDb is now forwarded as the 4th positional
    // `expectedDatabase`. `seedWorkspace` aligns the connection store
    // with the seeded tab; without an explicit `database` the default
    // workspace db is `DEFAULT_TEST_DB === "db1"`.
    expect(mockExecuteQueryDryRun).toHaveBeenCalledWith(
      "conn1",
      ["DELETE FROM users WHERE id = 1"],
      expect.stringMatching(/^dry:/),
      "db1",
    );
    // Real-execute path NEVER fires for dry-run clicks.
    expect(mockExecuteQuery).not.toHaveBeenCalled();
  });
});
