import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import QueryTab from "./QueryTab";
import { useTabStore, type QueryTab as QueryTabType } from "../stores/tabStore";
import { useQueryHistoryStore } from "../stores/queryHistoryStore";
import type { QueryResult } from "../types/query";

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

vi.mock("../lib/tauri", () => ({
  executeQuery: (...args: unknown[]) => mockExecuteQuery(...args),
  cancelQuery: (...args: unknown[]) => mockCancelQuery(...args),
}));

vi.mock("./QueryEditor", () => ({
  default: ({ onExecute, sql }: { onExecute: () => void; sql: string }) => (
    <div data-testid="mock-editor" data-sql={sql}>
      <button data-testid="execute-btn" onClick={onExecute}>
        Execute
      </button>
    </div>
  ),
}));

vi.mock("./QueryResultGrid", () => ({
  default: ({ queryState }: { queryState: unknown }) => (
    <div data-testid="mock-result" data-status={JSON.stringify(queryState)} />
  ),
}));

vi.mock("../hooks/useSqlAutocomplete", () => ({
  useSqlAutocomplete: () => ({}),
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
    ...overrides,
  };
}

describe("QueryTab", () => {
  beforeEach(() => {
    useTabStore.setState({ tabs: [], activeTabId: null });
    useQueryHistoryStore.setState({ entries: [] });
    mockExecuteQuery.mockReset();
    mockCancelQuery.mockReset();
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

    // The history panel should show the SQL text
    await waitFor(() => {
      expect(screen.getByText("SELECT 1")).toBeInTheDocument();
    });
  });

  it("clicking history item updates editor SQL", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    const tab = makeQueryTab();
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    const executeBtn = screen.getByTestId("execute-btn");
    await act(async () => {
      executeBtn.click();
    });

    // Wait for history entry
    await waitFor(() => {
      expect(useQueryHistoryStore.getState().entries).toHaveLength(1);
    });

    // Expand the history panel
    const historyToggle = screen.getByText(/History \(1\)/);
    await act(async () => {
      historyToggle.click();
    });

    // Find and click the history item
    const historyItem = screen.getByRole("button", { name: /SELECT 1/ });
    await act(async () => {
      historyItem.click();
    });

    // Check that the SQL was updated in the store
    const state = useTabStore.getState();
    const updatedTab = state.tabs.find((t) => t.id === "query-1");
    if (updatedTab && updatedTab.type === "query") {
      expect(updatedTab.sql).toBe("SELECT 1");
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
});
