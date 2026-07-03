// Issue #1204 — the dirty marker (`workspaceStore.dirtyTabIds`) was released
// on grid unmount, but MainArea only mounts the active tab, so switching tabs
// unmounts an inactive tab whose pending edits stay alive in
// `dataGridEditStore`. The close / disconnect guards then read a stale-false
// marker for that inactive dirty tab and skip the confirmation.
//
// Contract: the marker tracks *pending edits existing* (store-backed), not the
// grid being mounted — it must SURVIVE unmount. Cleanup is `removeTab` /
// `clearForConnection` (explicit close), not React unmount.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDataGridEdit } from "./useDataGridEdit";
import { useDataGridEditStore } from "@stores/dataGridEditStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { emptyWorkspace } from "@/stores/__tests__/workspaceStoreTestHelpers";
import type { TableData } from "@/types/schema";

vi.mock("@stores/schemaStore", () => ({
  useSchemaStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ executeQuery: vi.fn(), executeQueryBatch: vi.fn() }),
}));

// Keep the REAL workspaceStore so `setTabDirty` mutates real `dirtyTabIds`;
// only pin the active tab id + workspace coordinate the hook resolves.
vi.mock("@stores/workspaceStore", async (importActual) => {
  const actual = await importActual<typeof import("@stores/workspaceStore")>();
  return {
    ...actual,
    useActiveTabId: () => "tab-1",
    useCurrentWorkspaceKey: () => ({ connId: "conn1", db: "db1" }),
  };
});

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
      schema: "public",
      table: "users",
      database: "db1",
      connectionId: "conn1",
      page: 1,
      fetchData: vi.fn(),
    }),
  );
}

function currentDirty(): string[] {
  return [
    ...(useWorkspaceStore.getState().workspaces.conn1?.db1?.dirtyTabIds ?? []),
  ];
}

describe("useDataGridEdit — Issue #1204 dirty marker survives unmount", () => {
  beforeEach(() => {
    useDataGridEditStore.setState({ entries: new Map() });
    useWorkspaceStore.setState({
      workspaces: { conn1: { db1: emptyWorkspace() } },
    });
  });

  it("keeps the tab in dirtyTabIds after the grid unmounts while edits are still pending", () => {
    const hook = renderEditHook();
    act(() => hook.result.current.handleStartEdit(0, 1, "Alice"));
    act(() => hook.result.current.setEditValue("Alicia"));
    act(() => hook.result.current.saveCurrentEdit());

    expect(currentDirty()).toContain("tab-1");

    // Tab switch = the inactive tab's grid unmounts, but its pending edit
    // lives on in `dataGridEditStore`.
    hook.unmount();

    // Regression: the marker must NOT be cleared by unmount.
    expect(currentDirty()).toContain("tab-1");
  });
});
