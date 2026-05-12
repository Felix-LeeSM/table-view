// Sprint 218 — `history` axis split from `QueryTab.test.tsx` (P11
// step 2). Covers Sprint 34 history record + UI (entry add, panel
// rendering, row text selectability, Load button, double-click load,
// clear), Sprint 84 history paradigm metadata + paradigm-aware restore
// (rdb / document metadata, double-click in-place, Load button in-place,
// cross-paradigm spawn, legacy default), and Sprint 85 paradigm-aware
// row coloration. Cases are byte-equivalent to the originals — no
// behaviour change.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  seedWorkspace,
  getTestWorkspace,
  getAllTabsForConnection,
} from "@/stores/__tests__/workspaceStoreTestHelpers";
import { render, screen, waitFor, act } from "@testing-library/react";
import QueryTab from "./QueryTab";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import {
  MOCK_RESULT,
  MOCK_DOC_RESULT,
  mockExecuteQuery,
  mockCancelQuery,
  mockFindDocuments,
  mockAggregateDocuments,
  mockVerifyActiveDb,
  mockEditorProps,
  makeQueryTab,
  makeDocTab,
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

describe("QueryTab — history", () => {
  beforeEach(() => {
    resetQueryTabStores();
  });

  // ── Sprint 34: Query History ──

  it("adds entry to history after successful query execution", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    const tab = makeQueryTab();
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
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
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
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
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
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
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
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
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
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

    const state = getTestWorkspace();
    const updatedTab = state.tabs.find((t) => t.id === "query-1");
    if (updatedTab && updatedTab.type === "query") {
      expect(updatedTab.sql).toBe("SELECT 1");
    }
  });

  it("double-clicking a history row updates editor SQL", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    const tab = makeQueryTab({ sql: "SELECT 2" });
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
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

    const state = getTestWorkspace();
    const updatedTab = state.tabs.find((t) => t.id === "query-1");
    if (updatedTab && updatedTab.type === "query") {
      expect(updatedTab.sql).toBe("SELECT 2");
    }
  });

  it("clear history removes all entries", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    const tab = makeQueryTab();
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
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

  // ── Sprint 84: history paradigm metadata + paradigm-aware restore ──────

  // AC-01 — RDB tab execution records paradigm:"rdb" + queryMode:"sql".
  it("records rdb/sql metadata on history entry after RDB execute", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    const tab = makeQueryTab();
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
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
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
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
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
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
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
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
      useWorkspaceStore
        .getState()
        .updateQuerySql("conn1", "db1", "query-1", "CHANGED");
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
    const state = getTestWorkspace();
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
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });
    await waitFor(() => {
      expect(useQueryHistoryStore.getState().entries).toHaveLength(1);
    });

    await act(async () => {
      useWorkspaceStore
        .getState()
        .updateQuerySql("conn1", "db1", "query-1", "CHANGED");
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

    const state = getTestWorkspace();
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
    useWorkspaceStore.setState(seedWorkspace([rdbTab], "query-rdb-original"));
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

    // ADR 0027 — the spawned document tab lives in its own workspace
    // (conn-mongo, table_view_test); the original RDB tab stays in
    // (conn1, db1). Total tabs across both connections = 2.
    const rdbWs = getTestWorkspace("conn1", "db1");
    const docTabs = getAllTabsForConnection("conn-mongo");
    expect(rdbWs.tabs).toHaveLength(1);
    expect(docTabs).toHaveLength(1);
    // Original RDB tab is untouched (AC-10).
    const original = rdbWs.tabs.find((t) => t.id === "query-rdb-original");
    expect(original).toBeDefined();
    if (original && original.type === "query") {
      expect(original.paradigm).toBe("rdb");
      expect(original.sql).toBe("SELECT 1");
    }
    // New tab inherits the entry's paradigm + queryMode + db/coll (AC-08).
    const spawned = docTabs[0];
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
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
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
    const state = getTestWorkspace();
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
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
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
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
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
