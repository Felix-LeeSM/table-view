import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExportContext } from "@/lib/tauri";

// runExport drives the save dialog + `exportGridRows` IPC. Both live at module
// boundaries, so mock them; assert the toast branching (#1269 cancel path) via
// spies on the toast facade.
const mockSave = vi.fn();
const mockExportGridRows = vi.fn();
const toastInfo = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (opts: unknown) => mockSave(opts),
}));

vi.mock("@/lib/tauri", () => ({
  exportGridRows: (...args: unknown[]) => mockExportGridRows(...args),
}));

vi.mock("@/lib/runtime/toast", () => ({
  toast: {
    info: (message: string) => toastInfo(message),
    error: (message: string) => toastError(message),
    success: (message: string) => toastSuccess(message),
  },
}));

import { runExport } from "./index";

const CONTEXT: ExportContext = { kind: "table", schema: "public", name: "t" };

function baseArgs() {
  return {
    format: "csv" as const,
    context: CONTEXT,
    headers: ["id"],
    rows: [[1]],
    exportId: "export-1",
  };
}

describe("runExport (#1269 cancellation)", () => {
  beforeEach(() => {
    mockSave.mockReset();
    mockExportGridRows.mockReset();
    toastInfo.mockReset();
    toastError.mockReset();
    toastSuccess.mockReset();
  });

  it("treats a backend cancel error as cancellation, not failure", async () => {
    mockSave.mockResolvedValueOnce("/tmp/out.csv");
    mockExportGridRows.mockRejectedValueOnce(
      new Error("Validation error: Export cancelled"),
    );

    const result = await runExport(baseArgs());

    expect(result).toEqual({ kind: "cancelled" });
    expect(toastInfo).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("still surfaces a real I/O error as a destructive toast", async () => {
    mockSave.mockResolvedValueOnce("/tmp/out.csv");
    mockExportGridRows.mockRejectedValueOnce(new Error("disk full"));

    await expect(runExport(baseArgs())).rejects.toThrow(/disk full/);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it("stays silent when the save dialog is dismissed", async () => {
    mockSave.mockResolvedValueOnce(null);

    const result = await runExport(baseArgs());

    expect(result).toEqual({ kind: "cancelled" });
    expect(mockExportGridRows).not.toHaveBeenCalled();
    expect(toastInfo).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });
});
