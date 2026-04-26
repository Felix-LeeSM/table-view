import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { listDatabases } from "./listDatabases";

describe("listDatabases (Sprint 128 wrapper)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("invokes the unified `list_databases` command with the connection id", async () => {
    invokeMock.mockResolvedValueOnce([
      { name: "admin" },
      { name: "table_view_test" },
    ]);

    const result = await listDatabases("conn-1");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("list_databases", {
      connectionId: "conn-1",
    });
    expect(result).toEqual([{ name: "admin" }, { name: "table_view_test" }]);
  });

  it("propagates an empty array when the backend returns one (search/kv paradigm)", async () => {
    invokeMock.mockResolvedValueOnce([]);
    const result = await listDatabases("conn-redis");
    expect(result).toEqual([]);
  });

  it("propagates the rejection when the backend errors", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Not found: Connection 'x'"));
    await expect(listDatabases("x")).rejects.toThrow(/Not found/);
  });
});
