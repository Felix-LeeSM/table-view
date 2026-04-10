import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import QueryTab from "./QueryTab";
import { useTabStore, type QueryTab as QueryTabType } from "../stores/tabStore";
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
    mockExecuteQuery.mockReset();
    mockCancelQuery.mockReset();
  });

  it("renders editor and result grid in idle state", () => {
    const tab = makeQueryTab();
    render(<QueryTab tab={tab} />);

    expect(screen.getByTestId("mock-editor")).toBeInTheDocument();
    expect(screen.getByTestId("mock-result")).toBeInTheDocument();
    expect(screen.getByTestId("mock-editor")).toHaveAttribute("data-sql", "SELECT 1");
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
    expect(mockExecuteQuery).toHaveBeenCalledWith("conn1", "SELECT 1", expect.any(String));

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
        new CustomEvent("cancel-query", { detail: { queryId: "query-1-1234" } }),
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
        new CustomEvent("cancel-query", { detail: { queryId: "different-id" } }),
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
});
