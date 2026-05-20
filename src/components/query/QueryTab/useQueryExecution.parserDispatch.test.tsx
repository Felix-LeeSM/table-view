// Sprint 311 (Phase 28 Slice A5, 2026-05-14) — parser-driven document Run
// dispatch. The hook now routes the editor text through
// `parseMongoshExpression` and dispatches to one of 6 read-path IPC
// wrappers in `@lib/tauri/document`, replacing the prior
// `JSON.parse` + `tab.queryMode === "aggregate"` branch.
//
// Test axes (TDD vertical slice — written in order):
//   1. `db.coll.find(...)`        → findDocuments + FindBody cursor chain
//   2. `db.coll.aggregate([...])` → aggregateDocuments + Safe Mode gate
//   3. parser-error                → queryState.error, IPC NOT called
//   4. collection mismatch         → queryState.error (`"Editor targets
//                                    collection 'X' but tab is bound to 'Y'."`)
//   5. `db.coll.countDocuments(...)`         → scalar QueryResult + IPC
//   6. `db.coll.estimatedDocumentCount()`    → scalar QueryResult + IPC
//   7. `db.coll.distinct("field", ...)`       → list QueryResult + IPC
//   8. `db.coll.findOne(...)`                  → single-row grid QueryResult
//   9. aggregate STOP confirm — stale editor isolation (parsed pipeline
//      stored in `pendingMongoConfirm`, NOT re-parsed on confirm click).
//  10. Query history records raw mongosh + parsed method name.
//
// Mock surface mirrors `useQueryExecution.ts` imports: 8 IPC wrappers
// from `@lib/tauri` (executeQuery, executeQueryDryRun, cancelQuery,
// findDocuments, aggregateDocuments, findOneDocument, countDocuments,
// estimatedDocumentCount, distinctDocuments) + verifyActiveDb stub +
// splitSqlStatements stub.
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
import type { DocumentQueryResult, DocumentRow } from "@/types/document";

