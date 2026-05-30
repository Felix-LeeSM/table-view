import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { explainMongoFind, explainRdbQuery } from "./explain";

describe("Explain Tauri wrappers", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("passes expectedDatabase through PostgreSQL explain IPC", async () => {
    invokeMock.mockResolvedValueOnce([{ Plan: { "Node Type": "Seq Scan" } }]);

    await explainRdbQuery("conn-1", "SELECT 1", "app");

    expect(invokeMock).toHaveBeenCalledWith("explain_rdb_query", {
      connectionId: "conn-1",
      sql: "SELECT 1",
      expectedDatabase: "app",
    });
  });

  it("sends null expectedDatabase when PostgreSQL explain has no workspace database", async () => {
    invokeMock.mockResolvedValueOnce([{ Plan: { "Node Type": "Seq Scan" } }]);

    await explainRdbQuery("conn-1", "SELECT 1");

    expect(invokeMock).toHaveBeenCalledWith("explain_rdb_query", {
      connectionId: "conn-1",
      sql: "SELECT 1",
      expectedDatabase: null,
    });
  });

  it("keeps Mongo explain payload unchanged", async () => {
    invokeMock.mockResolvedValueOnce({ ok: 1 });

    await explainMongoFind("conn-m", {
      database: "db",
      collection: "users",
      filter: { active: true },
      verbosity: "executionStats",
    });

    expect(invokeMock).toHaveBeenCalledWith("explain_mongo_find", {
      connectionId: "conn-m",
      database: "db",
      collection: "users",
      filter: { active: true },
      verbosity: "executionStats",
    });
  });
});
