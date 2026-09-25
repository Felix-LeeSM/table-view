//! Adapter trait hierarchy — `DbAdapter` (lifecycle) and the four
//! paradigm-specific extension traits (`RdbAdapter`, `DocumentAdapter`,
//! `SearchAdapter`, `KvAdapter`).
//!
//! Hoisted out of `db/mod.rs`. The trait surface
//! is unchanged — `crate::db::DbAdapter` and friends continue to resolve
//! via `pub use` in `db/mod.rs`. Adapter implementations and `ActiveAdapter`
//! enum live in their own siblings.

use tokio_util::sync::CancellationToken;

use crate::error::AppError;
use crate::models::{
    AddColumnRequest, AddConstraintRequest, AlterTableRequest, ColumnInfo, ConnectionConfig,
    ConstraintInfo, CreateIndexRequest, CreateTablePlanRequest, CreateTableRequest,
    CreateTriggerRequest, DatabaseType, DropColumnRequest, DropConstraintRequest, DropIndexRequest,
    DropTableRequest, DropTriggerRequest, FileAnalyticsPreview, FileAnalyticsQueryResponse,
    FileAnalyticsSource, FileAnalyticsSourceMetadata, FilterCondition, FunctionInfo, IndexInfo,
    PostgresExtensionInfo, PostgresTypeInfo, RenameTableRequest, SchemaChangeResult,
    SearchAliasInfo, SearchCatalogSummary, SearchClusterIdentity, SearchDataStreamInfo,
    SearchDeleteByQueryRequest, SearchDeleteByQueryResult, SearchDestructiveOperationPlan,
    SearchFieldStatsEnvelope, SearchIndexInfo, SearchIndexMapping, SearchIndexSettings,
    SearchIndexTemplateInfo, SearchQueryRequest, SearchResultEnvelope, SqliteCapabilityInventory,
    TableData, TableInfo, TriggerInfo, ValueSearchResult, ViewInfo,
};

use super::types::{
    BoxFuture, BulkWriteOp, BulkWriteResult, CollectionValidatorRead, CreateMongoIndexRequest,
    CreateMongoIndexResult, DocumentCollectionInfo, DocumentId, DocumentQueryResult, DocumentRow,
    FindBody, NamespaceInfo, NamespaceLabel, RdbQueryResult,
};

/// Issue #1230 (PR #1241 review) — converge any post-cancel outcome onto the
/// canonical cancelled error so every DBMS reaches the same frontend
/// cancelled-state.
///
/// A native cancel (`pg_cancel_backend` / `KILL QUERY`) aborts the statement
/// on the server, which the executor's `tokio::select!` can observe as the
/// query future resolving *first* — before the cooperative-token branch wins.
/// That resolution is dialect-specific and NOT uniformly "cancelled": MySQL
/// surfaces `ER_QUERY_INTERRUPTED` (1317, message "Query execution was
/// interrupted") or even a spurious success (`SELECT SLEEP(n)` returns 1 when
/// interrupted), whereas PostgreSQL surfaces `57014` whose message the
/// frontend already maps to cancelled. When the cooperative token HAS fired
/// (the frontend always fires it on Cancel), we treat the run as cancelled
/// regardless of the raced outcome, killing the mysql/pg asymmetry the e2e
/// caught.
pub(crate) fn finalize_cancelled<T>(
    result: Result<T, AppError>,
    cancel_token: Option<&CancellationToken>,
) -> Result<T, AppError> {
    if cancel_token.is_some_and(CancellationToken::is_cancelled) {
        return Err(AppError::Database("Query cancelled".into()));
    }
    result
}

// ── Lifecycle trait ───────────────────────────────────────────────────────

/// Connection lifecycle contract shared by every adapter paradigm.
pub trait DbAdapter: Send + Sync {
    fn kind(&self) -> DatabaseType;

    fn connect<'a>(&'a self, config: &'a ConnectionConfig) -> BoxFuture<'a, Result<(), AppError>>;

    fn disconnect<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>>;

    fn ping<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>>;

    /// Q5.3 — paradigm-native cancel for a running statement.
    ///
    /// `server_pid` is the server-side identifier captured at executeQuery
    /// time and recorded in `AppState.query_server_pids` (Issue #1230), which
    /// the frontend resolves via `get_query_server_pid` and passes back here:
    ///
    /// * PostgreSQL → `pg_backend_pid()` (i32 surfaced as i64).
    /// * MySQL      → `CONNECTION_ID()` thread id (u64 → i64 fits).
    /// * MongoDB    → opid materialised by the runner mid-query.
    ///
    /// Concrete implementations open a **separate, fresh connection**
    /// before issuing the cancel — re-using the in-flight connection is
    /// impossible because it is currently consumed by the statement we
    /// are trying to abort. The default body returns `Unsupported` so
    /// paradigms that have not wired this yet still type-check; the
    /// frontend wrapper folds `Unsupported` into the legacy cooperative
    /// `cancel_query(query_id)` path.
    fn cancel_query<'a>(&'a self, _server_pid: i64) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not support native cancel".into(),
            ))
        })
    }

    /// Issue #1269 (P1) — native cancel keyed by an execution tag rather than
    /// a pre-captured server pid.
    ///
    /// Mongo has no client-visible pid: the running op's `opid` only exists
    /// while it runs and is discoverable via `$currentOp`. Instead of the
    /// runner materialising it mid-query, the runner stamps the op with
    /// `command.comment == tag` (the request's `query_id`) and this method
    /// resolves the opid on demand at cancel time, then issues `killOp`.
    /// Resolving at cancel time keeps the permission failure (Atlas shared /
    /// no `inprog`/`killop` privilege) synchronous with the user's click so
    /// it surfaces through `CancelError` rather than degrading silently.
    ///
    /// The default returns `Unsupported`. Note this is NOT folded back into the
    /// cooperative-token path: `cancel_query_native_inner` passes the error
    /// message straight to `classify_cancel_error`, which has no "unsupported"
    /// keyword and so buckets it as `NetworkError` (a toast). That misclassify
    /// is currently a dead path — every tag-cancel caller targets Mongo, which
    /// overrides this method, and no other adapter routes the tag path — but
    /// the default must not claim a graceful fold that does not exist. Any new
    /// adapter that wants tag-based cancel overrides this rather than relying
    /// on the default.
    fn cancel_query_by_tag<'a>(&'a self, _tag: &'a str) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not support tag-based native cancel".into(),
            ))
        })
    }
}

// ── RdbAdapter ────────────────────────────────────────────────────────────

