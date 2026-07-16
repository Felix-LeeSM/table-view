import { describe, expect, it } from "vitest";
import {
  createEmptyDataSourceCapabilities,
  type DataSourceCapabilities,
  getDataSourceProfile,
  isConnectionSupportedDatabaseType,
} from "./dataSource";
import {
  FILE_RDBMS_DATABASE_TYPES,
  RDBMS_DATABASE_TYPES,
  RUNTIME_RDBMS_DATABASE_TYPES,
  SERVER_RDBMS_DATABASE_TYPES,
} from "./rdbmsDataSources";

type CapabilityOverrides = {
  readonly [Group in keyof DataSourceCapabilities]?: Partial<
    DataSourceCapabilities[Group]
  >;
};

function expectedCapabilities(
  overrides: CapabilityOverrides = {},
): DataSourceCapabilities {
  const capabilities = createEmptyDataSourceCapabilities();

  for (const [group, values] of Object.entries(overrides) as [
    keyof DataSourceCapabilities,
    Partial<DataSourceCapabilities[keyof DataSourceCapabilities]>,
  ][]) {
    Object.assign(capabilities[group], values);
  }

  return capabilities;
}

const expectedMssqlRuntimeCapabilities = expectedCapabilities({
  connection: { test: true },
  query: { query: true, cancel: true },
  catalog: {
    indexes: true,
    constraints: true,
  },
  edit: { editRows: true, requiresPrimaryKeyForEdit: true },
  intelligence: { erd: true },
});

const expectedOracleRuntimeCapabilities = expectedCapabilities({
  connection: { test: true },
  query: { query: true, cancel: true },
  catalog: {
    indexes: true,
    constraints: true,
  },
  edit: { editRows: true, requiresPrimaryKeyForEdit: true },
  intelligence: { erd: true },
});

