import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  seedWorkspace,
  getTestWorkspace,
} from "@/stores/__tests__/workspaceStoreTestHelpers";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useHistorySettingsStore } from "@stores/historySettingsStore";
import { useToastStore } from "@stores/toastStore";
import { useSchemaStore } from "@stores/schemaStore";
import { useQueryExecution } from "./useQueryExecution";
import {
  makeQueryTab,
  makeDocTab,
  makeConn,
} from "../__tests__/queryTabTestHelpers";
import type { DocumentQueryResult } from "@/types/document";
import type { QueryResult } from "@/types/query";

const verifyActiveDbMock = vi.hoisted(() => vi.fn().mockResolvedValue(""));

vi.mock("@lib/api/verifyActiveDb", () => ({
  verifyActiveDb: verifyActiveDbMock,
}));

const executeQueryMock = vi.fn();
const executeQueryDryRunMock = vi.fn();
const cancelQueryMock = vi.fn();
const findDocumentsMock = vi.fn();

const SELECT_RESULT: QueryResult = {
  columns: [{ name: "id", dataType: "integer", category: "unknown" }],
  rows: [[1]],
  totalCount: 1,
  executionTimeMs: 3,
  queryType: "select",
};

const SECOND_SELECT_RESULT: QueryResult = {
  columns: [{ name: "two", dataType: "integer", category: "unknown" }],
  rows: [[2]],
  totalCount: 1,
  executionTimeMs: 4,
  queryType: "select",
};

const CALL_RESULT: QueryResult = {
  columns: [{ name: "echoed_id", dataType: "bigint", category: "int" }],
  rows: [[872]],
  totalCount: 1,
  executionTimeMs: 5,
  queryType: "select",
};

const DOC_RESULT: DocumentQueryResult = {
  columns: [{ name: "_id", dataType: "objectId", category: "unknown" }],
  rows: [["abc"]],
  rawDocuments: [{ _id: "abc", active: true }],
  totalCount: 1,
  executionTimeMs: 5,
};

function seedRdbTab(
  sql: string,
  overrides: Parameters<typeof makeQueryTab>[0] = {},
  connOverrides: Parameters<typeof makeConn>[0] = {},
) {
  const tab = makeQueryTab({ sql, ...overrides });
  useWorkspaceStore.setState(seedWorkspace([tab], tab.id));
  useConnectionStore.setState({
    connections: [
      makeConn({
        id: tab.connectionId,
        paradigm: "rdb",
        environment: "development",
        ...connOverrides,
      }),
    ],
  });
  return tab;
}

function seedMongoTab(
  sql: string,
  overrides: Parameters<typeof makeDocTab>[0] = {},
) {
  const tab = makeDocTab({ sql, ...overrides });
  useWorkspaceStore.setState(seedWorkspace([tab], tab.id));
  useConnectionStore.setState({
    connections: [
      makeConn({
        id: tab.connectionId,
        dbType: "mongodb",
        paradigm: "document",
        environment: "development",
      }),
    ],
  });
  return tab;
}

function getSeededRdbTab() {
  const tab = getTestWorkspace().tabs.find((t) => t.id === "query-1");
  if (!tab || tab.type !== "query") {
    throw new Error("query tab missing");
  }
  return tab;
}

