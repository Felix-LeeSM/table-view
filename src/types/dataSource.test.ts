import { describe, expect, it } from "vitest";
import {
  DATABASE_TYPE_LABELS,
  type DatabaseType,
  paradigmOf,
} from "./connection";
import {
  createEmptyDataSourceCapabilities,
  DATA_SOURCE_PROFILES,
  type DataSourceCapabilities,
  getConnectionSupportedDatabaseTypes,
  getDataSourceProfile,
  hasConnectionCapability,
  isConnectionSupportedDatabaseType,
} from "./dataSource";

describe("DataSourceProfile registry", () => {
  const allDatabaseTypes = Object.keys(DATABASE_TYPE_LABELS) as DatabaseType[];

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

  const mysqlFamilyCapabilities = expectedCapabilities({
    connection: { test: true, switchDatabase: true },
    query: { query: true, multiStatement: true, cancel: true },
    catalog: {
      browse: true,
      schema: true,
      indexes: true,
      constraints: true,
      relationships: true,
    },
    edit: { editRows: true },
    ddl: {
      createTable: true,
      alterTable: true,
      createIndex: true,
      dropObject: true,
    },
  });

  const expectedCapabilitiesByType: Record<
    DatabaseType,
    DataSourceCapabilities
  > = {
    postgresql: expectedCapabilities({
      connection: { test: true, switchDatabase: true },
      query: {
        query: true,
        multiStatement: true,
        cancel: true,
        explain: true,
      },
      catalog: {
        browse: true,
        schema: true,
        indexes: true,
        constraints: true,
        relationships: true,
      },
      edit: { editRows: true },
      ddl: {
        createTable: true,
        alterTable: true,
        createIndex: true,
        dropObject: true,
      },
      operations: {
        activity: true,
        slowQueries: true,
        stats: true,
        serverInfo: true,
      },
    }),
    mysql: mysqlFamilyCapabilities,
    mariadb: mysqlFamilyCapabilities,
    sqlite: expectedCapabilities({
      connection: { test: true, filePicker: true },
      query: { query: true, multiStatement: true, cancel: true },
      catalog: { browse: true, schema: true },
      edit: { editRows: true },
    }),
    mssql: createEmptyDataSourceCapabilities(),
    oracle: createEmptyDataSourceCapabilities(),
    mongodb: expectedCapabilities({
      connection: { test: true },
      query: { query: true, cancel: true, explain: true },
      catalog: { browse: true, schema: true, indexes: true },
      edit: { editDocuments: true, bulkWrite: true },
      ddl: { createIndex: true, dropObject: true },
      operations: {
        activity: true,
        slowQueries: true,
        stats: true,
        serverInfo: true,
      },
    }),
    redis: createEmptyDataSourceCapabilities(),
  };

  it("contains exactly one profile for every DatabaseType", () => {
    expect(Object.keys(DATA_SOURCE_PROFILES).sort()).toEqual(
      [...allDatabaseTypes].sort(),
    );
  });

  it("keeps every profile aligned with the current DatabaseType identity", () => {
    for (const dbType of allDatabaseTypes) {
      const profile = getDataSourceProfile(dbType);
      const capabilityValues = Object.values(profile.capabilities).flatMap(
        (group) => Object.values(group),
      );

      expect(profile.id).toBe(dbType);
      expect(profile.paradigm).toBe(paradigmOf(dbType));
      expect(profile.languages.length).toBeGreaterThan(0);
      expect(profile.resultKinds.length).toBeGreaterThan(0);
      expect(capabilityValues.length).toBeGreaterThan(0);
    }
  });

  it("locks exact current-state capability matrices for every DatabaseType", () => {
    for (const dbType of allDatabaseTypes) {
      expect(getDataSourceProfile(dbType).capabilities).toEqual(
        expectedCapabilitiesByType[dbType],
      );
    }
  });

  it("keeps PostgreSQL as the current RDBMS baseline", () => {
    expect(getDataSourceProfile("postgresql").capabilities).toEqual(
      expectedCapabilitiesByType.postgresql,
    );
  });

  it("keeps MariaDB capability-compatible with the MySQL-family profile", () => {
    expect(getDataSourceProfile("mariadb").capabilities).toEqual(
      getDataSourceProfile("mysql").capabilities,
    );
  });

  it("sets connection-kind defaults for the current connection forms", () => {
    expect(getDataSourceProfile("postgresql").connectionKind).toBe("server");
    expect(getDataSourceProfile("mysql").connectionKind).toBe("server");
    expect(getDataSourceProfile("mariadb").connectionKind).toBe("server");
    expect(getDataSourceProfile("mongodb").connectionKind).toBe("server");
    expect(getDataSourceProfile("sqlite").connectionKind).toBe("file");
  });

  it("describes SQLite as a file RDBMS without switch-db or DDL parity", () => {
    const sqlite = getDataSourceProfile("sqlite");

    expect(sqlite.connectionKind).toBe("file");
    expect(sqlite.capabilities).toEqual(expectedCapabilitiesByType.sqlite);
  });

  it("keeps MongoDB document-scoped and separate from global switch-db", () => {
    const mongo = getDataSourceProfile("mongodb");

    expect(mongo.paradigm).toBe("document");
    expect(mongo.languages).toEqual(["mongosh"]);
    expect(mongo.capabilities.connection.switchDatabase).toBe(false);
    expect(mongo.capabilities).toEqual(expectedCapabilitiesByType.mongodb);
  });

  it("keeps unsupported profiles structurally present but capability-empty", () => {
    for (const dbType of [
      "mssql",
      "oracle",
      "redis",
    ] satisfies DatabaseType[]) {
      expect(getDataSourceProfile(dbType).capabilities).toEqual(
        createEmptyDataSourceCapabilities(),
      );
    }
  });

  it("derives connection-dialog supported DBMS options from the profile test capability", () => {
    expect(getConnectionSupportedDatabaseTypes()).toEqual([
      "postgresql",
      "mysql",
      "mariadb",
      "sqlite",
      "mongodb",
    ]);
    expect(isConnectionSupportedDatabaseType("postgresql")).toBe(true);
    expect(isConnectionSupportedDatabaseType("mongodb")).toBe(true);
    expect(isConnectionSupportedDatabaseType("mssql")).toBe(false);
    expect(isConnectionSupportedDatabaseType("oracle")).toBe(false);
    expect(isConnectionSupportedDatabaseType("redis")).toBe(false);
  });

  it("keeps switch-database capability enabled for RDBMS profiles and disabled for Mongo", () => {
    expect(hasConnectionCapability("postgresql", "switchDatabase")).toBe(true);
    expect(hasConnectionCapability("mysql", "switchDatabase")).toBe(true);
    expect(hasConnectionCapability("mariadb", "switchDatabase")).toBe(true);
    expect(hasConnectionCapability("sqlite", "switchDatabase")).toBe(false);
    expect(hasConnectionCapability("mongodb", "switchDatabase")).toBe(false);
  });

  it("keeps SQLite file picker capability explicit and missing profiles disabled", () => {
    expect(hasConnectionCapability("sqlite", "filePicker")).toBe(true);
    expect(hasConnectionCapability("postgresql", "filePicker")).toBe(false);
    expect(
      hasConnectionCapability("unknown-db" as DatabaseType, "filePicker"),
    ).toBe(false);
    expect(isConnectionSupportedDatabaseType(null)).toBe(false);
  });

  it("exposes a read-only profile registry", () => {
    expect(Object.isFrozen(DATA_SOURCE_PROFILES)).toBe(true);

    for (const dbType of allDatabaseTypes) {
      const profile = getDataSourceProfile(dbType);

      expect(Object.isFrozen(profile)).toBe(true);
      expect(Object.isFrozen(profile.languages)).toBe(true);
      expect(Object.isFrozen(profile.resultKinds)).toBe(true);
      expect(Object.isFrozen(profile.capabilities)).toBe(true);
      for (const group of Object.values(profile.capabilities)) {
        expect(Object.isFrozen(group)).toBe(true);
      }
    }
  });

  it("fails deterministically for an unknown DatabaseType", () => {
    expect(() =>
      getDataSourceProfile("unknown-db" as DatabaseType),
    ).toThrowError(/Unknown data source profile/);
  });
});