/// Relational-database paradigm (PostgreSQL, MySQL, SQLite, …).
///
/// Trait methods accept `(namespace, table)` order uniformly; concrete
/// implementations may reorder arguments internally when delegating to
/// legacy inherent methods.
#[allow(clippy::too_many_arguments)]
pub trait RdbAdapter: DbAdapter {
    fn namespace_label(&self) -> NamespaceLabel;

    fn list_namespaces<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>>;

    /// List databases visible to the connected user.
    ///
    /// For paradigm symmetry with `DocumentAdapter::list_databases`. PG
    /// surfaces every non-template database in the cluster; future SQLite /
    /// MySQL adapters fall back to the default `Vec::new()` impl below until
    /// their concrete implementations are wired. Empty Vec is the
    /// graceful "no databases to show" signal — frontend renders the
    /// existing read-only label.
    fn list_databases<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
        Box::pin(async { Ok(Vec::new()) })
    }

    /// Switch the adapter's "active database".
    ///
    /// Concrete adapters that maintain a per-database connection pool
    /// override this to swap the active sub-pool to `db_name`. The default
    /// returns `Unsupported` so the frontend toast can surface a clear
    /// message rather than silently no-op.
    fn switch_database<'a>(&'a self, _db_name: &'a str) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not support database switching".into(),
            ))
        })
    }

    /// Resolve the adapter's currently-active database.
    ///
    /// Used by the `verify_active_db` Tauri command to compare the
    /// optimistic `setActiveDb` value the frontend wrote after a raw
    /// `\c <db>` against the backend's truth. Default implementation runs
    /// `SELECT current_database()` through `execute_sql` so any RDB
    /// adapter that follows ANSI semantics inherits a working verify path
    /// without a custom override. Adapters that cannot answer (no pool
    /// open) propagate the underlying error.
    fn current_database<'a>(&'a self) -> BoxFuture<'a, Result<Option<String>, AppError>> {
        Box::pin(async move {
            let result = self.execute_sql("SELECT current_database()", None).await?;
            let row = result
                .rows
                .first()
                .ok_or_else(|| AppError::Database("current_database() returned no rows".into()))?;
            let val = row.first().ok_or_else(|| {
                AppError::Database("current_database() returned no columns".into())
            })?;
            Ok(val.as_str().map(|s| s.to_string()))
        })
    }

    fn list_tables<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>>;

    /// AC-180-04: accepts `Option<&CancellationToken>` so an
    /// in-flight schema-introspection query can be cooperatively aborted via
    /// the same `query_tokens` registry that drives `execute_sql`. Adapters
    /// observe the token at the same `tokio::select!` shape used by
    /// `PostgresAdapter::execute_query`.
    fn get_columns<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>>;

    fn execute_sql<'a>(
        &'a self,
        sql: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<RdbQueryResult, AppError>>;

    /// Issue #1230 — like `execute_sql`, but the adapter pins ONE connection
    /// and sends that connection's native server pid through `pid_tx` before
    /// the (possibly long) statement runs, so native cancel can abort it.
    ///
    /// The pid MUST be captured on the *same* connection the statement runs
    /// on. sqlx pools hand out any idle connection, so a separate probe would
    /// return a different backend's pid and `pg_cancel_backend` / `KILL QUERY`
    /// would target the wrong session. Adapters with native cancel (PG, MySQL)
    /// override this and acquire the connection once.
    ///
    /// The default drops `pid_tx` (the `oneshot::Receiver` resolves to `Err`,
    /// so the caller records no pid) and runs the ordinary pooled path — the
    /// frontend then keeps cooperative-token cancel for adapters without a
    /// native path (SQLite / DuckDB / MSSQL / Oracle).
    fn execute_sql_tracked<'a>(
        &'a self,
        sql: &'a str,
        cancel: Option<&'a CancellationToken>,
        pid_tx: tokio::sync::oneshot::Sender<i64>,
    ) -> BoxFuture<'a, Result<RdbQueryResult, AppError>> {
        drop(pid_tx);
        self.execute_sql(sql, cancel)
    }

    /// Execute statements inside one transaction. A failure on statement K
    /// rolls back statements 1..K-1. Adapters that have not wired
    /// transactional commit inherit `Unsupported`.
    fn execute_sql_batch<'a>(
        &'a self,
        _statements: &'a [String],
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<RdbQueryResult>, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not support batched transactions".into(),
            ))
        })
    }

    /// Execute statements inside one transaction and roll back on success.
    /// This gives destructive-change preview the same rows-affected stats
    /// and statement-indexed errors as the commit path without persisting
    /// changes. Dialect adapters override this when rollback semantics are
    /// reliable; document adapters are routed away before this method.
    fn dry_run_sql_batch<'a>(
        &'a self,
        _statements: &'a [String],
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<RdbQueryResult>, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not support dry-run".into(),
            ))
        })
    }

    /// AC-180-04: cancel-token cooperation as above.
    #[allow(clippy::too_many_arguments)]
    fn query_table_data<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        page: i32,
        page_size: i32,
        order_by: Option<&'a str>,
        filters: Option<&'a [FilterCondition]>,
        raw_where: Option<&'a str>,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<TableData, AppError>>;

    /// Issue #1269 — like `query_table_data`, but the adapter pins ONE
    /// connection and sends that connection's native server pid through
    /// `pid_tx` before the (possibly long) COUNT + data scan runs, so the grid
    /// browse gets the same native cancel (`pg_cancel_backend` / `KILL QUERY`)
    /// the SQL tab has. The pid MUST be captured on the *same* connection the
    /// scan runs on — see `execute_sql_tracked` for why a separate pooled probe
    /// would target the wrong backend.
    ///
    /// The default drops `pid_tx` (the `oneshot::Receiver` resolves to `Err`,
    /// so the caller records no pid) and delegates to `query_table_data` —
    /// adapters without native cancel (SQLite / DuckDB / MSSQL / Oracle, and
    /// MySQL until its adapter overrides this) keep cooperative-token-only
    /// browse cancel.
    #[allow(clippy::too_many_arguments)]
    fn query_table_data_tracked<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        page: i32,
        page_size: i32,
        order_by: Option<&'a str>,
        filters: Option<&'a [FilterCondition]>,
        raw_where: Option<&'a str>,
        cancel: Option<&'a CancellationToken>,
        pid_tx: tokio::sync::oneshot::Sender<i64>,
    ) -> BoxFuture<'a, Result<TableData, AppError>> {
        drop(pid_tx);
        self.query_table_data(
            namespace, table, page, page_size, order_by, filters, raw_where, cancel,
        )
    }

    fn register_file_analytics_source<'a>(
        &'a self,
        _path: &'a str,
    ) -> BoxFuture<'a, Result<FileAnalyticsSource, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not support local file analytics".into(),
            ))
        })
    }

    fn list_file_analytics_source_metadata<'a>(
        &'a self,
    ) -> BoxFuture<'a, Result<Vec<FileAnalyticsSourceMetadata>, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not support local file analytics".into(),
            ))
        })
    }

    fn clear_file_analytics_sources<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not support local file analytics".into(),
            ))
        })
    }

    fn preview_file_analytics_source<'a>(
        &'a self,
        _source_id: &'a str,
        _limit: Option<u32>,
    ) -> BoxFuture<'a, Result<FileAnalyticsPreview, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not support local file analytics".into(),
            ))
        })
    }

    fn execute_file_analytics_query<'a>(
        &'a self,
        _source_id: &'a str,
        _sql: &'a str,
    ) -> BoxFuture<'a, Result<FileAnalyticsQueryResponse, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not support local file analytics".into(),
            ))
        })
    }

    // DDL
    /// Request-shaped `DROP TABLE` matching `create_table` /
    /// `alter_table`. `req.preview_only` toggles between SQL emission
    /// (no DB write) and `BEGIN/COMMIT` execution. `req.cascade` opts
    /// into `DROP TABLE … CASCADE`; the default emits the implicit-
    /// RESTRICT form (no `RESTRICT` keyword in the SQL string).
    fn drop_table<'a>(
        &'a self,
        req: &'a DropTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>>;

    /// Request-shaped `RENAME TABLE`. Same preview/execute
    /// semantics as `create_table` / `alter_table`. Identifier validation
    /// is sourced from the shared `validate_identifier` helper.
    fn rename_table<'a>(
        &'a self,
        req: &'a RenameTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>>;

    fn alter_table<'a>(
        &'a self,
        req: &'a AlterTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>>;

    /// Request-shaped `ALTER TABLE … ADD COLUMN`. Same
    /// preview/execute semantics as `create_table` / `rename_table`.
    /// Identifier validation is sourced from the shared
    /// `validate_identifier` helper. SQL emission order is locked at
    /// `<name> <type> [NOT NULL] [DEFAULT <expr>] [CHECK (<expr>)]`;
    /// DEFAULT and CHECK expressions are free-text passthrough (no
    /// escaping, no syntax check — user-responsible per the
    /// CHECK constraint contract).
    fn add_column<'a>(
        &'a self,
        req: &'a AddColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>>;

    /// Request-shaped `ALTER TABLE … DROP COLUMN`. Same
    /// preview/execute + identifier validation as `add_column`.
    /// `req.cascade == true` appends `CASCADE`; the default emits the
    /// implicit-RESTRICT form (no `RESTRICT` keyword in the SQL string,
    /// mirroring the `drop_table` convention). No pre-existence
    /// check — let PG surface its native `column "X" does not exist`
    /// error verbatim.
    fn drop_column<'a>(
        &'a self,
        req: &'a DropColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>>;

    /// `CREATE TABLE` with PG ANSI quoting + identifier
    /// validation + preview/execute branches (transactional commit).
    fn create_table<'a>(
        &'a self,
        req: &'a CreateTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>>;

    /// Unified `CREATE TABLE + indexes + constraints` in a
    /// single round trip. Preview mode joins child SQL with `;\n`;
    /// in execute mode the default impl runs CREATE TABLE first (in its
    /// own tx with COMMENTs), then indexes / constraints each in their
    /// own tx (atomic policy = C), synthesising the behaviour by
    /// chaining `create_table` + `create_index` + `add_constraint` so
    /// non-PG adapters compile without a custom override. Policy C is
    /// the default, not the contract — an override may be stricter, and
    /// the SQLite one is: it runs the whole plan in a single
    /// transaction since #1804, rolling the CREATE TABLE back when a
    /// child index fails (`db/adapters/sqlite/ddl.rs`).
    fn create_table_plan<'a>(
        &'a self,
        req: &'a CreateTablePlanRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move {
            use crate::models::{AddConstraintRequest, CreateIndexRequest, CreateTableRequest};

            let parent_req = CreateTableRequest {
                connection_id: req.connection_id.clone(),
                schema: req.schema.clone(),
                name: req.name.clone(),
                columns: req.columns.clone(),
                primary_key: req.primary_key.clone(),
                preview_only: req.preview_only,
                table_comment: req.table_comment.clone(),
                // The parent handler already probed `expected_database`
                // under the `active_connections` lock; child trait calls run
                // inside the same dispatch and do not re-probe.
                expected_database: None,
            };
            let parent_result = self.create_table(&parent_req).await?;
            let mut sql_parts: Vec<String> = vec![parent_result.sql];

            for idx in &req.indexes {
                let ireq = CreateIndexRequest {
                    connection_id: req.connection_id.clone(),
                    schema: req.schema.clone(),
                    table: req.name.clone(),
                    index_name: idx.index_name.clone(),
                    columns: idx.columns.clone(),
                    index_type: idx.index_type.clone(),
                    is_unique: idx.is_unique,
                    preview_only: req.preview_only,
                    // See parent_req comment.
                    expected_database: None,
                };
                // Surface the failing index name so the
                // dialog's preview pane shows which row blocked the
                // chain. Atomic policy = C: earlier-applied indexes
                // remain applied (no rollback).
                let r = self.create_index(&ireq).await.map_err(|e| {
                    AppError::Database(format!("Index \"{}\" failed: {}", idx.index_name, e))
                })?;
                sql_parts.push(r.sql);
            }

            for c in &req.constraints {
                let creq = AddConstraintRequest {
                    connection_id: req.connection_id.clone(),
                    schema: req.schema.clone(),
                    table: req.name.clone(),
                    constraint_name: c.constraint_name.clone(),
                    definition: c.definition.clone(),
                    preview_only: req.preview_only,
                    // See parent_req comment.
                    expected_database: None,
                };
                // Same per-row name surface as indexes.
                let r = self.add_constraint(&creq).await.map_err(|e| {
                    AppError::Database(format!(
                        "Constraint \"{}\" failed: {}",
                        c.constraint_name, e
                    ))
                })?;
                sql_parts.push(r.sql);
            }

            Ok(SchemaChangeResult {
                sql: sql_parts.join(";\n"),
            })
        })
    }

    fn create_index<'a>(
        &'a self,
        req: &'a CreateIndexRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>>;

    fn drop_index<'a>(
        &'a self,
        req: &'a DropIndexRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>>;

    fn add_constraint<'a>(
        &'a self,
        req: &'a AddConstraintRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>>;

    fn drop_constraint<'a>(
        &'a self,
        req: &'a DropConstraintRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>>;

    /// Count rows where `column` is `NULL` on
    /// `"<namespace>"."<table>"`. Used by `ColumnsEditor` MODIFY editor
    /// to surface a pre-execution warning when the user toggles a
    /// nullable column to NOT NULL: a non-zero count predicts the
    /// commit will fail at the database. The probe is advisory — the
    /// preview / commit path is NOT blocked.
    ///
    /// Identifiers are caller-validated (`validate_identifier` reused
    /// from the DDL family). The PG override interpolates the validated
    /// identifiers verbatim with `quote_identifier` (ANSI quotes); no
    /// parameter binding because PG does not bind identifiers.
    ///
    /// Default impl returns `AppError::Unsupported` so MySQL / SQLite
    /// continue to compile until their dialect implementation lands.
    /// Non-RDB adapters reach this only via `as_rdb()?`, which already
    /// fails with `Unsupported(relational)` for the Document paradigm.
    fn count_null_rows<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
        _column: &'a str,
    ) -> BoxFuture<'a, Result<i64, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not support NULL row counting".into(),
            ))
        })
    }

    /// Issue #1525 — read-only cross-table value search. Scans the TEXT
    /// columns of every base table in the given `schemas` for cells matching
    /// `term` (case-insensitive substring, ILIKE) and returns the matched
    /// schema/table/column/value tuples.
    ///
    /// Safety contract (PG override): identifiers (schema/table/column) come
    /// from `information_schema` and are ANSI-quoted with `quote_identifier`;
    /// the term is passed ONLY as a bound `$1` ILIKE pattern with its `%`/`_`/
    /// `\` metacharacters escaped — never string-interpolated. The generated
    /// SQL is SELECT-only. `row_cap` bounds the total matches collected and
    /// `cancel` aborts a long scan cooperatively between/within tables.
    ///
    /// The default returns `Unsupported` so non-PG adapters (MySQL/SQLite/
    /// Oracle) compile until/unless their dialect implementation lands; the
    /// `pg_search_values` command surfaces that to the frontend as a clear
    /// "PostgreSQL only" state.
    fn search_values<'a>(
        &'a self,
        _schemas: &'a [String],
        _term: &'a str,
        _cancel: Option<&'a CancellationToken>,
        _row_cap: usize,
    ) -> BoxFuture<'a, Result<ValueSearchResult, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "Cross-table value search is not supported by this adapter".into(),
            ))
        })
    }

    /// AC-180-04: cancel-token cooperation as above.
    fn get_table_indexes<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<IndexInfo>, AppError>>;

    /// AC-180-04: cancel-token cooperation as above.
    fn get_table_constraints<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ConstraintInfo>, AppError>>;

    /// Server-side cursor-based row streaming.
    ///
    /// The caller passes a pre-determined `column_names` list (source column
    /// order). The adapter orders each row's cell values to match
    /// `column_names`, builds a `Vec<serde_json::Value>`, and sends batches
    /// (= `Vec<Vec<Value>>`) through `sender`. The return value is the total
    /// number of rows sent.
    ///
    /// The straightforward PG implementation runs `BEGIN; DECLARE NO SCROLL
    /// CURSOR FOR …; FETCH FORWARD batch_size; …; CLOSE; COMMIT` — it
    /// operates a server-side cursor inside a single transaction. It checks
    /// `cancel.is_cancelled()` between batches and aborts cooperatively. A
    /// dropped receiver is also treated as a cancel signal and rolls the
    /// transaction back.
    ///
    /// MySQL/SQLite implement dialect-specific streaming when their dialect
    /// support lands. The default returns `Unsupported`, so the dispatch
    /// step rejects before the dump starts.
    fn stream_table_rows<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
        _batch_size: u32,
        _column_names: &'a [String],
        _sender: tokio::sync::mpsc::Sender<Vec<Vec<serde_json::Value>>>,
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<u64, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "Row streaming is not supported by this adapter".into(),
            ))
        })
    }

    // Views/Functions — default: empty list (each DBMS overrides as needed).
    fn list_views<'a>(
        &'a self,
        _namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<ViewInfo>, AppError>> {
        Box::pin(async { Ok(Vec::new()) })
    }

    fn list_functions<'a>(
        &'a self,
        _namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<FunctionInfo>, AppError>> {
        Box::pin(async { Ok(Vec::new()) })
    }

    fn get_view_definition<'a>(
        &'a self,
        namespace: &'a str,
        view: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>>;

    fn get_view_columns<'a>(
        &'a self,
        namespace: &'a str,
        view: &'a str,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>>;

    fn list_schema_columns<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<std::collections::HashMap<String, Vec<ColumnInfo>>, AppError>>;

    fn get_function_source<'a>(
        &'a self,
        namespace: &'a str,
        function: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>>;

    /// List triggers attached to `(namespace, table)`.
    ///
    /// The PG override queries `pg_catalog.pg_trigger` and decodes `tgtype`;
    /// other engines carry their own overrides. The default returns
    /// `Ok(Vec::new())`, so an engine without an override reports no triggers
    /// instead of failing the panel. Non-RDB adapters reach this method only
    /// via `as_rdb()?` which already fails with `Unsupported(relational)` for
    /// Document paradigm callers.
    fn list_triggers<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
    ) -> BoxFuture<'a, Result<Vec<TriggerInfo>, AppError>> {
        Box::pin(async { Ok(Vec::new()) })
    }

    /// `CREATE TRIGGER` SQL emitter + execute.
    ///
    /// PG override validates identifiers, whitelists timing / orientation
    /// / events, emits canonical SQL, and (when `req.preview_only ==
    /// false`) wraps the statement in `BEGIN/COMMIT`. Non-PG RDB
    /// adapters (MySQL/SQLite) inherit the default `Unsupported` until
    /// dialect-specific implementations land. Non-RDB adapters reach
    /// this method only via `as_rdb()?` which already fails with
    /// `Unsupported(relational)` for Document paradigm callers.
    fn create_trigger<'a>(
        &'a self,
        _req: &'a CreateTriggerRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not support trigger creation".into(),
            ))
        })
    }

    /// `DROP TRIGGER` SQL emitter + execute.
    ///
    /// PG override validates identifiers and emits
    /// `DROP TRIGGER "<name>" ON "<schema>"."<table>"` (+ trailing
    /// ` CASCADE` when `req.cascade == true`); when
    /// `req.preview_only == false`, wraps the statement in
    /// `sqlx::Transaction::begin/commit`. Non-PG RDB adapters
    /// (MySQL/SQLite) inherit the default `Unsupported` until
    /// dialect-specific implementations land. Non-RDB adapters reach
    /// this method only via `as_rdb()?` which already fails with
    /// `Unsupported(relational)` for Document paradigm callers.
    fn drop_trigger<'a>(
        &'a self,
        _req: &'a DropTriggerRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not support trigger drop".into(),
            ))
        })
    }

    /// `pg_get_triggerdef(t.oid)` for one trigger.
    ///
    /// Unlike `list_triggers`, there is no sane "empty" default for a
    /// single-trigger query — non-PG adapters must surface
    /// `AppError::Unsupported` so the frontend can render a clear copy
    /// rather than a misleading empty string. PG overrides this in
    /// `db/postgres/schema.rs`.
    fn get_trigger_source<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
        _trigger_name: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not support trigger source introspection".into(),
            ))
        })
    }

    /// List every Postgres-style data type visible to the
    /// active connection. PG overrides to query
    /// `pg_catalog.pg_type ⨝ pg_catalog.pg_namespace`; non-PG adapters
    /// (MySQL/SQLite/Oracle) inherit the default
    /// `Unsupported` so they continue to compile without code changes
    /// until their dialect-specific implementation lands.
    fn list_types<'a>(&'a self) -> BoxFuture<'a, Result<Vec<PostgresTypeInfo>, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not list types".into(),
            ))
        })
    }

    /// List installed PostgreSQL extensions. PG overrides to query
    /// `pg_catalog.pg_extension`; non-PG adapters inherit `Unsupported`.
    fn list_extensions<'a>(
        &'a self,
    ) -> BoxFuture<'a, Result<Vec<PostgresExtensionInfo>, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not list PostgreSQL extensions".into(),
            ))
        })
    }

    /// SQLite capability inventory for built-in extension modules. SQLite
    /// overrides this with probed JSON1/FTS5/RTREE booleans; other RDBMS
    /// adapters keep this unsupported so callers cannot reuse PostgreSQL
    /// extension inventory semantics.
    fn sqlite_capabilities<'a>(
        &'a self,
    ) -> BoxFuture<'a, Result<SqliteCapabilityInventory, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not list SQLite capabilities".into(),
            ))
        })
    }

    /// `CREATE DATABASE "<name>"`. PG override runs the
    /// statement against the pool's `postgres` admin DB (transaction-less);
    /// other RDB adapters inherit `Unsupported` until their dialect ships.
    fn create_database<'a>(&'a self, _name: &'a str) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not support database creation".into(),
            ))
        })
    }

    /// `DROP DATABASE "<name>"`. Symmetric to
    /// `create_database`.
    fn drop_database<'a>(&'a self, _name: &'a str) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not support database drop".into(),
            ))
        })
    }

    /// List every backend session/operation visible to the
    /// active user. PG override queries `pg_stat_activity`; non-PG RDB
    /// adapters return `Unsupported` until their dialect ships.
    fn list_server_activity<'a>(
        &'a self,
    ) -> BoxFuture<'a, Result<Vec<crate::models::ServerActivityRow>, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not support server activity introspection".into(),
            ))
        })
    }

    /// Terminate a backend session by id. PG override uses
    /// `pg_terminate_backend`; non-PG adapters return `Unsupported`.
    fn kill_session<'a>(&'a self, _id: i64) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not support kill session".into(),
            ))
        })
    }

    /// Return the query execution plan for `sql`. PG override
    /// runs `EXPLAIN (FORMAT JSON) <sql>` and parses the first cell (a JSON
    /// array with a single `Plan` node). Non-PG RDB adapters inherit
    /// `Unsupported`.
    fn explain_query<'a>(
        &'a self,
        _sql: &'a str,
    ) -> BoxFuture<'a, Result<serde_json::Value, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not support EXPLAIN".into(),
            ))
        })
    }

    /// Collection / table stats. PG override queries
    /// `pg_stat_user_tables` + `pg_class`; non-PG RDB adapters inherit
    /// `Unsupported`.
    fn collection_stats<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
    ) -> BoxFuture<'a, Result<crate::models::CollectionStatsRow, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not support collection stats".into(),
            ))
        })
    }

    /// Server identity + key tuning flags. PG override
    /// runs `version()` + `pg_settings` queries; non-PG RDB adapters
    /// inherit `Unsupported`.
    fn server_info<'a>(&'a self) -> BoxFuture<'a, Result<crate::models::ServerInfoRow, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not support server info".into(),
            ))
        })
    }

    /// Top-N slow queries. PG override reads
    /// `pg_stat_statements`; non-PG RDB adapters inherit `Unsupported`.
    /// `limit` is clamped to a sensible maximum by the caller — the
    /// adapter trusts the value here.
    fn slow_queries<'a>(
        &'a self,
        _limit: i64,
    ) -> BoxFuture<'a, Result<Vec<crate::models::SlowQueryRow>, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not support slow query introspection".into(),
            ))
        })
    }

    /// Issue #1077 Stage 2 — read-only accounts/permissions listing. The PG
    /// override queries the `pg_roles` catalog view (which masks passwords);
    /// MySQL and SQL Server override it too, and every other adapter inherits
    /// this default. The default is the backend capability gate — an engine
    /// without an override cannot serve the panel even if the frontend forgot
    /// to hide it.
    fn list_database_users<'a>(
        &'a self,
    ) -> BoxFuture<'a, Result<Vec<crate::models::DatabaseUserRow>, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not support users/roles introspection".into(),
            ))
        })
    }
}

