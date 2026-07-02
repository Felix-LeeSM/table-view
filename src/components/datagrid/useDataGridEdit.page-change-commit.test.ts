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
import { useDataGridEditStore } from "@stores/dataGridEditStore";
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

const RDB_COLUMNS = [col("id", "integer", true), col("name", "text")];

const RDB_PAGE1: TableData = {
  columns: RDB_COLUMNS,
  rows: [
    [1, "Alice"],
    [2, "Bob"],
    [3, "Carol"],
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
    [40, "Dave"],
    [50, "Eve"],
    [60, "Frank"],
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

const DOC_COLUMNS = [col("_id", "objectId", true), col("name", "string")];

const DOC_PAGE1: TableData = {
  columns: DOC_COLUMNS,
  rows: [
    [{ $oid: HEX_A }, "Ada"],
    [{ $oid: HEX_B }, "Grace"],
  ],
  total_count: 4,
  page: 1,
  page_size: 2,
  executed_query: "db.users.find({})",
};

const DOC_PAGE2: TableData = {
  columns: DOC_COLUMNS,
  rows: [
    [{ $oid: HEX_C }, "Linus"],
    [{ $oid: HEX_D }, "Dennis"],
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
    expect(sql).toContain("WHERE id = 3;");
    expect(sql).not.toContain("60");
    expect(sql).toContain("Caroline");
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
    expect(sql).not.toContain("50");
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
});
