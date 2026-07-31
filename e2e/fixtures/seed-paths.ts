import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Seed-fixture lookup for the smoke suite. `e2e/fixtures/seed-smoke.ts` is the
 * only caller.
 *
 * A missing or renamed seed fails in `readFile` as an ENOENT carrying the
 * resolved path. That path identifies the DBMS, but not the fixture key the
 * caller asked for — worth knowing at `seed-smoke.ts`'s search-runtime call,
 * which passes a key chosen at runtime.
 */
export type E2eSeedFixtureKey =
  | "postgresql"
  | "mysql"
  | "mariadb"
  | "sqlite"
  | "duckdb"
  | "mongodb"
  | "redis"
  | "valkey"
  | "elasticsearch"
  | "opensearch";

export const E2E_SEED_FIXTURE_PATHS = {
  postgresql: "e2e/fixtures/postgresql/query/seed.sql",
  mysql: "e2e/fixtures/mysql/query/seed.sql",
  mariadb: "e2e/fixtures/mariadb/query/seed.sql",
  sqlite: "e2e/fixtures/sqlite/query/seed.sql",
  duckdb: "e2e/fixtures/duckdb/query/seed.sql",
  mongodb: "e2e/fixtures/mongodb/document/seed.json",
  redis: "e2e/fixtures/redis/kv/seed.json",
  valkey: "e2e/fixtures/valkey/kv/seed.json",
  elasticsearch: "e2e/fixtures/elasticsearch/search/seed.json",
  opensearch: "e2e/fixtures/opensearch/search/seed.json",
} as const satisfies Record<E2eSeedFixtureKey, string>;

export async function readE2eSeedFixture(
  key: E2eSeedFixtureKey,
  root = process.cwd(),
): Promise<string> {
  return await readFile(resolve(root, E2E_SEED_FIXTURE_PATHS[key]), {
    encoding: "utf8",
  });
}
