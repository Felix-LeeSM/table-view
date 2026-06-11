import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REDIS_COMMAND_COMPLETIONS,
  REDIS_UNSUPPORTED_COMMAND_FAMILIES,
} from "../../src/features/completion";

const DBMS_SEED_FILES = [
  ["postgresql", "seed.sql"],
  ["mysql", "mysql/query/seed.sql"],
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
  supportLevel: "runtime-smoke-seed";
  compatibilityTarget: "redis-command";
  runtimeSupport: true;
  promotionGate: string;
};

type ValkeyCompatibilityStatus =
  | "candidate-after-local-valkey-proof"
  | "detection-required"
  | "proven-local-valkey-runtime"
  | "rejected-until-separate-scope";

type ValkeyCompatibilityMatrixEntry = {
  family: string;
  status: ValkeyCompatibilityStatus;
  redisCommands: string[];
  unsupportedFamilyLabels?: string[];
  currentEvidence: string;
  knownValkeyDelta: string;
  promotionGate: string;
  unsupportedAssumption: string;
};

type ValkeyRedisCompatibilityFixture = {
  product: "valkey";
  supportLevel: "static-matrix-plus-focused-runtime-proof";
  compatibilityTarget: "redis-command";
  runtimeSupport: true;
  detectionRules: string[];
  commandFamilyMatrix: ValkeyCompatibilityMatrixEntry[];
  knownValkeyDeltas: string[];
  unsupportedRedisAssumptions: string[];
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

  it("mssql seed carries Runtime Happy Path catalog probes", () => {
    const sql = readFileSync(
      resolve("e2e/fixtures", "seed.mssql.sql"),
      "utf-8",
    );

    expect(sql).toContain("active_mssql_users");
    expect(sql).toContain("mssql_catalog_ping");
    expect(sql).toMatch(/CREATE OR ALTER VIEW dbo\.active_mssql_users/i);
    expect(sql).toMatch(/CREATE OR ALTER PROCEDURE dbo\.mssql_catalog_ping/i);
  });

  it("oracle seed carries Runtime Happy Path catalog probes", () => {
    const sql = readFileSync(resolve("e2e/fixtures", "seed.oracle.sql"), {
      encoding: "utf8",
    });

    expect(sql).toContain("active_oracle_users");
    expect(sql).toContain("oracle_catalog_ping");
    expect(sql).toMatch(/CREATE OR REPLACE VIEW active_oracle_users/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION oracle_catalog_ping/i);
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

  it("valkey has a dedicated Runtime Happy Path smoke seed", () => {
    const fixture = readJson<ValkeySeedFixture>("seed.valkey.json");
    const commandNames = fixture.commands.map(({ command }) => command);
    const payload = JSON.stringify(fixture);
    const streamSeed = fixture.commands.find(
      (command): command is { command: string; key: string; id: string } =>
        command.command === "XADD",
    );

    expect(fixture.product).toBe("valkey");
    expect(fixture.supportLevel).toBe("runtime-smoke-seed");
    expect(fixture.compatibilityTarget).toBe("redis-command");
    expect(fixture.runtimeSupport).toBe(true);
    expect(fixture.idempotencyContract).toContain("Idempotency contract");
    expect(fixture.idempotencyContract).toContain(
      "Valkey Runtime Happy Path smoke",
    );
    expect(fixture.promotionGate).toContain("Current Valkey smoke proves");
    expect(fixture.promotionGate).toContain("without inheriting Redis smoke");
    expect(fixture.database).toBe(2);
    expect(commandNames).toEqual([
      "SELECT",
      "FLUSHDB",
      "SET",
      "HSET",
      "XADD",
      "SADD",
      "HSET",
      "ZADD",
    ]);
    expect(streamSeed).toEqual(
      expect.objectContaining({
        key: "vk:events",
        id: "1-0",
      }),
    );
    expect(payload).toContain("vk:string");
    expect(payload).toContain("vk:hash");
    expect(payload).toContain("vk:events");
  });

  it("valkey Redis compatibility matrix covers the bounded command slice and rejects Redis assumptions", () => {
    const seed = readJson<ValkeySeedFixture>("seed.valkey.json");
    const fixture = readJson<ValkeyRedisCompatibilityFixture>(
      "valkey.redis-compatibility.json",
    );
    const matrixCommands = new Set(
      fixture.commandFamilyMatrix.flatMap(({ redisCommands }) =>
        redisCommands.map((command) => command.toUpperCase()),
      ),
    );
    const unsupportedLabels = new Set(
      fixture.commandFamilyMatrix.flatMap(
        ({ unsupportedFamilyLabels = [] }) => unsupportedFamilyLabels,
      ),
    );

    expect(fixture.product).toBe("valkey");
    expect(fixture.supportLevel).toBe(
      "static-matrix-plus-focused-runtime-proof",
    );
    expect(fixture.compatibilityTarget).toBe("redis-command");
    expect(fixture.runtimeSupport).toBe(true);
    expect(fixture.detectionRules.join(" ")).toContain("valkey_version");

    for (const command of REDIS_COMMAND_COMPLETIONS) {
      expect(matrixCommands.has(command.name)).toBe(true);
    }
    for (const command of seed.commands) {
      expect(matrixCommands.has(command.command)).toBe(true);
    }
    for (const family of REDIS_UNSUPPORTED_COMMAND_FAMILIES) {
      expect(unsupportedLabels.has(family.label)).toBe(true);
    }

    expect(fixture.knownValkeyDeltas).toEqual(
      expect.arrayContaining([
        expect.stringContaining("redis_version"),
        expect.stringContaining("Redis Runtime Happy Path smoke"),
      ]),
    );
    expect(fixture.unsupportedRedisAssumptions).toEqual(
      expect.arrayContaining([
        "Do not reuse Redis Runtime Happy Path smoke as Valkey evidence.",
        "Do not widen Valkey runtime support from profile identity alone.",
      ]),
    );

    const provenRows = fixture.commandFamilyMatrix.filter(
      ({ status }) => status === "proven-local-valkey-runtime",
    );
    expect(provenRows.map(({ family }) => family)).toEqual(
      expect.arrayContaining([
        "database-and-keyspace",
        "string-read-preview",
        "string-write-command",
        "hash-read-command",
        "ttl-mutation-command",
        "stream-read-command",
        "single-key-destructive",
      ]),
    );
    for (const row of provenRows) {
      expect(row.currentEvidence).toContain("Local Valkey testcontainer");
    }

    const candidateRows = fixture.commandFamilyMatrix.filter(
      ({ status }) => status === "candidate-after-local-valkey-proof",
    );
    expect(candidateRows.length).toBeGreaterThan(0);
    for (const row of candidateRows) {
      expect(row.promotionGate).toContain("local Valkey");
      expect(row.currentEvidence).not.toContain("Local Valkey testcontainer");
    }
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

  it("opensearch fixture seed is wired into Runtime Happy Path smoke", () => {
    const workflow = readFileSync(resolve(".github/workflows/e2e-smoke.yml"), {
      encoding: "utf8",
    });
    const smokeScript = readFileSync(resolve("scripts/e2e-smoke-ci.sh"), {
      encoding: "utf8",
    });
    const seedScript = readFileSync(resolve("e2e/fixtures/seed-smoke.ts"), {
      encoding: "utf8",
    });

    expect(workflow).toContain("spec_key: opensearch");
    expect(workflow).toContain("spec: e2e/smoke/opensearch.spec.ts");
    expect(workflow).toContain("opensearchproject/opensearch:2.13.0");
    expect(smokeScript).toContain(
      'run_wdio "$BASE_DATA_DIR/opensearch" "e2e/smoke/opensearch.spec.ts"',
    );
    expect(seedScript).toContain('opensearch: ["opensearch"]');
    expect(seedScript).toContain("seed.search.opensearch.json");
  });

  it("mssql fixture seed is wired into Runtime Happy Path smoke", () => {
    const workflow = readFileSync(resolve(".github/workflows/e2e-smoke.yml"), {
      encoding: "utf8",
    });
    const smokeScript = readFileSync(resolve("scripts/e2e-smoke-ci.sh"), {
      encoding: "utf8",
    });
    const seedScript = readFileSync(resolve("e2e/fixtures/seed-smoke.ts"), {
      encoding: "utf8",
    });

    expect(workflow).toContain("spec_key: mssql");
    expect(workflow).toContain("spec: e2e/smoke/mssql.spec.ts");
    expect(workflow).toContain("mcr.microsoft.com/mssql/server:2022-latest");
    expect(smokeScript).toContain(
      'run_wdio "$BASE_DATA_DIR/mssql" "e2e/smoke/mssql.spec.ts"',
    );
    expect(seedScript).toContain('mssql: ["mssql"]');
    expect(seedScript).toContain("seed.mssql.sql");
  });

  it("mysql fixture seed is wired from DBMS/function query topology", () => {
    const smokeScript = readFileSync(resolve("scripts/e2e-smoke-ci.sh"), {
      encoding: "utf8",
    });
    const seedScript = readFileSync(resolve("e2e/fixtures/seed-smoke.ts"), {
      encoding: "utf8",
    });

    expect(smokeScript).toContain(
      'run_wdio "$BASE_DATA_DIR/mysql" "e2e/smoke/mysql.spec.ts"',
    );
    expect(seedScript).toContain('mysql: ["mysql"]');
    expect(seedScript).toContain("mysql/query/seed.sql");
    expect(seedScript).not.toContain("seed.mysql.sql");
  });

  it("oracle fixture seed is wired into Runtime Happy Path smoke", () => {
    const workflow = readFileSync(resolve(".github/workflows/e2e-smoke.yml"), {
      encoding: "utf8",
    });
    const smokeScript = readFileSync(resolve("scripts/e2e-smoke-ci.sh"), {
      encoding: "utf8",
    });
    const seedScript = readFileSync(resolve("e2e/fixtures/seed-smoke.ts"), {
      encoding: "utf8",
    });

    expect(workflow).toContain("spec_key: oracle");
    expect(workflow).toContain("spec: e2e/smoke/oracle.spec.ts");
    expect(workflow).toContain("gvenzl/oracle-xe:21");
    expect(workflow).toContain("timeout-minutes: 12");
    expect(smokeScript).toContain(
      'run_wdio "$BASE_DATA_DIR/oracle" "e2e/smoke/oracle.spec.ts"',
    );
    expect(seedScript).toContain('oracle: ["oracle"]');
    expect(seedScript).toContain("seed.oracle.sql");
  });
});
