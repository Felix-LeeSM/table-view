// Sprint 312 (Phase 28 Slice A6, 2026-05-14) — RTL coverage of the 7
// write-method dispatch table. Each test mocks the relevant
// `@lib/tauri/document` wrapper and asserts:
//   - the IPC was called with the parser-extracted payload,
//   - the resulting QueryResult carries `resultKind: "writeSummary"` +
//     a populated `writeSummary` shape,
//   - history records the parsed method name (D-13) as `queryMode`.
//
// Tests are written before / alongside the implementation in vertical
// slices — one write method per `describe`. D-16 (autonomous):
// Sprint 475 tightens single-document writes: `updateOne` / `deleteOne` /
// `replaceOne` require `_id`-only filters for deterministic identity.

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
import type { BulkWriteResult } from "@/types/documentMutate";
import { makeConn, makeDocTab } from "../__tests__/queryTabTestHelpers";
import { useQueryExecution } from "./useQueryExecution";

const insertDocumentMock = vi.fn();
const insertManyDocumentsMock = vi.fn();
const updateDocumentMock = vi.fn();
const updateManyMock = vi.fn();
const deleteDocumentMock = vi.fn();
const deleteManyMock = vi.fn();
const bulkWriteDocumentsMock = vi.fn();
const createMongoIndexMock = vi.fn();
const dropMongoIndexMock = vi.fn();
beforeEach(() => {
  setupTauriMock({
    executeQuery: vi.fn(),
    executeQueryDryRun: vi.fn(),
    cancelQuery: vi.fn(),
    findDocuments: vi.fn(),
    aggregateDocuments: vi.fn(),
    findOneDocument: vi.fn(),
    countDocuments: vi.fn(),
    estimatedDocumentCount: vi.fn(),
    distinctDocuments: vi.fn(),
    insertDocument: (...args: unknown[]) => insertDocumentMock(...args),
    insertManyDocuments: (...args: unknown[]) =>
      insertManyDocumentsMock(...args),
    updateDocument: (...args: unknown[]) => updateDocumentMock(...args),
    updateMany: (...args: unknown[]) => updateManyMock(...args),
    deleteDocument: (...args: unknown[]) => deleteDocumentMock(...args),
    deleteMany: (...args: unknown[]) => deleteManyMock(...args),
    bulkWriteDocuments: (...args: unknown[]) => bulkWriteDocumentsMock(...args),
    createMongoIndex: (...args: unknown[]) => createMongoIndexMock(...args),
    dropMongoIndex: (...args: unknown[]) => dropMongoIndexMock(...args),
  });
});

vi.mock("@lib/api/verifyActiveDb", () => ({
  verifyActiveDb: vi.fn().mockResolvedValue(""),
}));

vi.mock("@lib/sql/sqlUtils", () => ({
  splitSqlStatements: (sql: string) => [sql],
  formatSql: (sql: string) => sql,
  uglifySql: (sql: string) => sql,
}));

const EMPTY_BULK_RESULT: BulkWriteResult = {
  inserted_count: 0,
  matched_count: 0,
  modified_count: 0,
  deleted_count: 0,
  upserted_ids: [],
};

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

function getCompletedResult(tabId: string) {
  const state = getTestWorkspace("conn-mongo", "table_view_test");
  const updated = state.tabs.find((t) => t.id === tabId);
  if (!updated || updated.type !== "query") {
    throw new Error("tab not found");
  }
  if (updated.queryState.status !== "completed") {
    throw new Error(`expected completed, got ${updated.queryState.status}`);
  }
  return updated.queryState.result;
}

async function actAsync(fn: () => Promise<void>) {
  await act(fn);
}

