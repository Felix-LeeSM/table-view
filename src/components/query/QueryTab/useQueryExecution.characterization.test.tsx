/**
 * Issue #737 characterization matrix for `useQueryExecution`.
 *
 * | Branch covered | User-visible behavior frozen | Test owner |
 * |---|---|---|
 * | RDB Safe Mode / history / result state | WARN-tier UPDATE waits for review; confirm executes, completes the tab, and records SQL history. Partial multi-statement failure keeps visible rows from the last success while marking history as error. | #761 |
 * | Mongo dispatch / history | Parser-routed `find` failures set the tab error and record document history with the parsed query mode. | #762 |
 * | KV dispatch | Redis command execution uses the KV IPC wrapper, completes the tab, and skips query history because KV history wire support is absent. | #763 |
 * | Search dispatch | Search DSL JSON dispatches to the Search IPC wrapper, stores `completedSearch`, and skips query history because Search history wire support is absent. | #763 |
 *
 * #743/#744 no-impact: this file touches no profile registry, capability, Tauri
 * error-envelope, or backend error serialization code.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  getTestWorkspace,
  seedWorkspace,
} from "@/stores/__tests__/workspaceStoreTestHelpers";
import { useConnectionStore } from "@stores/connectionStore";
import { useHistorySettingsStore } from "@stores/historySettingsStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useToastStore } from "@stores/toastStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { useQueryExecution } from "./useQueryExecution";
import {
  makeConn,
  makeDocTab,
  makeQueryTab,
} from "../__tests__/queryTabTestHelpers";
import type { QueryResult } from "@/types/query";
import type { SearchResultEnvelope } from "@/types/search";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => true,
}));

const verifyActiveDbMock = vi.hoisted(() => vi.fn().mockResolvedValue(""));

vi.mock("@lib/api/verifyActiveDb", () => ({
  verifyActiveDb: verifyActiveDbMock,
}));

vi.mock("@lib/sql/sqlUtils", () => ({
  splitSqlStatements: (sql: string) => {
    const parts = sql
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean);
    return parts.length > 0 ? parts : [];
  },
  formatSql: (sql: string) => sql.toUpperCase(),
  uglifySql: (sql: string) => sql.replace(/\s+/g, " ").trim(),
}));

const executeQueryMock = vi.fn();
const executeQueryDryRunMock = vi.fn();
const cancelQueryMock = vi.fn();
const findDocumentsMock = vi.fn();
const executeKvCommandMock = vi.fn();
const executeSearchQueryMock = vi.fn();

const SELECT_RESULT: QueryResult = {
  columns: [{ name: "id", dataType: "integer", category: "unknown" }],
  rows: [[1]],
  totalCount: 1,
  executionTimeMs: 3,
  queryType: "select",
};

const UPDATE_RESULT: QueryResult = {
  columns: [],
  rows: [],
  totalCount: 0,
  executionTimeMs: 5,
  queryType: { dml: { rows_affected: 1 } },
};

const SEARCH_RESULT: SearchResultEnvelope = {
  tookMs: 6,
  timedOut: false,
  total: { value: 2, relation: "eq" },
  hits: [
    {
      index: "logs-2026.06.10",
      id: "doc-1",
      score: 1,
      source: { message: "ok" },
      sort: [],
    },
  ],
  aggregations: [
    {
      kind: "terms",
      name: "by_status",
      buckets: [{ key: "ok", docCount: 2 }],
    },
  ],
};

function seedRdbTab(
  sql: string,
  connection: Parameters<typeof makeConn>[0] = {},
) {
  const tab = makeQueryTab({ sql });
  useWorkspaceStore.setState(seedWorkspace([tab], tab.id));
  useConnectionStore.setState({
    connections: [
      makeConn({
        id: tab.connectionId,
        dbType: "postgresql",
        paradigm: "rdb",
        environment: "development",
        ...connection,
      }),
    ],
  });
  return tab;
}

function seedMongoTab(sql: string) {
  const tab = makeDocTab({ sql });
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

function seedRedisTab(sql: string) {
  const tab = makeQueryTab({
    id: "query-redis",
    connectionId: "conn-redis",
    paradigm: "kv",
    queryLanguage: "redis-command",
    sql,
    database: "2",
  });
  useWorkspaceStore.setState(seedWorkspace([tab], tab.id, "conn-redis", "2"));
  useConnectionStore.setState({
    connections: [
      makeConn({
        id: "conn-redis",
        dbType: "redis",
        paradigm: "kv",
        database: "2",
        environment: "development",
      }),
    ],
  });
  return tab;
}

function seedSearchTab(sql: string) {
  const tab = makeQueryTab({
    id: "query-search",
    connectionId: "conn-search",
    paradigm: "search",
    queryLanguage: "search-dsl",
    sql,
    database: "db1",
  });
  useWorkspaceStore.setState(
    seedWorkspace([tab], tab.id, "conn-search", "db1"),
  );
  useConnectionStore.setState({
    connections: [
      makeConn({
        id: "conn-search",
        dbType: "elasticsearch",
        paradigm: "search",
        database: "db1",
        environment: "development",
      }),
    ],
  });
  return tab;
}

function getQueryTab(connId = "conn1", db = "db1", tabId = "query-1") {
  const tab = getTestWorkspace(connId, db).tabs.find(
    (item) => item.id === tabId,
  );
  if (!tab || tab.type !== "query") {
    throw new Error(`Missing query tab: ${connId}/${db}/${tabId}`);
  }
  return tab;
}

async function waitForHistoryRows(count: number) {
  await waitFor(() => {
    expect(useQueryHistoryStore.getState().recentVisible).toHaveLength(count);
  });
  return useQueryHistoryStore.getState().recentVisible;
}

describe("useQueryExecution — issue #737 characterization matrix", () => {
  beforeEach(() => {
    setupTauriMock({
      executeQuery: (...args: unknown[]) => executeQueryMock(...args),
      executeQueryDryRun: (...args: unknown[]) =>
        executeQueryDryRunMock(...args),
      cancelQuery: (...args: unknown[]) => cancelQueryMock(...args),
      findDocuments: (...args: unknown[]) => findDocumentsMock(...args),
      executeKvCommand: (...args: unknown[]) => executeKvCommandMock(...args),
      executeSearchQuery: (...args: unknown[]) =>
        executeSearchQueryMock(...args),
    });
    invokeMock.mockReset();
    invokeMock.mockImplementation((command: string, args: unknown) => {
      if (command !== "add_history_entry") {
        throw new Error(`unexpected invoke: ${command}`);
      }
      const req =
        typeof args === "object" && args !== null && "req" in args
          ? (args as { req: { sql: string; executedAt: number } }).req
          : null;
      if (!req) throw new Error("missing history req");
      return Promise.resolve({
        id: 1001,
        executedAt: req.executedAt,
        sqlRedacted: req.sql,
      });
    });
    executeQueryMock.mockReset();
    executeQueryDryRunMock.mockReset();
    cancelQueryMock.mockReset();
    findDocumentsMock.mockReset();
    executeKvCommandMock.mockReset();
    executeSearchQueryMock.mockReset();
    verifyActiveDbMock.mockReset().mockResolvedValue("");
    useWorkspaceStore.setState({ workspaces: {} });
    useConnectionStore.setState({
      connections: [],
      activeStatuses: {},
      focusedConnId: null,
    });
    useHistorySettingsStore.setState({ queryHistoryEnabled: true });
    useQueryHistoryStore.setState({ recentVisible: [] });
    useSafeModeStore.setState({ mode: "warn" });
    useToastStore.setState({ toasts: [] });
  });

  it("RDB WARN waits for review, then confirm completes result and records success history", async () => {
    executeQueryDryRunMock.mockResolvedValueOnce([UPDATE_RESULT]);
    executeQueryMock.mockResolvedValueOnce(UPDATE_RESULT);
    useSafeModeStore.setState({ mode: "strict" });
    const sql = "UPDATE users SET name = 'Ada' WHERE id = 1";
    const tab = seedRdbTab(sql, { environment: "production" });
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    expect(result.current.pendingRdbWarn).toEqual({ statements: [sql] });
    expect(result.current.pendingRdbConfirm).toBeNull();
    expect(executeQueryMock).not.toHaveBeenCalled();
    expect(useQueryHistoryStore.getState().recentVisible).toHaveLength(0);
    expect(getQueryTab().queryState.status).toBe("idle");

    await act(async () => {
      await result.current.confirmRdbWarn();
    });

    await waitFor(() => {
      expect(getQueryTab().queryState.status).toBe("completed");
    });
    expect(executeQueryMock).toHaveBeenCalledWith(
      "conn1",
      sql,
      expect.stringMatching(/^query-1-/),
      "db1",
      undefined,
    );
    const completed = getQueryTab();
    if (completed.queryState.status !== "completed") {
      throw new Error(`expected completed, got ${completed.queryState.status}`);
    }
    expect(completed.queryState.result).toEqual(UPDATE_RESULT);
    const [history] = await waitForHistoryRows(1);
    expect(history).toMatchObject({
      paradigm: "rdb",
      queryMode: "sql",
      sqlRedacted: sql,
      status: "success",
      source: "raw",
    });
  });

  it("RDB partial multi-statement failure keeps completed rows but records error history", async () => {
    executeQueryMock
      .mockResolvedValueOnce(SELECT_RESULT)
      .mockRejectedValueOnce(new Error("syntax error at BAD"));
    const sql = "SELECT 1; BAD 2";
    const tab = seedRdbTab(sql);
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(getQueryTab().queryState.status).toBe("completed");
    });
    const completed = getQueryTab();
    if (completed.queryState.status !== "completed") {
      throw new Error(`expected completed, got ${completed.queryState.status}`);
    }
    expect(completed.queryState.result).toEqual(SELECT_RESULT);
    expect(completed.queryState.statements).toMatchObject([
      { sql: "SELECT 1", status: "success", result: SELECT_RESULT },
      { sql: "BAD 2", status: "error", error: "syntax error at BAD" },
    ]);
    const [history] = await waitForHistoryRows(1);
    expect(history).toMatchObject({
      paradigm: "rdb",
      queryMode: "sql",
      sqlRedacted: sql,
      status: "error",
    });
  });

  it("Mongo find IPC failure sets tab error and records parsed-mode error history", async () => {
    findDocumentsMock.mockRejectedValueOnce(
      new Error("collection unavailable"),
    );
    const sql = "db.users.find({active:true})";
    const tab = seedMongoTab(sql);
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(
        getQueryTab("conn-mongo", "table_view_test").queryState.status,
      ).toBe("error");
    });
    const errored = getQueryTab("conn-mongo", "table_view_test");
    if (errored.queryState.status !== "error") {
      throw new Error(`expected error, got ${errored.queryState.status}`);
    }
    expect(errored.queryState.error).toBe("collection unavailable");
    expect(findDocumentsMock).toHaveBeenCalledWith(
      "conn-mongo",
      "table_view_test",
      "users",
      { filter: { active: true } },
    );
    const [history] = await waitForHistoryRows(1);
    expect(history).toMatchObject({
      paradigm: "document",
      queryMode: "find",
      database: "table_view_test",
      collection: "users",
      sqlRedacted: sql,
      status: "error",
    });
  });

  it("KV Redis dispatch completes the tab and skips query history", async () => {
    executeKvCommandMock.mockResolvedValueOnce(SELECT_RESULT);
    const tab = seedRedisTab("GET profile:1");
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(
        getQueryTab("conn-redis", "2", "query-redis").queryState.status,
      ).toBe("completed");
    });
    expect(executeKvCommandMock).toHaveBeenCalledWith(
      "conn-redis",
      { command: "GET profile:1", database: 2 },
      expect.stringMatching(/^query-redis-/),
    );
    const completed = getQueryTab("conn-redis", "2", "query-redis");
    if (completed.queryState.status !== "completed") {
      throw new Error(`expected completed, got ${completed.queryState.status}`);
    }
    expect(completed.queryState.result).toEqual(SELECT_RESULT);
    expect(useQueryHistoryStore.getState().recentVisible).toHaveLength(0);
  });

  it("Search DSL dispatch completes with a Search result and skips query history", async () => {
    executeSearchQueryMock.mockResolvedValueOnce(SEARCH_RESULT);
    const sql = JSON.stringify({
      index: "logs-2026.06.10",
      body: { query: { match_all: {} } },
      from: 5,
      size: 10,
      trackTotalHits: true,
    });
    const tab = seedSearchTab(sql);
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(
        getQueryTab("conn-search", "db1", "query-search").queryState.status,
      ).toBe("completedSearch");
    });
    expect(executeSearchQueryMock).toHaveBeenCalledWith(
      "conn-search",
      {
        index: "logs-2026.06.10",
        body: { query: { match_all: {} } },
        from: 5,
        size: 10,
        trackTotalHits: true,
      },
      expect.stringMatching(/^query-search-/),
    );
    const completed = getQueryTab("conn-search", "db1", "query-search");
    if (completed.queryState.status !== "completedSearch") {
      throw new Error(
        `expected completedSearch, got ${completed.queryState.status}`,
      );
    }
    expect(completed.queryState.result).toEqual(SEARCH_RESULT);
    expect(useQueryHistoryStore.getState().recentVisible).toHaveLength(0);
  });
});
