import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDataGridEdit } from "./useDataGridEdit";
import type { TableData } from "@/types/schema";

// Sprint 86 — document paradigm dispatch tests. These exercise the MQL
// generator + Tauri wrapper branch introduced in `handleCommit` /
// `handleExecuteCommit`. The Tauri module is mocked so tests never reach
// the real bridge; we assert that each command kind fans out to the right
// wrapper with the payload the generator produced.

const mockInsertDocument = vi.fn<(...args: unknown[]) => Promise<unknown>>(() =>
  Promise.resolve({ ObjectId: "507f1f77bcf86cd799439099" }),
);
const mockUpdateDocument = vi.fn<(...args: unknown[]) => Promise<void>>(() =>
  Promise.resolve(),
);
const mockDeleteDocument = vi.fn<(...args: unknown[]) => Promise<void>>(() =>
  Promise.resolve(),
);
const mockExecuteQuery = vi.fn();
const mockFetchData = vi.fn();

vi.mock("@/lib/tauri", () => ({
  insertDocument: (...args: unknown[]) => mockInsertDocument(...args),
  updateDocument: (...args: unknown[]) => mockUpdateDocument(...args),
  deleteDocument: (...args: unknown[]) => mockDeleteDocument(...args),
}));

vi.mock("@stores/schemaStore", () => ({
  useSchemaStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ executeQuery: mockExecuteQuery }),
}));

vi.mock("@stores/tabStore", () => ({
  useTabStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      activeTabId: "tab-1",
      promoteTab: vi.fn(),
      setTabDirty: vi.fn(),
    }),
}));

const HEX_A = "507f1f77bcf86cd799439011";
const HEX_B = "507f1f77bcf86cd799439022";

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
    {
      name: "age",
      data_type: "int",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
  ],
  rows: [
    [{ $oid: HEX_A }, "Ada", 36],
    [{ $oid: HEX_B }, "Grace", 55],
  ],
  total_count: 2,
  page: 1,
  page_size: 100,
  executed_query: "db.users.find({})",
};

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