function getSeededMongoTab() {
  const tab = getTestWorkspace("conn-mongo", "table_view_test").tabs.find(
    (t) => t.id === "query-1",
  );
  if (!tab || tab.type !== "query") {
    throw new Error("mongo query tab missing");
  }
  return tab;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useQueryExecution scaffold", () => {
  beforeEach(() => {
    executeQueryMock.mockReset();
    executeQueryDryRunMock.mockReset();
    cancelQueryMock.mockReset();
    findDocumentsMock.mockReset();
    verifyActiveDbMock.mockReset().mockResolvedValue("");
    setupTauriMock({
      executeQuery: (...args: unknown[]) => executeQueryMock(...args),
      executeQueryDryRun: (...args: unknown[]) =>
        executeQueryDryRunMock(...args),
      cancelQuery: (...args: unknown[]) => cancelQueryMock(...args),
      findDocuments: (...args: unknown[]) => findDocumentsMock(...args),
    });
    useWorkspaceStore.setState({ workspaces: {} });
    useConnectionStore.setState({
      connections: [],
      activeStatuses: {},
      focusedConnId: null,
    });
    useQueryHistoryStore.setState({ recentVisible: [] });
    useHistorySettingsStore.setState({ queryHistoryEnabled: false });
    useSafeModeStore.setState({ mode: "warn" });
    useToastStore.setState({ toasts: [] });
    useSchemaStore.setState({ fileAnalyticsSources: {} });
  });

  it("runs a single RDB SELECT and completes the tab", async () => {
    executeQueryMock.mockResolvedValueOnce(SELECT_RESULT);
    const tab = seedRdbTab("SELECT * FROM users");
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    expect(executeQueryMock).toHaveBeenCalledWith(
      "conn1",
      "SELECT * FROM users",
      expect.stringMatching(/^query-1-/),
      "db1",
      undefined,
    );
    await waitFor(() => {
      expect(getSeededRdbTab().queryState.status).toBe("completed");
    });
    const updated = getSeededRdbTab();
    expect(updated.queryState).toMatchObject({
      status: "completed",
      result: SELECT_RESULT,
    });
  });

  it("runs DuckDB registered file aliases through the normal query surface and records FILE history", async () => {
    executeQueryMock.mockResolvedValueOnce(SELECT_RESULT);
    const addOptimisticEntry = vi.fn().mockResolvedValue(undefined);
    useHistorySettingsStore.setState({ queryHistoryEnabled: true });
    useQueryHistoryStore.setState({ addOptimisticEntry });
    useSchemaStore.setState({
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
              { name: "id", dataType: "INTEGER" },
              { name: "name", dataType: "VARCHAR" },
            ],
            previewSql: 'SELECT * FROM "sales_csv" LIMIT 100',
          },
        ],
      },
    });
    const tab = seedRdbTab(
      'SELECT name FROM "sales_csv" WHERE id = 1',
      {},
      { dbType: "duckdb" },
    );
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    expect(executeQueryMock).toHaveBeenCalledWith(
      "conn1",
      'SELECT name FROM "sales_csv" WHERE id = 1',
      expect.stringMatching(/^query-1-/),
      "db1",
      undefined,
    );
    await waitFor(() => {
      expect(getSeededRdbTab().queryState.status).toBe("completed");
    });
    expect(getSeededRdbTab().queryState).toMatchObject({
      status: "completed",
      result: SELECT_RESULT,
    });
    expect(addOptimisticEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "file-analytics",
        collection: "sales.csv",
        sql: 'SELECT name FROM "sales_csv" WHERE id = 1',
        status: "success",
        paradigm: "rdb",
        queryMode: "sql",
      }),
    );
  });

  it("keeps normal DuckDB SELECT history as raw when no registered file alias is referenced", async () => {
    executeQueryMock.mockResolvedValueOnce(SELECT_RESULT);
    const addOptimisticEntry = vi.fn().mockResolvedValue(undefined);
    useHistorySettingsStore.setState({ queryHistoryEnabled: true });
    useQueryHistoryStore.setState({ addOptimisticEntry });
    useSchemaStore.setState({
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
            columns: [{ name: "id", dataType: "INTEGER" }],
            previewSql: 'SELECT * FROM "sales_csv" LIMIT 100',
          },
        ],
      },
    });
    const tab = seedRdbTab("SELECT 1 AS ok", {}, { dbType: "duckdb" });
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(getSeededRdbTab().queryState.status).toBe("completed");
    });
    expect(addOptimisticEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "raw",
        collection: undefined,
        sql: "SELECT 1 AS ok",
        status: "success",
      }),
    );
  });

  it("summarizes multi-source DuckDB file analytics history without leaving the normal result surface", async () => {
    executeQueryMock.mockResolvedValueOnce(SELECT_RESULT);
    const addOptimisticEntry = vi.fn().mockResolvedValue(undefined);
    useHistorySettingsStore.setState({ queryHistoryEnabled: true });
    useQueryHistoryStore.setState({ addOptimisticEntry });
    useSchemaStore.setState({
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
            columns: [{ name: "id", dataType: "INTEGER" }],
            previewSql: 'SELECT * FROM "sales_csv" LIMIT 100',
          },
          {
            source: {
              id: "source-2",
              alias: "returns_json",
              fileName: "returns.json",
              kind: "json",
              sizeBytes: 96,
            },
            columns: [{ name: "id", dataType: "INTEGER" }],
            previewSql: 'SELECT * FROM "returns_json" LIMIT 100',
          },
        ],
      },
    });
    const tab = seedRdbTab(
      'SELECT s.id FROM main."sales_csv" s JOIN "returns_json" r ON s.id = r.id',
      {},
      { dbType: "duckdb" },
    );
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(getSeededRdbTab().queryState.status).toBe("completed");
    });
    expect(getSeededRdbTab().queryState).toMatchObject({
      status: "completed",
      result: SELECT_RESULT,
    });
    expect(addOptimisticEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "file-analytics",
        collection: "2 file sources",
        status: "success",
      }),
    );
  });

  it.each([
    ["mysql", "CALL mysql_runtime_ping(872)"],
    ["mariadb", "CALL mariadb_runtime_ping(872)"],
  ] as const)(
    "keeps %s CALL behind WARN preview and dispatches after confirmation",
    async (dbType, sql) => {
      executeQueryMock.mockResolvedValueOnce(CALL_RESULT);
      const tab = seedRdbTab(sql, {}, { dbType });
      const { result } = renderHook(() => useQueryExecution({ tab }));

      await act(async () => {
        await result.current.handleExecute();
      });

      expect(result.current.pendingRdbWarn).toEqual({
        statements: [sql],
      });
      expect(executeQueryMock).not.toHaveBeenCalled();

      await act(async () => {
        await result.current.confirmRdbWarn();
      });

      expect(executeQueryMock).toHaveBeenCalledWith(
        "conn1",
        sql,
        expect.stringMatching(/^query-1-/),
        "db1",
        undefined,
      );
      await waitFor(() => {
        expect(getSeededRdbTab().queryState.status).toBe("completed");
      });
      const updated = getSeededRdbTab();
      expect(updated.queryState).toMatchObject({
        status: "completed",
        result: CALL_RESULT,
      });
    },
  );

  it("rejects broad MySQL CALL argument expressions before IPC", async () => {
    executeQueryMock.mockResolvedValue(CALL_RESULT);
    const tab = seedRdbTab(
      "CALL refresh_user_stats(NOW())",
      {},
      {
        dbType: "mysql",
      },
    );
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    expect(executeQueryMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(getSeededRdbTab().queryState.status).toBe("error");
    });
    const state = getSeededRdbTab().queryState;
    if (state.status !== "error") {
      throw new Error(`Expected error state, got ${state.status}`);
    }
    expect(state.error).toContain("CALL support is limited");
  });

  it("rejects MySQL DELIMITER scripts before any SQL reaches IPC", async () => {
    executeQueryMock.mockResolvedValue(SELECT_RESULT);
    const tab = seedRdbTab(
      [
        "DELIMITER //",
        "CREATE PROCEDURE refresh_users()",
        "BEGIN",
        "  UPDATE users SET touched = 1;",
        "END //",
        "DELIMITER ;",
      ].join("\n"),
      {},
      { dbType: "mysql" },
    );
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    expect(executeQueryMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(getSeededRdbTab().queryState.status).toBe("error");
    });
    const state = getSeededRdbTab().queryState;
    if (state.status !== "error") {
      throw new Error(`Expected error state, got ${state.status}`);
    }
    expect(state.error).toContain("DELIMITER");
  });

  it("rejects MySQL LOAD DATA inside a multi-statement batch before IPC", async () => {
    executeQueryMock.mockResolvedValue(SELECT_RESULT);
    const tab = seedRdbTab(
      [
        "SELECT 1",
        "LOAD DATA INFILE '/tmp/users.csv' INTO TABLE users",
        "SELECT 2",
      ].join(";\n"),
      {},
      { dbType: "mysql" },
    );
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    expect(executeQueryMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(getSeededRdbTab().queryState.status).toBe("error");
    });
    const state = getSeededRdbTab().queryState;
    if (state.status !== "error") {
      throw new Error(`Expected error state, got ${state.status}`);
    }
    expect(state.error).toContain("LOAD DATA");
  });

  it("rejects standalone MySQL executable comment batches before IPC", async () => {
    executeQueryMock.mockResolvedValue(SELECT_RESULT);
    const tab = seedRdbTab(
      [
        "/*!40101 LOAD DATA INFILE '/tmp/users.csv' INTO TABLE users */",
        "SELECT 1",
      ].join(";\n"),
      {},
      { dbType: "mysql" },
    );
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    expect(executeQueryMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(getSeededRdbTab().queryState.status).toBe("error");
    });
    const state = getSeededRdbTab().queryState;
    if (state.status !== "error") {
      throw new Error(`Expected error state, got ${state.status}`);
    }
    expect(state.error).toContain("LOAD DATA");
  });

  it("rejects MySQL LOAD DATA dry-runs before any SQL reaches IPC", async () => {
    executeQueryDryRunMock.mockResolvedValue([SELECT_RESULT]);
    const tab = seedRdbTab(
      "LOAD DATA INFILE '/tmp/users.csv' INTO TABLE users",
      {},
      { dbType: "mysql" },
    );
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleDryRun();
    });

    expect(executeQueryDryRunMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(getSeededRdbTab().queryState.status).toBe("error");
    });
    const state = getSeededRdbTab().queryState;
    if (state.status !== "error") {
      throw new Error(`Expected error state, got ${state.status}`);
    }
    expect(state.error).toContain("LOAD DATA");
  });

  it("rejects MySQL stored routine bodies without DELIMITER before IPC", async () => {
    executeQueryMock.mockResolvedValue(SELECT_RESULT);
    const tab = seedRdbTab(
      "CREATE PROCEDURE refresh_users() BEGIN UPDATE users SET touched = 1",
      {},
      { dbType: "mysql" },
    );
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    expect(executeQueryMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(getSeededRdbTab().queryState.status).toBe("error");
    });
    const state = getSeededRdbTab().queryState;
    if (state.status !== "error") {
      throw new Error(`Expected error state, got ${state.status}`);
    }
    expect(state.error).toContain("stored routine");
  });

  it("rejects standalone MySQL executable comment dry-runs before IPC", async () => {
    executeQueryDryRunMock.mockResolvedValue([SELECT_RESULT]);
    const tab = seedRdbTab(
      [
        "/*!40101 LOAD DATA INFILE '/tmp/users.csv' INTO TABLE users */",
        "SELECT 1",
      ].join(";\n"),
      {},
      { dbType: "mysql" },
    );
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleDryRun();
    });

    expect(executeQueryDryRunMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(getSeededRdbTab().queryState.status).toBe("error");
    });
    const state = getSeededRdbTab().queryState;
    if (state.status !== "error") {
      throw new Error(`Expected error state, got ${state.status}`);
    }
    expect(state.error).toContain("LOAD DATA");
  });

  it("routes destructive RDB SQL to the Safe Mode confirm branch", async () => {
    const tab = seedRdbTab(
      "DROP TABLE users",
      {},
      { environment: "production" },
    );
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    expect(result.current.pendingRdbConfirm).toEqual({
      statements: ["DROP TABLE users"],
      reason: "DROP TABLE",
    });
    expect(result.current.pendingRdbWarn).toBeNull();
    expect(executeQueryMock).not.toHaveBeenCalled();
    expect(getSeededRdbTab().queryState.status).toBe("idle");
  });

  it("runs MongoDB find through the document IPC path", async () => {
    findDocumentsMock.mockResolvedValueOnce(DOC_RESULT);
    const tab = seedMongoTab(
      "db.users.find({active:true}).sort({name:1}).limit(5)",
    );
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    expect(findDocumentsMock).toHaveBeenCalledWith(
      "conn-mongo",
      "table_view_test",
      "users",
      { filter: { active: true }, sort: { name: 1 }, limit: 5 },
      expect.any(String),
    );
    await waitFor(() => {
      expect(getSeededMongoTab().queryState.status).toBe("completed");
    });
    const updated = getSeededMongoTab();
    expect(updated.queryState).toMatchObject({
      status: "completed",
      result: {
        columns: DOC_RESULT.columns,
        rows: DOC_RESULT.rows,
        totalCount: DOC_RESULT.totalCount,
        executionTimeMs: DOC_RESULT.executionTimeMs,
        queryType: "select",
      },
    });
  });

  it("runs multi-statement RDB SQL and stores per-statement results", async () => {
    executeQueryMock
      .mockResolvedValueOnce(SELECT_RESULT)
      .mockResolvedValueOnce(SECOND_SELECT_RESULT);
    const tab = seedRdbTab("SELECT 1; SELECT 2");
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(getSeededRdbTab().queryState.status).toBe("completed");
    });
    const runningQueryId = executeQueryMock.mock.calls[0]?.[2];
    expect(runningQueryId).toEqual(expect.stringMatching(/^query-1-.*$/));
    expect(executeQueryMock).toHaveBeenNthCalledWith(
      1,
      "conn1",
      "SELECT 1",
      runningQueryId,
      "db1",
      undefined,
    );
    expect(executeQueryMock).toHaveBeenNthCalledWith(
      2,
      "conn1",
      "SELECT 2",
      runningQueryId,
      "db1",
      undefined,
    );
    const updated = getSeededRdbTab();
    if (updated.queryState.status !== "completed") {
      throw new Error("query did not complete");
    }
    expect(updated.queryState.result).toEqual(SECOND_SELECT_RESULT);
    expect(updated.queryState.statements).toMatchObject([
      { sql: "SELECT 1", status: "success", result: SELECT_RESULT },
      { sql: "SELECT 2", status: "success", result: SECOND_SELECT_RESULT },
    ]);
  });

  it("cancels a mid-execution query instead of dispatching new IPC", async () => {
    const pending = deferred<QueryResult>();
    executeQueryMock.mockReturnValueOnce(pending.promise);
    cancelQueryMock.mockResolvedValueOnce(undefined);
    const tab = seedRdbTab("SELECT pg_sleep(10)");
    const { result, rerender } = renderHook(
      ({ currentTab }) => useQueryExecution({ tab: currentTab }),
      { initialProps: { currentTab: tab } },
    );

    let executePromise!: Promise<void>;
    act(() => {
      executePromise = result.current.handleExecute();
    });

    await waitFor(() => {
      expect(getSeededRdbTab().queryState.status).toBe("running");
    });
    const runningTab = getSeededRdbTab();
    if (runningTab.queryState.status !== "running") {
      throw new Error("query did not enter running state");
    }
    rerender({ currentTab: runningTab });

    await act(async () => {
      await result.current.handleExecute();
    });

    expect(cancelQueryMock).toHaveBeenCalledWith(runningTab.queryState.queryId);
    expect(executeQueryMock).toHaveBeenCalledTimes(1);
    expect(getSeededRdbTab().queryState.status).toBe("running");

    await act(async () => {
      pending.resolve(SELECT_RESULT);
      await executePromise;
    });
  });

  // Issue #1269 (gap #5) — DuckDB's `execute_query` now interrupts a running
  // statement, so `query.cancel` is true and handleExecute on a running tab
  // cancels through the cooperative token (not native — no server pid).
  it("cancels a running DuckDB query via cooperative token (#1269)", async () => {
    const tab = seedRdbTab(
      "SELECT 1",
      { queryState: { status: "running", queryId: "query-1-1234" } },
      { dbType: "duckdb" },
    );
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    expect(cancelQueryMock).toHaveBeenCalledWith("query-1-1234");
  });

  it("syncs activeDb and surfaces a retry toast on DbMismatch", async () => {
    executeQueryMock.mockRejectedValueOnce(
      new Error("Database mismatch: expected 'db1', but found 'db_actual'"),
    );
    verifyActiveDbMock.mockResolvedValueOnce("db_actual");
    const tab = seedRdbTab("SELECT * FROM users");
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(getSeededRdbTab().queryState.status).toBe("error");
    });
    await waitFor(() => {
      expect(verifyActiveDbMock).toHaveBeenCalledWith("conn1");
    });
    const status = useConnectionStore.getState().activeStatuses.conn1;
    expect(status).toMatchObject({ type: "connected", activeDb: "db_actual" });
    expect(
      useToastStore
        .getState()
        .toasts.some((toast) => toast.action?.label === "Retry"),
    ).toBe(true);
  });
});
