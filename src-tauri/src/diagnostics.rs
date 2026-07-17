//! Diagnostics — file log sink (#1564).
//!
//! Packaged builds lose every `tracing` line: a macOS `.app` launched from
//! Finder has stdout/stderr wired to /dev/null, and Windows'
//! `#![windows_subsystem = "windows"]` (`main.rs`) detaches the console. With
//! no remote telemetry (ADR 0036 — zero collection; logs stay on the user's
//! own machine), a local rotating file is the only channel for diagnosing a
//! user bug report after the fact.
//!
//! This module owns the two testable seams — `log_dir()` (where the files
//! live) and `file_writer()` (a non-blocking, daily-rotating appender). The
//! subscriber composition itself stays in `run()` because it installs the
//! process-global default exactly once, which a unit test cannot re-do.

use std::path::{Path, PathBuf};
use tracing_appender::non_blocking::{NonBlocking, WorkerGuard};

/// Directory that holds the rotating diagnostic log files.
///
/// Rooted under the same `table-view` folder the rest of storage uses
/// (`storage::app_data_dir` → `dirs::data_local_dir().join("table-view")`)
/// rather than Tauri's `app.path().app_log_dir()`, on purpose:
/// 1. init stays on the pre-builder critical path — no need to wait for
///    `app.path()` — so even a `build`/`run` failure in `run()` is captured;
/// 2. one discoverable folder when a user zips up their data + logs for a
///    bug report.
///
/// `dirs` is already a direct dependency (Cargo.toml). Falls back to the OS
/// temp dir only if no data dir resolves, so init never hard-fails.
pub fn log_dir() -> PathBuf {
    dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .unwrap_or_else(std::env::temp_dir)
        .join("table-view")
        .join("logs")
}

/// Build a non-blocking, daily-rotating file writer rooted at `dir`.
///
/// Returns the `MakeWriter` half plus its `WorkerGuard`. The guard MUST be
/// kept alive for the lifetime of the process (or the test scope): dropping
/// it flushes and shuts down the background writer thread, after which every
/// later log line is silently dropped.
///
/// ponytail: default `non_blocking` is lossy once its buffer fills, and a
/// `std::process::exit` skips the guard's flush — so the two fatal
/// build/run-failure lines in `run()` may not reach the file (they still hit
/// stderr). Acceptable ceiling for a diagnostics sink; a synchronous
/// pre-exit flush is the upgrade path if those lines prove load-bearing.
/// Rotation is daily with no built-in file-count cap — see PR follow-up.
pub fn file_writer(dir: &Path) -> std::io::Result<(NonBlocking, WorkerGuard)> {
    std::fs::create_dir_all(dir)?;
    let appender = tracing_appender::rolling::daily(dir, "table-view.log");
    Ok(tracing_appender::non_blocking(appender))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tracing_subscriber::prelude::*;

    // Purpose: prove the #1564 file log sink actually persists `tracing`
    // lines to disk — the regression this feature fixes is "packaged app
    // logs evaporate", so the single load-bearing fact is "a log line routed
    // through the file layer lands in a file under the target dir".
    // Phase diagnostics — issue #1564 (2026-07-17).

    // Reason: without this sink an `info!`/`warn!`/`error!` in a Finder-
    // launched `.app` reaches no file at all; assert a marker line survives
    // through the non-blocking appender into a tempdir file (2026-07-17).
    #[test]
    fn test_file_writer_persists_log_line_to_dir() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (writer, guard) = file_writer(tmp.path()).expect("file_writer");

        // Route logs through a *local* subscriber (not the process-global
        // one, which other tests may already own) so this stays isolated (P3).
        let subscriber = tracing_subscriber::registry().with(
            tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_writer(writer),
        );
        tracing::subscriber::with_default(subscriber, || {
            tracing::info!(target: "boot", "diag-file-sink-marker-1564");
        });

        // Drop flushes + shuts down the background writer thread; the bytes
        // are on disk after this returns — no sleep, deterministic (P5).
        drop(guard);

        let mut found = false;
        for entry in std::fs::read_dir(tmp.path()).expect("read_dir") {
            let path = entry.expect("dir entry").path();
            let contents = std::fs::read_to_string(&path).unwrap_or_default();
            if contents.contains("diag-file-sink-marker-1564") {
                found = true;
                break;
            }
        }
        assert!(
            found,
            "expected the marker line in a log file under {:?}",
            tmp.path()
        );
    }

    // Reason: log_dir must land under the shared `table-view` storage root so
    // a user's bug-report bundle has data + logs in one place (2026-07-17).
    #[test]
    fn test_log_dir_is_under_table_view_logs() {
        let dir = log_dir();
        assert!(dir.ends_with("table-view/logs"), "got {dir:?}");
    }
}
