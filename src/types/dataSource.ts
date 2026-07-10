import type { DatabaseType, Paradigm } from "./connection";
import { paradigmOf } from "./connection";
import type { SqlDialect } from "@lib/sql/sqlLiteral";
import {
  DUCKDB_FILE_CONNECTION,
  SQLITE_FILE_CONNECTION,
  type FileConnectionContract,
} from "./fileConnection";
import {
  BACKEND_ADAPTER_BY_TYPE,
  DIALECT_METADATA,
  type BackendAdapterProfile,
  type DataSourceDialectMetadata,
} from "./dataSourceRuntime";

export type { FileConnectionContract } from "./fileConnection";
export type {
  BackendAdapterCapabilitySource,
  BackendAdapterProfile,
  BackendAdapterProfileId,
  DataSourceDialectFamily,
  DataSourceDialectId,
  DataSourceDialectMetadata,
  ServerVersionProbeId,
} from "./dataSourceRuntime";

export type DataParadigm = Paradigm;
export type ConnectionKind =
  | "server"
  | "file"
  | "url"
  | "cloud-api"
  | "cluster";
export type QueryLanguageId =
  | "sql"
  | "mongosh"
  | "redis-command"
  | "search-dsl"
  | "cql"
  | "partiql"
  | "cypher"
  | "gql"
  | "gremlin"
  | "vector-query"
  | "stream-command";
export type CatalogModelKind =
  | "rdb"
  | "document"
  | "kv"
  | "search"
  | "wide-column"
  | "cloud-document"
  | "graph"
  | "vector"
  | "stream";
export type ResultEnvelopeKind =
  | "tabular"
  | "document"
  | "keyValue"
  | "searchHits"
  | "graph"
  | "vectorNeighbors"
  | "streamRecords"
  | "metrics";

export type SafetyPolicyId =
  | "rdb-default"
  | "document-default"
  | "kv-default"
  | "search-default";

export interface DataSourceCapabilities {
  readonly connection: {
    readonly test: boolean;
    readonly switchDatabase: boolean;
    readonly readOnly: boolean;
    readonly filePicker: boolean;
  };
  readonly query: {
    readonly query: boolean;
    readonly multiStatement: boolean;
    readonly cancel: boolean;
    readonly explain: boolean;
  };
  readonly catalog: {
    readonly browse: boolean;
    readonly schema: boolean;
    readonly indexes: boolean;
    readonly constraints: boolean;
    readonly relationships: boolean;
  };
  readonly edit: {
    readonly editRows: boolean;
    readonly editDocuments: boolean;
    readonly editKeys: boolean;
    readonly bulkWrite: boolean;
    /**
     * Issue #1356 — single source of truth for "this DBMS requires a primary
     * key to edit a row; the all-column WHERE fallback is disabled". The UI
     * edit gate and the SQL builder both read this flag instead of each
     * re-encoding the DBMS roster (drift previously risked a whole-table
     * UPDATE). Independent of `editRows`: a source may support row edits yet
     * still require a PK to identify the target row safely.
     */
    readonly requiresPrimaryKeyForEdit: boolean;
  };
  readonly ddl: {
    readonly createTable: boolean;
    readonly alterTable: boolean;
    readonly createIndex: boolean;
    readonly dropObject: boolean;
  };
  readonly intelligence: {
    readonly erd: boolean;
    readonly schemaDiff: boolean;
    readonly dataCompare: boolean;
    readonly columnProfile: boolean;
  };
  readonly operations: {
    readonly activity: boolean;
    readonly locks: boolean;
    readonly slowQueries: boolean;
    readonly stats: boolean;
    readonly serverInfo: boolean;
    // Issue #1077 Stage 2 — read-only users/roles listing (PG-first).
    readonly users: boolean;
  };
  readonly paradigmSpecific: {
    readonly keyBrowser: boolean;
    readonly searchDocuments: boolean;
    readonly vectorSearch: boolean;
    readonly accessPatternModeler: boolean;
    readonly graphExplorer: boolean;
    readonly streamConsumer: boolean;
  };
}

export interface DataSourceProfile {
  readonly id: DatabaseType;
  readonly paradigm: DataParadigm;
  readonly connectionKind: ConnectionKind;
  readonly languages: readonly QueryLanguageId[];
  readonly catalogModel: CatalogModelKind;
  readonly resultKinds: readonly ResultEnvelopeKind[];
  readonly capabilities: DataSourceCapabilities;
  readonly safetyPolicy: SafetyPolicyId;
  readonly backendAdapter: BackendAdapterProfile;
  readonly dialect: DataSourceDialectMetadata;
  readonly fileConnection?: FileConnectionContract;
}

