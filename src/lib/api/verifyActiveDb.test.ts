import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { verifyActiveDb } from "./verifyActiveDb";

describe("verifyActiveDb (Sprint 132 wrapper)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("invokes the `verify_active_db` command with the connection id (arg shape)", async () => {
    invokeMock.mockResolvedValueOnce("admin");

    await verifyActiveDb("conn-1");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("verify_active_db", {
      connectionId: "conn-1",
    });
  });

  it("resolves with the backend-reported database name (happy path)", async () => {
    invokeMock.mockResolvedValueOnce("analytics");
    await expect(verifyActiveDb("conn-1")).resolves.toBe("analytics");
  });

  it("propagates backend rejection unchanged (Unsupported / NotFound)", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Not found: Connection 'x'"));
    await expect(verifyActiveDb("x")).rejects.toThrow(/Not found/);
  });
});
