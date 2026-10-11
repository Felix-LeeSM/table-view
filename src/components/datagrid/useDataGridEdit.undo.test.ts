// ADR 0022 Phase 5 — pending-edit undo stack on `useDataGridEdit`. Maps
// to AC-249-U1..U9.
//
// The harness focus is the *pending-state* boundary: cell edits, Add /
// Delete / Duplicate row gestures push deep snapshots so a Cmd+Z (or
// toolbar Undo) restores LIFO. Commit success / discard tear down the
// stack via `clearAllPending`. Out of scope for this file: keyboard
// wiring (covered in `DataGrid.undo.test.tsx`), toolbar button
// (covered in `DataGridToolbar.test.tsx`).

import i18n from "@lib/i18n";
import { useToastStore } from "@stores/toastStore";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import type { TableData } from "@/types/schema";
import { UNDO_STACK_MAX, useDataGridEdit } from "./useDataGridEdit";

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

function renderEditHook(data: TableData = MOCK_DATA) {
  return renderHook(
    (props: { data: TableData }) =>
      useDataGridEdit({
        data: props.data,
        database: "db1",
        schema: "public",
        table: "users",
        connectionId: "conn1",
        page: 1,
        fetchData: mockFetchData,
      }),
    { initialProps: { data } },
  );
}

