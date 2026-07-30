import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Seed-fixture lookup for the smoke suite. `e2e/fixtures/seed-smoke.ts` is the
 * only caller.
 */
export type E2eSeedFixtureKey =
  | "postgresql"
  | "mysql"
  | "mariadb"
  | "sqlite"
  | "duckdb"
  | "duckdb-schema-filter"
  | "mongodb"
  | "redis"
  | "valkey"
  | "elasticsearch"
  | "opensearch"
  | "mssql"
  | "oracle";

export const E2E_SEED_FIXTURE_PATHS = {
  postgresql: "e2e/fixtures/postgresql/query/seed.sql",
  mysql: "e2e/fixtures/mysql/query/seed.sql",
  mariadb: "e2e/fixtures/mariadb/query/seed.sql",
  sqlite: "e2e/fixtures/sqlite/query/seed.sql",
  duckdb: "e2e/fixtures/duckdb/query/seed.sql",
  "duckdb-schema-filter": "e2e/fixtures/duckdb/schema-filter/seed.sql",
  mongodb: "e2e/fixtures/mongodb/document/seed.json",
  redis: "e2e/fixtures/redis/kv/seed.json",
  valkey: "e2e/fixtures/valkey/kv/seed.json",
  elasticsearch: "e2e/fixtures/elasticsearch/search/seed.json",
  opensearch: "e2e/fixtures/opensearch/search/seed.json",
  // MSSQL and Oracle predate the DBMS-first layout and still sit at the root.
  mssql: "e2e/fixtures/seed.mssql.sql",
  oracle: "e2e/fixtures/seed.oracle.sql",
} as const satisfies Record<E2eSeedFixtureKey, string>;

export async function readE2eSeedFixture(
  key: E2eSeedFixtureKey,
  root = process.cwd(),
): Promise<string> {
  const path = resolve(root, E2E_SEED_FIXTURE_PATHS[key]);
  try {
    return await readFile(path, { encoding: "utf8" });
  } catch (cause) {
    // `seed-smoke.ts` picks the key at runtime, so a bare ENOENT would name the
    // path but not which caller asked for it.
    throw new Error(`"${key}" seed fixture not readable at ${path}`, { cause });
  }
}
