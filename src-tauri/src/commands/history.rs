//! Sprint 371 (Phase 5 F.5) — `query_history` backend IPC surface.
//!
//! 4 IPC + 1 boot helper:
//!   - `add_history_entry`  — INSERT one row, computes `sql_redacted`
//!     (regex masking), validates discriminated union (paradigm/queryMode)
//!     + executedAt drift (|now - executedAt| > 5min → backend override).
//!   - `list_history`       — paginated rows, NEVER returns `sql`. Filter
//!     union enforces paradigm/queryMode pairing; `tabId` requires
//!     `connectionId`. `limit` defaults 100, clamped 500.
//!   - `get_history_detail` — single row `{id, sql, sqlRedacted}` — the
//!     only path that returns the original SQL.
//!   - `clear_history`      — BEGIN→COUNT→DELETE→COMMIT, then VACUUM
//!     (transaction 밖 — SQLite 제약), emits `history.clear`, returns
//!     `{deletedCount}`.
//!   - `boot_vacuum_old_history` — retention policy (drop rows older
//!     than `settings.query_history_retention_days`). Function-level
//!     unit test (AC-371-10); boot wire is sprint-373.
//!
//! Strategy doc F.5 (line 535–605) — privacy invariants:
//!   - `sql_redacted NOT NULL` — `sql_redact()` 가 panic 시 원문 fallback.
//!   - list 응답 어디에도 `sql` 부재.
//!   - detail IPC 가 단일 row id 만 — bulk dump path 0.
//!   - VACUUM 은 transaction 분리 (SQLite 가 mid-tx VACUUM 거부).

use crate::commands::connection::AppState;
use crate::commands::guard::guard_legacy_import_done;
use crate::error::AppError;
use crate::events::{emit_state_changed, EmitArgs, EventDomain, EventOp, EventVersionRegistry};
use crate::storage::sql_redact::sql_redact;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::{AppHandle, Runtime, State};
use tracing::warn;

// ---------------------------------------------------------------------------
// Discriminated union — paradigm + queryMode pair.
// ---------------------------------------------------------------------------

/// `paradigm` + `queryMode` discriminated union 으로 invalid pair 를 serde
/// 단계에서 reject (AC-371-01). RDB 는 SQL only, document(Mongo) 는 query
/// builder family 만 허용.
///
/// Wire 예시 (camelCase):
///   `{ "paradigm": "rdb",      "queryMode": "sql" }`
///   `{ "paradigm": "document", "queryMode": "find" }`
///   `{ "paradigm": "document", "queryMode": "aggregate" }`
///
/// Invalid 예시 (serde reject → 400):
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
}

/// RDB paradigm 의 허용 query mode. 현재 "sql" 만.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RdbQueryMode {
    Sql,
}

/// Document paradigm 의 허용 query mode. mongosh 명령 family.
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
    DeleteOne,
    DeleteMany,
    BulkWrite,
}

impl HistoryQueryMode {
    fn paradigm_str(&self) -> &'static str {
        match self {
            Self::Rdb { .. } => "rdb",
            Self::Document { .. } => "document",
        }
    }

    fn query_mode_str(&self) -> &'static str {
        match self {
            Self::Rdb { query_mode } => match query_mode {
                RdbQueryMode::Sql => "sql",
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
                DocumentQueryMode::DeleteOne => "deleteOne",
                DocumentQueryMode::DeleteMany => "deleteMany",
                DocumentQueryMode::BulkWrite => "bulkWrite",
            },
        }
    }
}

/// Filter 의 discriminated union — list/filter 도 paradigm 없이 queryMode 만
/// 지정하면 400 (AC-371-02). 본 enum 의 외부 wire shape 은 `HistoryQueryMode`
/// 와 동일.
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
}

impl HistoryQueryModeFilter {
    fn paradigm_str(&self) -> &'static str {
        match self {
            Self::Rdb { .. } => "rdb",
            Self::Document { .. } => "document",
        }
    }

    fn query_mode_str(&self) -> Option<&'static str> {
        match self {
            Self::Rdb { query_mode } => query_mode.as_ref().map(|q| match q {
                RdbQueryMode::Sql => "sql",
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
                DocumentQueryMode::DeleteOne => "deleteOne",
                DocumentQueryMode::DeleteMany => "deleteMany",
                DocumentQueryMode::BulkWrite => "bulkWrite",
            }),
        }
    }
}

// ---------------------------------------------------------------------------
// add_history_entry
// ---------------------------------------------------------------------------

/// query_history INSERT 의 wire shape. Frontend 의 history.recordExecution
/// 분기에서 호출.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddHistoryEntryRequest {
    pub connection_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab_id: Option<String>,
    /// paradigm + queryMode discriminated union — invalid combo 는 serde
    /// 단계에서 reject.
    #[serde(flatten)]
    pub mode: HistoryQueryMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collection: Option<String>,
    /// `raw` / `grid-edit` / 기타 frontend 가 라벨링한 trigger source.
    pub source: String,
    /// 원본 SQL / mongosh 표현. backend 가 `sql_redact()` 호출.
    pub sql: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows_affected: Option<i64>,
    pub duration_ms: i64,
    /// 사용자 시계로 측정된 execution start time (unix ms). backend 가
    /// `|now - executed_at| > 5min` 검증 후 drift 시 backend now 로 override
    /// (AC-371-09).
    pub executed_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_pid: Option<i64>,
}

