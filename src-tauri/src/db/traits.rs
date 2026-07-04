//! Adapter trait hierarchy — `DbAdapter` (lifecycle) and the four
//! paradigm-specific extension traits (`RdbAdapter`, `DocumentAdapter`,
//! `SearchAdapter`, `KvAdapter`).
//!
//! Hoisted out of `db/mod.rs` (Sprint 213, P5 step 2). The trait surface
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
    SearchDeleteByQueryRequest, SearchDestructiveOperationPlan, SearchFieldStatsEnvelope,
    SearchIndexInfo, SearchIndexMapping, SearchIndexSettings, SearchIndexTemplateInfo,
    SearchQueryRequest, SearchResultEnvelope, SqliteCapabilityInventory, TableData, TableInfo,
    TriggerInfo, ViewInfo,
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

    /// Sprint 359 (Phase 2 Q5.3) — paradigm-native cancel for a running
    /// statement.
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

    /// List databases visible to the connected user (Sprint 128).
    ///
    /// For paradigm symmetry with `DocumentAdapter::list_databases`. PG
    /// surfaces every non-template database in the cluster; future SQLite /
    /// MySQL adapters fall back to the default `Vec::new()` impl below until
    /// Phase 9 wires their concrete implementations. Empty Vec is the
    /// graceful "no databases to show" signal — frontend renders the
    /// existing read-only label.
    fn list_databases<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
        Box::pin(async { Ok(Vec::new()) })
    }

    /// Switch the adapter's "active database" (Sprint 130).
    ///
    /// Concrete adapters that maintain a per-database connection pool (PG)
    /// override this to swap the active sub-pool to `db_name`. Adapters
    /// that do not yet support DB switching (SQLite/MySQL/Redis/ES) fall
    /// back to the default `Unsupported` error so the frontend toast can
    /// surface a clear message rather than silently no-op.
    fn switch_database<'a>(&'a self, _db_name: &'a str) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not support database switching".into(),
            ))
        })
    }

    /// Resolve the adapter's currently-active database (Sprint 132).
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

    /// Sprint 180 (AC-180-04): accepts `Option<&CancellationToken>` so an
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

    /// Sprint 180 (AC-180-04): cancel-token cooperation as above.
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
    /// Sprint 235 — request-shaped `DROP TABLE` matching `create_table` /
    /// `alter_table`. `req.preview_only` toggles between SQL emission
    /// (no DB write) and `BEGIN/COMMIT` execution. `req.cascade` opts
    /// into `DROP TABLE … CASCADE`; the default emits the implicit-
    /// RESTRICT form (no `RESTRICT` keyword in the SQL string).
    fn drop_table<'a>(
        &'a self,
        req: &'a DropTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>>;

    /// Sprint 235 — request-shaped `RENAME TABLE`. Same preview/execute
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

    /// Sprint 236 — request-shaped `ALTER TABLE … ADD COLUMN`. Same
    /// preview/execute semantics as `create_table` / `rename_table`.
    /// Identifier validation is sourced from the shared
    /// `validate_identifier` helper. SQL emission order is locked at
    /// `<name> <type> [NOT NULL] [DEFAULT <expr>] [CHECK (<expr>)]`;
    /// DEFAULT and CHECK expressions are free-text passthrough (no
    /// escaping, no syntax check — user-responsible per Sprint 229
    /// CHECK constraint contract).
    fn add_column<'a>(
        &'a self,
        req: &'a AddColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>>;

    /// Sprint 236 — request-shaped `ALTER TABLE … DROP COLUMN`. Same
    /// preview/execute + identifier validation as `add_column`.
    /// `req.cascade == true` appends `CASCADE`; the default emits the
    /// implicit-RESTRICT form (no `RESTRICT` keyword in the SQL string,
    /// mirroring Sprint 235 `drop_table` convention). No pre-existence
    /// check — let PG surface its native `column "X" does not exist`
    /// error verbatim.
    fn drop_column<'a>(
        &'a self,
        req: &'a DropColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>>;

    /// Sprint 226 — `CREATE TABLE` with PG ANSI quoting + identifier
    /// validation + preview/execute branches (transactional commit).
    fn create_table<'a>(
        &'a self,
        req: &'a CreateTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>>;

    /// Sprint 240 — unified `CREATE TABLE + indexes + constraints` in a
    /// single round trip. Preview mode joins child SQL with `;\n`;
    /// execute mode runs CREATE TABLE first (in its own tx with
    /// COMMENTs), then indexes / constraints each in their own tx
    /// (atomic policy = C). Default impl synthesises the behaviour by
    /// chaining `create_table` + `create_index` + `add_constraint` so
    /// non-PG adapters compile without a custom override.
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
                // Sprint 271c — parent handler already probed `expected_database`
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
                    // Sprint 271c — see parent_req comment.
                    expected_database: None,
                };
                // Sprint 240 — surface the failing index name so the
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
                    // Sprint 271c — see parent_req comment.
                    expected_database: None,
                };
                // Sprint 240 — same per-row name surface as indexes.
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

    /// Sprint 237 — count rows where `column` is `NULL` on
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

    /// Sprint 180 (AC-180-04): cancel-token cooperation as above.
    fn get_table_indexes<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<IndexInfo>, AppError>>;

    /// Sprint 180 (AC-180-04): cancel-token cooperation as above.
    fn get_table_constraints<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ConstraintInfo>, AppError>>;

    /// Sprint 192 — server-side cursor 기반 row streaming.
    ///
    /// 호출자는 미리 결정된 `column_names` (source column order) 를 넘긴다.
    /// adapter 는 각 row 의 cell value 를 `column_names` 순서대로 정렬해
    /// `Vec<serde_json::Value>` 로 만들고, batch (= `Vec<Vec<Value>>`) 단위로
    /// `sender` 에 송신한다. 반환값은 송신한 row 총 개수.
    ///
    /// PG 의 정공법 구현은 `BEGIN; DECLARE NO SCROLL CURSOR FOR …; FETCH
    /// FORWARD batch_size; …; CLOSE; COMMIT` — 단일 transaction 안에서
    /// server-side cursor 운영. 매 batch 사이마다 `cancel.is_cancelled()`
    /// 를 체크해 cooperatively abort. receiver drop 도 cancel signal 로
    /// 취급해 transaction 을 ROLLBACK.
    ///
    /// MySQL/SQLite 는 Phase 9 합류 시 dialect 별 streaming 으로 구현.
    /// default 는 `Unsupported` 라 dump 전 dispatch 단계에서 reject.
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

    /// Sprint 272 — list triggers attached to `(namespace, table)`.
    ///
    /// PG override queries `pg_catalog.pg_trigger` + decodes `tgtype`.
    /// Non-PG RDB adapters fall back to the default `Ok(Vec::new())` —
    /// MySQL/SQLite trigger introspection is deferred. Non-RDB adapters
    /// reach this method only via `as_rdb()?` which already fails with
    /// `Unsupported(relational)` for Document paradigm callers.
    fn list_triggers<'a>(
        &'a self,
        _namespace: &'a str,
        _table: &'a str,
    ) -> BoxFuture<'a, Result<Vec<TriggerInfo>, AppError>> {
        Box::pin(async { Ok(Vec::new()) })
    }

    /// Sprint 273 — `CREATE TRIGGER` SQL emitter + execute.
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

    /// Sprint 274 — `DROP TRIGGER` SQL emitter + execute.
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

    /// Sprint 272 — `pg_get_triggerdef(t.oid)` for one trigger.
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

    /// Sprint 230 — list every Postgres-style data type visible to the
    /// active connection. PG overrides to query
    /// `pg_catalog.pg_type ⨝ pg_catalog.pg_namespace`; non-PG adapters
    /// (MySQL/SQLite/Oracle, Phase 17+) inherit the default
    /// `Unsupported` so they continue to compile without code changes
    /// until their dialect-specific implementation lands.
    fn list_types<'a>(&'a self) -> BoxFuture<'a, Result<Vec<PostgresTypeInfo>, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not list types".into(),
            ))
        })
    }

    /// Sprint 487 — list installed PostgreSQL extensions. PG overrides to query
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

    /// Sprint 335 — `CREATE DATABASE "<name>"`. PG override runs the
    /// statement against the pool's `postgres` admin DB (transaction-less);
    /// other RDB adapters inherit `Unsupported` until their dialect ships.
    fn create_database<'a>(&'a self, _name: &'a str) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not support database creation".into(),
            ))
        })
    }

    /// Sprint 335 — `DROP DATABASE "<name>"`. Symmetric to
    /// `create_database`.
    fn drop_database<'a>(&'a self, _name: &'a str) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not support database drop".into(),
            ))
        })
    }

    /// Sprint 336 — list every backend session/operation visible to the
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

    /// Sprint 336 — terminate a backend session by id. PG override uses
    /// `pg_terminate_backend`; non-PG adapters return `Unsupported`.
    fn kill_session<'a>(&'a self, _id: i64) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not support kill session".into(),
            ))
        })
    }

    /// Sprint 337 — return the query execution plan for `sql`. PG override
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

    /// Sprint 338 — collection / table stats. PG override queries
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

    /// Sprint 339 — server identity + key tuning flags. PG override
    /// runs `version()` + `pg_settings` queries; non-PG RDB adapters
    /// inherit `Unsupported`.
    fn server_info<'a>(&'a self) -> BoxFuture<'a, Result<crate::models::ServerInfoRow, AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This adapter does not support server info".into(),
            ))
        })
    }

    /// Sprint 340 — top-N slow queries. PG override reads
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
}

