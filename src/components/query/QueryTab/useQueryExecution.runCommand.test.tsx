// Sprint 381 (2026-05-17) — Mongo db-contract α: runCommand IPC dispatch.
//
// 작성 이유: db-contract α 가 `db.runCommand({...})` / `db.adminCommand({...})`
// 입력을 generic `run_mongo_command` IPC 로 dispatch 해야 한다. Phase 28
// mongosh AST 파서는 method whitelist 에 묶여 있어 admin command 를
// 받아주지 않으므로, 본 sprint 의 정규식 기반 statement-kind judge 가
// 정확히 admin path 로 흐르는지를 lock. sprint-382 의 AST 가 본 분기를
// promote 한 뒤에도 이 케이스들은 dispatch 단언 부분이 그대로 lock 유지.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  seedWorkspace,
  getTestWorkspace,
} from "@/stores/__tests__/workspaceStoreTestHelpers";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useQueryExecution } from "./useQueryExecution";
import { makeDocTab, makeConn } from "../__tests__/queryTabTestHelpers";

const executeQueryMock = vi.fn();
const cancelQueryMock = vi.fn();
const findDocumentsMock = vi.fn();
const aggregateDocumentsMock = vi.fn();
const findOneDocumentMock = vi.fn();
const countDocumentsMock = vi.fn();
const estimatedDocumentCountMock = vi.fn();
const distinctDocumentsMock = vi.fn();
const insertDocumentMock = vi.fn();
const insertManyDocumentsMock = vi.fn();
const updateDocumentMock = vi.fn();
const updateManyMock = vi.fn();
const deleteDocumentMock = vi.fn();
const deleteManyMock = vi.fn();
const bulkWriteDocumentsMock = vi.fn();
const runMongoCommandMock = vi.fn();
beforeEach(() => {
  setupTauriMock({
    executeQuery: (...args: unknown[]) => executeQueryMock(...args),
    executeQueryDryRun: vi.fn(),
    cancelQuery: (...args: unknown[]) => cancelQueryMock(...args),
    findDocuments: (...args: unknown[]) => findDocumentsMock(...args),
    aggregateDocuments: (...args: unknown[]) => aggregateDocumentsMock(...args),
    findOneDocument: (...args: unknown[]) => findOneDocumentMock(...args),
    countDocuments: (...args: unknown[]) => countDocumentsMock(...args),
    estimatedDocumentCount: (...args: unknown[]) =>
      estimatedDocumentCountMock(...args),
    distinctDocuments: (...args: unknown[]) => distinctDocumentsMock(...args),
    insertDocument: (...args: unknown[]) => insertDocumentMock(...args),
    insertManyDocuments: (...args: unknown[]) =>
      insertManyDocumentsMock(...args),
    updateDocument: (...args: unknown[]) => updateDocumentMock(...args),
    updateMany: (...args: unknown[]) => updateManyMock(...args),
    deleteDocument: (...args: unknown[]) => deleteDocumentMock(...args),
    deleteMany: (...args: unknown[]) => deleteManyMock(...args),
    bulkWriteDocuments: (...args: unknown[]) => bulkWriteDocumentsMock(...args),
    runMongoCommand: (...args: unknown[]) => runMongoCommandMock(...args),
  });
});

