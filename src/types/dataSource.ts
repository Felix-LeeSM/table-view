import type { SqlDialect } from "@lib/sql/sqlLiteral";
import type { DatabaseType, Paradigm } from "./connection";
import { paradigmOf } from "./connection";
import {
  BACKEND_ADAPTER_BY_TYPE,
  type BackendAdapterProfile,
  type DataSourceDialectMetadata,
  DIALECT_METADATA,
} from "./dataSourceRuntime";
import {
  DUCKDB_FILE_CONNECTION,
  type FileConnectionContract,
  SQLITE_FILE_CONNECTION,
} from "./fileConnection";
import { isVersionAtLeast } from "./versionOrder";

export type {
  BackendAdapterCapabilitySource,
  BackendAdapterProfile,
  BackendAdapterProfileId,
  DataSourceDialectFamily,
  DataSourceDialectId,
  DataSourceDialectMetadata,
  ServerVersionProbeId,
} from "./dataSourceRuntime";
export type { FileConnectionContract } from "./fileConnection";

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
    // Issue #1464 — `multiStatement` was deleted here: no UI surface reads it
    // (it is a pure execution trait with no toggle/button), so every profile
    // that set it true was a dead claim. Re-declare when a multi-statement
    // runner surface (batch/script editor) actually gates on it.
    readonly cancel: boolean;
    readonly explain: boolean;
  };
  readonly catalog: {
    // Issue #1464 — `browse`, `schema`, `relationships` were deleted here: none
    // had a UI consumer. `browse` was true in every profile (no discriminating
    // power; paradigm routing owns catalog visibility), `schema` was superseded
    // by `resolveRdbTreeProfile`'s 3-way tree shape (a boolean cannot express
    // it), and relationship display rides `intelligence.erd` (#1372), never a
    // catalog flag. Re-declare a specific one when a distinct surface gates on
    // it (breadth-first depth step).
    readonly indexes: boolean;
    readonly constraints: boolean;
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
    /**
     * Issue #1640 — whether the schema-tree "Import CSV…" entry point is
     * surfaced. The commit path builds single-row INSERTs and runs them through
     * the shared `execute_query_batch` command (frontend SQL batch), so it adds
     * no new backend adapter capability; the coarse `dataMutation` posture in
     * the profile-parity report therefore stays unchanged. PG-first (the
     * statement builder emits PostgreSQL-dialect SQL); other engines return
     * `Unsupported` from `build_csv_import_statements`. Consumed by
     * `supportsCsvImport` (csvImportSupport.ts) — a real UI consumer, satisfying
     * the #1462/#1464 "capabilities need a consumer" principle.
     */
    readonly csvRowImport: boolean;
  };
  readonly ddl: {
    readonly createTable: boolean;
    readonly alterTable: boolean;
    readonly createIndex: boolean;
    readonly dropObject: boolean;
    /**
     * Issue #1070 (ADR 0051 Stage 2) — split out of `alterTable`: whether the
     * adapter can run `ALTER TABLE ADD/DROP CONSTRAINT`. Column-alter (add/drop/
     * type) and constraint-alter are both ALTER TABLE, but an engine can support
     * one without the other — DuckDB does native column ALTER but cannot
     * add/drop constraints (needs Stage 2b rebuild-swap). Gates ONLY the
     * Constraints-editor add/drop controls; column editor + schema-tree rename
     * stay on `alterTable`. Full-DDL engines (PG/MySQL/MSSQL/Oracle) set both;
     * SQLite/DuckDB keep this false so the constraint controls stay hidden
     * (#1046 disable-at-source) instead of click-then-error.
     */
    readonly alterConstraint: boolean;
    /**
     * Issue #1070 (ADR 0051 Stage 2) — whether the adapter's structured DDL
     * emitter can honour `ColumnDefinition.is_identity` (auto-increment).
     * Gates the per-column Identity checkbox in `CreateTableDialog` and
     * `AddColumnDialog`. PG emits `GENERATED BY DEFAULT AS IDENTITY`, MySQL
     * `AUTO_INCREMENT`, MSSQL `IDENTITY(1,1)`, Oracle `GENERATED BY DEFAULT AS
     * IDENTITY`; SQLite and DuckDB reject the flag with `Unsupported` (DuckDB
     * auto-increment needs a `CREATE SEQUENCE` + `DEFAULT nextval(...)` pair),
     * so they keep the base `false` and the checkbox stays hidden (#1046)
     * instead of click-then-error — or, worse, a silently plain column.
     */
    readonly identityColumn: boolean;
    /**
     * Issue #1735 — whether the wired adapter emits a column-comment change
     * (`COMMENT ON COLUMN … IS …`) through `alter_table`. Deliberately
     * distinct from `alterTable`: MySQL and MSSQL run structural ALTERs but
     * have no ANSI `COMMENT ON` at all (MySQL folds the comment into the
     * column definition, MSSQL uses `sp_addextendedproperty`), so gating on
     * `alterTable` alone would surface an edit their adapters silently drop.
     * True only for PostgreSQL + Oracle (shared ANSI `COMMENT ON COLUMN`
     * emitter); consumed by the ColumnsEditor comment-cell gate.
     */
    readonly editColumnComment: boolean;
  };
  readonly intelligence: {
    readonly erd: boolean;
    // Issue #1462 — `schemaDiff` was deleted here: the schema-diff surface
    // (SchemaGraphDiffPanel) renders only inside the ERD panel, transitively
    // gated by `erd`, and no profile ever declared it true. Re-add only if a
    // standalone schema-diff surface is promoted (breadth-first depth step).
    // Issue #1464 — `dataCompare`, `columnProfile` were deleted here too: no UI
    // surface, backend command, or consumer exists. Re-declare when a data-diff
    // or column-profiler panel is promoted.
  };
  readonly operations: {
    readonly activity: boolean;
    // Issue #1464 — `locks` was deleted here: no lock-inspector UI, no consumer,
    // and no profile ever set it true. Re-declare when a locks/blocking-session
    // panel is promoted.
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

/* ── Runtime capability (MongoDB) ─────────────────────────────────────────
 *
 * Issue #1821. The rest of this file declares STATIC profile capabilities:
 * compile-time claims keyed by `DatabaseType`, identical for every connection
 * to that engine, readable before any connection exists. The types below are
 * the opposite kind of value — per-connection facts the backend resolves from
 * the server's `hello` + `buildInfo` handshake during `connect()`. Two MongoDB
 * connections open at the same time can legitimately disagree (a 4.4
 * standalone next to a 7.0 sharded cluster), which is why these never live on
 * `DataSourceProfile` and are not merged into `DataSourceCapabilities`.
 *
 * They are also *absent* until a connection is established, so every consumer
 * must handle "not known yet" — see `meetsMongoRuntimeRequirement`, which
 * treats it the same as "server said no".
 */

/**
 * MongoDB deployment shape as reported by the server's `hello` handshake.
 * Mirrors the Rust `MongoTopology` (`src-tauri/table-view-core/src/models/
 * mongo_runtime.rs`) literal-for-literal; the two are one wire contract.
 *
 * `"unknown"` is not a topology — it is the absence of an answer (probe
 * refused, handshake missing the discriminating fields, or no connection yet)
 * and never satisfies a requirement.
 */
export type MongoTopology = "standalone" | "replicaSet" | "sharded" | "unknown";

/** A topology the server actually identified — `"unknown"` excluded. */
export type KnownMongoTopology = Exclude<MongoTopology, "unknown">;

/**
 * Parsed `buildInfo.version`. `raw` keeps the server's own string (including
 * any pre-release tag such as `"4.9.0-rc0"`) for display; the numeric triplet
 * is what comparisons use.
 *
 * The field shape deliberately matches the object form of
 * `DataSourceVersionInput` (`./dataSourceVersionCapabilities`), so this value
 * can be handed to `parseDataSourceVersion` unchanged.
 */
export interface MongoServerVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly raw: string;
}

