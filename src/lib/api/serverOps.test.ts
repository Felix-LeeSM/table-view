import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { collectionStatsMongo, collectionStatsRdb } from "./collectionStats";
import { killServerActivity, listServerActivity } from "./serverActivity";
import { serverInfo } from "./serverInfo";
import { slowQueries } from "./slowQueries";

describe("server operations API wrappers", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("routes collection stats by paradigm-specific target coordinates", async () => {
    invokeMock
      .mockResolvedValueOnce({
        rows: 10,
        sizeBytes: 2048,
        indexes: 2,
        lastVacuum: null,
        lastAnalyze: null,
        seqScans: 1,
        idxScans: 3,
        nDead: 0,
        extras: {},
      })
      .mockResolvedValueOnce({
        rows: 5,
        sizeBytes: 1024,
        indexes: 1,
        lastVacuum: null,
        lastAnalyze: null,
        seqScans: null,
        idxScans: null,
        nDead: null,
        extras: { storageSize: 1024 },
      });

    await expect(
      collectionStatsRdb("pg-1", "public", "users"),
    ).resolves.toEqual(expect.objectContaining({ rows: 10 }));
    await expect(
      collectionStatsMongo("mongo-1", "shop", "orders"),
    ).resolves.toEqual(expect.objectContaining({ rows: 5 }));

    expect(invokeMock.mock.calls).toEqual([
      [
        "collection_stats_rdb",
        { connectionId: "pg-1", schema: "public", table: "users" },
      ],
      [
        "collection_stats_mongo",
        { connectionId: "mongo-1", database: "shop", collection: "orders" },
      ],
    ]);
  });

  it("keeps server activity list and kill as distinct IPC commands", async () => {
    invokeMock
      .mockResolvedValueOnce([
        {
          id: 42,
          db: "app",
          user: "postgres",
          state: "active",
          query: "select 1",
          waitEvent: null,
          startedAt: "2026-06-09T00:00:00Z",
        },
      ])
      .mockResolvedValueOnce(undefined);

    const rows = await listServerActivity("pg-1");
    await killServerActivity("pg-1", 42);

    expect(rows[0]?.id).toBe(42);
    expect(invokeMock.mock.calls).toEqual([
      ["list_server_activity", { connectionId: "pg-1" }],
      ["kill_server_activity", { connectionId: "pg-1", id: 42 }],
    ]);
  });

  it("propagates server info and slow query limits without client-side fallback", async () => {
    invokeMock
      .mockResolvedValueOnce({
        version: "PostgreSQL 16",
        host: "localhost",
        uptimeSec: 60,
        connectionsActive: 2,
        extras: { maxConnections: 100 },
      })
      .mockResolvedValueOnce([
        {
          query: "select * from users",
          calls: 5,
          totalExecTimeMs: 25,
          meanExecTimeMs: 5,
          rows: 10,
          extras: {},
        },
      ]);

    await expect(serverInfo("pg-1")).resolves.toEqual(
      expect.objectContaining({ version: "PostgreSQL 16" }),
    );
    await expect(slowQueries("pg-1", 50)).resolves.toHaveLength(1);

    expect(invokeMock.mock.calls).toEqual([
      ["server_info", { connectionId: "pg-1" }],
      ["slow_queries", { connectionId: "pg-1", limit: 50 }],
    ]);
  });

  it("surfaces backend rejections instead of manufacturing false-success rows", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Unsupported operation"));

    await expect(serverInfo("redis-1")).rejects.toThrow(/Unsupported/);
  });
});