export function createEmptyDataSourceCapabilities(): DataSourceCapabilities {
  return {
    connection: {
      test: false,
      switchDatabase: false,
      readOnly: false,
      filePicker: false,
    },
    query: {
      query: false,
      multiStatement: false,
      cancel: false,
      explain: false,
    },
    catalog: {
      browse: false,
      schema: false,
      indexes: false,
      constraints: false,
      relationships: false,
    },
    edit: {
      editRows: false,
      editDocuments: false,
      editKeys: false,
      bulkWrite: false,
      requiresPrimaryKeyForEdit: false,
    },
    ddl: {
      createTable: false,
      alterTable: false,
      createIndex: false,
      dropObject: false,
    },
    intelligence: {
      erd: false,
      schemaDiff: false,
      dataCompare: false,
      columnProfile: false,
    },
    operations: {
      activity: false,
      locks: false,
      slowQueries: false,
      stats: false,
      serverInfo: false,
      users: false,
    },
    paradigmSpecific: {
      keyBrowser: false,
      searchDocuments: false,
      vectorSearch: false,
      accessPatternModeler: false,
      graphExplorer: false,
      streamConsumer: false,
    },
  };
}

function freezeCapabilities(
  capabilities: DataSourceCapabilities,
): DataSourceCapabilities {
  Object.freeze(capabilities.connection);
  Object.freeze(capabilities.query);
  Object.freeze(capabilities.catalog);
  Object.freeze(capabilities.edit);
  Object.freeze(capabilities.ddl);
  Object.freeze(capabilities.intelligence);
  Object.freeze(capabilities.operations);
  Object.freeze(capabilities.paradigmSpecific);
  return Object.freeze(capabilities);
}

type CapabilityOverrides = {
  readonly [Group in keyof DataSourceCapabilities]?: Partial<
    DataSourceCapabilities[Group]
  >;
};

function capabilities(
  overrides: CapabilityOverrides = {},
): DataSourceCapabilities {
  const base = createEmptyDataSourceCapabilities();

  for (const [group, values] of Object.entries(overrides) as [
    keyof DataSourceCapabilities,
    Partial<DataSourceCapabilities[keyof DataSourceCapabilities]>,
  ][]) {
    Object.assign(base[group], values);
  }

  return freezeCapabilities(base);
}

export const UNSUPPORTED_CAPABILITIES = capabilities();

export const ORACLE_CAPABILITIES = capabilities({
  connection: {
    test: true,
  },
  query: {
    query: true,
    multiStatement: true,
    cancel: true,
  },
  catalog: {
    browse: true,
    schema: true,
    indexes: true,
    constraints: true,
    relationships: true,
  },
  edit: {
    editRows: true,
    requiresPrimaryKeyForEdit: true,
  },
  intelligence: {
    erd: true,
  },
});

export const POSTGRESQL_CAPABILITIES = capabilities({
  connection: {
    test: true,
    switchDatabase: true,
  },
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
  edit: {
    editRows: true,
  },
  ddl: {
    createTable: true,
    alterTable: true,
    createIndex: true,
    dropObject: true,
  },
  intelligence: {
    erd: true,
  },
  operations: {
    activity: true,
    slowQueries: true,
    stats: true,
    serverInfo: true,
    users: true,
  },
});

export const MYSQL_FAMILY_CAPABILITIES = capabilities({
  connection: {
    test: true,
    switchDatabase: true,
  },
  query: {
    query: true,
    multiStatement: true,
    cancel: true,
    // Issue #1067 — MySQL/MariaDB `EXPLAIN FORMAT=JSON` plan surfaces the
    // shared Explain button; ExplainViewer renders the JSON via its raw
    // fallback (no PG-shaped plan tree).
    explain: true,
  },
  catalog: {
    browse: true,
    schema: true,
    indexes: true,
    constraints: true,
    relationships: true,
  },
  edit: {
    editRows: true,
  },
  ddl: {
    createTable: true,
    alterTable: true,
    createIndex: true,
    dropObject: true,
  },
  intelligence: {
    erd: true,
  },
});

export const SQLITE_CAPABILITIES = capabilities({
  connection: {
    test: true,
    filePicker: true,
    readOnly: true,
  },
  query: {
    query: true,
    multiStatement: true,
    cancel: true,
  },
  catalog: {
    browse: true,
    schema: true,
  },
  edit: {
    editRows: true,
    requiresPrimaryKeyForEdit: true,
  },
  intelligence: {
    erd: true,
  },
});

