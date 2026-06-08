import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyMssql, dropMssqlDatabase } from "./mssql.js";

const { connectMock, queryCalls } = vi.hoisted(() => {
  const queryCalls: string[] = [];
  const request = {
    input: vi.fn(() => request),
    query: vi.fn(async (sql: string) => {
      queryCalls.push(sql);
      return { recordset: [] };
    }),
  };
  const pool = {
    request: vi.fn(() => request),
    close: vi.fn(async () => {}),
  };

  return {
    connectMock: vi.fn(async () => pool),
    queryCalls,
  };
});

vi.mock("mssql", () => ({
  default: {
    connect: connectMock,
    NVarChar: "NVarChar",
  },
}));

describe("mssql fixture database reset", () => {
  beforeEach(() => {
    queryCalls.length = 0;
  });

  it("passes DB_ID a string parameter instead of a bracketed identifier", async () => {
    await dropMssqlDatabase(
      {
        host: "localhost",
        port: 14333,
        user: "sa",
        password: "Testpass123!",
        database: "master",
      },
      "table_view_e2e",
    );

    const sql = queryCalls.join("\n");
    expect(sql).toContain("DB_ID(@name)");
    expect(sql).not.toContain("DB_ID([table_view_e2e])");
  });

  it("maps text columns over 4000 characters to NVARCHAR(MAX)", async () => {
    await applyMssql(
      {
        host: "localhost",
        port: 14333,
        user: "sa",
        password: "Testpass123!",
        database: "master",
      },
      "table_view_e2e",
      {
        profile: "e2e",
        profileSpec: {
          seed: 1,
          database: { pg: "pg", mongo: "mongo", mssql: "table_view_e2e" },
          locale_mix: { en: 1 },
          rows: { posts: 0 },
        },
        base: {
          entities: {
            posts: {
              targets: ["mssql"],
              mssql: { schema: "dbo", table: "posts" },
              columns: {
                id: { type: "uuid", primary: true },
                body: { type: "text", max_length: 5000, nullable: true },
              },
            },
          },
        },
      },
      { posts: [] },
      () => {},
    );

    const ddl = queryCalls.find((sql) =>
      sql.includes("CREATE TABLE [dbo].[posts]"),
    );
    expect(ddl).toContain("[body] NVARCHAR(MAX)");
    expect(ddl).not.toContain("NVARCHAR(5000)");
  });
});
