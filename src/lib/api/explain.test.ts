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
      queryId: null,
    });
  });

  it("threads the cooperative cancel queryId through PostgreSQL explain IPC", async () => {
    invokeMock.mockResolvedValueOnce([{ Plan: { "Node Type": "Seq Scan" } }]);

    await explainRdbQuery("conn-1", "SELECT 1", "app", "explain-42");

    expect(invokeMock).toHaveBeenCalledWith("explain_rdb_query", {
      connectionId: "conn-1",
      sql: "SELECT 1",
      expectedDatabase: "app",
      queryId: "explain-42",
    });
  });

  it("sends null expectedDatabase when PostgreSQL explain has no workspace database", async () => {
    invokeMock.mockResolvedValueOnce([{ Plan: { "Node Type": "Seq Scan" } }]);

    await explainRdbQuery("conn-1", "SELECT 1");

    expect(invokeMock).toHaveBeenCalledWith("explain_rdb_query", {
      connectionId: "conn-1",
      sql: "SELECT 1",
      expectedDatabase: null,
      queryId: null,
    });
  });

  it("[#1210] forwards the full find body (filter/sort/limit/projection) so the plan matches execution", async () => {
    invokeMock.mockResolvedValueOnce({ ok: 1 });

    await explainMongoFind("conn-m", {
      database: "db",
      collection: "users",
      body: {
        filter: { active: true },
        sort: { name: -1 },
        projection: { name: 1 },
        limit: 10,
        skip: 5,
      },
      verbosity: "executionStats",
    });

    expect(invokeMock).toHaveBeenCalledWith("explain_mongo_find", {
      connectionId: "conn-m",
      database: "db",
      collection: "users",
      body: {
        filter: { active: true },
        sort: { name: -1 },
        projection: { name: 1 },
        limit: 10,
        skip: 5,
      },
      verbosity: "executionStats",
      queryId: null,
    });
  });

  it("threads the cooperative cancel queryId through Mongo explain IPC", async () => {
    invokeMock.mockResolvedValueOnce({ ok: 1 });

    await explainMongoFind(
      "conn-m",
      { database: "db", collection: "users" },
      "explain-7",
    );

    expect(invokeMock).toHaveBeenCalledWith("explain_mongo_find", {
      connectionId: "conn-m",
      database: "db",
      collection: "users",
      body: {},
      verbosity: "queryPlanner",
      queryId: "explain-7",
    });
  });
});
