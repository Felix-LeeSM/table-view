import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { upsertConnections } from "./fixtures/connections.js";
import { loadSpec } from "./fixtures/spec.js";
import { isSupportedDatabaseType } from "../src/types/connection.js";
import {
  getDataSourceProfile,
  hasConnectionCapability,
} from "../src/types/dataSource.js";

type StoredConnection = {
  id: string;
  db_type: string;
  database: string;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function verifyProfile(profile: "development" | "e2e"): Promise<void> {
  const dataDir = mkdtempSync(resolve(tmpdir(), `table-view-${profile}-gate-`));
  const previousDataDir = process.env.TABLE_VIEW_TEST_DATA_DIR;
  process.env.TABLE_VIEW_TEST_DATA_DIR = dataDir;

  try {
    const spec = loadSpec(profile);
    await upsertConnections(spec);
    await upsertConnections(spec);

    const storage = JSON.parse(
      readFileSync(resolve(dataDir, "connections.json"), "utf-8"),
    ) as { connections: StoredConnection[] };
    const fixtureConnections = storage.connections.filter((connection) =>
      connection.id.startsWith("fixture-"),
    );
    assert(
      fixtureConnections.filter((connection) => connection.db_type === "sqlite")
        .length === 1,
      `${profile}: expected exactly one active SQLite fixture connection`,
    );
    assert(
      fixtureConnections.filter((connection) => connection.db_type === "duckdb")
        .length === 1,
      `${profile}: expected exactly one active DuckDB fixture connection`,
    );

    const sqlite = fixtureConnections.find(
      (connection) => connection.db_type === "sqlite",
    );
    const duckdb = fixtureConnections.find(
      (connection) => connection.db_type === "duckdb",
    );
    const sqlitePath = resolve(
      dataDir,
      "fixtures",
      "sqlite",
      spec.profileSpec.database.sqlite!,
    );
    const duckdbPath = resolve(
      dataDir,
      "fixtures",
      "duckdb",
      spec.profileSpec.database.duckdb!,
    );

    assert(sqlite?.database === sqlitePath, `${profile}: SQLite path drifted`);
    assert(duckdb?.database === duckdbPath, `${profile}: DuckDB path drifted`);
    assert(existsSync(sqlitePath), `${profile}: SQLite fixture file missing`);
    assert(existsSync(duckdbPath), `${profile}: DuckDB fixture file missing`);
    assert(
      !sqlitePath.includes("Application Support") &&
        !duckdbPath.includes("Application Support"),
      `${profile}: file fixtures must not use Application Support defaults`,
    );

    assert(
      spec.profileSpec.database.mssql,
      `${profile}: MSSQL fixture database must be configured for full-support smoke`,
    );
    assert(
      spec.profileSpec.database.oracle,
      `${profile}: Oracle fixture database must be configured for full-support smoke`,
    );
    assert(
      (spec.profileSpec.connections?.mssql?.length ?? 0) > 0,
      `${profile}: MSSQL fixture connection inventory missing`,
    );
    assert(
      (spec.profileSpec.connections?.oracle?.length ?? 0) > 0,
      `${profile}: Oracle fixture connection inventory missing`,
    );
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.TABLE_VIEW_TEST_DATA_DIR;
    } else {
      process.env.TABLE_VIEW_TEST_DATA_DIR = previousDataDir;
    }
    rmSync(dataDir, { recursive: true, force: true });
  }
}

function verifySearchConnectionPromotionBoundary(): void {
  const elasticsearch = getDataSourceProfile("elasticsearch");
  const opensearch = getDataSourceProfile("opensearch");

  assert(
    isSupportedDatabaseType("elasticsearch"),
    "elasticsearch: live connection test should be advertised as connectable",
  );
  assert(
    hasConnectionCapability("elasticsearch", "test"),
    "elasticsearch: live connection test capability should be exposed",
  );
  assert(
    elasticsearch.capabilities.catalog.browse &&
      elasticsearch.capabilities.catalog.indexes,
    "elasticsearch: live catalog browse/index capability should be exposed",
  );
  assert(
    elasticsearch.capabilities.query.query &&
      elasticsearch.capabilities.query.cancel &&
      !elasticsearch.capabilities.query.explain,
    "elasticsearch: bounded live query/cancel should be exposed without explain",
  );
  assert(
    isSupportedDatabaseType("opensearch"),
    "opensearch: live connection/catalog/query slice should be advertised as connectable",
  );
  assert(
    hasConnectionCapability("opensearch", "test"),
    "opensearch: live connection test capability should be exposed",
  );
  assert(
    opensearch.capabilities.catalog.browse &&
      opensearch.capabilities.catalog.indexes,
    "opensearch: live catalog browse/index capability should be exposed",
  );
  assert(
    opensearch.capabilities.query.query &&
      opensearch.capabilities.query.cancel &&
      !opensearch.capabilities.query.explain,
    "opensearch: live query/cancel should be exposed while explain remains deferred",
  );
}

function verifyMssqlOracleSmokePromotionBoundary(): void {
  for (const dbType of ["mssql", "oracle"] as const) {
    const profile = getDataSourceProfile(dbType);
    assert(
      isSupportedDatabaseType(dbType),
      `${dbType}: full-support smoke should be advertised as connectable`,
    );
    assert(
      hasConnectionCapability(dbType, "test"),
      `${dbType}: connection test capability should be exposed`,
    );
    assert(
      profile.languages.includes("sql") &&
        profile.catalogModel === "rdb" &&
        profile.resultKinds.includes("tabular"),
      `${dbType}: SQL/RDB/tabular contract drifted`,
    );
  }

  for (const path of [
    "e2e/smoke/mssql.spec.ts",
    "e2e/smoke/oracle.spec.ts",
    "e2e/fixtures/seed.mssql.sql",
    "e2e/fixtures/seed.oracle.sql",
  ]) {
    assert(
      existsSync(path),
      `required MSSQL/Oracle smoke sidecar missing: ${path}`,
    );
  }
}

await verifyProfile("development");
await verifyProfile("e2e");
verifySearchConnectionPromotionBoundary();
verifyMssqlOracleSmokePromotionBoundary();

console.log("[e2e:pre-smoke] release gate fixture assertions passed.");
