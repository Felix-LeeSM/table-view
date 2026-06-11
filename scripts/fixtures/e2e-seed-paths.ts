import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

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

type E2eSeedFixturePath = {
  canonical: string;
  legacy: string;
  removalCondition: string;
};

const REMOVAL_CONDITION =
  "#755 must document or remove this temporary legacy seed fallback before milestone #40 closes.";

export const E2E_SEED_FIXTURE_PATHS = {
  postgresql: {
    canonical: "e2e/fixtures/postgresql/query/seed.sql",
    legacy: "e2e/fixtures/seed.sql",
    removalCondition: REMOVAL_CONDITION,
  },
  mysql: {
    canonical: "e2e/fixtures/mysql/query/seed.sql",
    legacy: "e2e/fixtures/seed.mysql.sql",
    removalCondition: REMOVAL_CONDITION,
  },
  mariadb: {
    canonical: "e2e/fixtures/mariadb/query/seed.sql",
    legacy: "e2e/fixtures/seed.mariadb.sql",
    removalCondition: REMOVAL_CONDITION,
  },
  sqlite: {
    canonical: "e2e/fixtures/sqlite/query/seed.sql",
    legacy: "e2e/fixtures/seed.sqlite.sql",
    removalCondition: REMOVAL_CONDITION,
  },
  duckdb: {
    canonical: "e2e/fixtures/duckdb/query/seed.sql",
    legacy: "e2e/fixtures/seed.duckdb.sql",
    removalCondition: REMOVAL_CONDITION,
  },
  mongodb: {
    canonical: "e2e/fixtures/mongodb/document/seed.json",
    legacy: "e2e/fixtures/seed.mongodb.json",
    removalCondition: REMOVAL_CONDITION,
  },
  redis: {
    canonical: "e2e/fixtures/redis/kv/seed.json",
    legacy: "e2e/fixtures/seed.redis.json",
    removalCondition: REMOVAL_CONDITION,
  },
  valkey: {
    canonical: "e2e/fixtures/valkey/kv/seed.json",
    legacy: "e2e/fixtures/seed.valkey.json",
    removalCondition: REMOVAL_CONDITION,
  },
  elasticsearch: {
    canonical: "e2e/fixtures/elasticsearch/search/seed.json",
    legacy: "e2e/fixtures/seed.search.elasticsearch.json",
    removalCondition: REMOVAL_CONDITION,
  },
  opensearch: {
    canonical: "e2e/fixtures/opensearch/search/seed.json",
    legacy: "e2e/fixtures/seed.search.opensearch.json",
    removalCondition: REMOVAL_CONDITION,
  },
} as const satisfies Record<E2eSeedFixtureKey, E2eSeedFixturePath>;

export type LegacyE2eSeedFixture = {
  key: E2eSeedFixtureKey;
  canonical: string;
  legacy: string;
  removalCondition: string;
};

export function resolveE2eSeedFixturePath(
  key: E2eSeedFixtureKey,
  root = process.cwd(),
): string {
  const paths = E2E_SEED_FIXTURE_PATHS[key];
  const canonicalExists = existsSync(resolve(root, paths.canonical));
  const legacyExists = existsSync(resolve(root, paths.legacy));

  if (canonicalExists && legacyExists) {
    throw new Error(
      [
        `${key} fixture has both canonical and legacy seed files.`,
        `canonical=${paths.canonical}`,
        `legacy=${paths.legacy}`,
        paths.removalCondition,
      ].join(" "),
    );
  }

  if (canonicalExists) return paths.canonical;
  if (legacyExists) return paths.legacy;

  throw new Error(
    [
      `${key} fixture seed not found.`,
      `Checked canonical=${paths.canonical}`,
      `and legacy=${paths.legacy}.`,
    ].join(" "),
  );
}

export async function readE2eSeedFixture(
  key: E2eSeedFixtureKey,
  root = process.cwd(),
): Promise<string> {
  return await readFile(resolve(root, resolveE2eSeedFixturePath(key, root)), {
    encoding: "utf8",
  });
}

export function findLegacyE2eSeedFixtures(
  root = process.cwd(),
): LegacyE2eSeedFixture[] {
  return Object.entries(E2E_SEED_FIXTURE_PATHS).flatMap(([key, paths]) =>
    existsSync(resolve(root, paths.legacy))
      ? [
          {
            key: key as E2eSeedFixtureKey,
            canonical: paths.canonical,
            legacy: paths.legacy,
            removalCondition: paths.removalCondition,
          },
        ]
      : [],
  );
}

export function assertNoLegacyE2eSeedFixtures(root = process.cwd()): void {
  const stale = findLegacyE2eSeedFixtures(root);
  if (stale.length === 0) return;

  throw new Error(
    [
      "Legacy E2E seed fixture paths must not persist silently:",
      stale
        .map(
          ({ key, legacy, canonical, removalCondition }) =>
            `${key}: remove ${legacy}; canonical path is ${canonical}. ${removalCondition}`,
        )
        .join(" "),
    ].join(" "),
  );
}