// ── DocumentAdapter (placeholder — signatures only) ───────────────

pub trait DocumentAdapter: DbAdapter {
    /// Switch the adapter's "active database".
    ///
    /// Mirrors `RdbAdapter::switch_database`: adapters that
    /// maintain a per-connection notion of "current DB" override this to
    /// flip the user's selection. The default returns `Unsupported` so the
    /// unified `switch_active_db` Tauri command can dispatch through the
    /// trait without a paradigm-aware match per-adapter.
    fn switch_database<'a>(&'a self, _db_name: &'a str) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This document adapter does not support database switching".into(),
            ))
        })
    }

    /// Resolve the adapter's currently-active database.
    ///
    /// Mirrors `RdbAdapter::current_database` so the `verify_active_db`
    /// Tauri command can dispatch through a single trait method per
    /// paradigm. Default returns `Ok(None)` — adapters that retain a
    /// `current_active_db` accessor (Mongo) override to surface their
    /// in-memory selection without a backend round-trip.
    fn current_database<'a>(&'a self) -> BoxFuture<'a, Result<Option<String>, AppError>> {
        Box::pin(async { Ok(None) })
    }

    /// Issue #1821 — the connected server's runtime capability (deployment
    /// topology + version), resolved during `connect()` rather than declared
    /// statically by the data-source profile.
    ///
    /// Mongo-shaped on purpose: MongoDB is the only document engine in the
    /// registry, and inventing a paradigm-neutral shape for one implementor
    /// would be a contract nobody can validate. A second document engine is
    /// the trigger to generalise.
    ///
    /// The default is `unknown()` — the fail-closed value — so an adapter that
    /// never probes cannot accidentally open a version-gated feature.
    fn mongo_runtime_capabilities<'a>(
        &'a self,
    ) -> BoxFuture<'a, crate::models::MongoRuntimeCapabilities> {
        Box::pin(async { crate::models::MongoRuntimeCapabilities::unknown() })
    }

    fn list_databases<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>>;

    /// AC-180-04: cancel-token cooperation. Adapters observe
    /// the token via the same `tokio::select!` pattern used on the RDB
    /// side; on cancel they return `AppError::Database("Operation cancelled")`.
    fn list_collections<'a>(
        &'a self,
        db: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<DocumentCollectionInfo>, AppError>>;

    /// AC-180-04: cancel-token cooperation as above.
    fn infer_collection_fields<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        sample_size: usize,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>>;

    /// AC-180-04: cancel-token cooperation as above.
    fn find<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        body: FindBody,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<DocumentQueryResult, AppError>>;

    /// AC-180-04: cancel-token cooperation as above.
    ///
    /// Issue #1269 (P1): `comment` stamps the running op with the cancel tag
    /// (mirrors `FindBody.comment`) so native cancel (`cancel_query_by_tag`)
    /// can resolve the opid via `$currentOp` matched on `command.comment`.
    /// Adapters without a `$currentOp` cancel path ignore it.
    fn aggregate<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        pipeline: Vec<bson::Document>,
        comment: Option<String>,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<DocumentQueryResult, AppError>>;

    fn insert_document<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        doc: bson::Document,
    ) -> BoxFuture<'a, Result<DocumentId, AppError>>;

    fn update_document<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        id: DocumentId,
        patch: bson::Document,
    ) -> BoxFuture<'a, Result<(), AppError>>;

    fn delete_document<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        id: DocumentId,
    ) -> BoxFuture<'a, Result<(), AppError>>;

    /// Bulk delete by filter. Returns deleted_count surfaced
    /// from the driver. Empty filter `{}` is allowed — Safe Mode classifier
    /// gates the call on the frontend (`analyzeMongoOperation`).
    fn delete_many<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        filter: bson::Document,
    ) -> BoxFuture<'a, Result<u64, AppError>>;

    /// Bulk update by filter. Returns modified_count surfaced
    /// from the driver. `_id` in patch is rejected (mirrors single-doc
    /// `update_document` contract).
    fn update_many<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        filter: bson::Document,
        patch: bson::Document,
    ) -> BoxFuture<'a, Result<u64, AppError>>;

    /// Drop the entire collection. RDB `dropTable` parallel.
    /// Safe Mode always classifies this as `danger`.
    fn drop_collection<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
    ) -> BoxFuture<'a, Result<(), AppError>>;

    /// Single-document projection.
    ///
    /// Rationale (2026-05-14): called when the A1 mongosh parser dispatches
    /// `db.coll.findOne(<filter>)`. Cancel-token cooperation follows the
    /// same `tokio::select!` pattern as `find`. Returns `Ok(None)` when
    /// nothing matches, and `DocumentRow` (columns + row + raw) when a
    /// match exists.
    fn find_one<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        filter: bson::Document,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Option<DocumentRow>, AppError>>;

    /// Exact-count filter result.
    ///
    /// Rationale (2026-05-14): called when the A1 parser dispatches
    /// `db.coll.countDocuments(<filter>)`. The driver's `count_documents`
    /// performs a collection scan for an exact count — deliberately kept
    /// separate from the O(1) metadata of `estimated_document_count`.
    /// Cancel-token cooperation is the same.
    fn count_documents<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        filter: bson::Document,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<i64, AppError>>;

    /// O(1) metadata count.
    ///
    /// Rationale (2026-05-14): called when the A1 parser dispatches
    /// `db.coll.estimatedDocumentCount()`. Metadata-based estimate — the
    /// accuracy trade-off is surfaced as a caveat in the frontend
    /// `WriteSummaryPanel`. Cancel-token cooperation is the same.
    fn estimated_document_count<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<i64, AppError>>;

    /// Unique field values (post-filter).
    ///
    /// Rationale (2026-05-14): called when the A1 parser dispatches
    /// `db.coll.distinct(<field>, <filter>)`. The result is a
    /// `Vec<serde_json::Value>` passed through BSON canonical-extjson —
    /// consumed in the same shape by the Quick Look tree viewer and the
    /// grid's `ScalarOrListPanel`.
    fn distinct<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        field: &'a str,
        filter: bson::Document,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<serde_json::Value>, AppError>>;

    /// Multi-document insert.
    ///
    /// Rationale (2026-05-14): called when the A1 parser dispatches
    /// `db.coll.insertMany([...])`. **No cancel argument** — the mongo
    /// driver does not support interrupting an in-flight write, so a
    /// cooperative abort would mean nothing. An empty array input returns
    /// `Ok(vec![])` (short-circuit without wrapping a driver rejection).
    fn insert_many<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        docs: Vec<bson::Document>,
    ) -> BoxFuture<'a, Result<Vec<DocumentId>, AppError>>;

    /// Heterogeneous bulk-write.
    ///
    /// Rationale (2026-05-14): called when the A1 parser dispatches
    /// `db.coll.bulkWrite([...])`. **No cancel argument** (the mongo
    /// driver does not support interrupting writes). Follows the driver's
    /// `ordered: true` default and short-circuits on the first failure.
    /// An empty array input returns `Ok(BulkWriteResult::default())`.
    fn bulk_write<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        ops: Vec<BulkWriteOp>,
    ) -> BoxFuture<'a, Result<BulkWriteResult, AppError>>;

    /// Collection indexes (Mongo `listIndexes` admin cmd).
    ///
    /// Rationale (2026-05-15): Slice J live wire. Calls the driver's
    /// `Collection::list_indexes()` and maps each IndexModel to
    /// `crate::models::IndexInfo` (the same shape as RDB) —
    /// `columns` is the list of field names from the key spec;
    /// `index_type` is the special index's own name for
    /// text/hashed/2dsphere/geo*, "btree" for a plain BTree, "compound"
    /// for compound (≥2 fields); `is_primary` is true only when
    /// name === "_id_".
    fn list_collection_indexes<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
    ) -> BoxFuture<'a, Result<Vec<crate::models::IndexInfo>, AppError>>;

    /// Create a collection index from a fully-typed request.
    ///
    /// Rationale (2026-05-15): bundles every Mongo index option (unique /
    /// sparse / TTL / partialFilterExpression / collation / compound
    /// asc-desc) into one request so the trait surface stays
    /// single-method. Returns the canonical name that the driver's
    /// `Collection::create_index` produced, verbatim — so the caller
    /// (frontend toast / follow-up list refresh) knows the exact
    /// server-assigned name. Input validation (empty fields, compound
    /// TTL) is enforced on both the Tauri command layer and the adapter.
    fn create_collection_index<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        request: CreateMongoIndexRequest,
    ) -> BoxFuture<'a, Result<CreateMongoIndexResult, AppError>>;

    /// Drop a collection index by canonical name.
    ///
    /// Rationale (2026-05-15): a thin wrap of the driver's
    /// `Collection::drop_index(name)`. Rejecting an `_id_` drop is handled
    /// at the Tauri command layer — the adapter flows through the driver's
    /// normal rejection path (MongoDB also refuses an `_id_` drop on the
    /// server side, so even a UI bypass attempt ends up blocked).
    fn drop_collection_index<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        name: &'a str,
    ) -> BoxFuture<'a, Result<(), AppError>>;

    /// Read the collection's stored validator (Mongo
    /// `listCollections` options.validator). The return
    /// shape also surfaces `validationLevel` / `validationAction` so the
    /// frontend can hydrate select controls without a second IPC.
    ///
    /// `validator` is the validator expression JSON (or `None` if absent).
    /// `validation_level` / `validation_action` are the stored option
    /// strings (or `None` when the server has never applied a custom
    /// value — the UI then falls back to the MongoDB defaults
    /// `"strict"` / `"error"`).
    fn get_collection_validator<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
    ) -> BoxFuture<'a, Result<CollectionValidatorRead, AppError>>;

    /// Apply / clear the collection validator (Mongo `collMod`
    /// admin cmd). The signature accepts optional
    /// `validation_level` / `validation_action` so the migration pattern
    /// (`moderate` + `warn`) is reachable from the UI. When either is
    /// `None`, the corresponding field is omitted from the `collMod` doc
    /// and MongoDB applies its own default (`strict` / `error`).
    fn set_collection_validator<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        validator: Option<serde_json::Value>,
        validation_level: Option<String>,
        validation_action: Option<String>,
    ) -> BoxFuture<'a, Result<(), AppError>>;

    /// Create a collection with optional creation options
    /// (capped, timeseries, validator, etc.).
    ///
    /// Rationale (2026-05-15): Slice L live wire. `options` is a raw JSON
    /// object passthrough — invoked as
    /// `db.runCommand({create: <coll>, ...opts})`. The Mongo server rejects
    /// unknown options, so validation is delegated to the driver/server.
    fn create_collection<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        options: Option<serde_json::Value>,
    ) -> BoxFuture<'a, Result<(), AppError>>;

    /// Rename a collection within the same database.
    ///
    /// Rationale (2026-05-15): Slice L live wire. Per the Mongo manual,
    /// invoked against the `admin` db as
    /// `runCommand({renameCollection: "<db>.<from>", to:
    /// "<db>.<to>"})`. Cross-DB rename / the dropTarget option are out
    /// of scope here.
    fn rename_collection<'a>(
        &'a self,
        db: &'a str,
        from: &'a str,
        to: &'a str,
    ) -> BoxFuture<'a, Result<(), AppError>>;

    /// Drop the entire Mongo database (`db.dropDatabase()`).
    ///
    /// Rationale (2026-05-15): Slice M live wire. Mongo create database
    /// is implicit (lazy on first write) so no `create_database` trait
    /// method is needed — the UX layer surfaces an informational copy
    /// instead.
    fn drop_database<'a>(&'a self, name: &'a str) -> BoxFuture<'a, Result<(), AppError>>;

    /// List running operations
    /// (`adminCommand({currentOp: 1, "$all": true})`).
    fn current_op<'a>(
        &'a self,
    ) -> BoxFuture<'a, Result<Vec<crate::models::ServerActivityRow>, AppError>>;

    /// Terminate a running operation by id
    /// (`adminCommand({killOp: 1, op: id})`).
    fn kill_op<'a>(&'a self, id: i64) -> BoxFuture<'a, Result<(), AppError>>;

    /// Explain a `find` against `(db, collection)`.
    ///
    /// Rationale (2026-05-15): Slice U2 live wire. Mongo `explain` is
    /// invoked as `runCommand({explain: {find, filter, ...}, verbosity})`.
    /// verbosity is one of `"queryPlanner"`, `"executionStats"`,
    /// `"allPlansExecution"`. Issue #1210 — `body` carries not only the
    /// filter but also sort/projection/skip/limit, so the plan is produced
    /// with the same options as the `find` run. The result is returned as
    /// a raw `serde_json::Value` — the frontend tree viewer renders the
    /// same shape regardless of paradigm.
    fn explain_query<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        body: FindBody,
        verbosity: &'a str,
    ) -> BoxFuture<'a, Result<serde_json::Value, AppError>>;

    /// Collection stats (`runCommand({collStats})`).
    fn collection_stats<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
    ) -> BoxFuture<'a, Result<crate::models::CollectionStatsRow, AppError>>;

    /// Server identity + key runtime info
    /// (`runCommand({buildInfo, serverStatus})`).
    fn server_info<'a>(&'a self) -> BoxFuture<'a, Result<crate::models::ServerInfoRow, AppError>>;

    /// Top-N slow queries from `system.profile`. Caller is
    /// responsible for enabling profiling beforehand
    /// (`db.setProfilingLevel(level, slowms)`); when profiling is OFF
    /// this returns `Ok(Vec::new())` rather than erroring out.
    fn slow_queries<'a>(
        &'a self,
        limit: i64,
    ) -> BoxFuture<'a, Result<Vec<crate::models::SlowQueryRow>, AppError>>;

    /// Generic `db.runCommand({...})` gateway.
    ///
    /// Rationale (2026-05-17): every mongosh admin/diagnostic helper is
    /// essentially a `runCommand` wrapper. This thin gateway lets the
    /// frontend pass admin commands (`serverStatus`, `dbStats`, `currentOp`,
    /// `ping`, …) that the method whitelist does not bind through a
    /// single IPC.
    ///
    /// - With `database = None`, runs against the `"admin"` database
    ///   (`adminCommand` semantics — `listDatabases` / `serverStatus` etc.).
    /// - With `database = Some("myapp")`, runs against that db (`dbStats`,
    ///   `collStats` and other db-scoped commands).
    ///
    /// The result is a `serde_json::Value` that serializes the BSON
    /// response returned by the driver as canonical EJSON. The caller
    /// renders it in the grid / Quick Look / JSON viewer in a
    /// paradigm-agnostic way.
    fn run_command<'a>(
        &'a self,
        database: Option<&'a str>,
        command: bson::Document,
    ) -> BoxFuture<'a, Result<serde_json::Value, AppError>>;
}

