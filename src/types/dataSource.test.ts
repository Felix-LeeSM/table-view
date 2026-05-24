import { describe, expect, it } from "vitest";
import {
  DATABASE_TYPE_LABELS,
  SUPPORTED_DATABASE_TYPES,
  type DatabaseType,
  paradigmOf,
} from "./connection";
import { toWorkspaceQueryLanguage } from "@stores/workspaceStore/queryMode";
import {
  createEmptyDataSourceCapabilities,
  DATA_SOURCE_PROFILES,
  type DataSourceCapabilities,
  getConnectionSupportedDatabaseTypes,
  getDataSourceProfile,
  hasConnectionCapability,
  isConnectionSupportedDatabaseType,
} from "./dataSource";
import {
  FILE_RDBMS_DATABASE_TYPES,
  RDBMS_DATABASE_TYPES,
  RUNTIME_RDBMS_DATABASE_TYPES,
  SERVER_RDBMS_DATABASE_TYPES,
} from "./rdbmsDataSources";

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
      connection: { test: true, filePicker: true, readOnly: true },
      query: { query: true, multiStatement: true, cancel: true },
      catalog: { browse: true, schema: true },
      edit: { editRows: true },
    }),
    duckdb: expectedCapabilities({
      connection: { test: true, filePicker: true, readOnly: true },
      query: { query: true },
      catalog: { browse: true, schema: true },
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
    redis: expectedCapabilities({
      connection: { test: true },
      catalog: { browse: true },
      edit: { editKeys: true },
      paradigmSpecific: { keyBrowser: true },
    }),
    elasticsearch: expectedCapabilities({
      connection: { test: true },
    }),
    opensearch: expectedCapabilities({
      connection: { test: true },
    }),
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

  it("keeps MariaDB identity while exposing MySQL-family adapter and dialect metadata", () => {
    const mysql = getDataSourceProfile("mysql");
    const mariadb = getDataSourceProfile("mariadb");

    expect(mysql.id).toBe("mysql");
    expect(mariadb.id).toBe("mariadb");
    expect(mariadb.backendAdapter).toBe(mysql.backendAdapter);
    expect(mariadb.backendAdapter).toEqual({
      id: "mysql-family",
      kind: "rdb",
      capabilitySource: "mysql-family",
    });
    expect(mysql.dialect).toEqual({
      id: "mysql",
      family: "mysql",
      versionProbe: "mysql-family-version",
    });
    expect(mariadb.dialect).toEqual({
      id: "mariadb",
      family: "mysql",
      versionProbe: "mysql-family-version",
    });
  });

  it("sets connection-kind defaults for the current connection forms", () => {
    expect(getDataSourceProfile("postgresql").connectionKind).toBe("server");
    expect(getDataSourceProfile("mysql").connectionKind).toBe("server");
    expect(getDataSourceProfile("mariadb").connectionKind).toBe("server");
    expect(getDataSourceProfile("mongodb").connectionKind).toBe("server");
    expect(getDataSourceProfile("redis").connectionKind).toBe("server");
    expect(getDataSourceProfile("sqlite").connectionKind).toBe("file");
    expect(getDataSourceProfile("duckdb").connectionKind).toBe("file");
  });

  it("describes SQLite as a file RDBMS with scoped row-edit but no switch-db or DDL parity", () => {
    const sqlite = getDataSourceProfile("sqlite");

    expect(sqlite.connectionKind).toBe("file");
    expect(sqlite.capabilities).toEqual(expectedCapabilitiesByType.sqlite);
    expect(sqlite.capabilities.edit.editRows).toBe(true);
    expect(sqlite.capabilities.ddl.createTable).toBe(false);
    expect(sqlite.capabilities.ddl.alterTable).toBe(false);
    expect(sqlite.capabilities.ddl.createIndex).toBe(false);
    expect(sqlite.capabilities.ddl.dropObject).toBe(false);
  });

  it("keeps MongoDB document-scoped and separate from global switch-db", () => {
    const mongo = getDataSourceProfile("mongodb");

    expect(mongo.paradigm).toBe("document");
    expect(mongo.languages).toEqual(["mongosh"]);
    expect(mongo.capabilities.connection.switchDatabase).toBe(false);
    expect(mongo.capabilities).toEqual(expectedCapabilitiesByType.mongodb);
  });

  it("exposes Redis as a supported KV key-browser profile", () => {
    const redis = getDataSourceProfile("redis");

    expect(redis.paradigm).toBe("kv");
    expect(redis.languages).toEqual(["redis-command"]);
    expect(redis.backendAdapter).toEqual({
      id: "redis",
      kind: "kv",
      capabilitySource: "redis",
    });
    expect(redis.capabilities.paradigmSpecific.keyBrowser).toBe(true);
    expect(redis.resultKinds).toEqual(["keyValue", "streamRecords"]);
    expect(redis.capabilities.connection.switchDatabase).toBe(false);
    expect(redis.capabilities.edit.editKeys).toBe(true);
    expect(redis.capabilities.paradigmSpecific.streamConsumer).toBe(false);
  });

  it("keeps unsupported profiles structurally present but capability-empty", () => {
    for (const dbType of ["mssql", "oracle"] satisfies DatabaseType[]) {
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
      "duckdb",
      "mongodb",
      "redis",
      "elasticsearch",
      "opensearch",
    ]);
    expect(isConnectionSupportedDatabaseType("postgresql")).toBe(true);
    expect(isConnectionSupportedDatabaseType("mongodb")).toBe(true);
    expect(isConnectionSupportedDatabaseType("duckdb")).toBe(true);
    expect(isConnectionSupportedDatabaseType("redis")).toBe(true);
    expect(isConnectionSupportedDatabaseType("mssql")).toBe(false);
    expect(isConnectionSupportedDatabaseType("oracle")).toBe(false);
    expect(isConnectionSupportedDatabaseType("elasticsearch")).toBe(true);
    expect(isConnectionSupportedDatabaseType("opensearch")).toBe(true);
  });

  it("keeps search profiles connection-only until live HTTP catalog lands", () => {
    for (const dbType of [
      "elasticsearch",
      "opensearch",
    ] satisfies DatabaseType[]) {
      const profile = getDataSourceProfile(dbType);

      expect(profile.capabilities.connection.test).toBe(true);
      expect(profile.capabilities.catalog.browse).toBe(false);
      expect(profile.capabilities.query.query).toBe(false);
      expect(profile.capabilities.paradigmSpecific.searchDocuments).toBe(false);
    }
  });

  it("keeps legacy URL supported DBMS list aligned with profile-supported DBMS", () => {
    expect(getConnectionSupportedDatabaseTypes()).toEqual(
      SUPPORTED_DATABASE_TYPES,
    );
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
    ]);
    expect(SERVER_RDBMS_DATABASE_TYPES).toEqual([
      "postgresql",
      "mysql",
      "mariadb",
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
      expect(profile.capabilities.catalog.browse).toBe(true);
      expect(profile.capabilities.catalog.schema).toBe(true);
    }

    for (const dbType of ["mssql", "oracle"] satisfies DatabaseType[]) {
      const profile = getDataSourceProfile(dbType);

      expect(profile.paradigm).toBe("rdb");
      expect(profile.backendAdapter).toEqual({
        id: "declared-rdb",
        kind: "rdb",
        capabilitySource: "declared-rdb",
      });
      expect(profile.capabilities).toEqual(createEmptyDataSourceCapabilities());
      expect(isConnectionSupportedDatabaseType(dbType)).toBe(false);
    }
  });

  it("keeps current query-tab language defaults aligned with source profiles", () => {
    for (const dbType of SUPPORTED_DATABASE_TYPES) {
      const profile = getDataSourceProfile(dbType);

      expect(
        toWorkspaceQueryLanguage({
          paradigm: profile.paradigm,
        }),
      ).toBe(profile.languages[0]);
    }
  });

  it("keeps switch-database capability enabled for RDBMS profiles and disabled for non-toolbar profiles", () => {
    expect(hasConnectionCapability("postgresql", "switchDatabase")).toBe(true);
    expect(hasConnectionCapability("mysql", "switchDatabase")).toBe(true);
    expect(hasConnectionCapability("mariadb", "switchDatabase")).toBe(true);
    expect(hasConnectionCapability("sqlite", "switchDatabase")).toBe(false);
    expect(hasConnectionCapability("mongodb", "switchDatabase")).toBe(false);
    expect(hasConnectionCapability("redis", "switchDatabase")).toBe(false);
  });

  it("keeps SQLite file picker and read-only capabilities explicit while missing profiles stay disabled", () => {
    expect(hasConnectionCapability("sqlite", "filePicker")).toBe(true);
    expect(hasConnectionCapability("sqlite", "readOnly")).toBe(true);
    expect(hasConnectionCapability("duckdb", "filePicker")).toBe(true);
    expect(hasConnectionCapability("duckdb", "readOnly")).toBe(true);
    expect(hasConnectionCapability("postgresql", "filePicker")).toBe(false);
    expect(hasConnectionCapability("postgresql", "readOnly")).toBe(false);
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
      expect(Object.isFrozen(profile.backendAdapter)).toBe(true);
      expect(Object.isFrozen(profile.dialect)).toBe(true);
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

  it("models DuckDB as a file-backed RDBMS profile with catalog/query runtime", () => {
    const duckdb = getDataSourceProfile("duckdb");

    expect(duckdb).toMatchObject({
      id: "duckdb",
      paradigm: "rdb",
      connectionKind: "file",
      languages: ["sql"],
      catalogModel: "rdb",
      resultKinds: ["tabular"],
      safetyPolicy: "rdb-default",
    });
    expect(duckdb.capabilities.connection).toMatchObject({
      test: true,
      switchDatabase: false,
      readOnly: true,
      filePicker: true,
    });
    expect(duckdb.capabilities.query.query).toBe(true);
    expect(duckdb.capabilities.catalog.browse).toBe(true);
    expect(duckdb.capabilities.catalog.schema).toBe(true);
    expect(duckdb.capabilities.edit.editRows).toBe(false);
    expect(duckdb.capabilities.ddl.createTable).toBe(false);
    expect(duckdb.backendAdapter).toEqual({
      id: "duckdb",
      kind: "rdb",
      capabilitySource: "duckdb",
    });
    expect(duckdb.dialect).toEqual({
      id: "duckdb",
      family: "duckdb",
      versionProbe: "none",
    });
  });

  it("keeps DuckDB file analytics local-first and supports CSV/Parquet/JSON/NDJSON", () => {
    const duckdb = getDataSourceProfile("duckdb");

    expect(duckdb.fileConnection).toMatchObject({
      pathField: "database",
      readOnlyField: "readOnly",
      permissionScope: "local-file",
      privacyPolicy: "local-first",
      supportedInputs: [
        {
          id: "duckdb-database",
          kind: "database",
          extensions: [".duckdb"],
          status: "supported",
        },
        {
          id: "csv",
          kind: "analytics",
          extensions: [".csv"],
          status: "supported",
        },
        {
          id: "parquet",
          kind: "analytics",
          extensions: [".parquet"],
          status: "supported",
        },
        {
          id: "json",
          kind: "analytics",
          extensions: [".json"],
          status: "supported",
        },
        {
          id: "ndjson",
          kind: "analytics",
          extensions: [".ndjson"],
          status: "supported",
        },
      ],
      deferredInputs: [],
    });
  });

  it("reuses the file contract fields for SQLite and DuckDB without collapsing their identities", () => {
    const sqlite = getDataSourceProfile("sqlite") as ReturnType<
      typeof getDataSourceProfile
    > & {
      fileConnection?: {
        pathField: string;
        readOnlyField: string;
        supportedInputs: readonly {
          id: string;
          extensions: readonly string[];
        }[];
      };
    };
    const duckdb = getDataSourceProfile("duckdb") as typeof sqlite;

    expect(sqlite.fileConnection?.pathField).toBe("database");
    expect(duckdb.fileConnection?.pathField).toBe("database");
    expect(sqlite.fileConnection?.readOnlyField).toBe("readOnly");
    expect(duckdb.fileConnection?.readOnlyField).toBe("readOnly");
    expect(sqlite.fileConnection?.supportedInputs[0]).toMatchObject({
      id: "sqlite-database",
      extensions: [".sqlite", ".sqlite3", ".db"],
    });
    expect(duckdb.fileConnection?.supportedInputs[0]).toMatchObject({
      id: "duckdb-database",
      extensions: [".duckdb"],
    });
  });
});
