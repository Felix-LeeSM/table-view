import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { clearMru, persistMru } from "./mru";

const invokeMock = vi.mocked(invoke);

describe("MRU Tauri wrapper", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it("persists MRU entries with the existing IPC payload shape", async () => {
    const entries = [{ connectionId: "conn-1", lastUsed: 100 }];

    await persistMru(entries);

    expect(invokeMock).toHaveBeenCalledWith("persist_mru", { entries });
  });

  it("clears MRU through the existing IPC command", async () => {
    await clearMru();

    expect(invokeMock).toHaveBeenCalledWith("clear_mru");
  });
});
