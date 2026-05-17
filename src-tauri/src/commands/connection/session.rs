//! Sprint 209 — session id + keep-alive loop.
//!
//! Extracted from the 1710-line `commands/connection.rs` god file. Owns:
//!   - `get_session_id` Tauri command (with Sprint 175 `rust:first-ipc` boot
//!     timing emission via `FIRST_IPC_INSTANT`).
//!   - `keep_alive_loop` background task driven by `connect`.
//!   - `StatusChangeEvent` IPC payload.

use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{Emitter, Manager};
use tracing::{info, warn};

use super::{make_adapter, AppState};
use crate::error::AppError;
use crate::models::{ConnectionConfig, ConnectionStatus};

#[derive(Clone, Serialize)]
pub(super) struct StatusChangeEvent {
    id: String,
    status: ConnectionStatus,
}

/// Emit `connection-status-changed` with warn-on-failure.
///
/// `app.emit` returning `Err` is almost always benign — it means no
/// listener (e.g. the workspace window was closed before the keep-alive
/// task noticed). The frontend repulls status on focus, so the missed
/// event self-corrects. We log a `warn!` instead of swallowing silently
/// so a true regression (serializer panic, IPC bus tear-down) is
/// observable in the boot log rather than vanishing into a `let _`.
fn emit_status_change(app: &tauri::AppHandle, conn_id: &str, status: ConnectionStatus) {
    if let Err(e) = app.emit(
        "connection-status-changed",
        StatusChangeEvent {
            id: conn_id.to_string(),
            status,
        },
    ) {
        warn!(
            conn_id = %conn_id,
            error = %e,
            "Failed to emit connection-status-changed (likely no listener)"
        );
    }
}

/// Sprint 237 P5 (2026-05-08) — exponential backoff for the keep-alive
/// reconnection loop, hoisted as a pure helper so the schedule (1s, 2s,
/// 4s for attempts 1, 2, 3) can be unit-tested without standing up the
/// full Tauri runtime.
///
/// `attempt` is 1-based (`consecutive_failures` after increment). The
/// `attempt - 1` underflow guard returns `Duration::ZERO` for attempt 0
/// — the production path always passes ≥1 but defensive zero handling
/// keeps the helper total.
pub(crate) fn backoff_for_attempt(attempt: u32) -> Duration {
    if attempt == 0 {
        return Duration::ZERO;
    }
    Duration::from_secs(2u64.pow(attempt - 1))
}

/// Sprint 175 — captured once on the very first `get_session_id` call. The
/// delta `rust:first-ipc - rust:entry` is the "Tauri startup overhead" line
/// item in `docs/sprints/sprint-175/baseline.md`. `OnceLock::set` returns
/// `Ok(())` only on the first call, guaranteeing the `info!` line is emitted
/// exactly once regardless of how many windows race to invoke this command.
static FIRST_IPC_INSTANT: OnceLock<Instant> = OnceLock::new();

/// Return the process-scoped session UUID. Both launcher and workspace windows
/// receive the same value, which the frontend uses to tag localStorage entries
/// so stale data from a previous app run is automatically ignored.
#[tauri::command]
pub async fn get_session_id(state: tauri::State<'_, AppState>) -> Result<String, AppError> {
    // Sprint 175 — `rust:first-ipc`. `set` is atomic and returns `Ok(())`
    // only on the first call across all threads/windows; later invocations
    // see `Err(_)` and skip the log emission. The delta is computed against
    // `crate::BOOT_T0` (set in `lib.rs::run()`) when available; if the
    // static is not yet populated we still emit the literal token so the
    // log scraper never sees a silent gap.
    let now = Instant::now();
    if FIRST_IPC_INSTANT.set(now).is_ok() {
        let delta_ms = crate::BOOT_T0
            .get()
            .map(|t0| now.duration_since(*t0).as_secs_f64() * 1000.0);
        info!(
            target: "boot",
            "rust:first-ipc cmd=get_session_id delta_ms={:?}",
            delta_ms,
        );
    }
    Ok(state.session_id.clone())
}

