//! Sprint 369 (Phase 4) — `datagrid_column_prefs` SQLite SOT IPC.
//!
//! 3 IPC, 모두 SQLite-only (legacy LS 는 boot 시 drop, ROI 낮아 import 0):
//!   - `set_datagrid_prefs` — partial patch. widths 또는 hiddenColumns 중
//!     하나 이상 필수, 둘 다 None 이면 `AppError::Validation`. 미포함 필드는
//!     row 의 기존 값 유지. row 가 없으면 INSERT (미포함 필드 default
//!     `'{}'`/`'[]'`).
//!   - `get_datagrid_prefs` — row 없음 시
//!     `{ widths: {}, hiddenColumns: [], updatedAt: null }`. UI 가 exists
//!     check 불필요.
//!   - `reset_datagrid_prefs` — field 별 분기:
//!       * `widths`         → UPDATE widths_json = '{}'
//!       * `hiddenColumns`  → UPDATE hidden_columns_json = '[]'
//!       * `all`            → DELETE row
//!
//!     codex 7차 #1 — 두 affordance 독립; widths reset 이 hidden 풀거나 반대 0.
//!
//! `legacy_imported != Done` 이면 모든 IPC 가 `AppError::LegacyImportInProgress`
//! 로 reject. Strategy 라인 1189.
//!
//! event emit (datagridColumnPrefs / update / reset) 은 Tauri command 의
//! AppHandle 경유로 후속 sprint 가 wiring — `*_inner` 함수는 SQLite I/O 만
//! 책임. integration 은 `tests/datagrid_prefs_*` 3 파일이 SQLite 상태를
//! 직접 검사.

use crate::commands::connection::AppState;
use crate::commands::guard::guard_legacy_import_done;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::State;

// ---------------------------------------------------------------------------
// Wire types (strategy doc lines 692–727).
// ---------------------------------------------------------------------------

/// 5-tuple PK matching `datagrid_column_prefs` schema. `db_name` /
/// `namespace` 는 RDB 와 Mongo 가 서로 다르게 채움 — codex 7차 #2 동의어 통일
/// 결정에 따라 paradigm 별 의미가 다르지만 wire 위치는 같다.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ColumnPrefsPk {
    pub connection_id: String,
    pub paradigm: String,
    pub db_name: String,
    pub namespace: String,
    pub table_name: String,
}

/// Partial patch — `widths` 또는 `hidden_columns` 중 하나 이상이 `Some` 이어야
/// 한다. 둘 다 `None` 이면 `AppError::Validation` 400 (codex 8차 #5).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetDatagridPrefsRequest {
    #[serde(flatten)]
    pub pk: ColumnPrefsPk,
    /// `Record<string, number>` — column id → px width. `Some({})` 는 명시적
    /// 빈 widths (reset 의도). `None` 은 "이 IPC 에선 widths 안 건드림".
    #[serde(default)]
    pub widths: Option<serde_json::Value>,
    /// `string[]` — 숨김 column id 목록. `Some([])` 는 명시적 비움. `None` 은
    /// "이 IPC 에선 hidden 안 건드림".
    #[serde(default)]
    pub hidden_columns: Option<Vec<String>>,
}

/// `get_datagrid_prefs` 응답. row 가 없으면 `widths = {}`, `hidden_columns = []`,
/// `updated_at = None` 으로 채워서 반환 — 호출자가 별도의 "exists" check 를
/// 피할 수 있게 (strategy 720).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GetDatagridPrefsResponse {
    pub widths: serde_json::Value,
    pub hidden_columns: Vec<String>,
    pub updated_at: Option<i64>,
}

/// Field-scoped reset (codex 7차 #1).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ResetField {
    Widths,
    HiddenColumns,
    All,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetDatagridPrefsRequest {
    #[serde(flatten)]
    pub pk: ColumnPrefsPk,
    pub field: ResetField,
}

// ---------------------------------------------------------------------------
// `set_datagrid_prefs` — partial patch UPSERT.
// ---------------------------------------------------------------------------

