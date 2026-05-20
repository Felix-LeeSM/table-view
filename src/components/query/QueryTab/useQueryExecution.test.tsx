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
import { useToastStore } from "@lib/toast";
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

vi.mock("@lib/sql/sqlUtils", () => ({
  splitSqlStatements: (sql: string) =>
    sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean),
  formatSql: (sql: string) => sql.toUpperCase(),
  uglifySql: (sql: string) => sql.replace(/\s+/g, " ").trim(),
}));

const executeQueryMock = vi.fn();
const executeQueryDryRunMock = vi.fn();
const cancelQueryMock = vi.fn();
const findDocumentsMock = vi.fn();

const SELECT_RESULT: QueryResult = {
  columns: [{ name: "id", data_type: "integer", category: "unknown" }],
  rows: [[1]],
  total_count: 1,
  execution_time_ms: 3,
  query_type: "select",
};

const SECOND_SELECT_RESULT: QueryResult = {
  columns: [{ name: "two", data_type: "integer", category: "unknown" }],
  rows: [[2]],
  total_count: 1,
  execution_time_ms: 4,
  query_type: "select",
};

const DOC_RESULT: DocumentQueryResult = {
  columns: [{ name: "_id", data_type: "objectId", category: "unknown" }],
  rows: [["abc"]],
  raw_documents: [{ _id: "abc", active: true }],
  total_count: 1,
  execution_time_ms: 5,
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
        db_type: "mongodb",
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
    );
    await waitFor(() => {
      expect(getSeededMongoTab().queryState.status).toBe("completed");
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
    expect(executeQueryMock).toHaveBeenNthCalledWith(
      1,
      "conn1",
      "SELECT 1",
      expect.stringMatching(/^query-1-.*-0$/),
      "db1",
    );
    expect(executeQueryMock).toHaveBeenNthCalledWith(
      2,
      "conn1",
      "SELECT 2",
      expect.stringMatching(/^query-1-.*-1$/),
      "db1",
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

  it("syncs activeDb and surfaces a retry toast on DbMismatch", async () => {
    executeQueryMock.mockRejectedValueOnce(
      new Error(
        "Database mismatch: expected 'db1', backend pool has 'db_actual'",
      ),
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