describe("useDataGridEdit — undo stack (Sprint 249, ADR 0022 Phase 5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteQueryBatch.mockResolvedValue([
      {
        columns: [],
        rows: [],
        total_count: 0,
        execution_time_ms: 1,
        query_type: "dml" as const,
      },
    ]);
    // The RDB commit path calls `@lib/tauri.executeQueryBatch` (not the
    // schemaStore pass-through), so the commit-span tests below wire the
    // tauri mock to the same spy they assert on.
    setupTauriMock({
      get executeQueryBatch() {
        return mockExecuteQueryBatch;
      },
    });
  });

  it("[AC-249-U1] undo() on an empty stack is a no-op (no panic, state unchanged)", () => {
    const { result } = renderEditHook();
    expect(result.current.canUndo).toBe(false);
    expect(result.current.pendingEdits.size).toBe(0);
    expect(result.current.pendingNewRows.length).toBe(0);
    expect(result.current.pendingDeletedRowKeys.size).toBe(0);

    act(() => {
      result.current.undo();
    });

    expect(result.current.canUndo).toBe(false);
    expect(result.current.pendingEdits.size).toBe(0);
    expect(result.current.pendingNewRows.length).toBe(0);
    expect(result.current.pendingDeletedRowKeys.size).toBe(0);
  });

  it("[AC-249-U2] handleAddRow → undo() restores empty pendingNewRows", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleAddRow();
    });
    expect(result.current.pendingNewRows.length).toBe(1);
    expect(result.current.canUndo).toBe(true);

    act(() => {
      result.current.undo();
    });

    expect(result.current.pendingNewRows.length).toBe(0);
    expect(result.current.canUndo).toBe(false);
  });

  it("[AC-249-U3] handleDeleteRow → undo() restores empty pendingDeletedRowKeys", () => {
    const { result } = renderEditHook();

    // Select row 0 first.
    act(() => {
      result.current.handleSelectRow(0, false, false);
    });
    expect(result.current.selectedRowIds.size).toBe(1);

    act(() => {
      result.current.handleDeleteRow();
    });
    expect(result.current.pendingDeletedRowKeys.size).toBe(1);
    expect(result.current.canUndo).toBe(true);

    act(() => {
      result.current.undo();
    });

    expect(result.current.pendingDeletedRowKeys.size).toBe(0);
    expect(result.current.canUndo).toBe(false);
  });

  it("[AC-249-U4] handleDuplicateRow → undo() restores prior pendingNewRows", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleSelectRow(1, false, false);
    });
    act(() => {
      result.current.handleDuplicateRow();
    });
    expect(result.current.pendingNewRows.length).toBe(1);
    expect(result.current.canUndo).toBe(true);

    act(() => {
      result.current.undo();
    });

    expect(result.current.pendingNewRows.length).toBe(0);
  });

  it("[AC-249-U5] saveCurrentEdit (real value change) → undo() restores prior pendingEdits", () => {
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
    expect(result.current.pendingEdits.size).toBe(1);
    expect(result.current.pendingEdits.get("0-1")).toBe("Alicia");
    expect(result.current.canUndo).toBe(true);

    act(() => {
      result.current.undo();
    });

    expect(result.current.pendingEdits.size).toBe(0);
    expect(result.current.canUndo).toBe(false);
  });

  it("[AC-249-U6] saveCurrentEdit (no-op — same value) does NOT push, undo stack length unchanged", () => {
    const { result } = renderEditHook();

    // Open editor on Alice cell, do not change value, save.
    act(() => {
      result.current.handleStartEdit(0, 1, "Alice");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });

    expect(result.current.pendingEdits.size).toBe(0);
    expect(result.current.canUndo).toBe(false);
  });

  it("[AC-249-U7] clearAllPending() empties the undo stack (canUndo=false)", () => {
    const { result } = renderEditHook();

    // Build up some history.
    act(() => {
      result.current.handleAddRow();
    });
    act(() => {
      result.current.handleAddRow();
    });
    expect(result.current.canUndo).toBe(true);

    // Discard is the safe public surface to drive `clearAllPending`.
    act(() => {
      result.current.handleDiscard();
    });

    expect(result.current.canUndo).toBe(false);
    expect(result.current.pendingNewRows.length).toBe(0);
  });

  it("[AC-249-U8] more than UNDO_STACK_MAX pushes → stack stays at UNDO_STACK_MAX (FIFO drop)", () => {
    const { result } = renderEditHook();

    // Push UNDO_STACK_MAX + 5 mutations. Each handleAddRow adds one
    // new row (and one snapshot).
    const total = UNDO_STACK_MAX + 5;
    for (let i = 0; i < total; i++) {
      act(() => {
        result.current.handleAddRow();
      });
    }

    expect(result.current.pendingNewRows.length).toBe(total);
    expect(result.current.canUndo).toBe(true);

    // Drain the stack — we should be able to undo at most UNDO_STACK_MAX
    // times before canUndo flips to false. Because earliest snapshots
    // were dropped, the deepest restore is the state at "5 rows pushed"
    // (the snapshot taken right before the 6th push, i.e. when 5 rows
    // were already present), NOT the original empty state.
    for (let i = 0; i < UNDO_STACK_MAX; i++) {
      act(() => {
        result.current.undo();
      });
    }

    expect(result.current.canUndo).toBe(false);
    // 5 rows survive: the snapshots covering pushes 1..5 were dropped
    // when pushes 51..55 capped the stack; undo can only walk back to
    // the snapshot taken before push #6, which captured 5 rows already
    // present.
    expect(result.current.pendingNewRows.length).toBe(5);
  });

  it("[#1126 Phase 2] commit a DELETE → undo re-stages it as a pending re-INSERT", async () => {
    const { result } = renderEditHook();

    // Delete row 0 (Alice) and commit it to the DB.
    act(() => {
      result.current.handleSelectRow(0, false, false);
    });
    act(() => {
      result.current.handleDeleteRow();
    });
    expect(result.current.pendingDeletedRowKeys.size).toBe(1);

    act(() => {
      result.current.handleCommit();
    });
    await act(async () => {
      await result.current.handleExecuteCommit();
    });
    // A warn-tier Safe Mode prompt (if any) is confirmed so the write lands.
    if (result.current.pendingConfirm) {
      await act(async () => {
        await result.current.confirmDangerous();
      });
    }

    // Commit cleared the pending delete and wrote exactly once.
    expect(result.current.pendingDeletedRowKeys.size).toBe(0);
    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);

    // ADR 0048 Phase 2 — the undo stack survives the commit; Cmd+Z re-stages
    // the deleted row as a pending re-INSERT (no DB write until re-commit).
    act(() => {
      result.current.undo();
    });
    expect(result.current.pendingNewRows.length).toBe(1);
    expect(result.current.pendingNewRows[0]).toEqual([1, "Alice"]);
    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
  });

  it("[#1126 Phase 2] commit an INSERT (with PK) → undo re-stages a pending DELETE", async () => {
    const { result } = renderEditHook();

    // Duplicate row 1 (id=2, Bob) → a new row that carries a full PK, so the
    // committed INSERT is reversible.
    act(() => {
      result.current.handleSelectRow(1, false, false);
    });
    act(() => {
      result.current.handleDuplicateRow();
    });
    expect(result.current.pendingNewRows.length).toBe(1);
    expect(result.current.pendingNewRows[0]).toEqual([2, "Bob"]);

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

    expect(result.current.pendingNewRows.length).toBe(0);
    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);

    // Undo re-stages a pending DELETE of the inserted row (no DB write).
    act(() => {
      result.current.undo();
    });
    expect(result.current.pendingDeletedRowKeys.size).toBe(1);
    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
  });

  it("[#1126 Phase 2] non-reproducible commit → undo() toasts and stages nothing", async () => {
    const { result } = renderEditHook();

    // Add an empty row: its auto-increment PK stays null, so the committed
    // INSERT can't be reversed to a safe DELETE.
    act(() => {
      result.current.handleAddRow();
    });
    expect(result.current.pendingNewRows.length).toBe(1);

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
    expect(result.current.pendingNewRows.length).toBe(0);
    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
    // The undo stack survived the commit: the blocked marker was pushed onto
    // the retained pre-add history.
    expect(result.current.canUndo).toBe(true);
    const toastsBefore = useToastStore.getState().toasts.length;

    // Undo the non-reproducible commit → a toast fires and NOTHING is staged;
    // no DB write, and the blocked marker drains.
    act(() => {
      result.current.undo();
    });
    expect(result.current.pendingEdits.size).toBe(0);
    expect(result.current.pendingNewRows.length).toBe(0);
    expect(result.current.pendingDeletedRowKeys.size).toBe(0);
    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(toastsBefore + 1);
    expect(toasts[toasts.length - 1]!.message).toBe(
      i18n.t("datagrid:undoRestageBlocked"),
    );

    // A further undo drains the retained pre-add snapshot — the history is
    // still walkable past the blocked commit.
    act(() => {
      result.current.undo();
    });
    expect(result.current.canUndo).toBe(false);
  });

  it("[#1126 multi-step] two consecutive commits → undo walks back through BOTH reversals", async () => {
    const { result, rerender } = renderEditHook();

    // Commit 1: Alice → Bob at row 0's name cell.
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

    // The commit path refetches after `restageAfterCommit`, so the hook's
    // rows move to the committed value before the undo. The fixture models
    // that — with stale rows every reversal value would equal the baseline
    // and #2686's dissolution would (correctly) stage nothing.
    rerender({
      data: {
        ...MOCK_DATA,
        rows: [
          [1, "Bob"],
          [2, "Bob"],
          [3, "Charlie"],
        ],
      },
    });

    // Commit 2: Bob → Charlie at row 1's name cell (a DIFFERENT cell, so the
    // two reversals are distinguishable).
    act(() => {
      result.current.handleStartEdit(1, 1, "Bob");
    });
    act(() => {
      result.current.setEditValue("Charlie");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });
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
    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(2);

    // Refetch after commit 2 — row 1's name is now Charlie.
    rerender({
      data: {
        ...MOCK_DATA,
        rows: [
          [1, "Bob"],
          [2, "Charlie"],
          [3, "Charlie"],
        ],
      },
    });

    // First undo re-stages the LAST commit's reversal (row 1 back to Bob).
    act(() => {
      result.current.undo();
    });
    expect(result.current.pendingEdits.size).toBe(1);
    expect(result.current.pendingEdits.get("1-1")).toBe("Bob");
    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(2);

    // Second undo re-stages the FIRST commit's reversal (row 0 back to
    // Alice) — the commit-1 history survived commit 2.
    act(() => {
      result.current.undo();
    });
    expect(result.current.pendingEdits.size).toBe(1);
    expect(result.current.pendingEdits.get("0-1")).toBe("Alice");
    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(2);
  });

  it("[#2686 decision 2] undo dissolves the reversal cell the baseline already holds and stages the real one", async () => {
    const { result, rerender } = renderEditHook();

    // A value-no-op entry on row 0's name cell — staged the way the
    // JSON-tree panel and the document grid stage (direct `setPendingEdits`,
    // no original-value guard): the staged value EQUALS the baseline cell,
    // so the commit writes the value the row already holds.
    act(() => {
      result.current.setPendingEdits(new Map([["0-1", "Alice"]]));
    });
    // A real edit on row 1 rides the same commit.
    act(() => {
      result.current.handleStartEdit(1, 1, "Bob");
    });
    act(() => {
      result.current.setEditValue("Bobby");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });
    expect(result.current.pendingEdits.size).toBe(2);

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

    // The commit path refetches after `restageAfterCommit`, so the hook's
    // rows hold the committed values before the undo (fixture models the
    // refetch).
    rerender({
      data: {
        ...MOCK_DATA,
        rows: [
          [1, "Alice"],
          [2, "Bobby"],
          [3, "Charlie"],
        ],
      },
    });

    // The reversal carries both cells (0-1 → "Alice", 1-1 → "Bob"). Owner
    // decision 2 (#1126, 2026-07-10): a re-staged value equal to the current
    // baseline dissolves — undo stages ONLY the real reversal cell.
    act(() => {
      result.current.undo();
    });
    expect(result.current.pendingEdits.size).toBe(1);
    expect(result.current.pendingEdits.get("1-1")).toBe("Bob");
    expect(result.current.pendingEdits.has("0-1")).toBe(false);
    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
  });

  it("[#2692] undo keeps the reversal when a coincidentally-equal row moved into its index", async () => {
    // Two distinct rows share the name "Alice" — PK is the only identity.
    const DATA: TableData = {
      columns: MOCK_DATA.columns,
      rows: [
        [1, "Alice"],
        [2, "Bob"],
        [3, "Alice"],
      ],
      total_count: 3,
      page: 1,
      page_size: 100,
      executed_query: "SELECT * FROM public.users LIMIT 100 OFFSET 0",
    };
    const { result, rerender } = renderEditHook(DATA);

    // Commit a real edit on row 0 (id=1): Alice → Alicia. The reversal value
    // is the pre-edit cell "Alice".
    act(() => {
      result.current.handleStartEdit(0, 1, "Alice");
    });
    act(() => {
      result.current.setEditValue("Alicia");
    });
    act(() => {
      result.current.saveCurrentEdit();
    });
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

    // The commit path refetches after `restageAfterCommit`; the fixture
    // models a reorder: id=3 — whose name coincides with the reversal
    // value — now sits at index 0 where id=1 used to be.
    rerender({
      data: {
        ...DATA,
        rows: [
          [3, "Alice"],
          [2, "Bob"],
          [1, "Alicia"],
        ],
      },
    });

    act(() => {
      result.current.undo();
    });

    // The reversal survives: the value-only comparison would dissolve it
    // against id=3's cell, but id=3 is not the anchored row.
    expect(result.current.pendingEdits.size).toBe(1);
    expect(result.current.pendingEdits.get("0-1")).toBe("Alice");
    // The anchor rides along so a re-commit still targets id=1, not id=3.
    expect(result.current.pendingEditRowSnapshots.get("0-1")).toEqual([
      1,
      "Alicia",
    ]);
    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
  });

  it("[AC-249-U9] consecutive actions → undo restores LIFO (most recent first)", () => {
    const { result } = renderEditHook();

    act(() => {
      result.current.handleAddRow();
    });
    expect(result.current.pendingNewRows.length).toBe(1);

    act(() => {
      result.current.handleAddRow();
    });
    expect(result.current.pendingNewRows.length).toBe(2);

    // First undo removes the most recent add.
    act(() => {
      result.current.undo();
    });
    expect(result.current.pendingNewRows.length).toBe(1);

    // Second undo removes the original add.
    act(() => {
      result.current.undo();
    });
    expect(result.current.pendingNewRows.length).toBe(0);
    expect(result.current.canUndo).toBe(false);
  });
});
