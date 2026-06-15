import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import type { SafeModeGate } from "@hooks/useSafeModeGate";
import { useMongoBulkOps } from "./useMongoBulkOps";

const mockRecordHistoryEntry = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock("@lib/runtime/history/recordHistoryEntry", () => ({
  recordHistoryEntry: (...args: unknown[]) => mockRecordHistoryEntry(...args),
}));

vi.mock("@/lib/runtime/toast", () => ({
  toast: {
    success: (msg: string) => toastSuccess(msg),
    error: (msg: string) => toastError(msg),
  },
}));

function gateAllowAll(): SafeModeGate {
  return { decide: () => ({ action: "allow" }) };
}

function renderBulkOps(
  overrides: Partial<Parameters<typeof useMongoBulkOps>[0]> = {},
) {
  return renderHook(() =>
    useMongoBulkOps({
      connectionId: "conn-mongo",
      database: "app",
      collection: "users",
      activeFilter: { status: "stale" },
      safeModeGate: gateAllowAll(),
      fetchData: vi.fn(),
      ...overrides,
    }),
  );
}

describe("useMongoBulkOps", () => {
  const deleteMany = vi.fn<(...args: unknown[]) => Promise<number>>();
  const updateMany = vi.fn<(...args: unknown[]) => Promise<number>>();

  beforeEach(() => {
    vi.clearAllMocks();
    setupTauriMock({
      deleteMany: (...args: unknown[]) => deleteMany(...args),
      updateMany: (...args: unknown[]) => updateMany(...args),
    });
  });

  it("deleteMany failure keeps the dialog open with partial-commit copy and exact MQL history", async () => {
    deleteMany.mockRejectedValueOnce(new Error("write concern failed"));
    const { result } = renderBulkOps({
      activeFilter: {
        status: "stale",
        _id: { $oid: "507f1f77bcf86cd799439011" },
      },
    });

    act(() => {
      result.current.handleDeleteManyClick();
    });
    await act(async () => {
      await result.current.handleConfirmDeleteMany();
    });

    expect(deleteMany).toHaveBeenCalledWith(
      "conn-mongo",
      "app",
      "users",
      { status: "stale", _id: { $oid: "507f1f77bcf86cd799439011" } },
      true,
    );
    expect(result.current.deleteManyDialogOpen).toBe(true);
    expect(result.current.deleteManyError).toContain(
      "deleteMany is not wrapped in a transaction",
    );
    expect(result.current.deleteManyError).toContain(
      "some matched documents may already be deleted",
    );
    expect(result.current.deleteManyError).toContain(
      "Retry only after reviewing the current collection state",
    );
    expect(result.current.deleteManyError).toContain("write concern failed");
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining("Failed to delete: deleteMany is not wrapped"),
    );
    expect(mockRecordHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: 'db.users.deleteMany({"status":"stale","_id":{"$oid":"507f1f77bcf86cd799439011"}})',
        status: "error",
        queryMode: "deleteMany",
      }),
    );
  });

  it("updateMany failure keeps inline error, warning copy, and exact MQL history", async () => {
    updateMany.mockRejectedValueOnce(new Error("duplicate key"));
    const { result } = renderBulkOps({
      activeFilter: { status: "pending" },
    });

    act(() => {
      result.current.handleUpdateManyClick();
    });
    act(() => {
      result.current.setUpdatePatchInput('{ "status": "archived" }');
    });
    await act(async () => {
      await result.current.handleConfirmUpdateMany();
    });

    expect(updateMany).toHaveBeenCalledWith(
      "conn-mongo",
      "app",
      "users",
      { status: "pending" },
      { status: "archived" },
      true,
    );
    expect(result.current.updateManyDialogOpen).toBe(true);
    expect(result.current.updateManyError).toContain(
      "updateMany is not wrapped in a transaction",
    );
    expect(result.current.updateManyError).toContain(
      "some matched documents may already be updated",
    );
    expect(result.current.updateManyError).toContain(
      "Retry only after reviewing the current collection state",
    );
    expect(result.current.updateManyError).toContain("duplicate key");
    expect(mockRecordHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: 'db.users.updateMany({"status":"pending"}, { $set: {"status":"archived"} })',
        status: "error",
        queryMode: "updateMany",
      }),
    );
  });
});
