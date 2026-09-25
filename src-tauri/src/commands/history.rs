//! `query_history` backend IPC surface.
//!
//! 4 IPC + 1 boot helper:
//!   - `add_history_entry`  — INSERT one row, computes `sql_redacted`
//!     (regex masking), validates discriminated union (paradigm/queryMode)
//!     + executedAt drift (|now - executedAt| > 5min → backend override).
//!   - `list_history`       — paginated rows, NEVER returns `sql`. Filter
//!     union enforces paradigm/queryMode pairing; `tabId` requires
//!     `connectionId`. `limit` defaults 100, clamped 500.
//!   - `get_history_detail` — single row `{id, source, sql, sqlRedacted}`;
//!     file-analytics rows return redacted SQL even on detail.
//!   - `clear_history`      — BEGIN→COUNT→DELETE→COMMIT, then VACUUM
//!     (outside the transaction — a SQLite constraint), emits
//!     `history.clear`, returns `{deletedCount}`.
//!   - `boot_vacuum_old_history` — retention policy (drop rows older
//!     than `settings.query_history_retention_days`). Function-level
//!     unit test (AC-371-10); the boot wiring lives in
//!     `storage::history_retention_boot`.
//!
//! Strategy doc F.5 (line 535–605) — privacy invariants:
//!   - `sql_redacted NOT NULL` — falls back to the original text if
//!     `sql_redact()` panics.
//!   - `sql` appears nowhere in a list response.
//!   - the detail IPC takes a single row id only — no bulk dump path.
//!   - VACUUM runs outside the transaction (SQLite refuses a mid-tx
//!     VACUUM).

use crate::commands::connection::AppState;
use crate::commands::guard::guard_legacy_import_done;
use crate::error::AppError;
use crate::events::{emit_state_changed, EmitArgs, EventDomain, EventOp, EventVersionRegistry};
use crate::storage::sql_redact::{redact_connection_message, redact_credentials, sql_redact};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::path::Path;
use tauri::{AppHandle, Runtime, State};
use tracing::warn;

// ---------------------------------------------------------------------------
// Discriminated union — paradigm + queryMode pair.
// ---------------------------------------------------------------------------

/// A `paradigm` + `queryMode` discriminated union, so an invalid pair is
/// rejected at the serde stage (AC-371-01). RDB allows SQL only; document
/// (Mongo) allows the query-builder family only.
///
/// Wire examples (camelCase):
///   `{ "paradigm": "rdb",      "queryMode": "sql" }`
///   `{ "paradigm": "document", "queryMode": "find" }`
///   `{ "paradigm": "document", "queryMode": "aggregate" }`
///
/// Invalid examples (serde reject → 400):
///   `{ "paradigm": "rdb",      "queryMode": "find" }`
///   `{ "paradigm": "document", "queryMode": "sql" }`
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "paradigm", rename_all = "lowercase")]
pub enum HistoryQueryMode {
    Rdb {
        #[serde(rename = "queryMode")]
        query_mode: RdbQueryMode,
    },
    Document {
        #[serde(rename = "queryMode")]
        query_mode: DocumentQueryMode,
    },
    // Issue #1171 — kv (Redis/Valkey) / search (ES/OpenSearch) recording. Each
    // paradigm carries a single query mode (`command` / `dsl`); the display path
    // (#1055/#1166) labels by paradigm, so a fixed mode is sufficient. Backward
    // compat: existing rows are only rdb/document, so adding variants is a pure
    // read/write superset — no migration.
    Kv {
        #[serde(rename = "queryMode")]
        query_mode: KvQueryMode,
    },
    Search {
        #[serde(rename = "queryMode")]
        query_mode: SearchQueryMode,
    },
}

/// Query modes allowed for the RDB paradigm. "sql" only.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RdbQueryMode {
    Sql,
}

/// Query modes allowed for the KV paradigm (Redis/Valkey). One Redis
/// command kind.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum KvQueryMode {
    Command,
}

/// Query modes allowed for the search paradigm (ES/OpenSearch). One search
/// DSL kind.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SearchQueryMode {
    Dsl,
}

/// Query modes allowed for the document paradigm. The mongosh command
/// family.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DocumentQueryMode {
    Find,
    FindOne,
    Aggregate,
    Count,
    EstimatedDocumentCount,
    Distinct,
    InsertOne,
    InsertMany,
    UpdateOne,
    UpdateMany,
    ReplaceOne,
    DeleteOne,
    DeleteMany,
    CreateIndex,
    DropIndex,
    BulkWrite,
}

impl HistoryQueryMode {
    fn paradigm_str(&self) -> &'static str {
        match self {
            Self::Rdb { .. } => "rdb",
            Self::Document { .. } => "document",
            Self::Kv { .. } => "kv",
            Self::Search { .. } => "search",
        }
    }

    fn query_mode_str(&self) -> &'static str {
        match self {
            Self::Rdb { query_mode } => match query_mode {
                RdbQueryMode::Sql => "sql",
            },
            Self::Kv { query_mode } => match query_mode {
                KvQueryMode::Command => "command",
            },
            Self::Search { query_mode } => match query_mode {
                SearchQueryMode::Dsl => "dsl",
            },
            Self::Document { query_mode } => match query_mode {
                DocumentQueryMode::Find => "find",
                DocumentQueryMode::FindOne => "findOne",
                DocumentQueryMode::Aggregate => "aggregate",
                DocumentQueryMode::Count => "count",
                DocumentQueryMode::EstimatedDocumentCount => "estimatedDocumentCount",
                DocumentQueryMode::Distinct => "distinct",
                DocumentQueryMode::InsertOne => "insertOne",
                DocumentQueryMode::InsertMany => "insertMany",
                DocumentQueryMode::UpdateOne => "updateOne",
                DocumentQueryMode::UpdateMany => "updateMany",
                DocumentQueryMode::ReplaceOne => "replaceOne",
                DocumentQueryMode::DeleteOne => "deleteOne",
                DocumentQueryMode::DeleteMany => "deleteMany",
                DocumentQueryMode::CreateIndex => "createIndex",
                DocumentQueryMode::DropIndex => "dropIndex",
                DocumentQueryMode::BulkWrite => "bulkWrite",
            },
        }
    }
}

