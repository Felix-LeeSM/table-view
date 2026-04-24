import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDataGridEdit } from "./useDataGridEdit";
import type { TableData } from "@/types/schema";

// Sprint 75 — validation gate tests. When a pending edit can't be coerced
// to its column's data_type, it should be excluded from SQL preview and a
// per-cell error entry should appear in `pendingEditErrors`. Sibling edits
// in the same batch are validated independently.

const mockExecuteQuery = vi.fn(() =>
  Promise.resolve({
    columns: [],
    rows: [],
    total_count: 0,
    execution_time_ms: 5,
    query_type: "dml" as const,
  }),
);
const mockFetchData = vi.fn();

vi.mock("@stores/schemaStore", () => ({
  useSchemaStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ executeQuery: mockExecuteQuery }),
}));

vi.mock("@stores/tabStore", () => ({
  useTabStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ activeTabId: "tab-1", promoteTab: vi.fn() }),
}));

const TYPED_DATA: TableData = {
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
      name: "age",
      data_type: "integer",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
    {
      name: "active",
      data_type: "boolean",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
    {
      name: "note",
      data_type: "text",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
  ],
  rows: [[1, 42, true, "hi"]],
  total_count: 1,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM public.users LIMIT 100 OFFSET 0",
};

function renderEditHook(data: TableData | null = TYPED_DATA) {
  return renderHook(() =>
    useDataGridEdit({
      data,
      schema: "public",
      table: "users",
      connectionId: "conn1",
      page: 1,
      fetchData: mockFetchData,
    }),
  );
}

describe("useDataGridEdit — Sprint 75 validation gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initial state: pendingEditErrors is an empty Map", () => {
    const { result } = renderEditHook();
    expect(result.current.pendingEditErrors).toBeInstanceOf(Map);
    expect(result.current.pendingEditErrors.size).toBe(0);
  });

  it("handleCommit on a valid integer edit opens SQL preview with no errors", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleStartEdit(0, 1, "42");
    });
    act(() => {
      result.current.setEditValue("99");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });

    act(() => {
      result.current.handleCommit();
    });

    expect(result.current.sqlPreview).not.toBeNull();
    expect(result.current.sqlPreview?.join(" ")).toContain("SET age = 99");
    expect(result.current.pendingEditErrors.size).toBe(0);
  });

  it("handleCommit on an invalid integer edit excludes the SQL and records an error entry", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleStartEdit(0, 1, "42");
    });
    act(() => {
      result.current.setEditValue("abc");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });

    act(() => {
      result.current.handleCommit();
    });

    // No SQL preview — the only pending edit was invalid.
    expect(result.current.sqlPreview).toBeNull();
    expect(result.current.pendingEditErrors.size).toBe(1);
    const msg = result.current.pendingEditErrors.get("0-1");
    expect(msg).toBeDefined();
    expect(msg).toMatch(/integer/i);
  });

  it("mixed batch: valid and invalid edits validate independently", () => {
    const { result } = renderEditHook();

    // Valid boolean edit
    act(() => {
      result.current.handleStartEdit(0, 2, "true");
    });
    act(() => {
      result.current.setEditValue("false");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });

    // Invalid integer edit
    act(() => {
      result.current.handleStartEdit(0, 1, "42");
    });
    act(() => {
      result.current.setEditValue("abc");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });

    act(() => {
      result.current.handleCommit();
    });

    // Valid boolean edit produced SQL.
    expect(result.current.sqlPreview).not.toBeNull();
    const joined = result.current.sqlPreview?.join(" ") ?? "";
    expect(joined).toContain("SET active = FALSE");
    expect(joined).not.toContain("abc");
    // Invalid integer edit shows up in the error map.
    expect(result.current.pendingEditErrors.size).toBe(1);
    expect(result.current.pendingEditErrors.has("0-1")).toBe(true);
    // Valid cell has no error entry.
    expect(result.current.pendingEditErrors.has("0-2")).toBe(false);
  });

  it("setEditValue clears the error for the currently editing cell", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleStartEdit(0, 1, "42");
    });
    act(() => {
      result.current.setEditValue("abc");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });
    act(() => {
      result.current.handleCommit();
    });
    expect(result.current.pendingEditErrors.has("0-1")).toBe(true);

    // Re-open the offending cell and edit — hint should clear.
    act(() => {
      result.current.handleStartEdit(0, 1, "abc");
    });
    expect(result.current.pendingEditErrors.has("0-1")).toBe(true);

    act(() => {
      result.current.setEditValue("7");
    });
    expect(result.current.pendingEditErrors.has("0-1")).toBe(false);
  });

  it("setEditNull clears the error for the currently editing cell", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleStartEdit(0, 1, "42");
    });
    act(() => {
      result.current.setEditValue("abc");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });
    act(() => {
      result.current.handleCommit();
    });
    expect(result.current.pendingEditErrors.has("0-1")).toBe(true);

    // Re-open the offending cell.
    act(() => {
      result.current.handleStartEdit(0, 1, "abc");
    });
    // Cmd+Backspace → setEditNull.
    act(() => {
      result.current.setEditNull();
    });
    expect(result.current.pendingEditErrors.has("0-1")).toBe(false);
  });

  it("handleDiscard clears all pending errors", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleStartEdit(0, 1, "42");
    });
    act(() => {
      result.current.setEditValue("abc");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });
    act(() => {
      result.current.handleCommit();
    });
    expect(result.current.pendingEditErrors.size).toBe(1);

    act(() => {
      result.current.handleDiscard();
    });
    expect(result.current.pendingEditErrors.size).toBe(0);
    expect(result.current.pendingEdits.size).toBe(0);
  });

  it("handleExecuteCommit clears errors after a successful commit", async () => {
    const { result } = renderEditHook();

    // One valid edit → successful commit.
    act(() => {
      result.current.handleStartEdit(0, 1, "42");
    });
    act(() => {
      result.current.setEditValue("7");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });
    act(() => {
      result.current.handleCommit();
    });
    expect(result.current.sqlPreview).not.toBeNull();

    await act(async () => {
      await result.current.handleExecuteCommit();
    });

    expect(result.current.sqlPreview).toBeNull();
    expect(result.current.pendingEditErrors.size).toBe(0);
  });

  it("Cmd+S commit with an invalid in-flight edit records the error and keeps the pending entry", () => {
    const { result } = renderEditHook();

    // Need a prior pending edit so hasPendingChanges is true (matches the
    // existing Cmd+S path — in-flight-only is already excluded upstream).
    act(() => {
      result.current.handleStartEdit(0, 3, "hi");
    });
    act(() => {
      result.current.setEditValue("greetings");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });

    // Now open another cell with an invalid value and leave it in-flight.
    act(() => {
      result.current.handleStartEdit(0, 1, "42");
    });
    act(() => {
      result.current.setEditValue("abc");
    });

    act(() => {
      window.dispatchEvent(new Event("commit-changes"));
    });

    // SQL preview is null because the invalid edit blocks commit; note that
    // the valid note edit IS emitted but the invalid age edit kills the batch
    // via the `sqlStatements.length === 0` gate only when no valid SQL. Here
    // we should still produce the valid note SQL but also record the error.
    expect(result.current.sqlPreview).not.toBeNull();
    expect(result.current.sqlPreview?.join(" ")).toContain(
      "SET note = 'greetings'",
    );
    // Error for the invalid age cell persists.
    expect(result.current.pendingEditErrors.has("0-1")).toBe(true);
  });

  it("Cmd+S commit on a valid in-flight integer edit opens preview with no errors", () => {
    const { result } = renderEditHook();

    // Prior pending edit so hasPendingChanges is true.
    act(() => {
      result.current.handleStartEdit(0, 3, "hi");
    });
    act(() => {
      result.current.setEditValue("greetings");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });

    // In-flight valid integer edit.
    act(() => {
      result.current.handleStartEdit(0, 1, "42");
    });
    act(() => {
      result.current.setEditValue("7");
    });

    act(() => {
      window.dispatchEvent(new Event("commit-changes"));
    });

    expect(result.current.sqlPreview).not.toBeNull();
    expect(result.current.sqlPreview?.join(" ")).toContain("SET age = 7");
    expect(result.current.pendingEditErrors.size).toBe(0);
  });

  it("re-commit after fixing the cell clears the error map", () => {
    const { result } = renderEditHook();

    // First commit: invalid.
    act(() => {
      result.current.handleStartEdit(0, 1, "42");
    });
    act(() => {
      result.current.setEditValue("abc");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });
    act(() => {
      result.current.handleCommit();
    });
    expect(result.current.pendingEditErrors.size).toBe(1);

    // Fix.
    act(() => {
      result.current.handleStartEdit(0, 1, "abc");
    });
    act(() => {
      result.current.setEditValue("99");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });
    act(() => {
      result.current.handleCommit();
    });

    // Now preview opens cleanly.
    expect(result.current.sqlPreview).not.toBeNull();
    expect(result.current.pendingEditErrors.size).toBe(0);
  });
});