// ── SearchAdapter ─────────────────────────────────────────────────────────

pub trait SearchAdapter: DbAdapter {
    fn cluster_identity<'a>(&'a self) -> BoxFuture<'a, Result<SearchClusterIdentity, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This search adapter does not expose cluster identity".into(),
            ))
        })
    }

    fn list_indexes<'a>(&'a self) -> BoxFuture<'a, Result<Vec<SearchIndexInfo>, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This search adapter does not expose index catalog".into(),
            ))
        })
    }

    fn list_aliases<'a>(&'a self) -> BoxFuture<'a, Result<Vec<SearchAliasInfo>, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This search adapter does not expose aliases".into(),
            ))
        })
    }

    fn list_data_streams<'a>(
        &'a self,
    ) -> BoxFuture<'a, Result<Vec<SearchDataStreamInfo>, AppError>> {
        Box::pin(async { Ok(Vec::new()) })
    }

    fn catalog_summary<'a>(&'a self) -> BoxFuture<'a, Result<SearchCatalogSummary, AppError>> {
        Box::pin(async move {
            let (identity, indexes, aliases, data_streams) = tokio::try_join!(
                self.cluster_identity(),
                self.list_indexes(),
                self.list_aliases(),
                self.list_data_streams(),
            )?;
            Ok(SearchCatalogSummary {
                identity,
                indexes,
                aliases,
                data_streams,
            })
        })
    }

    fn get_index_mapping<'a>(
        &'a self,
        _index: &'a str,
    ) -> BoxFuture<'a, Result<SearchIndexMapping, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This search adapter does not expose mappings".into(),
            ))
        })
    }

    fn get_index_settings<'a>(
        &'a self,
        _index: &'a str,
    ) -> BoxFuture<'a, Result<SearchIndexSettings, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This search adapter does not expose index settings".into(),
            ))
        })
    }

    fn get_index_field_stats<'a>(
        &'a self,
        _index: &'a str,
    ) -> BoxFuture<'a, Result<SearchFieldStatsEnvelope, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This search adapter does not expose field stats".into(),
            ))
        })
    }

    fn list_index_templates<'a>(
        &'a self,
    ) -> BoxFuture<'a, Result<Vec<SearchIndexTemplateInfo>, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This search adapter does not expose index templates".into(),
            ))
        })
    }

    fn sample_documents<'a>(
        &'a self,
        _index: &'a str,
        _limit: u64,
    ) -> BoxFuture<'a, Result<SearchResultEnvelope, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This search adapter does not expose sample documents".into(),
            ))
        })
    }

    fn search<'a>(
        &'a self,
        _request: &'a SearchQueryRequest,
        _cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<SearchResultEnvelope, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "Search DSL execution is not wired for this adapter".into(),
            ))
        })
    }

    fn plan_delete_by_query<'a>(
        &'a self,
        _request: &'a SearchDeleteByQueryRequest,
    ) -> BoxFuture<'a, Result<SearchDestructiveOperationPlan, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "Delete-by-query safety planning is not wired for this adapter".into(),
            ))
        })
    }

    fn execute_delete_by_query<'a>(
        &'a self,
        _request: &'a SearchDeleteByQueryRequest,
    ) -> BoxFuture<'a, Result<SearchDeleteByQueryResult, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "Delete-by-query execution is not wired for this adapter".into(),
            ))
        })
    }
}

