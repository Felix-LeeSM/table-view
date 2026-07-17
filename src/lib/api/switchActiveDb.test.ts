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

  // Reason: DbSwitcher UI relies on every AppError variant reaching it
  // unchanged so it can toast the backend message. The wrapper is a pure
  // passthrough (no per-variant branch), so P9 table-drives the variants —
  // fails if the wrapper ever swallows or rewraps the rejection (#1643).
  it.each([
    ["Validation", "Validation: Database name must not be empty", "conn-1", ""],
    [
      "Unsupported",
      "Unsupported operation: Search paradigm has no per-connection database concept",
      "conn-search",
      "anything",
    ],
    ["NotFound", "Not found: Connection 'x'", "x", "any"],
  ])(
    "propagates backend %s rejection unchanged",
    async (_variant, message, connectionId, dbName) => {
      invokeMock.mockRejectedValueOnce(new Error(message));
      await expect(switchActiveDb(connectionId, dbName)).rejects.toThrow(
        message,
      );
    },
  );
});
