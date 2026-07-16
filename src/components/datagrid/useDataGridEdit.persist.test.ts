// Sprint 251 — `useDataGridEdit` persistence across unmount/remount via
// `dataGridEditStore`. Maps to AC-251-H1..H5 from
// `docs/sprints/sprint-251/contract.md`. Date 2026-05-09.
//
// The hook used to keep its four pending slices (`pendingEdits`,
// `pendingNewRows`, `pendingDeletedRowKeys`, `undoStack`) in `useState`,
// so a tab switch (which unmounts the grid) discarded all in-flight work.
// Sprint 251 lifts those four slices to an in-memory store. Sprint 433
// keys that store by `(connectionId, database, schema, table)` so the next
// mount of the *same* table re-binds the same pending state without
// crossing database boundaries.
//
// Out of scope for this file (covered elsewhere):
// - Cross-window sync / localStorage persistence — intentionally excluded.
// - tabStore wire-up (`removeTab` / `clearTabsForConnection` purge) —
//   covered in `tabStore.purge.test.ts`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDataGridEdit } from "./useDataGridEdit";
import { useDataGridEditStore } from "@stores/dataGridEditStore";
import { makeEntryKey } from "@/test-utils/brandedKeys";
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

function renderEditHook(
  overrides: Partial<{
    schema: string;
    table: string;
    database: string;
    connectionId: string;
  }> = {},
) {
  const schema = overrides.schema ?? "public";
  const table = overrides.table ?? "users";
  const database = overrides.database ?? "db1";
  const connectionId = overrides.connectionId ?? "conn1";
  return renderHook(() =>
    useDataGridEdit({
      data: MOCK_DATA,
      schema,
      table,
      database,
      connectionId,
      page: 1,
      fetchData: mockFetchData,
    }),
  );
}

