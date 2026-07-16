// Issue #1527 (ADR 0050) — pending-edit redo stack on `useDataGridEdit`,
// the symmetric counterpart of the Sprint 249 undo stack. Redo re-applies
// what an undo reverted; any NEW edit clears the redo stack (standard
// undo/redo semantics). Scope: pending-edit symmetry only — commit-span
// redo survival (ADR 0050 point 1) stays deferred to #1126.
//
// The harness focus is the *pending-state* boundary: undo populates the
// redo stack, redo restores from it, and a fresh edit invalidates it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { useDataGridEdit } from "./useDataGridEdit";
import type { TableData } from "@/types/schema";

const mockExecuteQuery = vi.fn();
const mockExecuteQueryBatch = vi.fn();
const mockFetchData = vi.fn();

vi.mock("@stores/schemaStore", () => ({
  useSchemaStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      executeQuery: mockExecuteQuery,
      executeQueryBatch: mockExecuteQueryBatch,
    }),
}));

vi.mock("@stores/workspaceStore", () => ({
  useActiveTabId: () => "tab-1",
  useCurrentWorkspaceKey: () => ({ connId: "conn1", db: "db1" }),
  useWorkspaceStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      promoteTab: vi.fn(),
      setTabDirty: vi.fn(),
    }),
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
    [3, "Charlie"],
  ],
  total_count: 3,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM public.users LIMIT 100 OFFSET 0",
};

function renderEditHook() {
  return renderHook(() =>
    useDataGridEdit({
      data: MOCK_DATA,
      database: "db1",
      schema: "public",
      table: "users",
      connectionId: "conn1",
      page: 1,
      fetchData: mockFetchData,
    }),
  );
}

describe("useDataGridEdit — redo stack (Issue #1527, ADR 0050)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupTauriMock({
      get executeQueryBatch() {
        return mockExecuteQueryBatch;
      },
    });
  });

  it("[R1] redo() on an empty stack is a no-op (canRedo=false, state unchanged)", () => {
    const { result } = renderEditHook();
    expect(result.current.canRedo).toBe(false);

    act(() => {
      result.current.redo();
    });

    expect(result.current.canRedo).toBe(false);
    expect(result.current.pendingNewRows.length).toBe(0);
    expect(result.current.pendingEdits.size).toBe(0);
  });

  it("[R2] edit → undo → redo restores the edit", () => {
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
    expect(result.current.pendingEdits.get("0-1")).toBe("Alicia");
    expect(result.current.canRedo).toBe(false);

    act(() => {
      result.current.undo();
    });
    expect(result.current.pendingEdits.size).toBe(0);
    expect(result.current.canRedo).toBe(true);

    act(() => {
      result.current.redo();
    });
    expect(result.current.pendingEdits.get("0-1")).toBe("Alicia");
    expect(result.current.canRedo).toBe(false);
    // Redo is itself undoable.
    expect(result.current.canUndo).toBe(true);
  });

  it("[R3] add row → undo → redo restores the row", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleAddRow();
    });
    expect(result.current.pendingNewRows.length).toBe(1);

    act(() => {
      result.current.undo();
    });
    expect(result.current.pendingNewRows.length).toBe(0);
    expect(result.current.canRedo).toBe(true);

    act(() => {
      result.current.redo();
    });
    expect(result.current.pendingNewRows.length).toBe(1);
  });

  it("[R4] a NEW edit after an undo clears the redo stack", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleAddRow();
    });
    act(() => {
      result.current.undo();
    });
    expect(result.current.canRedo).toBe(true);

    // A fresh mutation invalidates the redo stack (standard semantics).
    act(() => {
      result.current.handleAddRow();
    });
    expect(result.current.canRedo).toBe(false);

    // Redo is now a no-op — the earlier undone state is unreachable.
    act(() => {
      result.current.redo();
    });
    expect(result.current.pendingNewRows.length).toBe(1);
  });

  it("[R5] two edits → undo undo → redo redo replays in order (LIFO symmetry)", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleAddRow();
    });
    act(() => {
      result.current.handleAddRow();
    });
    expect(result.current.pendingNewRows.length).toBe(2);

    act(() => {
      result.current.undo();
    });
    act(() => {
      result.current.undo();
    });
    expect(result.current.pendingNewRows.length).toBe(0);
    expect(result.current.canRedo).toBe(true);

    act(() => {
      result.current.redo();
    });
    expect(result.current.pendingNewRows.length).toBe(1);

    act(() => {
      result.current.redo();
    });
    expect(result.current.pendingNewRows.length).toBe(2);
    expect(result.current.canRedo).toBe(false);
  });

  it("[R6] discard wipes the redo stack (canRedo=false)", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleAddRow();
    });
    act(() => {
      result.current.undo();
    });
    expect(result.current.canRedo).toBe(true);

    act(() => {
      result.current.handleDiscard();
    });
    expect(result.current.canRedo).toBe(false);
  });
});
