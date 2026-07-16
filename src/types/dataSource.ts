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
    // Issue #1462 — `schemaDiff` was deleted here: the schema-diff surface
    // (SchemaGraphDiffPanel) renders only inside the ERD panel, transitively
    // gated by `erd`, and no profile ever declared it true. Re-add only if a
    // standalone schema-diff surface is promoted (breadth-first depth step).
    readonly dataCompare: boolean;
    readonly columnProfile: boolean;
  };
  readonly operations: {
    readonly activity: boolean;
    readonly locks: boolean;
    readonly slowQueries: boolean;
    // Issue #1462 — `stats` was deleted here: no server-stats panel, backend
    // command, or consumer exists (CollectionStatsPanel is Mongo collection
    // stats, unrelated). Re-declare when the #1077 profiler dashboard promotes
    // a server-stats surface.
    readonly serverInfo: boolean;
    // Issue #1077 Stage 2 — read-only users/roles listing (PG-first).
    // #1462 — consumed by the OperationsPanel flyout's Users tab.
    readonly users: boolean;
  };
  // Issue #1463 — the entire `paradigmSpecific` group was deleted here. Every
  // flag was dead or 1:1 redundant with `paradigm`, and none was ever read:
  //   - `keyBrowser` was true iff `paradigmOf === "kv"` (redis/valkey); the
  //     sidebar routes on `pickSidebar(paradigm)` → `case "kv"`, never the flag.
  //   - `searchDocuments` (search paradigm), `streamConsumer`, `vectorSearch`,
  //     `accessPatternModeler`, `graphExplorer` were declared false in every
  //     profile with no UI consumer (KvStreamReaderPanel gates on the runtime
  //     `value.value.type === "stream"`, not a capability flag).
  // Re-declare a specific flag only when a paradigm sprouts a surface that a
  // sibling engine in the same paradigm can withhold (i.e. the flag carries
  // information `paradigm` cannot).
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
      dataCompare: false,
      columnProfile: false,
    },
    operations: {
      activity: false,
      locks: false,
      slowQueries: false,
      serverInfo: false,
      users: false,
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
    // Issue #1459 — the SQLite adapter has a real `PRAGMA index_list`
    // introspection path (src-tauri/src/db/adapters/sqlite/connection.rs),
    // so the Indexes claim is true. Constraints stays false: the adapter's
    // structured constraint listing is a stub that always returns [].
    indexes: true,
  },
  edit: {
    editRows: true,
    requiresPrimaryKeyForEdit: true,
  },
  ddl: {
    // Issue #1460 — the wired production `SqliteAdapter` implements only
    // `create_table` / `create_table_plan`
    // (src-tauri/src/db/adapters/sqlite/mod.rs delegates `create_table` to a
    // real BEGIN/execute/COMMIT path; ddl.rs). Every other structured DDL
    // trait method (`drop_table`, `rename_table`, `alter_table`, `add_column`,
    // `create_index`, `drop_index`) returns `sqlite_unsupported(...)`, so only
    // `createTable` is claimed — the alter/index/drop flags stay false and the
    // matching UI entry points are hidden (#1046) rather than click-then-error.
    createTable: true,
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
    // Issue #1269 (gap #5) — the adapter's `execute_query` now interrupts a
    // running statement via `Connection::interrupt_handle` (the DuckDB analogue
    // of the SQLite progress-handler cancel), so the SQL-tab Cancel button is a
    // truthful claim. Cooperative-token path like SQLite — not in
    // `supportsNativeCancel` (in-process interrupt, no server pid).
    cancel: true,
  },
  catalog: {
    browse: true,
    schema: true,
    // Issue #1070 — the adapter's `get_table_indexes` / `get_table_constraints`
    // were silent `Ok(vec![])` stubs that mislabelled every DuckDB table as
    // index/constraint-free. They now introspect `duckdb_indexes()` /
    // `duckdb_constraints()`, so the Structure Indexes/Constraints tabs are a
    // truthful claim (mirrors the SQLite #1459 flip).
    indexes: true,
    constraints: true,
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
 * is the ONLY RDB engine with `edit.editRows: false`. Per ui-parity §4 the
 * affordances are HIDDEN (not disabled) when this returns false. An unknown /
 * still-loading dbType returns true so affordances aren't stripped before the
 * connection resolves.
 *
 * Issue #1460 — schema-tree DDL entries (Create / Rename / Drop) no longer ride
 * on this flag; they read the per-action `ddl.*` capability via `supportsDdl`
 * (each grounded on whether the wired adapter's DDL trait method executes vs.
 * returns `Unsupported`). This flag now gates only the DataGrid row editor.
 */
export function supportsRowEditing(
  dbType: DatabaseType | null | undefined,
): boolean {
  const profile = maybeGetDataSourceProfile(dbType);
  return profile === null || profile.capabilities.edit.editRows;
}

/**
 * Issue #1461 — whether this engine supports editing documents in the grid.
 * The document-paradigm mirror of {@link supportsRowEditing}: the DocumentDataGrid
 * reads `edit.editDocuments` (single source of truth) instead of assuming the
 * document paradigm is always editable, so a read-only document source hides the
 * cell editor + Add/Delete affordances rather than click-then-error. MongoDB is
 * the sole profile declaring it today. An unknown / still-loading dbType returns
 * true so affordances aren't stripped before the connection resolves (same
 * fallback as `supportsRowEditing`).
 */
export function supportsDocumentEditing(
  dbType: DatabaseType | null | undefined,
): boolean {
  const profile = maybeGetDataSourceProfile(dbType);
  return profile === null || profile.capabilities.edit.editDocuments;
}

/**
 * Issue #1461 — whether this engine's document grid exposes the bulk
 * update-many / delete-many affordances. Reads `edit.bulkWrite` (single source
 * of truth). Kept as a flag distinct from `editDocuments` (rather than folded
 * into it): bulk ops act on a filter matching an unbounded document set — a
 * higher-risk write than a single-cell edit — and map to the backend
 * `bulk_write_documents` path that the conformance matrix enumerates
 * independently (redis/valkey defer `edit.bulkWrite` without `editDocuments`).
 * Same DBMS-unknown fallback (true) as `supportsDocumentEditing`.
 */
export function supportsBulkWrite(
  dbType: DatabaseType | null | undefined,
): boolean {
  const profile = maybeGetDataSourceProfile(dbType);
  return profile === null || profile.capabilities.edit.bulkWrite;
}

export type DdlCapabilityName = keyof DataSourceCapabilities["ddl"];

/**
 * Issue #1460 — whether the engine's wired backend adapter can actually execute
 * a given structured DDL action. Reads the per-action `capabilities.ddl.*` flag
 * (single source of truth) instead of the coarse `editRows` proxy, so a partial
 * roster (e.g. SQLite: `createTable` true, alter/index/drop false) surfaces only
 * the entry points the adapter really supports. Unsupported actions are HIDDEN,
 * not shown-then-erroring (#1046). An unknown / still-loading dbType returns
 * true so affordances aren't stripped before the connection resolves (same
 * fallback as `supportsRowEditing` / `supportsCatalogFeature`).
 */
export function supportsDdl(
  dbType: DatabaseType | null | undefined,
  action: DdlCapabilityName,
): boolean {
  const profile = maybeGetDataSourceProfile(dbType);
  return profile === null || profile.capabilities.ddl[action];
}

/**
 * Issue #1459 — whether the Structure surface should offer the Indexes /
 * Constraints catalog sub-tab for this engine. Reads the
 * `capabilities.catalog.*` flag (single source of truth) instead of
 * hard-rendering every tab per dbType. An unknown / still-loading dbType
 * returns true so affordances aren't stripped before the connection
 * resolves (same fallback as `supportsRowEditing`).
 *
 * Boundary decision (#1459): `catalog.browse` / `catalog.schema` are NOT
 * consumed here — browse stays with the paradigm routing (every profile
 * declares it true, so the flag has no discriminating power) and schema
 * stays with `resolveRdbTreeProfile`'s 3-way tree shape, which a boolean
 * cannot express. Whether those two flags are deleted is #1464's call.
 */
export function supportsCatalogFeature(
  dbType: DatabaseType | null | undefined,
  feature: "indexes" | "constraints",
): boolean {
  const profile = maybeGetDataSourceProfile(dbType);
  return profile === null || profile.capabilities.catalog[feature];
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