describe("useDataGridEdit — document paradigm (Sprint 86)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handleStartEdit opens the editor for document grids (no-op guard removed)", () => {
    const { result } = renderDocHook();

    act(() => {
      result.current.handleStartEdit(0, 1, "Ada");
    });

    expect(result.current.editingCell).toEqual({ row: 0, col: 1 });
    expect(result.current.editValue).toBe("Ada");
  });

  it("saveCurrentEdit accumulates pending edits for document paradigm", () => {
    const { result } = renderDocHook();

    act(() => {
      result.current.handleStartEdit(0, 1, "Ada");
    });
    act(() => {
      result.current.setEditValue("Ada Lovelace");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });

    expect(result.current.pendingEdits.get("0-1")).toBe("Ada Lovelace");
    expect(result.current.hasPendingChanges).toBe(true);
  });

  it("handleCommit populates mqlPreview with updateOne command for document paradigm", () => {
    const { result } = renderDocHook();

    act(() => {
      result.current.handleStartEdit(0, 1, "Ada");
    });
    act(() => {
      result.current.setEditValue("Ada Lovelace");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });
    act(() => {
      result.current.handleCommit();
    });

    const preview = result.current.mqlPreview;
    expect(preview).not.toBeNull();
    expect(preview!.previewLines).toEqual([
      `db.users.updateOne({ _id: ObjectId("${HEX_A}") }, { $set: { name: "Ada Lovelace" } })`,
    ]);
    expect(preview!.commands).toEqual([
      {
        kind: "updateOne",
        database: "app",
        collection: "users",
        documentId: { ObjectId: HEX_A },
        patch: { name: "Ada Lovelace" },
      },
    ]);
    // sqlPreview remains null for the document paradigm so Sprint 87 can
    // branch the preview modal on paradigm without ambiguity.
    expect(result.current.sqlPreview).toBeNull();
  });

  it("handleExecuteCommit dispatches mqlPreview commands in order and clears state on success", async () => {
    const { result } = renderDocHook();

    // Queue one updateOne and one deleteOne.
    act(() => {
      result.current.handleStartEdit(0, 1, "Ada");
    });
    act(() => {
      result.current.setEditValue("Ada L.");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });
    act(() => {
      result.current.handleSelectRow(1, false, false);
    });
    act(() => {
      result.current.handleDeleteRow();
    });
    act(() => {
      result.current.handleCommit();
    });

    expect(result.current.mqlPreview).not.toBeNull();

    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    expect(mockUpdateDocument).toHaveBeenCalledTimes(1);
    expect(mockUpdateDocument).toHaveBeenCalledWith(
      "conn-mongo",
      "app",
      "users",
      { ObjectId: HEX_A },
      { name: "Ada L." },
    );
    expect(mockDeleteDocument).toHaveBeenCalledTimes(1);
    expect(mockDeleteDocument).toHaveBeenCalledWith(
      "conn-mongo",
      "app",
      "users",
      { ObjectId: HEX_B },
    );
    // Post-success cleanup: preview cleared, pending maps reset, editor
    // closed, fetchData called once to refresh the grid.
    expect(result.current.mqlPreview).toBeNull();
    expect(result.current.pendingEdits.size).toBe(0);
    expect(result.current.pendingDeletedRowKeys.size).toBe(0);
    expect(result.current.editingCell).toBeNull();
    expect(result.current.editValue).toBe("");
    expect(mockFetchData).toHaveBeenCalledTimes(1);
    expect(mockExecuteQuery).not.toHaveBeenCalled();
  });

  it("handleExecuteCommit preserves pending state on dispatch failure", async () => {
    mockUpdateDocument.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderDocHook();

    act(() => {
      result.current.handleStartEdit(0, 1, "Ada");
    });
    act(() => {
      result.current.setEditValue("Ada L.");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });
    act(() => {
      result.current.handleCommit();
    });

    const previewBeforeFailure = result.current.mqlPreview;
    expect(previewBeforeFailure).not.toBeNull();

    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    // Failure path mirrors the RDB branch: pending state stays intact so
    // the user can re-open the preview, fetchData is NOT called.
    expect(result.current.mqlPreview).toBe(previewBeforeFailure);
    expect(result.current.pendingEdits.size).toBe(1);
    expect(mockFetchData).not.toHaveBeenCalled();
  });

  it("handleCommit surfaces generator errors without opening a preview when every row is invalid", () => {
    const { result } = renderDocHook();

    // Edit the `_id` column — should surface id-in-patch and drop the row.
    act(() => {
      result.current.handleStartEdit(0, 0, "bad");
    });
    act(() => {
      result.current.setEditValue("mutated");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });
    act(() => {
      result.current.handleCommit();
    });

    // No preview opened (no valid commands), pendingEdits retained so the
    // user can correct the mistake. We don't assert on errors state here
    // because Sprint 87 will wire the generator errors into UI; Sprint 86's
    // contract only requires no bad preview reaches the modal.
    expect(result.current.mqlPreview).toBeNull();
    expect(result.current.pendingEdits.get("0-0")).toBe("mutated");
  });

  it("handleDiscard clears mqlPreview along with the rest of the pending state", () => {
    const { result } = renderDocHook();

    act(() => {
      result.current.handleStartEdit(0, 1, "Ada");
    });
    act(() => {
      result.current.setEditValue("Ada L.");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });
    act(() => {
      result.current.handleCommit();
    });
    expect(result.current.mqlPreview).not.toBeNull();

    act(() => {
      result.current.handleDiscard();
    });

    expect(result.current.mqlPreview).toBeNull();
    expect(result.current.pendingEdits.size).toBe(0);
    expect(result.current.hasPendingChanges).toBe(false);
  });
});