/** Per-connection MongoDB runtime capability, as it arrives over the wire. */
export interface MongoRuntimeCapabilities {
  readonly topology: MongoTopology;
  /** Absent when `buildInfo` was unavailable or its version was unparsable. */
  readonly version?: MongoServerVersion;
}

/**
 * The fail-closed value: nothing known about the server. Satisfies no
 * requirement. Used for a connection that has not been probed yet and as the
 * fallback whenever the backend read fails.
 */
export const UNKNOWN_MONGO_RUNTIME_CAPABILITIES: MongoRuntimeCapabilities =
  Object.freeze({ topology: "unknown" });

/**
 * What a version/topology-gated feature demands of the connected server.
 * Both axes are optional and an omitted axis is not checked, but at least one
 * must be present — see {@link meetsMongoRuntimeRequirement} for why an empty
 * requirement closes rather than passes.
 */
export interface MongoRuntimeRequirement {
  /** Inclusive minimum `[major, minor, patch]`, e.g. `[4, 0, 0]`. */
  readonly minVersion?: readonly [number, number, number];
  /** Deployment shapes that can serve the feature. */
  readonly topologies?: readonly KnownMongoTopology[];
}

/**
 * Whether the connected server satisfies `requirement`. **Fail-closed**: the
 * answer is `false` for a missing capability (not connected / not probed yet),
 * for an absent version against a `minVersion`, and for an `"unknown"`
 * topology against any `topologies` set — an unidentified server closes the
 * feature instead of opening it. Each axis is judged only when the
 * requirement names it.
 *
 * This is the gate primitive the version-dependent MongoDB axes (change
 * streams, transactions, version-gated aggregation stages) build on. It is
 * deliberately the only place the comparison lives: the backend reports facts
 * and does not re-check them, per the single-layer capability-gate decision in
 * `memory/engineering/architecture/data-source/memory.md` (#1618).
 */
