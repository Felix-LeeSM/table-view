//! SQLite connection lifecycle and baseline catalog reads.

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, Sqlite, SqlitePool, Transaction};
use std::collections::{HashMap, HashSet};
use std::fs::OpenOptions;
use std::io::ErrorKind;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::error::AppError;
use crate::models::{
    ColumnCategory, ColumnInfo, ConnectionConfig, IndexInfo, SqliteCapabilityInventory, TableInfo,
    TriggerInfo, ViewInfo,
};
use crate::storage;

pub(super) const SQLITE_POOL_MAX_CONNECTIONS: u32 = 5;
const SQLITE_POOL_ACQUIRE_TIMEOUT_MAX_SECS: u64 = 30;
const SQLITE_POOL_ACQUIRE_TIMEOUT_DEFAULT_SECS: u32 = 300;
pub(super) const SQLITE_NAMESPACE: &str = "main";

#[derive(Default)]
pub struct SqlitePoolState {
    pool: Option<SqlitePool>,
    database_path: Option<String>,
    read_only: bool,
    capability_inventory: Option<SqliteCapabilityInventory>,
}

#[derive(Clone)]
pub struct SqliteAdapter {
    inner: Arc<Mutex<SqlitePoolState>>,
}

impl Default for SqliteAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl SqliteAdapter {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(SqlitePoolState::default())),
        }
    }

    pub fn validate_user_database_path(path: &str) -> Result<&str, AppError> {
        let path = path.trim();
        if path.is_empty() {
            return Err(AppError::Validation(
                "SQLite database file is required".into(),
            ));
        }
        let path_ref = Path::new(path);
        if !path_ref.is_absolute() {
            return Err(AppError::Validation(
                "SQLite database file path must be absolute".into(),
            ));
        }
        storage::local::reject_internal_app_data_path(path_ref)?;
        Ok(path)
    }

    fn database_path(config: &ConnectionConfig) -> Result<&str, AppError> {
        Self::validate_user_database_path(&config.database)
    }

    fn connect_options(config: &ConnectionConfig) -> Result<SqliteConnectOptions, AppError> {
        let path = Self::database_path(config)?;
        let mut options = SqliteConnectOptions::new()
            .filename(Path::new(path))
            .create_if_missing(false)
            .foreign_keys(true);
        if config.read_only {
            options = options.read_only(true);
        }
        Ok(options)
    }

    pub async fn create_database_file(path: &str) -> Result<String, AppError> {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            return Err(AppError::Validation(
                "SQLite database file path is required".into(),
            ));
        }

        let path = Path::new(trimmed);
        if !path.is_absolute() {
            return Err(AppError::Validation(
                "SQLite database file path must be absolute".into(),
            ));
        }
        storage::local::reject_internal_app_data_path(path)?;
        let parent = path.parent().ok_or_else(|| {
            AppError::Validation("SQLite database file parent directory is required".into())
        })?;
        if !parent.is_dir() {
            return Err(AppError::Validation(format!(
                "SQLite database file parent directory does not exist: {}",
                parent.display()
            )));
        }

        match OpenOptions::new().write(true).create_new(true).open(path) {
            Ok(file) => drop(file),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                return Err(AppError::Validation(format!(
                    "SQLite database file already exists: {}",
                    path.display()
                )));
            }
            Err(error) => return Err(AppError::Io(error)),
        }

        let init_result = async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(
                    SqliteConnectOptions::new()
                        .filename(path)
                        .create_if_missing(false)
                        .foreign_keys(true),
                )
                .await
                .map_err(|e| AppError::Connection(e.to_string()))?;

            // Force SQLite to write a valid database header while leaving no
            // application schema behind.
            let result = async {
                sqlx::query("PRAGMA user_version = 1")
                    .execute(&pool)
                    .await
                    .map_err(|e| AppError::Database(e.to_string()))?;
                sqlx::query("PRAGMA user_version = 0")
                    .execute(&pool)
                    .await
                    .map_err(|e| AppError::Database(e.to_string()))?;
                Ok::<(), AppError>(())
            }
            .await;
            pool.close().await;
            result
        }
        .await;

        if let Err(error) = init_result {
            let _ = std::fs::remove_file(path);
            return Err(error);
        }

        Ok(trimmed.to_string())
    }

    pub async fn test(config: &ConnectionConfig) -> Result<(), AppError> {
        let options = Self::connect_options(config)?;
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .acquire_timeout(std::time::Duration::from_secs(5))
            .connect_with(options)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;

        let result = sqlx::query("SELECT 1")
            .execute(&pool)
            .await
            .map_err(|e| AppError::Connection(e.to_string()));

        pool.close().await;
        result?;

        Ok(())
    }

    pub async fn connect_pool(&self, config: &ConnectionConfig) -> Result<(), AppError> {
        let options = Self::connect_options(config)?;
        let timeout_secs = config
            .connection_timeout
            .unwrap_or(SQLITE_POOL_ACQUIRE_TIMEOUT_DEFAULT_SECS);
        let pool = SqlitePoolOptions::new()
            .max_connections(SQLITE_POOL_MAX_CONNECTIONS)
            .acquire_timeout(std::time::Duration::from_secs(
                (timeout_secs as u64).min(SQLITE_POOL_ACQUIRE_TIMEOUT_MAX_SECS),
            ))
            .connect_with(options)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;
        let capability_inventory = probe_sqlite_capabilities(&pool).await;

        let old_pool = {
            let mut guard = self.inner.lock().await;
            let old_pool = guard.pool.replace(pool);
            guard.database_path = Some(Self::database_path(config)?.to_string());
            guard.read_only = config.read_only;
            guard.capability_inventory = Some(capability_inventory);
            old_pool
        };
        if let Some(old_pool) = old_pool {
            old_pool.close().await;
        }
        Ok(())
    }

    pub async fn disconnect_pool(&self) -> Result<(), AppError> {
        let mut guard = self.inner.lock().await;
        let pool = guard.pool.take();
        guard.database_path = None;
        guard.read_only = false;
        guard.capability_inventory = None;
        drop(guard);
        if let Some(pool) = pool {
            pool.close().await;
        }
        Ok(())
    }

    pub async fn ping(&self) -> Result<(), AppError> {
        let pool = self.active_pool().await?;
        sqlx::query("SELECT 1")
            .execute(&pool)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;
        Ok(())
    }

    pub async fn require_connected(&self) -> Result<(), AppError> {
        self.active_pool().await.map(|_| ())
    }

    pub async fn current_database_path(&self) -> Option<String> {
        let guard = self.inner.lock().await;
        guard.database_path.clone()
    }

    pub async fn capability_inventory(&self) -> Result<SqliteCapabilityInventory, AppError> {
        let guard = self.inner.lock().await;
        guard
            .capability_inventory
            .ok_or_else(|| AppError::Connection("Not connected".into()))
    }

    pub(super) async fn active_pool(&self) -> Result<SqlitePool, AppError> {
        let guard = self.inner.lock().await;
        guard
            .pool
            .clone()
            .ok_or_else(|| AppError::Connection("Not connected".into()))
    }

    pub(super) async fn active_pool_with_mode(&self) -> Result<(SqlitePool, bool), AppError> {
        let guard = self.inner.lock().await;
        let pool = guard
            .pool
            .clone()
            .ok_or_else(|| AppError::Connection("Not connected".into()))?;
        Ok((pool, guard.read_only))
    }

    pub async fn list_tables(&self, namespace: &str) -> Result<Vec<TableInfo>, AppError> {
        validate_namespace(namespace)?;
        let pool = self.active_pool().await?;
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT name FROM sqlite_schema \
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%' \
             ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

        let mut tables = Vec::with_capacity(rows.len());
        for (name,) in rows {
            let count_sql = format!("SELECT COUNT(*) FROM {}", quote_identifier(&name));
            let row_count: i64 = sqlx::query_scalar(&count_sql)
                .fetch_one(&pool)
                .await
                .map_err(|e| AppError::Database(e.to_string()))?;
            tables.push(TableInfo {
                name,
                schema: SQLITE_NAMESPACE.to_string(),
                row_count: Some(row_count),
            });
        }
        Ok(tables)
    }

    pub async fn get_table_columns(
        &self,
        namespace: &str,
        table: &str,
    ) -> Result<Vec<ColumnInfo>, AppError> {
        validate_namespace(namespace)?;
        let pool = self.active_pool().await?;
        let table_ident = quote_identifier(table);
        let fk_map = sqlite_foreign_keys(&pool, &table_ident).await?;
        let pragma_sql = format!("PRAGMA table_info({table_ident})");
        let rows = sqlx::query(&pragma_sql)
            .fetch_all(&pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut columns = Vec::with_capacity(rows.len());
        for row in rows {
            let name: String = row
                .try_get("name")
                .map_err(|e| AppError::Database(e.to_string()))?;
            let data_type: String = row
                .try_get("type")
                .map_err(|e| AppError::Database(e.to_string()))?;
            let not_null: i64 = row
                .try_get("notnull")
                .map_err(|e| AppError::Database(e.to_string()))?;
            let default_value: Option<String> = row
                .try_get("dflt_value")
                .map_err(|e| AppError::Database(e.to_string()))?;
            let pk: i64 = row
                .try_get("pk")
                .map_err(|e| AppError::Database(e.to_string()))?;
            let fk_reference = fk_map.get(&name).cloned();

            columns.push(ColumnInfo {
                name,
                data_type: data_type.clone(),
                nullable: not_null == 0 && pk == 0,
                default_value,
                // SQLite auto-assigns on explicit NULL for INTEGER PRIMARY KEY
                // (rowid alias), so INSERT isn't broken and no flag is needed.
                is_identity: false,
                is_primary_key: pk > 0,
                is_foreign_key: fk_reference.is_some(),
                fk_reference,
                comment: None,
                check_clauses: Vec::new(),
                category: sqlite_column_category(&data_type),
            });
        }
        Ok(columns)
    }

    pub async fn get_table_indexes(
        &self,
        namespace: &str,
        table: &str,
    ) -> Result<Vec<IndexInfo>, AppError> {
        validate_namespace(namespace)?;
        let pool = self.active_pool().await?;
        let table_ident = quote_identifier(table);
        let index_list_sql = format!("PRAGMA index_list({table_ident})");
        let rows = sqlx::query(&index_list_sql)
            .fetch_all(&pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut indexes = Vec::with_capacity(rows.len());
        for row in rows {
            let name: String = row
                .try_get("name")
                .map_err(|e| AppError::Database(e.to_string()))?;
            let unique: i64 = row
                .try_get("unique")
                .map_err(|e| AppError::Database(e.to_string()))?;
            let origin: Option<String> = row.try_get("origin").ok();
            let index_ident = quote_identifier(&name);
            let column_sql = format!("PRAGMA index_info({index_ident})");
            let column_rows = sqlx::query(&column_sql)
                .fetch_all(&pool)
                .await
                .map_err(|e| AppError::Database(e.to_string()))?;

            let mut columns = Vec::with_capacity(column_rows.len());
            for column_row in column_rows {
                let column_name: Option<String> = column_row
                    .try_get("name")
                    .map_err(|e| AppError::Database(e.to_string()))?;
                if let Some(column_name) = column_name {
                    columns.push(column_name);
                }
            }

            indexes.push(IndexInfo {
                name,
                columns,
                index_type: "BTREE".to_string(),
                is_unique: unique != 0,
                is_primary: origin.as_deref() == Some("pk"),
            });
        }
        indexes.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(indexes)
    }

    pub async fn list_views(&self, namespace: &str) -> Result<Vec<ViewInfo>, AppError> {
        validate_namespace(namespace)?;
        let pool = self.active_pool().await?;
        let rows: Vec<(String, Option<String>)> = sqlx::query_as(
            "SELECT name, sql FROM sqlite_schema \
             WHERE type = 'view' AND name NOT LIKE 'sqlite_%' \
             ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

        Ok(rows
            .into_iter()
            .map(|(name, definition)| ViewInfo {
                name,
                schema: SQLITE_NAMESPACE.to_string(),
                definition,
            })
            .collect())
    }

    pub async fn get_view_definition(
        &self,
        namespace: &str,
        view: &str,
    ) -> Result<String, AppError> {
        validate_namespace(namespace)?;
        let pool = self.active_pool().await?;
        let row: Option<(Option<String>,)> = sqlx::query_as(
            "SELECT sql FROM sqlite_schema \
             WHERE type = 'view' AND name = ?",
        )
        .bind(view)
        .fetch_optional(&pool)
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

        match row {
            Some((Some(definition),)) => Ok(definition),
            Some((None,)) => Ok(String::new()),
            None => Err(AppError::Connection(format!(
                "View {namespace}.{view} not found"
            ))),
        }
    }

    pub async fn get_view_columns(
        &self,
        namespace: &str,
        view: &str,
    ) -> Result<Vec<ColumnInfo>, AppError> {
        self.get_table_columns(namespace, view).await
    }

    pub async fn list_schema_columns(
        &self,
        namespace: &str,
    ) -> Result<HashMap<String, Vec<ColumnInfo>>, AppError> {
        let tables = self.list_tables(namespace).await?;
        let mut result = HashMap::with_capacity(tables.len());
        for table in tables {
            let columns = self.get_table_columns(namespace, &table.name).await?;
            result.insert(table.name, columns);
        }
        Ok(result)
    }

    /// List triggers attached to `table`, sourced from
    /// `sqlite_schema` (type = 'trigger'). SQLite triggers carry an inline
    /// body rather than a named function, so `definition` holds the full
    /// `CREATE TRIGGER` statement and the PG-shaped `function_*` fields stay
    /// empty. `timing` / `events` are parsed best-effort from the SQL for the
    /// Structure header; `orientation` is always `ROW` (SQLite has no
    /// statement-level triggers).
    pub async fn list_triggers(
        &self,
        namespace: &str,
        table: &str,
    ) -> Result<Vec<TriggerInfo>, AppError> {
        validate_namespace(namespace)?;
        let pool = self.active_pool().await?;
        let rows: Vec<(String, Option<String>)> = sqlx::query_as(
            "SELECT name, sql FROM sqlite_schema \
             WHERE type = 'trigger' AND tbl_name = ? \
             ORDER BY name",
        )
        .bind(table)
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

        Ok(rows
            .into_iter()
            .map(|(name, sql)| {
                let definition = sql.unwrap_or_default();
                let header = parse_sqlite_trigger_header(&definition);
                TriggerInfo {
                    name,
                    schema: SQLITE_NAMESPACE.to_string(),
                    table: table.to_string(),
                    timing: header.timing.to_string(),
                    events: header.events.iter().map(|e| e.to_string()).collect(),
                    orientation: "ROW".to_string(),
                    function_schema: String::new(),
                    function_name: String::new(),
                    arguments: None,
                    when_expression: None,
                    definition,
                }
            })
            .collect())
    }

    /// Test-only: connect with a single-connection pool so a cancel test can
    /// observe worker liveness. On a `max_connections(1)` pool a follow-up
    /// query can only run promptly if a cancel actually interrupted (freed)
    /// the one worker rather than leaving it stepping the previous statement
    /// to completion. Issue #1068.
    #[cfg(test)]
    pub(crate) async fn connect_single_connection_for_test(
        &self,
        config: &ConnectionConfig,
    ) -> Result<(), AppError> {
        let options = Self::connect_options(config)?;
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .acquire_timeout(std::time::Duration::from_secs(5))
            .connect_with(options)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;
        let mut guard = self.inner.lock().await;
        guard.pool = Some(pool);
        guard.database_path = Some(Self::database_path(config)?.to_string());
        guard.read_only = config.read_only;
        Ok(())
    }

    /// Return the `CREATE TRIGGER` SQL for one trigger from `sqlite_schema`.
    pub async fn get_trigger_source(
        &self,
        namespace: &str,
        table: &str,
        trigger_name: &str,
    ) -> Result<String, AppError> {
        validate_namespace(namespace)?;
        let pool = self.active_pool().await?;
        let row: Option<(Option<String>,)> = sqlx::query_as(
            "SELECT sql FROM sqlite_schema \
             WHERE type = 'trigger' AND tbl_name = ? AND name = ?",
        )
        .bind(table)
        .bind(trigger_name)
        .fetch_optional(&pool)
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

        match row {
            Some((Some(sql),)) => Ok(sql),
            Some((None,)) => Ok(String::new()),
            None => Err(AppError::NotFound(format!(
                "Trigger {namespace}.{table}.{trigger_name} not found"
            ))),
        }
    }
}

async fn probe_sqlite_capabilities(pool: &SqlitePool) -> SqliteCapabilityInventory {
    SqliteCapabilityInventory {
        json1: probe_sqlite_json1(pool).await,
        fts5: probe_sqlite_compile_option(pool, "ENABLE_FTS5").await
            || probe_sqlite_fts5_runtime(pool).await,
        rtree: probe_sqlite_compile_option(pool, "ENABLE_RTREE").await
            || probe_sqlite_rtree_runtime(pool).await,
    }
}

async fn probe_sqlite_json1(pool: &SqlitePool) -> bool {
    sqlx::query_scalar::<_, i64>("SELECT json_valid('{}')")
        .fetch_one(pool)
        .await
        .is_ok_and(|value| value != 0)
}

async fn probe_sqlite_compile_option(pool: &SqlitePool, option: &str) -> bool {
    sqlx::query_scalar::<_, i64>("SELECT sqlite_compileoption_used(?)")
        .bind(option)
        .fetch_one(pool)
        .await
        .is_ok_and(|value| value != 0)
}

async fn probe_sqlite_fts5_runtime(pool: &SqlitePool) -> bool {
    probe_sqlite_temp_virtual_table(
        pool,
        "CREATE VIRTUAL TABLE temp.__table_view_fts5_capability_probe USING fts5(content)",
        "DROP TABLE IF EXISTS temp.__table_view_fts5_capability_probe",
    )
    .await
}

async fn probe_sqlite_rtree_runtime(pool: &SqlitePool) -> bool {
    probe_sqlite_temp_virtual_table(
        pool,
        "CREATE VIRTUAL TABLE temp.__table_view_rtree_capability_probe USING rtree(id, min_x, max_x, min_y, max_y)",
        "DROP TABLE IF EXISTS temp.__table_view_rtree_capability_probe",
    )
    .await
}

async fn probe_sqlite_temp_virtual_table(
    pool: &SqlitePool,
    create_sql: &str,
    drop_sql: &str,
) -> bool {
    let created = sqlx::query(create_sql).execute(pool).await.is_ok();
    let _ = sqlx::query(drop_sql).execute(pool).await;
    created
}

/// Opens a transaction on `pool`, picking the begin style from whether the
/// caller writes. Callers say what they are rather than which SQL to send, so
/// the choice has one home instead of one per entry point.
///
/// A writer needs `BEGIN IMMEDIATE`. A deferred `BEGIN` takes no lock at all,
/// so the transaction's first read leaves the connection holding a read
/// transaction and its first write then has to upgrade one. SQLite answers that
/// upgrade with `SQLITE_BUSY` at once and deliberately does not run the busy
/// handler, because waiting on a lock it already blocks could deadlock — which
/// leaves `busy_timeout` inert exactly where writers collide, and turns any
/// concurrent writer into an instant "database is locked" on a legal statement.
/// Asking for the write lock at `BEGIN`, while the connection holds nothing,
/// puts the request back in front of the busy handler.
///
/// A reader must not ask for it. `IMMEDIATE` takes the file's write lock, which
/// excludes every writer and every other `IMMEDIATE` transaction for as long as
/// the transaction lives. Ordinary readers do keep running alongside it, up
/// until a writer reaches its commit and SQLite escalates to an exclusive lock.
/// So a long export asking for `IMMEDIATE` would park unrelated writers until it
/// finished and queue a second export behind the first — the same failure this
/// helper removes, moved to a different pair (#2129, #2130).
///
// ponytail: opt-in — nothing stops a new write path in this module from calling
// `pool.begin()` directly. clippy's `disallowed-methods` would enforce it, but
// its config is per-crate: the mysql and postgres adapters share this crate and
// open deferred transactions throughout, none of which this bug touches, so the
// ban would mean per-site allows across all of them. Promote it if SQLite write
// paths outgrow this module.
pub(super) async fn begin_transaction(
    pool: &SqlitePool,
    writes: bool,
) -> Result<Transaction<'static, Sqlite>, AppError> {
    pool.begin_with(if writes { "BEGIN IMMEDIATE" } else { "BEGIN" })
        .await
        .map_err(|e| AppError::Database(e.to_string()))
}

/// Test-only: parks a writer on `path` from a connection that is not in the
/// adapter's pool, so a write path under test meets the same lock an unrelated
/// process would hold. The future resolves only once the lock is actually held,
/// so the caller cannot race the fixture; the returned sender releases it.
///
/// The `BEGIN IMMEDIATE` here is the fixture's own way of parking on the file,
/// not the behaviour under test.
#[cfg(test)]
pub(super) async fn hold_write_lock(path: &Path) -> tokio::sync::oneshot::Sender<()> {
    use sqlx::{ConnectOptions, Connection};

    let (held_tx, held_rx) = tokio::sync::oneshot::channel::<()>();
    let (release_tx, release_rx) = tokio::sync::oneshot::channel::<()>();
    let path = path.to_path_buf();
    tokio::spawn(async move {
        let mut conn = SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(false)
            .connect()
            .await
            .expect("contending connection");
        let tx = conn
            .begin_with("BEGIN IMMEDIATE")
            .await
            .expect("contending write lock");
        held_tx.send(()).expect("signal that the lock is held");
        let _ = release_rx.await;
        tx.rollback().await.expect("contending rollback");
        conn.close().await.expect("contending close");
    });
    held_rx.await.expect("contending writer took the lock");
    release_tx
}

pub(super) fn validate_namespace(namespace: &str) -> Result<(), AppError> {
    if namespace.is_empty() || namespace == SQLITE_NAMESPACE {
        Ok(())
    } else {
        Err(AppError::Validation(format!(
            "SQLite only supports the '{SQLITE_NAMESPACE}' namespace"
        )))
    }
}

pub(super) fn quote_identifier(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

struct SqliteTriggerHeader {
    timing: &'static str,
    events: Vec<&'static str>,
}

/// Best-effort extraction of `timing` and the fired `event` from a
/// `CREATE TRIGGER` statement. In valid SQLite the timing keyword always
/// precedes the single event, which precedes the body, so scanning tokens up
/// to the first event keyword avoids matching identifiers inside the body.
///
// ponytail: naive uppercase token scan; the full `definition` is the
// authoritative source rendered in the UI, so a header mis-parse is cosmetic.
// Upgrade to a real tokenizer only if quoted keyword identifiers show up.
fn parse_sqlite_trigger_header(sql: &str) -> SqliteTriggerHeader {
    // SQLite defaults to BEFORE when the timing keyword is omitted.
    let mut timing = "BEFORE";
    let mut events = Vec::new();
    let upper = sql.to_uppercase();
    let mut tokens = upper.split_whitespace().peekable();
    while let Some(tok) = tokens.next() {
        match tok {
            "INSTEAD" if tokens.peek() == Some(&"OF") => timing = "INSTEAD OF",
            "BEFORE" => timing = "BEFORE",
            "AFTER" => timing = "AFTER",
            "INSERT" => {
                events.push("INSERT");
                break;
            }
            "UPDATE" => {
                events.push("UPDATE");
                break;
            }
            "DELETE" => {
                events.push("DELETE");
                break;
            }
            _ => {}
        }
    }
    SqliteTriggerHeader { timing, events }
}

async fn sqlite_foreign_keys(
    pool: &SqlitePool,
    table_ident: &str,
) -> Result<HashMap<String, String>, AppError> {
    let fk_sql = format!("PRAGMA foreign_key_list({table_ident})");
    let rows = sqlx::query(&fk_sql)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;
    let mut map = HashMap::with_capacity(rows.len());
    for row in rows {
        let from: String = row
            .try_get("from")
            .map_err(|e| AppError::Database(e.to_string()))?;
        let target_table: String = row
            .try_get("table")
            .map_err(|e| AppError::Database(e.to_string()))?;
        let target_column: String = row
            .try_get("to")
            .map_err(|e| AppError::Database(e.to_string()))?;
        map.insert(from, format!("{target_table}({target_column})"));
    }
    Ok(map)
}

pub(super) fn sqlite_column_category(data_type: &str) -> ColumnCategory {
    let normalized = data_type.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return ColumnCategory::Unknown;
    }

    let tokens: HashSet<&str> = normalized
        .split(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
        .filter(|token| !token.is_empty())
        .collect();

    if tokens.contains("int") || normalized.contains("integer") {
        ColumnCategory::Int
    } else if tokens.contains("real")
        || tokens.contains("double")
        || tokens.contains("float")
        || tokens.contains("numeric")
        || tokens.contains("decimal")
    {
        ColumnCategory::Float
    } else if tokens.contains("bool") || tokens.contains("boolean") {
        ColumnCategory::Bool
    } else if tokens.contains("date")
        || tokens.contains("datetime")
        || tokens.contains("timestamp")
        || tokens.contains("time")
    {
        ColumnCategory::Datetime
    } else if tokens.contains("blob") || normalized.contains("binary") {
        ColumnCategory::Binary
    } else if tokens.contains("json") {
        ColumnCategory::Object
    } else if tokens.contains("uuid") {
        ColumnCategory::Uuid
    } else if tokens.contains("char")
        || tokens.contains("clob")
        || tokens.contains("text")
        || tokens.contains("varchar")
    {
        ColumnCategory::Text
    } else {
        ColumnCategory::Unknown
    }
}

#[cfg(test)]
#[path = "connection_tests.rs"]
mod tests;
