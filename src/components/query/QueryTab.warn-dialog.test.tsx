// Sprint 255 (2026-05-09) — raw SQL/MQL editor 의 WARN-tier preview
// dialog mount. ADR 0023 grill Q3-(b) "모든 환경 + 모든 write 표면" 의
// 핵심 보호: 사용자가 raw editor 에서 ad-hoc UPDATE WHERE/ALTER additive
// 실행 시 시각적 preview 없이 즉시 IPC 발동하던 gap 을
// SqlPreviewDialog (RDB) / MqlPreviewModal (Mongo aggregate) 으로 메운다.
// Sprint 403 부터 INSERT 는 `info` tier 라 dialog 없이 직접 실행된다.
//
// 테스트 axis (TDD red-fail 우선 작성):
// - INSERT INTO single → dialog NOT mount (INFO skip)
// - UPDATE WHERE single → dialog mount + Execute click → executeQuery 1회
// - CREATE TABLE single → dialog mount + Execute click → executeQuery 1회
// - ALTER TABLE … ADD COLUMN single → dialog mount + Execute → 1회
// - SELECT single → dialog NOT mount (INFO skip)
// - EXPLAIN single → dialog NOT mount (INFO skip)
// - SHOW TABLES → dialog NOT mount (INFO skip)
// - WARN dialog Cancel click → executeQuery NOT called + dialog dismissed
// - 다중 statement (INFO + WARN) → WARN dialog 1개 mount with both stmts
// - 다중 (STOP + WARN) → STOP 우선 → ConfirmDestructiveDialog (WARN dialog NOT)
// - Mongo aggregate read-only ($match) → dialog NOT mount (INFO skip)
// - Mongo aggregate write ($out) → ConfirmDestructiveDialog (STOP 우선)
//
// `severity: "warn"` 인 non-INFO 만 WARN dialog 발동. INFO/STOP 분기는
// 위와 같이 회귀 테스트로 가드.
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
import { useSafeModeStore } from "@stores/safeModeStore";
import {
  MOCK_RESULT,
  MOCK_DOC_RESULT,
  mockExecuteQuery,
  mockCancelQuery,
  mockFindDocuments,
  mockAggregateDocuments,
  mockEditorProps,
  makeQueryTab,
  makeConn,
  makeDocTab,
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
    // 비-prod + warn → 기존 ConfirmDestructiveDialog 발동 회피 + WARN dialog
    // 만 평가하기 위한 setup. (production + warn → destructive 는 STOP, safe 는 WARN.)
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
    // STOP dialog 가 동시 mount 되어선 안 된다.
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
    // Sprint 266 — 4th arg is `expectedDatabase` (opt-in db mismatch guard).
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
    // Pre-sprint-394 behavior: CREATE was `ddl-other` / warn → mounted
    // the warn dialog and required an extra Execute click.
    // Sprint-394 (contract): CREATE TABLE / INDEX / VIEW classify as
    // `ddl-create` / info — non-destructive construction. The safe-mode
    // gate now skips the warn dialog and dispatches `executeQuery`
    // directly on the first click.
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
    // Tab 은 idle 로 유지 (running 으로 transit 안 함).
    const updated = getTestWorkspace().tabs.find((t) => t.id === "query-1");
    if (updated && updated.type === "query") {
      expect(updated.queryState.status).toBe("idle");
    }
  });

  // ── INFO skip (직접 IPC) ────────────────────────────────────────────────

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

  // ── 다중 statement 우선순위 (STOP > WARN > INFO) ──────────────────────

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
    // SqlPreviewDialog 의 Copy 버튼은 join 된 batch 를 clipboard payload 로
    // 보유한다. SqlSyntax 가 token 단위로 span 을 분리하므로 textContent
    // 매칭 대신 Copy 버튼의 aria-label 존재로 dialog 가 SQL preview 를
    // 받았다는 사실만 가드한다.
    expect(
      screen.getByRole("button", { name: "Copy SQL to clipboard" }),
    ).toBeInTheDocument();
  });

  it("[AC-255-06b] STOP + WARN 다중 (production + warn) → STOP 우선 ConfirmDestructiveDialog mount, WARN dialog 미발동", async () => {
    // production + warn — DELETE without WHERE 는 STOP, UPDATE WHERE 는 WARN.
    // STOP > WARN 우선순위로 ConfirmDestructiveDialog 만 mount.
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
    // STOP dialog 만 mount, WARN dialog 미발동.
    await waitFor(() => {
      expect(
        screen.getByTestId("confirm-destructive-confirm"),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("Review SQL Changes")).not.toBeInTheDocument();
  });

  // ── Mongo aggregate cases ──────────────────────────────────────────────

  // Sprint 311 (Phase 28 Slice A5) — document Run is parser-driven, so
  // the editor body carries a mongosh expression (`db.users.aggregate(...)`,
  // `db.users.find(...)`) rather than a bare JSON array/object. The
  // dialog mount behaviour is unchanged — gate analysis runs on the
  // parsed pipeline.
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
});
