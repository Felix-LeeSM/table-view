// Issue #1527 (ADR 0050) — pending-edit redo stack on `useDataGridEdit`,
// the symmetric counterpart of the undo stack. Redo re-applies what an
// undo reverted; any NEW edit clears the redo stack (standard undo/redo
// semantics). Commit-span redo survival (ADR 0050 point 1, #1126) is
// covered here too: a successful commit keeps the redo stack.
//
// The harness focus is the *pending-state* boundary: undo populates the
// redo stack, redo restores from it, and a fresh edit invalidates it.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import type { TableData } from "@/types/schema";
import { useDataGridEdit } from "./useDataGridEdit";

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
    // The commit-span survival test below drives the real commit path, so
    // the tauri mock must resolve like the undo suite's does.
    mockExecuteQueryBatch.mockResolvedValue([
      {
        columns: [],
        rows: [],
        total_count: 0,
        execution_time_ms: 1,
        query_type: "dml" as const,
      },
    ]);
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

  it("[#1126 / ADR 0050 (1)] a commit does NOT wipe the redo stack — undo → commit → redo restores the undone edits", async () => {
    const { result } = renderEditHook();

    // Two pending edits.
    act(() => {
      result.current.handleStartEdit(0, 1, "Alice");
    });
    act(() => {
      result.current.setEditValue("Bob");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });
    act(() => {
      result.current.handleStartEdit(1, 1, "Bob");
    });
    act(() => {
      result.current.setEditValue("Charlie");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });
    expect(result.current.pendingEdits.size).toBe(2);

    // Undo peels the second edit off (pending keeps only the first one) and
    // parks the two-edit state on the redo stack.
    act(() => {
      result.current.undo();
    });
    expect(result.current.pendingEdits.size).toBe(1);
    expect(result.current.canRedo).toBe(true);

    // Commit the surviving edit (row 0 → Bob). One DB write.
    act(() => {
      result.current.handleCommit();
    });
    await act(async () => {
      await result.current.handleExecuteCommit();
    });
    if (result.current.pendingConfirm) {
      await act(async () => {
        await result.current.confirmDangerous();
      });
    }
    expect(result.current.pendingEdits.size).toBe(0);
    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);

    // ADR 0050 (1) — the commit survives symmetrically with undo: the redo
    // stack is still intact after the commit.
    expect(result.current.canRedo).toBe(true);

    // Redo restores the undone second edit (and re-applies the committed
    // first one) as PENDING state — no DB write until the user commits again.
    act(() => {
      result.current.redo();
    });
    expect(result.current.pendingEdits.get("0-1")).toBe("Bob");
    expect(result.current.pendingEdits.get("1-1")).toBe("Charlie");
    expect(result.current.canRedo).toBe(false);
    expect(result.current.canUndo).toBe(true);
    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
  });
});
