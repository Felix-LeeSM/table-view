// Issue #1081 (P1 data safety) — pending edits/deletes must commit against
// the row they were made on, not the row that happens to share the same
// grid index after the user paginates away.
//
// User journey (RDB + Mongo):
//   1. Open a paginated table on page 1.
//   2. Edit (or mark-delete) the 3rd/2nd visible row on page 1.
//   3. Navigate to page 2 — the pending buffer survives (Sprint 251), but
//      `data.rows` now holds page 2's rows.
//   4. Cmd+S commit.
//
// Before the fix, the commit builder read the WHERE-clause PK / `_id` from
// the CURRENT page's `data.rows[rowIdx]`, so the UPDATE/DELETE silently hit
// the wrong row on page 2. These tests assert the emitted statement targets
// the ORIGINAL page-1 row identity.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { renderHook, act } from "@testing-library/react";
import { useDataGridEdit } from "./useDataGridEdit";
import { useDataGridEditStore, entryKey } from "@stores/dataGridEditStore";
import type { TableData } from "@/types/schema";

const { mockExecuteQuery, mockExecuteQueryBatch } = vi.hoisted(() => ({
  mockExecuteQuery: vi.fn(),
  mockExecuteQueryBatch: vi.fn(),
}));
const mockBulkWriteDocuments = vi.fn<(...args: unknown[]) => Promise<unknown>>(
  () =>
    Promise.resolve({
      inserted_count: 0,
      matched_count: 1,
      modified_count: 1,
      deleted_count: 0,
      upserted_ids: [],
    }),
);
const mockFetchData = vi.fn();

function installTauri() {
  setupTauriMock({
    executeQuery: (...a: unknown[]) => mockExecuteQuery(...a),
    executeQueryBatch: (...a: unknown[]) => mockExecuteQueryBatch(...a),
    bulkWriteDocuments: (...a: unknown[]) => mockBulkWriteDocuments(...a),
  });
}

vi.mock("@stores/workspaceStore", () => ({
  useActiveTabId: () => "tab-1",
  useCurrentWorkspaceKey: () => ({ connId: "conn1", db: "db1" }),
  useWorkspaceStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ promoteTab: vi.fn(), setTabDirty: vi.fn() }),
}));

function col(name: string, dataType: string, pk = false) {
  return {
    name,
    data_type: dataType,
    nullable: !pk,
    default_value: null,
    is_primary_key: pk,
    is_foreign_key: false,
    fk_reference: null,
    comment: null,
  };
}

const RDB_COLUMNS = [
  col("id", "integer", true),
  col("name", "text"),
  col("age", "integer"),
];

const RDB_PAGE1: TableData = {
  columns: RDB_COLUMNS,
  rows: [
    [1, "Alice", 11],
    [2, "Bob", 22],
    [3, "Carol", 33],
  ],
  total_count: 6,
  page: 1,
  page_size: 3,
  executed_query: "SELECT * FROM public.users LIMIT 3 OFFSET 0",
};

// Same grid indices, entirely different rows/PKs — this is what makes the
// index-vs-identity bug observable.
const RDB_PAGE2: TableData = {
  columns: RDB_COLUMNS,
  rows: [
    [40, "Dave", 44],
    [50, "Eve", 55],
    [60, "Frank", 66],
  ],
  total_count: 6,
  page: 2,
  page_size: 3,
  executed_query: "SELECT * FROM public.users LIMIT 3 OFFSET 3",
};

const HEX_A = "507f1f77bcf86cd799439011";
const HEX_B = "507f1f77bcf86cd799439022";
const HEX_C = "507f1f77bcf86cd799439033";
const HEX_D = "507f1f77bcf86cd799439044";

const DOC_COLUMNS = [
  col("_id", "objectId", true),
  col("name", "string"),
  col("age", "int"),
];

const DOC_PAGE1: TableData = {
  columns: DOC_COLUMNS,
  rows: [
    [{ $oid: HEX_A }, "Ada", 1],
    [{ $oid: HEX_B }, "Grace", 2],
  ],
  total_count: 4,
  page: 1,
  page_size: 2,
  executed_query: "db.users.find({})",
};

const DOC_PAGE2: TableData = {
  columns: DOC_COLUMNS,
  rows: [
    [{ $oid: HEX_C }, "Linus", 3],
    [{ $oid: HEX_D }, "Dennis", 4],
  ],
  total_count: 4,
  page: 2,
  page_size: 2,
  executed_query: "db.users.find({})",
};

function renderRdb(data: TableData, page: number) {
  return renderHook(
    ({ data, page }: { data: TableData; page: number }) =>
      useDataGridEdit({
        data,
        database: "db1",
        schema: "public",
        table: "users",
        connectionId: "conn1",
        page,
        fetchData: mockFetchData,
      }),
    { initialProps: { data, page } },
  );
}