export function meetsMongoRuntimeRequirement(
  capabilities: MongoRuntimeCapabilities | null | undefined,
  requirement: MongoRuntimeRequirement,
): boolean {
  if (!capabilities) return false;

  const { minVersion, topologies } = requirement;
  // A requirement that constrains nothing is a caller bug — a misspelled key
  // (`{ minversion: [...] }`) reads as `{}` at runtime, and opening the
  // feature is the wrong way for that mistake to surface. Callers that need
  // nothing from the server should not consult the gate at all.
  if (!minVersion && !topologies) return false;

  if (topologies) {
    // Widened so `"unknown"` can be compared at all: the requirement type
    // excludes it, so an unidentified server matches no allowed set.
    const allowed: readonly MongoTopology[] = topologies;
    if (!allowed.includes(capabilities.topology)) return false;
  }

  if (minVersion) {
    const version = capabilities.version;
    if (!version) return false;
    return isVersionAtLeast(version, ...minVersion);
  }

  return true;
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
      cancel: false,
      explain: false,
    },
    catalog: {
      indexes: false,
      constraints: false,
    },
    edit: {
      editRows: false,
      editDocuments: false,
      editKeys: false,
      bulkWrite: false,
      requiresPrimaryKeyForEdit: false,
      csvRowImport: false,
    },
    ddl: {
      createTable: false,
      alterTable: false,
      createIndex: false,
      dropObject: false,
      alterConstraint: false,
      identityColumn: false,
      editColumnComment: false,
    },
    intelligence: {
      erd: false,
    },
    operations: {
      activity: false,
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
    // Issue #1529 — the backend read-only gate is engine-agnostic, so every
    // server RDB that can write exposes the toggle (same protection = same
    // control). Prevents a stuck read-only connection with no UI to clear it.
    readOnly: true,
  },
  query: {
    query: true,
    cancel: true,
  },
  catalog: {
    indexes: true,
    constraints: true,
  },
  edit: {
    editRows: true,
    requiresPrimaryKeyForEdit: true,
  },
  // Issue #1072 — the full OracleAdapter routes every structured DDL trait
  // method (create/alter/drop table, create/drop index, add/drop constraint) to
  // the bounded builder (oracle/ddl.rs), matching the pg/mysql full-DDL posture,
  // so all four StructurePanel entry points are truthful claims.
  ddl: {
    createTable: true,
    alterTable: true,
    createIndex: true,
    dropObject: true,
    alterConstraint: true,
    identityColumn: true,
    // Issue #1735 — Oracle emits COMMENT ON COLUMN through alter_table
    // (shares the ANSI syntax with PG).
    editColumnComment: true,
  },
  intelligence: {
    erd: true,
  },
  // Issue #1073 — Oracle admin ops parity. Backed by the OracleAdapter v$
  // sources (v$session / v$sql / v$instance; ALTER SYSTEM KILL SESSION). The
  // v$ reads fail loud when the login lacks catalog-read privilege rather than
  // returning a silent empty list. `users` stays false (#1077 Stage 2 is
  // PG-first); `locks` has no adapter override on any engine. Same shape as
  // MySQL/MongoDB, so the OperationsPanel flyout surfaces the tabs unchanged.
  operations: {
    activity: true,
    slowQueries: true,
    serverInfo: true,
  },
});

