// Sprint 218 — `toolbar` axis split from `QueryTab.test.tsx` (P11
// step 2). Covers Sprint 25 Run / Cancel button visibility, disabled
// state, shortcut hint, and the Run button click → handleExecute path.
// Cases are byte-equivalent to the originals — no behaviour change.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import QueryTab from "./QueryTab";
import { useTabStore } from "@stores/tabStore";
import {
  MOCK_RESULT,
  mockExecuteQuery,
  mockCancelQuery,
  mockFindDocuments,
  mockAggregateDocuments,
  mockVerifyActiveDb,
  mockEditorProps,
  makeQueryTab,
  resetQueryTabStores,
} from "./__tests__/queryTabTestHelpers";
import type { SQLDialect } from "@codemirror/lang-sql";
import type { Extension } from "@codemirror/state";

vi.mock("@lib/tauri", () => ({
  executeQuery: (...args: unknown[]) => mockExecuteQuery(...args),
  cancelQuery: (...args: unknown[]) => mockCancelQuery(...args),
  findDocuments: (...args: unknown[]) => mockFindDocuments(...args),
  aggregateDocuments: (...args: unknown[]) => mockAggregateDocuments(...args),
}));

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
});