describe("RDBMS data source profiles", () => {
  it("promotes MSSQL and Oracle runtime/edit while keeping Oracle DDL unclaimed", () => {
    const mssql = getDataSourceProfile("mssql");
    expect(mssql).toMatchObject({
      id: "mssql",
      paradigm: "rdb",
      connectionKind: "server",
      languages: ["sql"],
      catalogModel: "rdb",
      resultKinds: ["tabular"],
      safetyPolicy: "rdb-default",
    });
    expect(mssql.backendAdapter).toEqual({
      id: "mssql",
      kind: "rdb",
      capabilitySource: "mssql",
    });
    expect(mssql.dialect).toEqual({
      id: "mssql",
      family: "mssql",
      versionProbe: "mssql-server-property",
    });
    expect(mssql.capabilities).toEqual(expectedMssqlRuntimeCapabilities);
    expect(mssql.capabilities.connection.test).toBe(true);
    expect(mssql.capabilities.query.query).toBe(true);
    expect(mssql.capabilities.query.cancel).toBe(true);
    expect(mssql.capabilities.query.explain).toBe(false);
    expect(mssql.capabilities.catalog.indexes).toBe(true);
    expect(mssql.capabilities.catalog.constraints).toBe(true);
    expect(mssql.capabilities.edit.editRows).toBe(true);
    expect(mssql.capabilities.ddl.createTable).toBe(false);
    expect(isConnectionSupportedDatabaseType("mssql")).toBe(true);

    const oracle = getDataSourceProfile("oracle");
    expect(oracle).toMatchObject({
      id: "oracle",
      paradigm: "rdb",
      connectionKind: "server",
      languages: ["sql"],
      catalogModel: "rdb",
      resultKinds: ["tabular"],
      safetyPolicy: "rdb-default",
    });
    expect(oracle.backendAdapter).toEqual({
      id: "oracle",
      kind: "rdb",
      capabilitySource: "oracle",
    });
    expect(oracle.dialect).toEqual({
      id: "oracle",
      family: "oracle",
      versionProbe: "none",
    });
    expect(oracle.capabilities).toEqual(expectedOracleRuntimeCapabilities);
    expect(oracle.capabilities.connection.test).toBe(true);
    expect(oracle.capabilities.connection.switchDatabase).toBe(false);
    expect(oracle.capabilities.query.query).toBe(true);
    expect(oracle.capabilities.query.cancel).toBe(true);
    expect(oracle.capabilities.query.explain).toBe(false);
    expect(oracle.capabilities.catalog.indexes).toBe(true);
    expect(oracle.capabilities.catalog.constraints).toBe(true);
    expect(oracle.capabilities.edit.editRows).toBe(true);
    expect(oracle.capabilities.ddl.createTable).toBe(false);
    expect(isConnectionSupportedDatabaseType("oracle")).toBe(true);
  });

  it("locks the Sprint 459 RDBMS integration gate matrix", () => {
    expect(RDBMS_DATABASE_TYPES).toEqual([
      "postgresql",
      "mysql",
      "mariadb",
      "sqlite",
      "duckdb",
      "mssql",
      "oracle",
    ]);
    expect(RUNTIME_RDBMS_DATABASE_TYPES).toEqual([
      "postgresql",
      "mysql",
      "mariadb",
      "sqlite",
      "duckdb",
      "mssql",
      "oracle",
    ]);
    expect(SERVER_RDBMS_DATABASE_TYPES).toEqual([
      "postgresql",
      "mysql",
      "mariadb",
      "mssql",
      "oracle",
    ]);
    expect(FILE_RDBMS_DATABASE_TYPES).toEqual(["sqlite", "duckdb"]);

    for (const dbType of RUNTIME_RDBMS_DATABASE_TYPES) {
      const profile = getDataSourceProfile(dbType);

      expect(profile.paradigm).toBe("rdb");
      expect(profile.languages).toEqual(["sql"]);
      expect(profile.catalogModel).toBe("rdb");
      expect(profile.resultKinds).toEqual(["tabular"]);
      expect(profile.safetyPolicy).toBe("rdb-default");
      expect(profile.backendAdapter.kind).toBe("rdb");
      expect(profile.capabilities.connection.test).toBe(true);
      expect(profile.capabilities.query.query).toBe(true);
    }

    const mssql = getDataSourceProfile("mssql");
    expect(mssql.backendAdapter).toEqual({
      id: "mssql",
      kind: "rdb",
      capabilitySource: "mssql",
    });
    expect(mssql.capabilities).toEqual(expectedMssqlRuntimeCapabilities);
    expect(mssql.capabilities.connection.test).toBe(true);
    expect(mssql.capabilities.query.query).toBe(true);
    expect(mssql.capabilities.query.cancel).toBe(true);
    expect(mssql.capabilities.query.explain).toBe(false);
    expect(mssql.capabilities.catalog.indexes).toBe(true);
    expect(mssql.capabilities.catalog.constraints).toBe(true);
    expect(mssql.capabilities.edit.editRows).toBe(true);
    expect(mssql.capabilities.ddl.createTable).toBe(false);

    const oracle = getDataSourceProfile("oracle");
    expect(oracle.paradigm).toBe("rdb");
    expect(oracle.backendAdapter).toEqual({
      id: "oracle",
      kind: "rdb",
      capabilitySource: "oracle",
    });
    expect(oracle.capabilities).toEqual(expectedOracleRuntimeCapabilities);
    expect(oracle.capabilities.connection.test).toBe(true);
    expect(oracle.capabilities.query.query).toBe(true);
    expect(oracle.capabilities.query.cancel).toBe(true);
    expect(oracle.capabilities.query.explain).toBe(false);
    expect(oracle.capabilities.catalog.indexes).toBe(true);
    expect(oracle.capabilities.catalog.constraints).toBe(true);
    expect(oracle.capabilities.edit.editRows).toBe(true);
    expect(oracle.capabilities.ddl.createTable).toBe(false);
    expect(isConnectionSupportedDatabaseType("oracle")).toBe(true);
  });
});
