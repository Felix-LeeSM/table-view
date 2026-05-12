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
import {
  seedWorkspace,
  getTestWorkspace,
} from "@/stores/__tests__/workspaceStoreTestHelpers";
import { render, screen, waitFor, act } from "@testing-library/react";
import QueryTab from "./QueryTab";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { useConnectionStore } from "@stores/connectionStore";
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

vi.mock("@lib/tauri", () => ({
  executeQuery: (...args: unknown[]) => mockExecuteQuery(...args),
  cancelQuery: (...args: unknown[]) => mockCancelQuery(...args),
  findDocuments: (...args: unknown[]) => mockFindDocuments(...args),
  aggregateDocuments: (...args: unknown[]) => mockAggregateDocuments(...args),
}));

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
        db_type: "postgresql",
        host: "h",
        port: 5432,
        user: "u",
        database: "db1",
        group_id: null,
        color: null,
        has_password: false,
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
  });
});