pub async fn set_datagrid_prefs_inner(
    pool: &SqlitePool,
    req: SetDatagridPrefsRequest,
) -> Result<(), AppError> {
    guard_legacy_import_done(pool).await?;

    if req.widths.is_none() && req.hidden_columns.is_none() {
        return Err(AppError::Validation(
            "at least one of widths/hiddenColumns required".into(),
        ));
    }

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let widths_json_opt: Option<String> = match &req.widths {
        Some(v) => Some(serde_json::to_string(v)?),
        None => None,
    };
    let hidden_json_opt: Option<String> = match &req.hidden_columns {
        Some(v) => Some(serde_json::to_string(v)?),
        None => None,
    };

    // INSERT or, on PK conflict, UPDATE only the columns that the caller
    // actually provided. `COALESCE(?, column)` keeps the missing field at
    // its existing value (or default for first INSERT).
    //
    // Note: SQLite's `INSERT ... ON CONFLICT(...) DO UPDATE` clause cannot
    // reference both the bind param AND the existing column inside the
    // `UPDATE` set list directly in a portable way — we use the
    // `excluded.*` pseudo-table for the conflict path, and pre-bind
    // explicit defaults (`'{}'` / `'[]'`) for the INSERT path. The
    // `excluded.widths_json` value is either the caller-supplied JSON
    // (when `Some`) or the same default literal, which then gets merged
    // via `CASE WHEN ? IS NULL` so the existing row's column is
    // preserved when the caller omitted the field.
    sqlx::query(
        "INSERT INTO datagrid_column_prefs \
            (connection_id, paradigm, db_name, namespace, table_name, \
             widths_json, hidden_columns_json, updated_at) \
         VALUES (?, ?, ?, ?, ?, COALESCE(?, '{}'), COALESCE(?, '[]'), ?) \
         ON CONFLICT(connection_id, paradigm, db_name, namespace, table_name) \
         DO UPDATE SET \
            widths_json = COALESCE(?, datagrid_column_prefs.widths_json), \
            hidden_columns_json = COALESCE(?, datagrid_column_prefs.hidden_columns_json), \
            updated_at = excluded.updated_at",
    )
    .bind(&req.pk.connection_id)
    .bind(&req.pk.paradigm)
    .bind(&req.pk.db_name)
    .bind(&req.pk.namespace)
    .bind(&req.pk.table_name)
    .bind(widths_json_opt.as_deref())
    .bind(hidden_json_opt.as_deref())
    .bind(now_ms)
    // ON CONFLICT update bind sites — both COALESCE inputs.
    .bind(widths_json_opt.as_deref())
    .bind(hidden_json_opt.as_deref())
    .execute(pool)
    .await?;

    Ok(())
}

#[tauri::command]
pub async fn set_datagrid_prefs(
    req: SetDatagridPrefsRequest,
    _state: State<'_, AppState>,
) -> Result<(), AppError> {
    let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
    set_datagrid_prefs_inner(&pool, req).await
}

// ---------------------------------------------------------------------------
// `get_datagrid_prefs` — row 없음 시 default 응답.
// ---------------------------------------------------------------------------

pub async fn get_datagrid_prefs_inner(
    pool: &SqlitePool,
    pk: ColumnPrefsPk,
) -> Result<GetDatagridPrefsResponse, AppError> {
    // read 는 guard 적용하지 않음 — strategy line 1216 ("예외: ... get_* read")
    let row: Option<(String, String, i64)> = sqlx::query_as(
        "SELECT widths_json, hidden_columns_json, updated_at \
         FROM datagrid_column_prefs \
         WHERE connection_id = ? AND paradigm = ? AND db_name = ? \
               AND namespace = ? AND table_name = ?",
    )
    .bind(&pk.connection_id)
    .bind(&pk.paradigm)
    .bind(&pk.db_name)
    .bind(&pk.namespace)
    .bind(&pk.table_name)
    .fetch_optional(pool)
    .await?;

    match row {
        None => Ok(GetDatagridPrefsResponse {
            widths: serde_json::json!({}),
            hidden_columns: Vec::new(),
            updated_at: None,
        }),
        Some((widths_json, hidden_json, updated_at)) => {
            let widths: serde_json::Value =
                serde_json::from_str(&widths_json).unwrap_or_else(|_| serde_json::json!({}));
            let hidden_columns: Vec<String> =
                serde_json::from_str(&hidden_json).unwrap_or_default();
            Ok(GetDatagridPrefsResponse {
                widths,
                hidden_columns,
                updated_at: Some(updated_at),
            })
        }
    }
}

#[tauri::command]
pub async fn get_datagrid_prefs(
    pk: ColumnPrefsPk,
    _state: State<'_, AppState>,
) -> Result<GetDatagridPrefsResponse, AppError> {
    let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
    get_datagrid_prefs_inner(&pool, pk).await
}

