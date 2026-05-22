import type { DatabaseType, Paradigm } from "./connection";
import { paradigmOf } from "./connection";

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

function profile(
  id: DatabaseType,
  connectionKind: ConnectionKind,
  languages: readonly QueryLanguageId[],
  catalogModel: CatalogModelKind,
  resultKinds: readonly ResultEnvelopeKind[],
  safetyPolicy: SafetyPolicyId,
): DataSourceProfile {
  return Object.freeze({
    id,
    paradigm: paradigmOf(id),
    connectionKind,
    languages: Object.freeze([...languages]),
    catalogModel,
    resultKinds: Object.freeze([...resultKinds]),
    capabilities: freezeCapabilities(createEmptyDataSourceCapabilities()),
    safetyPolicy,
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
  ),
  mysql: profile("mysql", "server", ["sql"], "rdb", ["tabular"], "rdb-default"),
  mariadb: profile(
    "mariadb",
    "server",
    ["sql"],
    "rdb",
    ["tabular"],
    "rdb-default",
  ),
  sqlite: profile("sqlite", "file", ["sql"], "rdb", ["tabular"], "rdb-default"),
  mssql: profile("mssql", "server", ["sql"], "rdb", ["tabular"], "rdb-default"),
  oracle: profile(
    "oracle",
    "server",
    ["sql"],
    "rdb",
    ["tabular"],
    "rdb-default",
  ),
  mongodb: profile(
    "mongodb",
    "server",
    ["mongosh"],
    "document",
    ["document", "tabular"],
    "document-default",
  ),
  redis: profile(
    "redis",
    "server",
    ["redis-command"],
    "kv",
    ["keyValue", "streamRecords"],
    "kv-default",
  ),
}) satisfies Readonly<Record<DatabaseType, DataSourceProfile>>;

export function getDataSourceProfile(dbType: DatabaseType): DataSourceProfile {
  const profile = DATA_SOURCE_PROFILES[dbType];
  if (!profile) {
    throw new Error(`Unknown data source profile: ${dbType}`);
  }
  return profile;
}
