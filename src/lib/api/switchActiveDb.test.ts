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

  it("resolves with void when the backend successfully flipped the active pool", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await expect(
      switchActiveDb("conn-1", "analytics"),
    ).resolves.toBeUndefined();
  });

  it("propagates Validation rejection when the backend rejects an empty db name", async () => {
    invokeMock.mockRejectedValueOnce(
      new Error("Validation: Database name must not be empty"),
    );
    await expect(switchActiveDb("conn-1", "")).rejects.toThrow(/Validation/);
  });

  it("propagates Unsupported rejection for paradigms that do not support switching", async () => {
    invokeMock.mockRejectedValueOnce(
      new Error(
        "Unsupported operation: Search paradigm has no per-connection database concept",
      ),
    );
    await expect(switchActiveDb("conn-redis", "anything")).rejects.toThrow(
      /Unsupported/,
    );
  });

  it("propagates NotFound when the connection id has no live adapter", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Not found: Connection 'x'"));
    await expect(switchActiveDb("x", "any")).rejects.toThrow(/Not found/);
  });
});
