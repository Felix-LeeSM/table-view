// WARN-tier preview dialog mount for the raw SQL/MQL editor. The core
// protection behind ADR 0023 grill Q3-(b) "every environment + every
// write surface": an ad-hoc UPDATE WHERE / ALTER additive run from the
// raw editor used to fire IPC immediately with no visual preview, and
// SqlPreviewDialog (RDB) / MqlPreviewModal (Mongo aggregate) fill that
// gap. INSERT is `info` tier, so it runs directly without a dialog.
//
// Test axis (written red-fail first):
// - INSERT INTO single → dialog NOT mount (INFO skip)
// - UPDATE WHERE single → dialog mount + Execute click → executeQuery once
// - CREATE TABLE single → dialog mount + Execute click → executeQuery once
// - ALTER TABLE … ADD COLUMN single → dialog mount + Execute → once
// - SELECT single → dialog NOT mount (INFO skip)
// - EXPLAIN single → dialog NOT mount (INFO skip)
// - SHOW TABLES → dialog NOT mount (INFO skip)
// - WARN dialog Cancel click → executeQuery NOT called + dialog dismissed
// - multi-statement (INFO + WARN) → one WARN dialog mounts with both stmts
// - multi (STOP + WARN) → STOP wins → ConfirmDestructiveDialog, no WARN dialog
// - Mongo aggregate read-only ($match) → dialog NOT mount (INFO skip)
// - Mongo aggregate write ($out) → ConfirmDestructiveDialog (STOP wins)
//
// Only the INFO tier skips the preview dialog. The INFO / STOP branches
// are guarded by the regression tests above.
//
// Issue #2375 — the dialog mount condition widened from the WARN tier to
// every non-INFO tier. Under the shipped defaults (connection environment
// tag non-production + Safe Mode `warn`) `decideSafeModeAction` lets a
// destructive statement through as `allow` and no dialog opened for it,
// so a statement that wipes a whole table met less friction than one
// scoped by `WHERE`. The `preview[danger]` cases below catch that
// inversion — `decideSafeModeAction` must still return `allow`.

import type { SQLDialect } from "@codemirror/lang-sql";
import type { Extension } from "@codemirror/state";
import { analyzeStatement } from "@lib/sql/sqlSafety";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decideSafeModeAction } from "@/lib/safeMode";
import {
  getTestWorkspace,
  seedWorkspace,
} from "@/stores/__tests__/workspaceStoreTestHelpers";
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  MOCK_DOC_RESULT,
  MOCK_RESULT,
  makeConn,
  makeDocTab,
  makeQueryTab,
  mockAggregateDocuments,
  mockCancelQuery,
  mockEditorProps,
  mockExecuteQuery,
  mockFindDocuments,
  resetQueryTabStores,
} from "./__tests__/queryTabTestHelpers";
import QueryTab from "./QueryTab";

beforeEach(() => {
  setupTauriMock({
    executeQuery: (...args: unknown[]) => mockExecuteQuery(...args),
    cancelQuery: (...args: unknown[]) => mockCancelQuery(...args),
    findDocuments: (...args: unknown[]) => mockFindDocuments(...args),
    aggregateDocuments: (...args: unknown[]) => mockAggregateDocuments(...args),
    executeQueryDryRun: vi.fn(() => Promise.resolve([])),
  });
});

vi.mock("@lib/api/verifyActiveDb", () => ({
  verifyActiveDb: vi.fn().mockResolvedValue(""),
}));

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
    const parts = sql
      .split(";")
      .map((s: string) => s.trim())
      .filter(Boolean);
    return parts.length > 0 ? parts : [];
  },
  formatSql: (sql: string) => sql.toUpperCase(),
  uglifySql: (sql: string) => sql.replace(/\s+/g, " ").trim(),
}));

function seedConnection(env: string | null) {
  useConnectionStore.setState({
    connections: [makeConn({ id: "conn1", environment: env })],
  });
}