/// Discriminated union for the filter — list/filter also returns 400 when
/// only `queryMode` is given without a paradigm (AC-371-02). The external
/// wire shape of this enum is identical to `HistoryQueryMode`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "paradigm", rename_all = "lowercase")]
pub enum HistoryQueryModeFilter {
    Rdb {
        #[serde(default, rename = "queryMode", skip_serializing_if = "Option::is_none")]
        query_mode: Option<RdbQueryMode>,
    },
    Document {
        #[serde(default, rename = "queryMode", skip_serializing_if = "Option::is_none")]
        query_mode: Option<DocumentQueryMode>,
    },
    Kv {
        #[serde(default, rename = "queryMode", skip_serializing_if = "Option::is_none")]
        query_mode: Option<KvQueryMode>,
    },
    Search {
        #[serde(default, rename = "queryMode", skip_serializing_if = "Option::is_none")]
        query_mode: Option<SearchQueryMode>,
    },
}

impl HistoryQueryModeFilter {
    fn paradigm_str(&self) -> &'static str {
        match self {
            Self::Rdb { .. } => "rdb",
            Self::Document { .. } => "document",
            Self::Kv { .. } => "kv",
            Self::Search { .. } => "search",
        }
    }

    fn query_mode_str(&self) -> Option<&'static str> {
        match self {
            Self::Rdb { query_mode } => query_mode.as_ref().map(|q| match q {
                RdbQueryMode::Sql => "sql",
            }),
            Self::Kv { query_mode } => query_mode.as_ref().map(|q| match q {
                KvQueryMode::Command => "command",
            }),
            Self::Search { query_mode } => query_mode.as_ref().map(|q| match q {
                SearchQueryMode::Dsl => "dsl",
            }),
            Self::Document { query_mode } => query_mode.as_ref().map(|q| match q {
                DocumentQueryMode::Find => "find",
                DocumentQueryMode::FindOne => "findOne",
                DocumentQueryMode::Aggregate => "aggregate",
                DocumentQueryMode::Count => "count",
                DocumentQueryMode::EstimatedDocumentCount => "estimatedDocumentCount",
                DocumentQueryMode::Distinct => "distinct",
                DocumentQueryMode::InsertOne => "insertOne",
                DocumentQueryMode::InsertMany => "insertMany",
                DocumentQueryMode::UpdateOne => "updateOne",
                DocumentQueryMode::UpdateMany => "updateMany",
                DocumentQueryMode::ReplaceOne => "replaceOne",
                DocumentQueryMode::DeleteOne => "deleteOne",
                DocumentQueryMode::DeleteMany => "deleteMany",
                DocumentQueryMode::CreateIndex => "createIndex",
                DocumentQueryMode::DropIndex => "dropIndex",
                DocumentQueryMode::BulkWrite => "bulkWrite",
            }),
        }
    }
}

// ---------------------------------------------------------------------------
// add_history_entry
// ---------------------------------------------------------------------------

/// Wire shape of the query_history INSERT. Called from the frontend's
/// history.recordExecution branch.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddHistoryEntryRequest {
    pub connection_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab_id: Option<String>,
    /// paradigm + queryMode discriminated union — an invalid combo is
    /// rejected at the serde stage.
    #[serde(flatten)]
    pub mode: HistoryQueryMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collection: Option<String>,
    /// Trigger source labelled by the frontend — `raw` / `grid-edit` / etc.
    pub source: String,
    /// The original SQL / mongosh expression. The backend calls
    /// `sql_redact()` on it.
    pub sql: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows_affected: Option<i64>,
    pub duration_ms: i64,
    /// Execution start time measured on the user's clock (unix ms). The
    /// backend checks `|now - executed_at| > 5min` and, on drift, overrides
    /// it with the backend now (AC-371-09).
    pub executed_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_pid: Option<i64>,
}

/// `add_history_entry` response — the row id (AUTOINCREMENT INTEGER) the
/// caller uses for a detail fetch / store reconcile.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddHistoryEntryResponse {
    pub id: i64,
    pub executed_at: i64,
    pub sql_redacted: String,
}

/// drift threshold 5 minutes (strategy doc F.5 line 605).
const DRIFT_THRESHOLD_MS: i64 = 5 * 60 * 1000;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub async fn add_history_entry_inner(
    pool: &SqlitePool,
    req: AddHistoryEntryRequest,
) -> Result<AddHistoryEntryResponse, AppError> {
    guard_legacy_import_done(pool).await?;

    // AC-371-09 — executed_at drift validation. |now - executed_at| > 5min
    // → backend now override + dev warning. A safety net for a frontend clock
    // that is wildly off because the user changed the OS clock, NTP sync
    // failed, and so on.
    let now = now_ms();
    let executed_at = if (now - req.executed_at).abs() > DRIFT_THRESHOLD_MS {
        warn!(
            target: "history",
            frontend_executed_at = req.executed_at,
            backend_now = now,
            drift_ms = (now - req.executed_at).abs(),
            "history executedAt drift > 5min — overriding with backend now"
        );
        now
    } else {
        req.executed_at
    };

    // Issue #1451 — strip plaintext credentials from a DDL statement before it
    // is persisted, so the stored `sql` column (returned verbatim by
    // `get_history_detail`) never holds a password. `sql_redacted` derives from
    // the already-masked text so the list view is safe from Oracle bareword
    // passwords too (which `sql_redact` alone leaves untouched — they carry no
    // quotes).
    let stored_sql = redact_credentials(&req.sql);
    let sql_redacted = sql_redact(&stored_sql);
    // Issue #1553 — a query error can echo the SQL's embedded conninfo, so mask
    // `password=...` / URI userinfo in the error message before persisting,
    // symmetric with the sql column above (the list/detail return paths only
    // strip local paths).
    let error_message = req.error_message.as_deref().map(redact_connection_message);
    let paradigm = req.mode.paradigm_str();
    let query_mode = req.mode.query_mode_str();

    // INSERT a single row. The id is AUTOINCREMENT — recovered through
    // `last_insert_rowid()`.
    let row: (i64,) = sqlx::query_as(
        "INSERT INTO query_history \
         (connection_id, tab_id, paradigm, query_mode, database, collection, source, \
          sql, sql_redacted, status, error_message, rows_affected, duration_ms, \
          executed_at, server_pid) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
         RETURNING id",
    )
    .bind(&req.connection_id)
    .bind(&req.tab_id)
    .bind(paradigm)
    .bind(query_mode)
    .bind(&req.database)
    .bind(&req.collection)
    .bind(&req.source)
    .bind(&stored_sql)
    .bind(&sql_redacted)
    .bind(&req.status)
    .bind(&error_message)
    .bind(req.rows_affected)
    .bind(req.duration_ms)
    .bind(executed_at)
    .bind(req.server_pid)
    .fetch_one(pool)
    .await?;

    Ok(AddHistoryEntryResponse {
        id: row.0,
        executed_at,
        sql_redacted,
    })
}

