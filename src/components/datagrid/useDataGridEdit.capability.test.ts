import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDataGridEdit } from "./useDataGridEdit";
import type { TableData } from "@/types/schema";

const mockFetchData = vi.fn();
const mockPromoteTab = vi.fn();
const mockSetTabDirty = vi.fn();

vi.mock("@stores/workspaceStore", () => ({
  useActiveTabId: () => "tab-1",
  useCurrentWorkspaceKey: () => ({ connId: "conn-sqlite", db: "main" }),
  useWorkspaceStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      promoteTab: mockPromoteTab,
      setTabDirty: mockSetTabDirty,
    }),
}));

const DATA: TableData = {
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
  ],
  total_count: 2,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM users LIMIT 100 OFFSET 0",
};

function renderEditHook(canEditRows: boolean) {
  return renderHook(() =>
    useDataGridEdit({
      data: DATA,
      database: "main",
      schema: "main",
      table: "users",
      connectionId: "conn-sqlite",
      page: 1,
      fetchData: mockFetchData,
      canEditRows,
    }),
  );
}

describe("useDataGridEdit row edit capability gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks edit/add/delete/duplicate/commit when editRows is false", () => {
    const { result } = renderEditHook(false);

    act(() => {
      result.current.handleStartEdit(0, 1, "Alice");
    });
    expect(result.current.editingCell).toBeNull();

    act(() => {
      result.current.handleAddRow();
    });
    expect(result.current.pendingNewRows).toHaveLength(0);

    act(() => {
      result.current.handleSelectRow(0, false, false);
    });
    act(() => {
      result.current.handleDeleteRow();
    });
    expect(result.current.pendingDeletedRowKeys.size).toBe(0);

    act(() => {
      result.current.handleDuplicateRow();
    });
    expect(result.current.pendingNewRows).toHaveLength(0);

    act(() => {
      result.current.setPendingEdits(new Map([["0-1", "Alicia"]]));
    });
    act(() => {
      result.current.handleCommit();
    });

    expect(result.current.sqlPreview).toBeNull();
    expect(result.current.hasPendingChanges).toBe(false);
    expect(mockPromoteTab).not.toHaveBeenCalled();
  });
});
