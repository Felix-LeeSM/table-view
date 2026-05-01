import { describe, it, expect, vi, beforeEach } from "vitest";
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
  Promise.resolve({ ObjectId: "507f1f77bcf86cd799439099" }),
);
const mockUpdateDocument = vi.fn<(...args: unknown[]) => Promise<void>>(() =>
  Promise.resolve(),
);
const mockDeleteDocument = vi.fn<(...args: unknown[]) => Promise<void>>(() =>
  Promise.resolve(),
);
const mockFetchData = vi.fn();

vi.mock("@/lib/tauri", () => ({
  insertDocument: (...args: unknown[]) => mockInsertDocument(...args),
  updateDocument: (...args: unknown[]) => mockUpdateDocument(...args),
  deleteDocument: (...args: unknown[]) => mockDeleteDocument(...args),
}));

vi.mock("@stores/schemaStore", () => ({
  useSchemaStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      executeQuery: mockExecuteQuery,
      executeQueryBatch: mockExecuteQueryBatch,
    }),
}));

vi.mock("@stores/tabStore", () => ({
  useTabStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      activeTabId: "tab-1",
      promoteTab: vi.fn(),
      setTabDirty: vi.fn(),
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
      schema: "public",
      table: "users",
      connectionId: "conn-pg",
      page: 1,
      fetchData: mockFetchData,
    }),
  );
}

function renderDocHook() {
  return renderHook(() =>
    useDataGridEdit({
      data: DOC_DATA,
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
    mockInsertDocument.mockResolvedValue({
      ObjectId: "507f1f77bcf86cd799439099",
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

    const [, statementsArg] = mockExecuteQueryBatch.mock.calls[0]!;
    expect(Array.isArray(statementsArg)).toBe(true);
    expect(statementsArg).toHaveLength(3);

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

    expect(mockInsertDocument).toHaveBeenCalledTimes(1);
    expect(mockUpdateDocument).toHaveBeenCalledTimes(1);
    expect(mockDeleteDocument).toHaveBeenCalledTimes(1);

    // RDB helpers must stay quiet on the Mongo branch.
    expect(mockExecuteQueryBatch).not.toHaveBeenCalled();
    expect(mockExecuteQuery).not.toHaveBeenCalled();

    expect(result.current.mqlPreview).toBeNull();
    expect(result.current.pendingEdits.size).toBe(0);
    expect(result.current.pendingNewRows).toHaveLength(0);
    expect(result.current.pendingDeletedRowKeys.size).toBe(0);
    expect(mockFetchData).toHaveBeenCalledTimes(1);
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
