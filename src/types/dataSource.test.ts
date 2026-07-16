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
  supportsBulkWrite,
  supportsDocumentEditing,
  supportsRowEditing,
} from "./dataSource";
import {
  getActiveQueryLanguages,
  getQueryLanguageMetadata,
} from "./queryLanguage";

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
    query: { query: true, cancel: true, explain: true },
    catalog: {
      indexes: true,
      constraints: true,
    },
    edit: { editRows: true },
    ddl: {
      createTable: true,
      alterTable: true,
      createIndex: true,
      dropObject: true,
    },
    intelligence: { erd: true },
    // Issue #1073 — MySQL/MariaDB admin ops parity (no users: #1077 PG-first).
    operations: { activity: true, slowQueries: true, serverInfo: true },
  });

  const expectedCapabilitiesByType: Record<
    DatabaseType,
    DataSourceCapabilities
  > = {
    postgresql: expectedCapabilities({
      // Issue #1529 — PostgreSQL exposes the read-only connection toggle.
      connection: { test: true, switchDatabase: true, readOnly: true },
      query: {
        query: true,
        cancel: true,
        explain: true,
      },
      catalog: {
        indexes: true,
        constraints: true,
      },
      edit: { editRows: true },
      ddl: {
        createTable: true,
        alterTable: true,
        createIndex: true,
        dropObject: true,
      },
      intelligence: { erd: true },
      operations: {
        activity: true,
        slowQueries: true,
        serverInfo: true,
        users: true,
      },
    }),
    mysql: mysqlFamilyCapabilities,
    mariadb: mysqlFamilyCapabilities,
    sqlite: expectedCapabilities({
      connection: { test: true, filePicker: true, readOnly: true },
      query: { query: true, cancel: true },
      // Issue #1459 — SQLite claims catalog.indexes (PRAGMA index_list
      // introspection is live); constraints remains a stub → false.
      catalog: { indexes: true },
      edit: { editRows: true, requiresPrimaryKeyForEdit: true },
      // Issue #1460 — wired SqliteAdapter executes only create_table; other DDL
      // trait methods return Unsupported, so createTable is the sole claim.
      ddl: { createTable: true },
      intelligence: { erd: true },
    }),
    duckdb: expectedCapabilities({
      connection: { test: true, filePicker: true, readOnly: true },
      // Issue #1269 (gap #5) — cancel now backed by `execute_query` interrupt.
      query: { query: true, cancel: true },
      // Issue #1070 — indexes/constraints backed by real duckdb_indexes() /
      // duckdb_constraints() introspection (was a silent Ok(vec![]) stub).
      catalog: { indexes: true, constraints: true },
    }),
    mssql: expectedCapabilities({
      connection: { test: true },
      query: { query: true, cancel: true },
      catalog: {
        indexes: true,
        constraints: true,
      },
      edit: { editRows: true, requiresPrimaryKeyForEdit: true },
      intelligence: { erd: true },
    }),
    oracle: expectedCapabilities({
      connection: { test: true },
      query: { query: true, cancel: true },
      catalog: {
        indexes: true,
        constraints: true,
      },
      edit: { editRows: true, requiresPrimaryKeyForEdit: true },
      intelligence: { erd: true },
    }),
    mongodb: expectedCapabilities({
      connection: { test: true },
      query: { query: true, cancel: true, explain: true },
      catalog: { indexes: true },
      edit: { editDocuments: true, bulkWrite: true },
      ddl: { createIndex: true, dropObject: true },
      operations: {
        activity: true,
        slowQueries: true,
        serverInfo: true,
      },
    }),
    redis: expectedCapabilities({
      connection: { test: true, switchDatabase: true },
      // Issue #1269 (gap #6) — cooperative scan/command cancel now backed.
      query: { query: true, cancel: true },
      edit: { editKeys: true },
    }),
    valkey: expectedCapabilities({
      connection: { test: true, switchDatabase: true },
      query: { query: true, cancel: true },
      edit: { editKeys: true },
    }),
    elasticsearch: expectedCapabilities({
      connection: { test: true },
      query: { query: true, cancel: true },
      catalog: { indexes: true },
    }),
    opensearch: expectedCapabilities({
      connection: { test: true },
      query: { query: true, cancel: true },
      catalog: { indexes: true },
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
    expect(getDataSourceProfile("mariadb").capabilities).toBe(
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

  it("documents the intentional MySQL-family reuse surface for MariaDB", () => {
    const mysql = getDataSourceProfile("mysql");
    const mariadb = getDataSourceProfile("mariadb");

    expect(mariadb.connectionKind).toBe(mysql.connectionKind);
    expect(mariadb.languages).toEqual(mysql.languages);
    expect(mariadb.catalogModel).toBe(mysql.catalogModel);
    expect(mariadb.resultKinds).toEqual(mysql.resultKinds);
    expect(mariadb.safetyPolicy).toBe(mysql.safetyPolicy);
    expect(mariadb.backendAdapter).toBe(mysql.backendAdapter);
    expect(mariadb.capabilities).toBe(mysql.capabilities);
    expect(mariadb.fileConnection).toBeUndefined();
    expect(mariadb.dialect).toEqual({
      id: "mariadb",
      family: mysql.dialect.family,
      versionProbe: mysql.dialect.versionProbe,
    });
    expect(mariadb.dialect.id).not.toBe(mysql.dialect.id);
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

  it("describes SQLite as a file RDBMS with scoped row-edit and create-table-only DDL", () => {
    const sqlite = getDataSourceProfile("sqlite");

    expect(sqlite.connectionKind).toBe("file");
    expect(sqlite.capabilities).toEqual(expectedCapabilitiesByType.sqlite);
    expect(sqlite.capabilities.edit.editRows).toBe(true);
    // Issue #1460 — only create_table is wired in the adapter; alter/index/drop
    // return Unsupported, so their flags stay false and the UI hides them.
    expect(sqlite.capabilities.ddl.createTable).toBe(true);
    expect(sqlite.capabilities.ddl.alterTable).toBe(false);
    expect(sqlite.capabilities.ddl.createIndex).toBe(false);
    expect(sqlite.capabilities.ddl.dropObject).toBe(false);
  });

  it("keeps MongoDB document-scoped and separate from global switch-db", () => {
    const mongo = getDataSourceProfile("mongodb");

    expect(mongo.paradigm).toBe("document");
    expect(mongo.languages).toEqual(["mongosh"]);
    expect(mongo.catalogModel).toBe("document");
    expect(mongo.resultKinds).toEqual(["document", "tabular"]);
    expect(mongo.safetyPolicy).toBe("document-default");
    expect(mongo.backendAdapter).toEqual({
      id: "mongodb",
      kind: "document",
      capabilitySource: "mongodb",
    });
    expect(mongo.capabilities.connection.switchDatabase).toBe(false);
    expect(mongo.capabilities.query.query).toBe(true);
    expect(mongo.capabilities.query.cancel).toBe(true);
    expect(mongo.capabilities.query.explain).toBe(true);
    expect(mongo.capabilities.catalog.indexes).toBe(true);
    expect(mongo.capabilities.edit.editDocuments).toBe(true);
    expect(mongo.capabilities.edit.editRows).toBe(false);
    expect(mongo.capabilities.edit.bulkWrite).toBe(true);
    expect(mongo.capabilities.ddl.createIndex).toBe(true);
    expect(mongo.capabilities.ddl.dropObject).toBe(true);
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
    // #1463 — KV routing now rides solely on `paradigm === "kv"`
    // (WorkspaceSidebar → pickSidebar → `case "kv"`); the redundant
    // `paradigmSpecific.keyBrowser` flag was deleted. `streamRecords` in
    // resultKinds is the real stream signal (KvStreamReaderPanel gates on the
    // runtime `value.value.type === "stream"`, never a capability flag).
    expect(redis.resultKinds).toEqual(["keyValue", "streamRecords", "tabular"]);
    expect(redis.capabilities.connection.switchDatabase).toBe(true);
    expect(redis.capabilities.edit.editKeys).toBe(true);
  });

  it("exposes Valkey as a KV key-browser runtime with bounded command query", () => {
    const valkey = getDataSourceProfile("valkey");

    expect(valkey.paradigm).toBe("kv");
    expect(valkey.connectionKind).toBe("server");
    expect(valkey.languages).toEqual(["redis-command"]);
    expect(valkey.catalogModel).toBe("kv");
    expect(valkey.resultKinds).toEqual([
      "keyValue",
      "streamRecords",
      "tabular",
    ]);
    expect(valkey.backendAdapter).toEqual({
      id: "valkey",
      kind: "kv",
      capabilitySource: "valkey",
    });
    expect(valkey.capabilities).toEqual(expectedCapabilitiesByType.valkey);
    expect(valkey.capabilities.query.query).toBe(true);
    expect(valkey.capabilities.edit.editKeys).toBe(true);
    // #1463 — see redis test: KV sidebar routing rides on `paradigm === "kv"`,
    // asserted above; the redundant keyBrowser flag was deleted.
    expect(isConnectionSupportedDatabaseType("valkey")).toBe(true);
  });

  it("derives connection-dialog supported DBMS options from the profile test capability", () => {
    expect(getConnectionSupportedDatabaseTypes()).toEqual([
      "postgresql",
      "mysql",
      "mariadb",
      "sqlite",
      "duckdb",
      "mssql",
      "oracle",
      "mongodb",
      "redis",
      "valkey",
      "elasticsearch",
      "opensearch",
    ]);
    expect(isConnectionSupportedDatabaseType("postgresql")).toBe(true);
    expect(isConnectionSupportedDatabaseType("mongodb")).toBe(true);
    expect(isConnectionSupportedDatabaseType("duckdb")).toBe(true);
    expect(isConnectionSupportedDatabaseType("mssql")).toBe(true);
    expect(isConnectionSupportedDatabaseType("redis")).toBe(true);
    expect(isConnectionSupportedDatabaseType("valkey")).toBe(true);
    expect(isConnectionSupportedDatabaseType("oracle")).toBe(true);
    expect(isConnectionSupportedDatabaseType("elasticsearch")).toBe(true);
    expect(isConnectionSupportedDatabaseType("opensearch")).toBe(true);
  });

  it("exposes Elasticsearch live connection, catalog, and bounded query claims", () => {
    const profile = getDataSourceProfile("elasticsearch");

    expect(profile.capabilities.connection.test).toBe(true);
    expect(profile.capabilities.query.query).toBe(true);
    expect(profile.capabilities.query.cancel).toBe(true);
    expect(profile.capabilities.query.explain).toBe(false);
  });

  it("exposes OpenSearch live connection, catalog, and bounded query while keeping explain/admin deferred", () => {
    const profile = getDataSourceProfile("opensearch");

    expect(profile.capabilities.connection.test).toBe(true);
    expect(profile.capabilities.catalog.indexes).toBe(true);
    expect(profile.capabilities.query.query).toBe(true);
    expect(profile.capabilities.query.cancel).toBe(true);
    expect(profile.capabilities.query.explain).toBe(false);
  });

  it("keeps legacy URL supported DBMS list aligned with profile-supported DBMS", () => {
    expect(getConnectionSupportedDatabaseTypes()).toEqual(
      SUPPORTED_DATABASE_TYPES,
    );
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

  it("requires owner metadata for every active query language", () => {
    const activeLanguages = [
      ...new Set(
        Object.values(DATA_SOURCE_PROFILES).flatMap((profile) =>
          profile.capabilities.query.query ? profile.languages : [],
        ),
      ),
    ].sort();

    expect([...getActiveQueryLanguages()].sort()).toEqual(activeLanguages);

    for (const languageId of activeLanguages) {
      const metadata = getQueryLanguageMetadata(languageId);

      expect(metadata.lifecycle).toBe("active");
      expect(metadata.parserOwner).toBeTruthy();
      expect(metadata.completionOwner).toBeTruthy();
      expect(metadata.fallbackPolicy.kind).not.toBe("source-of-truth");
      expect(metadata.safetyAnalyzer).toBeTruthy();
    }
  });

  it("keeps ADR 0045 hot-path languages owned by Rust/WASM with compatibility mirrors only", () => {
    for (const languageId of ["sql", "mongosh"] as const) {
      const metadata = getQueryLanguageMetadata(languageId);

      expect(metadata.parserOwner).toBe("rust-wasm-language-core");
      expect(metadata.completionOwner).toBe("rust-wasm-language-core");
      expect(metadata.fallbackPolicy).toMatchObject({
        kind: "compatibility-mirror",
        sourceOfTruth: "rust-wasm-language-core",
      });
    }
  });

  it("keeps switch-database capability enabled for toolbar database contexts", () => {
    expect(hasConnectionCapability("postgresql", "switchDatabase")).toBe(true);
    expect(hasConnectionCapability("mysql", "switchDatabase")).toBe(true);
    expect(hasConnectionCapability("mariadb", "switchDatabase")).toBe(true);
    expect(hasConnectionCapability("mssql", "switchDatabase")).toBe(false);
    expect(hasConnectionCapability("oracle", "switchDatabase")).toBe(false);
    expect(hasConnectionCapability("sqlite", "switchDatabase")).toBe(false);
    expect(hasConnectionCapability("mongodb", "switchDatabase")).toBe(false);
    expect(hasConnectionCapability("redis", "switchDatabase")).toBe(true);
    expect(hasConnectionCapability("valkey", "switchDatabase")).toBe(true);
  });

  it("keeps SQLite file picker and read-only capabilities explicit while missing profiles stay disabled", () => {
    expect(hasConnectionCapability("sqlite", "filePicker")).toBe(true);
    expect(hasConnectionCapability("sqlite", "readOnly")).toBe(true);
    expect(hasConnectionCapability("duckdb", "filePicker")).toBe(true);
    expect(hasConnectionCapability("duckdb", "readOnly")).toBe(true);
    expect(hasConnectionCapability("postgresql", "filePicker")).toBe(false);
    // Issue #1529 — PostgreSQL now exposes the read-only connection toggle.
    expect(hasConnectionCapability("postgresql", "readOnly")).toBe(true);
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

describe("supportsRowEditing — #1052 read-only-engine gate", () => {
  it("is false for DuckDB (the only RDB with edit.editRows false)", () => {
    expect(supportsRowEditing("duckdb")).toBe(false);
  });

  it("is true for engines that can edit rows", () => {
    for (const dbType of [
      "postgresql",
      "mysql",
      "mariadb",
      "sqlite",
      "mssql",
      "oracle",
    ] as const) {
      expect(supportsRowEditing(dbType)).toBe(true);
    }
  });

  it("defaults to true for an unknown / still-loading dbType so affordances are not stripped early", () => {
    expect(supportsRowEditing(undefined)).toBe(true);
    expect(supportsRowEditing(null)).toBe(true);
  });
});

describe("supportsDocumentEditing — #1461 edit.editDocuments gate", () => {
  it("is true only for MongoDB (the sole profile with edit.editDocuments)", () => {
    expect(supportsDocumentEditing("mongodb")).toBe(true);
  });

  it("is false for engines that declare no document-edit capability", () => {
    for (const dbType of [
      "postgresql",
      "sqlite",
      "redis",
      "elasticsearch",
    ] as const) {
      expect(supportsDocumentEditing(dbType)).toBe(false);
    }
  });

  it("defaults to true for an unknown / still-loading dbType (affordance-preserving, same as supportsRowEditing)", () => {
    expect(supportsDocumentEditing(undefined)).toBe(true);
    expect(supportsDocumentEditing(null)).toBe(true);
  });
});

describe("supportsBulkWrite — #1461 edit.bulkWrite gate", () => {
  it("is true only for MongoDB (the sole profile with edit.bulkWrite)", () => {
    expect(supportsBulkWrite("mongodb")).toBe(true);
  });

  it("is false for engines that declare no bulk-write capability", () => {
    for (const dbType of [
      "postgresql",
      "sqlite",
      "redis",
      "elasticsearch",
    ] as const) {
      expect(supportsBulkWrite(dbType)).toBe(false);
    }
  });

  it("defaults to true for an unknown / still-loading dbType (affordance-preserving)", () => {
    expect(supportsBulkWrite(undefined)).toBe(true);
    expect(supportsBulkWrite(null)).toBe(true);
  });
});