describe("useQueryExecution — Sprint 312 write dispatch", () => {
  beforeEach(() => {
    insertDocumentMock.mockReset();
    insertManyDocumentsMock.mockReset();
    updateDocumentMock.mockReset();
    updateManyMock.mockReset();
    deleteDocumentMock.mockReset();
    deleteManyMock.mockReset();
    bulkWriteDocumentsMock.mockReset();
    createMongoIndexMock.mockReset();
    dropMongoIndexMock.mockReset();
    useWorkspaceStore.setState({ workspaces: {} });
    useConnectionStore.setState({ connections: [] });
    useQueryHistoryStore.setState({ recentVisible: [] });
    // Default = `warn` so non-empty `deleteMany` triggers the WARN dialog
    // but doesn't STOP. Individual tests flip to `strict` for STOP cases.
    useSafeModeStore.setState({ mode: "warn" });
  });

  // [AC-312-write-01] insertOne(doc) → insertDocument + writeSummary insert.
  it("dispatches insertOne to insertDocument", async () => {
    insertDocumentMock.mockResolvedValueOnce({
      objectId: "507f1f77bcf86cd799439011",
    });
    const tab = seedDocTab('db.users.insertOne({name:"Mona"})');
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await actAsync(result.current.handleExecute);

    await waitFor(() => {
      expect(insertDocumentMock).toHaveBeenCalledTimes(1);
    });
    expect(insertDocumentMock).toHaveBeenCalledWith(
      "conn-mongo",
      "table_view_test",
      "users",
      { name: "Mona" },
    );

    await waitFor(() => {
      const r = getCompletedResult(tab.id);
      expect(r.resultKind).toBe("writeSummary");
      expect(r.writeSummary).toEqual({
        kind: "insert",
        insertedIds: [{ objectId: "507f1f77bcf86cd799439011" }],
      });
    });

    const entry = useQueryHistoryStore.getState().recentVisible[0]!;
    expect(entry.queryMode).toBe("insertOne");
  });

  // [AC-312-write-02] insertMany([docs]) → insertManyDocuments.
  it("dispatches insertMany to insertManyDocuments", async () => {
    insertManyDocumentsMock.mockResolvedValueOnce([
      { number: 1 },
      { number: 2 },
    ]);
    const tab = seedDocTab("db.users.insertMany([{n:1},{n:2}])");
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await actAsync(result.current.handleExecute);

    await waitFor(() => {
      expect(insertManyDocumentsMock).toHaveBeenCalledTimes(1);
    });
    expect(insertManyDocumentsMock).toHaveBeenCalledWith(
      "conn-mongo",
      "table_view_test",
      "users",
      [{ n: 1 }, { n: 2 }],
    );
    await waitFor(() => {
      const r = getCompletedResult(tab.id);
      expect(r.writeSummary).toEqual({
        kind: "insert",
        insertedIds: [{ number: 1 }, { number: 2 }],
      });
    });
    expect(useQueryHistoryStore.getState().recentVisible[0]!.queryMode).toBe(
      "insertMany",
    );
  });

  // [AC-312-write-03] deleteMany(filter) WARN → MqlPreviewModal mount; confirm
  // re-runs the same IPC verbatim.
  it("non-empty deleteMany → WARN pending; confirm dispatches deleteMany", async () => {
    deleteManyMock.mockResolvedValueOnce(3);
    const tab = seedDocTab("db.users.deleteMany({archived:true})");
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await actAsync(result.current.handleExecute);

    // WARN tier — pending state set, IPC NOT called yet.
    expect(result.current.pendingMongoWarn).not.toBeNull();
    expect(deleteManyMock).not.toHaveBeenCalled();

    await actAsync(result.current.confirmMongoWarn);

    await waitFor(() => {
      expect(deleteManyMock).toHaveBeenCalledTimes(1);
    });
    expect(deleteManyMock).toHaveBeenCalledWith(
      "conn-mongo",
      "table_view_test",
      "users",
      { archived: true },
      true,
    );
    await waitFor(() => {
      const r = getCompletedResult(tab.id);
      expect(r.writeSummary).toEqual({ kind: "delete", deletedCount: 3 });
    });
  });

  // [AC-312-write-04] empty deleteMany → STOP. Production environment +
  // any mode triggers `confirm`.
  it("empty-filter deleteMany → STOP confirm; cancel does NOT call IPC", async () => {
    const tab = seedDocTab("db.users.deleteMany({})");
    // Production overrides `seedDocTab`'s default `development` env so
    // the Safe Mode matrix returns `confirm` for the danger statement.
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

    await actAsync(result.current.handleExecute);

    expect(result.current.pendingMongoConfirm).not.toBeNull();
    expect(result.current.pendingMongoConfirm!.reason).toMatch(
      /deleteMany without filter/,
    );
    expect(deleteManyMock).not.toHaveBeenCalled();

    act(() => {
      result.current.cancelMongoDangerous();
    });
    expect(deleteManyMock).not.toHaveBeenCalled();
  });

  // ── 이슈 #2375 — 비프로덕션 + `warn` 에서 danger 도 미리보기를 받는다 ──
  //
  // `seedDocTab` 이 심는 연결 환경은 `development` 이고 위 beforeEach 가
  // `mode` 를 `warn` 으로 둔다 — 출하 기본 설정이다. 그 조합에서
  // `decideSafeModeAction` 은 파괴적 문장에도 `allow` 를 주므로, 회귀 전에는
  // 아래 `preview[danger]` 케이스들과 이 파일 끝의 `dropIndex` 케이스가 창
  // 하나 없이 IPC 로 나갔다. `pendingMongoConfirm` 이 대신 서면 안 된다 —
  // 그건 ADR 0022 의 매트릭스를 고쳤다는 뜻이다.

  it("preview[danger] empty-filter deleteMany → 미리보기 pending; confirm 후에야 IPC", async () => {
    deleteManyMock.mockResolvedValueOnce(9);
    const tab = seedDocTab("db.users.deleteMany({})");
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await actAsync(result.current.handleExecute);

    expect(result.current.pendingMongoWarn).not.toBeNull();
    expect(result.current.pendingMongoConfirm).toBeNull();
    expect(deleteManyMock).not.toHaveBeenCalled();

    await actAsync(result.current.confirmMongoWarn);

    await waitFor(() => {
      expect(deleteManyMock).toHaveBeenCalledTimes(1);
    });
    expect(deleteManyMock).toHaveBeenCalledWith(
      "conn-mongo",
      "table_view_test",
      "users",
      {},
      true,
    );
  });

  it("preview[danger] empty-filter updateMany → 미리보기 pending; confirm 후에야 IPC", async () => {
    updateManyMock.mockResolvedValueOnce(4);
    const tab = seedDocTab("db.users.updateMany({}, {$set:{reviewed:true}})");
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await actAsync(result.current.handleExecute);

    expect(result.current.pendingMongoWarn).not.toBeNull();
    expect(result.current.pendingMongoConfirm).toBeNull();
    expect(updateManyMock).not.toHaveBeenCalled();

    await actAsync(result.current.confirmMongoWarn);

    await waitFor(() => {
      expect(updateManyMock).toHaveBeenCalledTimes(1);
    });
  });

  it("preview[danger] bulkWrite with empty-filter *-many sub-op → 미리보기 pending", async () => {
    bulkWriteDocumentsMock.mockResolvedValueOnce(EMPTY_BULK_RESULT);
    const tab = seedDocTab("db.users.bulkWrite([{deleteMany:{filter:{}}}])");
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await actAsync(result.current.handleExecute);

    expect(result.current.pendingMongoWarn).not.toBeNull();
    expect(result.current.pendingMongoConfirm).toBeNull();
    expect(bulkWriteDocumentsMock).not.toHaveBeenCalled();

    await actAsync(result.current.confirmMongoWarn);

    await waitFor(() => {
      expect(bulkWriteDocumentsMock).toHaveBeenCalledTimes(1);
    });
  });

  // [AC-312-write-05] updateMany WARN → MqlPreviewModal mount; confirm calls
  // updateMany IPC.
  it("non-empty updateMany → WARN; confirm dispatches updateMany", async () => {
    updateManyMock.mockResolvedValueOnce(5);
    const tab = seedDocTab(
      "db.users.updateMany({active:false}, {$set:{reviewed:true}})",
    );
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await actAsync(result.current.handleExecute);
    expect(result.current.pendingMongoWarn).not.toBeNull();
    expect(updateManyMock).not.toHaveBeenCalled();

    await actAsync(result.current.confirmMongoWarn);

    await waitFor(() => {
      expect(updateManyMock).toHaveBeenCalledTimes(1);
    });
    expect(updateManyMock).toHaveBeenCalledWith(
      "conn-mongo",
      "table_view_test",
      "users",
      { active: false },
      { reviewed: true },
      true,
    );
    await waitFor(() => {
      const r = getCompletedResult(tab.id);
      expect(r.writeSummary).toEqual({
        kind: "update",
        matchedCount: 5,
        modifiedCount: 5,
      });
    });
  });

  // [AC-312-write-06] deleteOne with _id-only filter → updateDocument fast
  // path is NOT used (delete) — `deleteDocument` IPC instead. The single-
  // doc path skips Safe Mode (INFO tier).
  it("deleteOne with {_id:...} filter → deleteDocument fast path", async () => {
    deleteDocumentMock.mockResolvedValueOnce(undefined);
    const tab = seedDocTab(
      'db.users.deleteOne({_id: ObjectId("507f1f77bcf86cd799439011")})',
    );
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await actAsync(result.current.handleExecute);

    await waitFor(() => {
      expect(deleteDocumentMock).toHaveBeenCalledTimes(1);
    });
    expect(deleteDocumentMock).toHaveBeenCalledWith(
      "conn-mongo",
      "table_view_test",
      "users",
      { objectId: "507f1f77bcf86cd799439011" },
    );
    expect(bulkWriteDocumentsMock).not.toHaveBeenCalled();
    await waitFor(() => {
      const r = getCompletedResult(tab.id);
      expect(r.writeSummary).toEqual({ kind: "delete", deletedCount: 1 });
    });
  });

  // [AC-312-write-08] updateOne with _id-only filter → updateDocument fast path.
  it("updateOne with {_id:...} filter + $set → updateDocument fast path", async () => {
    updateDocumentMock.mockResolvedValueOnce(undefined);
    const tab = seedDocTab(
      'db.users.updateOne({_id:"abc"}, {$set:{name:"Mona"}})',
    );
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await actAsync(result.current.handleExecute);

    await waitFor(() => {
      expect(updateDocumentMock).toHaveBeenCalledTimes(1);
    });
    expect(updateDocumentMock).toHaveBeenCalledWith(
      "conn-mongo",
      "table_view_test",
      "users",
      { string: "abc" },
      { name: "Mona" },
    );
    expect(bulkWriteDocumentsMock).not.toHaveBeenCalled();
  });

  // [AC-312-write-10] bulkWrite with INFO sub-ops → direct IPC call.
  it("normalizes real mongosh bulkWrite insertOne before dispatch", async () => {
    const bulkResult: BulkWriteResult = {
      inserted_count: 1,
      matched_count: 1,
      modified_count: 1,
      deleted_count: 1,
      upserted_ids: [],
    };
    bulkWriteDocumentsMock.mockResolvedValueOnce(bulkResult);
    const tab = seedDocTab(
      "db.users.bulkWrite([{insertOne:{document:{n:1}}}])",
    );
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await actAsync(result.current.handleExecute);

    await waitFor(() => {
      expect(bulkWriteDocumentsMock).toHaveBeenCalledTimes(1);
    });
    expect(bulkWriteDocumentsMock).toHaveBeenCalledWith(
      "conn-mongo",
      "table_view_test",
      "users",
      [{ op: "insertOne", document: { n: 1 } }],
      true,
    );
    await waitFor(() => {
      const r = getCompletedResult(tab.id);
      expect(r.writeSummary).toEqual({ kind: "bulkWrite", result: bulkResult });
    });
    expect(useQueryHistoryStore.getState().recentVisible[0]!.queryMode).toBe(
      "bulkWrite",
    );
  });

  it("surfaces ordered partial-commit warning when bulkWrite dispatch fails", async () => {
    bulkWriteDocumentsMock.mockRejectedValueOnce(
      new Error("bulk_write op 1 insert_one failed: duplicate key"),
    );
    const tab = seedDocTab(
      "db.users.bulkWrite([{insertOne:{document:{n:1}}},{insertOne:{document:{n:2}}}])",
    );
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await actAsync(result.current.handleExecute);

    await waitFor(() => {
      expect(bulkWriteDocumentsMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      const state = getTestWorkspace("conn-mongo", "table_view_test");
      const updated = state.tabs.find((t) => t.id === tab.id);
      expect(updated?.type).toBe("query");
      if (updated?.type === "query") {
        expect(updated.queryState.status).toBe("error");
        if (updated.queryState.status === "error") {
          expect(updated.queryState.error).toMatch(/ordered operations/);
          expect(updated.queryState.error).toMatch(/not transactional/);
          expect(updated.queryState.error).toMatch(
            /earlier operations may already be committed/,
          );
          expect(updated.queryState.error).toMatch(/before retry/);
          expect(updated.queryState.error).toMatch(/bulk_write op 1/);
          expect(updated.queryState.error).not.toMatch(/rolled back/i);
        }
      }
    });
  });

  it("rejects real mongosh bulkWrite updateOne without an _id-only filter before IPC", async () => {
    const tab = seedDocTab(
      'db.users.bulkWrite([{updateOne:{filter:{email:"x@y.com"}, update:{$set:{verified:true}}}}])',
    );
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await actAsync(result.current.handleExecute);

    expect(bulkWriteDocumentsMock).not.toHaveBeenCalled();
    await waitFor(() => {
      const state = getTestWorkspace("conn-mongo", "table_view_test");
      const updated = state.tabs.find((t) => t.id === tab.id);
      expect(updated?.type).toBe("query");
      if (updated?.type === "query") {
        expect(updated.queryState.status).toBe("error");
        if (updated.queryState.status === "error") {
          expect(updated.queryState.error).toMatch(/_id-only filter/i);
        }
      }
    });
  });

  it("dispatches replaceOne through bulkWriteDocuments", async () => {
    const bulkResult: BulkWriteResult = {
      ...EMPTY_BULK_RESULT,
      matched_count: 1,
      modified_count: 1,
    };
    bulkWriteDocumentsMock.mockResolvedValueOnce(bulkResult);
    const tab = seedDocTab(
      'db.users.replaceOne({_id:"abc"}, {_id:"abc", email:"x@y.com", verified:true}, {upsert:true})',
    );
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await actAsync(result.current.handleExecute);

    await waitFor(() => {
      expect(bulkWriteDocumentsMock).toHaveBeenCalledTimes(1);
    });
    expect(bulkWriteDocumentsMock).toHaveBeenCalledWith(
      "conn-mongo",
      "table_view_test",
      "users",
      [
        {
          op: "replaceOne",
          filter: { _id: "abc" },
          replacement: { _id: "abc", email: "x@y.com", verified: true },
          upsert: true,
        },
      ],
      true,
    );
    await waitFor(() => {
      const r = getCompletedResult(tab.id);
      expect(r.writeSummary).toEqual({ kind: "bulkWrite", result: bulkResult });
    });
    expect(useQueryHistoryStore.getState().recentVisible[0]!.queryMode).toBe(
      "replaceOne",
    );
  });

  it("dispatches createIndex to createMongoIndex", async () => {
    createMongoIndexMock.mockResolvedValueOnce({ name: "email_1" });
    const tab = seedDocTab(
      'db.users.createIndex({email:1}, {name:"email_1", unique:true})',
    );
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await actAsync(result.current.handleExecute);

    await waitFor(() => {
      expect(createMongoIndexMock).toHaveBeenCalledTimes(1);
    });
    expect(createMongoIndexMock).toHaveBeenCalledWith(
      "conn-mongo",
      "table_view_test",
      "users",
      {
        name: "email_1",
        fields: [{ name: "email", direction: "asc" }],
        unique: true,
      },
    );
    await waitFor(() => {
      const r = getCompletedResult(tab.id);
      expect(r.queryType).toBe("ddl");
      expect(r.rows).toEqual([["createIndex", "email_1"]]);
    });
    expect(useQueryHistoryStore.getState().recentVisible[0]!.queryMode).toBe(
      "createIndex",
    );
  });

  // Issue #2375 — `dropIndex` builds `severity: "danger"` inline in
  // `mongoWriteDispatch.ts` rather than through `analyzeMongoOperation`, so
  // it carried no `severity` comparison for the first sweep of this issue to
  // widen and stayed ungated a round longer than the branches above. Under
  // this file's shipped-default fixture (`development` + `warn`) the gate
  // returns `allow`, so before the fix `handleExecute` alone called
  // `dropMongoIndex`. The assertions before `confirmMongoWarn` are what go
  // red if that branch loses the gate again; the IPC-payload assertions
  // after it are the pre-#2375 ones, unchanged.
  it("preview[danger] dropIndex → 미리보기 pending; confirm 후에야 dropMongoIndex", async () => {
    dropMongoIndexMock.mockResolvedValueOnce(undefined);
    const tab = seedDocTab('db.users.dropIndex("email_1")');
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await actAsync(result.current.handleExecute);

    expect(result.current.pendingMongoWarn).not.toBeNull();
    expect(result.current.pendingMongoConfirm).toBeNull();
    expect(dropMongoIndexMock).not.toHaveBeenCalled();

    await actAsync(result.current.confirmMongoWarn);

    await waitFor(() => {
      expect(dropMongoIndexMock).toHaveBeenCalledTimes(1);
    });
    expect(dropMongoIndexMock).toHaveBeenCalledWith(
      "conn-mongo",
      "table_view_test",
      "users",
      "email_1",
      true,
    );
    await waitFor(() => {
      const r = getCompletedResult(tab.id);
      expect(r.queryType).toBe("ddl");
      expect(r.rows).toEqual([["dropIndex", "email_1"]]);
    });
    expect(useQueryHistoryStore.getState().recentVisible[0]!.queryMode).toBe(
      "dropIndex",
    );
  });

  it("rejects updateOne without an _id-only filter before IPC", async () => {
    const tab = seedDocTab(
      'db.users.updateOne({email:"x@y.com"}, {$set:{verified:true}})',
    );
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await actAsync(result.current.handleExecute);

    expect(updateDocumentMock).not.toHaveBeenCalled();
    expect(bulkWriteDocumentsMock).not.toHaveBeenCalled();
    await waitFor(() => {
      const state = getTestWorkspace("conn-mongo", "table_view_test");
      const updated = state.tabs.find((t) => t.id === tab.id);
      expect(updated?.type).toBe("query");
      if (updated?.type === "query") {
        expect(updated.queryState.status).toBe("error");
        if (updated.queryState.status === "error") {
          expect(updated.queryState.error).toMatch(/_id-only filter/i);
        }
      }
    });
  });

  it("rejects deleteOne without an _id-only filter before IPC", async () => {
    const tab = seedDocTab('db.users.deleteOne({email:"x@y.com"})');
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await actAsync(result.current.handleExecute);

    expect(deleteDocumentMock).not.toHaveBeenCalled();
    expect(bulkWriteDocumentsMock).not.toHaveBeenCalled();
    await waitFor(() => {
      const state = getTestWorkspace("conn-mongo", "table_view_test");
      const updated = state.tabs.find((t) => t.id === tab.id);
      expect(updated?.type).toBe("query");
      if (updated?.type === "query") {
        expect(updated.queryState.status).toBe("error");
        if (updated.queryState.status === "error") {
          expect(updated.queryState.error).toMatch(/_id-only filter/i);
        }
      }
    });
  });

  // [AC-312-write-11] bulkWrite with empty-filter `*-many` sub-op → STOP.
  it("bulkWrite with empty-filter *-many sub-op → STOP confirm", async () => {
    const tab = seedDocTab("db.users.bulkWrite([{deleteMany:{filter:{}}}])");
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

    await actAsync(result.current.handleExecute);

    expect(result.current.pendingMongoConfirm).not.toBeNull();
    expect(bulkWriteDocumentsMock).not.toHaveBeenCalled();
  });
});
