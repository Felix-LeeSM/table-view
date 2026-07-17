import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { switchActiveDb } from "./switchActiveDb";

describe("switchActiveDb (Sprint 130 wrapper)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("invokes the unified `switch_active_db` command with connection id and db name", async () => {
    invokeMock.mockResolvedValueOnce(undefined);

    await switchActiveDb("conn-1", "analytics");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("switch_active_db", {
      connectionId: "conn-1",
      dbName: "analytics",
    });
  });

  it("propagates backend rejection unchanged (Validation / Unsupported / NotFound)", async () => {
    invokeMock.mockRejectedValueOnce(
      new Error("Validation: Database name must not be empty"),
    );
    await expect(switchActiveDb("conn-1", "")).rejects.toThrow(/Validation/);
  });
});
