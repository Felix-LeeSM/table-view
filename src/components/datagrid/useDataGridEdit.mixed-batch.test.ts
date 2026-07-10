import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { renderHook, act } from "@testing-library/react";
import { useDataGridEdit } from "./useDataGridEdit";
import type { TableData } from "@/types/schema";

// Sprint 184 (Phase 22 closer, 2026-05-01) — gate-consistency regression +
// performance smoke. Sprint 182 introduced the PendingChangesTray + PK guard
// and Sprint 183 wrapped the RDB commit in a single executeQueryBatch
// transaction. This file pins:
//   1. UPDATE + INSERT + DELETE all leave through a *single* batch call
//      (executeQueryBatch for RDB; iterative dispatchMqlCommand for Mongo).
//   2. handleCommit's SQL/MQL preview build stays under O(N) — verified by a
//      crude wall-clock budget at N=100. The budget is intentionally loose
//      (1000ms or 3000ms) so a green-CI run measures well under it (typical
//      <50ms locally); the budget acts as a regression alarm for accidental
//      O(N²) work creeping into generateSqlWithKeys / generateMqlPreview.

const HEX_A = "507f1f77bcf86cd799439011";
const HEX_B = "507f1f77bcf86cd799439022";
const HEX_C = "507f1f77bcf86cd799439033";

const mockExecuteQuery = vi.fn();
const mockExecuteQueryBatch = vi.fn();
const mockInsertDocument = vi.fn<(...args: unknown[]) => Promise<unknown>>(() =>
  Promise.resolve({ objectId: "507f1f77bcf86cd799439099" }),
);
const mockUpdateDocument = vi.fn<(...args: unknown[]) => Promise<void>>(() =>
  Promise.resolve(),
);
const mockDeleteDocument = vi.fn<(...args: unknown[]) => Promise<void>>(() =>
  Promise.resolve(),
);
const mockFetchData = vi.fn();
const mockBulkWriteDocuments = vi.fn<(...args: unknown[]) => Promise<unknown>>(
  () =>
    Promise.resolve({
      inserted_count: 0,
      matched_count: 0,
      modified_count: 0,
      deleted_count: 0,
      upserted_ids: [],
    }),
);
beforeEach(() => {
  setupTauriMock({
    insertDocument: (...args: unknown[]) => mockInsertDocument(...args),
    updateDocument: (...args: unknown[]) => mockUpdateDocument(...args),
    deleteDocument: (...args: unknown[]) => mockDeleteDocument(...args),
    bulkWriteDocuments: (...args: unknown[]) => mockBulkWriteDocuments(...args),
    executeQuery: (...args: unknown[]) => mockExecuteQuery(...args),
    executeQueryBatch: (...args: unknown[]) => mockExecuteQueryBatch(...args),
  });
});

vi.mock("@stores/workspaceStore", () => ({
  useActiveTabId: () => "tab-1",
  useCurrentWorkspaceKey: () => ({ connId: "conn1", db: "db1" }),
  useWorkspaceStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      promoteTab: vi.fn(),
      setTabDirty: vi.fn(),
    }),
}));

vi.mock("@stores/connectionStore", () => ({
  useConnectionStore: (
    selector: (state: {
      connections: Array<{ id: string; dbType: string }>;
    }) => unknown,
  ) =>
    selector({
      connections: [
        { id: "conn-pg", dbType: "postgresql" },
        { id: "conn-mysql", dbType: "mysql" },
        { id: "conn-mariadb", dbType: "mariadb" },
        { id: "conn-mssql", dbType: "mssql" },
        { id: "conn-oracle", dbType: "oracle" },
        { id: "conn-mongo", dbType: "mongodb" },
      ],
    }),
}));

function happyBatchResolve(stmts: string[]) {
  return Promise.resolve(
    stmts.map(() => ({
      columns: [],
      rows: [],
      total_count: 0,
      execution_time_ms: 5,
      query_type: "dml" as const,
    })),
  );
}

