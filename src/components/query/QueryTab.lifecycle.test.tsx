// Sprint 218 — `lifecycle` axis split from `QueryTab.test.tsx` (P11
// step 2). Covers idle render, execute happy/error transitions,
// empty-SQL guard, cancel-query event handling, the result-area flex
// column shape, and the resize-handle layout. Cases are byte-equivalent
// to the originals — no behaviour change.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  seedWorkspace,
  getTestWorkspace,
} from "@/stores/__tests__/workspaceStoreTestHelpers";
import { render, screen, waitFor, act } from "@testing-library/react";
import QueryTab from "./QueryTab";
import { useWorkspaceStore } from "@stores/workspaceStore";
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
import type { SqlCompletionContext } from "@lib/sql/sqlCompletionContext";
import { useConnectionStore } from "@stores/connectionStore";
import { useSchemaStore } from "@stores/schemaStore";
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
      completionContext?: SqlCompletionContext;
    }
  >(function MockSqlQueryEditor(props) {
    mockEditorProps.lastDialect = props.sqlDialect;
    mockEditorProps.dialectHistory.push(props.sqlDialect);
    mockEditorProps.lastMongoExtensions = undefined;
    mockEditorProps.mongoExtensionsHistory.push(undefined);
    mockEditorProps.lastCompletionContext = props.completionContext;
    mockEditorProps.completionContextHistory.push(props.completionContext);
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

describe("QueryTab — lifecycle", () => {
  beforeEach(() => {
    resetQueryTabStores();
  });

  it("passes DuckDB registered source metadata into the live completion context", () => {
    useConnectionStore.setState({
      connections: [makeConn({ dbType: "duckdb", database: "main" })],
    });
    useSchemaStore.setState({
      schemas: {},
      tables: {},
      views: {},
      functions: {},
      postgresExtensions: {},
      tableColumnsCache: {},
      fileAnalyticsSources: {
        conn1: [
          {
            source: {
              id: "source-1",
              alias: "sales_csv",
              fileName: "sales.csv",
              kind: "csv",
              sizeBytes: 128,
            },
            columns: [
              { name: "order_id", dataType: "BIGINT" },
              { name: "amount", dataType: "DOUBLE" },
            ],
            previewSql: "SELECT * FROM sales_csv LIMIT 100",
          },
        ],
      },
    });

    render(<QueryTab tab={makeQueryTab({ database: "main" })} />);

    expect(
      mockEditorProps.lastCompletionContext?.catalog.objects,
    ).toContainEqual(
      expect.objectContaining({
        schema: "main",
        name: "sales_csv",
        qualifiedName: "main.sales_csv",
      }),
    );
    expect(mockEditorProps.lastCompletionContext?.catalog.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "sales_csv",
          name: "order_id",
          qualifiedName: "main.sales_csv.order_id",
        }),
      ]),
    );
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
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    render(<QueryTab tab={tab} />);

    const executeBtn = screen.getByTestId("execute-btn");
    await act(async () => {
      executeBtn.click();
    });

    // Should call executeQuery with correct args.
    // Sprint 266 — 4th arg is `expectedDatabase` (opt-in db mismatch guard).
    expect(mockExecuteQuery).toHaveBeenCalledWith(
      "conn1",
      "SELECT 1",
      expect.any(String),
      expect.any(String),
    );

    // Wait for async completion
    await waitFor(() => {
      const state = getTestWorkspace();
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
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));

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
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
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
});
