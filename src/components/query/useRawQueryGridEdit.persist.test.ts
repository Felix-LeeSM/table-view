// Issue #1102 — raw-query result grid edits used to live in the hook's
// `useState`, so a tab switch (which unmounts the grid via MainArea's
// `key={activeTab.id}`) discarded them silently and never marked the tab
// dirty. These regression tests lock the fix: pending edits now live in the
// cross-mount `rawQueryGridEditStore` keyed by `(connectionId, tabId)`, and
// the hook wires `setTabDirty` symmetrically with `useDataGridEdit`.
//
// Covers the issue's acceptance criteria:
//   (a) edit → unmount (tab switch) → remount same tab → edit preserved.
//   (b) edit present → tab registered dirty (`setTabDirty(..., true)`).
//   (c) discard / successful commit → dirty cleared (`setTabDirty(..., false)`).
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConnectionId, TabId } from "@/types/branded";
import { renderHook, act } from "@testing-library/react";
import { useRawQueryGridEdit } from "./useRawQueryGridEdit";
import {
  useRawQueryGridEditStore,
  rawEntryKey,
} from "@stores/rawQueryGridEditStore";
import type { QueryResult } from "@/types/query";
import type { RawEditPlan } from "@lib/sql/rawQuerySqlBuilder";

const mockExecuteQueryBatch = vi.fn();
const mockSetTabDirty = vi.fn();
const WORKSPACE_KEY = { connId: "conn1", db: "db1" };

vi.mock("@lib/tauri", () => ({
  executeQueryBatch: (...args: unknown[]) => mockExecuteQueryBatch(...args),
}));

vi.mock("@lib/runtime/history/recordHistoryEntry", () => ({
  recordHistoryEntry: vi.fn(),
}));

vi.mock("@lib/runtime/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// Safe Mode gate → always allow so `handleExecute` reaches the batch runner
// without a confirm/block detour (Safe Mode is exercised elsewhere).
vi.mock("@/hooks/useSafeModeGate", () => ({
  useSafeModeGate: () => ({ decide: () => ({ action: "allow", reason: "" }) }),
}));

vi.mock("@stores/workspaceStore", () => ({
  useCurrentWorkspaceKey: () => WORKSPACE_KEY,
  useWorkspaceStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ setTabDirty: mockSetTabDirty }),
}));

const RESULT: QueryResult = {
  columns: [
    { name: "id", dataType: "integer", category: "unknown" },
    { name: "name", dataType: "text", category: "unknown" },
  ],
  rows: [
    [1, "Alice"],
    [2, "Bob"],
  ],
  totalCount: 2,
  executionTimeMs: 5,
  queryType: "select",
};

const PLAN: RawEditPlan = {
  schema: "public",
  table: "users",
  pkColumns: ["id"],
  resultColumnNames: ["id", "name"],
};

function renderEditHook(tabId: string | undefined = "tab-1") {
  return renderHook(() =>
    useRawQueryGridEdit({
      result: RESULT,
      connectionId: "conn1",
      plan: PLAN,
      tabId,
    }),
  );
}

function editNameCell(
  hook: ReturnType<typeof renderEditHook>,
  rowIdx: number,
  value: string,
) {
  act(() => hook.result.current.startEdit(rowIdx, 1));
  act(() => hook.result.current.setEditValue(value));
  act(() => hook.result.current.saveCurrentEdit());
}

describe("useRawQueryGridEdit — Issue #1102 cross-mount persistence + dirty", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRawQueryGridEditStore.setState({ entries: new Map() });
  });

  it("(a) preserves pending edits across unmount → remount on the same tab", () => {
    const first = renderEditHook("tab-1");
    editNameCell(first, 0, "Alicia");
    act(() => first.result.current.deleteRow(1));

    expect(first.result.current.pendingEdits.get("0-1")).toBe("Alicia");
    expect(first.result.current.pendingDeletedRowKeys.has("row-1-1")).toBe(
      true,
    );

    // Tab switch = unmount.
    first.unmount();

    // Return to the tab = remount with the same (connectionId, tabId).
    const second = renderEditHook("tab-1");
    expect(second.result.current.pendingEdits.get("0-1")).toBe("Alicia");
    expect(second.result.current.pendingDeletedRowKeys.has("row-1-1")).toBe(
      true,
    );
  });

  it("(a') a different tab id starts empty (no cross-tab bleed)", () => {
    const first = renderEditHook("tab-1");
    editNameCell(first, 0, "Alicia");
    first.unmount();

    const other = renderEditHook("tab-2");
    expect(other.result.current.pendingEdits.size).toBe(0);
    expect(other.result.current.pendingDeletedRowKeys.size).toBe(0);
  });

  it("(b) registers the tab dirty when an edit exists", () => {
    const hook = renderEditHook("tab-1");
    // Baseline mount registers not-dirty.
    expect(mockSetTabDirty).toHaveBeenLastCalledWith(
      "conn1",
      "db1",
      "tab-1",
      false,
    );

    editNameCell(hook, 0, "Alicia");
    expect(mockSetTabDirty).toHaveBeenLastCalledWith(
      "conn1",
      "db1",
      "tab-1",
      true,
    );
  });

  it("(c) clears dirty on discard", () => {
    const hook = renderEditHook("tab-1");
    editNameCell(hook, 0, "Alicia");
    expect(hook.result.current.hasPendingChanges).toBe(true);

    act(() => hook.result.current.handleDiscard());

    expect(hook.result.current.hasPendingChanges).toBe(false);
    expect(hook.result.current.pendingEdits.size).toBe(0);
    expect(mockSetTabDirty).toHaveBeenLastCalledWith(
      "conn1",
      "db1",
      "tab-1",
      false,
    );
    // Store entry gone → a fresh mount sees empty.
    const entry = useRawQueryGridEditStore
      .getState()
      .getEntry(rawEntryKey("conn1" as ConnectionId, "tab-1" as TabId));
    expect(entry.pendingEdits.size).toBe(0);
  });

  it("(c) clears dirty + store entry after a successful commit", async () => {
    mockExecuteQueryBatch.mockResolvedValue([]);
    const hook = renderEditHook("tab-1");
    editNameCell(hook, 0, "Alicia");

    act(() => hook.result.current.handleCommit());
    expect(hook.result.current.sqlPreview).not.toBeNull();

    await act(async () => {
      await hook.result.current.handleExecute();
    });

    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
    expect(hook.result.current.hasPendingChanges).toBe(false);
    expect(mockSetTabDirty).toHaveBeenLastCalledWith(
      "conn1",
      "db1",
      "tab-1",
      false,
    );
    const entry = useRawQueryGridEditStore
      .getState()
      .getEntry(rawEntryKey("conn1" as ConnectionId, "tab-1" as TabId));
    expect(entry.pendingEdits.size).toBe(0);
  });
});
