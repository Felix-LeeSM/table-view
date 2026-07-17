import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => invoke(...a),
}));

import { previewCsvImport, readTextFileImport } from "./import";

describe("readTextFileImport", () => {
  beforeEach(() => invoke.mockReset());

  it("invokes read_text_file_import with the picked absolute path", async () => {
    invoke.mockResolvedValue("SELECT 1;\n");
    const content = await readTextFileImport("/tmp/dump.sql");
    expect(invoke).toHaveBeenCalledWith("read_text_file_import", {
      sourcePath: "/tmp/dump.sql",
    });
    expect(content).toBe("SELECT 1;\n");
  });

  it("propagates backend errors (e.g. oversized / non-UTF-8 file)", async () => {
    invoke.mockImplementationOnce(() =>
      Promise.reject(new Error("Import file is too large")),
    );
    await expect(readTextFileImport("/tmp/big.sql")).rejects.toThrow(
      /too large/,
    );
  });
});

// Reason: #1639 Stage 1 — verify the CSV preview wrapper forwards the picked
// path + options and returns the streamed preview payload (2026-07-17).
describe("previewCsvImport", () => {
  beforeEach(() => invoke.mockReset());

  it("invokes preview_csv_import with the picked path and options", async () => {
    const payload = {
      headers: ["id", "name"],
      row_count: 2,
      preview_rows: [
        ["1", "ada"],
        ["2", "alan"],
      ],
    };
    invoke.mockResolvedValue(payload);
    const preview = await previewCsvImport("/tmp/people.csv", {
      hasHeader: true,
      delimiter: ";",
    });
    expect(invoke).toHaveBeenCalledWith("preview_csv_import", {
      sourcePath: "/tmp/people.csv",
      options: { hasHeader: true, delimiter: ";" },
    });
    expect(preview).toEqual(payload);
  });

  it("propagates backend guard rejections (e.g. app-internal path)", async () => {
    invoke.mockImplementationOnce(() =>
      Promise.reject(
        new Error(
          "Local file path cannot target the internal app data directory",
        ),
      ),
    );
    await expect(previewCsvImport("/tmp/secret.csv")).rejects.toThrow(
      /internal app data directory/,
    );
  });
});
