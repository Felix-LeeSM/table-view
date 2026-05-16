//! Sprint 359 (Phase 2 Q5.3 / Q5.5) — paradigm-native cancel IPC.
//!
//! The pre-existing `cancel_query(query_id)` command (in
//! `commands::rdb::query::cancel_query`) cancels a tokio `CancellationToken`
//! that the in-process executor races against the query. That works for
//! cooperative paths (sqlx `select!`-cancel observes the token between
//! row pulls) but the server keeps the actual statement running until the
//! current row drain finishes — which can mean minutes for `SELECT
//! pg_sleep(60)`-style queries.
//!
//! This sprint adds `cancel_query_native(connection_id, server_pid)`,
//! which routes through `DbAdapter::cancel_query(server_pid)`:
//!
//! * PG    → opens a separate connection and runs
//!   `SELECT pg_cancel_backend(<pid>)`.
//! * MySQL → opens a side connection and runs `KILL QUERY <thread_id>`.
//! * Mongo → `db.adminCommand({killOp: 1, op: <opid>})` (live wire from
//!   sprint-336).
//!
//! Failure classification (Q5.5) lives in [`classify_cancel_error`].
//!
//! ## Backwards compatibility
//!
//! The legacy `cancel_query(query_id)` command stays — it still races the
//! cooperative `CancellationToken` registry, which is sufficient for short
//! schema-introspection paths. The new `cancel_query_native` is what
//! TablePlus-style "Stop running query" UI fires for user-typed queries.

use serde::{Deserialize, Serialize};
use tauri::State;
use tracing::{info, warn};

use crate::commands::connection::AppState;
use crate::commands::not_connected;
use crate::error::AppError;

/// Sprint 359 — wire-shape error returned from `cancel_query_native`.
///
/// Frontend uses the `type` discriminator to decide:
///   * `AlreadyCompleted` → silent (the user clicked Cancel after the
///     query had already finished, common race; surfacing a toast would
///     be noise).
///   * `PermissionDenied` → toast ("Cannot cancel — backend rejected the
///     request"). The PG error string is forwarded for advanced users.
///   * `NetworkError`     → toast with the underlying driver message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum CancelError {
    AlreadyCompleted,
    PermissionDenied { message: String },
    NetworkError { message: String },
}

impl std::fmt::Display for CancelError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CancelError::AlreadyCompleted => f.write_str("Cancel: query already completed"),
            CancelError::PermissionDenied { message } => {
                write!(f, "Cancel: permission denied ({message})")
            }
            CancelError::NetworkError { message } => {
                write!(f, "Cancel: network error ({message})")
            }
        }
    }
}

impl std::error::Error for CancelError {}

/// Classify a free-form driver error message into the three
/// front-end-facing buckets (Q5.5).
///
/// Pattern matching is best-effort substring detection on the lowercased
/// message — sqlx / mysql_async / mongodb crates each surface different
/// wording but their permission / completion / network paths use
/// recognisable keywords. The default for unknown messages is
/// `NetworkError` so the user is still informed (silent suppression is
/// reserved for the explicit completion path).
pub fn classify_cancel_error(message: &str) -> CancelError {
    let lower = message.to_ascii_lowercase();
    if lower.contains("permission")
        || lower.contains("not permitted")
        || lower.contains("not authorized")
    {
        return CancelError::PermissionDenied {
            message: message.to_string(),
        };
    }
    if lower.contains("already completed")
        || lower.contains("no such process")
        || lower.contains("unknown thread")
        || lower.contains("not found")
        || lower.contains("not running")
    {
        return CancelError::AlreadyCompleted;
    }
    CancelError::NetworkError {
        message: message.to_string(),
    }
}

