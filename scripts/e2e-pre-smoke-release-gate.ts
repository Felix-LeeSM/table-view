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
    const dbTypes = fixtureConnections.map((connection) => connection.db_type);

    assert(
      !dbTypes.includes("mssql"),
      `${profile}: active MSSQL fixture leaked`,
    );
    assert(
      !dbTypes.includes("oracle"),
      `${profile}: active Oracle fixture leaked`,
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
    !elasticsearch.capabilities.query.query,
    "elasticsearch: live query execution should remain deferred",
  );
  assert(
    !isSupportedDatabaseType("opensearch"),
    "opensearch: fixture-backed search must not be advertised as connectable",
  );
  assert(
    !hasConnectionCapability("opensearch", "test"),
    "opensearch: fixture-backed search must not expose live test capability",
  );
}

await verifyProfile("development");
await verifyProfile("e2e");
verifySearchConnectionPromotionBoundary();

console.log("[e2e:pre-smoke] release gate fixture assertions passed.");