export const DUCKDB_CAPABILITIES = capabilities({
  connection: {
    test: true,
    filePicker: true,
    readOnly: true,
  },
  query: {
    query: true,
  },
  catalog: {
    browse: true,
    schema: true,
  },
});

export const MSSQL_CAPABILITIES = capabilities({
  connection: {
    test: true,
  },
  query: {
    query: true,
    multiStatement: true,
    cancel: true,
  },
  catalog: {
    browse: true,
    schema: true,
    indexes: true,
    constraints: true,
    relationships: true,
  },
  edit: {
    editRows: true,
    requiresPrimaryKeyForEdit: true,
  },
  intelligence: {
    erd: true,
  },
});

export const MONGODB_CAPABILITIES = capabilities({
  connection: {
    test: true,
  },
  query: {
    query: true,
    cancel: true,
    explain: true,
  },
  catalog: {
    browse: true,
    schema: true,
    indexes: true,
  },
  edit: {
    editDocuments: true,
    bulkWrite: true,
  },
  ddl: {
    createIndex: true,
    dropObject: true,
  },
  operations: {
    activity: true,
    slowQueries: true,
    stats: true,
    serverInfo: true,
  },
});

export const REDIS_CAPABILITIES = capabilities({
  connection: {
    test: true,
    switchDatabase: true,
  },
  query: {
    query: true,
  },
  catalog: {
    browse: true,
  },
  edit: {
    editKeys: true,
  },
  paradigmSpecific: {
    keyBrowser: true,
    streamConsumer: false,
  },
});

export const VALKEY_CAPABILITIES = capabilities({
  connection: {
    test: true,
    switchDatabase: true,
  },
  query: {
    query: true,
  },
  catalog: {
    browse: true,
  },
  edit: {
    editKeys: true,
  },
  paradigmSpecific: {
    keyBrowser: true,
  },
});

export const ELASTICSEARCH_CAPABILITIES = capabilities({
  connection: {
    test: true,
  },
  query: {
    query: true,
    cancel: true,
  },
  catalog: {
    browse: true,
    indexes: true,
  },
});

export const OPENSEARCH_CAPABILITIES = capabilities({
  connection: {
    test: true,
  },
  query: {
    query: true,
    cancel: true,
  },
  catalog: {
    browse: true,
    indexes: true,
  },
});

function profile(
  id: DatabaseType,
  connectionKind: ConnectionKind,
  languages: readonly QueryLanguageId[],
  catalogModel: CatalogModelKind,
  resultKinds: readonly ResultEnvelopeKind[],
  safetyPolicy: SafetyPolicyId,
  sourceCapabilities: DataSourceCapabilities = UNSUPPORTED_CAPABILITIES,
  fileConnection?: FileConnectionContract,
): DataSourceProfile {
  return Object.freeze({
    id,
    paradigm: paradigmOf(id),
    connectionKind,
    languages: Object.freeze([...languages]),
    catalogModel,
    resultKinds: Object.freeze([...resultKinds]),
    capabilities: sourceCapabilities,
    safetyPolicy,
    backendAdapter: BACKEND_ADAPTER_BY_TYPE[id],
    dialect: DIALECT_METADATA[id],
    fileConnection,
  });
}