export const POSTGRESQL_CAPABILITIES = capabilities({
  connection: {
    test: true,
    switchDatabase: true,
    // Issue #1529 — PostgreSQL exposes the read-only connection toggle. The
    // backend `safe_mode::enforce_read_only` chokepoint blocks writes on any
    // RDB connection flagged read-only regardless of this flag; this capability
    // gates the UI (the connection-form toggle + the grid editor hide, which
    // already reads `connection.readOnly`). PG-first rollout — extend to the
    // other server RDB engines by flipping their `connection.readOnly` here.
    readOnly: true,
  },
  query: {
    query: true,
    cancel: true,
    explain: true,
  },
  catalog: {
    indexes: true,
    constraints: true,
  },
  edit: {
    editRows: true,
    // Issue #1640 — PG-first CSV row import commit path (gates the schema-tree
    // "Import CSV…" entry point via `supportsCsvImport`).
    csvRowImport: true,
  },
  ddl: {
    createTable: true,
    alterTable: true,
    createIndex: true,
    dropObject: true,
    alterConstraint: true,
    identityColumn: true,
    // Issue #1735 — PG emits COMMENT ON COLUMN through alter_table.
    editColumnComment: true,
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
    // Issue #1529 — see ORACLE_CAPABILITIES: engine-agnostic backend gate.
    // NOTE: MySQL/MariaDB implicit-commit DDL means a dry-run cannot roll a
    // schema write back, so the read-only gate (incl. dry-run) is the real
    // protection here.
    readOnly: true,
  },
  query: {
    query: true,
    cancel: true,
    // Issue #1067 — MySQL/MariaDB `EXPLAIN FORMAT=JSON` plan surfaces the
    // shared Explain button; ExplainViewer renders the JSON via its raw
    // fallback (no PG-shaped plan tree).
    explain: true,
  },
  catalog: {
    indexes: true,
    constraints: true,
  },
  edit: {
    editRows: true,
  },
  ddl: {
    createTable: true,
    alterTable: true,
    createIndex: true,
    dropObject: true,
    alterConstraint: true,
    identityColumn: true,
  },
  intelligence: {
    erd: true,
  },
  // Issue #1073 — MySQL/MariaDB admin ops parity. Backed by the shared
  // MysqlAdapter (information_schema.processlist / KILL /
  // performance_schema.events_statements_summary_by_digest / SHOW GLOBAL
  // STATUS+VARIABLES). Issue #1077 Stage 2 — `users` now sourced from the
  // `mysql.user` catalog (User/Host + privilege flags only; the
  // `authentication_string`/`Password` credential columns are never selected —
  // see the `MYSQL_USERS_QUERY` guard fixture). `locks` has no adapter override
  // on any engine. Same shape as MongoDB, so the OperationsPanel flyout
  // surfaces activity/serverInfo/slowQueries/users without a panel change.
  operations: {
    activity: true,
    slowQueries: true,
    serverInfo: true,
    users: true,
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
    cancel: true,
  },
  catalog: {
    // Issue #1459 — the SQLite adapter has a real `PRAGMA index_list`
    // introspection path (src-tauri/table-view-core/src/db/adapters/sqlite/connection.rs),
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
    // (src-tauri/table-view-core/src/db/adapters/sqlite/mod.rs delegates `create_table` to a
    // real BEGIN/execute/COMMIT path; ddl.rs). Every other structured DDL
    // trait method (`drop_table`, `rename_table`, `alter_table`, `add_column`,
    // `create_index`, `drop_index`) returns `sqlite_unsupported(...)`, so only
    // `createTable` is claimed — the alter/index/drop flags stay false and the
    // matching UI entry points are hidden (#1046) rather than click-then-error.
    // `identityColumn` (#1070) also stays at the base `false`: SQLite's
    // `build_column_definition` rejects `is_identity` with `Unsupported`, so
    // the Identity checkbox is hidden here too.
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
    // Issue #1070 — the adapter's `get_table_indexes` / `get_table_constraints`
    // were silent `Ok(vec![])` stubs that mislabelled every DuckDB table as
    // index/constraint-free. They now introspect `duckdb_indexes()` /
    // `duckdb_constraints()`, so the Structure Indexes/Constraints tabs are a
    // truthful claim (mirrors the SQLite #1459 flip).
    // (`browse` / `schema` keys were deleted repo-wide by #1464.)
    indexes: true,
    constraints: true,
  },
  edit: {
    // Issue #1070 (ADR 0051 Stage 1) — the wired DuckdbAdapter now routes
    // structured grid row edits through `execute_sql_batch` (a BEGIN..COMMIT
    // batch with drop-based rollback + the `enforce_single_row_effect`
    // single-row guard, #1767), so `editRows` is a truthful claim. A
    // `read_only=true` connection still blocks writes (the DataGrid gates on the
    // per-connection `readOnly` value, and the backend rejects writes on the
    // read-only connection). `requiresPrimaryKeyForEdit` stays at the base
    // (false): DuckDB rides the all-column WHERE fallback like PG/MySQL and
    // relies on the backend single-row guard, so PK-less analytical tables stay
    // editable.
    editRows: true,
  },
  // Issue #1070 (ADR 0051 Stage 2) — the wired DuckdbAdapter now runs native
  // structural DDL (`duckdb/ddl.rs`): table create/drop/rename, column
  // add/drop/type, index create/drop. `alterConstraint` stays false (base) —
  // DuckDB `ALTER TABLE` cannot add/drop constraints, so the Constraints-editor
  // add/drop controls AND the CreateTableDialog FK/CHECK/UNIQUE surfaces stay
  // hidden pending Stage 2b rebuild-swap (the read-only constraint list still
  // shows via `catalog.constraints`). `identityColumn` stays false too: the
  // adapter rejects `is_identity` with `Unsupported` because DuckDB
  // auto-increment needs a `CREATE SEQUENCE` + `DEFAULT nextval(...)` pair.
  ddl: {
    createTable: true,
    alterTable: true,
    createIndex: true,
    dropObject: true,
  },
});