describe("useDataGridEdit — Sprint 251 store-backed persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure each test starts with an empty store so unrelated entries
    // from prior tests cannot leak across.
    useDataGridEditStore.setState({ entries: new Map() });
  });

  it("[AC-251-H1] unmount → re-mount with same key preserves all 4 slices (pendingEdits, pendingNewRows, pendingDeletedRowKeys, canUndo via undoStack)", () => {
    const first = renderEditHook();

    // 1. cell edit — Alice → Alicia (pushes 1 undo snapshot, 1 pendingEdit).
    act(() => {
      first.result.current.handleStartEdit(0, 1, "Alice");
    });
    act(() => {
      first.result.current.setEditValue("Alicia");
    });
    act(() => {
      first.result.current.saveCurrentEdit();
    });
    // 2. add row — pushes 1 undo snapshot, 1 pendingNewRow.
    act(() => {
      first.result.current.handleAddRow();
    });
    // 3. delete row — pushes 1 undo snapshot, 1 pendingDeletedRowKey.
    act(() => {
      first.result.current.handleSelectRow(2, false, false);
    });
    act(() => {
      first.result.current.handleDeleteRow();
    });

    expect(first.result.current.pendingEdits.get("0-1")).toBe("Alicia");
    expect(first.result.current.pendingNewRows.length).toBe(1);
    expect(first.result.current.pendingDeletedRowKeys.size).toBe(1);
    expect(first.result.current.canUndo).toBe(true);

    first.unmount();

    // Re-mount with the SAME (connectionId, database, schema, table). The
    // four slices must rehydrate from the store.
    const second = renderEditHook();
    expect(second.result.current.pendingEdits.get("0-1")).toBe("Alicia");
    expect(second.result.current.pendingNewRows.length).toBe(1);
    expect(second.result.current.pendingDeletedRowKeys.size).toBe(1);
    expect(second.result.current.canUndo).toBe(true);
  });

  it("[AC-251-H2] mount with a different key starts with empty pending state", () => {
    // Pre-seed KEY_A with some pending edits so we can verify that mounting
    // KEY_OTHER doesn't see them.
    const first = renderEditHook({ table: "users" });
    act(() => {
      first.result.current.handleAddRow();
    });
    expect(first.result.current.pendingNewRows.length).toBe(1);
    first.unmount();

    // Different table → different store key.
    const other = renderEditHook({ table: "orders" });
    expect(other.result.current.pendingEdits.size).toBe(0);
    expect(other.result.current.pendingNewRows.length).toBe(0);
    expect(other.result.current.pendingDeletedRowKeys.size).toBe(0);
    expect(other.result.current.canUndo).toBe(false);
  });

  it("[RISK-039] same connection/schema/table in a different database starts with empty pending state", () => {
    // Reason: Sprint 433 RISK-039 — db1.public.users pending edits must not
    // appear when the user switches to db2.public.users on the same
    // connection. (2026-05-22)
    const db1 = renderEditHook({ database: "db1" });
    act(() => {
      db1.result.current.handleStartEdit(0, 1, "Alice");
    });
    act(() => {
      db1.result.current.setEditValue("Alicia");
    });
    act(() => {
      db1.result.current.saveCurrentEdit();
    });
    expect(db1.result.current.pendingEdits.get("0-1")).toBe("Alicia");
    db1.unmount();

    const db2 = renderEditHook({ database: "db2" });
    expect(db2.result.current.pendingEdits.size).toBe(0);
    expect(db2.result.current.pendingNewRows.length).toBe(0);
    expect(db2.result.current.pendingDeletedRowKeys.size).toBe(0);
    expect(db2.result.current.canUndo).toBe(false);
  });

  it("[AC-251-H3] two hook instances on the same key share state (set on one is read by the other)", () => {
    const a = renderEditHook();
    const b = renderEditHook();

    act(() => {
      a.result.current.handleAddRow();
    });

    // Both instances point at the same store entry, so b sees the row.
    expect(a.result.current.pendingNewRows.length).toBe(1);
    expect(b.result.current.pendingNewRows.length).toBe(1);
    expect(a.result.current.canUndo).toBe(true);
    expect(b.result.current.canUndo).toBe(true);
  });

  it("[AC-251-H4] clearAllPending (via handleDiscard) wipes the store entry — next mount sees empty", () => {
    const first = renderEditHook();
    act(() => {
      first.result.current.handleAddRow();
    });
    expect(first.result.current.pendingNewRows.length).toBe(1);

    act(() => {
      first.result.current.handleDiscard();
    });
    expect(first.result.current.pendingNewRows.length).toBe(0);
    expect(first.result.current.canUndo).toBe(false);

    first.unmount();

    // Store entry should be either purged or cleared — either way the
    // re-mount must observe empty slices.
    const key = makeEntryKey("conn1", "db1", "public", "users");
    const entry = useDataGridEditStore.getState().getEntry(key);
    expect(entry.pendingEdits.size).toBe(0);
    expect(entry.pendingNewRows.length).toBe(0);
    expect(entry.pendingDeletedRowKeys.size).toBe(0);
    expect(entry.undoStack.length).toBe(0);

    const second = renderEditHook();
    expect(second.result.current.pendingNewRows.length).toBe(0);
    expect(second.result.current.canUndo).toBe(false);
  });

  it("[AC-251-H5] Sprint 249 / 250 invariants hold under store-backed state — undo + onBlur saveCurrentEdit", () => {
    const { result } = renderEditHook();

    // Sprint 249 invariant: handleAddRow → undo restores empty.
    act(() => {
      result.current.handleAddRow();
    });
    expect(result.current.canUndo).toBe(true);
    act(() => {
      result.current.undo();
    });
    expect(result.current.pendingNewRows.length).toBe(0);
    expect(result.current.canUndo).toBe(false);

    // Sprint 250 invariant: saveCurrentEdit (onBlur path) on a real
    // value-change persists like Tab/Enter.
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
    expect(result.current.editingCell).toBeNull();
    expect(result.current.canUndo).toBe(true);

    // Sprint 250 invariant: cancelEdit (Esc) on the editor does NOT push.
    act(() => {
      result.current.handleStartEdit(1, 1, "Bob");
    });
    act(() => {
      result.current.setEditValue("Bobby");
    });
    act(() => {
      result.current.cancelEdit();
    });
    // canUndo is still true from the Alicia push, but no NEW snapshot
    // arrived from cancel and no pending entry was added for row 1.
    expect(result.current.pendingEdits.has("1-1")).toBe(false);
  });
});