function seedDocConnection(env: string | null) {
  useConnectionStore.setState({
    connections: [
      makeConn({
        id: "conn-mongo",
        environment: env,
        dbType: "mongodb",
        paradigm: "document",
      }),
    ],
  });
}

function seedTab(sql: string) {
  const tab = makeQueryTab({ sql });
  useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
  return tab;
}

function seedDocTab(sql: string, queryMode: "find" | "aggregate") {
  const tab = makeDocTab({ sql, queryMode });
  useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
  return tab;
}

describe("QueryTab — Sprint 255 WARN dialog mount (raw SQL/MQL editor)", () => {
  beforeEach(() => {
    resetQueryTabStores();
    // Non-prod + warn: setup that avoids firing the existing
    // ConfirmDestructiveDialog so only the WARN dialog is evaluated.
    // (production + warn → destructive is STOP, safe is WARN.)
    useSafeModeStore.setState({ mode: "warn" });
  });

  // ── RDB WARN dialog mount cases ─────────────────────────────────────────

  it("[AC-403-06a] INSERT INTO single → dialog NOT mount, executeQuery 1회 직접 호출", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    seedConnection("development");
    const tab = seedTab("INSERT INTO users (id, name) VALUES (1, 'a')");
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    await waitFor(() => {
      expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText("Review SQL Changes")).not.toBeInTheDocument();
    // The STOP dialog must not mount at the same time.
    expect(
      screen.queryByTestId("confirm-destructive-confirm"),
    ).not.toBeInTheDocument();
  });

  it("[AC-255-03b] UPDATE WHERE single → dialog mount + Execute → executeQuery 1회 호출", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    seedConnection("development");
    const tab = seedTab("UPDATE users SET name = 'a' WHERE id = 1");
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    expect(mockExecuteQuery).not.toHaveBeenCalled();

    const executeBtn = await screen.findByRole("button", { name: /execute/i });
    await act(async () => {
      executeBtn.click();
    });

    await waitFor(() => {
      expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    });
    // 4th arg is `expectedDatabase` (opt-in db mismatch guard).
    expect(mockExecuteQuery).toHaveBeenCalledWith(
      "conn1",
      "UPDATE users SET name = 'a' WHERE id = 1",
      expect.any(String),
      expect.any(String),
      // Issue #1112 — WARN-tier confirm is not backend-gated; flag stays unset.
      undefined,
    );
  });

  it("[AC-255-03c] CREATE TABLE single → sprint-394 ddl-create/info → dialog SKIPPED → executeQuery 1회 호출", async () => {
    // Earlier behaviour: CREATE was `ddl-other` / warn → mounted the
    // warn dialog and required an extra Execute click.
    // Contract: CREATE TABLE / INDEX / VIEW classify as `ddl-create` /
    // info — non-destructive construction. The safe-mode gate skips the
    // warn dialog and dispatches `executeQuery` directly on the first
    // click.
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    seedConnection("development");
    const tab = seedTab("CREATE TABLE foo (id int)");
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    await waitFor(() => {
      expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    });
    // The warn dialog should never have mounted.
    expect(screen.queryByText("Review SQL Changes")).not.toBeInTheDocument();
  });

  it("[AC-255-03d] ALTER TABLE … ADD COLUMN (additive) → dialog mount + Execute → executeQuery 1회 호출", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    seedConnection("development");
    const tab = seedTab("ALTER TABLE users ADD COLUMN nickname text");
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    expect(mockExecuteQuery).not.toHaveBeenCalled();
    const executeBtn = await screen.findByRole("button", { name: /execute/i });
    await act(async () => {
      executeBtn.click();
    });
    await waitFor(() => {
      expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    });
  });

  // ── Issue #2375 — the danger tier gets a preview too ────────────────────

  it("[AC-2375-01a] preview[danger] DROP TABLE — 비프로덕션 + warn 에서 dialog mount, Execute → executeQuery 1회", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    seedConnection("development");
    const tab = seedTab("DROP TABLE foo");
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    // Nothing goes out to the driver before the dialog opens — before
    // the fix, executeQuery had already been called once at this point.
    expect(mockExecuteQuery).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText("Review SQL Changes")).toBeInTheDocument();
    });
    // The decision function is untouched: opening the preview is the
    // QueryTab surface's job, and `decideSafeModeAction` still lets this
    // statement through as `allow`. (A `confirm` here would mean the
    // ADR 0022 matrix was changed.)
    expect(
      decideSafeModeAction(
        "warn",
        "development",
        analyzeStatement("DROP TABLE foo"),
      ),
    ).toEqual({ action: "allow" });
    // ConfirmDestructiveDialog did not open in its place either.
    expect(
      screen.queryByTestId("confirm-destructive-confirm"),
    ).not.toBeInTheDocument();

    const executeBtn = await screen.findByRole("button", { name: /execute/i });
    await act(async () => {
      executeBtn.click();
    });
    await waitFor(() => {
      expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    });
  });

  it("[AC-2375-01b] preview[danger] DELETE without WHERE — 환경 태그 없음 + off 에서도 dialog mount", async () => {
    // An untagged connection + Safe Mode `off` is another cell where
    // `decideSafeModeAction` hands a destructive statement `allow`. It
    // has to get the same preview so friction does not run counter to
    // the tier.
    seedConnection(null);
    useSafeModeStore.setState({ mode: "off" });
    const tab = seedTab("DELETE FROM users");
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    expect(mockExecuteQuery).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText("Review SQL Changes")).toBeInTheDocument();
    });
    expect(
      decideSafeModeAction("off", null, analyzeStatement("DELETE FROM users")),
    ).toEqual({ action: "allow" });
  });

  it("[AC-255-04a] WARN dialog Cancel click → dialog dismissed + executeQuery NOT called", async () => {
    seedConnection("development");
    const tab = seedTab("UPDATE users SET name = 'a' WHERE id = 1");
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    await waitFor(() => {
      expect(screen.getByText("Review SQL Changes")).toBeInTheDocument();
    });

    const cancelBtn = await screen.findByRole("button", { name: "Cancel" });
    await act(async () => {
      cancelBtn.click();
    });

    expect(mockExecuteQuery).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByText("Review SQL Changes")).not.toBeInTheDocument();
    });
    // The tab stays idle (no transition to running).
    const updated = getTestWorkspace().tabs.find((t) => t.id === "query-1");
    if (updated && updated.type === "query") {
      expect(updated.queryState.status).toBe("idle");
    }
  });

  // ── INFO skip (direct IPC) ──────────────────────────────────────────────

  it("[AC-255-05a] SELECT single → dialog NOT mount, executeQuery 1회 직접 호출", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    seedConnection("development");
    const tab = seedTab("SELECT * FROM users");
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    await waitFor(() => {
      expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText("Review SQL Changes")).not.toBeInTheDocument();
  });

  it("[AC-255-05b] EXPLAIN → dialog NOT mount (INFO skip)", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    seedConnection("development");
    const tab = seedTab("EXPLAIN SELECT * FROM users");
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    await waitFor(() => {
      expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText("Review SQL Changes")).not.toBeInTheDocument();
  });

  it("[AC-255-05c] SHOW TABLES → dialog NOT mount (INFO skip)", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    seedConnection("development");
    const tab = seedTab("SHOW TABLES");
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    await waitFor(() => {
      expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText("Review SQL Changes")).not.toBeInTheDocument();
  });

  it("[AC-255-05d] DESCRIBE users → dialog NOT mount (INFO skip)", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    seedConnection("development");
    const tab = seedTab("DESCRIBE users");
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    await waitFor(() => {
      expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText("Review SQL Changes")).not.toBeInTheDocument();
  });

  // ── Multi-statement priority (STOP > WARN > INFO) ───────────────────────

  it("[AC-255-06a] INFO + WARN 다중 → WARN dialog 1개 mount (preview에 join된 batch 등장)", async () => {
    seedConnection("development");
    const tab = seedTab("SELECT 1; UPDATE users SET name = 'a' WHERE id = 1");
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    expect(mockExecuteQuery).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText("Review SQL Changes")).toBeInTheDocument();
    });
    // The SqlPreviewDialog Copy button holds the joined batch as its
    // clipboard payload. SqlSyntax splits spans per token, so instead of
    // matching textContent this guards only that the dialog received a
    // SQL preview, through the presence of the Copy button's aria-label.
    expect(
      screen.getByRole("button", { name: "Copy SQL to clipboard" }),
    ).toBeInTheDocument();
  });

  it("[AC-255-06b] STOP + WARN 다중 (production + warn) → STOP 우선 ConfirmDestructiveDialog mount, WARN dialog 미발동", async () => {
    // production + warn — DELETE without WHERE is STOP, UPDATE WHERE is
    // WARN. STOP > WARN priority means only ConfirmDestructiveDialog
    // mounts.
    seedConnection("production");
    useSafeModeStore.setState({ mode: "warn" });
    const tab = seedTab(
      "UPDATE users SET name = 'a' WHERE id = 1; DELETE FROM logs",
    );
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    expect(mockExecuteQuery).not.toHaveBeenCalled();
    // Only the STOP dialog mounts; the WARN dialog does not fire.
    await waitFor(() => {
      expect(
        screen.getByTestId("confirm-destructive-confirm"),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("Review SQL Changes")).not.toBeInTheDocument();
  });

  // ── Mongo aggregate cases ──────────────────────────────────────────────

  // Document Run is parser-driven, so the editor body carries a mongosh
  // expression (`db.users.aggregate(...)`, `db.users.find(...)`) rather
  // than a bare JSON array/object. The dialog mount behaviour is
  // unchanged — gate analysis runs on the parsed pipeline.
  it("[AC-255-07a] Mongo aggregate read-only ($match) → dialog NOT mount (INFO skip), aggregateDocuments 1회 호출", async () => {
    mockAggregateDocuments.mockResolvedValueOnce(MOCK_DOC_RESULT);
    seedDocConnection("development");
    const tab = seedDocTab(
      "db.users.aggregate([{$match:{active:true}}])",
      "aggregate",
    );
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    await waitFor(() => {
      expect(mockAggregateDocuments).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText("MQL Preview")).not.toBeInTheDocument();
  });

  it("[AC-255-07b] Mongo find → dialog NOT mount (INFO 항상), findDocuments 1회 호출", async () => {
    mockFindDocuments.mockResolvedValueOnce(MOCK_DOC_RESULT);
    seedDocConnection("development");
    const tab = seedDocTab("db.users.find({active:true})", "find");
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    await waitFor(() => {
      expect(mockFindDocuments).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText("MQL Preview")).not.toBeInTheDocument();
  });

  it("[AC-255-07c] Mongo aggregate write ($out) under production+warn → STOP dialog (ConfirmDestructiveDialog), MQL Preview 미발동", async () => {
    seedDocConnection("production");
    useSafeModeStore.setState({ mode: "warn" });
    const tab = seedDocTab(
      'db.users.aggregate([{$out:"snapshot"}])',
      "aggregate",
    );
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    expect(mockAggregateDocuments).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(
        screen.getByTestId("confirm-destructive-confirm"),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("MQL Preview")).not.toBeInTheDocument();
  });

  it("[AC-2375-02] preview[danger] Mongo aggregate $out — 비프로덕션 + warn 에서 MQL Preview mount", async () => {
    // The same pipeline gets the STOP dialog on production, as in
    // [AC-255-07c] above. On non-production `decideSafeModeAction`
    // returns `allow`, so before the fix aggregateDocuments went straight
    // out with no dialog.
    seedDocConnection("development");
    useSafeModeStore.setState({ mode: "warn" });
    const tab = seedDocTab(
      'db.users.aggregate([{$out:"snapshot"}])',
      "aggregate",
    );
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    expect(mockAggregateDocuments).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText("MQL Preview")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("confirm-destructive-confirm"),
    ).not.toBeInTheDocument();
  });
});
