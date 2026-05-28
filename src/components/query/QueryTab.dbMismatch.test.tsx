// Sprint 267 (2026-05-12) — DbMismatch auto-sync. Sprint 266 의
// expected_database 가드가 backend 에서 mismatch 를 차단한 후 frontend 가
// 즉시 verifyActiveDb 로 backend 의 actual db 를 받아 connectionStore +
// schemaStore 를 sync. 다음 user click 이 올바른 expectedDatabase 로
// 재시도되도록 함.
//
// 작성 위치 분리: execution.test.tsx 와 같은 module 에 두니 toast.warning
// + connectionStore 변경의 async chain 이 직전 테스트(uglify) 의 SQL 변경
// 이벤트 처리와 race. 본 sprint 의 신규 case 들만 격리해 격동 차단.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  seedWorkspace,
  getTestWorkspace,
} from "@/stores/__tests__/workspaceStoreTestHelpers";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QueryTab from "./QueryTab";
import { Toaster } from "@/components/ui/toaster";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useToastStore } from "@stores/toastStore";
import {
  mockExecuteQuery,
  mockCancelQuery,
  mockFindDocuments,
  mockAggregateDocuments,
  mockVerifyActiveDb,
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

vi.mock("@lib/api/verifyActiveDb", () => ({
  verifyActiveDb: (...args: unknown[]) => mockVerifyActiveDb(...args),
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
  splitSqlStatements: (sql: string) =>
    sql
      .split(";")
      .map((s: string) => s.trim())
      .filter(Boolean),
  formatSql: (sql: string) => sql.toUpperCase(),
  uglifySql: (sql: string) => sql.replace(/\s+/g, " ").trim(),
}));

function seedConn1WithActiveDb(activeDb: string): void {
  useConnectionStore.setState({
    connections: [
      {
        id: "conn1",
        name: "Test",
        dbType: "postgresql",
        host: "h",
        port: 5432,
        user: "u",
        database: "db1",
        groupId: null,
        color: null,
        hasPassword: false,
        paradigm: "rdb",
      },
    ],
    activeStatuses: { conn1: { type: "connected", activeDb } },
  });
}

describe("QueryTab — DbMismatch auto-sync (Sprint 267)", () => {
  beforeEach(() => {
    resetQueryTabStores();
  });

  it("syncs frontend activeDb when single-statement executeQuery returns DbMismatch", async () => {
    seedConn1WithActiveDb("db1");
    mockExecuteQuery.mockRejectedValueOnce(
      new Error(
        "Database mismatch: expected 'db1', backend pool has 'db_actual'",
      ),
    );
    mockVerifyActiveDb.mockResolvedValueOnce("db_actual");

    const tab = makeQueryTab();
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    await waitFor(() => {
      expect(mockVerifyActiveDb).toHaveBeenCalledWith("conn1");
    });
    await waitFor(() => {
      const status = useConnectionStore.getState().activeStatuses.conn1;
      expect(status?.type).toBe("connected");
      if (status && status.type === "connected") {
        expect(status.activeDb).toBe("db_actual");
      }
    });
  });

  it("syncs frontend activeDb on multi-statement batch when any statement hits DbMismatch", async () => {
    seedConn1WithActiveDb("db1");
    mockExecuteQuery
      .mockRejectedValueOnce(
        new Error(
          "Database mismatch: expected 'db1', backend pool has 'db_actual'",
        ),
      )
      .mockRejectedValueOnce(
        new Error(
          "Database mismatch: expected 'db1', backend pool has 'db_actual'",
        ),
      );
    mockVerifyActiveDb.mockResolvedValue("db_actual");

    const tab = makeQueryTab({ sql: "SELECT 1; SELECT 2" });
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    await waitFor(() => {
      const status = useConnectionStore.getState().activeStatuses.conn1;
      expect(status?.type).toBe("connected");
      if (status && status.type === "connected") {
        expect(status.activeDb).toBe("db_actual");
      }
    });
  });

  it("does NOT call verifyActiveDb when the error is not a DbMismatch", async () => {
    seedConn1WithActiveDb("db1");
    mockExecuteQuery.mockRejectedValueOnce(
      new Error("syntax error at or near 'FORM'"),
    );

    const tab = makeQueryTab();
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    // Let the post-execute dispatchDbMutationHint (best-effort) settle.
    // It only fires verifyActiveDb when the SQL contains \c db / USE db,
    // which "SELECT 1" does not — so verify must remain at zero calls.
    await waitFor(() => {
      const state = getTestWorkspace();
      const t = state.tabs.find((x) => x.id === "query-1");
      expect(t).toBeDefined();
      if (t && t.type === "query") {
        expect(t.queryState.status).toBe("error");
      }
    });
    expect(mockVerifyActiveDb).not.toHaveBeenCalled();
    // Sprint 269 (2026-05-13) — AC-269-04 specificity gate. Non-mismatch
    // errors must NOT push an action-bearing toast. Positive assertion that
    // no toast in the queue carries an `action` field — preserves the
    // Sprint 267 specificity invariant in the post-Retry world.
    const queueAfter = useToastStore.getState().toasts;
    expect(queueAfter.every((t) => t.action === undefined)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Sprint 269 (2026-05-13) — DbMismatch toast Retry button.
  // Reason: the passive `toast.warning(...)` Sprint 267 surfaced left the user
  // with no affordance to re-run the same query against the now-synced active
  // db. These cases pin the Retry action shape + re-dispatch semantics +
  // closure guards.
  // ---------------------------------------------------------------------------

  it("AC-269-01: mismatch error surfaces a toast with an accessible Retry button", async () => {
    seedConn1WithActiveDb("db1");
    mockExecuteQuery.mockRejectedValueOnce(
      new Error(
        "Database mismatch: expected 'db1', backend pool has 'db_actual'",
      ),
    );
    mockVerifyActiveDb.mockResolvedValueOnce("db_actual");

    const tab = makeQueryTab();
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    render(
      <>
        <QueryTab tab={tab} />
        <Toaster />
      </>,
    );

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(retry.getAttribute("type")).toBe("button");
  });

  it("AC-269-02 single: clicking Retry re-dispatches the same statement", async () => {
    const user = userEvent.setup();
    seedConn1WithActiveDb("db1");
    // First call: mismatch. Second call (after Retry): success.
    mockExecuteQuery
      .mockRejectedValueOnce(
        new Error(
          "Database mismatch: expected 'db1', backend pool has 'db_actual'",
        ),
      )
      .mockResolvedValueOnce({
        columns: [],
        rows: [],
        totalCount: 0,
        executionTimeMs: 1,
        queryType: "select",
      });
    mockVerifyActiveDb.mockResolvedValueOnce("db_actual");

    const tab = makeQueryTab({ sql: "SELECT 1" });
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    render(
      <>
        <QueryTab tab={tab} />
        <Toaster />
      </>,
    );

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    const retry = await screen.findByRole("button", { name: "Retry" });
    await act(async () => {
      await user.click(retry);
    });

    await waitFor(() => {
      expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
    });
    // Same `stmt` re-dispatched on Retry.
    expect(mockExecuteQuery.mock.calls[1]?.[0]).toBe("conn1");
    expect(mockExecuteQuery.mock.calls[1]?.[1]).toBe("SELECT 1");
  });

  it("AC-269-02 batch: clicking Retry re-runs the same multi-statement batch", async () => {
    const user = userEvent.setup();
    seedConn1WithActiveDb("db1");
    // First two calls (initial batch): both reject with mismatch.
    // Retry batch: both succeed.
    mockExecuteQuery
      .mockRejectedValueOnce(
        new Error(
          "Database mismatch: expected 'db1', backend pool has 'db_actual'",
        ),
      )
      .mockRejectedValueOnce(
        new Error(
          "Database mismatch: expected 'db1', backend pool has 'db_actual'",
        ),
      )
      .mockResolvedValueOnce({
        columns: [],
        rows: [],
        totalCount: 0,
        executionTimeMs: 1,
        queryType: "select",
      })
      .mockResolvedValueOnce({
        columns: [],
        rows: [],
        totalCount: 0,
        executionTimeMs: 1,
        queryType: "select",
      });
    mockVerifyActiveDb.mockResolvedValue("db_actual");

    const tab = makeQueryTab({ sql: "SELECT 1; SELECT 2" });
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    render(
      <>
        <QueryTab tab={tab} />
        <Toaster />
      </>,
    );

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    const retry = await screen.findByRole("button", { name: "Retry" });
    await act(async () => {
      await user.click(retry);
    });

    // Initial batch (2 statements) + retry batch (2 statements) = 4 calls.
    await waitFor(() => {
      expect(mockExecuteQuery).toHaveBeenCalledTimes(4);
    });
    expect(mockExecuteQuery.mock.calls[2]?.[1]).toBe("SELECT 1");
    expect(mockExecuteQuery.mock.calls[3]?.[1]).toBe("SELECT 2");
  });

  it("AC-269-03 closed-tab: Retry no-ops when the tab no longer exists", async () => {
    const user = userEvent.setup();
    seedConn1WithActiveDb("db1");
    mockExecuteQuery.mockRejectedValueOnce(
      new Error(
        "Database mismatch: expected 'db1', backend pool has 'db_actual'",
      ),
    );
    mockVerifyActiveDb.mockResolvedValueOnce("db_actual");

    const tab = makeQueryTab();
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    render(
      <>
        <QueryTab tab={tab} />
        <Toaster />
      </>,
    );

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    const retry = await screen.findByRole("button", { name: "Retry" });

    // Remove the tab from the workspace before clicking Retry. The retry
    // closure must observe the missing tab via
    // `useWorkspaceStore.getState()` and bail out.
    act(() => {
      useWorkspaceStore.setState({ workspaces: {} });
    });

    await act(async () => {
      await user.click(retry);
    });

    // Initial call only; the closed-tab guard suppressed the re-dispatch.
    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
  });

  it("AC-269-03 already-running: Retry no-ops when the tab is already running", async () => {
    const user = userEvent.setup();
    seedConn1WithActiveDb("db1");
    mockExecuteQuery.mockRejectedValueOnce(
      new Error(
        "Database mismatch: expected 'db1', backend pool has 'db_actual'",
      ),
    );
    mockVerifyActiveDb.mockResolvedValueOnce("db_actual");

    const tab = makeQueryTab();
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    render(
      <>
        <QueryTab tab={tab} />
        <Toaster />
      </>,
    );

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    const retry = await screen.findByRole("button", { name: "Retry" });

    // Force the tab back to `running` so the closure's
    // `queryState.status !== "running"` guard fires.
    act(() => {
      useWorkspaceStore.setState((state) => {
        const conn = state.workspaces["conn1"];
        if (!conn) return state;
        const ws = conn["db1"];
        if (!ws) return state;
        return {
          workspaces: {
            ...state.workspaces,
            conn1: {
              ...conn,
              db1: {
                ...ws,
                tabs: ws.tabs.map((t) =>
                  t.id === "query-1" && t.type === "query"
                    ? {
                        ...t,
                        queryState: {
                          status: "running" as const,
                          queryId: "manual-running",
                        },
                      }
                    : t,
                ),
              },
            },
          },
        };
      });
    });

    await act(async () => {
      await user.click(retry);
    });

    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
  });

  it("Sprint 269: verifyActiveDb rejection keeps the catch silent — no Retry toast surfaces", async () => {
    seedConn1WithActiveDb("db1");
    mockExecuteQuery.mockRejectedValueOnce(
      new Error(
        "Database mismatch: expected 'db1', backend pool has 'db_actual'",
      ),
    );
    // Sprint 267 best-effort invariant: verify rejection ⇒ silent path.
    mockVerifyActiveDb.mockRejectedValueOnce(new Error("verify failed"));

    const tab = makeQueryTab();
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    render(
      <>
        <QueryTab tab={tab} />
        <Toaster />
      </>,
    );

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    await waitFor(() => {
      expect(mockVerifyActiveDb).toHaveBeenCalledWith("conn1");
    });
    // The query failed; the tab transitioned to error. No Retry button
    // surfaced because verifyActiveDb rejected.
    await waitFor(() => {
      const t = getTestWorkspace().tabs.find((x) => x.id === "query-1");
      if (t && t.type === "query") {
        expect(t.queryState.status).toBe("error");
      }
    });
    expect(
      screen.queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();
  });
});
