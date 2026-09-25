//! `datagrid_column_prefs` SQLite SOT IPC.
//!
//! 3 IPC, all SQLite-only (legacy localStorage is dropped at boot; low ROI
//! meant no import):
//!   - `set_datagrid_prefs` — partial patch. At least one of widths or
//!     hiddenColumns is required; if both are None the call fails with
//!     `AppError::Validation`. Fields not included keep the row's current
//!     value. A missing row is INSERTed (absent fields get the default
//!     `'{}'`/`'[]'`).
//!   - `get_datagrid_prefs` — when the row is missing, returns
//!     `{ widths: {}, hiddenColumns: [], updatedAt: null }`. The UI needs no
//!     exists check.
//!   - `reset_datagrid_prefs` — per-field dispatch:
//!       * `widths`         → UPDATE widths_json = '{}'
//!       * `hiddenColumns`  → UPDATE hidden_columns_json = '[]'
//!       * `all`            → DELETE row
//!
//!     The two affordances are independent; a widths reset never clears
//!     hidden columns or vice versa.
//!
//! When `legacy_imported != Done` every IPC is rejected with
//! `AppError::LegacyImportInProgress`. Strategy line 1189.
//!
//! The `*_inner` functions are responsible only for SQLite I/O: this module
//! never calls `emit_state_changed`, even though
//! `EventDomain::DatagridColumnPrefs` and `ResetField` exist in
//! `src/events.rs` — the emitters are `commands/history.rs`,
//! `commands/persist_mru.rs` and `commands/persist_settings.rs`. Integration
//! is covered by the three `tests/datagrid_prefs_*` files, which inspect the
//! SQLite state directly.

use crate::commands::connection::AppState;
use crate::commands::guard::guard_legacy_import_done;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::State;

// ---------------------------------------------------------------------------
// Wire types (strategy doc lines 692–727).
// ---------------------------------------------------------------------------

/// 5-tuple PK matching `datagrid_column_prefs` schema. RDB and Mongo fill
/// `db_name` / `namespace` differently — under the synonym-unification
/// decision the meaning differs per paradigm, but the wire position is the
/// same.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ColumnPrefsPk {
    pub connection_id: String,
    pub paradigm: String,
    pub db_name: String,
    pub namespace: String,
    pub table_name: String,
}

/// Partial patch — at least one of `widths` / `hidden_columns` must be `Some`.
/// If both are `None` the call fails with `AppError::Validation` 400.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetDatagridPrefsRequest {
    #[serde(flatten)]
    pub pk: ColumnPrefsPk,
    /// `Record<string, number>` — column id → px width. `Some({})` means
    /// explicitly empty widths (a reset). `None` means "this IPC does not
    /// touch widths".
    #[serde(default)]
    pub widths: Option<serde_json::Value>,
    /// `string[]` — list of hidden column ids. `Some([])` means explicitly
    /// cleared. `None` means "this IPC does not touch hidden".
    #[serde(default)]
    pub hidden_columns: Option<Vec<String>>,
}

/// `get_datagrid_prefs` response. When the row is missing it returns
/// `widths = {}`, `hidden_columns = []`, `updated_at = None` so the caller can
/// skip a separate "exists" check (strategy 720).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GetDatagridPrefsResponse {
    pub widths: serde_json::Value,
    pub hidden_columns: Vec<String>,
    pub updated_at: Option<i64>,
}

/// Field-scoped reset.
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
// `get_datagrid_prefs` — default response when the row is missing.
// ---------------------------------------------------------------------------