function renderDoc(data: TableData, page: number) {
  return renderHook(
    ({ data, page }: { data: TableData; page: number }) =>
      useDataGridEdit({
        data,
        database: "app",
        schema: "app",
        table: "users",
        connectionId: "conn-mongo",
        page,
        paradigm: "document",
        fetchData: mockFetchData,
      }),
    { initialProps: { data, page } },
  );
}

describe("useDataGridEdit — issue #1081 page-change commit targets original row", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installTauri();
    useDataGridEditStore.setState({ entries: new Map() });
  });

  it("[RDB UPDATE] edit on page 1 then commit on page 2 → UPDATE hits page-1 PK", async () => {
    mockExecuteQueryBatch.mockImplementationOnce((_c, stmts) =>
      Promise.resolve((stmts as string[]).map(() => ({}))),
    );
    const { result, rerender } = renderRdb(RDB_PAGE1, 1);

    // Edit the 3rd row on page 1 (id=3, Carol).
    act(() => result.current.handleStartEdit(2, 1, "Carol"));
    act(() => result.current.setEditValue("Caroline"));
    act(() => result.current.saveCurrentEdit());

    // Navigate to page 2 — pending edit survives, data.rows now = page 2.
    rerender({ data: RDB_PAGE2, page: 2 });

    act(() => result.current.handleCommit());
    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
    const stmts = mockExecuteQueryBatch.mock.calls[0]![1] as string[];
    const sql = stmts.join("\n");
    // Must target page-1 Carol (id=3), NOT page-2 Frank (id=60).
    expect(sql).toContain("SET name = 'Caroline' WHERE id = 3;");
    expect(sql).not.toContain("id = 60");
  });

  it("[RDB DELETE] mark-delete on page 1 then commit on page 2 → DELETE hits page-1 PK", async () => {
    mockExecuteQueryBatch.mockImplementationOnce((_c, stmts) =>
      Promise.resolve((stmts as string[]).map(() => ({}))),
    );
    const { result, rerender } = renderRdb(RDB_PAGE1, 1);

    // Mark-delete the 2nd row on page 1 (id=2, Bob).
    act(() => result.current.handleSelectRow(1, false, false));
    act(() => result.current.handleDeleteRow());

    rerender({ data: RDB_PAGE2, page: 2 });

    act(() => result.current.handleCommit());
    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    const stmts = mockExecuteQueryBatch.mock.calls[0]![1] as string[];
    const sql = stmts.join("\n");
    // Must target page-1 Bob (id=2), NOT page-2 Eve (id=50).
    expect(sql).toContain("DELETE FROM public.users WHERE id = 2;");
    expect(sql).not.toContain("id = 50");
  });

  it("[Mongo UPDATE] edit on page 1 then commit on page 2 → updateOne hits page-1 _id", async () => {
    const { result, rerender } = renderDoc(DOC_PAGE1, 1);

    // Edit the 1st document on page 1 (_id = HEX_A, Ada).
    act(() => result.current.handleStartEdit(0, 1, "Ada"));
    act(() => result.current.setEditValue("Ada Lovelace"));
    act(() => result.current.saveCurrentEdit());

    rerender({ data: DOC_PAGE2, page: 2 });

    act(() => result.current.handleCommit());
    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    expect(mockBulkWriteDocuments).toHaveBeenCalledTimes(1);
    const ops = mockBulkWriteDocuments.mock.calls[0]![3] as Array<{
      op: string;
      filter: { _id: { $oid: string } };
    }>;
    // Must target page-1 Ada (_id=HEX_A), NOT page-2 index-0 Linus (HEX_C).
    expect(ops[0]!.filter._id).toEqual({ $oid: HEX_A });
  });

  it("[Mongo DELETE] mark-delete on page 1 then commit on page 2 → deleteOne hits page-1 _id", async () => {
    const { result, rerender } = renderDoc(DOC_PAGE1, 1);

    // Mark-delete the 2nd document on page 1 (_id = HEX_B, Grace).
    act(() => result.current.handleSelectRow(1, false, false));
    act(() => result.current.handleDeleteRow());

    rerender({ data: DOC_PAGE2, page: 2 });

    act(() => result.current.handleCommit());
    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    const ops = mockBulkWriteDocuments.mock.calls[0]![3] as Array<{
      op: string;
      filter: { _id: { $oid: string } };
    }>;
    // Must target page-1 Grace (_id=HEX_B), NOT page-2 index-1 Dennis (HEX_D).
    expect(ops[0]!.filter._id).toEqual({ $oid: HEX_B });
  });

  // Blocking 1 — the snapshot must share `pendingEdits`'s collision domain
  // (cell key), not the coarser rowIdx. Editing the same visual row index on
  // two pages but DIFFERENT columns must not let one page's snapshot clobber
  // the other → each edit keeps its own row identity.
  it("[RDB cross-column] page-1 name + page-2 age on the same row index → each UPDATE keeps its own page PK", async () => {
    mockExecuteQueryBatch.mockImplementationOnce((_c, stmts) =>
      Promise.resolve((stmts as string[]).map(() => ({}))),
    );
    const { result, rerender } = renderRdb(RDB_PAGE1, 1);

    // page 1, row index 1 (id=2, Bob) → edit name.
    act(() => result.current.handleStartEdit(1, 1, "Bob"));
    act(() => result.current.setEditValue("Bobby"));
    act(() => result.current.saveCurrentEdit());

    // page 2, SAME row index 1 (id=50, Eve) → edit age (different column).
    rerender({ data: RDB_PAGE2, page: 2 });
    act(() => result.current.handleStartEdit(1, 2, "55"));
    act(() => result.current.setEditValue("500"));
    act(() => result.current.saveCurrentEdit());

    act(() => result.current.handleCommit());
    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    const stmts = mockExecuteQueryBatch.mock.calls[0]![1] as string[];
    const sql = stmts.join("\n");
    // name edit belongs to page-1 Bob (id=2); age edit to page-2 Eve (id=50).
    expect(sql).toContain("SET name = 'Bobby' WHERE id = 2;");
    expect(sql).toContain("SET age = 500 WHERE id = 50;");
    // The page-1 name edit must NOT be written against the page-2 PK.
    expect(sql).not.toContain("SET name = 'Bobby' WHERE id = 50;");
  });

  it("[Mongo cross-column] page-1 name + page-2 age on the same row index → two updateOne, each own _id", async () => {
    const { result, rerender } = renderDoc(DOC_PAGE1, 1);

    // page 1, row index 0 (_id=HEX_A, Ada) → edit name.
    act(() => result.current.handleStartEdit(0, 1, "Ada"));
    act(() => result.current.setEditValue("Ada Lovelace"));
    act(() => result.current.saveCurrentEdit());

    // page 2, SAME row index 0 (_id=HEX_C, Linus) → edit age.
    rerender({ data: DOC_PAGE2, page: 2 });
    act(() => result.current.handleStartEdit(0, 2, "3"));
    act(() => result.current.setEditValue("300"));
    act(() => result.current.saveCurrentEdit());

    act(() => result.current.handleCommit());
    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    const ops = mockBulkWriteDocuments.mock.calls[0]![3] as Array<{
      op: string;
      filter: { _id: { $oid: string } };
      update?: { $set?: Record<string, unknown> };
    }>;
    const nameOp = ops.find((o) => o.update?.$set?.name !== undefined);
    const ageOp = ops.find((o) => o.update?.$set?.age !== undefined);
    // name → page-1 Ada (_id=HEX_A); age → page-2 Linus (_id=HEX_C).
    expect(nameOp?.filter._id).toEqual({ $oid: HEX_A });
    expect(ageOp?.filter._id).toEqual({ $oid: HEX_C });
  });

  // Blocking 2 — undo must restore the row-identity snapshots too, otherwise
  // an orphan snapshot outlives the pending edit it anchored.
  it("[undo] restores the row-identity snapshot alongside the pending edit", () => {
    const key = entryKey("conn1", "db1", "public", "users");
    const { result } = renderRdb(RDB_PAGE1, 1);

    act(() => result.current.handleStartEdit(2, 1, "Carol"));
    act(() => result.current.setEditValue("Caroline"));
    act(() => result.current.saveCurrentEdit());
    expect(
      useDataGridEditStore.getState().getEntry(key).pendingEditRowSnapshots
        .size,
    ).toBe(1);

    act(() => result.current.undo());
    expect(result.current.pendingEdits.size).toBe(0);
    expect(
      useDataGridEditStore.getState().getEntry(key).pendingEditRowSnapshots
        .size,
    ).toBe(0);
  });

  it("[discard] clears the row-identity snapshots", () => {
    const key = entryKey("conn1", "db1", "public", "users");
    const { result } = renderRdb(RDB_PAGE1, 1);

    act(() => result.current.handleStartEdit(2, 1, "Carol"));
    act(() => result.current.setEditValue("Caroline"));
    act(() => result.current.saveCurrentEdit());
    act(() => result.current.handleSelectRow(0, false, false));
    act(() => result.current.handleDeleteRow());

    act(() => result.current.handleDiscard());
    const entry = useDataGridEditStore.getState().getEntry(key);
    expect(entry.pendingEditRowSnapshots.size).toBe(0);
    expect(entry.pendingDeletedRowSnapshots.size).toBe(0);
  });
});
