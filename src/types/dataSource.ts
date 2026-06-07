import type { DatabaseType, Paradigm } from "./connection";
import { paradigmOf } from "./connection";
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

export const ORACLE_CATALOG_QUERY_CAPABILITIES = capabilities({
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
  operations: {
    activity: true,
    slowQueries: true,
    stats: true,
    serverInfo: true,
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
    switchDatabase: true,
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
  },
  ddl: {
    createTable: true,
    alterTable: true,
    createIndex: true,
    dropObject: true,
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
    ORACLE_CATALOG_QUERY_CAPABILITIES,
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
