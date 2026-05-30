// Sprint 218 — `execution` axis split from `QueryTab.test.tsx` (P11
// step 2). Covers Sprint 36 multi-statement execution, the Cancel
// button live path, multi-statement history recording, non-Error
// rejection coercion, the format-sql window event, and the Sprint 53
// uglify-sql window event. Cases are byte-equivalent to the originals —
// no behaviour change.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  seedWorkspace,
  getTestWorkspace,
} from "@/stores/__tests__/workspaceStoreTestHelpers";
import { render, screen, waitFor, act } from "@testing-library/react";
import QueryTab from "./QueryTab";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import type { QueryResult } from "@/types/query";
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
beforeEach(() => {
  setupTauriMock({
    executeQuery: (...args: unknown[]) => mockExecuteQuery(...args),
    cancelQuery: (...args: unknown[]) => mockCancelQuery(...args),
    findDocuments: (...args: unknown[]) => mockFindDocuments(...args),
    aggregateDocuments: (...args: unknown[]) => mockAggregateDocuments(...args),
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

function seedDevelopmentConnection() {
  useConnectionStore.setState({
    connections: [makeConn({ environment: "development" })],
  });
}

describe("QueryTab — execution", () => {
  beforeEach(() => {
    resetQueryTabStores();
  });

  // ── Sprint 36: Multi-Statement Execution ──

  it("executes multiple statements sequentially", async () => {
    const secondResult: QueryResult = {
      columns: [{ name: "n", dataType: "integer", category: "unknown" }],
      rows: [[42]],
      totalCount: 1,
      executionTimeMs: 2,
      queryType: "select",
    };
    mockExecuteQuery
      .mockResolvedValueOnce(MOCK_RESULT)
      .mockResolvedValueOnce(secondResult);

    const tab = makeQueryTab({ sql: "SELECT 1; SELECT 2" });
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    render(<QueryTab tab={tab} />);

    const executeBtn = screen.getByTestId("execute-btn");
    await act(async () => {
      executeBtn.click();
    });

    // Should be called twice — once for each statement
    await waitFor(() => {
      expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
    });
    // Sprint 266 — 4th arg is `expectedDatabase` (opt-in db mismatch guard).
    expect(mockExecuteQuery).toHaveBeenNthCalledWith(
      1,
      "conn1",
      "SELECT 1",
      expect.any(String),
      expect.any(String),
    );
    expect(mockExecuteQuery).toHaveBeenNthCalledWith(
      2,
      "conn1",
      "SELECT 2",
      expect.any(String),
      expect.any(String),
    );

    // Final state should show the last result
    await waitFor(() => {
      const state = getTestWorkspace();
      const updatedTab = state.tabs.find((t) => t.id === "query-1");
      if (updatedTab && updatedTab.type === "query") {
        expect(updatedTab.queryState.status).toBe("completed");
      }
    });
  });

  it("retains per-statement breakdown on partial multi-statement failure", async () => {
    // Sprint 100 — partial failure no longer collapses to `status: "error"`.
    // Instead, the run remains `completed` so the Tabs view can show one
    // tab per statement (success rows / failed marker). The store's
    // `statements` array carries per-stmt status + error message + result.
    //
    // Pin non-production + warn so destructive SQL still exercises
    // multi-statement execution instead of the Safe Mode confirm path.
    mockExecuteQuery
      .mockResolvedValueOnce(MOCK_RESULT)
      .mockRejectedValueOnce(new Error("Table not found"));

    useSafeModeStore.setState({ mode: "warn" });
    seedDevelopmentConnection();
    const tab = makeQueryTab({ sql: "SELECT 1; DROP TABLE nope" });
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    render(<QueryTab tab={tab} />);

    const executeBtn = screen.getByTestId("execute-btn");
    await act(async () => {
      executeBtn.click();
    });

    await waitFor(() => {
      const state = getTestWorkspace();
      const updatedTab = state.tabs.find((t) => t.id === "query-1");
      expect(updatedTab).toBeDefined();
      if (updatedTab && updatedTab.type === "query") {
        // Partial failure → completed (not error) with statements[].
        expect(updatedTab.queryState.status).toBe("completed");
        if (updatedTab.queryState.status === "completed") {
          const stmts = updatedTab.queryState.statements;
          expect(stmts).toBeDefined();
          expect(stmts).toHaveLength(2);
          expect(stmts![0]!.status).toBe("success");
          expect(stmts![0]!.result).toBeDefined();
          expect(stmts![1]!.status).toBe("error");
          expect(stmts![1]!.error).toContain("Table not found");
          // `result` falls back to the LAST SUCCESSFUL result.
          expect(updatedTab.queryState.result).toBe(MOCK_RESULT);
        }
      }
    });
  });

  it("collapses to error status when ALL statements fail", async () => {
    // Sprint 100 — when every statement fails, the run still reports
    // `status: "error"` (joined message) so single-statement-error
    // consumers (history list, error banner) keep working unchanged.
    //
    // Sprint 255 (2026-05-09) — `BAD` statements 는 analyzer 가 `kind:
    // "other"` 로 분류한다.
    //
    // Sprint 254 (2026-05-09) — `kind: "other"` 의 default severity 가
    // `"safe"` → `"info"` 로 변경. INFO statements 는 WARN dialog 를 skip
    // 하고 직접 IPC 를 호출하므로, 본 테스트의 multi-statement 실행 후
    // 모두 실패 → error collapsing 의 store 행동 검증은 dialog 우회
    // 없이 직접 검증된다. 단일 click 으로 IPC 2회 호출 → 모두 fail → state
    // 가 error 로 collapse.
    mockExecuteQuery
      .mockRejectedValueOnce(new Error("Syntax error 1"))
      .mockRejectedValueOnce(new Error("Syntax error 2"));

    const tab = makeQueryTab({ sql: "BAD 1; BAD 2" });
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    render(<QueryTab tab={tab} />);

    const executeBtn = screen.getByTestId("execute-btn");
    await act(async () => {
      executeBtn.click();
    });

    await waitFor(() => {
      const state = getTestWorkspace();
      const updatedTab = state.tabs.find((t) => t.id === "query-1");
      if (updatedTab && updatedTab.type === "query") {
        expect(updatedTab.queryState.status).toBe("error");
        if (updatedTab.queryState.status === "error") {
          expect(updatedTab.queryState.error).toContain("Syntax error 1");
          expect(updatedTab.queryState.error).toContain("Syntax error 2");
        }
      }
    });
  });

  it("populates statements[] with all-success on multi-statement happy path", async () => {
    // Sprint 100 — every statement succeeds → statements[] has N
    // success entries and `result` mirrors the last successful result.
    const secondResult: QueryResult = {
      columns: [{ name: "n", dataType: "integer", category: "unknown" }],
      rows: [[42]],
      totalCount: 1,
      executionTimeMs: 2,
      queryType: "select",
    };
    mockExecuteQuery
      .mockResolvedValueOnce(MOCK_RESULT)
      .mockResolvedValueOnce(secondResult);

    const tab = makeQueryTab({ sql: "SELECT 1; SELECT 2" });
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    render(<QueryTab tab={tab} />);

    const executeBtn = screen.getByTestId("execute-btn");
    await act(async () => {
      executeBtn.click();
    });

    await waitFor(() => {
      const state = getTestWorkspace();
      const updatedTab = state.tabs.find((t) => t.id === "query-1");
      if (updatedTab && updatedTab.type === "query") {
        expect(updatedTab.queryState.status).toBe("completed");
        if (updatedTab.queryState.status === "completed") {
          const stmts = updatedTab.queryState.statements;
          expect(stmts).toHaveLength(2);
          expect(stmts!.every((s) => s.status === "success")).toBe(true);
          expect(updatedTab.queryState.result).toBe(secondResult);
        }
      }
    });
  });

  // ── Format SQL event ──

  it("formats SQL on format-sql event when tab is active", async () => {
    const tab = makeQueryTab({ sql: "select * from users" });
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    render(<QueryTab tab={tab} />);

    act(() => {
      window.dispatchEvent(new CustomEvent("format-sql"));
    });

    // Check that the SQL was formatted (our mock uppercases it)
    const state = getTestWorkspace();
    const updatedTab = state.tabs.find((t) => t.id === "query-1");
    if (updatedTab && updatedTab.type === "query") {
      expect(updatedTab.sql).toBe("SELECT * FROM USERS");
    }
  });

  it("ignores format-sql event when tab is not active", () => {
    const tab = makeQueryTab({ sql: "select * from users" });
    useWorkspaceStore.setState(seedWorkspace([tab], "other-tab"));
    render(<QueryTab tab={tab} />);

    act(() => {
      window.dispatchEvent(new CustomEvent("format-sql"));
    });

    // SQL should remain unchanged
    const state = getTestWorkspace();
    const updatedTab = state.tabs.find((t) => t.id === "query-1");
    if (updatedTab && updatedTab.type === "query") {
      expect(updatedTab.sql).toBe("select * from users");
    }
  });

  it("ignores format-sql event when SQL is empty", () => {
    const tab = makeQueryTab({ sql: "   " });
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    render(<QueryTab tab={tab} />);

    act(() => {
      window.dispatchEvent(new CustomEvent("format-sql"));
    });

    // SQL should remain unchanged (whitespace-only)
    const state = getTestWorkspace();
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
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
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
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
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
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
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

  it("ignores cancel-query event for DuckDB because cancel is unsupported", async () => {
    const tab = makeQueryTab({
      connectionId: "duckdb-conn",
      queryState: { status: "running", queryId: "query-1-1234" },
    });
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    useConnectionStore.setState({
      connections: [makeConn({ id: "duckdb-conn", dbType: "duckdb" })],
    });
    render(<QueryTab tab={tab} />);

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("cancel-query", {
          detail: { queryId: "query-1-1234" },
        }),
      );
    });

    expect(mockCancelQuery).not.toHaveBeenCalled();
  });

  // ── Multi-statement history recording ──

  it("records error history when some multi-statements fail", async () => {
    // Pin non-production + warn so destructive SQL still dispatches.
    mockExecuteQuery
      .mockResolvedValueOnce(MOCK_RESULT)
      .mockRejectedValueOnce(new Error("Table not found"));

    useSafeModeStore.setState({ mode: "warn" });
    seedDevelopmentConnection();
    const tab = makeQueryTab({ sql: "SELECT 1; DROP TABLE nope" });
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    render(<QueryTab tab={tab} />);

    const executeBtn = screen.getByTestId("execute-btn");
    await act(async () => {
      executeBtn.click();
    });

    await waitFor(() => {
      const history = useQueryHistoryStore.getState().recentVisible;
      expect(history).toHaveLength(1);
      expect(history[0]!.status).toBe("error");
      expect(history[0]!.sqlRedacted).toBe("SELECT 1; DROP TABLE nope");
    });
  });

  it("records success history for all-success multi-statements", async () => {
    const secondResult: QueryResult = {
      columns: [{ name: "n", dataType: "integer", category: "unknown" }],
      rows: [[42]],
      totalCount: 1,
      executionTimeMs: 2,
      queryType: "select",
    };
    mockExecuteQuery
      .mockResolvedValueOnce(MOCK_RESULT)
      .mockResolvedValueOnce(secondResult);

    const tab = makeQueryTab({ sql: "SELECT 1; SELECT 2" });
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    render(<QueryTab tab={tab} />);

    const executeBtn = screen.getByTestId("execute-btn");
    await act(async () => {
      executeBtn.click();
    });

    await waitFor(() => {
      const history = useQueryHistoryStore.getState().recentVisible;
      expect(history).toHaveLength(1);
      expect(history[0]!.status).toBe("success");
      expect(history[0]!.sqlRedacted).toBe("SELECT 1; SELECT 2");
    });
  });

  it("records cancelled history and cancelled tab state for query cancellation", async () => {
    mockExecuteQuery.mockRejectedValueOnce(new Error("Query cancelled"));
    const tab = makeQueryTab({ sql: "SELECT pg_sleep(30)" });
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    render(<QueryTab tab={tab} />);

    const executeBtn = screen.getByTestId("execute-btn");
    await act(async () => {
      executeBtn.click();
    });

    await waitFor(() => {
      const state = getTestWorkspace();
      const updatedTab = state.tabs.find((t) => t.id === "query-1");
      expect(updatedTab && updatedTab.type === "query").toBe(true);
      if (updatedTab && updatedTab.type === "query") {
        expect(updatedTab.queryState.status).toBe("cancelled");
        if (updatedTab.queryState.status === "cancelled") {
          expect(updatedTab.queryState.message).toBe("Query cancelled");
        }
      }
      const history = useQueryHistoryStore.getState().recentVisible;
      expect(history).toHaveLength(1);
      expect(history[0]!.status).toBe("cancelled");
      expect(history[0]!.sqlRedacted).toBe("SELECT pg_sleep(30)");
    });
  });

  it("records cancelled history and stops multi-statement execution on cancellation", async () => {
    mockExecuteQuery
      .mockResolvedValueOnce(MOCK_RESULT)
      .mockRejectedValueOnce(new Error("Operation cancelled"));
    const tab = makeQueryTab({
      sql: "SELECT 1; SELECT pg_sleep(30); SELECT 3",
    });
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    render(<QueryTab tab={tab} />);

    const executeBtn = screen.getByTestId("execute-btn");
    await act(async () => {
      executeBtn.click();
    });

    await waitFor(() => {
      expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
      const firstQueryId = mockExecuteQuery.mock.calls[0]?.[2];
      const secondQueryId = mockExecuteQuery.mock.calls[1]?.[2];
      expect(secondQueryId).toBe(firstQueryId);

      const state = getTestWorkspace();
      const updatedTab = state.tabs.find((t) => t.id === "query-1");
      expect(updatedTab && updatedTab.type === "query").toBe(true);
      if (updatedTab && updatedTab.type === "query") {
        expect(updatedTab.queryState.status).toBe("cancelled");
      }
      const history = useQueryHistoryStore.getState().recentVisible;
      expect(history).toHaveLength(1);
      expect(history[0]!.status).toBe("cancelled");
      expect(history[0]!.sqlRedacted).toBe(
        "SELECT 1; SELECT pg_sleep(30); SELECT 3",
      );
    });
  });

  // ── Error with non-Error object ──

  it("handles non-Error rejection in single statement", async () => {
    mockExecuteQuery.mockRejectedValueOnce("string error");
    const tab = makeQueryTab();
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    render(<QueryTab tab={tab} />);

    const executeBtn = screen.getByTestId("execute-btn");
    await act(async () => {
      executeBtn.click();
    });

    await waitFor(() => {
      const state = getTestWorkspace();
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
    // Sprint 100 — partial-failure now stays `completed` with statements[].
    // The non-Error rejection ("raw error" string) is coerced via
    // String(err) and recorded on the failing statement entry, not on the
    // collapsed top-level error message.
    //
    // Pin non-production + warn so destructive SQL still dispatches.
    mockExecuteQuery
      .mockResolvedValueOnce(MOCK_RESULT)
      .mockRejectedValueOnce("raw error");

    useSafeModeStore.setState({ mode: "warn" });
    seedDevelopmentConnection();
    const tab = makeQueryTab({ sql: "SELECT 1; DROP TABLE nope" });
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    render(<QueryTab tab={tab} />);

    const executeBtn = screen.getByTestId("execute-btn");
    await act(async () => {
      executeBtn.click();
    });

    await waitFor(() => {
      const state = getTestWorkspace();
      const updatedTab = state.tabs.find((t) => t.id === "query-1");
      if (updatedTab && updatedTab.type === "query") {
        expect(updatedTab.queryState.status).toBe("completed");
        if (updatedTab.queryState.status === "completed") {
          const stmts = updatedTab.queryState.statements;
          expect(stmts).toHaveLength(2);
          expect(stmts![1]!.status).toBe("error");
          expect(stmts![1]!.error).toBe("raw error");
        }
      }
    });
  });

  // -- Sprint 53: Uglify SQL event --

  it("uglifies SQL on uglify-sql event when tab is active", () => {
    const tab = makeQueryTab({ sql: "SELECT  id\n  FROM  users" });
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    render(<QueryTab tab={tab} />);

    act(() => {
      window.dispatchEvent(new CustomEvent("uglify-sql"));
    });

    const state = getTestWorkspace();
    const updatedTab = state.tabs.find((t) => t.id === "query-1");
    if (updatedTab && updatedTab.type === "query") {
      expect(updatedTab.sql).toBe("SELECT id FROM users");
    }
  });

  it("ignores uglify-sql event when tab is not active", () => {
    const tab = makeQueryTab({ sql: "SELECT  id\n  FROM  users" });
    useWorkspaceStore.setState(seedWorkspace([tab], "other-tab"));
    render(<QueryTab tab={tab} />);

    act(() => {
      window.dispatchEvent(new CustomEvent("uglify-sql"));
    });

    const state = getTestWorkspace();
    const updatedTab = state.tabs.find((t) => t.id === "query-1");
    if (updatedTab && updatedTab.type === "query") {
      expect(updatedTab.sql).toBe("SELECT  id\n  FROM  users");
    }
  });

  it("ignores uglify-sql event when SQL is empty", () => {
    const tab = makeQueryTab({ sql: "   " });
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    render(<QueryTab tab={tab} />);

    act(() => {
      window.dispatchEvent(new CustomEvent("uglify-sql"));
    });

    const state = getTestWorkspace();
    const updatedTab = state.tabs.find((t) => t.id === "query-1");
    if (updatedTab && updatedTab.type === "query") {
      expect(updatedTab.sql).toBe("   ");
    }
  });
});