vi.mock("@lib/api/verifyActiveDb", () => ({
  verifyActiveDb: vi.fn().mockResolvedValue(""),
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

function seedDocTab(
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

describe("useQueryExecution — sprint-381 runCommand dispatch", () => {
  beforeEach(() => {
    executeQueryMock.mockReset();
    cancelQueryMock.mockReset();
    findDocumentsMock.mockReset();
    aggregateDocumentsMock.mockReset();
    findOneDocumentMock.mockReset();
    countDocumentsMock.mockReset();
    estimatedDocumentCountMock.mockReset();
    distinctDocumentsMock.mockReset();
    insertDocumentMock.mockReset();
    insertManyDocumentsMock.mockReset();
    updateDocumentMock.mockReset();
    updateManyMock.mockReset();
    deleteDocumentMock.mockReset();
    deleteManyMock.mockReset();
    bulkWriteDocumentsMock.mockReset();
    runMongoCommandMock.mockReset();
    useWorkspaceStore.setState({ workspaces: {} });
    useConnectionStore.setState({ connections: [] });
    useQueryHistoryStore.setState({ recentVisible: [] });
    useSafeModeStore.setState({ mode: "warn" });
  });

  // AC-381-06: chip 미선택 (tab.database === undefined) 상태에서
  // `db.runCommand({ping: 1})` → IPC 호출 (database arg = null).
  it("[AC-381-06] db.runCommand({ping: 1}) without database binding → runMongoCommand(database=null)", async () => {
    runMongoCommandMock.mockResolvedValueOnce({ ok: 1 });
    const tab = seedDocTab("db.runCommand({ping: 1})", {
      database: undefined,
      collection: undefined,
    });
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(runMongoCommandMock).toHaveBeenCalledTimes(1);
    });
    expect(runMongoCommandMock).toHaveBeenCalledWith("conn-mongo", null, {
      ping: 1,
    });
    // Other dispatch paths must NOT fire.
    expect(findDocumentsMock).not.toHaveBeenCalled();
    expect(aggregateDocumentsMock).not.toHaveBeenCalled();

    // Query state should complete with the JSON response surfaced as a
    // single-cell grid result (the user always gets *some* visible
    // output even when admin commands don't fit the standard projection).
    await waitFor(() => {
      const ws = getTestWorkspace("conn-mongo", "db1");
      const t = ws.tabs.find((x) => x.id === tab.id);
      expect(t && t.type === "query" ? t.queryState.status : null).toBe(
        "completed",
      );
    });
  });

  // AC-381-07: chip = "myapp" 상태에서 `db.adminCommand({serverStatus: 1})`
  // → adminCommand 는 항상 admin DB context 라 backend 가 받는 database
  // arg 는 `null` 이어야 한다 (chip 값 무시).
  it("[AC-381-07] db.adminCommand always routes with database=null (admin context)", async () => {
    runMongoCommandMock.mockResolvedValueOnce({ ok: 1 });
    const tab = seedDocTab("db.adminCommand({serverStatus: 1})", {
      database: "myapp",
      collection: undefined,
    });
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(runMongoCommandMock).toHaveBeenCalledTimes(1);
    });
    expect(runMongoCommandMock).toHaveBeenCalledWith("conn-mongo", null, {
      serverStatus: 1,
    });
  });

  // AC-381-08: chip = "myapp" 상태에서 `db.runCommand({dbStats: 1})`
  // → backend 가 받는 database arg = "myapp".
  it("[AC-381-08] db.runCommand with chip='myapp' → runMongoCommand(database='myapp')", async () => {
    runMongoCommandMock.mockResolvedValueOnce({ ok: 1, db: "myapp" });
    const tab = seedDocTab("db.runCommand({dbStats: 1})", {
      database: "myapp",
      collection: undefined,
    });
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(runMongoCommandMock).toHaveBeenCalledTimes(1);
    });
    expect(runMongoCommandMock).toHaveBeenCalledWith("conn-mongo", "myapp", {
      dbStats: 1,
    });
  });

  // Sprint 381 hardening (2026-05-18) — destructive runCommand 5-keyword
  // gate. autocomplete (`mongoAutocomplete.ts`) 가 `drop` / `dropDatabase`
  // / `dropIndexes` / `killOp` / `renameCollection` 를 1-click 추천하므로
  // dispatch 가 `safeModeGate.decide` 를 통과해야 한다.
  it("[AC-381-S9] strict mode + non-prod + dropDatabase → confirm (IPC blocked, pendingMongoConfirm set)", async () => {
    useSafeModeStore.setState({ mode: "strict" });
    const tab = seedDocTab("db.runCommand({dropDatabase: 1})", {
      database: "doomed",
      collection: undefined,
    });
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    expect(runMongoCommandMock).not.toHaveBeenCalled();
    expect(result.current.pendingMongoConfirm).not.toBeNull();
    expect(result.current.pendingMongoConfirm!.reason).toMatch(/dropDatabase/);
  });

  it("[AC-381-S10] production + warn + drop → confirm (IPC blocked, pendingMongoConfirm set)", async () => {
    useSafeModeStore.setState({ mode: "warn" });
    const tab = seedDocTab('db.runCommand({drop: "users"})', {
      database: "myapp",
      collection: undefined,
    });
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
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    expect(runMongoCommandMock).not.toHaveBeenCalled();
    expect(result.current.pendingMongoConfirm).not.toBeNull();
    expect(result.current.pendingMongoConfirm!.reason).toMatch(/drop/);
  });

  it("[AC-381-S11] non-prod + warn + dropDatabase → passthrough (matrix-consistent allow path; dispatch still routes through decide)", async () => {
    useSafeModeStore.setState({ mode: "warn" });
    runMongoCommandMock.mockResolvedValueOnce({ ok: 1 });
    const tab = seedDocTab("db.runCommand({dropDatabase: 1})", {
      database: "scratch",
      collection: undefined,
    });
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(runMongoCommandMock).toHaveBeenCalledTimes(1);
    });
    expect(result.current.pendingMongoConfirm).toBeNull();
  });

  // Regression: `db.users.find({})` with empty chip → existing error
  // ("Select a target database…"). runMongoCommand MUST NOT fire.
  it("[AC-381-05 dispatcher] db.users.find({}) without chip → error path; runMongoCommand untouched", async () => {
    const tab = seedDocTab("db.users.find({})", {
      database: undefined,
      collection: undefined,
    });
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    expect(runMongoCommandMock).not.toHaveBeenCalled();
    expect(findDocumentsMock).not.toHaveBeenCalled();
    const ws = getTestWorkspace("conn-mongo", "db1");
    const t = ws.tabs.find((x) => x.id === tab.id);
    expect(t && t.type === "query" ? t.queryState.status : null).toBe("error");
  });
});
