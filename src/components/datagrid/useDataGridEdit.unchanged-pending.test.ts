import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDataGridEdit } from "./useDataGridEdit";
import type { TableData } from "../../types/schema";

const mockExecuteQuery = vi.fn();
const mockFetchData = vi.fn();

vi.mock("../../stores/schemaStore", () => ({
  useSchemaStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ executeQuery: mockExecuteQuery }),
}));

vi.mock("../../stores/tabStore", () => ({
  useTabStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ activeTabId: "tab-1", promoteTab: vi.fn() }),
}));

const MOCK_DATA: TableData = {
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
    {
      name: "meta",
      data_type: "jsonb",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
  ],
  rows: [
    [1, "Alice", { tag: "x" }],
    [2, null, null],
  ],
  total_count: 2,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM public.users LIMIT 100 OFFSET 0",
};

function renderEditHook() {
  return renderHook(() =>
    useDataGridEdit({
      data: MOCK_DATA,
      schema: "public",
      table: "users",
      connectionId: "conn1",
      page: 1,
      fetchData: mockFetchData,
    }),
  );
}

describe("useDataGridEdit — unchanged value should not become a pending edit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saveCurrentEdit does NOT add a pending edit when the value is unchanged", () => {
    const { result } = renderEditHook();
    // Open editor for "Alice" (row 0, col 1) but don't change anything
    act(() => {
      result.current.handleStartEdit(0, 1, "Alice");
    });
    expect(result.current.editValue).toBe("Alice");

    act(() => {
      result.current.saveCurrentEdit();
    });

    expect(result.current.pendingEdits.size).toBe(0);
    expect(result.current.hasPendingChanges).toBe(false);
  });

  it("saveCurrentEdit removes an existing pending edit when value reverts to original", () => {
    const { result } = renderEditHook();
    // First create a real pending edit
    act(() => {
      result.current.handleStartEdit(0, 1, "Alice");
    });
    act(() => {
      result.current.setEditValue("Alicia");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });
    expect(result.current.pendingEdits.size).toBe(1);

    // Re-open the same cell and revert the value
    act(() => {
      result.current.handleStartEdit(0, 1, "Alicia");
    });
    act(() => {
      result.current.setEditValue("Alice");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });

    expect(result.current.pendingEdits.size).toBe(0);
    expect(result.current.hasPendingChanges).toBe(false);
  });

  it("handleStartEdit on a NULL cell with unchanged empty value adds nothing", () => {
    const { result } = renderEditHook();
    // Cell at row 1 col 1 is null → edit string is ""
    act(() => {
      result.current.handleStartEdit(1, 1, "");
    });
    // Switch to another cell without changing value
    act(() => {
      result.current.handleStartEdit(0, 1, "Alice");
    });

    expect(result.current.pendingEdits.size).toBe(0);
  });

  it("handleStartEdit persists a real change when switching to another cell", () => {
    const { result } = renderEditHook();
    act(() => {
      result.current.handleStartEdit(0, 1, "Alice");
    });
    act(() => {
      result.current.setEditValue("Alicia");
    });
    // Switch — should persist the changed value
    act(() => {
      result.current.handleStartEdit(1, 1, "");
    });

    expect(result.current.pendingEdits.get("0-1")).toBe("Alicia");
  });

  it("treats object cells consistently — opening + closing without change adds nothing", () => {
    const { result } = renderEditHook();
    // jsonb at row 0 col 2 = {tag: "x"}; pretty-print = '{\n  "tag": "x"\n}'
    const objStr = JSON.stringify({ tag: "x" }, null, 2);
    act(() => {
      result.current.handleStartEdit(0, 2, objStr);
    });
    act(() => {
      result.current.saveCurrentEdit();
    });

    expect(result.current.pendingEdits.size).toBe(0);
  });

  it("Cmd+S commit on an in-flight unchanged edit does NOT add it to pending", () => {
    const { result } = renderEditHook();
    // Create a separate real pending edit so hasPendingChanges is true
    act(() => {
      result.current.handleStartEdit(0, 1, "Alice");
    });
    act(() => {
      result.current.setEditValue("Alicia");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });
    expect(result.current.pendingEdits.size).toBe(1);

    // Now open another cell, don't change anything, Cmd+S
    act(() => {
      result.current.handleStartEdit(0, 0, "1");
    });
    act(() => {
      window.dispatchEvent(new Event("commit-changes"));
    });

    // Only the original Alicia change should be in pendingEdits
    expect(result.current.pendingEdits.size).toBe(1);
    expect(result.current.pendingEdits.get("0-1")).toBe("Alicia");
    expect(result.current.pendingEdits.has("0-0")).toBe(false);
  });
});