#[cfg(test)]
mod finalize_cancelled_tests {
    //! Rationale (2026-07-03, PR #1241 review): pins the contract that a
    //! cancel request (token fired) must converge onto cancelled even when
    //! native cancel ends the mysql query with ER_QUERY_INTERRUPTED(1317)
    //! or a spurious SLEEP success. Before the fix this convergence logic
    //! did not exist, mysql leaked through as error/completed, and the
    //! e2e(query-cancelled-state) test failed.
    use super::*;

    #[test]
    fn cancelled_token_converges_interrupt_error_to_cancelled() {
        let token = CancellationToken::new();
        token.cancel();
        let interrupted: Result<i32, AppError> = Err(AppError::Database(
            "error returned from database: Query execution was interrupted".into(),
        ));
        match finalize_cancelled(interrupted, Some(&token)) {
            Err(AppError::Database(msg)) => assert!(msg.contains("Query cancelled")),
            other => panic!("expected cancelled, got {other:?}"),
        }
    }

    #[test]
    fn cancelled_token_converges_spurious_success_to_cancelled() {
        // MySQL `SELECT SLEEP(20)` returns Ok(1) when KILL QUERY interrupts it;
        // a cancel request must still land on cancelled, not completed.
        let token = CancellationToken::new();
        token.cancel();
        assert!(matches!(
            finalize_cancelled(Ok::<i32, AppError>(1), Some(&token)),
            Err(AppError::Database(_))
        ));
    }

    #[test]
    fn live_token_passes_result_through() {
        let token = CancellationToken::new();
        assert!(matches!(
            finalize_cancelled(Ok::<i32, AppError>(7), Some(&token)),
            Ok(7)
        ));
    }

    #[test]
    fn absent_token_passes_result_through() {
        assert!(matches!(
            finalize_cancelled(Ok::<i32, AppError>(7), None),
            Ok(7)
        ));
    }
}
