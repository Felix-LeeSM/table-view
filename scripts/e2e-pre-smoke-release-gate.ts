import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { upsertConnections } from "./fixtures/connections.js";
import { duckdbEnvPath } from "./fixtures/duckdb.js";
import { sqliteEnvPath } from "./fixtures/sqlite.js";
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
      fixtureConnections.filter((connection) => connection.db_type === "mssql")
        .length === 1,
      `${profile}: expected exactly one MSSQL runtime fixture connection`,
    );
    assert(
      fixtureConnections.filter((connection) => connection.db_type === "oracle")
        .length === 1,
      `${profile}: expected exactly one Oracle bounded runtime fixture connection`,
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
    const mssql = fixtureConnections.find(
      (connection) => connection.db_type === "mssql",
    );
    const oracle = fixtureConnections.find(
      (connection) => connection.db_type === "oracle",
    );
    // #1449: SQLite/DuckDB fixtures live in a `<dataDir>-fixtures` sibling
    // (outside the app data dir the connect guard rejects). Reuse the exact
    // env-path helpers `upsertConnections` writes with (connections.ts), so
    // the gate can never drift from where fixtures actually land.
    const sqlitePath = resolve(
      sqliteEnvPath().directory,
      spec.profileSpec.database.sqlite!,
    );
    const duckdbPath = resolve(
      duckdbEnvPath().directory,
      spec.profileSpec.database.duckdb!,
    );

    assert(sqlite?.database === sqlitePath, `${profile}: SQLite path drifted`);
    assert(duckdb?.database === duckdbPath, `${profile}: DuckDB path drifted`);
    assert(
      mssql?.database === spec.profileSpec.database.mssql,
      `${profile}: MSSQL fixture database drifted`,
    );
    assert(
      oracle?.database ===
        (process.env.ORACLE_SERVICE ??
          process.env.E2E_ORACLE_SERVICE ??
          "XEPDB1"),
      `${profile}: Oracle fixture service drifted`,
    );
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

function verifyEnterpriseRdbmsPromotionBoundary(): void {
  const mssql = getDataSourceProfile("mssql");
  const oracle = getDataSourceProfile("oracle");

  assert(
    isSupportedDatabaseType("mssql"),
    "mssql: runtime catalog/query profile must be exposed for connection support",
  );
  assert(
    hasConnectionCapability("mssql", "test"),
    "mssql: connection.test must be enabled for the runtime catalog/query slice",
  );
  assert(
    mssql.capabilities.query.query &&
      mssql.capabilities.query.cancel &&
      !mssql.capabilities.query.explain &&
      mssql.capabilities.catalog.indexes &&
      mssql.capabilities.catalog.constraints &&
      mssql.capabilities.edit.editRows &&
      mssql.capabilities.ddl.createTable &&
      mssql.capabilities.ddl.alterTable &&
      mssql.capabilities.ddl.createIndex &&
      mssql.capabilities.ddl.dropObject,
    "mssql: runtime support covers catalog/query/cancel/tabular plus PK-projected editRows, #1071 structured table/index/constraint DDL, and #1642 vendor-restorable schema-dump export; admin/import/backup-restore/full workbench stay unsupported",
  );

  assert(
    isSupportedDatabaseType("oracle"),
    "oracle: bounded catalog/query profile must be exposed for connection support",
  );
  assert(
    hasConnectionCapability("oracle", "test"),
    "oracle: connection.test must stay enabled for the service-name lifecycle",
  );
  assert(
    oracle.capabilities.query.query &&
      oracle.capabilities.query.cancel &&
      !oracle.capabilities.query.explain &&
      oracle.capabilities.catalog.indexes &&
      oracle.capabilities.catalog.constraints &&
      oracle.capabilities.edit.editRows &&
      oracle.capabilities.ddl.createTable &&
      oracle.capabilities.ddl.alterTable &&
      oracle.capabilities.ddl.createIndex &&
      oracle.capabilities.ddl.dropObject,
    "oracle: runtime support covers service-name catalog/query/cancel/tabular plus PK-projected editRows, #1072 structured table/index/constraint DDL, and #1674 vendor-restorable schema-dump export; raw DDL/admin/import/backup-restore/full workbench stay unsupported",
  );
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
    elasticsearch.connectionKind === "server" &&
      elasticsearch.catalogModel === "search" &&
      elasticsearch.resultKinds.includes("searchHits"),
    "elasticsearch: live smoke contract should stay server/search/searchHits scoped",
  );
  assert(
    elasticsearch.capabilities.catalog.indexes,
    "elasticsearch: live catalog index capability should be exposed",
  );
  assert(
    elasticsearch.capabilities.query.query &&
      elasticsearch.capabilities.query.cancel &&
      !elasticsearch.capabilities.query.explain,
    "elasticsearch: bounded live query/cancel should be exposed without explain",
  );
  assert(
    !elasticsearch.capabilities.edit.bulkWrite &&
      !elasticsearch.capabilities.ddl.dropObject &&
      !elasticsearch.capabilities.operations.activity &&
      !elasticsearch.capabilities.operations.serverInfo,
    "elasticsearch: live smoke must not promote admin, destructive execution, or observability",
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
    opensearch.connectionKind === "server" &&
      opensearch.catalogModel === "search" &&
      opensearch.resultKinds.includes("searchHits"),
    "opensearch: live smoke contract should stay server/search/searchHits scoped",
  );
  assert(
    opensearch.capabilities.catalog.indexes,
    "opensearch: live catalog index capability should be exposed",
  );
  assert(
    opensearch.capabilities.query.query &&
      opensearch.capabilities.query.cancel &&
      !opensearch.capabilities.query.explain,
    "opensearch: live query/cancel should be exposed while explain remains deferred",
  );
  assert(
    !opensearch.capabilities.edit.bulkWrite &&
      !opensearch.capabilities.ddl.dropObject &&
      !opensearch.capabilities.operations.activity &&
      !opensearch.capabilities.operations.serverInfo,
    "opensearch: live smoke must not promote admin, destructive execution, or observability",
  );
}

// Issue #1640 — the CSV row import commit path is PG-first. The `edit.csvRowImport`
// capability gates the schema-tree "Import CSV…" entry point; PostgreSQL claims
// it and every other engine withholds it, mirroring the backend
// `build_csv_import_statements` PG-only gate. Because the commit rides the
// shared `execute_query_batch` (frontend SQL batch), it declares no new backend
// adapter capability, so the coarse `dataMutation` write posture stays false for
// PostgreSQL (asserted in the profile-parity test).
function verifyCsvImportPromotionBoundary(): void {
  const postgres = getDataSourceProfile("postgresql");
  assert(
    postgres.capabilities.edit.csvRowImport,
    "postgresql: edit.csvRowImport must be exposed for the PG-first CSV row import commit path (#1640)",
  );
  for (const engine of [
    "mysql",
    "mariadb",
    "sqlite",
    "mssql",
    "oracle",
  ] as const) {
    assert(
      !getDataSourceProfile(engine).capabilities.edit.csvRowImport,
      `${engine}: CSV row import stays unsupported until its commit adapter lands; edit.csvRowImport must be false`,
    );
  }
}

await verifyProfile("development");
await verifyProfile("e2e");
verifyEnterpriseRdbmsPromotionBoundary();
verifySearchConnectionPromotionBoundary();
verifyCsvImportPromotionBoundary();

console.log(
  "[e2e:pre-smoke] release gate MSSQL runtime catalog/query/editRows, Oracle service-name catalog/query/cancel/tabular/editRows, live Search contract, and PG-first CSV row import boundary assertions passed.",
);
