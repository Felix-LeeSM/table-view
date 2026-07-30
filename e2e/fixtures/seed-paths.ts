import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Seed-fixture lookup for the smoke suite.
 *
 * This used to live in `scripts/fixtures/e2e-seed-paths.ts`, deleted with the
 * rest of the script tree; `e2e/fixtures/seed-smoke.ts` was its only surviving
 * caller, so the suite now owns it.
 *
 * The legacy-path fallback did not come along. It existed for seed files that
 * had moved (`e2e/fixtures/seed.mysql.sql` -> `e2e/fixtures/mysql/query/seed.sql`)
 * and carried a removal condition tied to milestone #40, which is closed. All
 * ten canonical paths below exist and none of the legacy names do, so the
 * fallback, its both-exist conflict check and the two assertion helpers built on
 * it were dead code. A missing file now fails in `readFile` with the path in the
 * message, which is the same signal the explicit throw gave.
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
