// Issue #1204 — the dirty marker (`workspaceStore.dirtyTabIds`) was released
// on grid unmount, but a tab switch unmounts the inactive tab's grid while its
// pending edits stay alive in `rawQueryGridEditStore`. That left the close /
// disconnect guards reading a stale-false marker for inactive dirty tabs.
//
// Contract: the marker is derived from *pending edits existing*, not from the
// grid being mounted — so it must SURVIVE unmount as long as the store entry
// holds pending content. Cleanup happens through `removeTab` /
// `clearForConnection` (explicit close), not through React unmount.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRawQueryGridEdit } from "./useRawQueryGridEdit";
import { useRawQueryGridEditStore } from "@stores/rawQueryGridEditStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { emptyWorkspace } from "@/stores/__tests__/workspaceStoreTestHelpers";
import type { QueryResult } from "@/types/query";
import type { RawEditPlan } from "@lib/sql/rawQuerySqlBuilder";

vi.mock("@lib/tauri", () => ({ executeQueryBatch: vi.fn() }));
vi.mock("@lib/runtime/history/recordHistoryEntry", () => ({
  recordHistoryEntry: vi.fn(),
}));
vi.mock("@lib/runtime/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock("@/hooks/useSafeModeGate", () => ({
  useSafeModeGate: () => ({ decide: () => ({ action: "allow", reason: "" }) }),
}));

// Keep the REAL workspaceStore so `setTabDirty` mutates real `dirtyTabIds`;
// only pin the workspace coordinate the hook resolves.
vi.mock("@stores/workspaceStore", async (importActual) => {
  const actual = await importActual<typeof import("@stores/workspaceStore")>();
  return {
    ...actual,
    useCurrentWorkspaceKey: () => ({ connId: "conn1", db: "db1" }),
  };
});

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

function renderEditHook(tabId = "tab-1") {
  return renderHook(() =>
    useRawQueryGridEdit({
      result: RESULT,
      connectionId: "conn1",
      plan: PLAN,
      tabId,
    }),
  );
}

function currentDirty(): string[] {
  return [
    ...(useWorkspaceStore.getState().workspaces.conn1?.db1?.dirtyTabIds ?? []),
  ];
}

describe("useRawQueryGridEdit — Issue #1204 dirty marker survives unmount", () => {
  beforeEach(() => {
    useRawQueryGridEditStore.setState({ entries: new Map() });
    useWorkspaceStore.setState({
      workspaces: { conn1: { db1: emptyWorkspace() } },
    });
  });

  it("keeps the tab in dirtyTabIds after the grid unmounts while edits are still pending", () => {
    const hook = renderEditHook("tab-1");
    act(() => hook.result.current.startEdit(0, 1));
    act(() => hook.result.current.setEditValue("Alicia"));
    act(() => hook.result.current.saveCurrentEdit());

    expect(currentDirty()).toContain("tab-1");

    // Tab switch = the inactive tab's grid unmounts, but its pending edit
    // lives on in `rawQueryGridEditStore`.
    hook.unmount();

    // Regression: the marker must NOT be cleared by unmount.
    expect(currentDirty()).toContain("tab-1");
  });

  it("clears the marker when the pending diff empties (discard, self-heal)", () => {
    const hook = renderEditHook("tab-1");
    act(() => hook.result.current.startEdit(0, 1));
    act(() => hook.result.current.setEditValue("Alicia"));
    act(() => hook.result.current.saveCurrentEdit());
    expect(currentDirty()).toContain("tab-1");

    // Discard empties the store entry — the still-mounted effect must flip
    // the marker back off, so removing the unmount cleanup did not strand a
    // stale-true marker.
    act(() => hook.result.current.handleDiscard());
    expect(currentDirty()).not.toContain("tab-1");
  });
});