export const MSSQL_CAPABILITIES = capabilities({
  connection: {
    test: true,
    // Issue #1529 — see ORACLE_CAPABILITIES: engine-agnostic backend gate.
    readOnly: true,
  },
  query: {
    query: true,
    cancel: true,
  },
  catalog: {
    indexes: true,
    constraints: true,
  },
  edit: {
    editRows: true,
    requiresPrimaryKeyForEdit: true,
  },
  // Issue #1071 — the wired MssqlAdapter routes every structured DDL trait
  // method (create/alter/drop table, create/drop index, add/drop constraint)
  // to the bounded T-SQL builder (ddl.rs), matching the pg/mysql full-DDL
  // posture, so all four StructurePanel entry points are truthful claims.
  ddl: {
    createTable: true,
    alterTable: true,
    createIndex: true,
    dropObject: true,
    alterConstraint: true,
    identityColumn: true,
  },
  intelligence: {
    erd: true,
  },
  // Issue #1073 — SQL Server admin ops parity. Backed by the MssqlAdapter
  // sys.dm_exec_* DMVs (dm_exec_sessions / dm_exec_query_stats / dm_os_sys_info;
  // KILL). The server-scoped DMVs fail loud without VIEW SERVER STATE rather
  // than returning a silent empty list. Issue #1077 Stage 2 — `users` now
  // sourced from `sys.server_principals` (login/role name + flags only; the
  // `sys.sql_logins.password_hash` credential is never read — see the
  // `USERS_SQL` guard fixture). `locks` has no adapter override on any engine.
  // Same shape as MySQL/MongoDB, so the OperationsPanel flyout surfaces the
  // tabs unchanged.
  operations: {
    activity: true,
    slowQueries: true,
    serverInfo: true,
    users: true,
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
    // Issue #1269 (gap #6) — the KV sidebar scan and the redis-command query
    // tab both register a cooperative cancel token; the backend checks it
    // between keys during metadata enrichment (SCAN/KEYS), so the Stop button
    // is a truthful claim. Cooperative-only (Redis is not in-process, no server
    // pid) — not in `supportsNativeCancel`, tooltip stays "Stop query".
    cancel: true,
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
    // Issue #1269 (gap #6) — see REDIS_CAPABILITIES: same cooperative token
    // backing (Valkey shares the Redis KV adapter path).
    cancel: true,
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
 * Issue #1052 — whether this engine STATICALLY supports row-level data editing
 * (independent of the per-connection runtime `readOnly` value the DataGrid gates
 * separately). Per ui-parity §4 the affordances are HIDDEN (not disabled) when
 * this returns false. An unknown / still-loading dbType returns true so
 * affordances aren't stripped before the connection resolves.
 *
 * Issue #1070 (ADR 0051 Stage 1) — DuckDB left the read-only base here: the
 * wired adapter now routes structured grid row edits through
 * `execute_sql_batch` (BEGIN..COMMIT + single-row guard, #1767), so every RDB
 * engine now declares `edit.editRows`. Structural DDL is a separate Stage 2
 * surface gated by `supportsDdl`, so this flip does not touch the schema-tree
 * DDL entries.
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
 * the sole profile declaring it today.
 *
 * Issue #1618 (D3) — an unknown / still-loading dbType now returns FALSE
 * (fail-closed). The document grid only mounts for an already-resolved document
 * connection, so the unknown-dbType branch is effectively dead in practice and
 * fail-closed strips no real affordance; a write path defaulting to "enabled"
 * before the capability is known is the wrong default for a mutation gate. This
 * differs on purpose from the RDB trio (`supportsRowEditing` / `supportsDdl` /
 * `supportsCatalogFeature`), which keep the affordance-preserving fail-open
 * fallback because their surfaces (StructurePanel / DataGrid) can legitimately
 * render mid-resolve during the schema-tree load; flipping those is a separate
 * pass (Refs #1618).
 */
export function supportsDocumentEditing(
  dbType: DatabaseType | null | undefined,
): boolean {
  const profile = maybeGetDataSourceProfile(dbType);
  return profile !== null && profile.capabilities.edit.editDocuments;
}

/**
 * Issue #1461 — whether this engine's document grid exposes the bulk
 * update-many / delete-many affordances. Reads `edit.bulkWrite` (single source
 * of truth). Kept as a flag distinct from `editDocuments` (rather than folded
 * into it): bulk ops act on a filter matching an unbounded document set — a
 * higher-risk write than a single-cell edit — and map to the backend
 * `bulk_write_documents` path that the conformance matrix enumerates
 * independently (redis/valkey defer `edit.bulkWrite` without `editDocuments`).
 *
 * Issue #1618 (D6) — the fold-vs-split decision: bulkWrite stays a SEPARATE flag
 * from editDocuments (not folded). Revisit only if a counter-example DBMS
 * appears that supports `editDocuments` but not `bulkWrite` (or vice versa) and
 * the split stops earning its keep. Same fail-closed unknown-dbType default as
 * `supportsDocumentEditing` (#1618 D3).
 */
export function supportsBulkWrite(
  dbType: DatabaseType | null | undefined,
): boolean {
  const profile = maybeGetDataSourceProfile(dbType);
  return profile !== null && profile.capabilities.edit.bulkWrite;
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
 * Boundary decision (#1459 → resolved by #1464): `catalog.browse` /
 * `catalog.schema` were deleted — browse carried no discriminating power (every
 * profile declared it true) and paradigm routing owns catalog visibility, while
 * schema is superseded by `resolveRdbTreeProfile`'s 3-way tree shape (a boolean
 * cannot express it). Only `indexes` / `constraints` remain as catalog flags.
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