const RDB_DATA: TableData = {
  columns: [
    {
      name: "id",
      data_type: "integer",
      nullable: false,
      default_value: null,
      is_primary_key: true,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
    {
      name: "name",
      data_type: "text",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
  ],
  rows: [
    [1, "Alice"],
    [2, "Bob"],
    [3, "Carol"],
  ],
  total_count: 3,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM public.users LIMIT 100 OFFSET 0",
};

const MYSQL_ROW_EDIT_DATA: TableData = {
  columns: [
    {
      name: "user id",
      data_type: "varchar",
      nullable: false,
      default_value: null,
      is_primary_key: true,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
    {
      name: "select",
      data_type: "varchar",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
  ],
  rows: [["O'Brien", "old"]],
  total_count: 1,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM `app-db`.`order detail` LIMIT 100 OFFSET 0",
};

const MSSQL_ROW_EDIT_DATA: TableData = {
  columns: [
    {
      name: "user id",
      data_type: "nvarchar(64)",
      nullable: false,
      default_value: null,
      is_primary_key: true,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
    {
      name: "select",
      data_type: "nvarchar(255)",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
  ],
  rows: [["O'Brien", "old"]],
  total_count: 1,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM [dbo].[order detail]",
};

const ORACLE_ROW_EDIT_DATA: TableData = {
  columns: [
    {
      name: "USER ID",
      data_type: "VARCHAR2",
      nullable: false,
      default_value: null,
      is_primary_key: true,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
    {
      name: "SELECT",
      data_type: "VARCHAR2",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
  ],
  rows: [["O'Brien", "old"]],
  total_count: 1,
  page: 1,
  page_size: 100,
  executed_query: 'SELECT "USER ID", "SELECT" FROM "APP"."ORDER DETAIL"',
};

const DOC_DATA: TableData = {
  columns: [
    {
      name: "_id",
      data_type: "objectId",
      nullable: false,
      default_value: null,
      is_primary_key: true,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
    {
      name: "name",
      data_type: "string",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
  ],
  rows: [
    [{ $oid: HEX_A }, "Ada"],
    [{ $oid: HEX_B }, "Grace"],
    [{ $oid: HEX_C }, "Edsger"],
  ],
  total_count: 3,
  page: 1,
  page_size: 100,
  executed_query: "db.users.find({})",
};

function renderRdbHook(data: TableData = RDB_DATA) {
  return renderHook(() =>
    useDataGridEdit({
      data,
      database: "db1",
      schema: "public",
      table: "users",
      connectionId: "conn-pg",
      page: 1,
      fetchData: mockFetchData,
    }),
  );
}

function renderMysqlHook() {
  return renderHook(() =>
    useDataGridEdit({
      data: MYSQL_ROW_EDIT_DATA,
      database: "app-db",
      schema: "app-db",
      table: "order detail",
      connectionId: "conn-mysql",
      page: 1,
      fetchData: mockFetchData,
    }),
  );
}

function renderMariaDbHook() {
  return renderHook(() =>
    useDataGridEdit({
      data: MYSQL_ROW_EDIT_DATA,
      database: "app-db",
      schema: "app-db",
      table: "order detail",
      connectionId: "conn-mariadb",
      page: 1,
      fetchData: mockFetchData,
    }),
  );
}

function renderMssqlHook() {
  return renderHook(() =>
    useDataGridEdit({
      data: MSSQL_ROW_EDIT_DATA,
      database: "MssqlApp",
      schema: "dbo",
      table: "order detail",
      connectionId: "conn-mssql",
      page: 1,
      fetchData: mockFetchData,
    }),
  );
}

function renderOracleHook() {
  return renderHook(() =>
    useDataGridEdit({
      data: ORACLE_ROW_EDIT_DATA,
      database: "FREEPDB1",
      schema: "APP",
      table: "ORDER DETAIL",
      connectionId: "conn-oracle",
      page: 1,
      fetchData: mockFetchData,
    }),
  );
}

function renderDocHook() {
  return renderHook(() =>
    useDataGridEdit({
      data: DOC_DATA,
      database: "app",
      schema: "app",
      table: "users",
      connectionId: "conn-mongo",
      page: 1,
      fetchData: mockFetchData,
      paradigm: "document",
    }),
  );
}

function buildLargeRdbFixture(rowCount: number): TableData {
  const rows: unknown[][] = [];
  for (let i = 1; i <= rowCount; i += 1) {
    rows.push([i, `name-${i}`]);
  }
  return {
    columns: RDB_DATA.columns,
    rows,
    total_count: rowCount,
    page: 1,
    page_size: rowCount,
    executed_query: RDB_DATA.executed_query,
  };
}

describe("useDataGridEdit — Sprint 184 mixed-batch + perf smoke", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupTauriMock({
      insertDocument: (...args: unknown[]) => mockInsertDocument(...args),
      updateDocument: (...args: unknown[]) => mockUpdateDocument(...args),
      deleteDocument: (...args: unknown[]) => mockDeleteDocument(...args),
      bulkWriteDocuments: (...args: unknown[]) =>
        mockBulkWriteDocuments(...args),
      executeQuery: (...args: unknown[]) => mockExecuteQuery(...args),
      executeQueryBatch: (...args: unknown[]) => mockExecuteQueryBatch(...args),
    });
    mockInsertDocument.mockResolvedValue({
      objectId: "507f1f77bcf86cd799439099",
    });
    mockUpdateDocument.mockResolvedValue(undefined);
    mockDeleteDocument.mockResolvedValue(undefined);
  });

  it("[AC-184-01] RDB commit dispatches UPDATE + INSERT + DELETE in a single executeQueryBatch call", async () => {
    // AC-184-01 — three-mutation gate consistency. Since Sprint 183 the RDB
    // commit path goes through executeQueryBatch once; this test pins that
    // all three statement kinds (UPDATE, INSERT, DELETE) end up in the same
    // batch array — i.e. the gate is unified across mutation kinds.
    // Date 2026-05-01.
    mockExecuteQueryBatch.mockImplementationOnce((_, stmts: string[]) =>
      happyBatchResolve(stmts),
    );

    const { result } = renderRdbHook();

    // 1) Pending UPDATE on row 0, column "name".
    act(() => {
      result.current.handleStartEdit(0, 1, "Alice");
    });
    act(() => {
      result.current.setEditValue("Alicia");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });

    // 2) Pending INSERT — duplicate row 1 ("Bob") so the new row has all
    //    not-null columns populated and the SQL generator will emit an
    //    INSERT statement.
    act(() => {
      result.current.handleSelectRow(1, false, false);
    });
    act(() => {
      result.current.handleDuplicateRow();
    });

    // 3) Pending DELETE on row 2 ("Carol").
    act(() => {
      result.current.handleSelectRow(2, false, false);
    });
    act(() => {
      result.current.handleDeleteRow();
    });

    // Build SQL preview.
    act(() => {
      result.current.handleCommit();
    });

    expect(result.current.sqlPreview).not.toBeNull();
    expect(result.current.sqlPreview!.length).toBe(3);

    // Sanity — preview contains one of each kind.
    const previewKinds = result.current.sqlPreview!.map(
      (sql) => sql.split(/\s+/)[0]!,
    );
    expect(previewKinds.filter((k) => k === "UPDATE")).toHaveLength(1);
    expect(previewKinds.filter((k) => k === "INSERT")).toHaveLength(1);
    expect(previewKinds.filter((k) => k === "DELETE")).toHaveLength(1);

    // Execute commit — single batch call expected.
    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
    expect(mockExecuteQuery).not.toHaveBeenCalled();

    const [, statementsArg, , expectedDatabaseArg] =
      mockExecuteQueryBatch.mock.calls[0]!;
    expect(Array.isArray(statementsArg)).toBe(true);
    expect(statementsArg).toHaveLength(3);
    expect(expectedDatabaseArg).toBe("db1");

    const kinds = (statementsArg as string[]).map(
      (sql) => sql.split(/\s+/)[0]!,
    );
    expect(kinds.filter((k) => k === "UPDATE")).toHaveLength(1);
    expect(kinds.filter((k) => k === "INSERT")).toHaveLength(1);
    expect(kinds.filter((k) => k === "DELETE")).toHaveLength(1);

    // Post-commit cleanup (Sprint 183 contract): pending state cleared,
    // refetch fired once.
    expect(result.current.sqlPreview).toBeNull();
    expect(result.current.pendingEdits.size).toBe(0);
    expect(result.current.pendingNewRows).toHaveLength(0);
    expect(result.current.pendingDeletedRowKeys.size).toBe(0);
    expect(mockFetchData).toHaveBeenCalledTimes(1);
  });

  it("[#444] MySQL preview/discard/commit uses the same quoted key-projected SQL batch", async () => {
    const expectedSql =
      "UPDATE `app-db`.`order detail` SET `select` = 'new' WHERE `user id` = 'O''Brien';";
    const { result } = renderMysqlHook();

    act(() => {
      result.current.handleStartEdit(0, 1, "old");
    });
    act(() => {
      result.current.setEditValue("new");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });

    act(() => {
      result.current.handleCommit();
    });
    expect(result.current.sqlPreview).toEqual([expectedSql]);

    act(() => {
      result.current.handleDiscard();
    });
    expect(result.current.sqlPreview).toBeNull();
    expect(result.current.pendingEdits.size).toBe(0);
    expect(mockExecuteQueryBatch).not.toHaveBeenCalled();

    act(() => {
      result.current.handleStartEdit(0, 1, "old");
    });
    act(() => {
      result.current.setEditValue("new");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });
    act(() => {
      result.current.handleCommit();
    });
    const previewBatch = result.current.sqlPreview;
    expect(previewBatch).toEqual([expectedSql]);

    mockExecuteQueryBatch.mockImplementationOnce((_, stmts: string[]) =>
      happyBatchResolve(stmts),
    );

    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
    expect(mockExecuteQueryBatch.mock.calls[0]?.[1]).toEqual(previewBatch);
    expect(mockExecuteQueryBatch.mock.calls[0]?.[3]).toBe("app-db");
    expect(result.current.sqlPreview).toBeNull();
    expect(result.current.pendingEdits.size).toBe(0);
    expect(mockFetchData).toHaveBeenCalledTimes(1);
  });

  it("[#453] MariaDB preview/discard/commit uses MySQL-family quoted key-projected SQL batch", async () => {
    const expectedSql =
      "UPDATE `app-db`.`order detail` SET `select` = 'new' WHERE `user id` = 'O''Brien';";
    const { result } = renderMariaDbHook();

    act(() => {
      result.current.handleStartEdit(0, 1, "old");
    });
    act(() => {
      result.current.setEditValue("new");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });

    act(() => {
      result.current.handleCommit();
    });
    expect(result.current.sqlPreview).toEqual([expectedSql]);

    act(() => {
      result.current.handleDiscard();
    });
    expect(result.current.sqlPreview).toBeNull();
    expect(result.current.pendingEdits.size).toBe(0);
    expect(mockExecuteQueryBatch).not.toHaveBeenCalled();

    act(() => {
      result.current.handleStartEdit(0, 1, "old");
    });
    act(() => {
      result.current.setEditValue("new");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });
    act(() => {
      result.current.handleCommit();
    });
    const previewBatch = result.current.sqlPreview;
    expect(previewBatch).toEqual([expectedSql]);

    mockExecuteQueryBatch.mockImplementationOnce((_, stmts: string[]) =>
      happyBatchResolve(stmts),
    );

    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
    expect(mockExecuteQueryBatch.mock.calls[0]?.[1]).toEqual(previewBatch);
    expect(mockExecuteQueryBatch.mock.calls[0]?.[3]).toBe("app-db");
    expect(result.current.sqlPreview).toBeNull();
    expect(result.current.pendingEdits.size).toBe(0);
    expect(mockFetchData).toHaveBeenCalledTimes(1);
  });

  it("[#513] MSSQL preview/discard/commit uses bracketed key-projected SQL batch", async () => {
    const expectedSql =
      "UPDATE [dbo].[order detail] SET [select] = 'new' WHERE [user id] = 'O''Brien';";
    const { result } = renderMssqlHook();

    act(() => {
      result.current.handleStartEdit(0, 1, "old");
    });
    act(() => {
      result.current.setEditValue("new");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });

    act(() => {
      result.current.handleCommit();
    });
    expect(result.current.sqlPreview).toEqual([expectedSql]);

    act(() => {
      result.current.handleDiscard();
    });
    expect(result.current.sqlPreview).toBeNull();
    expect(result.current.pendingEdits.size).toBe(0);
    expect(mockExecuteQueryBatch).not.toHaveBeenCalled();

    act(() => {
      result.current.handleStartEdit(0, 1, "old");
    });
    act(() => {
      result.current.setEditValue("new");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });
    act(() => {
      result.current.handleCommit();
    });
    const previewBatch = result.current.sqlPreview;
    expect(previewBatch).toEqual([expectedSql]);

    mockExecuteQueryBatch.mockImplementationOnce((_, stmts: string[]) =>
      happyBatchResolve(stmts),
    );

    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
    expect(mockExecuteQueryBatch.mock.calls[0]?.[1]).toEqual(previewBatch);
    expect(mockExecuteQueryBatch.mock.calls[0]?.[3]).toBe("MssqlApp");
    expect(result.current.sqlPreview).toBeNull();
    expect(result.current.pendingEdits.size).toBe(0);
    expect(mockFetchData).toHaveBeenCalledTimes(1);
  });

  it("[#522] Oracle preview/discard/commit uses double-quoted key-projected SQL batch", async () => {
    const expectedSql = `UPDATE "APP"."ORDER DETAIL" SET "SELECT" = 'new' WHERE "USER ID" = 'O''Brien';`;
    const { result } = renderOracleHook();

    act(() => {
      result.current.handleStartEdit(0, 1, "old");
    });
    act(() => {
      result.current.setEditValue("new");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });

    act(() => {
      result.current.handleCommit();
    });
    expect(result.current.sqlPreview).toEqual([expectedSql]);

    act(() => {
      result.current.handleDiscard();
    });
    expect(result.current.sqlPreview).toBeNull();
    expect(result.current.pendingEdits.size).toBe(0);
    expect(mockExecuteQueryBatch).not.toHaveBeenCalled();

    act(() => {
      result.current.handleStartEdit(0, 1, "old");
    });
    act(() => {
      result.current.setEditValue("new");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });
    act(() => {
      result.current.handleCommit();
    });
    const previewBatch = result.current.sqlPreview;
    expect(previewBatch).toEqual([expectedSql]);

    mockExecuteQueryBatch.mockImplementationOnce((_, stmts: string[]) =>
      happyBatchResolve(stmts),
    );

    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
    expect(mockExecuteQueryBatch.mock.calls[0]?.[1]).toEqual(previewBatch);
    expect(mockExecuteQueryBatch.mock.calls[0]?.[3]).toBe("FREEPDB1");
    expect(result.current.sqlPreview).toBeNull();
    expect(result.current.pendingEdits.size).toBe(0);
    expect(mockFetchData).toHaveBeenCalledTimes(1);
  });

  it("[AC-184-02] Mongo commit dispatches insertOne + updateOne + deleteOne via dispatchMqlCommand without touching executeQueryBatch", async () => {
    // AC-184-02 — same three-mutation regression for the document paradigm.
    // Mongo doesn't have a batch transaction yet (out-of-scope for Phase 22
    // per Sprint 183 findings §4); this test pins that the iterative
    // dispatchMqlCommand path still fires all three primitives, and that
    // the RDB batch helper is never called from the Mongo branch.
    // Date 2026-05-01.
    const { result } = renderDocHook();

    // 1) Pending UPDATE on row 0 ("Ada").
    act(() => {
      result.current.handleStartEdit(0, 1, "Ada");
    });
    act(() => {
      result.current.setEditValue("Ada Lovelace");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });

    // 2) Pending INSERT — duplicate row 1 ("Grace").
    act(() => {
      result.current.handleSelectRow(1, false, false);
    });
    act(() => {
      result.current.handleDuplicateRow();
    });

    // 3) Pending DELETE on row 2 ("Edsger").
    act(() => {
      result.current.handleSelectRow(2, false, false);
    });
    act(() => {
      result.current.handleDeleteRow();
    });

    act(() => {
      result.current.handleCommit();
    });

    expect(result.current.mqlPreview).not.toBeNull();
    expect(result.current.mqlPreview!.commands).toHaveLength(3);

    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    // Sprint 326 — Slice I.1: per-command insert/update/delete IPC 가
    // 단일 bulkWrite 호출로 묶임. 호출 자체는 1 회, ops 배열에 3 종이
    // 모두 들어있는지 확인.
    expect(mockBulkWriteDocuments).toHaveBeenCalledTimes(1);
    const ops = mockBulkWriteDocuments.mock.calls[0]![3] as Array<{
      op: string;
    }>;
    expect(ops.map((o) => o.op).sort()).toEqual([
      "deleteOne",
      "insertOne",
      "updateOne",
    ]);

    // RDB helpers must stay quiet on the Mongo branch.
    expect(mockExecuteQueryBatch).not.toHaveBeenCalled();
    expect(mockExecuteQuery).not.toHaveBeenCalled();

    expect(result.current.mqlPreview).toBeNull();
    expect(result.current.pendingEdits.size).toBe(0);
    expect(result.current.pendingNewRows).toHaveLength(0);
    expect(result.current.pendingDeletedRowKeys.size).toBe(0);
    expect(mockFetchData).toHaveBeenCalledTimes(1);
  });

  // Issue #1358 — mixed-batch (UPDATE + INSERT + DELETE) partial-failure
  // regression. The prior mixed-batch coverage (AC-184-01/02) only exercised
  // the happy path; the sole failure coverage lived in commit-error.test.ts
  // and was UPDATE-only. These two tests pin that when executeQueryBatch
  // rejects mid-batch:
  //   1. the failedKey is routed back to the correct namespace key for the
  //      DELETE (`row-page-idx`) and INSERT (`new-N-0`) statements — the two
  //      namespaces the UPDATE-only failure test never touched, and
  //   2. NONE of the three pending collections (pendingEdits / pendingNewRows
  //      / pendingDeletedRowKeys) are cleared on failure. The whole batch is
  //      atomic + rolled back, so the user's edits must survive so they can
  //      retry or discard. A stray onCommitCleanup() leaking into the failure
  //      branch would silently drop them; this is the guard against that.
  // Date 2026-07-06.
  function stageMixedBatch(result: {
    current: ReturnType<typeof useDataGridEdit>;
  }) {
    // UPDATE row 0 col 1 → key "0-1".
    act(() => {
      result.current.handleStartEdit(0, 1, "Alice");
    });
    act(() => {
      result.current.setEditValue("Alicia");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });
    // INSERT — duplicate row 1 → key "new-0-0".
    act(() => {
      result.current.handleSelectRow(1, false, false);
    });
    act(() => {
      result.current.handleDuplicateRow();
    });
    // DELETE row 2 → key "row-1-2".
    act(() => {
      result.current.handleSelectRow(2, false, false);
    });
    act(() => {
      result.current.handleDeleteRow();
    });
    act(() => {
      result.current.handleCommit();
    });
  }

  it("[#1358] mixed batch: DELETE-statement failure keeps all pending edits + flags the delete row key", async () => {
    const { result } = renderRdbHook();
    stageMixedBatch(result);

    // Sanity — three statements staged, one pending item of each kind.
    expect(result.current.sqlPreview!.length).toBe(3);
    expect(result.current.pendingEdits.size).toBe(1);
    expect(result.current.pendingNewRows).toHaveLength(1);
    expect(result.current.pendingDeletedRowKeys.size).toBe(1);

    // Locate the DELETE statement's 1-based position and reject there so the
    // backend "statement N of 3 failed" index maps back onto the delete item
    // regardless of generator statement ordering.
    const kinds = result.current.sqlPreview!.map((s) => s.split(/\s+/)[0]!);
    const deletePos = kinds.indexOf("DELETE") + 1;
    expect(deletePos).toBeGreaterThan(0);
    mockExecuteQueryBatch.mockImplementationOnce(() =>
      Promise.reject(
        new Error(`statement ${deletePos} of 3 failed: FK violation`),
      ),
    );

    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    // commitError surfaced, pointed at the delete statement.
    expect(result.current.commitError).not.toBeNull();
    expect(result.current.commitError?.statementIndex).toBe(deletePos - 1);
    expect(result.current.commitError?.statementCount).toBe(3);
    expect(result.current.commitError?.message).toMatch(
      /Commit failed — all changes rolled back/,
    );

    // Delete-row namespace key routed into pendingEditErrors.
    expect(result.current.pendingEditErrors.has("row-1-2")).toBe(true);
    expect(result.current.pendingEditErrors.get("row-1-2")).toContain(
      "FK violation",
    );

    // Retention: NONE of the three pending collections cleared on failure.
    expect(result.current.pendingEdits.size).toBe(1);
    expect(result.current.pendingNewRows).toHaveLength(1);
    expect(result.current.pendingDeletedRowKeys.size).toBe(1);
    // Modal stays open with the full batch; no refetch on a rolled-back commit.
    expect(result.current.sqlPreview?.length).toBe(3);
    expect(mockFetchData).not.toHaveBeenCalled();
  });

  it("[#1358] mixed batch: INSERT-statement failure keeps all pending edits + flags the new-row key", async () => {
    const { result } = renderRdbHook();
    stageMixedBatch(result);

    const kinds = result.current.sqlPreview!.map((s) => s.split(/\s+/)[0]!);
    const insertPos = kinds.indexOf("INSERT") + 1;
    expect(insertPos).toBeGreaterThan(0);
    mockExecuteQueryBatch.mockImplementationOnce(() =>
      Promise.reject(
        new Error(`statement ${insertPos} of 3 failed: duplicate key`),
      ),
    );

    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    expect(result.current.commitError?.statementIndex).toBe(insertPos - 1);
    expect(result.current.commitError?.statementCount).toBe(3);

    // New-row namespace key routed into pendingEditErrors.
    expect(result.current.pendingEditErrors.has("new-0-0")).toBe(true);
    expect(result.current.pendingEditErrors.get("new-0-0")).toContain(
      "duplicate key",
    );

    // Retention across all three pending collections.
    expect(result.current.pendingEdits.size).toBe(1);
    expect(result.current.pendingNewRows).toHaveLength(1);
    expect(result.current.pendingDeletedRowKeys.size).toBe(1);
    expect(result.current.sqlPreview?.length).toBe(3);
    expect(mockFetchData).not.toHaveBeenCalled();
  });

  it("[#1440] Mongo partial bulk failure prunes applied inserts and in-modal retry sends only the remaining op", async () => {
    // Reason: issue #1440 — mongo bulk commit is ordered but non-transactional.
    // Scenario from the issue: 3 pending inserts, ops 0-1 applied, op 2 failed.
    // The applied inserts must leave pendingNewRows (AC1), the banner must say
    // how far the batch got (AC3), and a retry must dispatch ONLY the failed
    // op — previously the whole batch was re-sent, duplicating the applied
    // inserts (AC2). Date 2026-07-10.
    const { result } = renderDocHook();
    for (let i = 0; i < 3; i += 1) {
      act(() => {
        result.current.handleSelectRow(1, false, false);
      });
      act(() => {
        result.current.handleDuplicateRow();
      });
    }
    expect(result.current.pendingNewRows).toHaveLength(3);

    act(() => {
      result.current.handleCommit();
    });
    expect(result.current.mqlPreview!.commands).toHaveLength(3);

    mockBulkWriteDocuments.mockRejectedValueOnce(
      new Error("bulk_write op 2 insert_one failed: E11000 duplicate key"),
    );
    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    // AC1 — ops 0,1 applied → pruned from pending; only the failed op stays.
    expect(result.current.pendingNewRows).toHaveLength(1);
    // AC3 — banner points at the failed op and says the applied ops left
    // the pending list.
    expect(result.current.commitError).not.toBeNull();
    expect(result.current.commitError!.statementIndex).toBe(2);
    expect(result.current.commitError!.statementCount).toBe(3);
    expect(result.current.commitError!.message).toMatch(
      /first 2 of 3 operations/,
    );
    expect(result.current.commitError!.message).toMatch(/removed from pending/);
    // Preview stays open as the retry affordance.
    expect(result.current.mqlPreview).not.toBeNull();
    expect(mockFetchData).not.toHaveBeenCalled();

    // AC2 — in-modal retry resumes at the failed op: exactly 1 op dispatched,
    // no duplicate insert of the already-applied documents.
    mockBulkWriteDocuments.mockResolvedValueOnce({
      inserted_count: 1,
      matched_count: 0,
      modified_count: 0,
      deleted_count: 0,
      upserted_ids: [],
    });
    await act(async () => {
      await result.current.handleExecuteCommit();
    });
    expect(mockBulkWriteDocuments).toHaveBeenCalledTimes(2);
    const retryOps = mockBulkWriteDocuments.mock.calls[1]![3] as Array<{
      op: string;
    }>;
    expect(retryOps).toHaveLength(1);
    expect(retryOps[0]!.op).toBe("insertOne");
    // Success path — cleanup + refetch as usual.
    expect(result.current.pendingNewRows).toHaveLength(0);
    expect(result.current.mqlPreview).toBeNull();
    expect(mockFetchData).toHaveBeenCalledTimes(1);
  });

  it("[#1440] Mongo partial failure prunes applied edit/insert namespaces; re-opened preview holds only the remaining delete", async () => {
    // Reason: issue #1440 AC1 across all three pending namespaces (edits /
    // new rows / deletes) + the cancel-then-recommit path: a NEW preview
    // regenerated from the pruned pending state must contain only the ops
    // that never applied. Date 2026-07-10.
    const { result } = renderDocHook();
    // UPDATE row 0 → edit key "0-1".
    act(() => {
      result.current.handleStartEdit(0, 1, "Ada");
    });
    act(() => {
      result.current.setEditValue("Ada Lovelace");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });
    // INSERT — duplicate row 1 ("Grace").
    act(() => {
      result.current.handleSelectRow(1, false, false);
    });
    act(() => {
      result.current.handleDuplicateRow();
    });
    // DELETE row 2 → delete key "row-1-2".
    act(() => {
      result.current.handleSelectRow(2, false, false);
    });
    act(() => {
      result.current.handleDeleteRow();
    });
    act(() => {
      result.current.handleCommit();
    });
    // Generator contract: insert → update → delete.
    expect(result.current.mqlPreview!.commands.map((c) => c.kind)).toEqual([
      "insertOne",
      "updateOne",
      "deleteOne",
    ]);

    // insert + update applied, delete (op 2) failed.
    mockBulkWriteDocuments.mockRejectedValueOnce(
      new Error("bulk_write op 2 delete_one failed: write concern timeout"),
    );
    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    expect(result.current.pendingEdits.size).toBe(0);
    expect(result.current.pendingNewRows).toHaveLength(0);
    expect(result.current.pendingDeletedRowKeys.size).toBe(1);

    // Cancel the stale preview and re-commit — only the failed delete remains.
    act(() => {
      result.current.setMqlPreview(null);
    });
    act(() => {
      result.current.handleCommit();
    });
    expect(result.current.mqlPreview!.commands).toHaveLength(1);
    expect(result.current.mqlPreview!.commands[0]!.kind).toBe("deleteOne");
  });

  it("[AC-184-03] RDB 100-edit handleCommit completes under 1000ms with 100 UPDATE statements", () => {
    // AC-184-03 — perf smoke. Crude wall-clock budget guards against an
    // O(N²) regression in generateSqlWithKeys; on a healthy machine this
    // runs in ~10–30ms. The 1s ceiling absorbs CI runner jitter.
    // Date 2026-05-01.
    const fixture = buildLargeRdbFixture(100);
    const { result } = renderRdbHook(fixture);

    // Queue 100 pending edits — one per row, on the "name" column.
    for (let i = 0; i < 100; i += 1) {
      act(() => {
        result.current.handleStartEdit(i, 1, `name-${i + 1}`);
      });
      act(() => {
        result.current.setEditValue(`renamed-${i + 1}`);
      });
      act(() => {
        result.current.saveCurrentEdit();
      });
    }
    expect(result.current.pendingEdits.size).toBe(100);

    const start = performance.now();
    act(() => {
      result.current.handleCommit();
    });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1000);
    expect(result.current.sqlPreview).not.toBeNull();
    expect(result.current.sqlPreview!.length).toBe(100);
    for (const sql of result.current.sqlPreview!) {
      expect(sql.startsWith("UPDATE ")).toBe(true);
    }
  });

  it("[AC-184-04] RDB 100-delete handleCommit completes under 1000ms with 100 DELETE statements", () => {
    // AC-184-04 — perf smoke for the delete path.
    // Date 2026-05-01.
    const fixture = buildLargeRdbFixture(100);
    const { result } = renderRdbHook(fixture);

    // Select all 100 rows via Cmd+click accumulation, then delete.
    for (let i = 0; i < 100; i += 1) {
      act(() => {
        result.current.handleSelectRow(i, true, false);
      });
    }
    expect(result.current.selectedRowIds.size).toBe(100);

    act(() => {
      result.current.handleDeleteRow();
    });
    expect(result.current.pendingDeletedRowKeys.size).toBe(100);

    const start = performance.now();
    act(() => {
      result.current.handleCommit();
    });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1000);
    expect(result.current.sqlPreview).not.toBeNull();
    expect(result.current.sqlPreview!.length).toBe(100);
    for (const sql of result.current.sqlPreview!) {
      expect(sql.startsWith("DELETE FROM ")).toBe(true);
    }
  });

  it("[AC-184-05] RDB 100-insert handleCommit completes under 1000ms with 100 INSERT statements", () => {
    // AC-184-05 — perf smoke for the insert path. To skip the per-cell
    // setup cost (handleStartEdit × 100 × column-count would dominate the
    // measurement) we duplicate a single seed row 100 times — pendingNewRows
    // ends up with 100 fully-populated copies. Same PK across all copies is
    // fine because the test only exercises SQL *generation*, not execution.
    // Date 2026-05-01.
    const fixture = buildLargeRdbFixture(1);
    const { result } = renderRdbHook(fixture);

    // Select the seed row, then duplicate 100 times.
    act(() => {
      result.current.handleSelectRow(0, false, false);
    });
    for (let i = 0; i < 100; i += 1) {
      // Each duplicate clears selection (handleDuplicateRow side-effect),
      // so re-select before the next duplicate. Cheaper than inflating the
      // fixture to N rows + multi-select.
      act(() => {
        result.current.handleSelectRow(0, false, false);
      });
      act(() => {
        result.current.handleDuplicateRow();
      });
    }
    expect(result.current.pendingNewRows).toHaveLength(100);

    const start = performance.now();
    act(() => {
      result.current.handleCommit();
    });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1000);
    expect(result.current.sqlPreview).not.toBeNull();
    expect(result.current.sqlPreview!.length).toBe(100);
    for (const sql of result.current.sqlPreview!) {
      expect(sql.startsWith("INSERT INTO ")).toBe(true);
    }
  });
});