pub async fn get_datagrid_prefs_inner(
    pool: &SqlitePool,
    pk: ColumnPrefsPk,
) -> Result<GetDatagridPrefsResponse, AppError> {
    // Reads are not guarded — strategy line 1216 lists `get_*` reads as an
    // exception.
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
// `reset_datagrid_prefs` — per-field dispatch.
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
            // widths_json = '{}', hidden_columns_json kept. No-op when the
            // row is missing.
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
    //! Written 2026-05-16 — `--lib` coverage smoke.
    //!
    //! The integration scenarios (partial patch / field reset / get default)
    //! are owned by the three `tests/datagrid_prefs_*` files. This inline
    //! module locks only the camelCase serde of the wire types and the
    //! `ResetField` rename.

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

    // ---------------------------------------------------------------------
    // Written 2026-05-17 — baseline cleanup.
    //
    // The baseline measurement set does not include `tests/datagrid_prefs_*`,
    // so before these inline tests landed it covered only 22% of this
    // module's `_inner` functions. The tests below cover the happy paths plus
    // the reject path. The integration scenarios (the AC mapping) stay the
    // responsibility of `tests/datagrid_*` — this inline module is reached
    // directly through the `--lib` path of the baseline measurement set.
    // ---------------------------------------------------------------------
    use crate::storage::local;
    use crate::storage::meta::{set_legacy_import_state, LegacyImportState};
    use serial_test::serial;
    use tempfile::TempDir;

    async fn setup_pool() -> (TempDir, SqlitePool) {
        let dir = TempDir::new().unwrap();
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
        let pool = local::open_pool().await.unwrap();
        set_legacy_import_state(&pool, LegacyImportState::Done)
            .await
            .unwrap();
        (dir, pool)
    }

    fn cleanup_env() {
        std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
    }

    fn make_pk(table: &str) -> ColumnPrefsPk {
        ColumnPrefsPk {
            connection_id: "c".into(),
            paradigm: "rdb".into(),
            db_name: "db".into(),
            namespace: "public".into(),
            table_name: table.into(),
        }
    }

    #[tokio::test]
    #[serial]
    async fn set_inner_inserts_row_with_widths_only() {
        let (_dir, pool) = setup_pool().await;
        set_datagrid_prefs_inner(
            &pool,
            SetDatagridPrefsRequest {
                pk: make_pk("t1"),
                widths: Some(serde_json::json!({ "id": 80 })),
                hidden_columns: None,
            },
        )
        .await
        .unwrap();
        let widths: String = sqlx::query_scalar(
            "SELECT widths_json FROM datagrid_column_prefs WHERE table_name = 't1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(widths.contains("\"id\""));
        cleanup_env();
    }

    #[tokio::test]
    #[serial]
    async fn set_inner_empty_patch_rejects_with_validation() {
        let (_dir, pool) = setup_pool().await;
        let err = set_datagrid_prefs_inner(
            &pool,
            SetDatagridPrefsRequest {
                pk: make_pk("t-empty"),
                widths: None,
                hidden_columns: None,
            },
        )
        .await
        .unwrap_err();
        match err {
            crate::error::AppError::Validation(msg) => {
                assert!(msg.contains("widths"));
                assert!(msg.contains("hiddenColumns"));
            }
            other => panic!("Expected Validation, got {other:?}"),
        }
        cleanup_env();
    }

    #[tokio::test]
    #[serial]
    async fn get_inner_returns_default_when_row_missing() {
        let (_dir, pool) = setup_pool().await;
        let resp = get_datagrid_prefs_inner(&pool, make_pk("absent"))
            .await
            .unwrap();
        assert_eq!(resp.widths, serde_json::json!({}));
        assert!(resp.hidden_columns.is_empty());
        assert!(resp.updated_at.is_none());
        cleanup_env();
    }

    #[tokio::test]
    #[serial]
    async fn get_inner_round_trips_after_set() {
        let (_dir, pool) = setup_pool().await;
        set_datagrid_prefs_inner(
            &pool,
            SetDatagridPrefsRequest {
                pk: make_pk("rt"),
                widths: Some(serde_json::json!({ "a": 100, "b": 200 })),
                hidden_columns: Some(vec!["secret".into()]),
            },
        )
        .await
        .unwrap();
        let resp = get_datagrid_prefs_inner(&pool, make_pk("rt"))
            .await
            .unwrap();
        assert_eq!(resp.widths, serde_json::json!({ "a": 100, "b": 200 }));
        assert_eq!(resp.hidden_columns, vec!["secret".to_string()]);
        assert!(resp.updated_at.is_some());
        cleanup_env();
    }

    #[tokio::test]
    #[serial]
    async fn reset_inner_widths_only_preserves_hidden() {
        let (_dir, pool) = setup_pool().await;
        set_datagrid_prefs_inner(
            &pool,
            SetDatagridPrefsRequest {
                pk: make_pk("rw"),
                widths: Some(serde_json::json!({ "a": 1 })),
                hidden_columns: Some(vec!["h".into()]),
            },
        )
        .await
        .unwrap();
        reset_datagrid_prefs_inner(
            &pool,
            ResetDatagridPrefsRequest {
                pk: make_pk("rw"),
                field: ResetField::Widths,
            },
        )
        .await
        .unwrap();
        let resp = get_datagrid_prefs_inner(&pool, make_pk("rw"))
            .await
            .unwrap();
        assert_eq!(resp.widths, serde_json::json!({}));
        assert_eq!(resp.hidden_columns, vec!["h".to_string()]);
        cleanup_env();
    }

    #[tokio::test]
    #[serial]
    async fn reset_inner_hidden_only_preserves_widths() {
        let (_dir, pool) = setup_pool().await;
        set_datagrid_prefs_inner(
            &pool,
            SetDatagridPrefsRequest {
                pk: make_pk("rh"),
                widths: Some(serde_json::json!({ "a": 1 })),
                hidden_columns: Some(vec!["h".into()]),
            },
        )
        .await
        .unwrap();
        reset_datagrid_prefs_inner(
            &pool,
            ResetDatagridPrefsRequest {
                pk: make_pk("rh"),
                field: ResetField::HiddenColumns,
            },
        )
        .await
        .unwrap();
        let resp = get_datagrid_prefs_inner(&pool, make_pk("rh"))
            .await
            .unwrap();
        assert_eq!(resp.widths, serde_json::json!({ "a": 1 }));
        assert!(resp.hidden_columns.is_empty());
        cleanup_env();
    }

    #[tokio::test]
    #[serial]
    async fn reset_inner_all_deletes_row() {
        let (_dir, pool) = setup_pool().await;
        set_datagrid_prefs_inner(
            &pool,
            SetDatagridPrefsRequest {
                pk: make_pk("ra"),
                widths: Some(serde_json::json!({})),
                hidden_columns: Some(vec![]),
            },
        )
        .await
        .unwrap();
        reset_datagrid_prefs_inner(
            &pool,
            ResetDatagridPrefsRequest {
                pk: make_pk("ra"),
                field: ResetField::All,
            },
        )
        .await
        .unwrap();
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM datagrid_column_prefs WHERE table_name='ra'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, 0);
        cleanup_env();
    }

    #[tokio::test]
    #[serial]
    async fn set_inner_second_call_for_same_pk_updates_row_in_place() {
        // SQLite ON CONFLICT(pk) DO UPDATE — the second set must not create
        // a second row. The widths value must reflect the latest write.
        let (_dir, pool) = setup_pool().await;
        for w in [100, 200, 300] {
            set_datagrid_prefs_inner(
                &pool,
                SetDatagridPrefsRequest {
                    pk: make_pk("u"),
                    widths: Some(serde_json::json!({ "id": w })),
                    hidden_columns: None,
                },
            )
            .await
            .unwrap();
        }
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM datagrid_column_prefs WHERE table_name='u'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, 1, "ON CONFLICT must update in place");
        let resp = get_datagrid_prefs_inner(&pool, make_pk("u")).await.unwrap();
        assert_eq!(resp.widths, serde_json::json!({ "id": 300 }));
        cleanup_env();
    }
}
