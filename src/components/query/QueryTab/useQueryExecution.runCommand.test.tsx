// Mongo db-contract α: runCommand IPC dispatch.
//
// Reason: db-contract α has to dispatch `db.runCommand({...})` /
// `db.adminCommand({...})` input to the generic `run_mongo_command` IPC.
// The mongosh AST parser is bound to a method whitelist and refuses
// admin commands, so this locks that the regex-based statement-kind
// judge routes exactly down the admin path. Once the AST promotes this
// branch, these cases keep their dispatch assertions locked as they
// are.

import { useConnectionStore } from "@stores/connectionStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getTestWorkspace,
  seedWorkspace,
} from "@/stores/__tests__/workspaceStoreTestHelpers";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { makeConn, makeDocTab } from "../__tests__/queryTabTestHelpers";
import { useQueryExecution } from "./useQueryExecution";

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
        dbType: "mongodb",
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

  // AC-381-06: with no chip selection (tab.database === undefined),
  // `db.runCommand({ping: 1})` → IPC call (database arg = null).
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
    expect(runMongoCommandMock).toHaveBeenCalledWith(
      "conn-mongo",
      null,
      {
        ping: 1,
      },
      false,
      expect.any(String),
    );
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

  // Issue #1561 — a cancelled admin runCommand must land on cancelled-state
  // (no red alert), not `error`. Backend returns "Operation cancelled".
  it("[#1561] cancelled db.runCommand routes to cancelled state, not error", async () => {
    runMongoCommandMock.mockRejectedValueOnce(new Error("Operation cancelled"));
    const tab = seedDocTab("db.runCommand({ping: 1})", {
      database: undefined,
      collection: undefined,
    });
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      const ws = getTestWorkspace("conn-mongo", "db1");
      const t = ws.tabs.find((x) => x.id === tab.id);
      expect(t && t.type === "query" ? t.queryState.status : null).toBe(
        "cancelled",
      );
    });
  });

  // AC-381-07: with chip = "myapp", `db.adminCommand({serverStatus: 1})`
  // → adminCommand always runs in the admin DB context, so the database
  // arg the backend receives must be `null` (the chip value is ignored).
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
    expect(runMongoCommandMock).toHaveBeenCalledWith(
      "conn-mongo",
      null,
      {
        serverStatus: 1,
      },
      false,
      expect.any(String),
    );
  });

  // AC-381-08: with chip = "myapp", `db.runCommand({dbStats: 1})`
  // → the database arg the backend receives = "myapp".
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
    expect(runMongoCommandMock).toHaveBeenCalledWith(
      "conn-mongo",
      "myapp",
      {
        dbStats: 1,
      },
      false,
      expect.any(String),
    );
  });

  // Destructive runCommand 5-keyword gate. Autocomplete
  // (`mongoAutocomplete.ts`) suggests `drop` / `dropDatabase` /
  // `dropIndexes` / `killOp` / `renameCollection` in one click, so the
  // dispatch has to pass `safeModeGate.decide`.
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
          dbType: "mongodb",
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

  it("[AC-473-S1] non-prod + warn + dropDatabase → confirm before backend ack", async () => {
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

    expect(runMongoCommandMock).not.toHaveBeenCalled();
    expect(result.current.pendingMongoConfirm).not.toBeNull();
    expect(result.current.pendingMongoConfirm!.reason).toMatch(/dropDatabase/);

    await act(async () => {
      await result.current.confirmMongoDangerous();
    });

    await waitFor(() => {
      expect(runMongoCommandMock).toHaveBeenCalledTimes(1);
    });
    expect(runMongoCommandMock).toHaveBeenCalledWith(
      "conn-mongo",
      "scratch",
      { dropDatabase: 1 },
      true,
      expect.any(String),
    );
  });

  it("[AC-473-S2] non-prod + warn + write-capable runCommand confirms before backend ack", async () => {
    useSafeModeStore.setState({ mode: "warn" });
    runMongoCommandMock.mockResolvedValueOnce({ ok: 1 });
    const tab = seedDocTab(
      'db.runCommand({delete:"users", deletes:[{q:{active:false}, limit:0}]})',
      {
        database: "scratch",
        collection: undefined,
      },
    );
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    expect(runMongoCommandMock).not.toHaveBeenCalled();
    expect(result.current.pendingMongoConfirm).not.toBeNull();

    await act(async () => {
      await result.current.confirmMongoDangerous();
    });

    await waitFor(() => {
      expect(runMongoCommandMock).toHaveBeenCalledTimes(1);
    });
    expect(runMongoCommandMock).toHaveBeenCalledWith(
      "conn-mongo",
      "scratch",
      {
        delete: "users",
        deletes: [{ q: { active: false }, limit: 0 }],
      },
      true,
      expect.any(String),
    );
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
