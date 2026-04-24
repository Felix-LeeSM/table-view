import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import {
  MySQL,
  PostgreSQL,
  SQLite,
  StandardSQL,
  type SQLDialect,
} from "@codemirror/lang-sql";
import type { Extension } from "@codemirror/state";
import QueryTab from "./QueryTab";
import { useTabStore, type QueryTab as QueryTabType } from "@stores/tabStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { useConnectionStore } from "@stores/connectionStore";
import {
  useDocumentStore,
  __resetDocumentStoreForTests,
} from "@stores/documentStore";
import type { ConnectionConfig, DatabaseType } from "@/types/connection";
import type { QueryResult } from "@/types/query";

const MOCK_RESULT: QueryResult = {
  columns: [
    { name: "id", data_type: "integer" },
    { name: "name", data_type: "text" },
  ],
  rows: [[1, "Alice"]],
  total_count: 1,
  execution_time_ms: 5,
  query_type: "select",
};

const mockExecuteQuery = vi.fn();
const mockCancelQuery = vi.fn();
const mockFindDocuments = vi.fn();
const mockAggregateDocuments = vi.fn();

vi.mock("@lib/tauri", () => ({
  executeQuery: (...args: unknown[]) => mockExecuteQuery(...args),
  cancelQuery: (...args: unknown[]) => mockCancelQuery(...args),
  findDocuments: (...args: unknown[]) => mockFindDocuments(...args),
  aggregateDocuments: (...args: unknown[]) => mockAggregateDocuments(...args),
}));

/**
 * Shared ref the tests read to assert which SQLDialect the real QueryTab
 * passed down to QueryEditor. Using a module-level holder (instead of adding
 * a DOM attribute) keeps the dialect object reference intact so the test
 * can compare with `toBe(MySQL)` etc.
 *
 * Sprint 83 — also records the `mongoExtensions` prop so tests can assert
 * on the extension array identity, length, and hook-provided structure
 * without constructing a real CodeMirror view.
 */
const mockEditorProps: {
  lastDialect: SQLDialect | undefined;
  dialectHistory: (SQLDialect | undefined)[];
  lastMongoExtensions: readonly Extension[] | undefined;
  mongoExtensionsHistory: (readonly Extension[] | undefined)[];
  lastParadigm: string | undefined;
  lastQueryMode: string | undefined;
} = {
  lastDialect: undefined,
  dialectHistory: [],
  lastMongoExtensions: undefined,
  mongoExtensionsHistory: [],
  lastParadigm: undefined,
  lastQueryMode: undefined,
};

vi.mock("./QueryEditor", async () => {
  const React = await import("react");
  // Tests target the editor through the DOM (data-testid), so the forwarded
  // ref is intentionally ignored — the real QueryEditor uses useImperativeHandle
  // to expose the CodeMirror view, which we don't need here.
  const MockQueryEditor = React.forwardRef<
    unknown,
    {
      onExecute: () => void;
      sql: string;
      sqlDialect?: SQLDialect;
      mongoExtensions?: readonly Extension[];
      paradigm?: string;
      queryMode?: string;
    }
  >(function MockQueryEditor(props) {
    mockEditorProps.lastDialect = props.sqlDialect;
    mockEditorProps.dialectHistory.push(props.sqlDialect);
    mockEditorProps.lastMongoExtensions = props.mongoExtensions;
    mockEditorProps.mongoExtensionsHistory.push(props.mongoExtensions);
    mockEditorProps.lastParadigm = props.paradigm;
    mockEditorProps.lastQueryMode = props.queryMode;
    return (
      <div data-testid="mock-editor" data-sql={props.sql}>
        <button data-testid="execute-btn" onClick={props.onExecute}>
          Execute
        </button>
      </div>
    );
  });
  MockQueryEditor.displayName = "MockQueryEditor";
  return { default: MockQueryEditor };
});

vi.mock("./QueryResultGrid", () => ({
  default: ({ queryState }: { queryState: unknown }) => (
    <div data-testid="mock-result" data-status={JSON.stringify(queryState)} />
  ),
}));

vi.mock("@hooks/useSqlAutocomplete", () => ({
  useSqlAutocomplete: () => ({}),
}));

