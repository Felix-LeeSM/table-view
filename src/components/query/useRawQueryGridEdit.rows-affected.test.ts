// #1441 P3-3 — the raw-query grid commit (`runBatch`) used to discard the
// `executeQueryBatch` result, so a 0-row / partial write passed as a silent
// success. It now cross-checks each statement's `rows_affected` against the
// one-row-per-PK-statement intent and warns on a mismatch.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRawQueryGridEdit } from "./useRawQueryGridEdit";
import { useRawQueryGridEditStore } from "@stores/rawQueryGridEditStore";
import type { QueryResult } from "@/types/query";
import type { RawEditPlan } from "@lib/sql/rawQuerySqlBuilder";

const mockExecuteQueryBatch = vi.fn();
const mockToastWarning = vi.fn();
const WORKSPACE_KEY = { connId: "conn1", db: "db1" };

vi.mock("@lib/tauri", () => ({
  executeQueryBatch: (...args: unknown[]) => mockExecuteQueryBatch(...args),
}));
vi.mock("@lib/runtime/history/recordHistoryEntry", () => ({
  recordHistoryEntry: vi.fn(),
}));
vi.mock("@lib/runtime/toast", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: (...args: unknown[]) => mockToastWarning(...args),
  },
}));
vi.mock("@/hooks/useSafeModeGate", () => ({
  useSafeModeGate: () => ({ decide: () => ({ action: "allow", reason: "" }) }),
}));
vi.mock("@stores/workspaceStore", () => ({
  useCurrentWorkspaceKey: () => WORKSPACE_KEY,
  useWorkspaceStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ setTabDirty: vi.fn() }),
}));

const RESULT: QueryResult = {
  columns: [
    { name: "id", dataType: "integer", category: "unknown" },
    { name: "name", dataType: "text", category: "unknown" },
  ],
  rows: [[1, "Alice"]],
  totalCount: 1,
  executionTimeMs: 5,
  queryType: "select",
};

const PLAN: RawEditPlan = {
  schema: "public",
  table: "users",
  pkColumns: ["id"],
  resultColumnNames: ["id", "name"],
};

function renderEditHook() {
  return renderHook(() =>
    useRawQueryGridEdit({
      result: RESULT,
      connectionId: "conn1",
      plan: PLAN,
      tabId: "tab-1",
    }),
  );
}

function editAndCommit(hook: ReturnType<typeof renderEditHook>, value: string) {
  act(() => hook.result.current.startEdit(0, 1));
  act(() => hook.result.current.setEditValue(value));
  act(() => hook.result.current.saveCurrentEdit());
  act(() => hook.result.current.handleCommit());
}

const dmlResult = (rows_affected: number): QueryResult => ({
  columns: [],
  rows: [],
  totalCount: 0,
  executionTimeMs: 1,
  queryType: { dml: { rows_affected } },
});

describe("useRawQueryGridEdit — rows_affected cross-check (#1441 P3-3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRawQueryGridEditStore.setState({ entries: new Map() });
  });

  it("warns when the committed batch affected 0 rows", async () => {
    mockExecuteQueryBatch.mockResolvedValue([dmlResult(0)]);
    const hook = renderEditHook();
    editAndCommit(hook, "Alicia");

    await act(async () => {
      await hook.result.current.handleExecute();
    });

    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
    expect(mockToastWarning).toHaveBeenCalledTimes(1);
    expect(mockToastWarning).toHaveBeenCalledWith(
      expect.stringContaining("0 row"),
    );
  });

  it("stays silent when every statement affected exactly one row", async () => {
    mockExecuteQueryBatch.mockResolvedValue([dmlResult(1)]);
    const hook = renderEditHook();
    editAndCommit(hook, "Alicia");

    await act(async () => {
      await hook.result.current.handleExecute();
    });

    expect(mockToastWarning).not.toHaveBeenCalled();
  });
});
