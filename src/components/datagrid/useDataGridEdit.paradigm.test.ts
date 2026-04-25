import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDataGridEdit } from "./useDataGridEdit";
import type { TableData } from "@/types/schema";

const mockExecuteQuery = vi.fn();
const mockFetchData = vi.fn();

vi.mock("@stores/schemaStore", () => ({
  useSchemaStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ executeQuery: mockExecuteQuery }),
}));

vi.mock("@stores/tabStore", () => ({
  useTabStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ activeTabId: "tab-1", promoteTab: vi.fn() }),
}));

const MOCK_DATA: TableData = {
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
    [1, "Ada"],
    [2, "Grace"],
  ],
  total_count: 2,
  page: 1,
  page_size: 100,
  executed_query: "db.users.find({})",
};

describe("useDataGridEdit — document paradigm edit permission (Sprint 86)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Sprint 66 used to assert a no-op for the document paradigm. Sprint 86
  // removes that guard because the hook now routes document edits through
  // the MQL generator + Tauri mutate wrappers, so `handleStartEdit` must
  // open an editor for document grids identically to RDB grids. This case
  // preserves the original intent (the default parameter path stays
  // backward-compatible) while documenting the behaviour change.
  it("handleStartEdit sets editingCell/editValue when paradigm === 'document'", () => {
    const { result } = renderHook(() =>
      useDataGridEdit({
        data: MOCK_DATA,
        schema: "app",
        table: "users",
        connectionId: "conn-mongo",
        page: 1,
        fetchData: mockFetchData,
        paradigm: "document",
      }),
    );

    act(() => {
      result.current.handleStartEdit(0, 1, "Ada");
    });

    expect(result.current.editingCell).toEqual({ row: 0, col: 1 });
    expect(result.current.editValue).toBe("Ada");
    // Editor is open, no edit has been saved yet.
    expect(result.current.pendingEdits.size).toBe(0);
  });

  it("handleStartEdit still works when paradigm is omitted (defaults to rdb)", () => {
    const { result } = renderHook(() =>
      useDataGridEdit({
        data: MOCK_DATA,
        schema: "public",
        table: "users",
        connectionId: "conn-pg",
        page: 1,
        fetchData: mockFetchData,
      }),
    );

    act(() => {
      result.current.handleStartEdit(0, 1, "Ada");
    });

    expect(result.current.editingCell).toEqual({ row: 0, col: 1 });
    expect(result.current.editValue).toBe("Ada");
  });
});