/// `add_history_entry` 응답 — caller 가 detail fetch / store reconcile 에
/// 사용할 row id (AUTOINCREMENT INTEGER).
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
    // → backend now override + dev warning. Frontend clock 이 사용자 OS
    // 시계 변경 / NTP 동기화 실패 등으로 wildly off 인 경우의 안전망.
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

    let sql_redacted = sql_redact(&req.sql);
    let paradigm = req.mode.paradigm_str();
    let query_mode = req.mode.query_mode_str();

    // INSERT 단일 row. id 는 AUTOINCREMENT — `last_insert_rowid()` 로 회수.
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
    .bind(&req.sql)
    .bind(&sql_redacted)
    .bind(&req.status)
    .bind(&req.error_message)
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
    /// connectionId filter — `tabId` 가 있으면 본 필드 필수 (AC-371-03).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab_id: Option<String>,
    /// Filter union — paradigm 없이 queryMode 단독은 reject.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter: Option<HistoryQueryModeFilter>,
    /// Cursor pagination — `Some(id)` 이면 id < cursor 인 row 만 (executed_at
    /// DESC, id DESC 정렬과 호환).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<i64>,
    /// Page size. None → 100. > 500 → 500 으로 clamp.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<i64>,
}

/// list 응답의 row — `sql` 필드 **부재** (AC-371-05). `sqlRedacted` 만 노출.
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
    /// 다음 페이지 cursor — `rows.last().id` 또는 None (rows 비었거나 page
    /// 끝).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<i64>,
}

pub async fn list_history_inner(
    pool: &SqlitePool,
    req: ListHistoryRequest,
) -> Result<ListHistoryResponse, AppError> {
    // AC-371-03 — tabId 가 있으면 connectionId 필수. workspace 안의 tab 은
    // connection 컨텍스트가 필수이므로 이 제약은 시맨틱 invariant.
    if req.tab_id.is_some() && req.connection_id.is_none() {
        return Err(AppError::Validation(
            "list_history: tabId requires connectionId".into(),
        ));
    }

    // AC-371-04 — limit clamp. None → 100. negative/zero 는 default 로 fall
    // back (시맨틱 buggy input 보호). 500 초과는 잘림.
    let limit = match req.limit {
        Some(v) if v > 0 => v.min(MAX_LIMIT),
        _ => DEFAULT_LIMIT,
    };

    // Filter 의 paradigm/queryMode pair 를 SQL 절로 변환. paradigm 단독은
    // OK (paradigm = 'rdb' / 'document' 만 필터). queryMode 단독은 위 enum
    // 의 union 정의로 serde 단계에서 reject — list_history_inner 까지 도달
    // 불가.
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

    // ORDER BY id DESC — AUTOINCREMENT id 가 monotonically increasing 이라
    // 입력 순서 (= execute 순서) 와 1:1 correlate. cursor pagination 의
    // `id < cursor` 절이 (executed_at, id) 복합 키 비교 없이 단순 정렬을
    // 보장하므로 안정적인 next_cursor 가 가능. 사용자 시계가 NTP 동기화로
    // 뒤로 점프해도 (executed_at 가 dup 되는 edge case) id 가 tiebreak.
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
            database: t.5,
            collection: t.6,
            source: t.7,
            sql_redacted: t.8,
            status: t.9,
            error_message: t.10,
            rows_affected: t.11,
            duration_ms: t.12,
            executed_at: t.13,
            server_pid: t.14,
        }
    }
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

/// detail 응답 — 정확히 3 키 (`id`, `sql`, `sqlRedacted`). bulk dump path
/// 가 0 이므로 단일 row id 만 받는다.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryDetailResponse {
    pub id: i64,
    pub sql: String,
    pub sql_redacted: String,
}

pub async fn get_history_detail_inner(
    pool: &SqlitePool,
    req: GetHistoryDetailRequest,
) -> Result<HistoryDetailResponse, AppError> {
    let row: Option<(i64, String, String)> =
        sqlx::query_as("SELECT id, sql, sql_redacted FROM query_history WHERE id = ?")
            .bind(req.id)
            .fetch_optional(pool)
            .await?;
    match row {
        Some((id, sql, sql_redacted)) => Ok(HistoryDetailResponse {
            id,
            sql,
            sql_redacted,
        }),
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

/// AC-371-07 의 invariant:
///   1. BEGIN — transaction open.
///   2. COUNT — pre-delete row 수 read (반환값).
///   3. DELETE — 모든 query_history row 제거.
///   4. COMMIT — transaction close (VACUUM 의 prerequisite).
///   5. VACUUM — transaction 밖. SQLite 가 mid-transaction VACUUM 거부.
///
/// Step 5 의 VACUUM 은 best-effort — DB lock 등으로 실패해도 deleted_count
/// 응답은 정상 반환. user-visible 영향 0 (다음 boot 의 boot_vacuum_old_history
/// 가 mop-up).
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

    // VACUUM — transaction 분리 (SQLite 제약). DB lock / busy 등으로
    // 실패해도 caller 의 deletedCount 응답은 유지.
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

/// Retention 정책 단위. `settings.query_history_retention_days` 값을
/// `i64` ms 로 환산해 `executed_at < now - retention_days` 인 row 를 삭제.
/// 본 함수의 wire-up (boot 호출 site, e2e 검증) 은 sprint-373 책임 —
/// 본 sprint 는 function-level 단위 테스트만 잠근다.
///
/// `retention_days` 가 0 이하면 no-op (사용자가 "무한 보관" 으로 설정한
/// 경우). 정상 path 는 1~365 사이.
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
    //! 작성 2026-05-17 (Phase 5 sprint-371) — `boot_vacuum_old_history` 의
    //! function-level 단위 테스트 (AC-371-10). Wire 시나리오 (4 IPC) 는
    //! `tests/history_*.rs` 통합 테스트가 책임.

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
}
