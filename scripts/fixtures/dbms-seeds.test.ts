import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DBMS_SEED_FILES = [
  ["postgresql", "seed.sql"],
  ["mysql", "seed.mysql.sql"],
  ["mariadb", "seed.mariadb.sql"],
  ["sqlite", "seed.sqlite.sql"],
  ["duckdb", "seed.duckdb.sql"],
  ["mssql", "seed.mssql.sql"],
  ["oracle", "seed.oracle.sql"],
] as const;

type MongoSeedFixture = {
  idempotencyContract: string;
  collections: Array<{
    name: string;
    indexes?: Array<{ name?: string }>;
    documents: Array<Record<string, unknown>>;
  }>;
};

type RedisSeedFixture = {
  idempotencyContract: string;
  database: number;
  commands: Array<{ command: string; key?: string }>;
};

type ValkeySeedFixture = RedisSeedFixture & {
  product: "valkey";
  supportLevel: "static-fixture-only";
  compatibilityTarget: "redis-command";
  runtimeSupport: false;
  promotionGate: string;
};

type SearchSeedFixture = {
  product: string;
  idempotencyContract: string;
  indexes: Array<{ name: string; aliases: string[] }>;
  aliases: Array<{ name: string; index: string }>;
  mappings: Array<{ index: string; fields: Array<{ path: string }> }>;
  searchResult: { hits: Array<{ index: string; id: string }> };
  destructivePlan: { operation: string; requiresConfirmation: boolean };
};

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(resolve("e2e/fixtures", file), "utf-8")) as T;
}

describe("DBMS-specific E2E seed fixtures", () => {
  it.each(DBMS_SEED_FILES)(
    "%s has a dedicated idempotent SQL seed",
    (_dbms, file) => {
      const sql = readFileSync(resolve("e2e/fixtures", file), "utf-8");
      expect(sql).toContain("Idempotency contract");
      expect(sql).toMatch(/\busers\b/i);
      expect(sql).toMatch(/\borders\b/i);
      expect(sql).toMatch(/\bproducts\b/i);
    },
  );

  it("mariadb seed carries live catalog/workbench metadata probes", () => {
    const sql = readFileSync(
      resolve("e2e/fixtures", "seed.mariadb.sql"),
      "utf-8",
    );

    expect(sql).toContain("catalog_metadata_probe");
    expect(sql).toContain("active_mariadb_users");
    expect(sql).toContain("mariadb_tax_rate");
    expect(sql).toContain("mariadb_catalog_ping");
    expect(sql).toContain("uq_mariadb_catalog_probe_code");
    expect(sql).toContain("ix_mariadb_catalog_probe_user");
    expect(sql).toContain("fk_mariadb_catalog_probe_user");
    expect(sql).toMatch(/CHECK\s*\(amount >= 0\)/i);
  });

  it("mongodb has a dedicated idempotent document seed", () => {
    const fixture = readJson<MongoSeedFixture>("seed.mongodb.json");
    const collectionNames = fixture.collections.map(({ name }) => name);

    expect(fixture.idempotencyContract).toContain("Idempotency contract");
    expect(collectionNames).toEqual(
      expect.arrayContaining(["smoke_users", "users", "orders", "products"]),
    );
    expect(
      fixture.collections.find(({ name }) => name === "smoke_users")?.documents,
    ).toEqual([
      expect.objectContaining({
        email: "mona@example.com",
        role: "smoke",
      }),
    ]);
    expect(
      fixture.collections.find(({ name }) => name === "users")?.indexes,
    ).toEqual([
      expect.objectContaining({ name: "users_email_unique" }),
      expect.objectContaining({ name: "users_role_lookup" }),
    ]);
  });

  it("redis has a dedicated idempotent KV seed", () => {
    const fixture = readJson<RedisSeedFixture>("seed.redis.json");
    const commandNames = fixture.commands.map(({ command }) => command);
    const payload = JSON.stringify(fixture);

    expect(fixture.idempotencyContract).toContain("Idempotency contract");
    expect(fixture.database).toBe(2);
    expect(commandNames).toEqual(
      expect.arrayContaining(["SELECT", "FLUSHDB", "SET", "HSET", "XADD"]),
    );
    expect(payload).toContain("tv:string");
    expect(payload).toContain("tv:hash");
    expect(payload).toContain("tv:events");
  });

  it("valkey has a static Redis-compatible fixture without a runtime claim", () => {
    const fixture = readJson<ValkeySeedFixture>("seed.valkey.json");
    const commandNames = fixture.commands.map(({ command }) => command);
    const payload = JSON.stringify(fixture);

    expect(fixture.product).toBe("valkey");
    expect(fixture.supportLevel).toBe("static-fixture-only");
    expect(fixture.compatibilityTarget).toBe("redis-command");
    expect(fixture.runtimeSupport).toBe(false);
    expect(fixture.idempotencyContract).toContain("Idempotency contract");
    expect(fixture.idempotencyContract).toContain(
      "not wired to Valkey runtime smoke",
    );
    expect(fixture.promotionGate).toContain("local Valkey container");
    expect(fixture.database).toBe(2);
    expect(commandNames).toEqual(
      expect.arrayContaining(["SELECT", "FLUSHDB", "SET", "HSET", "XADD"]),
    );
    expect(payload).toContain("vk:string");
    expect(payload).toContain("vk:hash");
    expect(payload).toContain("vk:events");
  });

  it.each([
    ["elasticsearch", "seed.search.elasticsearch.json", "logs-elastic"],
    ["opensearch", "seed.search.opensearch.json", "logs-opensearch"],
  ] as const)(
    "%s has a dedicated fixture-backed search seed",
    (product, file, alias) => {
      const fixture = readJson<SearchSeedFixture>(file);

      expect(fixture.product).toBe(product);
      expect(fixture.idempotencyContract).toContain("Idempotency contract");
      expect(fixture.indexes).toEqual([
        expect.objectContaining({
          name: expect.stringContaining(alias),
          aliases: [alias],
        }),
      ]);
      expect(fixture.aliases).toEqual([
        expect.objectContaining({
          name: alias,
          index: expect.stringContaining(alias),
        }),
      ]);
      expect(fixture.mappings[0]?.fields.map(({ path }) => path)).toEqual(
        expect.arrayContaining(["@timestamp", "message", "status"]),
      );
      expect(fixture.searchResult.hits).toHaveLength(2);
      expect(fixture.destructivePlan).toEqual(
        expect.objectContaining({
          operation: "deleteByQuery",
          requiresConfirmation: true,
        }),
      );
    },
  );
});
