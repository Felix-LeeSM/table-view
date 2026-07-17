//! Sprint 209 — session id + keep-alive loop.
//!
//! Extracted from the 1710-line `commands/connection.rs` god file. Owns:
//!   - `get_session_id` Tauri command (with Sprint 175 `rust:first-ipc` boot
//!     timing emission via `FIRST_IPC_INSTANT`).
//!   - `keep_alive_loop` background task driven by `connect`.
//!   - `StatusChangeEvent` IPC payload.

use std::sync::Arc;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{Emitter, Manager};
use tracing::{info, warn};

use super::{make_adapter, AppState};
use crate::db::ActiveAdapter;
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

/// Issue #1560 — install a freshly *reconnected* adapter for `conn_id` under
/// the per-connection lifecycle guard, WITHOUT touching `keep_alive_handles`.
///
/// The caller is the keep-alive task itself, so aborting/replacing its own
/// handle would be suicide. Instead the handle's presence is read purely as a
/// liveness signal: `disconnect` removes it (under the same guard) as the first
/// step of tearing a connection down. So if the handle is gone by the time we
/// hold the guard, a concurrent `disconnect` already won — installing now would
/// resurrect an orphan live adapter under a `Disconnected` status (session
/// leak + the reconnect↔disconnect race in #1560). In that case the freshly
/// built `adapter` is `disconnect()`-ed and `false` is returned so the caller
/// stops instead of emitting `Connected`.
///
/// Otherwise the adapter is swapped in, any displaced predecessor is
/// `disconnect()`-ed (the #1100 leak class the raw `insert` reintroduced on the
/// reconnect path), the `Connected` status is recorded atomically under the
/// guard, and `true` is returned. Mirrors `connect`/`install_connection`
/// (guard held across the map swaps + status transition).
async fn reconnect_swap(
    state: &AppState,
    conn_id: &str,
    adapter: Arc<ActiveAdapter>,
    connected_status: ConnectionStatus,
) -> bool {
    let _guard = state.connection_guard(conn_id).await;

    let still_registered = state.keep_alive_handles.lock().await.contains_key(conn_id);
    if !still_registered {
        if let Err(e) = adapter.lifecycle().disconnect().await {
            warn!(
                conn_id = %conn_id,
                error = %e,
                "Failed to disconnect reconnect adapter after concurrent disconnect"
            );
        }
        return false;
    }

    let displaced = state
        .active_connections
        .lock()
        .await
        .insert(conn_id.to_string(), adapter);
    if let Some(old) = displaced {
        if let Err(e) = old.lifecycle().disconnect().await {
            warn!(
                conn_id = %conn_id,
                error = %e,
                "Failed to disconnect displaced adapter during reconnect"
            );
        }
    }

    state
        .connection_status
        .lock()
        .await
        .insert(conn_id.to_string(), connected_status);
    true
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
        // Issue #1087 — clone the adapter `Arc` under a short lock so the ping
        // await does not hold `active_connections` (which would block queries
        // and cancels on this connection).
        let ping_ok = {
            let state = app.state::<AppState>();
            match state.active_adapter(&conn_id).await {
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
                // Sprint 364 — reconnect 도 connect 와 동일하게 active_db 를
                // config.database 로 seed. 빈 문자열일 때만 None.
                let active_db = if config.database.is_empty() {
                    None
                } else {
                    Some(config.database.clone())
                };
                let connected = ConnectionStatus::Connected { active_db };
                // Issue #1560 — swap under `connection_guard` so the reconnect
                // never interleaves with connect/disconnect, and bail out if a
                // concurrent disconnect already tore this connection down (a
                // raw `insert` here resurrected an orphan live adapter with a
                // `Disconnected` status). `reconnect_swap` records the
                // `Connected` status atomically under the same guard.
                if !reconnect_swap(&state, &conn_id, Arc::new(new_adapter), connected.clone()).await
                {
                    return;
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

    // ---------------------------------------------------------------------
    // Issue #1560 — keep-alive reconnect must go through `connection_guard`
    // and never resurrect a torn-down connection. Uses the shared
    // `StubRdbAdapter` fake to count teardowns without a real DB (same
    // pattern as `crud::tests::connect_race`).
    // ---------------------------------------------------------------------
    mod reconnect_race {
        use super::*;
        use crate::db::testing::StubRdbAdapter;
        use crate::db::ActiveAdapter;
        use crate::models::ConnectionStatus;
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;

        /// Fake adapter whose `disconnect()` bumps `counter` — lets a test
        /// assert an adapter was actually torn down (no leaked session).
        fn counting_adapter(counter: Arc<AtomicUsize>) -> Arc<ActiveAdapter> {
            let stub = StubRdbAdapter {
                disconnect_fn: Some(Box::new(move || {
                    counter.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                })),
                ..StubRdbAdapter::default()
            };
            Arc::new(ActiveAdapter::Rdb(Box::new(stub)))
        }

        fn plain_adapter() -> Arc<ActiveAdapter> {
            Arc::new(ActiveAdapter::Rdb(Box::new(StubRdbAdapter::default())))
        }

        fn connected() -> ConnectionStatus {
            ConnectionStatus::Connected { active_db: None }
        }

        /// A reconnect that completes *after* `disconnect` already removed the
        /// keep-alive handle must NOT resurrect the connection: no adapter is
        /// inserted (no orphan live session) and the freshly built adapter is
        /// torn down. RED against the pre-fix raw `insert`, which left an
        /// orphan `active_connections` entry marked `Connected`.
        #[tokio::test]
        async fn reconnect_after_disconnect_leaves_no_orphan() {
            let state = AppState::new();
            let disconnects = Arc::new(AtomicUsize::new(0));

            // Simulate `disconnect` having already run: under `connection_guard`
            // it removed the keep-alive handle (the liveness signal) and the
            // adapter, so both maps are empty for c1.
            let installed = reconnect_swap(
                &state,
                "c1",
                counting_adapter(disconnects.clone()),
                connected(),
            )
            .await;

            assert!(
                !installed,
                "must skip install once the connection was torn down"
            );
            assert!(
                state.active_connections.lock().await.is_empty(),
                "no orphan live adapter may be resurrected"
            );
            assert_eq!(
                disconnects.load(Ordering::SeqCst),
                1,
                "the freshly built reconnect adapter must be disconnect()-ed"
            );
            assert!(
                state.connection_status.lock().await.get("c1").is_none(),
                "a torn-down connection must not be flipped back to Connected"
            );
        }

        /// A normal reconnect (handle still registered) swaps the adapter in,
        /// `disconnect()`s the displaced predecessor (no session leak), and
        /// records `Connected` — all under the guard. RED against the raw
        /// `insert`, which dropped the predecessor without `disconnect()`
        /// (`disconnects == 0`).
        #[tokio::test]
        async fn reconnect_swaps_and_tears_down_predecessor() {
            let state = AppState::new();
            let disconnects = Arc::new(AtomicUsize::new(0));

            // A live keep-alive handle for c1 = the connection is still up.
            let handle = tokio::spawn(std::future::pending::<()>());
            state
                .keep_alive_handles
                .lock()
                .await
                .insert("c1".into(), handle);
            // A live predecessor adapter (whose ping just failed).
            state
                .active_connections
                .lock()
                .await
                .insert("c1".into(), counting_adapter(disconnects.clone()));

            let installed = reconnect_swap(&state, "c1", plain_adapter(), connected()).await;

            assert!(
                installed,
                "a live connection must accept the reconnected adapter"
            );
            assert_eq!(
                state.active_connections.lock().await.len(),
                1,
                "exactly one adapter remains after the swap"
            );
            assert_eq!(
                disconnects.load(Ordering::SeqCst),
                1,
                "the displaced predecessor adapter must be disconnect()-ed once"
            );
            assert!(
                matches!(
                    state.connection_status.lock().await.get("c1"),
                    Some(ConnectionStatus::Connected { .. })
                ),
                "reconnect must record Connected under the guard"
            );

            // Clean up the pending keep-alive handle spawned above.
            let leftover = state.keep_alive_handles.lock().await.remove("c1");
            if let Some(h) = leftover {
                h.abort();
            }
        }
    }
}