vi.mock("@lib/sqlUtils", () => ({
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

function makeQueryTab(overrides: Partial<QueryTabType> = {}): QueryTabType {
  return {
    type: "query",
    id: "query-1",
    title: "Query 1",
    connectionId: "conn1",
    closable: true,
    sql: "SELECT 1",
    queryState: { status: "idle" },
    paradigm: "rdb",
    queryMode: "sql",
    ...overrides,
  };
}

function makeConn(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  const dbType: DatabaseType = overrides.db_type ?? "postgresql";
  return {
    id: "conn1",
    name: "Test",
    db_type: dbType,
    host: "localhost",
    port: 5432,
    user: "postgres",
    database: "db",
    group_id: null,
    color: null,
    has_password: false,
    paradigm: "rdb",
    ...overrides,
  };
}

describe("QueryTab", () => {
  beforeEach(() => {
    useTabStore.setState({ tabs: [], activeTabId: null });
    useQueryHistoryStore.setState({ entries: [] });
    useConnectionStore.setState({ connections: [] });
    mockExecuteQuery.mockReset();
    mockCancelQuery.mockReset();
    mockFindDocuments.mockReset();
    mockAggregateDocuments.mockReset();
    mockEditorProps.lastDialect = undefined;
    mockEditorProps.dialectHistory = [];
    mockEditorProps.lastMongoExtensions = undefined;
    mockEditorProps.mongoExtensionsHistory = [];
    mockEditorProps.lastParadigm = undefined;
    mockEditorProps.lastQueryMode = undefined;
    __resetDocumentStoreForTests();
  });

  it("renders editor and result grid in idle state", () => {
    const tab = makeQueryTab();
    render(<QueryTab tab={tab} />);

    expect(screen.getByTestId("mock-editor")).toBeInTheDocument();
    expect(screen.getByTestId("mock-result")).toBeInTheDocument();
    expect(screen.getByTestId("mock-editor")).toHaveAttribute(
      "data-sql",
      "SELECT 1",
    );
  });

  it("executes query and transitions to completed", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    const tab = makeQueryTab();
    // Add the tab to the store so updateQueryState works
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    const executeBtn = screen.getByTestId("execute-btn");
    await act(async () => {
      executeBtn.click();
    });

    // Should call executeQuery with correct args
    expect(mockExecuteQuery).toHaveBeenCalledWith(
      "conn1",
      "SELECT 1",
      expect.any(String),
    );

    // Wait for async completion
    await waitFor(() => {
      const state = useTabStore.getState();
      const updatedTab = state.tabs.find((t) => t.id === "query-1");
      expect(updatedTab).toBeDefined();
      if (updatedTab && updatedTab.type === "query") {
        expect(updatedTab.queryState.status).toBe("completed");
      }
    });
  });

  it("handles query execution error", async () => {
    mockExecuteQuery.mockRejectedValueOnce(new Error("Syntax error"));
    const tab = makeQueryTab();
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    const executeBtn = screen.getByTestId("execute-btn");
    await act(async () => {
      executeBtn.click();
    });

    await waitFor(() => {
      const state = useTabStore.getState();
      const updatedTab = state.tabs.find((t) => t.id === "query-1");
      if (updatedTab && updatedTab.type === "query") {
        expect(updatedTab.queryState.status).toBe("error");
        if (updatedTab.queryState.status === "error") {
          expect(updatedTab.queryState.error).toContain("Syntax error");
        }
      }
    });
  });

  it("does not execute empty SQL", async () => {
    const tab = makeQueryTab({ sql: "   " });
    render(<QueryTab tab={tab} />);

    const executeBtn = screen.getByTestId("execute-btn");
    await act(async () => {
      executeBtn.click();
    });

    expect(mockExecuteQuery).not.toHaveBeenCalled();
  });

  it("cancels running query on cancel-query event", async () => {
    mockCancelQuery.mockResolvedValueOnce("Cancelled");
    const tab = makeQueryTab({
      queryState: { status: "running", queryId: "query-1-1234" },
    });
    render(<QueryTab tab={tab} />);

    // First add the tab to the store so the component can find it
    useTabStore.setState({
      tabs: [tab],
      activeTabId: "query-1",
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent("cancel-query", {
          detail: { queryId: "query-1-1234" },
        }),
      );
    });

    expect(mockCancelQuery).toHaveBeenCalledWith("query-1-1234");
  });

  it("ignores cancel-query for different queryId", () => {
    const tab = makeQueryTab({
      queryState: { status: "running", queryId: "query-1-1234" },
    });
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("cancel-query", {
          detail: { queryId: "different-id" },
        }),
      );
    });

    expect(mockCancelQuery).not.toHaveBeenCalled();
  });

  it("result area is a flex column so the inner table can scroll", () => {
    const tab = makeQueryTab();
    render(<QueryTab tab={tab} />);

    // The result wrapper is the parent of the mocked QueryResultGrid.
    const wrapper = screen.getByTestId("mock-result").parentElement!;
    expect(wrapper.className).toMatch(/\bflex\b/);
    expect(wrapper.className).toMatch(/\bflex-col\b/);
    expect(wrapper.className).toMatch(/\boverflow-hidden\b/);
    expect(wrapper.className).toMatch(/\bmin-h-0\b/);
  });

  it("renders resize handle between editor and result", () => {
    const tab = makeQueryTab();
    render(<QueryTab tab={tab} />);

    // The resize handle is a sibling of the editor's parent
    const editorWrapper = screen.getByTestId("mock-editor").parentElement!;
    const outerContainer = editorWrapper.parentElement!;
    const resizeHandle = outerContainer.querySelector(".cursor-row-resize");
    expect(resizeHandle).toBeInTheDocument();
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
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    const runBtn = screen.getByLabelText("Run query");
    await act(async () => {
      runBtn.click();
    });

    expect(mockExecuteQuery).toHaveBeenCalledWith(
      "conn1",
      "SELECT 1",
      expect.any(String),
    );
  });

  // ── Sprint 36: Multi-Statement Execution ──

  it("executes multiple statements sequentially", async () => {
    const secondResult: QueryResult = {
      columns: [{ name: "n", data_type: "integer" }],
      rows: [[42]],
      total_count: 1,
      execution_time_ms: 2,
      query_type: "select",
    };
    mockExecuteQuery
      .mockResolvedValueOnce(MOCK_RESULT)
      .mockResolvedValueOnce(secondResult);

    const tab = makeQueryTab({ sql: "SELECT 1; SELECT 2" });
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    const executeBtn = screen.getByTestId("execute-btn");
    await act(async () => {
      executeBtn.click();
    });

    // Should be called twice — once for each statement
    await waitFor(() => {
      expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
    });
    expect(mockExecuteQuery).toHaveBeenNthCalledWith(
      1,
      "conn1",
      "SELECT 1",
      expect.any(String),
    );
    expect(mockExecuteQuery).toHaveBeenNthCalledWith(
      2,
      "conn1",
      "SELECT 2",
      expect.any(String),
    );

    // Final state should show the last result
    await waitFor(() => {
      const state = useTabStore.getState();
      const updatedTab = state.tabs.find((t) => t.id === "query-1");
      if (updatedTab && updatedTab.type === "query") {
        expect(updatedTab.queryState.status).toBe("completed");
      }
    });
  });

  it("combines errors from multi-statement execution", async () => {
    mockExecuteQuery
      .mockResolvedValueOnce(MOCK_RESULT)
      .mockRejectedValueOnce(new Error("Table not found"));

    const tab = makeQueryTab({ sql: "SELECT 1; DROP TABLE nope" });
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    const executeBtn = screen.getByTestId("execute-btn");
    await act(async () => {
      executeBtn.click();
    });

    await waitFor(() => {
      const state = useTabStore.getState();
      const updatedTab = state.tabs.find((t) => t.id === "query-1");
      if (updatedTab && updatedTab.type === "query") {
        expect(updatedTab.queryState.status).toBe("error");
        if (updatedTab.queryState.status === "error") {
          expect(updatedTab.queryState.error).toContain("Table not found");
        }
      }
    });
  });

  // ── Sprint 34: Query History ──

  it("adds entry to history after successful query execution", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    const tab = makeQueryTab();
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    const executeBtn = screen.getByTestId("execute-btn");
    await act(async () => {
      executeBtn.click();
    });

    await waitFor(() => {
      const history = useQueryHistoryStore.getState().entries;
      expect(history).toHaveLength(1);
      expect(history[0]!.sql).toBe("SELECT 1");
      expect(history[0]!.status).toBe("success");
      expect(history[0]!.connectionId).toBe("conn1");
    });
  });

  it("adds entry to history after failed query execution", async () => {
    mockExecuteQuery.mockRejectedValueOnce(new Error("Syntax error"));
    const tab = makeQueryTab();
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    const executeBtn = screen.getByTestId("execute-btn");
    await act(async () => {
      executeBtn.click();
    });

    await waitFor(() => {
      const history = useQueryHistoryStore.getState().entries;
      expect(history).toHaveLength(1);
      expect(history[0]!.sql).toBe("SELECT 1");
      expect(history[0]!.status).toBe("error");
    });
  });

  it("history panel shows entries with SQL and execution time", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    const tab = makeQueryTab();
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    const executeBtn = screen.getByTestId("execute-btn");
    await act(async () => {
      executeBtn.click();
    });

    // Wait for history entry to be added
    await waitFor(() => {
      expect(useQueryHistoryStore.getState().entries).toHaveLength(1);
    });

    // Expand the history panel
    const historyToggle = screen.getByText(/History \(1\)/);
    await act(async () => {
      historyToggle.click();
    });

    // History rows render SQL via the SqlSyntax component, which splits the
    // text across multiple tokenised spans. The SQL itself is still present —
    // the row `<li>` contains the concatenated text. The Load button carries
    // the full SQL in its aria-label for accessibility + test targeting.
    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: /Load query into editor: SELECT 1/,
        }),
      ).toBeInTheDocument();
    });
  });

  it("history row text is selectable (not wrapped in a button)", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    const tab = makeQueryTab();
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });
    await waitFor(() => {
      expect(useQueryHistoryStore.getState().entries).toHaveLength(1);
    });
    await act(async () => {
      screen.getByText(/History \(1\)/).click();
    });

    // The row itself must NOT be a button — otherwise the browser suppresses
    // text selection inside it, which was the original drag-to-copy bug.
    const loadBtn = screen.getByRole("button", {
      name: /Load query into editor: SELECT 1/,
    });
    const row = loadBtn.closest("li");
    expect(row).not.toBeNull();
    expect(row?.tagName).toBe("LI");
    // The SQL preview span carries `select-text` so users can drag to copy.
    expect(row?.querySelector(".select-text")).toBeInTheDocument();
  });

  it("clicking the Load button on a history row updates editor SQL", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    const tab = makeQueryTab();
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });
    await waitFor(() => {
      expect(useQueryHistoryStore.getState().entries).toHaveLength(1);
    });
    await act(async () => {
      screen.getByText(/History \(1\)/).click();
    });

    const loadBtn = screen.getByRole("button", {
      name: /Load query into editor: SELECT 1/,
    });
    await act(async () => {
      loadBtn.click();
    });

    const state = useTabStore.getState();
    const updatedTab = state.tabs.find((t) => t.id === "query-1");
    if (updatedTab && updatedTab.type === "query") {
      expect(updatedTab.sql).toBe("SELECT 1");
    }
  });

  it("double-clicking a history row updates editor SQL", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    const tab = makeQueryTab({ sql: "SELECT 2" });
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });
    await waitFor(() => {
      expect(useQueryHistoryStore.getState().entries).toHaveLength(1);
    });
    await act(async () => {
      screen.getByText(/History \(1\)/).click();
    });

    const loadBtn = screen.getByRole("button", {
      name: /Load query into editor: SELECT 2/,
    });
    const row = loadBtn.closest("li")!;
    await act(async () => {
      row.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      );
    });

    const state = useTabStore.getState();
    const updatedTab = state.tabs.find((t) => t.id === "query-1");
    if (updatedTab && updatedTab.type === "query") {
      expect(updatedTab.sql).toBe("SELECT 2");
    }
  });

  it("clear history removes all entries", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    const tab = makeQueryTab();
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    const executeBtn = screen.getByTestId("execute-btn");
    await act(async () => {
      executeBtn.click();
    });

    await waitFor(() => {
      expect(useQueryHistoryStore.getState().entries).toHaveLength(1);
    });

    const clearBtn = screen.getByLabelText("Clear history");
    await act(async () => {
      clearBtn.click();
    });

    expect(useQueryHistoryStore.getState().entries).toHaveLength(0);
  });

  // ── Format SQL event ──

  it("formats SQL on format-sql event when tab is active", async () => {
    const tab = makeQueryTab({ sql: "select * from users" });
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    act(() => {
      window.dispatchEvent(new CustomEvent("format-sql"));
    });

    // Check that the SQL was formatted (our mock uppercases it)
    const state = useTabStore.getState();
    const updatedTab = state.tabs.find((t) => t.id === "query-1");
    if (updatedTab && updatedTab.type === "query") {
      expect(updatedTab.sql).toBe("SELECT * FROM USERS");
    }
  });

  it("ignores format-sql event when tab is not active", () => {
    const tab = makeQueryTab({ sql: "select * from users" });
    useTabStore.setState({ tabs: [tab], activeTabId: "other-tab" });
    render(<QueryTab tab={tab} />);

    act(() => {
      window.dispatchEvent(new CustomEvent("format-sql"));
    });

    // SQL should remain unchanged
    const state = useTabStore.getState();
    const updatedTab = state.tabs.find((t) => t.id === "query-1");
    if (updatedTab && updatedTab.type === "query") {
      expect(updatedTab.sql).toBe("select * from users");
    }
  });

  it("ignores format-sql event when SQL is empty", () => {
    const tab = makeQueryTab({ sql: "   " });
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    act(() => {
      window.dispatchEvent(new CustomEvent("format-sql"));
    });

    // SQL should remain unchanged (whitespace-only)
    const state = useTabStore.getState();
    const updatedTab = state.tabs.find((t) => t.id === "query-1");
    if (updatedTab && updatedTab.type === "query") {
      expect(updatedTab.sql).toBe("   ");
    }
  });

  // ── Cancel button ──

  it("calls cancelQuery when Cancel button is clicked during running state", async () => {
    mockCancelQuery.mockResolvedValueOnce("Cancelled");
    const tab = makeQueryTab({
      queryState: { status: "running", queryId: "query-1-1234" },
    });
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    const cancelBtn = screen.getByLabelText("Cancel query");
    await act(async () => {
      cancelBtn.click();
    });

    expect(mockCancelQuery).toHaveBeenCalledWith("query-1-1234");
  });

  it("handles cancelQuery failure gracefully", async () => {
    mockCancelQuery.mockRejectedValueOnce(new Error("Already completed"));
    const tab = makeQueryTab({
      queryState: { status: "running", queryId: "query-1-1234" },
    });
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    const cancelBtn = screen.getByLabelText("Cancel query");
    // Should not throw
    await act(async () => {
      cancelBtn.click();
    });

    expect(mockCancelQuery).toHaveBeenCalledWith("query-1-1234");
  });

  it("handles cancel-query event when cancelQuery rejects", async () => {
    mockCancelQuery.mockRejectedValueOnce(new Error("Already done"));
    const tab = makeQueryTab({
      queryState: { status: "running", queryId: "query-1-1234" },
    });
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    // Should not throw even though cancelQuery rejects
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("cancel-query", {
          detail: { queryId: "query-1-1234" },
        }),
      );
    });

    expect(mockCancelQuery).toHaveBeenCalledWith("query-1-1234");
  });

  // ── Multi-statement history recording ──

  it("records error history when some multi-statements fail", async () => {
    mockExecuteQuery
      .mockResolvedValueOnce(MOCK_RESULT)
      .mockRejectedValueOnce(new Error("Table not found"));

    const tab = makeQueryTab({ sql: "SELECT 1; DROP TABLE nope" });
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    const executeBtn = screen.getByTestId("execute-btn");
    await act(async () => {
      executeBtn.click();
    });

    await waitFor(() => {
      const history = useQueryHistoryStore.getState().entries;
      expect(history).toHaveLength(1);
      expect(history[0]!.status).toBe("error");
      expect(history[0]!.sql).toBe("SELECT 1; DROP TABLE nope");
    });
  });

  it("records success history for all-success multi-statements", async () => {
    const secondResult: QueryResult = {
      columns: [{ name: "n", data_type: "integer" }],
      rows: [[42]],
      total_count: 1,
      execution_time_ms: 2,
      query_type: "select",
    };
    mockExecuteQuery
      .mockResolvedValueOnce(MOCK_RESULT)
      .mockResolvedValueOnce(secondResult);

    const tab = makeQueryTab({ sql: "SELECT 1; SELECT 2" });
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    const executeBtn = screen.getByTestId("execute-btn");
    await act(async () => {
      executeBtn.click();
    });

    await waitFor(() => {
      const history = useQueryHistoryStore.getState().entries;
      expect(history).toHaveLength(1);
      expect(history[0]!.status).toBe("success");
      expect(history[0]!.sql).toBe("SELECT 1; SELECT 2");
    });
  });

  // ── Error with non-Error object ──

  it("handles non-Error rejection in single statement", async () => {
    mockExecuteQuery.mockRejectedValueOnce("string error");
    const tab = makeQueryTab();
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    const executeBtn = screen.getByTestId("execute-btn");
    await act(async () => {
      executeBtn.click();
    });

    await waitFor(() => {
      const state = useTabStore.getState();
      const updatedTab = state.tabs.find((t) => t.id === "query-1");
      if (updatedTab && updatedTab.type === "query") {
        expect(updatedTab.queryState.status).toBe("error");
        if (updatedTab.queryState.status === "error") {
          expect(updatedTab.queryState.error).toBe("string error");
        }
      }
    });
  });

  it("handles non-Error rejection in multi-statement execution", async () => {
    mockExecuteQuery
      .mockResolvedValueOnce(MOCK_RESULT)
      .mockRejectedValueOnce("raw error");

    const tab = makeQueryTab({ sql: "SELECT 1; DROP TABLE nope" });
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    const executeBtn = screen.getByTestId("execute-btn");
    await act(async () => {
      executeBtn.click();
    });

    await waitFor(() => {
      const state = useTabStore.getState();
      const updatedTab = state.tabs.find((t) => t.id === "query-1");
      if (updatedTab && updatedTab.type === "query") {
        expect(updatedTab.queryState.status).toBe("error");
        if (updatedTab.queryState.status === "error") {
          expect(updatedTab.queryState.error).toContain("raw error");
        }
      }
    });
  });

  // -- Sprint 53: Uglify SQL event --

  it("uglifies SQL on uglify-sql event when tab is active", () => {
    const tab = makeQueryTab({ sql: "SELECT  id\n  FROM  users" });
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    act(() => {
      window.dispatchEvent(new CustomEvent("uglify-sql"));
    });

    const state = useTabStore.getState();
    const updatedTab = state.tabs.find((t) => t.id === "query-1");
    if (updatedTab && updatedTab.type === "query") {
      expect(updatedTab.sql).toBe("SELECT id FROM users");
    }
  });

  it("ignores uglify-sql event when tab is not active", () => {
    const tab = makeQueryTab({ sql: "SELECT  id\n  FROM  users" });
    useTabStore.setState({ tabs: [tab], activeTabId: "other-tab" });
    render(<QueryTab tab={tab} />);

    act(() => {
      window.dispatchEvent(new CustomEvent("uglify-sql"));
    });

    const state = useTabStore.getState();
    const updatedTab = state.tabs.find((t) => t.id === "query-1");
    if (updatedTab && updatedTab.type === "query") {
      expect(updatedTab.sql).toBe("SELECT  id\n  FROM  users");
    }
  });

  it("ignores uglify-sql event when SQL is empty", () => {
    const tab = makeQueryTab({ sql: "   " });
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    act(() => {
      window.dispatchEvent(new CustomEvent("uglify-sql"));
    });

    const state = useTabStore.getState();
    const updatedTab = state.tabs.find((t) => t.id === "query-1");
    if (updatedTab && updatedTab.type === "query") {
      expect(updatedTab.sql).toBe("   ");
    }
  });

  // ── Sprint 73: Document paradigm (Find / Aggregate) branches ─────────────

  const MOCK_DOC_RESULT = {
    columns: [
      { name: "_id", data_type: "objectId" },
      { name: "name", data_type: "string" },
    ],
    rows: [[1, "Alice"]],
    raw_documents: [{ _id: 1, name: "Alice" }],
    total_count: 1,
    execution_time_ms: 4,
  };

  function makeDocTab(overrides: Partial<QueryTabType> = {}): QueryTabType {
    return makeQueryTab({
      connectionId: "conn-mongo",
      sql: "{}",
      paradigm: "document",
      queryMode: "find",
      database: "table_view_test",
      collection: "users",
      ...overrides,
    });
  }

  it("rdb paradigm routes handleExecute through executeQuery (regression)", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    const tab = makeQueryTab();
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    expect(mockExecuteQuery).toHaveBeenCalled();
    expect(mockFindDocuments).not.toHaveBeenCalled();
    expect(mockAggregateDocuments).not.toHaveBeenCalled();
  });

  it("document+find calls findDocuments with the parsed filter", async () => {
    mockFindDocuments.mockResolvedValueOnce(MOCK_DOC_RESULT);
    const tab = makeDocTab({ sql: '{"active":true}' });
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    expect(mockExecuteQuery).not.toHaveBeenCalled();
    expect(mockAggregateDocuments).not.toHaveBeenCalled();
    expect(mockFindDocuments).toHaveBeenCalledTimes(1);
    expect(mockFindDocuments).toHaveBeenCalledWith(
      "conn-mongo",
      "table_view_test",
      "users",
      { filter: { active: true } },
    );

    await waitFor(() => {
      const state = useTabStore.getState();
      const updated = state.tabs.find((t) => t.id === "query-1");
      if (updated && updated.type === "query") {
        expect(updated.queryState.status).toBe("completed");
      }
    });
  });

  it("document+find accepts a full FindBody shape when the user wraps filter themselves", async () => {
    mockFindDocuments.mockResolvedValueOnce(MOCK_DOC_RESULT);
    const tab = makeDocTab({
      sql: '{"filter":{"active":true},"sort":{"name":1},"limit":10}',
    });
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    expect(mockFindDocuments).toHaveBeenCalledWith(
      "conn-mongo",
      "table_view_test",
      "users",
      { filter: { active: true }, sort: { name: 1 }, limit: 10 },
    );
  });

  it("document+aggregate calls aggregateDocuments with the pipeline array", async () => {
    mockAggregateDocuments.mockResolvedValueOnce(MOCK_DOC_RESULT);
    const tab = makeDocTab({
      queryMode: "aggregate",
      sql: '[{"$match":{"active":true}},{"$limit":10}]',
    });
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    expect(mockFindDocuments).not.toHaveBeenCalled();
    expect(mockExecuteQuery).not.toHaveBeenCalled();
    expect(mockAggregateDocuments).toHaveBeenCalledTimes(1);
    expect(mockAggregateDocuments).toHaveBeenCalledWith(
      "conn-mongo",
      "table_view_test",
      "users",
      [{ $match: { active: true } }, { $limit: 10 }],
    );
  });

  it("surfaces an Invalid JSON error when the body can't be parsed", async () => {
    const tab = makeDocTab({ sql: "{not valid}" });
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    expect(mockFindDocuments).not.toHaveBeenCalled();
    expect(mockAggregateDocuments).not.toHaveBeenCalled();

    // The store's queryState is what QueryResultGrid reads in production —
    // validating that the error message lands there (with a recognisable
    // "Invalid JSON" prefix) covers the AC-08 contract without requiring
    // the mocked QueryResultGrid to observe prop changes.
    await waitFor(() => {
      const state = useTabStore.getState();
      const updated = state.tabs.find((t) => t.id === "query-1");
      expect(updated?.type).toBe("query");
      if (updated?.type === "query") {
        expect(updated.queryState.status).toBe("error");
        if (updated.queryState.status === "error") {
          expect(updated.queryState.error).toMatch(/Invalid JSON/);
        }
      }
    });
  });

  it("rejects a find body that is not a JSON object", async () => {
    const tab = makeDocTab({ sql: "[1,2,3]" });
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    expect(mockFindDocuments).not.toHaveBeenCalled();
    await waitFor(() => {
      const state = useTabStore.getState();
      const updated = state.tabs.find((t) => t.id === "query-1");
      if (updated?.type === "query" && updated.queryState.status === "error") {
        expect(updated.queryState.error).toMatch(/Find body/);
      }
    });
  });

  it("rejects an aggregate body that is not an array of stage objects", async () => {
    const tab = makeDocTab({
      queryMode: "aggregate",
      sql: '{"$match":{}}',
    });
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    expect(mockAggregateDocuments).not.toHaveBeenCalled();
    await waitFor(() => {
      const state = useTabStore.getState();
      const updated = state.tabs.find((t) => t.id === "query-1");
      if (updated?.type === "query" && updated.queryState.status === "error") {
        expect(updated.queryState.error).toMatch(/Pipeline/);
      }
    });
  });

  it("errors out when a document tab is missing database/collection context", async () => {
    const tab = makeDocTab({ database: undefined, collection: undefined });
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    expect(mockFindDocuments).not.toHaveBeenCalled();
    await waitFor(() => {
      const state = useTabStore.getState();
      const updated = state.tabs.find((t) => t.id === "query-1");
      if (updated?.type === "query" && updated.queryState.status === "error") {
        expect(updated.queryState.error).toMatch(/database and collection/);
      }
    });
  });

  it("renders the Find | Aggregate toggle only for document paradigm", () => {
    const rdbTab = makeQueryTab();
    const { rerender } = render(<QueryTab tab={rdbTab} />);
    expect(screen.queryByLabelText("Find mode")).toBeNull();
    expect(screen.queryByLabelText("Aggregate mode")).toBeNull();

    const docTab = makeDocTab({ id: "query-1" });
    useTabStore.setState({ tabs: [docTab], activeTabId: "query-1" });
    rerender(<QueryTab tab={docTab} />);
    expect(screen.getByLabelText("Find mode")).toBeInTheDocument();
    expect(screen.getByLabelText("Aggregate mode")).toBeInTheDocument();
  });

  it("clicking the Aggregate toggle calls setQueryMode and flips tab state", async () => {
    const tab = makeDocTab({ queryMode: "find" });
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByLabelText("Aggregate mode").click();
    });

    const state = useTabStore.getState();
    const updated = state.tabs.find((t) => t.id === "query-1");
    if (updated?.type === "query") {
      expect(updated.queryMode).toBe("aggregate");
    }
  });

  it("hides the Format SQL button on document tabs", () => {
    const tab = makeDocTab();
    render(<QueryTab tab={tab} />);
    expect(screen.queryByLabelText("Format SQL")).toBeNull();
  });

  it("document tabs survive a successful run followed by a JSON error (idempotent)", async () => {
    mockFindDocuments.mockResolvedValueOnce(MOCK_DOC_RESULT);
    const tab = makeDocTab({ sql: '{"active":true}' });
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    const { rerender } = render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });
    await waitFor(() => {
      const s = useTabStore.getState();
      const updated = s.tabs.find((t) => t.id === "query-1");
      if (updated?.type === "query") {
        expect(updated.queryState.status).toBe("completed");
      }
    });

    // Flip the SQL to an invalid body and re-run; the error must replace the
    // previous success state so the user sees the new failure.
    const broken = makeDocTab({ sql: "{not json}" });
    useTabStore.setState({ tabs: [broken], activeTabId: "query-1" });
    rerender(<QueryTab tab={broken} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    await waitFor(() => {
      const s = useTabStore.getState();
      const updated = s.tabs.find((t) => t.id === "query-1");
      if (updated?.type === "query") {
        expect(updated.queryState.status).toBe("error");
      }
    });
  });

  // ── Sprint 82: provider-aware SQL dialect prop ──────────────────────────

  // AC-01: Postgres connection → QueryEditor receives the Postgres dialect.
  it("passes the PostgreSQL dialect when the active connection is postgres", () => {
    useConnectionStore.setState({
      connections: [makeConn({ id: "conn1", db_type: "postgresql" })],
    });
    const tab = makeQueryTab();
    render(<QueryTab tab={tab} />);
    expect(mockEditorProps.lastDialect).toBe(PostgreSQL);
  });

  // AC-02: MySQL connection → MySQL dialect.
  it("passes the MySQL dialect when the active connection is mysql", () => {
    useConnectionStore.setState({
      connections: [makeConn({ id: "conn1", db_type: "mysql" })],
    });
    const tab = makeQueryTab();
    render(<QueryTab tab={tab} />);
    expect(mockEditorProps.lastDialect).toBe(MySQL);
  });

  // AC-03: SQLite connection → SQLite dialect.
  it("passes the SQLite dialect when the active connection is sqlite", () => {
    useConnectionStore.setState({
      connections: [makeConn({ id: "conn1", db_type: "sqlite" })],
    });
    const tab = makeQueryTab();
    render(<QueryTab tab={tab} />);
    expect(mockEditorProps.lastDialect).toBe(SQLite);
  });

  // AC-07: Missing connection (deleted mid-session) → silent StandardSQL
  // fallback. Users see the editor keep working with generic highlighting
  // instead of an error, matching the existing pre-Sprint-82 contract.
  it("falls back to StandardSQL when the tab's connection is missing from the store", () => {
    // Store is empty — connection was deleted between render cycles.
    useConnectionStore.setState({ connections: [] });
    const tab = makeQueryTab();
    render(<QueryTab tab={tab} />);
    expect(mockEditorProps.lastDialect).toBe(StandardSQL);
  });

  // AC-07 parity: MongoDB connection reaches a SQL query tab (rare, but the
  // guard exists in `databaseTypeToSqlDialect`). Still falls back.
  it("falls back to StandardSQL when the connection paradigm is non-RDB", () => {
    useConnectionStore.setState({
      connections: [
        makeConn({ id: "conn1", db_type: "mongodb", paradigm: "document" }),
      ],
    });
    const tab = makeQueryTab();
    render(<QueryTab tab={tab} />);
    expect(mockEditorProps.lastDialect).toBe(StandardSQL);
  });

  // AC-05: changing the active connection's db_type swaps the dialect prop
  // without recreating the QueryTab / QueryEditor.
  it("updates the dialect prop when connection db_type flips", async () => {
    useConnectionStore.setState({
      connections: [makeConn({ id: "conn1", db_type: "postgresql" })],
    });
    const tab = makeQueryTab();
    render(<QueryTab tab={tab} />);
    expect(mockEditorProps.lastDialect).toBe(PostgreSQL);

    await act(async () => {
      useConnectionStore.setState({
        connections: [makeConn({ id: "conn1", db_type: "mysql" })],
      });
    });
    expect(mockEditorProps.lastDialect).toBe(MySQL);
  });

  // ── Sprint 83: Mongo autocomplete + operator highlight wiring ─────────────

  // AC-09: QueryTab passes `mongoExtensions` (autocomplete override + operator
  // highlight, length 2) to QueryEditor on every render, including RDB tabs.
  // QueryEditor itself gates the extensions behind `paradigm === "document"`
  // so RDB callers see no behavioural change — that invariant is covered by
  // QueryEditor.test.tsx.
  it("always passes a 2-entry mongoExtensions array to QueryEditor", () => {
    const rdbTab = makeQueryTab();
    render(<QueryTab tab={rdbTab} />);
    expect(mockEditorProps.lastMongoExtensions).toBeDefined();
    expect(Array.isArray(mockEditorProps.lastMongoExtensions)).toBe(true);
    expect(mockEditorProps.lastMongoExtensions?.length).toBe(2);
  });

  // AC-10: A document-paradigm tab in `find` mode wires through a hook-built
  // extension set that tracks the queryMode across re-renders via the hook's
  // memo. Flipping queryMode produces a new extension array identity.
  it("rebuilds mongoExtensions identity when queryMode flips find→aggregate", async () => {
    const docTab = makeDocTab({ queryMode: "find" });
    useTabStore.setState({ tabs: [docTab], activeTabId: "query-1" });
    const { rerender } = render(<QueryTab tab={docTab} />);
    const findExt = mockEditorProps.lastMongoExtensions;
    expect(findExt).toBeDefined();

    // Flip to aggregate — the mongoExtensions memo key should change and a
    // new array reference should be pushed down to the editor.
    const aggTab = makeDocTab({ queryMode: "aggregate" });
    useTabStore.setState({ tabs: [aggTab], activeTabId: "query-1" });
    await act(async () => {
      rerender(<QueryTab tab={aggTab} />);
    });
    expect(mockEditorProps.lastMongoExtensions).toBeDefined();
    expect(mockEditorProps.lastMongoExtensions).not.toBe(findExt);
  });

  // AC-11: Document-paradigm tabs surface cached field names from the
  // documentStore through the mongoExtensions prop. Populating
  // `fieldsCache` under the tab's connection:db:collection key causes
  // QueryTab to rebuild the memo and hand QueryEditor a fresh extension
  // set. The extension internals are exercised by
  // mongoAutocomplete.test.ts; here we only need to assert wiring.
  it("feeds documentStore.fieldsCache into mongoExtensions for document tabs", async () => {
    const docTab = makeDocTab();
    useTabStore.setState({ tabs: [docTab], activeTabId: "query-1" });
    const { rerender } = render(<QueryTab tab={docTab} />);
    const before = mockEditorProps.lastMongoExtensions;
    expect(before).toBeDefined();

    // Populate fieldsCache with the tab's cacheKey. The memo dep is the
    // whole `fieldsCache` object so the identity change triggers a
    // recompute and produces a new mongoExtensions array.
    await act(async () => {
      useDocumentStore.setState({
        fieldsCache: {
          "conn-mongo:table_view_test:users": [
            {
              name: "_id",
              data_type: "objectId",
              nullable: false,
              default_value: null,
              is_primary_key: true,
              is_foreign_key: false,
              fk_reference: null,
              comment: null,
            },
            {
              name: "email",
              data_type: "string",
              nullable: true,
              default_value: null,
              is_primary_key: false,
              is_foreign_key: false,
              fk_reference: null,
              comment: null,
            },
          ],
        },
      });
      rerender(<QueryTab tab={docTab} />);
    });

    expect(mockEditorProps.lastMongoExtensions).toBeDefined();
    expect(mockEditorProps.lastMongoExtensions).not.toBe(before);
    expect(mockEditorProps.lastMongoExtensions?.length).toBe(2);
  });

  // AC-07 regression: RDB paradigm tabs compute `mongoFieldNames =
  // undefined` regardless of any fieldsCache content, so populating the
  // cache under an unrelated key MUST NOT influence the extension memo.
  // The hook still fires once (because fieldsCache identity flips) but
  // the extension set remains a 2-entry MQL-aware array with `undefined`
  // fieldNames — QueryEditor discards it entirely when paradigm="rdb".
  it("does not pull fieldsCache into mongoExtensions for RDB tabs", async () => {
    const rdbTab = makeQueryTab();
    useTabStore.setState({ tabs: [rdbTab], activeTabId: "query-1" });
    const { rerender } = render(<QueryTab tab={rdbTab} />);
    const before = mockEditorProps.lastMongoExtensions;
    expect(before).toBeDefined();

    await act(async () => {
      useDocumentStore.setState({
        fieldsCache: {
          "someOther:conn:users": [
            {
              name: "ignored",
              data_type: "string",
              nullable: true,
              default_value: null,
              is_primary_key: false,
              is_foreign_key: false,
              fk_reference: null,
              comment: null,
            },
          ],
        },
      });
      rerender(<QueryTab tab={rdbTab} />);
    });

    // The hook memo deps include `fieldsCache` identity + `tab.paradigm`,
    // but since paradigm === "rdb" the memo still computes `undefined`
    // fieldNames. The useMongoAutocomplete hook itself keys on the
    // stable `undefined` value, so its memo stays referentially stable
    // across this render.
    expect(mockEditorProps.lastMongoExtensions).toBe(before);
    expect(mockEditorProps.lastParadigm).toBe("rdb");
  });

  // ── Sprint 84: history paradigm metadata + paradigm-aware restore ──────

  // AC-01 — RDB tab execution records paradigm:"rdb" + queryMode:"sql".
  it("records rdb/sql metadata on history entry after RDB execute", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    const tab = makeQueryTab();
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    await waitFor(() => {
      const entries = useQueryHistoryStore.getState().entries;
      expect(entries).toHaveLength(1);
    });

    const entry = useQueryHistoryStore.getState().entries[0]!;
    expect(entry.paradigm).toBe("rdb");
    expect(entry.queryMode).toBe("sql");
    expect(entry.database).toBeUndefined();
    expect(entry.collection).toBeUndefined();
    // AC-04 — globalLog mirrors the same metadata.
    const logEntry = useQueryHistoryStore.getState().globalLog[0]!;
    expect(logEntry.paradigm).toBe("rdb");
    expect(logEntry.queryMode).toBe("sql");
  });

  // AC-02 — Document+find execution records document/find + db/coll.
  it("records document/find metadata + database + collection on successful find", async () => {
    mockFindDocuments.mockResolvedValueOnce(MOCK_DOC_RESULT);
    const tab = makeDocTab({ sql: '{"active":true}' });
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    await waitFor(() => {
      const entries = useQueryHistoryStore.getState().entries;
      expect(entries).toHaveLength(1);
    });

    const entry = useQueryHistoryStore.getState().entries[0]!;
    expect(entry.paradigm).toBe("document");
    expect(entry.queryMode).toBe("find");
    expect(entry.database).toBe("table_view_test");
    expect(entry.collection).toBe("users");
    expect(entry.status).toBe("success");
    // AC-04 — globalLog mirrors entry metadata.
    const log = useQueryHistoryStore.getState().globalLog[0]!;
    expect(log).toMatchObject({
      paradigm: "document",
      queryMode: "find",
      database: "table_view_test",
      collection: "users",
    });
  });

  // AC-03 — Document+aggregate execution records document/aggregate + db/coll.
  it("records document/aggregate metadata on successful aggregate", async () => {
    mockAggregateDocuments.mockResolvedValueOnce(MOCK_DOC_RESULT);
    const tab = makeDocTab({
      queryMode: "aggregate",
      sql: '[{"$match":{"active":true}}]',
    });
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    await waitFor(() => {
      const entries = useQueryHistoryStore.getState().entries;
      expect(entries).toHaveLength(1);
    });

    const entry = useQueryHistoryStore.getState().entries[0]!;
    expect(entry.paradigm).toBe("document");
    expect(entry.queryMode).toBe("aggregate");
    expect(entry.database).toBe("table_view_test");
    expect(entry.collection).toBe("users");
  });

  // AC-09 — double-click on a history row routes through loadQueryIntoTab
  // and the tab's sql (+ queryMode where applicable) shifts. The observable
  // effect is the tabStore mutation: in-place updates replace `tab.sql`,
  // paradigm mismatches spawn a new tab. Either way, `loadQueryIntoTab`
  // is the only path that can produce the observed state transition.
  it("double-click on a history row routes through loadQueryIntoTab (AC-09 in-place)", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    const tab = makeQueryTab({ sql: "SELECT original" });
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });
    await waitFor(() => {
      expect(useQueryHistoryStore.getState().entries).toHaveLength(1);
    });

    // Replace the tab's sql with a distinct value so we can observe the
    // restore overwriting it.
    await act(async () => {
      useTabStore.getState().updateQuerySql("query-1", "CHANGED");
    });

    await act(async () => {
      screen.getByText(/History \(1\)/).click();
    });

    const loadBtn = screen.getByRole("button", {
      name: /Load query into editor: SELECT original/,
    });
    const row = loadBtn.closest("li")!;
    await act(async () => {
      row.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      );
    });

    // Same paradigm + same connection → in-place update, tab count unchanged.
    const state = useTabStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabId).toBe("query-1");
    const qt = state.tabs[0];
    if (qt && qt.type === "query") {
      expect(qt.sql).toBe("SELECT original");
      expect(qt.paradigm).toBe("rdb");
      expect(qt.queryMode).toBe("sql");
    }
  });

  // AC-09 — "Load into editor" button routes through the same helper and
  // produces the same observable state transition as the double-click path.
  it("Load into editor button routes through loadQueryIntoTab (AC-09 in-place)", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    const tab = makeQueryTab();
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });
    await waitFor(() => {
      expect(useQueryHistoryStore.getState().entries).toHaveLength(1);
    });

    await act(async () => {
      useTabStore.getState().updateQuerySql("query-1", "CHANGED");
    });

    await act(async () => {
      screen.getByText(/History \(1\)/).click();
    });

    const loadBtn = screen.getByRole("button", {
      name: /Load query into editor: SELECT 1/,
    });
    await act(async () => {
      loadBtn.click();
    });

    const state = useTabStore.getState();
    // Same paradigm + same connection → in-place update, tab count unchanged.
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabId).toBe("query-1");
    const qt = state.tabs[0];
    if (qt && qt.type === "query") {
      expect(qt.sql).toBe("SELECT 1");
    }
  });

  // AC-07 + AC-09 — cross-paradigm restore from a history row spawns a new
  // tab. This proves the double-click / "Load into editor" buttons route
  // through the paradigm-aware helper (otherwise they would only overwrite
  // the active tab's sql without spawning).
  it("history row double-click spawns a new tab when paradigms differ (AC-07)", async () => {
    // Seed a Document+find history entry directly so no real query runs.
    useQueryHistoryStore.setState({
      entries: [
        {
          id: "hist-doc-1",
          sql: '{"active":true}',
          executedAt: 1,
          duration: 2,
          status: "success",
          connectionId: "conn-mongo",
          paradigm: "document",
          queryMode: "find",
          database: "table_view_test",
          collection: "users",
        },
      ],
    });

    // Active tab is RDB — restoring a document entry must spawn a new tab.
    // Use a bespoke id ("query-rdb-original") so it can never collide with
    // ids minted by `addQueryTab` (which mint `query-${counter}` starting
    // at 1).
    const rdbTab = makeQueryTab({ id: "query-rdb-original" });
    useTabStore.setState({
      tabs: [rdbTab],
      activeTabId: "query-rdb-original",
    });
    render(<QueryTab tab={rdbTab} />);

    await act(async () => {
      screen.getByText(/History \(1\)/).click();
    });

    const loadBtn = screen.getByRole("button", {
      name: /Load query into editor: /,
    });
    const row = loadBtn.closest("li")!;
    await act(async () => {
      row.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      );
    });

    const state = useTabStore.getState();
    expect(state.tabs).toHaveLength(2);
    // Original RDB tab is untouched (AC-10).
    const original = state.tabs.find((t) => t.id === "query-rdb-original");
    expect(original).toBeDefined();
    if (original && original.type === "query") {
      expect(original.paradigm).toBe("rdb");
      expect(original.sql).toBe("SELECT 1");
    }
    // New tab inherits the entry's paradigm + queryMode + db/coll (AC-08).
    const spawned = state.tabs.find((t) => t.id === state.activeTabId);
    expect(spawned?.type).toBe("query");
    if (spawned && spawned.type === "query") {
      expect(spawned.id).not.toBe("query-rdb-original");
      expect(spawned.paradigm).toBe("document");
      expect(spawned.queryMode).toBe("find");
      expect(spawned.database).toBe("table_view_test");
      expect(spawned.collection).toBe("users");
      expect(spawned.sql).toBe('{"active":true}');
    }
  });

  // AC-09 — legacy entries (missing paradigm / queryMode) are safely
  // normalised by the QueryTab restore path, which reads the entry with
  // `?? "rdb"` / `?? "sql"` defaults.
  it("loading a legacy entry without paradigm defaults to rdb/sql in the handler", async () => {
    useQueryHistoryStore.setState({
      entries: [
        {
          id: "legacy-1",
          sql: "SELECT legacy",
          executedAt: 1000,
          duration: 10,
          status: "success",
          connectionId: "conn1",
        },
      ] as unknown as ReturnType<
        typeof useQueryHistoryStore.getState
      >["entries"],
    });

    const tab = makeQueryTab({ sql: "CHANGED" });
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByText(/History \(1\)/).click();
    });

    const loadBtn = screen.getByRole("button", {
      name: /Load query into editor: SELECT legacy/,
    });
    await act(async () => {
      loadBtn.click();
    });

    // Same connection + default paradigm ("rdb") matches the active RDB tab,
    // so the restore should succeed via the in-place branch and write the
    // legacy SQL onto the active tab without throwing.
    const state = useTabStore.getState();
    expect(state.tabs).toHaveLength(1);
    const qt = state.tabs[0];
    if (qt && qt.type === "query") {
      expect(qt.sql).toBe("SELECT legacy");
      expect(qt.paradigm).toBe("rdb");
      expect(qt.queryMode).toBe("sql");
    }
  });

  // ── Sprint 85: paradigm-aware history row coloration ────────────────────

  // AC-01 — rdb entry in the in-tab history panel routes through
  // QuerySyntax → SqlSyntax, so the SQL keyword class is present in the row.
  it("renders SQL coloration for rdb history rows (AC-01)", async () => {
    useQueryHistoryStore.setState({
      entries: [
        {
          id: "hist-rdb-sprint85",
          sql: "SELECT sprint85",
          executedAt: 1,
          duration: 5,
          status: "success",
          connectionId: "conn1",
          paradigm: "rdb",
          queryMode: "sql",
        },
      ],
    });
    const tab = makeQueryTab();
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByText(/History \(1\)/).click();
    });

    const loadBtn = screen.getByRole("button", {
      name: /Load query into editor: SELECT sprint85/,
    });
    const row = loadBtn.closest("li")!;
    // SqlSyntax tags `SELECT` as keyword → `text-syntax-keyword`.
    expect(row.querySelector(".text-syntax-keyword")).not.toBeNull();
    expect(row.querySelector(".cm-mql-operator")).toBeNull();
  });

  // AC-02 — document entry in the in-tab history panel routes through
  // QuerySyntax → MongoSyntax; operator tokens expose `cm-mql-operator`.
  it("renders MQL operator class for document history rows (AC-02)", async () => {
    useQueryHistoryStore.setState({
      entries: [
        {
          id: "hist-doc-sprint85",
          sql: '{"$match": {"x": 1}}',
          executedAt: 1,
          duration: 5,
          status: "success",
          connectionId: "conn-mongo",
          paradigm: "document",
          queryMode: "find",
          database: "testdb",
          collection: "users",
        },
      ],
    });
    // The history panel only shows entries for the active query tab's
    // connection-agnostic entries list (useQueryHistoryStore.entries), so
    // any active tab will surface this document entry.
    const tab = makeDocTab({ id: "query-1" });
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByText(/History \(1\)/).click();
    });

    const loadBtn = screen.getByRole("button", {
      name: /Load query into editor: /,
    });
    const row = loadBtn.closest("li")!;
    const operator = row.querySelector(".cm-mql-operator");
    expect(operator).not.toBeNull();
    expect(operator?.textContent).toBe('"$match"');
    expect(row.querySelector(".text-syntax-keyword")?.textContent).not.toBe(
      "SELECT",
    );
  });
});
