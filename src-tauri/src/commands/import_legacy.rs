//! Sprint 355 (Phase 1) — `import_legacy_localstorage` IPC.
//!
//! Strategy 1140–1180 의 LegacyPayload shape 을 받아 SQLite 에 1회 import.
//! 4-state transition (pending → importing → done | failed) 을 `meta` table
//! 로 추적. Idempotent — 이미 `done` 이면 no-op.
//!
//! Phase 1 시점에는 schema 만 적용된 상태라 backend 가 받는 도메인은
//! `favorites` / `mru` 두 종만 우선 wire. 나머지 (connections / groups /
//! settings / workspaces / theme / safeMode) 는 sprint-358+ 의 dual-write
//! 단계에서 추가. **`pending → done` 전이는 빈 payload 도 인정**.
//!
//! In Scope (sprint-355): IPC 시그니처, 4-state transition, idempotent guard,
//! 최소 2 도메인 (favorites/mru) row insert.

use crate::commands::connection::AppState;
use crate::error::AppError;
use crate::storage::meta::{get_legacy_import_state, set_legacy_import_state, LegacyImportState};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::State;
use tracing::{info, warn};

// ---------------------------------------------------------------------------
// Payload — Strategy line 1156–1160 의 frontend 송신 shape (camelCase).
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyFavorite {
    pub id: String,
    pub name: String,
    pub sql: String,
    #[serde(default)]
    pub connection_id: Option<String>,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyMruEntry {
    pub connection_id: String,
    pub last_used: i64,
}

/// Strategy 1156: 실제 LS shape — `table-view-favorites` (array JSON),
/// `table-view-mru` (array JSON). 다른 LS key (workspaces / theme / safeMode)
/// 는 sprint-358+ 에서 추가.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyPayload {
    #[serde(default)]
    pub favorites: Option<Vec<LegacyFavorite>>,
    #[serde(default)]
    pub mru: Option<Vec<LegacyMruEntry>>,
}

// ---------------------------------------------------------------------------
// Inner (testable, pool-keyed). Tauri command wraps and supplies the pool.
// ---------------------------------------------------------------------------

/// Idempotent legacy LS import. 4-state transition:
/// - state == Done → no-op (return Ok)
/// - state == Pending → transition Importing → apply payload → Done (또는 Failed on err)
/// - state == Importing → 동시 호출 직렬화 — 결과적으로 마지막 호출이 Done 으로 정착
/// - state == Failed → 같은 path (재시도 — retry path 가 boot-time 일 수 있으나
///   run-time 재호출도 안전)
///
/// 실패 시 state 를 Failed 로 set + 원인 error 전파.
pub async fn import_legacy_localstorage_inner(
    pool: &SqlitePool,
    payload: LegacyPayload,
) -> Result<(), AppError> {
    let current = get_legacy_import_state(pool).await?;
    if current == LegacyImportState::Done {
        info!(target: "legacy_import", "import already done — no-op");
        return Ok(());
    }

    set_legacy_import_state(pool, LegacyImportState::Importing).await?;

    match apply_payload(pool, &payload).await {
        Ok(()) => {
            set_legacy_import_state(pool, LegacyImportState::Done).await?;
            info!(
                target: "legacy_import",
                favorites = payload.favorites.as_ref().map(|v| v.len()).unwrap_or(0),
                mru = payload.mru.as_ref().map(|v| v.len()).unwrap_or(0),
                "legacy import completed"
            );
            Ok(())
        }
        Err(e) => {
            // best-effort: set Failed then propagate the original error.
            // 사유: 첫 import 실패 후 다음 boot 의 재시도 path 가 동작하려면
            // state 가 Failed 로 명시되어 있어야 한다 (boot 시 retry 진입 신호).
            if let Err(set_err) = set_legacy_import_state(pool, LegacyImportState::Failed).await {
                warn!(
                    target: "legacy_import",
                    error = %set_err,
                    "failed to record Failed state after import error"
                );
            }
            Err(e)
        }
    }
}

async fn apply_payload(pool: &SqlitePool, payload: &LegacyPayload) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    if let Some(favs) = &payload.favorites {
        for (idx, f) in favs.iter().enumerate() {
            sqlx::query(
                "INSERT OR REPLACE INTO favorites \
                 (id, name, sql, connection_id, sort_order, created_at, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&f.id)
            .bind(&f.name)
            .bind(&f.sql)
            .bind(&f.connection_id)
            .bind(idx as i64)
            .bind(if f.created_at > 0 {
                f.created_at
            } else {
                now_ms
            })
            .bind(if f.updated_at > 0 {
                f.updated_at
            } else {
                now_ms
            })
            .execute(&mut *tx)
            .await?;
        }
    }

    if let Some(mru) = &payload.mru {
        for entry in mru {
            sqlx::query("INSERT OR REPLACE INTO mru(connection_id, last_used) VALUES (?, ?)")
                .bind(&entry.connection_id)
                .bind(entry.last_used)
                .execute(&mut *tx)
                .await?;
        }
    }

    tx.commit().await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri command — wraps `_inner`. Pool 은 `AppState` 가 보유 (sprint-357 에서
// 정식 hookup). Phase 1 첫 sprint 는 IPC 시그니처와 4-state 동작만 wire 하고
// pool 은 OnceCell 로 lazy init.
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn import_legacy_localstorage(
    payload: LegacyPayload,
    _state: State<'_, AppState>,
) -> Result<(), AppError> {
    let pool = crate::commands::sqlite_pool::get_or_init_pool().await?;
    import_legacy_localstorage_inner(&pool, payload).await
}
