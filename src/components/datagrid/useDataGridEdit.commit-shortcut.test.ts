import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDataGridEdit } from "./useDataGridEdit";
import type { TableData } from "../../types/schema";

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
  ],
  rows: [
    [1, "Alice"],
    [2, "Bob"],
  ],
  total_count: 2,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM public.users LIMIT 100 OFFSET 0",
};

function renderEditHook(data: TableData | null = MOCK_DATA) {
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

function dispatchCommit() {
  window.dispatchEvent(new Event("commit-changes"));
}

describe("useDataGridEdit — Cmd+S commit-changes shortcut", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens SQL preview when commit-changes fires with pending edits", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleStartEdit(0, 1, "Alice");
    });
    act(() => {
      result.current.setEditValue("Alicia");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });
    expect(result.current.hasPendingChanges).toBe(true);
    expect(result.current.sqlPreview).toBeNull();

    act(() => {
      dispatchCommit();
    });

    expect(result.current.sqlPreview).not.toBeNull();
    expect(result.current.sqlPreview?.length).toBeGreaterThan(0);
  });

  it("is a noop when no pending changes exist", () => {
    const { result } = renderEditHook();
    expect(result.current.hasPendingChanges).toBe(false);

    act(() => {
      dispatchCommit();
    });

    expect(result.current.sqlPreview).toBeNull();
  });

  it("persists in-flight edit value before opening preview", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleStartEdit(0, 1, "Alice");
    });
    act(() => {
      result.current.setEditValue("Alicia");
    });
    // Note: saveCurrentEdit NOT called — edit is still in flight
    expect(result.current.editingCell).not.toBeNull();
    expect(result.current.hasPendingChanges).toBe(false);

    act(() => {
      // Even with no committed edits, an in-flight edit should be promoted
      // Because hasPendingChanges is computed from pendingEdits Map only,
      // we first save into pendingEdits via the dispatch path.
      result.current.saveCurrentEdit();
    });
    act(() => {
      result.current.handleStartEdit(1, 1, "Bob");
    });
    act(() => {
      result.current.setEditValue("Bobby");
    });

    act(() => {
      dispatchCommit();
    });

    // After dispatch the in-flight edit (row 1, col 1 = Bobby) should be
    // included in the preview SQL
    expect(result.current.sqlPreview).not.toBeNull();
    expect(result.current.editingCell).toBeNull();
    expect(result.current.sqlPreview?.join(" ")).toContain("Bobby");
  });

  it("does nothing when data is null", () => {
    const { result } = renderEditHook(null);

    act(() => {
      dispatchCommit();
    });

    expect(result.current.sqlPreview).toBeNull();
  });

  it("removes the listener on unmount", () => {
    const { result, unmount } = renderEditHook();

    act(() => {
      result.current.handleStartEdit(0, 1, "Alice");
    });
    act(() => {
      result.current.setEditValue("X");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });

    unmount();

    // Should not throw or update state after unmount
    act(() => {
      dispatchCommit();
    });
    // No assertion on result.current after unmount — just verifying no crash
  });
});