// ---------------------------------------------------------------------------
// `reset_datagrid_prefs` — field 별 분기.
// ---------------------------------------------------------------------------

pub async fn reset_datagrid_prefs_inner(
    pool: &SqlitePool,
    req: ResetDatagridPrefsRequest,
) -> Result<(), AppError> {
    guard_legacy_import_done(pool).await?;

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let pk = &req.pk;
    match req.field {
        ResetField::Widths => {
            // widths_json = '{}', hidden_columns_json 유지. row 가 없으면 no-op.
            sqlx::query(
                "UPDATE datagrid_column_prefs \
                 SET widths_json = '{}', updated_at = ? \
                 WHERE connection_id = ? AND paradigm = ? AND db_name = ? \
                       AND namespace = ? AND table_name = ?",
            )
            .bind(now_ms)
            .bind(&pk.connection_id)
            .bind(&pk.paradigm)
            .bind(&pk.db_name)
            .bind(&pk.namespace)
            .bind(&pk.table_name)
            .execute(pool)
            .await?;
        }
        ResetField::HiddenColumns => {
            sqlx::query(
                "UPDATE datagrid_column_prefs \
                 SET hidden_columns_json = '[]', updated_at = ? \
                 WHERE connection_id = ? AND paradigm = ? AND db_name = ? \
                       AND namespace = ? AND table_name = ?",
            )
            .bind(now_ms)
            .bind(&pk.connection_id)
            .bind(&pk.paradigm)
            .bind(&pk.db_name)
            .bind(&pk.namespace)
            .bind(&pk.table_name)
            .execute(pool)
            .await?;
        }
        ResetField::All => {
            sqlx::query(
                "DELETE FROM datagrid_column_prefs \
                 WHERE connection_id = ? AND paradigm = ? AND db_name = ? \
                       AND namespace = ? AND table_name = ?",
            )
            .bind(&pk.connection_id)
            .bind(&pk.paradigm)
            .bind(&pk.db_name)
            .bind(&pk.namespace)
            .bind(&pk.table_name)
            .execute(pool)
            .await?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn reset_datagrid_prefs(
    req: ResetDatagridPrefsRequest,
    _state: State<'_, AppState>,
) -> Result<(), AppError> {
    let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
    reset_datagrid_prefs_inner(&pool, req).await
}

#[cfg(test)]
mod tests {
    //! 작성 2026-05-16 (Phase 4 sprint-369) — `--lib` coverage smoke.
    //!
    //! 통합 시나리오 (partial patch / field reset / get default) 는
    //! `tests/datagrid_prefs_*` 3 파일이 담당. 본 inline 은 wire type 의
    //! camelCase serde + ResetField rename 만 잠근다.

    use super::*;

    #[test]
    fn column_prefs_pk_serializes_camel_case() {
        let pk = ColumnPrefsPk {
            connection_id: "c1".into(),
            paradigm: "rdb".into(),
            db_name: "db".into(),
            namespace: "public".into(),
            table_name: "users".into(),
        };
        let json = serde_json::to_string(&pk).unwrap();
        assert!(json.contains("connectionId"));
        assert!(json.contains("paradigm"));
        assert!(json.contains("dbName"));
        assert!(json.contains("namespace"));
        assert!(json.contains("tableName"));
    }

    #[test]
    fn reset_field_serializes_camel_case_tags() {
        assert_eq!(
            serde_json::to_string(&ResetField::Widths).unwrap(),
            "\"widths\""
        );
        assert_eq!(
            serde_json::to_string(&ResetField::HiddenColumns).unwrap(),
            "\"hiddenColumns\""
        );
        assert_eq!(serde_json::to_string(&ResetField::All).unwrap(), "\"all\"");
    }

    #[test]
    fn get_response_defaults_serialize_with_empty_object_and_empty_array() {
        let r = GetDatagridPrefsResponse {
            widths: serde_json::json!({}),
            hidden_columns: Vec::new(),
            updated_at: None,
        };
        let json = serde_json::to_value(&r).unwrap();
        assert_eq!(json["widths"], serde_json::json!({}));
        assert_eq!(json["hiddenColumns"], serde_json::json!([]));
        assert_eq!(json["updatedAt"], serde_json::Value::Null);
    }
}