export const DATA_SOURCE_PROFILES = Object.freeze({
  postgresql: profile(
    "postgresql",
    "server",
    ["sql"],
    "rdb",
    ["tabular"],
    "rdb-default",
    POSTGRESQL_CAPABILITIES,
  ),
  mysql: profile(
    "mysql",
    "server",
    ["sql"],
    "rdb",
    ["tabular"],
    "rdb-default",
    MYSQL_FAMILY_CAPABILITIES,
  ),
  mariadb: profile(
    "mariadb",
    "server",
    ["sql"],
    "rdb",
    ["tabular"],
    "rdb-default",
    MYSQL_FAMILY_CAPABILITIES,
  ),
  sqlite: profile(
    "sqlite",
    "file",
    ["sql"],
    "rdb",
    ["tabular"],
    "rdb-default",
    SQLITE_CAPABILITIES,
    SQLITE_FILE_CONNECTION,
  ),
  duckdb: profile(
    "duckdb",
    "file",
    ["sql"],
    "rdb",
    ["tabular"],
    "rdb-default",
    DUCKDB_CAPABILITIES,
    DUCKDB_FILE_CONNECTION,
  ),
  mssql: profile(
    "mssql",
    "server",
    ["sql"],
    "rdb",
    ["tabular"],
    "rdb-default",
    MSSQL_CAPABILITIES,
  ),
  oracle: profile(
    "oracle",
    "server",
    ["sql"],
    "rdb",
    ["tabular"],
    "rdb-default",
    ORACLE_CAPABILITIES,
  ),
  mongodb: profile(
    "mongodb",
    "server",
    ["mongosh"],
    "document",
    ["document", "tabular"],
    "document-default",
    MONGODB_CAPABILITIES,
  ),
  redis: profile(
    "redis",
    "server",
    ["redis-command"],
    "kv",
    ["keyValue", "streamRecords", "tabular"],
    "kv-default",
    REDIS_CAPABILITIES,
  ),
  valkey: profile(
    "valkey",
    "server",
    ["redis-command"],
    "kv",
    ["keyValue", "streamRecords", "tabular"],
    "kv-default",
    VALKEY_CAPABILITIES,
  ),
  elasticsearch: profile(
    "elasticsearch",
    "server",
    ["search-dsl"],
    "search",
    ["searchHits"],
    "search-default",
    ELASTICSEARCH_CAPABILITIES,
  ),
  opensearch: profile(
    "opensearch",
    "server",
    ["search-dsl"],
    "search",
    ["searchHits"],
    "search-default",
    OPENSEARCH_CAPABILITIES,
  ),
}) satisfies Readonly<Record<DatabaseType, DataSourceProfile>>;

export type ConnectionCapabilityName =
  keyof DataSourceCapabilities["connection"];

function maybeGetDataSourceProfile(
  dbType: DatabaseType | null | undefined,
): DataSourceProfile | null {
  if (!dbType) return null;
  return (
    (DATA_SOURCE_PROFILES as Partial<Record<DatabaseType, DataSourceProfile>>)[
      dbType
    ] ?? null
  );
}

export function hasConnectionCapability(
  dbType: DatabaseType | null | undefined,
  capability: ConnectionCapabilityName,
): boolean {
  return (
    maybeGetDataSourceProfile(dbType)?.capabilities.connection[capability] ===
    true
  );
}

/**
 * Issue #1052 — whether this engine supports row-level data editing. DuckDB is
 * read-only because its backend adapter implements no write/DDL path (the
 * `AccessMode::ReadOnly` connection reflects that, it is not the cause), and it
 * is the ONLY RDB engine with `edit.editRows: false`, so this flag also gates
 * the schema-tree DDL entries
 * (Create / Rename / Drop): an engine that cannot edit a row cannot run DDL
 * either, and the `ddl.*` capability group is under-populated (SQLite / MSSQL /
 * Oracle leave it false yet support table DDL), which makes `editRows` the
 * reliable read-only discriminator. Per ui-parity §4 the affordances are
 * HIDDEN (not disabled) when this returns false. An unknown / still-loading
 * dbType returns true so affordances aren't stripped before the connection
 * resolves.
 */
export function supportsRowEditing(
  dbType: DatabaseType | null | undefined,
): boolean {
  const profile = maybeGetDataSourceProfile(dbType);
  return profile === null || profile.capabilities.edit.editRows;
}

export function getConnectionSupportedDatabaseTypes(): readonly DatabaseType[] {
  return (Object.keys(DATA_SOURCE_PROFILES) as DatabaseType[]).filter(
    (dbType) => hasConnectionCapability(dbType, "test"),
  );
}

export function isConnectionSupportedDatabaseType(
  dbType: DatabaseType | null | undefined,
): boolean {
  return hasConnectionCapability(dbType, "test");
}

export function getDataSourceProfile(dbType: DatabaseType): DataSourceProfile {
  const profile = DATA_SOURCE_PROFILES[dbType];
  if (!profile) {
    throw new Error(`Unknown data source profile: ${dbType}`);
  }
  return profile;
}

/**
 * Issue #1356 — resolve `requiresPrimaryKeyForEdit` from a `SqlDialect`. The
 * SQL builder only carries a dialect (not a dbType), so this keeps the
 * PK-required roster living solely in the capability profiles. Every
 * `SqlDialect` literal is also a valid `DatabaseType`, so the dialect doubles
 * as the profile key.
 */
export function dialectRequiresPrimaryKeyForEdit(dialect: SqlDialect): boolean {
  return getDataSourceProfile(dialect).capabilities.edit
    .requiresPrimaryKeyForEdit;
}