#[tauri::command]
pub async fn add_history_entry(
    req: AddHistoryEntryRequest,
    _state: State<'_, AppState>,
) -> Result<AddHistoryEntryResponse, AppError> {
    let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
    add_history_entry_inner(&pool, req).await
}

// ---------------------------------------------------------------------------
// list_history
// ---------------------------------------------------------------------------

/// Default page size when caller omits `limit`. Strategy doc F.5.
const DEFAULT_LIMIT: i64 = 100;
/// Hard cap regardless of caller request. Strategy doc F.5 / AC-371-04.
const MAX_LIMIT: i64 = 500;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListHistoryRequest {
    /// connectionId filter — required whenever `tabId` is present
    /// (AC-371-03).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab_id: Option<String>,
    /// Filter union — a bare queryMode without a paradigm is rejected.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter: Option<HistoryQueryModeFilter>,
    /// Cursor pagination — with `Some(id)`, only rows with id < cursor
    /// (compatible with the executed_at DESC, id DESC ordering).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<i64>,
    /// Page size. None → 100. > 500 → clamped to 500.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<i64>,
}

/// A row of the list response — the `sql` field is **absent** (AC-371-05).
/// Only `sqlRedacted` is exposed.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryListRow {
    pub id: i64,
    pub connection_id: String,
    pub tab_id: Option<String>,
    pub paradigm: String,
    pub query_mode: String,
    pub database: Option<String>,
    pub collection: Option<String>,
    pub source: String,
    pub sql_redacted: String,
    pub status: String,
    pub error_message: Option<String>,
    pub rows_affected: Option<i64>,
    pub duration_ms: i64,
    pub executed_at: i64,
    pub server_pid: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListHistoryResponse {
    pub rows: Vec<HistoryListRow>,
    /// Cursor for the next page — `rows.last().id`, or None when rows is
    /// empty or the page is the last one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<i64>,
}

pub async fn list_history_inner(
    pool: &SqlitePool,
    req: ListHistoryRequest,
) -> Result<ListHistoryResponse, AppError> {
    // AC-371-03 — connectionId is required whenever tabId is present. A tab
    // inside a workspace always needs its connection context, so this
    // constraint is a semantic invariant.
    if req.tab_id.is_some() && req.connection_id.is_none() {
        return Err(AppError::Validation(
            "list_history: tabId requires connectionId".into(),
        ));
    }

    // AC-371-04 — limit clamp. None → 100. Negative/zero falls back to the
    // default (guards against semantically buggy input). Anything over 500 is
    // truncated.
    let limit = match req.limit {
        Some(v) if v > 0 => v.min(MAX_LIMIT),
        _ => DEFAULT_LIMIT,
    };

    // Turn the filter's paradigm/queryMode pair into SQL clauses. A bare
    // paradigm is fine (filters on paradigm = 'rdb' / 'document' alone). A
    // bare queryMode is rejected at the serde stage by the union definition
    // of the enum above — it cannot reach list_history_inner.
    let (filter_clauses, filter_params): (Vec<&'static str>, Vec<String>) = match &req.filter {
        None => (Vec::new(), Vec::new()),
        Some(f) => {
            let mut clauses = vec!["paradigm = ?"];
            let mut params = vec![f.paradigm_str().to_string()];
            if let Some(q) = f.query_mode_str() {
                clauses.push("query_mode = ?");
                params.push(q.to_string());
            }
            (clauses, params)
        }
    };

    let mut where_clauses = filter_clauses;
    let mut bind_strs: Vec<String> = filter_params;
    let mut bind_i64s: Vec<i64> = Vec::new();

    if let Some(ref cid) = req.connection_id {
        where_clauses.push("connection_id = ?");
        bind_strs.push(cid.clone());
    }
    if let Some(ref tid) = req.tab_id {
        where_clauses.push("tab_id = ?");
        bind_strs.push(tid.clone());
    }
    if let Some(c) = req.cursor {
        where_clauses.push("id < ?");
        bind_i64s.push(c);
    }

    let where_sql = if where_clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", where_clauses.join(" AND "))
    };

    // ORDER BY id DESC — the AUTOINCREMENT id increases monotonically, so it
    // correlates 1:1 with insertion order (= execution order). That lets the
    // `id < cursor` clause of the cursor pagination hold a simple ordering
    // without comparing an (executed_at, id) composite key, which is what
    // makes next_cursor stable. Even if the user's clock jumps backwards on
    // an NTP sync (the edge case where executed_at duplicates), the id breaks
    // the tie.
    let sql = format!(
        "SELECT id, connection_id, tab_id, paradigm, query_mode, database, collection, \
                source, sql_redacted, status, error_message, rows_affected, duration_ms, \
                executed_at, server_pid \
         FROM query_history{} \
         ORDER BY id DESC \
         LIMIT ?",
        where_sql
    );

    let mut q = sqlx::query_as::<_, HistoryRowTuple>(&sql);
    for s in &bind_strs {
        q = q.bind(s);
    }
    for v in &bind_i64s {
        q = q.bind(*v);
    }
    q = q.bind(limit);
    let rows: Vec<HistoryRowTuple> = q.fetch_all(pool).await?;

    let next_cursor = if rows.len() as i64 == limit {
        rows.last().map(|r| r.0)
    } else {
        None
    };

    let rows = rows.into_iter().map(HistoryListRow::from).collect();

    Ok(ListHistoryResponse { rows, next_cursor })
}

/// Internal tuple for `sqlx::query_as` — keeps column order coupled with
/// the SELECT statement. Converts to `HistoryListRow` (which intentionally
/// omits `sql`) on the way out.
#[derive(sqlx::FromRow)]
struct HistoryRowTuple(
    i64,            // id
    String,         // connection_id
    Option<String>, // tab_id
    String,         // paradigm
    String,         // query_mode
    Option<String>, // database
    Option<String>, // collection
    String,         // source
    String,         // sql_redacted
    String,         // status
    Option<String>, // error_message
    Option<i64>,    // rows_affected
    i64,            // duration_ms
    i64,            // executed_at
    Option<i64>,    // server_pid
);