const executeQueryMock = vi.fn();
const executeQueryDryRunMock = vi.fn();
const cancelQueryMock = vi.fn();
const findDocumentsMock = vi.fn();
const aggregateDocumentsMock = vi.fn();
const findOneDocumentMock = vi.fn();
const countDocumentsMock = vi.fn();
const estimatedDocumentCountMock = vi.fn();
const distinctDocumentsMock = vi.fn();
beforeEach(() => {
  setupTauriMock({
    executeQuery: (...args: unknown[]) => executeQueryMock(...args),
    executeQueryDryRun: (...args: unknown[]) => executeQueryDryRunMock(...args),
    cancelQuery: (...args: unknown[]) => cancelQueryMock(...args),
    findDocuments: (...args: unknown[]) => findDocumentsMock(...args),
    aggregateDocuments: (...args: unknown[]) => aggregateDocumentsMock(...args),
    findOneDocument: (...args: unknown[]) => findOneDocumentMock(...args),
    countDocuments: (...args: unknown[]) => countDocumentsMock(...args),
    estimatedDocumentCount: (...args: unknown[]) =>
      estimatedDocumentCountMock(...args),
    distinctDocuments: (...args: unknown[]) => distinctDocumentsMock(...args),
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

const DOC_RESULT: DocumentQueryResult = {
  columns: [{ name: "_id", dataType: "objectId", category: "unknown" }],
  rows: [["x"]],
  rawDocuments: [{ _id: "x" }],
  totalCount: 1,
  executionTimeMs: 4,
};

const DOC_ROW: DocumentRow = {
  columns: [{ name: "_id", dataType: "objectId", category: "unknown" }],
  row: ["x"],
  raw: { _id: "x" },
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

describe("useQueryExecution — Sprint 311 parser-driven document dispatch", () => {
  beforeEach(() => {
    executeQueryMock.mockReset();
    executeQueryDryRunMock.mockReset();
    cancelQueryMock.mockReset();
    findDocumentsMock.mockReset();
    aggregateDocumentsMock.mockReset();
    findOneDocumentMock.mockReset();
    countDocumentsMock.mockReset();
    estimatedDocumentCountMock.mockReset();
    distinctDocumentsMock.mockReset();
    useWorkspaceStore.setState({ workspaces: {} });
    useConnectionStore.setState({ connections: [] });
    useQueryHistoryStore.setState({ recentVisible: [] });
    useSafeModeStore.setState({ mode: "warn" });
  });

  // [AC-311-01] `db.users.find({active:true}).sort({name:1}).limit(10)` →
  // findDocuments with FindBody { filter, sort, limit }. `.toArray()` is
  // parsed but treated as a no-op.
  it("[AC-311-01] db.users.find(...) → findDocuments FindBody (cursor chain mapped)", async () => {
    findDocumentsMock.mockResolvedValueOnce(DOC_RESULT);
    const tab = seedDocTab(
      "db.users.find({active:true}).sort({name:1}).limit(10).skip(5).toArray()",
    );
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(findDocumentsMock).toHaveBeenCalledTimes(1);
    });
    expect(findDocumentsMock).toHaveBeenCalledWith(
      "conn-mongo",
      "table_view_test",
      "users",
      { filter: { active: true }, sort: { name: 1 }, limit: 10, skip: 5 },
    );
    expect(aggregateDocumentsMock).not.toHaveBeenCalled();
  });

  // [AC-311-01b] `db.users.find()` with no args + empty cursor chain →
  // findDocuments with `{}` (empty FindBody).
  it("[AC-311-01b] db.users.find() → findDocuments({})", async () => {
    findDocumentsMock.mockResolvedValueOnce(DOC_RESULT);
    const tab = seedDocTab("db.users.find()");
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(findDocumentsMock).toHaveBeenCalledTimes(1);
    });
    expect(findDocumentsMock).toHaveBeenCalledWith(
      "conn-mongo",
      "table_view_test",
      "users",
      {},
    );
  });

  // [AC-311-02] aggregate dispatch + Safe Mode gate. Read-only pipeline →
  // direct IPC.
  it("[AC-311-02] db.users.aggregate([...]) read-only → aggregateDocuments direct IPC", async () => {
    aggregateDocumentsMock.mockResolvedValueOnce(DOC_RESULT);
    const tab = seedDocTab(
      "db.users.aggregate([{$match:{active:true}},{$limit:10}])",
    );
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(aggregateDocumentsMock).toHaveBeenCalledTimes(1);
    });
    expect(aggregateDocumentsMock).toHaveBeenCalledWith(
      "conn-mongo",
      "table_view_test",
      "users",
      [{ $match: { active: true } }, { $limit: 10 }],
    );
  });

  // [AC-311-02b] aggregate with trailing `.toArray()` is parsed and the
  // chain step is ignored (default IPC behavior already returns an array).
  it("[AC-311-02b] db.coll.aggregate([...]).toArray() → toArray ignored", async () => {
    aggregateDocumentsMock.mockResolvedValueOnce(DOC_RESULT);
    const tab = seedDocTab("db.users.aggregate([{$match:{}}]).toArray()");
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(aggregateDocumentsMock).toHaveBeenCalledTimes(1);
    });
    expect(aggregateDocumentsMock).toHaveBeenCalledWith(
      "conn-mongo",
      "table_view_test",
      "users",
      [{ $match: {} }],
    );
  });

  // [AC-311-03] parser-error → queryState.error, no IPC dispatch.
  it("[AC-311-03] parser error → queryState.error, IPC not called", async () => {
    const tab = seedDocTab("not-valid-mongosh-(=>)");
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    expect(findDocumentsMock).not.toHaveBeenCalled();
    expect(aggregateDocumentsMock).not.toHaveBeenCalled();
    await waitFor(() => {
      const state = getTestWorkspace("conn-mongo", "table_view_test");
      const updated = state.tabs.find((t) => t.id === tab.id);
      if (!updated || updated.type !== "query") {
        throw new Error("tab not found");
      }
      expect(updated.queryState.status).toBe("error");
    });
  });

  // [AC-311-04] collection mismatch with bound tab.collection → exact
  // error wording per contract; no IPC.
  it("[AC-311-04] collection mismatch → queryState.error wording per contract", async () => {
    const tab = seedDocTab("db.orders.find({})", { collection: "users" });
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    expect(findDocumentsMock).not.toHaveBeenCalled();
    await waitFor(() => {
      const state = getTestWorkspace("conn-mongo", "table_view_test");
      const updated = state.tabs.find((t) => t.id === tab.id);
      if (!updated || updated.type !== "query") {
        throw new Error("tab not found");
      }
      if (updated.queryState.status !== "error") {
        throw new Error(`expected error, got ${updated.queryState.status}`);
      }
      expect(updated.queryState.error).toBe(
        "Editor targets collection 'orders' but tab is bound to 'users'.",
      );
    });
  });

  // [AC-311-04b] free-form tab (tab.collection unset) uses parsed
  // collection; dispatch proceeds.
  it("[AC-311-04b] free-form tab (no tab.collection) uses parsed collection", async () => {
    findDocumentsMock.mockResolvedValueOnce(DOC_RESULT);
    const tab = seedDocTab("db.orders.find({})", { collection: undefined });
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(findDocumentsMock).toHaveBeenCalledTimes(1);
    });
    expect(findDocumentsMock).toHaveBeenCalledWith(
      "conn-mongo",
      "table_view_test",
      "orders",
      { filter: {} },
    );
  });

  // [AC-311-05] countDocuments → scalar QueryResult.
  it("[AC-311-05] db.users.countDocuments({active:true}) → scalar QueryResult", async () => {
    countDocumentsMock.mockResolvedValueOnce(42);
    const tab = seedDocTab("db.users.countDocuments({active:true})");
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(countDocumentsMock).toHaveBeenCalledTimes(1);
    });
    expect(countDocumentsMock).toHaveBeenCalledWith(
      "conn-mongo",
      "table_view_test",
      "users",
      { active: true },
    );

    await waitFor(() => {
      const state = getTestWorkspace("conn-mongo", "table_view_test");
      const updated = state.tabs.find((t) => t.id === tab.id);
      if (!updated || updated.type !== "query") {
        throw new Error("tab not found");
      }
      if (updated.queryState.status !== "completed") {
        throw new Error(`expected completed, got ${updated.queryState.status}`);
      }
      expect(updated.queryState.result.resultKind).toBe("scalar");
      expect(updated.queryState.result.columns).toEqual([
        { name: "count", dataType: "Int64", category: "int" },
      ]);
      expect(updated.queryState.result.rows).toEqual([[42]]);
      expect(updated.queryState.result.totalCount).toBe(1);
    });
  });

  // [AC-311-06] estimatedDocumentCount → scalar QueryResult.
  it("[AC-311-06] db.users.estimatedDocumentCount() → scalar QueryResult", async () => {
    estimatedDocumentCountMock.mockResolvedValueOnce(1234);
    const tab = seedDocTab("db.users.estimatedDocumentCount()");
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(estimatedDocumentCountMock).toHaveBeenCalledTimes(1);
    });
    expect(estimatedDocumentCountMock).toHaveBeenCalledWith(
      "conn-mongo",
      "table_view_test",
      "users",
    );

    await waitFor(() => {
      const state = getTestWorkspace("conn-mongo", "table_view_test");
      const updated = state.tabs.find((t) => t.id === tab.id);
      if (!updated || updated.type !== "query") {
        throw new Error("tab not found");
      }
      if (updated.queryState.status !== "completed") {
        throw new Error("not completed");
      }
      expect(updated.queryState.result.resultKind).toBe("scalar");
      expect(updated.queryState.result.rows).toEqual([[1234]]);
    });
  });

  // [AC-311-07] distinct → list QueryResult (1 column `value`, N rows).
  it("[AC-311-07] db.users.distinct('country') → list QueryResult", async () => {
    distinctDocumentsMock.mockResolvedValueOnce(["KR", "US", "JP"]);
    const tab = seedDocTab('db.users.distinct("country")');
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(distinctDocumentsMock).toHaveBeenCalledTimes(1);
    });
    expect(distinctDocumentsMock).toHaveBeenCalledWith(
      "conn-mongo",
      "table_view_test",
      "users",
      "country",
      undefined,
    );

    await waitFor(() => {
      const state = getTestWorkspace("conn-mongo", "table_view_test");
      const updated = state.tabs.find((t) => t.id === tab.id);
      if (!updated || updated.type !== "query") {
        throw new Error("tab not found");
      }
      if (updated.queryState.status !== "completed") {
        throw new Error("not completed");
      }
      expect(updated.queryState.result.resultKind).toBe("list");
      expect(updated.queryState.result.columns).toEqual([
        { name: "value", dataType: "string", category: "text" },
      ]);
      expect(updated.queryState.result.rows).toEqual([["KR"], ["US"], ["JP"]]);
      expect(updated.queryState.result.totalCount).toBe(3);
    });
  });

  // [AC-311-07b] distinct with filter passes filter through.
  it("[AC-311-07b] db.users.distinct('country', {active:true}) → filter passed", async () => {
    distinctDocumentsMock.mockResolvedValueOnce([]);
    const tab = seedDocTab('db.users.distinct("country", {active:true})');
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(distinctDocumentsMock).toHaveBeenCalledTimes(1);
    });
    expect(distinctDocumentsMock).toHaveBeenCalledWith(
      "conn-mongo",
      "table_view_test",
      "users",
      "country",
      { active: true },
    );
  });

  // [AC-311-08] findOne → single-row grid QueryResult.
  it("[AC-311-08] db.users.findOne({_id:1}) → single-row grid QueryResult", async () => {
    findOneDocumentMock.mockResolvedValueOnce(DOC_ROW);
    const tab = seedDocTab("db.users.findOne({_id:1})");
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(findOneDocumentMock).toHaveBeenCalledTimes(1);
    });
    expect(findOneDocumentMock).toHaveBeenCalledWith(
      "conn-mongo",
      "table_view_test",
      "users",
      { _id: 1 },
    );

    await waitFor(() => {
      const state = getTestWorkspace("conn-mongo", "table_view_test");
      const updated = state.tabs.find((t) => t.id === tab.id);
      if (!updated || updated.type !== "query") {
        throw new Error("tab not found");
      }
      if (updated.queryState.status !== "completed") {
        throw new Error("not completed");
      }
      expect(updated.queryState.result.columns).toEqual(DOC_ROW.columns);
      expect(updated.queryState.result.rows).toEqual([DOC_ROW.row]);
      expect(updated.queryState.result.totalCount).toBe(1);
    });
  });

  // [AC-311-08b] findOne(None) → empty grid (D-12).
  it("[AC-311-08b] findOne returning null → empty grid QueryResult", async () => {
    findOneDocumentMock.mockResolvedValueOnce(null);
    const tab = seedDocTab("db.users.findOne({_id:999})");
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      const state = getTestWorkspace("conn-mongo", "table_view_test");
      const updated = state.tabs.find((t) => t.id === tab.id);
      if (!updated || updated.type !== "query") {
        throw new Error("tab not found");
      }
      if (updated.queryState.status !== "completed") {
        throw new Error("not completed");
      }
      expect(updated.queryState.result.columns).toEqual([]);
      expect(updated.queryState.result.rows).toEqual([]);
      expect(updated.queryState.result.totalCount).toBe(0);
    });
  });

  // [AC-311-09] aggregate STOP confirm — pendingMongoConfirm stores the
  // PARSED pipeline. If the user then mutates `tab.sql` between prompt
  // and confirm-click, the IPC must dispatch with the ORIGINAL parsed
  // pipeline (not a re-parse of the now-stale editor text).
  it("[AC-311-09] aggregate STOP confirm — stale editor isolation", async () => {
    useSafeModeStore.setState({ mode: "strict" });
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
    const initialSql = 'db.users.aggregate([{$match:{}},{$out:"snapshot"}])';
    const tab = seedDocTab(initialSql);
    const { result, rerender } = renderHook(
      ({ tab: t }) => useQueryExecution({ tab: t }),
      { initialProps: { tab } },
    );

    await act(async () => {
      await result.current.handleExecute();
    });

    // STOP confirm dialog state should be populated.
    expect(result.current.pendingMongoConfirm).not.toBeNull();
    expect(result.current.pendingMongoConfirm!.pipeline).toEqual([
      { $match: {} },
      { $out: "snapshot" },
    ]);
    expect(aggregateDocumentsMock).not.toHaveBeenCalled();

    // User edits editor text (e.g. tries to swap pipeline mid-prompt).
    const mutated = {
      ...tab,
      sql: "db.users.aggregate([{$match:{benign:true}}])",
    };
    useWorkspaceStore.setState(seedWorkspace([mutated], mutated.id));
    rerender({ tab: mutated });

    aggregateDocumentsMock.mockResolvedValueOnce(DOC_RESULT);
    await act(async () => {
      await result.current.confirmMongoDangerous();
    });

    await waitFor(() => {
      expect(aggregateDocumentsMock).toHaveBeenCalledTimes(1);
    });
    // IPC must run with the ORIGINAL parsed pipeline, not the mutated
    // editor's pipeline.
    expect(aggregateDocumentsMock).toHaveBeenCalledWith(
      "conn-mongo",
      "table_view_test",
      "users",
      [{ $match: {} }, { $out: "snapshot" }],
    );
  });

  // [AC-311-10] history records raw mongosh + parsed method name as
  // queryMode. Backward-compat: search-by-queryMode keeps working.
  it("[AC-311-10] history records raw mongosh + parsed method name", async () => {
    findDocumentsMock.mockResolvedValueOnce(DOC_RESULT);
    const raw = "db.users.find({active:true}).limit(5)";
    const tab = seedDocTab(raw);
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(useQueryHistoryStore.getState().recentVisible.length).toBe(1);
    });
    const entry = useQueryHistoryStore.getState().recentVisible[0]!;
    expect(entry.sqlRedacted).toBe(raw);
    expect(entry.queryMode).toBe("find");
    expect(entry.paradigm).toBe("document");
  });

  // [AC-311-10b] aggregate history records `queryMode: "aggregate"`.
  it("[AC-311-10b] aggregate history records queryMode 'aggregate'", async () => {
    aggregateDocumentsMock.mockResolvedValueOnce(DOC_RESULT);
    const raw = "db.users.aggregate([{$match:{}}])";
    const tab = seedDocTab(raw);
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(useQueryHistoryStore.getState().recentVisible.length).toBe(1);
    });
    const entry = useQueryHistoryStore.getState().recentVisible[0]!;
    expect(entry.sqlRedacted).toBe(raw);
    expect(entry.queryMode).toBe("aggregate");
  });

  // [AC-311-10c] countDocuments history records `queryMode:
  // "countDocuments"`.
  it("[AC-311-10c] countDocuments history records queryMode 'countDocuments'", async () => {
    countDocumentsMock.mockResolvedValueOnce(7);
    const raw = "db.users.countDocuments({})";
    const tab = seedDocTab(raw);
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(useQueryHistoryStore.getState().recentVisible.length).toBe(1);
    });
    // sprint-373 (2026-05-17) — backend wire `DocumentQueryMode` 는
    // `"count"` 만 허용 (legacy `"countDocuments"` 는 frontend `QueryMode`
    // 타입에는 살아있지만 `recordHistoryEntry` 의 매핑이 backend wire 로
    // narrow 함). 사용자가 history panel 에서 보는 표기도 `"count"`.
    expect(useQueryHistoryStore.getState().recentVisible[0]!.queryMode).toBe(
      "count",
    );
  });
});
