import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  getTestWorkspace,
  seedWorkspace,
} from "@/stores/__tests__/workspaceStoreTestHelpers";
import { useConnectionStore } from "@stores/connectionStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { useQueryExecution } from "./useQueryExecution";
import { makeConn, makeQueryTab } from "../__tests__/queryTabTestHelpers";
import type { QueryResult } from "@/types/query";

const executeKvCommandMock = vi.fn();
const cancelQueryMock = vi.fn();

beforeEach(() => {
  setupTauriMock({
    executeKvCommand: (...args: unknown[]) => executeKvCommandMock(...args),
    cancelQuery: (...args: unknown[]) => cancelQueryMock(...args),
  });
});

vi.mock("@lib/sql/sqlUtils", () => ({
  splitSqlStatements: (sql: string) =>
    sql
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean),
  formatSql: (sql: string) => sql.toUpperCase(),
  uglifySql: (sql: string) => sql.replace(/\s+/g, " ").trim(),
}));

const REDIS_RESULT: QueryResult = {
  columns: [{ name: "value", dataType: "text", category: "text" }],
  rows: [["Ada"]],
  totalCount: 1,
  executionTimeMs: 2,
  queryType: "select",
};

function seedRedisTab(sql: string, database = "2") {
  const tab = makeQueryTab({
    id: "query-redis",
    connectionId: "conn-redis",
    paradigm: "kv",
    queryLanguage: "redis-command",
    sql,
    database,
  });
  useWorkspaceStore.setState(
    seedWorkspace([tab], tab.id, "conn-redis", database),
  );
  useConnectionStore.setState({
    connections: [
      makeConn({
        id: "conn-redis",
        dbType: "redis",
        paradigm: "kv",
        database,
      }),
    ],
  });
  return tab;
}

function seedValkeyTab(sql: string, database = "2") {
  const tab = makeQueryTab({
    id: "query-valkey",
    connectionId: "conn-valkey",
    paradigm: "kv",
    queryLanguage: "redis-command",
    sql,
    database,
  });
  useWorkspaceStore.setState(
    seedWorkspace([tab], tab.id, "conn-valkey", database),
  );
  useConnectionStore.setState({
    connections: [
      makeConn({
        id: "conn-valkey",
        dbType: "valkey",
        paradigm: "kv",
        database,
      }),
    ],
  });
  return tab;
}

describe("useQueryExecution — Redis command dispatch", () => {
  beforeEach(() => {
    executeKvCommandMock.mockReset();
    cancelQueryMock.mockReset();
    useWorkspaceStore.setState({ workspaces: {} });
    useConnectionStore.setState({ connections: [] });
  });

  it("runs bounded Redis commands through the KV IPC wrapper", async () => {
    executeKvCommandMock.mockResolvedValueOnce(REDIS_RESULT);
    const tab = seedRedisTab("GET profile:1", "2");
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(executeKvCommandMock).toHaveBeenCalledTimes(1);
    });
    expect(executeKvCommandMock).toHaveBeenCalledWith(
      "conn-redis",
      { command: "GET profile:1", database: 2 },
      expect.stringMatching(/^query-redis-/),
    );
    const updated = getTestWorkspace("conn-redis", "2").tabs[0];
    if (!updated || updated.type !== "query") {
      throw new Error("Expected Redis query tab to stay active");
    }
    expect(updated.queryState).toEqual({
      status: "completed",
      result: REDIS_RESULT,
    });
  });

  it("rejects invalid Redis database chips before IPC dispatch", async () => {
    const tab = seedRedisTab("GET profile:1", "not-a-db");
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    expect(executeKvCommandMock).not.toHaveBeenCalled();
    const updated = getTestWorkspace("conn-redis", "not-a-db").tabs[0];
    if (!updated || updated.type !== "query") {
      throw new Error("Expected Redis query tab to stay active");
    }
    expect(updated.queryState).toEqual({
      status: "error",
      error: "Redis database must be an integer between 0 and 65535.",
    });
  });

  it("runs bounded Valkey commands through the KV IPC wrapper", async () => {
    executeKvCommandMock.mockResolvedValueOnce(REDIS_RESULT);
    const tab = seedValkeyTab("GET profile:1", "2");
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(executeKvCommandMock).toHaveBeenCalledTimes(1);
    });
    expect(executeKvCommandMock).toHaveBeenCalledWith(
      "conn-valkey",
      { command: "GET profile:1", database: 2 },
      expect.stringMatching(/^query-valkey-/),
    );
    const updated = getTestWorkspace("conn-valkey", "2").tabs[0];
    if (!updated || updated.type !== "query") {
      throw new Error("Expected Valkey query tab to stay active");
    }
    expect(updated.queryState).toEqual({
      status: "completed",
      result: REDIS_RESULT,
    });
  });
});