/// Inner implementation — looks up the affinity record, dispatches to the
/// adapter's `cancel_query`, then surfaces the result with classification.
/// Returns `Ok(())` on success, `Err(CancelError)` otherwise.
///
/// `server_pid_override` lets the caller bypass the affinity lookup when
/// they already know the pid (typical Mongo flow: the runner exposes the
/// opid mid-query, and the cancel IPC reads it from the user-visible UI).
pub async fn cancel_query_native_inner(
    state: &AppState,
    connection_id: &str,
    server_pid: i64,
) -> Result<(), CancelError> {
    if connection_id.trim().is_empty() {
        return Err(CancelError::NetworkError {
            message: "Connection ID cannot be empty".into(),
        });
    }
    let connections = state.active_connections.lock().await;
    let active = connections.get(connection_id).ok_or_else(|| {
        let msg = not_connected(connection_id).to_string();
        let fallback = CancelError::NetworkError {
            message: msg.clone(),
        };
        CancelError::AlreadyCompleted
            .pass_through_if_completion(&msg)
            .unwrap_or(fallback)
    })?;

    match active.lifecycle().cancel_query(server_pid).await {
        Ok(()) => {
            info!(
                connection_id = %connection_id,
                server_pid = server_pid,
                "Native cancel issued"
            );
            Ok(())
        }
        Err(app_err) => {
            warn!(
                connection_id = %connection_id,
                server_pid = server_pid,
                error = %app_err,
                "Native cancel failed"
            );
            Err(classify_cancel_error(&app_err.to_string()))
        }
    }
}

impl CancelError {
    fn pass_through_if_completion(self, msg: &str) -> Option<CancelError> {
        let lower = msg.to_ascii_lowercase();
        if lower.contains("not found") {
            Some(CancelError::AlreadyCompleted)
        } else {
            None
        }
    }
}

/// IPC entry — `cancel_query_native(connection_id, server_pid)`.
///
/// Returns `Ok(())` on success. Failure path serialises a `CancelError`
/// JSON object: `{ "type": "AlreadyCompleted" | "PermissionDenied" |
/// "NetworkError", "message"?: string }`. We map this to `AppError`'s
/// string-only shape via Display so the existing Tauri command result
/// surface stays consistent — frontend wrapper unmarshals the JSON
/// shape from the string (see `src/lib/tauri/cancel.ts`).
#[tauri::command]
pub async fn cancel_query_native(
    state: State<'_, AppState>,
    connection_id: String,
    server_pid: i64,
) -> Result<(), AppError> {
    match cancel_query_native_inner(state.inner(), &connection_id, server_pid).await {
        Ok(()) => Ok(()),
        Err(class) => {
            // Wire format: serialise the CancelError as JSON and wrap in
            // AppError::Database so the existing Tauri error channel
            // delivers it. The frontend wrapper parses the JSON.
            let json = serde_json::to_string(&class).unwrap_or_else(|_| class.to_string());
            Err(AppError::Database(json))
        }
    }
}

#[cfg(test)]
mod tests {
    //! 작성 이유 (2026-05-16, sprint-359):
    //! - `cancel_query_native_inner` 의 connection 미존재 path / classify
    //!   helper 분기 / `CancelError` JSON wire-shape 의 unit-level
    //!   gating. live cancel timing 은 cancel_pg/cancel_mysql/cancel_mongo
    //!   통합 테스트가 별도로 다룬다.

    use super::*;

    #[tokio::test]
    async fn unknown_connection_returns_already_completed() {
        // 미등록 connection 으로 cancel 시도하면 race 상황으로 보고
        // AlreadyCompleted 로 분류 → frontend silent. NotFound 와는
        // 별도 — 이쪽은 사용자가 disconnect 후 cancel 누른 경우.
        let state = AppState::new();
        let r = cancel_query_native_inner(&state, "absent", 1234).await;
        assert!(matches!(r, Err(CancelError::AlreadyCompleted)));
    }

    #[tokio::test]
    async fn empty_connection_id_is_network_error() {
        // empty conn_id 는 frontend 가 코딩 실수한 경우 — toast 로 보임.
        let state = AppState::new();
        let r = cancel_query_native_inner(&state, "  ", 1).await;
        assert!(matches!(r, Err(CancelError::NetworkError { .. })));
    }

    #[test]
    fn classify_unknown_is_network() {
        let c = classify_cancel_error("wild west wire fault");
        assert!(matches!(c, CancelError::NetworkError { .. }));
    }

    #[test]
    fn classify_permission_case_insensitive() {
        let c = classify_cancel_error("ERROR: not authorized to kill backend");
        assert!(matches!(c, CancelError::PermissionDenied { .. }));
    }

    #[test]
    fn cancel_error_display_round_trip() {
        let e = CancelError::PermissionDenied {
            message: "x".into(),
        };
        assert!(e.to_string().contains("permission denied"));
        let e2 = CancelError::NetworkError {
            message: "y".into(),
        };
        assert!(e2.to_string().contains("network error"));
        assert!(CancelError::AlreadyCompleted
            .to_string()
            .contains("already completed"));
    }
}