impl From<HistoryRowTuple> for HistoryListRow {
    fn from(t: HistoryRowTuple) -> Self {
        Self {
            id: t.0,
            connection_id: t.1,
            tab_id: t.2,
            paradigm: t.3,
            query_mode: t.4,
            database: t.5.map(|value| redact_visible_local_paths(&value)),
            collection: t.6.map(|value| redact_visible_local_paths(&value)),
            source: t.7,
            sql_redacted: t.8,
            status: t.9,
            error_message: t.10.map(|value| redact_visible_local_paths(&value)),
            rows_affected: t.11,
            duration_ms: t.12,
            executed_at: t.13,
            server_pid: t.14,
        }
    }
}

fn redact_visible_local_paths(message: &str) -> String {
    let mut redacted = message.to_string();
    for token in message
        .split(|ch: char| ch.is_whitespace() || matches!(ch, '\'' | '"' | '(' | ')' | ',' | ';'))
    {
        let token = token.trim_matches(|ch: char| matches!(ch, ':' | '.' | '!' | '?'));
        if token.is_empty() {
            continue;
        }
        let is_windows_path = token.len() > 2
            && token.as_bytes()[1] == b':'
            && matches!(token.as_bytes()[2], b'\\' | b'/');
        if Path::new(token).is_absolute() || is_windows_path {
            redacted = redacted.replace(token, "<local-file>");
        }
    }
    redacted
}

#[tauri::command]
pub async fn list_history(
    req: ListHistoryRequest,
    _state: State<'_, AppState>,
) -> Result<ListHistoryResponse, AppError> {
    let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
    list_history_inner(&pool, req).await
}

// ---------------------------------------------------------------------------
// get_history_detail
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetHistoryDetailRequest {
    pub id: i64,
}

/// Detail response — it takes a single row id only, so there is no bulk
/// dump path.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryDetailResponse {
    pub id: i64,
    pub source: String,
    pub sql: String,
    pub sql_redacted: String,
}

pub async fn get_history_detail_inner(
    pool: &SqlitePool,
    req: GetHistoryDetailRequest,
) -> Result<HistoryDetailResponse, AppError> {
    let row: Option<(i64, String, String, String)> =
        sqlx::query_as("SELECT id, source, sql, sql_redacted FROM query_history WHERE id = ?")
            .bind(req.id)
            .fetch_optional(pool)
            .await?;
    match row {
        Some((id, source, sql, sql_redacted)) => {
            let sql = if source == "file-analytics" {
                sql_redacted.clone()
            } else {
                sql
            };
            Ok(HistoryDetailResponse {
                id,
                source,
                sql,
                sql_redacted,
            })
        }
        None => Err(AppError::NotFound(format!(
            "history entry {} not found",
            req.id
        ))),
    }
}

#[tauri::command]
pub async fn get_history_detail(
    req: GetHistoryDetailRequest,
    _state: State<'_, AppState>,
) -> Result<HistoryDetailResponse, AppError> {
    let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
    get_history_detail_inner(&pool, req).await
}

// ---------------------------------------------------------------------------
// clear_history
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearHistoryResponse {
    pub deleted_count: i64,
}

/// Invariant of AC-371-07:
///   1. BEGIN — transaction open.
///   2. COUNT — read the pre-delete row count (the return value).
///   3. DELETE — remove every query_history row.
///   4. COMMIT — transaction close (a prerequisite for VACUUM).
///   5. VACUUM — outside the transaction. SQLite refuses a mid-transaction
///      VACUUM.
///
/// The VACUUM in step 5 is best-effort — even if it fails on a DB lock or
/// similar, the deleted_count response still returns normally. Zero
/// user-visible effect (`boot_vacuum_old_history` mops up on the next boot).
pub async fn clear_history_inner(pool: &SqlitePool) -> Result<i64, AppError> {
    guard_legacy_import_done(pool).await?;

    let mut tx = pool.begin().await?;
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM query_history")
        .fetch_one(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM query_history")
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    // VACUUM — separated from the transaction (a SQLite constraint). Even if
    // it fails on a DB lock / busy, the caller's deletedCount response
    // stands.
    if let Err(e) = sqlx::query("VACUUM").execute(pool).await {
        warn!(
            target: "history",
            error = %e,
            "clear_history VACUUM failed (best-effort) — table state already cleared"
        );
    }

    Ok(count.0)
}

#[tauri::command]
pub async fn clear_history<R: Runtime>(
    _state: State<'_, AppState>,
    app: AppHandle<R>,
    registry: State<'_, EventVersionRegistry>,
    window: tauri::Window<R>,
) -> Result<ClearHistoryResponse, AppError> {
    let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
    let deleted_count = clear_history_inner(&pool).await?;

    emit_state_changed(
        &app,
        registry.inner(),
        EmitArgs {
            domain: EventDomain::History,
            op: EventOp::Clear,
            entity_id: None,
            origin_window: Some(window.label().to_string()),
            snapshot_version: 0,
            field: None,
        },
    )?;

    Ok(ClearHistoryResponse { deleted_count })
}

// ---------------------------------------------------------------------------
// boot_vacuum_old_history (AC-371-10)
// ---------------------------------------------------------------------------

/// Unit of the retention policy. Converts the
/// `settings.query_history_retention_days` value into `i64` ms and deletes
/// the rows where `executed_at < now - retention_days`. The boot call site
/// and its e2e coverage live in `storage::history_retention_boot`; the tests
/// here lock the function level only.
///
/// `retention_days` <= 0 is a no-op (the user chose "keep forever"). The
/// normal path is between 1 and 365.
pub async fn boot_vacuum_old_history(
    pool: &SqlitePool,
    retention_days: i64,
) -> Result<i64, AppError> {
    if retention_days <= 0 {
        return Ok(0);
    }
    let threshold = now_ms() - retention_days * 24 * 60 * 60 * 1000;
    let result = sqlx::query("DELETE FROM query_history WHERE executed_at < ?")
        .bind(threshold)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() as i64)
}

#[cfg(test)]
mod tests {
    //! Function-level unit tests for `boot_vacuum_old_history` (AC-371-10).
    //! The wired scenarios (the 4 IPC) are covered by the
    //! `tests/history_*.rs` integration tests.

    use super::*;
    use crate::storage::local;
    use crate::storage::meta::{set_legacy_import_state, LegacyImportState};
    use serial_test::serial;
    use tempfile::TempDir;

