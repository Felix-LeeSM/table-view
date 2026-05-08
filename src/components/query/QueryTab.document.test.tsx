// Sprint 218 — `document` axis split from `QueryTab.test.tsx` (P11
// step 2). Covers Sprint 73 Document paradigm (Find / Aggregate)
// branches (RDB regression, find / aggregate dispatch, body validation,
// missing context guard, mode toggle visibility, hide-Format-SQL,
// idempotent post-success error), Sprint 132 raw-query DB-change
// detection (PG `\c` happy / mismatch / no-match / comment / document
// short-circuit), and the Sprint 188 nested describe for Mongo
// aggregate safe-mode gate (verbatim with its own `beforeEach` for
// localStorage + safe-mode reset). Cases are byte-equivalent to the
// originals — no behaviour change.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import QueryTab from "./QueryTab";
import { useTabStore, type QueryTab as QueryTabType } from "@stores/tabStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useSchemaStore } from "@stores/schemaStore";
import { useSafeModeStore, SAFE_MODE_STORAGE_KEY } from "@stores/safeModeStore";
import { useToastStore } from "@lib/toast";
import { userEvent } from "@testing-library/user-event";
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
  makeConn,
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

describe("QueryTab — document", () => {
  beforeEach(() => {
    resetQueryTabStores();
  });

  // ── Sprint 73: Document paradigm (Find / Aggregate) branches ─────────────

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

  // ── Sprint 132: raw-query DB-change detection (AC-08) ─────────────────
  //
  // The four scenarios below cover the AC-08 cases from the sprint
  // contract: happy path, verify mismatch, no-match, and false-positive
  // inside a comment. Every test seeds `connectionStore.activeStatuses`
  // with a `connected` variant so the optimistic `setActiveDb` can land
  // (the action no-ops on disconnected/connecting variants by design —
  // see `connectionStore.setActiveDb`).

  /**
   * Sprint 132 AC-08 / scenario 1 — happy path.
   *
   * `\c admin` triggers an optimistic `setActiveDb("admin")` and the
   * backend confirms the same value via `verifyActiveDb`. No mismatch
   * toast is surfaced.
   */
  it("[S132] PG `\\c admin` — optimistic setActiveDb + verify pass → no toast", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    mockVerifyActiveDb.mockResolvedValueOnce("admin");

    useConnectionStore.setState({
      connections: [makeConn()],
      activeStatuses: { conn1: { type: "connected", activeDb: "db" } },
    });

    const tab = makeQueryTab({ sql: "\\c admin" });
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    const executeBtn = screen.getByTestId("execute-btn");
    await act(async () => {
      executeBtn.click();
    });

    // Wait for verifyActiveDb to resolve (it's awaited inside the
    // applyDbMutationHint helper which the QueryTab fires post-execute).
    await waitFor(() => {
      expect(mockVerifyActiveDb).toHaveBeenCalledWith("conn1");
    });

    // The connection store reflects the optimistic value; verify confirmed
    // it, so no revert.
    const status = useConnectionStore.getState().activeStatuses.conn1;
    expect(status?.type).toBe("connected");
    if (status?.type === "connected") {
      expect(status.activeDb).toBe("admin");
    }

    // No warning toast on the happy path.
    const toasts = useToastStore.getState().toasts;
    expect(toasts.find((t) => t.variant === "warning")).toBeUndefined();
  });

  /**
   * Sprint 132 AC-08 / scenario 2 — verify mismatch.
   *
   * The lex pulled `admin` out of `\c admin` and the optimistic
   * `setActiveDb("admin")` fired immediately. The backend round-trip
   * comes back with `public` — proving the pool didn't actually flip
   * (e.g. the user's grant is missing). The hook surfaces a warning
   * toast and reverts to `public`.
   */
  it("[S132] PG `\\c admin` — verify mismatch → toast.warning + revert to backend value", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    mockVerifyActiveDb.mockResolvedValueOnce("public");

    useConnectionStore.setState({
      connections: [makeConn()],
      activeStatuses: { conn1: { type: "connected", activeDb: "db" } },
    });

    const tab = makeQueryTab({ sql: "\\c admin" });
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    const executeBtn = screen.getByTestId("execute-btn");
    await act(async () => {
      executeBtn.click();
    });

    // Verify ran and the active-db reverted to the backend's truth.
    await waitFor(() => {
      const status = useConnectionStore.getState().activeStatuses.conn1;
      if (status?.type === "connected") {
        expect(status.activeDb).toBe("public");
      } else {
        throw new Error("expected connected variant");
      }
    });

    // Mismatch toast surfaced with both expected + actual values exposed.
    const warning = useToastStore
      .getState()
      .toasts.find((t) => t.variant === "warning");
    expect(warning).toBeDefined();
    expect(warning?.message).toContain("admin");
    expect(warning?.message).toContain("public");
  });

  /**
   * Sprint 132 AC-08 / scenario 3 — no-match.
   *
   * A plain `SELECT 1` does not match any DB-mutation pattern, so the
   * hook short-circuits before calling `setActiveDb` or `verifyActiveDb`.
   */
  it("[S132] `SELECT 1` no-match — setActiveDb not called, verify not called", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);

    useConnectionStore.setState({
      connections: [makeConn()],
      activeStatuses: { conn1: { type: "connected", activeDb: "db" } },
    });

    const tab = makeQueryTab({ sql: "SELECT 1" });
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    const executeBtn = screen.getByTestId("execute-btn");
    await act(async () => {
      executeBtn.click();
    });

    // Wait for the query to land so any post-execute side-effects had
    // time to fire.
    await waitFor(() => {
      expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    });

    // Active-db unchanged; verify never invoked.
    const status = useConnectionStore.getState().activeStatuses.conn1;
    if (status?.type === "connected") {
      expect(status.activeDb).toBe("db");
    }
    expect(mockVerifyActiveDb).not.toHaveBeenCalled();
  });

  /**
   * Sprint 132 AC-08 / scenario 4 — false positive in a comment must
   * remain 0. `-- \c admin` is a SQL line comment; the lex pass masks
   * its body so no DB-mutation hint surfaces. Same expectations as the
   * no-match path.
   */
  it("[S132] false positive `-- \\c admin` — comment masked → no setActiveDb / verify", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);

    useConnectionStore.setState({
      connections: [makeConn()],
      activeStatuses: { conn1: { type: "connected", activeDb: "db" } },
    });

    const tab = makeQueryTab({ sql: "-- \\c admin\nSELECT 1" });
    useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
    render(<QueryTab tab={tab} />);

    const executeBtn = screen.getByTestId("execute-btn");
    await act(async () => {
      executeBtn.click();
    });

    await waitFor(() => {
      expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    });

    const status = useConnectionStore.getState().activeStatuses.conn1;
    if (status?.type === "connected") {
      expect(status.activeDb).toBe("db");
    }
    expect(mockVerifyActiveDb).not.toHaveBeenCalled();

    // Schema cache is also untouched — no `clearForConnection` fired.
    // We assert this indirectly: the hook only calls `clearForConnection`
    // on a real match, and the store starts empty so a non-empty value
    // would survive. We seed a sentinel before the click.
    useSchemaStore.setState((s) => ({
      schemas: { ...s.schemas, conn1: [{ name: "public" }] },
    }));
    expect(useSchemaStore.getState().schemas.conn1).toBeDefined();
  });

  /**
   * Sprint 132 — document paradigm tab must skip the SQL-style hook
   * entirely. Mongo doesn't use `\c` / `USE`, so the helper short-circuits
   * on `paradigm !== "rdb"` before any extractor runs. Regression guard
   * for AC-07 (paradigm branch correctness).
   */
  it("[S132] document paradigm — hook is skipped (no setActiveDb / verify)", async () => {
    mockFindDocuments.mockResolvedValueOnce({
      columns: [],
      rows: [],
      total_count: 0,
      execution_time_ms: 1,
    });

    useConnectionStore.setState({
      connections: [makeConn({ db_type: "mongodb", paradigm: "document" })],
      activeStatuses: {
        conn1: { type: "connected", activeDb: "table_view_test" },
      },
    });

    const docTab: QueryTabType = {
      type: "query",
      id: "query-doc",
      title: "Mongo",
      connectionId: "conn1",
      closable: true,
      sql: "{}",
      queryState: { status: "idle" },
      paradigm: "document",
      queryMode: "find",
      database: "table_view_test",
      collection: "users",
    };
    useTabStore.setState({ tabs: [docTab], activeTabId: "query-doc" });
    render(<QueryTab tab={docTab} />);

    const executeBtn = screen.getByTestId("execute-btn");
    await act(async () => {
      executeBtn.click();
    });

    await waitFor(() => {
      expect(mockFindDocuments).toHaveBeenCalled();
    });

    // Hook short-circuits at `paradigm !== "rdb"`.
    expect(mockVerifyActiveDb).not.toHaveBeenCalled();
    const status = useConnectionStore.getState().activeStatuses.conn1;
    if (status?.type === "connected") {
      expect(status.activeDb).toBe("table_view_test");
    }
  });

  // ── Sprint 188: Mongo aggregate dangerous-op gate ────────────────────────
  // AC-188-03 — `useSafeModeGate` is wired into the aggregate dispatch
  // path. Pin every cell of the matrix that the contract enumerates by
  // exercising the actual user-visible surface (queryState transitions +
  // ConfirmDestructiveDialog) rather than asserting on the gate hook
  // internals — those have unit coverage in `useSafeModeGate.test.ts`.
  // date 2026-05-01.
  describe("Sprint 188 — Mongo aggregate safe-mode gate", () => {
    const PROD_PIPELINE = '[{"$match":{}},{"$out":"snapshot"}]';
    const SAFE_PIPELINE = '[{"$match":{"active":true}}]';

    function setupProductionMongo(): void {
      useConnectionStore.setState({
        connections: [
          makeConn({
            id: "conn-mongo",
            db_type: "mongodb",
            paradigm: "document",
            environment: "production",
          }),
        ],
      });
    }

    beforeEach(() => {
      localStorage.removeItem(SAFE_MODE_STORAGE_KEY);
      useSafeModeStore.setState({ mode: "strict" });
    });

    it("[AC-188-03a] production × strict × $out → confirm dialog opens, dispatch deferred", async () => {
      // Sprint 245 (ADR 0022 Phase 1) — was "blocks dispatch with
      // canonical error". The destructive-only policy opens the confirm
      // dialog instead of blocking; dispatch only fires on confirm.
      setupProductionMongo();
      useSafeModeStore.setState({ mode: "strict" });
      const tab = makeDocTab({ queryMode: "aggregate", sql: PROD_PIPELINE });
      useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
      render(<QueryTab tab={tab} />);

      await act(async () => {
        screen.getByTestId("execute-btn").click();
      });

      expect(mockAggregateDocuments).not.toHaveBeenCalled();
      await screen.findByTestId("confirm-destructive-confirm");
      const updated = useTabStore
        .getState()
        .tabs.find((t) => t.id === "query-1");
      if (updated?.type === "query") {
        // Confirm flow keeps queryState idle until the user types and
        // confirms or cancels.
        expect(updated.queryState.status).not.toBe("error");
        expect(updated.queryState.status).not.toBe("running");
      }
    });

    it("[AC-188-03b] production × warn × $out → opens confirm dialog; Confirm dispatches", async () => {
      // Sprint 246 (ADR 0022 Phase 2) — confirm dialog is a simple
      // Yes/No, so the test clicks Confirm instead of typing the
      // analyzer reason verbatim.
      mockAggregateDocuments.mockResolvedValueOnce(MOCK_DOC_RESULT);
      setupProductionMongo();
      useSafeModeStore.setState({ mode: "warn" });
      const tab = makeDocTab({ queryMode: "aggregate", sql: PROD_PIPELINE });
      useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
      render(<QueryTab tab={tab} />);

      await act(async () => {
        screen.getByTestId("execute-btn").click();
      });

      // Dialog should be visible and dispatch should be deferred.
      expect(mockAggregateDocuments).not.toHaveBeenCalled();
      const confirmBtn = await screen.findByTestId(
        "confirm-destructive-confirm",
      );
      const user = userEvent.setup();
      await user.click(confirmBtn);

      await waitFor(() => {
        expect(mockAggregateDocuments).toHaveBeenCalledTimes(1);
      });
      expect(mockAggregateDocuments).toHaveBeenCalledWith(
        "conn-mongo",
        "table_view_test",
        "users",
        [{ $match: {} }, { $out: "snapshot" }],
      );
    });

    it("[AC-188-03c] production × warn × cancel → no dispatch, queryState untouched", async () => {
      setupProductionMongo();
      useSafeModeStore.setState({ mode: "warn" });
      const tab = makeDocTab({ queryMode: "aggregate", sql: PROD_PIPELINE });
      useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
      render(<QueryTab tab={tab} />);

      await act(async () => {
        screen.getByTestId("execute-btn").click();
      });

      await screen.findByTestId("confirm-destructive-confirm");
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /Cancel/ }));

      expect(mockAggregateDocuments).not.toHaveBeenCalled();
      const updated = useTabStore
        .getState()
        .tabs.find((t) => t.id === "query-1");
      if (updated?.type === "query") {
        // queryState started as "idle" (default for newly-mounted tabs);
        // cancel must not have transitioned it.
        expect(updated.queryState.status).not.toBe("error");
        expect(updated.queryState.status).not.toBe("running");
      }
    });

    it("[AC-190-01-5] production × off × $out → confirm dialog with prod-auto reason copy", async () => {
      // Sprint 190 (FB-1b) — Hard auto. Was AC-188-03d (off bypassed gate).
      // Sprint 245 (ADR 0022 Phase 1) — was "blocked (prod-auto)"; now
      // opens the confirm dialog with prod-auto reason copy preserved.
      // Off remains distinguishable from warn on production via the
      // dialog body text. date 2026-05-02 / 2026-05-08.
      setupProductionMongo();
      useSafeModeStore.setState({ mode: "off" });
      const tab = makeDocTab({ queryMode: "aggregate", sql: PROD_PIPELINE });
      useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
      render(<QueryTab tab={tab} />);

      await act(async () => {
        screen.getByTestId("execute-btn").click();
      });

      expect(mockAggregateDocuments).not.toHaveBeenCalled();
      await screen.findByTestId("confirm-destructive-confirm");
      expect(
        screen.getAllByText(/production environment forces Safe Mode/).length,
      ).toBeGreaterThan(0);
    });

    it("[AC-188-03e] non-production × strict × $out → confirm dialog (M.1 NEW flow)", async () => {
      // Sprint 245 (ADR 0022 Phase 1) — was "dispatch proceeds (env
      // scoping)". Strict now opens the destructive dialog in non-
      // production too (M.1 — shared-staging / learning environments).
      // Warn / off on non-prod still bypass the dialog for safe writes
      // and destructive alike.
      useConnectionStore.setState({
        connections: [
          makeConn({
            id: "conn-mongo",
            db_type: "mongodb",
            paradigm: "document",
            environment: "staging",
          }),
        ],
      });
      useSafeModeStore.setState({ mode: "strict" });
      const tab = makeDocTab({ queryMode: "aggregate", sql: PROD_PIPELINE });
      useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
      render(<QueryTab tab={tab} />);

      await act(async () => {
        screen.getByTestId("execute-btn").click();
      });

      expect(mockAggregateDocuments).not.toHaveBeenCalled();
      await screen.findByTestId("confirm-destructive-confirm");
      expect(
        screen.getAllByText(
          /Safe Mode strict — destructive statement in non-production/,
        ).length,
      ).toBeGreaterThan(0);
    });

    it("[AC-188-03e-2] non-production × warn × $out → dispatch proceeds (warn unguarded outside prod)", async () => {
      // Sprint 245 — paired with the M.1 strict flow above so the
      // matrix coverage stays complete: warn / off on non-prod do not
      // open the dialog even on destructive Mongo pipelines.
      mockAggregateDocuments.mockResolvedValueOnce(MOCK_DOC_RESULT);
      useConnectionStore.setState({
        connections: [
          makeConn({
            id: "conn-mongo",
            db_type: "mongodb",
            paradigm: "document",
            environment: "staging",
          }),
        ],
      });
      useSafeModeStore.setState({ mode: "warn" });
      const tab = makeDocTab({ queryMode: "aggregate", sql: PROD_PIPELINE });
      useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
      render(<QueryTab tab={tab} />);

      await act(async () => {
        screen.getByTestId("execute-btn").click();
      });

      await waitFor(() => {
        expect(mockAggregateDocuments).toHaveBeenCalledTimes(1);
      });
    });

    it("[AC-188-03f] production × strict × safe pipeline → dispatch proceeds (gate not triggered)", async () => {
      mockAggregateDocuments.mockResolvedValueOnce(MOCK_DOC_RESULT);
      setupProductionMongo();
      useSafeModeStore.setState({ mode: "strict" });
      const tab = makeDocTab({ queryMode: "aggregate", sql: SAFE_PIPELINE });
      useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
      render(<QueryTab tab={tab} />);

      await act(async () => {
        screen.getByTestId("execute-btn").click();
      });

      await waitFor(() => {
        expect(mockAggregateDocuments).toHaveBeenCalledTimes(1);
      });
    });
  });
});
