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

  it("propagates Unsupported rejection for paradigms that cannot verify", async () => {
    invokeMock.mockRejectedValueOnce(
      new Error(
        "Unsupported operation: verify_active_db not supported for this paradigm",
      ),
    );
    await expect(verifyActiveDb("conn-redis")).rejects.toThrow(/Unsupported/);
  });

  it("propagates NotFound when the connection id has no live adapter", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Not found: Connection 'x'"));
    await expect(verifyActiveDb("x")).rejects.toThrow(/Not found/);
  });
});
