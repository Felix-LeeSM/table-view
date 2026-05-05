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
        let error_status = ConnectionStatus::Error("Connection lost".into());
        {
            let state = app.state::<AppState>();
            let mut status = state.connection_status.lock().await;
            status.insert(conn_id.clone(), error_status.clone());
        }
        let _ = app.emit(
            "connection-status-changed",
            StatusChangeEvent {
                id: conn_id.clone(),
                status: error_status,
            },
        );

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

        let backoff = Duration::from_secs(2u64.pow(consecutive_failures - 1));
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
                {
                    let mut status = state.connection_status.lock().await;
                    status.insert(conn_id.clone(), ConnectionStatus::Connected);
                }
                let _ = app.emit(
                    "connection-status-changed",
                    StatusChangeEvent {
                        id: conn_id.clone(),
                        status: ConnectionStatus::Connected,
                    },
                );
                consecutive_failures = 0;
            }
            Err(e) => {
                warn!(conn_id = %conn_id, error = %e, "Reconnection failed");
                let err_status = ConnectionStatus::Error(format!("Reconnection failed: {}", e));
                let state = app.state::<AppState>();
                let mut status = state.connection_status.lock().await;
                status.insert(conn_id.clone(), err_status.clone());
                let _ = app.emit(
                    "connection-status-changed",
                    StatusChangeEvent {
                        id: conn_id.clone(),
                        status: err_status,
                    },
                );
            }
        }
    }
}
