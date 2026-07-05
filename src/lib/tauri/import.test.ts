import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => invoke(...a),
}));

import { readTextFileImport } from "./import";

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