/// Background task: periodically ping the connection and auto-reconnect on failure.
pub(super) async fn keep_alive_loop(
    app: tauri::AppHandle,
    conn_id: String,
    interval_secs: u64,
    config: ConnectionConfig,
) {
    let mut consecutive_failures = 0u32;
    let max_retries = 3u32;

    loop {
        tokio::time::sleep(Duration::from_secs(interval_secs)).await;

        // Ping check — dispatch through the paradigm-neutral lifecycle trait.
        let ping_ok = {
            let state = app.state::<AppState>();
            let connections = state.active_connections.lock().await;
            match connections.get(&conn_id) {
                Some(adapter) => adapter.lifecycle().ping().await.is_ok(),
                None => return, // Adapter removed — task should stop
            }
        };

        if ping_ok {
            consecutive_failures = 0;
            continue;
        }

        warn!(conn_id = %conn_id, "Keep-alive ping failed");

        // Set error status
        let error_status = ConnectionStatus::Error {
            message: "Connection lost".into(),
        };
        {
            let state = app.state::<AppState>();
            let mut status = state.connection_status.lock().await;
            status.insert(conn_id.clone(), error_status.clone());
        }
        emit_status_change(&app, &conn_id, error_status);

        // Attempt reconnect with exponential backoff
        consecutive_failures += 1;
        if consecutive_failures > max_retries {
            warn!(
                conn_id = %conn_id,
                retries = max_retries,
                "Max reconnection attempts reached"
            );
            return; // Stop keep-alive task
        }

        let backoff = backoff_for_attempt(consecutive_failures);
        info!(
            conn_id = %conn_id,
            attempt = consecutive_failures,
            backoff_secs = backoff.as_secs(),
            "Attempting reconnection"
        );
        tokio::time::sleep(backoff).await;

        // Try reconnect — rebuild via the factory so adapter paradigm tracks
        // `DatabaseType` changes instead of being hard-coded here.
        let new_adapter = match make_adapter(&config.db_type) {
            Ok(a) => a,
            Err(e) => {
                warn!(
                    conn_id = %conn_id,
                    error = %e,
                    "Reconnection aborted: adapter factory rejected db_type"
                );
                return;
            }
        };
        match new_adapter.lifecycle().connect(&config).await {
            Ok(()) => {
                info!(conn_id = %conn_id, "Reconnected successfully");
                let state = app.state::<AppState>();
                {
                    let mut connections = state.active_connections.lock().await;
                    connections.insert(conn_id.clone(), new_adapter);
                }
                // Sprint 364 — reconnect 도 connect 와 동일하게 active_db 를
                // config.database 로 seed. 빈 문자열일 때만 None.
                let active_db = if config.database.is_empty() {
                    None
                } else {
                    Some(config.database.clone())
                };
                let connected = ConnectionStatus::Connected { active_db };
                {
                    let mut status = state.connection_status.lock().await;
                    status.insert(conn_id.clone(), connected.clone());
                }
                emit_status_change(&app, &conn_id, connected);
                consecutive_failures = 0;
            }
            Err(e) => {
                warn!(conn_id = %conn_id, error = %e, "Reconnection failed");
                let err_status = ConnectionStatus::Error {
                    message: format!("Reconnection failed: {}", e),
                };
                {
                    let state = app.state::<AppState>();
                    let mut status = state.connection_status.lock().await;
                    status.insert(conn_id.clone(), err_status.clone());
                }
                emit_status_change(&app, &conn_id, err_status);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    //! 작성 이유 (2026-05-08, Sprint 237 P5): `keep_alive_loop` 본체는
    //! `tauri::AppHandle` / `app.emit` / `app.state` 에 강하게 결합돼
    //! 단위 테스트가 어렵다. backoff schedule 만 pure helper 로 분리해
    //! 1s/2s/4s 의 exponential 진행과 attempt=0 underflow 방어를 격리
    //! 검증. `StatusChangeEvent` 의 wire shape 도 frontend 가 의존하는
    //! `id` / `status` 필드 이름을 회귀 가드.
    use super::*;

    #[test]
    fn backoff_attempt_one_returns_one_second() {
        assert_eq!(backoff_for_attempt(1), Duration::from_secs(1));
    }

    #[test]
    fn backoff_attempt_two_returns_two_seconds() {
        assert_eq!(backoff_for_attempt(2), Duration::from_secs(2));
    }

    #[test]
    fn backoff_attempt_three_returns_four_seconds() {
        assert_eq!(backoff_for_attempt(3), Duration::from_secs(4));
    }

    #[test]
    fn backoff_attempt_zero_short_circuits_to_zero() {
        // attempt=0 은 production path 에서 발생하지 않지만 (`consecutive_failures`
        // 가 +1 후에야 호출), `2u64.pow(0u32.wrapping_sub(1))` 같은 underflow
        // 를 막는 방어 분기.
        assert_eq!(backoff_for_attempt(0), Duration::ZERO);
    }

    #[test]
    fn status_change_event_serde_uses_id_and_status_camel_case_keys() {
        // frontend 가 `connection-status-changed` payload 에서 `id`/`status`
        // 두 키만 본다 — variant 가 추가될 때 wire shape 가 깨지지 않도록.
        // Sprint 364 (2026-05-16) — `Connected` 가 struct variant 로 승격됐으므로
        // `active_db: None` 으로 생성.
        let evt = StatusChangeEvent {
            id: "abc".into(),
            status: ConnectionStatus::Connected { active_db: None },
        };
        let json = serde_json::to_string(&evt).unwrap();
        assert!(json.contains("\"id\":\"abc\""));
        assert!(json.contains("\"status\""));
    }

    // ---------------------------------------------------------------------
    // 작성 2026-05-17 — sprint-376 직후 baseline cleanup.
    //
    // `get_session_id` 는 keep_alive_loop / emit_status_change 외에 본 모듈에서
    // cover 가능한 entry point. `emit_status_change` 는 production `Wry` 런타임에
    // hard-bind 되어 있어 MockRuntime 으로는 호출 불가 (다른 sprint commit 의
    // 시그니처를 본 cleanup 으로는 generic 화하지 않음 — boundary 룰).
    //
    // 8 원칙:
    //   - Happy: get_session_id state 의 session_id 그대로 echo.
    //   - 멱등: 두 번째 호출도 같은 값 — FIRST_IPC_INSTANT OnceLock 가 1회만 set.
    //   - 동시성: 같은 state 를 두 호출이 봐도 racy 변화 0 (immutable session_id).
    // ---------------------------------------------------------------------
    use crate::commands::connection::AppState;
    use tauri::test::{mock_builder, mock_context, noop_assets};
    use tauri::Manager;

    fn make_mock_app() -> tauri::App<tauri::test::MockRuntime> {
        mock_builder()
            .build(mock_context(noop_assets()))
            .expect("mock app build")
    }

    #[test]
    fn get_session_id_returns_state_session_id() {
        let app = make_mock_app();
        let app_state = AppState::new();
        let expected = app_state.session_id.clone();
        app.handle().manage(app_state);

        // `get_session_id` is an async fn — drive it through the tauri async
        // runtime (the test cfg picks the tokio backend on tauri's side).
        let state: tauri::State<'_, AppState> = app.handle().state();
        let actual = tauri::async_runtime::block_on(get_session_id(state)).unwrap();
        assert_eq!(actual, expected);
    }

    #[test]
    fn get_session_id_is_idempotent_across_calls() {
        let app = make_mock_app();
        let app_state = AppState::new();
        let session = app_state.session_id.clone();
        app.handle().manage(app_state);

        let a = {
            let s: tauri::State<'_, AppState> = app.handle().state();
            tauri::async_runtime::block_on(get_session_id(s)).unwrap()
        };
        let b = {
            let s: tauri::State<'_, AppState> = app.handle().state();
            tauri::async_runtime::block_on(get_session_id(s)).unwrap()
        };
        assert_eq!(a, b);
        assert_eq!(a, session);
    }
}