// ── DocumentAdapter (Phase 6 placeholder — signatures only) ───────────────

pub trait DocumentAdapter: DbAdapter {
    /// Switch the adapter's "active database" (Sprint 131).
    ///
    /// Mirrors `RdbAdapter::switch_database` (Sprint 130): adapters that
    /// maintain a per-connection notion of "current DB" override this to
    /// flip the user's selection. Adapters that do not yet support DB
    /// switching fall back to the default `Unsupported` so the unified
    /// `switch_active_db` Tauri command can dispatch through the trait
    /// without a paradigm-aware match per-adapter.
    fn switch_database<'a>(&'a self, _db_name: &'a str) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async {
            Err(AppError::Unsupported(
                "This document adapter does not support database switching".into(),
            ))
        })
    }

    /// Resolve the adapter's currently-active database (Sprint 132).
    ///
    /// Mirrors `RdbAdapter::current_database` so the `verify_active_db`
    /// Tauri command can dispatch through a single trait method per
    /// paradigm. Default returns `Ok(None)` — adapters that retain a
    /// `current_active_db` accessor (Mongo) override to surface their
    /// in-memory selection without a backend round-trip.
    fn current_database<'a>(&'a self) -> BoxFuture<'a, Result<Option<String>, AppError>> {
        Box::pin(async { Ok(None) })
    }

    fn list_databases<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>>;

    /// Sprint 180 (AC-180-04): cancel-token cooperation. Adapters observe
    /// the token via the same `tokio::select!` pattern used on the RDB
    /// side; on cancel they return `AppError::Database("Operation cancelled")`.
    fn list_collections<'a>(
        &'a self,
        db: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<DocumentCollectionInfo>, AppError>>;

    /// Sprint 180 (AC-180-04): cancel-token cooperation as above.
    fn infer_collection_fields<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        sample_size: usize,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>>;

    /// Sprint 180 (AC-180-04): cancel-token cooperation as above.
    fn find<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        body: FindBody,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<DocumentQueryResult, AppError>>;

    /// Sprint 180 (AC-180-04): cancel-token cooperation as above.
    fn aggregate<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        pipeline: Vec<bson::Document>,
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

    /// Sprint 198: bulk delete by filter. Returns deleted_count surfaced
    /// from the driver. Empty filter `{}` is allowed — Safe Mode classifier
    /// gates the call on the frontend (`analyzeMongoOperation`).
    fn delete_many<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        filter: bson::Document,
    ) -> BoxFuture<'a, Result<u64, AppError>>;

    /// Sprint 198: bulk update by filter. Returns modified_count surfaced
    /// from the driver. `_id` in patch is rejected (mirrors single-doc
    /// `update_document` contract).
    fn update_many<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        filter: bson::Document,
        patch: bson::Document,
    ) -> BoxFuture<'a, Result<u64, AppError>>;

    /// Sprint 198: drop the entire collection. RDB `dropTable` parallel.
    /// Safe Mode always classifies this as `danger`.
    fn drop_collection<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
    ) -> BoxFuture<'a, Result<(), AppError>>;

    /// Sprint 308 — single-document projection.
    ///
    /// 작성 이유 (2026-05-14): A1 mongosh 파서가 `db.coll.findOne(<filter>)`
    /// 을 dispatch 할 때 호출. cancel-token cooperation 은 `find` 와 동일한
    /// `tokio::select!` 패턴으로 따른다. 매칭이 없으면 `Ok(None)`, 매칭이
    /// 있으면 `DocumentRow` (columns + row + raw) 를 반환.
    fn find_one<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        filter: bson::Document,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Option<DocumentRow>, AppError>>;

    /// Sprint 308 — exact-count filter result.
    ///
    /// 작성 이유 (2026-05-14): A1 파서가 `db.coll.countDocuments(<filter>)`
    /// 을 dispatch 할 때 호출. driver 의 `count_documents` 는 정확한 카운트
    /// 를 위해 collection scan 을 수행 — `estimated_document_count` 의 O(1)
    /// metadata 와 의도적으로 분리한다. cancel-token cooperation 동일.
    fn count_documents<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        filter: bson::Document,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<i64, AppError>>;

    /// Sprint 308 — O(1) metadata count.
    ///
    /// 작성 이유 (2026-05-14): A1 파서가 `db.coll.estimatedDocumentCount()`
    /// 을 dispatch 할 때 호출. metadata 기반 estimate — 정확도 trade-off
    /// 는 frontend `WriteSummaryPanel` 의 caveat 으로 노출. cancel-token
    /// cooperation 동일.
    fn estimated_document_count<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<i64, AppError>>;

    /// Sprint 308 — unique field values (post-filter).
    ///
    /// 작성 이유 (2026-05-14): A1 파서가 `db.coll.distinct(<field>, <filter>)`
    /// 을 dispatch 할 때 호출. 결과는 BSON canonical-extjson 통과한
    /// `Vec<serde_json::Value>` — Quick Look 의 tree viewer 와 grid 의
    /// `ScalarOrListPanel` 이 동일 shape 으로 소비.
    fn distinct<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        field: &'a str,
        filter: bson::Document,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<serde_json::Value>, AppError>>;

    /// Sprint 308 — multi-document insert.
    ///
    /// 작성 이유 (2026-05-14): A1 파서가 `db.coll.insertMany([...])` 을
    /// dispatch 할 때 호출. **cancel 인자 없음** — mongo driver 가 in-flight
    /// write 중단을 지원하지 않아 cooperative abort 의 의미가 없다. 빈 배열
    /// 입력은 `Ok(vec![])` 반환 (driver 의 거부를 wrap 하지 않고 short-circuit).
    fn insert_many<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        docs: Vec<bson::Document>,
    ) -> BoxFuture<'a, Result<Vec<DocumentId>, AppError>>;

    /// Sprint 308 — heterogeneous bulk-write.
    ///
    /// 작성 이유 (2026-05-14): A1 파서가 `db.coll.bulkWrite([...])` 을
    /// dispatch 할 때 호출. **cancel 인자 없음** (mongo driver write 중단
    /// 미지원). driver 의 `ordered: true` default 를 따라 첫 실패 시
    /// short-circuit. 빈 배열 입력은 `Ok(BulkWriteResult::default())` 반환.
    fn bulk_write<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        ops: Vec<BulkWriteOp>,
    ) -> BoxFuture<'a, Result<BulkWriteResult, AppError>>;

    /// Sprint 332 — collection indexes (Mongo `listIndexes` admin cmd).
    ///
    /// 작성 이유 (2026-05-15): Slice J live wire. driver 의
    /// `Collection::list_indexes()` 를 호출하고, 각 IndexModel 을
    /// `crate::models::IndexInfo` (RDB 와 같은 shape) 로 매핑한다 —
    /// `columns` = key spec 의 field 이름 리스트, `index_type` 은
    /// special index (text/hashed/2dsphere/geo*) 면 그 이름, 일반 BTree
    /// 면 "btree", compound (≥2 fields) 면 "compound", `is_primary` 는
    /// name === "_id_" 일 때만 true.
    fn list_collection_indexes<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
    ) -> BoxFuture<'a, Result<Vec<crate::models::IndexInfo>, AppError>>;

    /// Sprint 351 — create a collection index from a fully-typed request.
    ///
    /// 작성 이유 (2026-05-15): Mongo index 옵션 전부 (unique / sparse / TTL /
    /// partialFilterExpression / collation / compound asc-desc) 을 한
    /// request 로 묶어 trait surface 를 single-method 로 유지한다. driver
    /// 의 `Collection::create_index` 가 반환하는 canonical name 을 그대로
    /// 토해낸다 — caller (frontend toast / 후속 list refresh) 가 정확한
    /// server-assigned 이름을 알 수 있다. 입력 검증 (빈 fields, compound
    /// TTL) 은 Tauri command 계층 + 어댑터 양쪽에서 enforce.
    fn create_collection_index<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        request: CreateMongoIndexRequest,
    ) -> BoxFuture<'a, Result<CreateMongoIndexResult, AppError>>;

    /// Sprint 351 — drop a collection index by canonical name.
    ///
    /// 작성 이유 (2026-05-15): driver `Collection::drop_index(name)` 의
    /// thin wrap. `_id_` drop 거부는 Tauri command 계층에서 처리 — 어댑터
    /// 는 driver 가 거부하는 정상 경로로 흐른다 (MongoDB 가 서버 측에서도
    /// `_id_` drop 을 거부하므로 UI 우회 시도라도 결국 차단된다).
    fn drop_collection_index<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        name: &'a str,
    ) -> BoxFuture<'a, Result<(), AppError>>;

    /// Sprint 333 — read the collection's stored validator (Mongo
    /// `listCollections` options.validator). Sprint 352 extends the return
    /// shape to also surface `validationLevel` / `validationAction` so the
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

    /// Sprint 333 — apply / clear the collection validator (Mongo `collMod`
    /// admin cmd). Sprint 352 extends the signature to accept optional
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

    /// Sprint 334 — create a collection with optional creation options
    /// (capped, timeseries, validator, etc.).
    ///
    /// 작성 이유 (2026-05-15): Slice L live wire. `options` 는 raw JSON
    /// object passthrough — `db.runCommand({create: <coll>, ...opts})` 로
    /// 호출된다. Mongo server 가 unknown 옵션을 거부하므로 validation 은
    /// driver/서버에 위임.
    fn create_collection<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        options: Option<serde_json::Value>,
    ) -> BoxFuture<'a, Result<(), AppError>>;

    /// Sprint 334 — rename a collection within the same database.
    ///
    /// 작성 이유 (2026-05-15): Slice L live wire. Mongo manual 에 따라
    /// `admin` db 에서 `runCommand({renameCollection: "<db>.<from>", to:
    /// "<db>.<to>"})` 로 호출. cross-DB rename / dropTarget 옵션은 본
    /// sprint scope 외.
    fn rename_collection<'a>(
        &'a self,
        db: &'a str,
        from: &'a str,
        to: &'a str,
    ) -> BoxFuture<'a, Result<(), AppError>>;

    /// Sprint 335 — drop the entire Mongo database (`db.dropDatabase()`).
    ///
    /// 작성 이유 (2026-05-15): Slice M live wire. Mongo create database
    /// is implicit (lazy on first write) so no `create_database` trait
    /// method is needed — the UX layer surfaces an informational copy
    /// instead.
    fn drop_database<'a>(&'a self, name: &'a str) -> BoxFuture<'a, Result<(), AppError>>;

    /// Sprint 336 — list running operations
    /// (`adminCommand({currentOp: 1, "$all": true})`).
    fn current_op<'a>(
        &'a self,
    ) -> BoxFuture<'a, Result<Vec<crate::models::ServerActivityRow>, AppError>>;

    /// Sprint 336 — terminate a running operation by id
    /// (`adminCommand({killOp: 1, op: id})`).
    fn kill_op<'a>(&'a self, id: i64) -> BoxFuture<'a, Result<(), AppError>>;

    /// Sprint 337 — explain a `find` against `(db, collection)`.
    ///
    /// 작성 이유 (2026-05-15): Slice U2 live wire. Mongo `explain` 은
    /// `runCommand({explain: {find, filter}, verbosity})` 형태로 호출된다.
    /// verbosity 는 `"queryPlanner"`, `"executionStats"`, `"allPlansExecution"`
    /// 셋 중 하나. 결과는 raw `serde_json::Value` 로 반환 — frontend tree
    /// viewer 가 paradigm 차이 없이 같은 shape 으로 렌더.
    fn explain_query<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
        filter: bson::Document,
        verbosity: &'a str,
    ) -> BoxFuture<'a, Result<serde_json::Value, AppError>>;

    /// Sprint 338 — collection stats (`runCommand({collStats})`).
    fn collection_stats<'a>(
        &'a self,
        db: &'a str,
        collection: &'a str,
    ) -> BoxFuture<'a, Result<crate::models::CollectionStatsRow, AppError>>;

    /// Sprint 339 — server identity + key runtime info
    /// (`runCommand({buildInfo, serverStatus})`).
    fn server_info<'a>(&'a self) -> BoxFuture<'a, Result<crate::models::ServerInfoRow, AppError>>;

    /// Sprint 340 — top-N slow queries from `system.profile`. Caller is
    /// responsible for enabling profiling beforehand
    /// (`db.setProfilingLevel(level, slowms)`); when profiling is OFF
    /// this returns `Ok(Vec::new())` rather than erroring out.
    fn slow_queries<'a>(
        &'a self,
        limit: i64,
    ) -> BoxFuture<'a, Result<Vec<crate::models::SlowQueryRow>, AppError>>;

    /// Sprint 381 — generic `db.runCommand({...})` gateway.
    ///
    /// 작성 이유 (2026-05-17): mongosh 의 모든 admin/diagnostic helper 는
    /// 본질적으로 `runCommand` wrapper 다. Phase 28 의 method whitelist 에
    /// 묶이지 않은 admin command (`serverStatus`, `dbStats`, `currentOp`,
    /// `ping`, …) 을 frontend 가 한 IPC 로 통과시킬 수 있도록 thin gateway
    /// 를 추가한다.
    ///
    /// - `database = None` 시 `"admin"` 데이터베이스에서 실행
    ///   (`adminCommand` semantics — `listDatabases` / `serverStatus` 등).
    /// - `database = Some("myapp")` 시 해당 db 에서 실행 (`dbStats`,
    ///   `collStats` 등 db-scoped command).
    ///
    /// 결과는 driver 가 반환한 BSON 응답을 canonical EJSON 으로 직렬화한
    /// `serde_json::Value`. 호출자가 grid / Quick Look / JSON viewer 에
    /// paradigm-agnostic 으로 렌더.
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
}

#[cfg(test)]
mod finalize_cancelled_tests {
    //! 작성 이유 (2026-07-03, PR #1241 review): native cancel 이 mysql 쿼리를
    //! ER_QUERY_INTERRUPTED(1317) 또는 SLEEP 의 spurious 성공으로 끝내도,
    //! 취소 요청(token fired)이면 cancelled 로 수렴해야 한다는 계약을 고정.
    //! fix 전에는 이 수렴 로직이 없어 mysql 만 error/completed 로 새어
    //! e2e(query-cancelled-state)가 실패했다.
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
