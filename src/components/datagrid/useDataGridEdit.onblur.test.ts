// Sprint 250 (ADR 0022 Phase 5 follow-up) — onBlur commit hook-layer
// guards. Maps to AC-250-01 / AC-250-04 / AC-250-05 from
// `docs/sprints/sprint-250/contract.md`. Date 2026-05-09.
//
// Scope (hook layer only):
// - AC-250-01: saveCurrentEdit applied via the onBlur entry point persists
//   value-changing edits exactly like the Tab/Enter path (pendingEdits
//   reflects the new value, undo snapshot pushed when value differs).
// - AC-250-04: editor-local cancelEdit (Esc inside the active cell input)
//   is independent of the onBlur path — calling it does NOT invoke
//   saveCurrentEdit's pendingEdits update.
// - AC-250-05: race / loop guard — calling saveCurrentEdit twice in a row
//   from the same blur path is idempotent: only one snapshot is pushed and
//   pendingEdits flips at most once. The second call is a no-op because
//   editingCell becomes null after the first commit (AC-250-05 guard).
//
// Out of scope here (covered in DataGrid.esc.test.tsx):
// - AC-250-02 / AC-250-03: window keydown Esc + modal-aware discard.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
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
      database: "db1",
      schema: "public",
      table: "users",
      connectionId: "conn1",
      page: 1,
      fetchData: mockFetchData,
    }),
  );
}

describe("useDataGridEdit — Sprint 250 onBlur commit + race guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("[AC-250-01] saveCurrentEdit (onBlur entry point) persists a value change like Tab/Enter", () => {
    const { result } = renderEditHook();

    // Open editor, change value, then "blur" by calling saveCurrentEdit
    // directly (the input.onBlur handler routes here).
    act(() => {
      result.current.handleStartEdit(0, 1, "Alice");
    });
    act(() => {
      result.current.setEditValue("Alicia");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });

    // pendingEdits reflects the change identically to the Tab/Enter path.
    expect(result.current.pendingEdits.size).toBe(1);
    expect(result.current.pendingEdits.get("0-1")).toBe("Alicia");
    // Editor closed after commit → cell input unmounted in real UI.
    expect(result.current.editingCell).toBeNull();
    expect(result.current.editValue).toBe("");
    // Undo snapshot pushed for the value change.
    expect(result.current.canUndo).toBe(true);
  });

  it("[AC-250-01] saveCurrentEdit (onBlur entry point) is a no-op when value is unchanged", () => {
    const { result } = renderEditHook();

    // Open editor on "Alice" but do NOT change the value before "blurring".
    act(() => {
      result.current.handleStartEdit(0, 1, "Alice");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });

    // No pending entry, no undo snapshot — the no-op skip rule from
    // Sprint 249 must still hold for the onBlur path.
    expect(result.current.pendingEdits.size).toBe(0);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.editingCell).toBeNull();
  });

  it("[AC-250-04] cancelEdit (Esc inside cell input) does NOT push a snapshot or commit", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleStartEdit(0, 1, "Alice");
    });
    act(() => {
      result.current.setEditValue("Alicia");
    });
    // Esc inside the cell input → cancelEdit, NOT saveCurrentEdit.
    act(() => {
      result.current.cancelEdit();
    });

    // The in-flight typed value is discarded; pendingEdits stays empty
    // and the undo stack remains empty (no snapshot was pushed because
    // we never reached the saveCurrentEdit branch).
    expect(result.current.pendingEdits.size).toBe(0);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.editingCell).toBeNull();
    expect(result.current.editValue).toBe("");
  });

  it("[AC-250-04] cancelEdit (Esc inside cell input) preserves OTHER pending edits", () => {
    const { result } = renderEditHook();

    // Establish a pre-existing pending edit on a different cell.
    act(() => {
      result.current.handleStartEdit(1, 1, "Bob");
    });
    act(() => {
      result.current.setEditValue("Bobby");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });
    expect(result.current.pendingEdits.size).toBe(1);
    expect(result.current.pendingEdits.get("1-1")).toBe("Bobby");

    // Now open a different cell, type something, then cancel.
    act(() => {
      result.current.handleStartEdit(0, 1, "Alice");
    });
    act(() => {
      result.current.setEditValue("Alicia");
    });
    act(() => {
      result.current.cancelEdit();
    });

    // The OTHER pending edit must remain intact — cancelEdit only
    // discards the in-flight typed value.
    expect(result.current.pendingEdits.size).toBe(1);
    expect(result.current.pendingEdits.get("1-1")).toBe("Bobby");
    expect(result.current.pendingEdits.has("0-1")).toBe(false);
  });

  it("[AC-250-05] saveCurrentEdit called twice from the onBlur path commits at most once", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleStartEdit(0, 1, "Alice");
    });
    act(() => {
      result.current.setEditValue("Alicia");
    });
    // First "blur" — should commit and clear editingCell.
    act(() => {
      result.current.saveCurrentEdit();
    });
    // Second "blur" (re-render → re-blur race simulation) — must be a
    // pure no-op because editingCell is now null. Otherwise we'd push a
    // phantom snapshot or duplicate the commit.
    act(() => {
      result.current.saveCurrentEdit();
    });

    // Exactly one pending entry; exactly one undo snapshot.
    expect(result.current.pendingEdits.size).toBe(1);
    expect(result.current.pendingEdits.get("0-1")).toBe("Alicia");
    expect(result.current.canUndo).toBe(true);

    // After undo, the stack is drained — only one push happened.
    act(() => {
      result.current.undo();
    });
    expect(result.current.pendingEdits.size).toBe(0);
    expect(result.current.canUndo).toBe(false);
  });
});
