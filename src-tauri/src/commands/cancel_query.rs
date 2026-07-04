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

use tauri::State;
use tracing::{info, warn};

use crate::commands::connection::AppState;
use crate::commands::not_connected;
use crate::error::AppError;
pub use crate::error::CancelError;

/// Sprint 359 — wire-shape error returned from `cancel_query_native`.
///
/// Frontend uses the `type` discriminator to decide:
///   * `AlreadyCompleted` → silent (the user clicked Cancel after the
///     query had already finished, common race; surfacing a toast would
///     be noise).
///   * `PermissionDenied` → toast ("Cannot cancel — backend rejected the
///     request"). The PG error string is forwarded for advanced users.
///   * `NetworkError`     → toast with the underlying driver message.
///
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
/// `query_tag`, when present, routes through the adapter's tag-based cancel
/// (`cancel_query_by_tag`) instead of the pid path. Mongo uses this: the
/// opid is not client-visible, so the runner tags the op with
/// `command.comment == query_id` and the adapter resolves + `killOp`s it at
/// cancel time (Issue #1269). RDB adapters keep the pid path (`server_pid`
/// captured at executeQuery time via `query_server_pids`, Issue #1230).
pub async fn cancel_query_native_inner(
    state: &AppState,
    connection_id: &str,
    server_pid: i64,
    query_tag: Option<&str>,
) -> Result<(), CancelError> {
    if connection_id.trim().is_empty() {
        return Err(CancelError::NetworkError {
            message: "Connection ID cannot be empty".into(),
        });
    }
    // Issue #1087 — resolve the adapter through the short-lock `Arc` clone so
    // native cancel is never queued behind the long-running query it is meant
    // to abort (the query no longer holds `active_connections` across its
    // await).
    let active = state.active_adapter(connection_id).await.ok_or_else(|| {
        let msg = not_connected(connection_id).to_string();
        let fallback = CancelError::NetworkError {
            message: msg.clone(),
        };
        CancelError::AlreadyCompleted
            .pass_through_if_completion(&msg)
            .unwrap_or(fallback)
    })?;

    let outcome = match query_tag {
        Some(tag) => active.lifecycle().cancel_query_by_tag(tag).await,
        None => active.lifecycle().cancel_query(server_pid).await,
    };
    match outcome {
        Ok(()) => {
            info!(
                connection_id = %connection_id,
                server_pid = server_pid,
                query_tag = query_tag.unwrap_or(""),
                "Native cancel issued"
            );
            Ok(())
        }
        Err(app_err) => {
            warn!(
                connection_id = %connection_id,
                server_pid = server_pid,
                query_tag = query_tag.unwrap_or(""),
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

/// IPC entry — `cancel_query_native(connection_id, server_pid, query_id?)`.
///
/// `query_id` (Issue #1269) is the tag-based route for adapters without a
/// client-visible pid (Mongo): when present it wins over `server_pid`.
///
/// Returns `Ok(())` on success. Failure path surfaces `AppError::Cancel`,
/// which serialises as `{ "type": "Cancel", "payload": <CancelError> }`.
#[tauri::command]
pub async fn cancel_query_native(
    state: State<'_, AppState>,
    connection_id: String,
    server_pid: i64,
    query_id: Option<String>,
) -> Result<(), AppError> {
    match cancel_query_native_inner(
        state.inner(),
        &connection_id,
        server_pid,
        query_id.as_deref(),
    )
    .await
    {
        Ok(()) => Ok(()),
        Err(class) => Err(AppError::Cancel(class)),
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
        let r = cancel_query_native_inner(&state, "absent", 1234, None).await;
        assert!(matches!(r, Err(CancelError::AlreadyCompleted)));
    }

    #[tokio::test]
    async fn tag_route_on_unknown_connection_returns_already_completed() {
        // Issue #1269 — the Mongo tag route (query_id set) on a missing
        // connection is the same disconnect-then-cancel race → silent.
        let state = AppState::new();
        let r = cancel_query_native_inner(&state, "absent", 0, Some("q-tag")).await;
        assert!(matches!(r, Err(CancelError::AlreadyCompleted)));
    }

    #[tokio::test]
    async fn empty_connection_id_is_network_error() {
        // empty conn_id 는 frontend 가 코딩 실수한 경우 — toast 로 보임.
        let state = AppState::new();
        let r = cancel_query_native_inner(&state, "  ", 1, None).await;
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
