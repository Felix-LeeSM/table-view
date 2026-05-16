//! Sprint 359 (Phase 2 Q5.1 / Q5.2 / Q5.6) — per-tab connection affinity
//! lifecycle IPC commands.
//!
//! Lifecycle (per tab):
//! 1. Tab open      → no affinity entry yet (Q5.6 lazy).
//! 2. First query   → `bind_tab_affinity(connection_id, tab_id, server_pid)`
//!    stores the paradigm-native server pid (pg `pg_backend_pid()` /
//!    mysql `CONNECTION_ID()` / mongo opid materialised by the runner).
//! 3. Cancel        → `cancel_query_native(connection_id, server_pid)` fires
//!    a separate, paradigm-native ABORT against the server (handled in
//!    `commands::cancel_query`).
//! 4. Tab close     → `release_tab_connection(connection_id, tab_id)` drops
//!    the affinity entry. In a future hand-off this is where an
//!    in-flight transaction will be `ROLLBACK`-ed; the present sprint
//!    surfaces the IPC and removes the registry entry so the next reuse
//!    starts clean. The behaviour mirrors `release_cancel_token` —
//!    idempotent on an absent key.
//!
//! Out of scope for sprint-359: holding live `PoolConnection` handles and
//! issuing `ROLLBACK` against them. The strategy doc names that as a
//! follow-up; today's adapters route through a shared pool with no
//! long-lived borrow, and the affinity record is server-pid only.

use tauri::State;
use tracing::info;

use crate::commands::connection::{AppState, TabAffinity};
use crate::error::AppError;

/// Insert / replace the affinity record for `(connection_id, tab_id)`.
///
/// This is the inner pure function — `executeQuery` calls it after the
/// first round-trip resolves a real server pid. Tests use it directly to
/// avoid simulating a full IPC handshake.
pub async fn bind_tab_affinity_inner(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
    server_pid: i64,
) -> Result<(), AppError> {
    validate_keys(connection_id, tab_id)?;
    let mut map = state.tab_affinity.lock().await;
    map.insert(
        (connection_id.to_string(), tab_id.to_string()),
        TabAffinity { server_pid },
    );
    Ok(())
}

/// Drop the affinity record for `(connection_id, tab_id)`.
///
/// Returns `true` when an entry was removed and `false` when the key was
/// not present — both are valid lifecycles (tab close without any query
/// is the common idle path). Mirrors `release_cancel_token`'s no-op-on-
/// absent contract.
pub async fn release_tab_connection_inner(
    state: &AppState,
    connection_id: &str,
    tab_id: &str,
) -> Result<bool, AppError> {
    validate_keys(connection_id, tab_id)?;
    let mut map = state.tab_affinity.lock().await;
    let removed = map
        .remove(&(connection_id.to_string(), tab_id.to_string()))
        .is_some();
    if removed {
        info!(
            connection_id = %connection_id,
            tab_id = %tab_id,
            "Released tab affinity"
        );
    }
    Ok(removed)
}

fn validate_keys(connection_id: &str, tab_id: &str) -> Result<(), AppError> {
    if connection_id.trim().is_empty() {
        return Err(AppError::Validation("Connection ID cannot be empty".into()));
    }
    if tab_id.trim().is_empty() {
        return Err(AppError::Validation("Tab ID cannot be empty".into()));
    }
    Ok(())
}

/// IPC: release the tab's affinity record + (future) ROLLBACK its
/// in-flight transaction. See module doc for lifecycle.
#[tauri::command]
pub async fn release_tab_connection(
    state: State<'_, AppState>,
    connection_id: String,
    tab_id: String,
) -> Result<bool, AppError> {
    release_tab_connection_inner(state.inner(), &connection_id, &tab_id).await
}

#[cfg(test)]
mod tests {
    //! 작성 이유 (2026-05-16, sprint-359):
    //! - `bind_tab_affinity_inner` / `release_tab_connection_inner` 의
    //!   기초 lifecycle (insert / remove / idempotent on absent / input
    //!   validation) 를 unit-level 에서 고정한다. Live PG/MySQL/Mongo
    //!   integration 은 `tests/release_tab_connection_rollback.rs` 가
    //!   skip-on-no-container 패턴으로 별도 검증한다.

    use super::*;

    #[tokio::test]
    async fn bind_then_release_round_trip() {
        let state = AppState::new();
        bind_tab_affinity_inner(&state, "c", "t", 42).await.unwrap();
        // entry present
        assert!(state
            .tab_affinity
            .lock()
            .await
            .contains_key(&("c".to_string(), "t".to_string())));
        // release returns true
        let removed = release_tab_connection_inner(&state, "c", "t")
            .await
            .unwrap();
        assert!(removed, "released bind 한 entry 여야 한다");
        // gone
        assert!(state.tab_affinity.lock().await.is_empty());
    }

    #[tokio::test]
    async fn release_on_absent_returns_false_without_error() {
        // 빈 영속 (Q5.6 lazy) 상태에서 사용자가 tab 을 열기만 했다가 닫는
        // 흔한 path — 우리는 silent 에러로 처리한다 (release_cancel_token
        // 의 no-op-on-absent 와 일관).
        let state = AppState::new();
        let removed = release_tab_connection_inner(&state, "c", "t")
            .await
            .unwrap();
        assert!(!removed);
    }

    #[tokio::test]
    async fn bind_rejects_empty_connection_id() {
        let state = AppState::new();
        match bind_tab_affinity_inner(&state, "  ", "t", 1).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Connection ID"))
            }
            other => panic!("Expected Validation, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn bind_rejects_empty_tab_id() {
        let state = AppState::new();
        match bind_tab_affinity_inner(&state, "c", " ", 1).await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Tab ID"))
            }
            other => panic!("Expected Validation, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn release_rejects_empty_connection_id() {
        let state = AppState::new();
        match release_tab_connection_inner(&state, " ", "t").await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Connection ID"))
            }
            other => panic!("Expected Validation, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn release_rejects_empty_tab_id() {
        let state = AppState::new();
        match release_tab_connection_inner(&state, "c", "").await {
            Err(AppError::Validation(msg)) => {
                assert!(msg.contains("Tab ID"))
            }
            other => panic!("Expected Validation, got: {:?}", other),
        }
    }
}