    async fn setup() -> (TempDir, SqlitePool) {
        let dir = TempDir::new().unwrap();
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
        let pool = local::open_pool().await.unwrap();
        set_legacy_import_state(&pool, LegacyImportState::Done)
            .await
            .unwrap();
        (dir, pool)
    }

    fn cleanup() {
        std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
    }

    async fn insert_row(pool: &SqlitePool, executed_at: i64) -> i64 {
        let row: (i64,) = sqlx::query_as(
            "INSERT INTO query_history \
             (connection_id, paradigm, query_mode, source, sql, sql_redacted, \
              status, duration_ms, executed_at) \
             VALUES ('c1', 'rdb', 'sql', 'raw', 'SELECT 1', 'SELECT 1', 'success', 5, ?) \
             RETURNING id",
        )
        .bind(executed_at)
        .fetch_one(pool)
        .await
        .unwrap();
        row.0
    }

    #[tokio::test]
    #[serial]
    async fn boot_vacuum_deletes_only_rows_older_than_retention() {
        let (_dir, pool) = setup().await;
        let now = now_ms();
        let day_ms: i64 = 24 * 60 * 60 * 1000;

        // 3 rows: 100 days ago (should DELETE), 5 days ago (KEEP), 1h ago (KEEP).
        let old_id = insert_row(&pool, now - 100 * day_ms).await;
        let recent_id = insert_row(&pool, now - 5 * day_ms).await;
        let fresh_id = insert_row(&pool, now - 60 * 60 * 1000).await;

        let deleted = boot_vacuum_old_history(&pool, 30).await.unwrap();
        assert_eq!(deleted, 1, "exactly the 100-day-old row should drop");

        let remaining_ids: Vec<i64> =
            sqlx::query_scalar("SELECT id FROM query_history ORDER BY id ASC")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert!(!remaining_ids.contains(&old_id));
        assert!(remaining_ids.contains(&recent_id));
        assert!(remaining_ids.contains(&fresh_id));
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn boot_vacuum_with_zero_retention_is_noop() {
        let (_dir, pool) = setup().await;
        let now = now_ms();
        insert_row(&pool, now - 10_000_000).await;
        let deleted = boot_vacuum_old_history(&pool, 0).await.unwrap();
        assert_eq!(deleted, 0);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM query_history")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn boot_vacuum_with_negative_retention_is_noop() {
        let (_dir, pool) = setup().await;
        let deleted = boot_vacuum_old_history(&pool, -7).await.unwrap();
        assert_eq!(deleted, 0);
        cleanup();
    }

    // ---------------------------------------------------------------------
    // The inline tests above cover `boot_vacuum_*` only, and the
    // `tests/history_*` integration binaries sit outside the coverage
    // measurement set, which leaves `add_history_entry_inner` /
    // `list_history_inner` / `get_history_detail_inner` /
    // `clear_history_inner` thinly covered. The tests below lock the core
    // paths of the 4 IPC on the `--lib` route.
    //
    // 8 principles:
    //   - Happy: the add → list → detail → clear flow in one lock.
    //   - Empty input: list_history with an empty filter → empty response.
    //   - Error recovery: get_history_detail with an absent id →
    //     AppError::NotFound.
    //   - Concurrency: an add after clear gets a fresh id (autoincrement is
    //     not reset).
    //   - State transition: filter union — paradigm only / paradigm+queryMode.
    //   - try-await reject: list's tabId-without-connectionId → Validation.
    //   - No empty catch: the VACUUM failure path of clear only warns — the
    //     invariant is locked by the row 0 / count assertions.
    // ---------------------------------------------------------------------

    /// Build an empty `ListHistoryRequest` — used in place of `Default::default()`
    /// so no `#[derive(Default)]` has to be added to the wire struct.
    fn empty_list_request() -> ListHistoryRequest {
        ListHistoryRequest {
            connection_id: None,
            tab_id: None,
            filter: None,
            cursor: None,
            limit: None,
        }
    }

    async fn insert_one_default(pool: &SqlitePool, sql: &str) -> i64 {
        let req: AddHistoryEntryRequest = serde_json::from_value(serde_json::json!({
            "connectionId": "c-1",
            "paradigm": "rdb",
            "queryMode": "sql",
            "source": "raw",
            "sql": sql,
            "status": "success",
            "durationMs": 1,
            "executedAt": now_ms(),
        }))
        .unwrap();
        add_history_entry_inner(pool, req).await.unwrap().id
    }

    // ---------------- add_history_entry_inner ----------------

    #[tokio::test]
    #[serial]
    async fn add_inner_returns_monotonic_ids() {
        let (_dir, pool) = setup().await;
        let id1 = insert_one_default(&pool, "SELECT 1").await;
        let id2 = insert_one_default(&pool, "SELECT 2").await;
        assert!(id2 > id1, "AUTOINCREMENT id must be monotonic");
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn add_inner_redacts_sql_in_response() {
        let (_dir, pool) = setup().await;
        let req: AddHistoryEntryRequest = serde_json::from_value(serde_json::json!({
            "connectionId": "c-1",
            "paradigm": "rdb",
            "queryMode": "sql",
            "source": "raw",
            "sql": "SELECT * FROM users WHERE name = 'alice'",
            "status": "success",
            "durationMs": 1,
            "executedAt": now_ms(),
        }))
        .unwrap();
        let resp = add_history_entry_inner(&pool, req).await.unwrap();
        // sql_redact replaces quoted literals with `?` — we expect at least
        // one occurrence in the masked form.
        assert!(
            resp.sql_redacted.contains('?'),
            "sql_redact must mask quoted literal: {}",
            resp.sql_redacted
        );
        // The original SQL is preserved in the row but not the response (the
        // response is the redacted form; detail IPC returns the original).
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn add_inner_overrides_drifted_executed_at_with_backend_now() {
        let (_dir, pool) = setup().await;
        // Drift the frontend timestamp by 1 day (well past 5min).
        let drifted = now_ms() - 24 * 60 * 60 * 1000;
        let req: AddHistoryEntryRequest = serde_json::from_value(serde_json::json!({
            "connectionId": "c-1",
            "paradigm": "rdb",
            "queryMode": "sql",
            "source": "raw",
            "sql": "SELECT 1",
            "status": "success",
            "durationMs": 1,
            "executedAt": drifted,
        }))
        .unwrap();
        let resp = add_history_entry_inner(&pool, req).await.unwrap();
        assert!(
            (resp.executed_at - now_ms()).abs() < 5_000,
            "drifted executed_at must be overridden with backend now"
        );
        assert_ne!(resp.executed_at, drifted, "must not echo the drifted value");
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn add_inner_accepts_in_range_executed_at_verbatim() {
        let (_dir, pool) = setup().await;
        let within = now_ms() - 60_000; // 1 minute ago — within 5-min threshold.
        let req: AddHistoryEntryRequest = serde_json::from_value(serde_json::json!({
            "connectionId": "c-1",
            "paradigm": "rdb",
            "queryMode": "sql",
            "source": "raw",
            "sql": "SELECT 1",
            "status": "success",
            "durationMs": 1,
            "executedAt": within,
        }))
        .unwrap();
        let resp = add_history_entry_inner(&pool, req).await.unwrap();
        assert_eq!(resp.executed_at, within);
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn add_inner_persists_document_paradigm_with_query_mode() {
        let (_dir, pool) = setup().await;
        let req: AddHistoryEntryRequest = serde_json::from_value(serde_json::json!({
            "connectionId": "mongo-1",
            "paradigm": "document",
            "queryMode": "aggregate",
            "source": "raw",
            "sql": "db.users.aggregate([{$match:{a:1}}])",
            "status": "success",
            "durationMs": 1,
            "executedAt": now_ms(),
        }))
        .unwrap();
        let resp = add_history_entry_inner(&pool, req).await.unwrap();
        let row: (String, String) =
            sqlx::query_as("SELECT paradigm, query_mode FROM query_history WHERE id = ?")
                .bind(resp.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(row.0, "document");
        assert_eq!(row.1, "aggregate");
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn add_inner_redacts_credentials_in_error_message() {
        // Issue #1553 — a query error can echo the SQL's embedded conninfo, so
        // `password=...` must be masked before the error_message is persisted
        // (parity with the sql column), not just the local-path pass on return.
        let (_dir, pool) = setup().await;
        let req: AddHistoryEntryRequest = serde_json::from_value(serde_json::json!({
            "connectionId": "c-1",
            "paradigm": "rdb",
            "queryMode": "sql",
            "source": "raw",
            "sql": "SELECT 1",
            "status": "error",
            "errorMessage": "connect failed: mysql://root:S3cretPw1@db:3306/app password=S3cretPw1",
            "durationMs": 1,
            "executedAt": now_ms(),
        }))
        .unwrap();
        add_history_entry_inner(&pool, req).await.unwrap();

        let resp = list_history_inner(&pool, empty_list_request())
            .await
            .unwrap();
        let msg = resp.rows.first().unwrap().error_message.as_deref().unwrap();
        assert!(
            !msg.contains("S3cretPw1"),
            "credential must not survive in stored error_message: {msg}"
        );
        assert!(msg.contains("***"), "credential must be masked: {msg}");
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn add_inner_preserves_credential_free_error_message() {
        // Control — an ordinary error (no credentials) must round-trip verbatim.
        let (_dir, pool) = setup().await;
        let req: AddHistoryEntryRequest = serde_json::from_value(serde_json::json!({
            "connectionId": "c-1",
            "paradigm": "rdb",
            "queryMode": "sql",
            "source": "raw",
            "sql": "SELECT 1",
            "status": "error",
            "errorMessage": "syntax error near 'FROM'",
            "durationMs": 1,
            "executedAt": now_ms(),
        }))
        .unwrap();
        add_history_entry_inner(&pool, req).await.unwrap();

        let resp = list_history_inner(&pool, empty_list_request())
            .await
            .unwrap();
        assert_eq!(
            resp.rows.first().unwrap().error_message.as_deref(),
            Some("syntax error near 'FROM'")
        );
        cleanup();
    }

    // ---------------- list_history_inner ----------------

    #[tokio::test]
    #[serial]
    async fn list_inner_empty_table_returns_empty_rows_and_no_next_cursor() {
        let (_dir, pool) = setup().await;
        let resp = list_history_inner(&pool, empty_list_request())
            .await
            .unwrap();
        assert!(resp.rows.is_empty());
        assert!(resp.next_cursor.is_none());
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn list_inner_redacts_visible_local_paths() {
        let (_dir, pool) = setup().await;
        let req: AddHistoryEntryRequest = serde_json::from_value(serde_json::json!({
            "connectionId": "duckdb-1",
            "paradigm": "rdb",
            "queryMode": "sql",
            "database": "/Users/felix/private/app.duckdb",
            "collection": "/Users/felix/private/sales.csv",
            "source": "file-analytics",
            "sql": "SELECT * FROM \"sales_csv\"",
            "status": "error",
            "errorMessage": "DuckDB failed while reading /Users/felix/private/sales.csv",
            "durationMs": 1,
            "executedAt": now_ms(),
        }))
        .unwrap();
        add_history_entry_inner(&pool, req).await.unwrap();

        let resp = list_history_inner(&pool, empty_list_request())
            .await
            .unwrap();
        let row = resp.rows.first().unwrap();

        assert_eq!(row.database.as_deref(), Some("<local-file>"));
        assert_eq!(row.collection.as_deref(), Some("<local-file>"));
        assert_eq!(
            row.error_message.as_deref(),
            Some("DuckDB failed while reading <local-file>")
        );
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn list_inner_rejects_tab_id_without_connection_id() {
        let (_dir, pool) = setup().await;
        let req = ListHistoryRequest {
            connection_id: None,
            tab_id: Some("t1".into()),
            filter: None,
            cursor: None,
            limit: None,
        };
        let err = list_history_inner(&pool, req).await.unwrap_err();
        match err {
            crate::error::AppError::Validation(msg) => assert!(msg.contains("tabId")),
            other => panic!("Expected Validation, got {other:?}"),
        }
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn list_inner_paradigm_only_filter_returns_matching_rows() {
        let (_dir, pool) = setup().await;
        insert_one_default(&pool, "SELECT 1").await;
        insert_one_default(&pool, "SELECT 2").await;
        let req = ListHistoryRequest {
            connection_id: None,
            tab_id: None,
            filter: Some(HistoryQueryModeFilter::Rdb { query_mode: None }),
            cursor: None,
            limit: None,
        };
        let resp = list_history_inner(&pool, req).await.unwrap();
        assert_eq!(resp.rows.len(), 2);
        for row in &resp.rows {
            assert_eq!(row.paradigm, "rdb");
        }
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn list_inner_paradigm_and_query_mode_filter_excludes_others() {
        let (_dir, pool) = setup().await;
        // 1 RDB row
        insert_one_default(&pool, "SELECT rdb").await;
        // 1 document row
        let doc_req: AddHistoryEntryRequest = serde_json::from_value(serde_json::json!({
            "connectionId": "mongo-1",
            "paradigm": "document",
            "queryMode": "find",
            "source": "raw",
            "sql": "db.x.find({})",
            "status": "success",
            "durationMs": 1,
            "executedAt": now_ms(),
        }))
        .unwrap();
        add_history_entry_inner(&pool, doc_req).await.unwrap();

        let req = ListHistoryRequest {
            connection_id: None,
            tab_id: None,
            filter: Some(HistoryQueryModeFilter::Document {
                query_mode: Some(DocumentQueryMode::Find),
            }),
            cursor: None,
            limit: None,
        };
        let resp = list_history_inner(&pool, req).await.unwrap();
        assert_eq!(resp.rows.len(), 1);
        assert_eq!(resp.rows[0].paradigm, "document");
        assert_eq!(resp.rows[0].query_mode, "find");
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn list_inner_limit_clamps_to_max() {
        let (_dir, pool) = setup().await;
        // Insert 510 rows so MAX_LIMIT (500) clamps.
        for i in 0..510_i32 {
            insert_one_default(&pool, &format!("SELECT {i}")).await;
        }
        let req = ListHistoryRequest {
            connection_id: None,
            tab_id: None,
            filter: None,
            cursor: None,
            limit: Some(1000),
        };
        let resp = list_history_inner(&pool, req).await.unwrap();
        assert_eq!(resp.rows.len(), 500);
        assert!(resp.next_cursor.is_some(), "page is full at clamp boundary");
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn list_inner_default_limit_is_100() {
        let (_dir, pool) = setup().await;
        for i in 0..150_i32 {
            insert_one_default(&pool, &format!("SELECT {i}")).await;
        }
        let req = empty_list_request();
        let resp = list_history_inner(&pool, req).await.unwrap();
        assert_eq!(resp.rows.len(), 100);
        assert!(resp.next_cursor.is_some());
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn list_inner_negative_limit_falls_back_to_default() {
        let (_dir, pool) = setup().await;
        for i in 0..150_i32 {
            insert_one_default(&pool, &format!("SELECT {i}")).await;
        }
        let req = ListHistoryRequest {
            limit: Some(-5),
            ..empty_list_request()
        };
        let resp = list_history_inner(&pool, req).await.unwrap();
        assert_eq!(resp.rows.len(), 100, "negative limit must fall back to 100");
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn list_inner_cursor_paginates_without_overlap() {
        let (_dir, pool) = setup().await;
        for i in 0..30_i32 {
            insert_one_default(&pool, &format!("SELECT {i}")).await;
        }
        let page1 = list_history_inner(
            &pool,
            ListHistoryRequest {
                limit: Some(10),
                ..empty_list_request()
            },
        )
        .await
        .unwrap();
        assert_eq!(page1.rows.len(), 10);
        let cursor = page1.next_cursor.expect("page 1 must yield cursor");

        let page2 = list_history_inner(
            &pool,
            ListHistoryRequest {
                limit: Some(10),
                cursor: Some(cursor),
                ..empty_list_request()
            },
        )
        .await
        .unwrap();
        assert_eq!(page2.rows.len(), 10);
        let ids1: Vec<i64> = page1.rows.iter().map(|r| r.id).collect();
        let ids2: Vec<i64> = page2.rows.iter().map(|r| r.id).collect();
        for id in &ids2 {
            assert!(!ids1.contains(id), "pages must not overlap");
        }
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn list_inner_connection_id_and_tab_id_filter_narrow_rows() {
        let (_dir, pool) = setup().await;
        // 2 rows with c-1/tab-A, 1 with c-1/tab-B, 1 with c-2/tab-A.
        for (cid, tid) in [
            ("c-1", "tab-A"),
            ("c-1", "tab-A"),
            ("c-1", "tab-B"),
            ("c-2", "tab-A"),
        ] {
            let req: AddHistoryEntryRequest = serde_json::from_value(serde_json::json!({
                "connectionId": cid,
                "tabId": tid,
                "paradigm": "rdb",
                "queryMode": "sql",
                "source": "raw",
                "sql": "SELECT 1",
                "status": "success",
                "durationMs": 1,
                "executedAt": now_ms(),
            }))
            .unwrap();
            add_history_entry_inner(&pool, req).await.unwrap();
        }
        let req = ListHistoryRequest {
            connection_id: Some("c-1".into()),
            tab_id: Some("tab-A".into()),
            filter: None,
            cursor: None,
            limit: None,
        };
        let resp = list_history_inner(&pool, req).await.unwrap();
        assert_eq!(resp.rows.len(), 2);
        for row in &resp.rows {
            assert_eq!(row.connection_id, "c-1");
            assert_eq!(row.tab_id.as_deref(), Some("tab-A"));
        }
        cleanup();
    }

    // ---------------- get_history_detail_inner ----------------

    #[tokio::test]
    #[serial]
    async fn detail_inner_returns_original_sql_for_existing_id() {
        let (_dir, pool) = setup().await;
        let sql = "SELECT * FROM users WHERE id = 1";
        let id = insert_one_default(&pool, sql).await;
        let resp = get_history_detail_inner(&pool, GetHistoryDetailRequest { id })
            .await
            .unwrap();
        assert_eq!(resp.id, id);
        assert_eq!(resp.source, "raw");
        assert_eq!(resp.sql, sql, "detail IPC returns the unredacted SQL");
        assert!(!resp.sql_redacted.is_empty());
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn detail_inner_redacts_file_analytics_sql() {
        let (_dir, pool) = setup().await;
        let req: AddHistoryEntryRequest = serde_json::from_value(serde_json::json!({
            "connectionId": "c-1",
            "paradigm": "rdb",
            "queryMode": "sql",
            "source": "file-analytics",
            "sql": "SELECT '/Users/felix/private/sales.csv' AS path FROM \"sales_csv\"",
            "status": "success",
            "durationMs": 1,
            "executedAt": now_ms(),
        }))
        .unwrap();
        let id = add_history_entry_inner(&pool, req).await.unwrap().id;

        let resp = get_history_detail_inner(&pool, GetHistoryDetailRequest { id })
            .await
            .unwrap();

        assert_eq!(resp.source, "file-analytics");
        assert_eq!(resp.sql, resp.sql_redacted);
        assert!(!resp.sql.contains("/Users/felix/private/sales.csv"));
        assert!(
            !resp.sql_redacted.contains("/Users/felix/private/sales.csv"),
            "redacted detail variant must hide local paths"
        );
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn detail_inner_missing_id_returns_not_found() {
        let (_dir, pool) = setup().await;
        let err = get_history_detail_inner(&pool, GetHistoryDetailRequest { id: 999_999 })
            .await
            .unwrap_err();
        match err {
            crate::error::AppError::NotFound(msg) => assert!(msg.contains("999999")),
            other => panic!("Expected NotFound, got {other:?}"),
        }
        cleanup();
    }

    // ---------------- clear_history_inner ----------------

    #[tokio::test]
    #[serial]
    async fn clear_inner_returns_pre_count_and_truncates() {
        let (_dir, pool) = setup().await;
        for i in 0..7_i32 {
            insert_one_default(&pool, &format!("SELECT {i}")).await;
        }
        let deleted = clear_history_inner(&pool).await.unwrap();
        assert_eq!(deleted, 7);
        let post: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM query_history")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(post, 0);
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn clear_inner_on_empty_table_returns_zero() {
        let (_dir, pool) = setup().await;
        let deleted = clear_history_inner(&pool).await.unwrap();
        assert_eq!(deleted, 0);
        cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn clear_inner_then_add_works_and_assigns_new_ids() {
        let (_dir, pool) = setup().await;
        insert_one_default(&pool, "SELECT 1").await;
        clear_history_inner(&pool).await.unwrap();
        // After VACUUM the table is clean — a new INSERT must succeed.
        let new_id = insert_one_default(&pool, "SELECT 2").await;
        assert!(new_id > 0);
        cleanup();
    }

    // ---------------- enum serde wire ----------------

    #[test]
    fn rdb_query_mode_serializes_lowercase() {
        let m = HistoryQueryMode::Rdb {
            query_mode: RdbQueryMode::Sql,
        };
        let json = serde_json::to_value(&m).unwrap();
        assert_eq!(json["paradigm"], "rdb");
        assert_eq!(json["queryMode"], "sql");
    }

    #[test]
    fn document_query_mode_serializes_camel_case() {
        let m = HistoryQueryMode::Document {
            query_mode: DocumentQueryMode::EstimatedDocumentCount,
        };
        let json = serde_json::to_value(&m).unwrap();
        assert_eq!(json["paradigm"], "document");
        assert_eq!(json["queryMode"], "estimatedDocumentCount");
    }

    #[test]
    fn document_query_mode_round_trip_for_all_variants() {
        let variants = [
            DocumentQueryMode::Find,
            DocumentQueryMode::FindOne,
            DocumentQueryMode::Aggregate,
            DocumentQueryMode::Count,
            DocumentQueryMode::EstimatedDocumentCount,
            DocumentQueryMode::Distinct,
            DocumentQueryMode::InsertOne,
            DocumentQueryMode::InsertMany,
            DocumentQueryMode::UpdateOne,
            DocumentQueryMode::UpdateMany,
            DocumentQueryMode::ReplaceOne,
            DocumentQueryMode::DeleteOne,
            DocumentQueryMode::DeleteMany,
            DocumentQueryMode::CreateIndex,
            DocumentQueryMode::DropIndex,
            DocumentQueryMode::BulkWrite,
        ];
        for v in variants {
            let mode = HistoryQueryMode::Document { query_mode: v };
            let json = serde_json::to_string(&mode).unwrap();
            let parsed: HistoryQueryMode = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed, mode);
        }
    }

    #[test]
    fn kv_and_search_query_modes_serialize_lowercase() {
        let kv = HistoryQueryMode::Kv {
            query_mode: KvQueryMode::Command,
        };
        let kv_json = serde_json::to_value(&kv).unwrap();
        assert_eq!(kv_json["paradigm"], "kv");
        assert_eq!(kv_json["queryMode"], "command");

        let search = HistoryQueryMode::Search {
            query_mode: SearchQueryMode::Dsl,
        };
        let search_json = serde_json::to_value(&search).unwrap();
        assert_eq!(search_json["paradigm"], "search");
        assert_eq!(search_json["queryMode"], "dsl");
    }

    #[test]
    fn all_four_paradigms_round_trip() {
        // AC 4 — the serde round trip is symmetric for all 4 paradigms:
        // the pre-existing rdb/document values plus the added kv/search.
        let modes = [
            HistoryQueryMode::Rdb {
                query_mode: RdbQueryMode::Sql,
            },
            HistoryQueryMode::Document {
                query_mode: DocumentQueryMode::Find,
            },
            HistoryQueryMode::Kv {
                query_mode: KvQueryMode::Command,
            },
            HistoryQueryMode::Search {
                query_mode: SearchQueryMode::Dsl,
            },
        ];
        for mode in modes {
            let json = serde_json::to_string(&mode).unwrap();
            let parsed: HistoryQueryMode = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed, mode);
        }
    }

    #[tokio::test]
    #[serial]
    async fn add_inner_persists_kv_and_search_paradigms() {
        let (_dir, pool) = setup().await;
        for (paradigm, query_mode, sql) in [
            ("kv", "command", "GET user:1"),
            ("search", "dsl", "{\"index\":\"logs\",\"body\":{}}"),
        ] {
            let req: AddHistoryEntryRequest = serde_json::from_value(serde_json::json!({
                "connectionId": "c-nonrdb",
                "paradigm": paradigm,
                "queryMode": query_mode,
                "source": "raw",
                "sql": sql,
                "status": "success",
                "durationMs": 1,
                "executedAt": now_ms(),
            }))
            .unwrap();
            let resp = add_history_entry_inner(&pool, req).await.unwrap();
            let row: (String, String) =
                sqlx::query_as("SELECT paradigm, query_mode FROM query_history WHERE id = ?")
                    .bind(resp.id)
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(row.0, paradigm);
            assert_eq!(row.1, query_mode);
        }
        cleanup();
    }

    #[test]
    fn history_query_mode_filter_rejects_paradigm_only_query_mode_pair() {
        // invalid: paradigm=rdb but queryMode=find. The discriminated union
        // only accepts RdbQueryMode under "rdb" and DocumentQueryMode under
        // "document"; cross-paradigm pairs fail serde.
        let bad = serde_json::json!({ "paradigm": "rdb", "queryMode": "find" });
        let r = serde_json::from_value::<HistoryQueryMode>(bad);
        assert!(r.is_err(), "rdb+find must be rejected by serde");
    }
}
