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

/// Newest N daily log files to retain (#1620 F2). Daily rotation with no cap
/// grows unbounded; the appender prunes older files past this count on each
/// rotation. 14 days is enough history for a post-hoc bug report while bounding
/// disk use.
const MAX_LOG_FILES: usize = 14;

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
/// ponytail: default `non_blocking` is lossy once its buffer fills. The two
/// fatal build/run-failure `process::exit(1)` paths in `run()` now drop the
/// `WorkerGuard` before exiting so their last line is flushed (#1620 F2).
/// Rotation is daily and capped at `MAX_LOG_FILES` newest files (#1620 F2), so
/// the sink no longer grows unbounded.
///
/// Every failure path returns `Err` (no panic): `run()` routes that to a
/// stdout-only degrade so a read-only fs / disk-full / ENFILE never aborts
/// boot. This is why we drive the rolling appender via `Builder::build`
/// (which returns a `Result`) instead of `rolling::daily`, whose internal
/// `.expect` would panic on the same failures.
pub fn file_writer(dir: &Path) -> std::io::Result<(NonBlocking, WorkerGuard)> {
    std::fs::create_dir_all(dir)?;
    // Logs persist host:port / schema names / paths / error fragments, so the
    // directory must not be world-readable. Match the project's 0o600-file /
    // 0o700-dir convention (storage/crypto.rs, local.rs, key_migration.rs).
    // The daily appender re-creates files without a hook, so a per-file 0o600
    // would miss tomorrow's file — a 0o700 dir gates every file inside it and
    // is rotation-proof.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    let appender = tracing_appender::rolling::Builder::new()
        .rotation(tracing_appender::rolling::Rotation::DAILY)
        .filename_prefix("table-view.log")
        .max_log_files(MAX_LOG_FILES)
        .build(dir)
        .map_err(std::io::Error::other)?;
    Ok(tracing_appender::non_blocking(appender))
}

/// Route every process panic through `tracing` (`target: "panic"`) with a
/// forced backtrace, then chain the previously-installed hook so dev stderr
/// output is preserved.
///
/// Why (#1565): the default panic handler writes to stderr only. A macOS
/// `.app` launched from Finder wires stderr to /dev/null and Windows'
/// `windows_subsystem = "windows"` detaches the console, so a panic in one of
/// `run()`'s detached boot tasks (lib.rs `tauri::async_runtime::spawn` — no
/// join) vanishes with no trace. Teeing panics into the `tracing` pipeline
/// lands them in the #1564 rotating file sink, the only post-hoc channel with
/// no remote telemetry (ADR 0036).
///
/// `Backtrace::force_capture` ignores `RUST_BACKTRACE`, so frames are present
/// even in a release build that never set the env var — no forced env needed.
///
/// ponytail: an *unwind* panic (default profile — Cargo.toml sets no
/// `panic="abort"`) keeps the process alive, so the non-blocking file writer's
/// worker thread drains this line normally; only a panic that terminates the
/// process before the async worker flushes (same class as the `run()`
/// `process::exit` edge) can lose it. Not worth a synchronous flush here.
pub fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        tracing::error!(
            target: "panic",
            "{info}\n{}",
            std::backtrace::Backtrace::force_capture()
        );
        // Chain the prior hook so `cargo tauri dev` still prints the panic to
        // stderr and the process's normal abort/unwind message is unchanged.
        default_hook(info);
    }));
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

    // Reason (review B1) — logs persist host:port / schema names / paths /
    // error fragments, so the dir must be owner-only (0o700), matching the
    // project's 0o600-file / 0o700-dir convention. Rotation re-creates files
    // without a hook, so gating the *dir* is the rotation-proof control
    // (2026-07-17).
    #[cfg(unix)]
    #[test]
    fn test_file_writer_makes_log_dir_owner_only_0o700() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().expect("tempdir");
        let dir = tmp.path().join("logs");
        let (_writer, _guard) = file_writer(&dir).expect("file_writer");
        let mode = std::fs::metadata(&dir)
            .expect("metadata")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o700, "log dir must be owner-only, got {mode:o}");
    }

    // A `MakeWriter` sink into a shared buffer so a *local* subscriber can read
    // back exactly what the panic hook emitted, without touching the
    // process-global subscriber other tests may own.
    #[derive(Clone)]
    struct SharedBuf(std::sync::Arc<std::sync::Mutex<Vec<u8>>>);
    impl std::io::Write for SharedBuf {
        fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
            self.0.lock().expect("buf lock").extend_from_slice(data);
            Ok(data.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    // Purpose: prove `install_panic_hook` routes a real panic into the
    // `tracing` pipeline under `target: "panic"` — the #1565 regression is
    // "a panic in a detached boot task reaches only stderr (→ /dev/null in a
    // packaged app) and vanishes". The single load-bearing fact: after the
    // hook is installed, a panic's message + panic target land on a subscriber
    // (hence, via #1564's file layer, on disk).
    //
    // The panic is triggered on THIS thread inside `catch_unwind`, so the hook
    // fires while the thread-local `with_default` subscriber is still active —
    // a spawned thread would not see a thread-local subscriber (tracing's
    // dispatcher is thread-local unless set globally), which is why we keep it
    // on-thread and deterministic instead of racing a background thread (P5).
    #[test]
    fn test_install_panic_hook_routes_panic_to_tracing_target() {
        install_panic_hook();

        let buf = std::sync::Arc::new(std::sync::Mutex::new(Vec::<u8>::new()));
        let writer = SharedBuf(buf.clone());
        let subscriber = tracing_subscriber::registry().with(
            tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_target(true)
                .with_writer(move || writer.clone()),
        );

        tracing::subscriber::with_default(subscriber, || {
            // catch_unwind swallows the unwind so the test process survives;
            // the hook has already run (synchronously, on this thread) by the
            // time catch_unwind returns.
            let _ = std::panic::catch_unwind(|| panic!("diag-boom-marker-1565"));
        });

        let out = String::from_utf8(buf.lock().expect("buf lock").clone()).expect("utf8");
        // Message routed through the hook into tracing.
        assert!(
            out.contains("diag-boom-marker-1565"),
            "panic message never reached the tracing subscriber; got: {out:?}"
        );
        // Emitted at ERROR under `target: "panic"` (the marker itself contains
        // no "panic", so this token can only come from the event's target).
        assert!(
            out.contains("ERROR panic"),
            "expected an ERROR event with target=panic; got: {out:?}"
        );
    }

    // Reason (review B2) — a file-open failure must surface as `Err` (routed
    // to the stdout-only degrade path in `run()`), never a panic that aborts
    // boot. Point the writer at a dir nested under a regular file so the
    // create step fails deterministically (2026-07-17).
    #[test]
    fn test_file_writer_returns_err_not_panic_when_dir_unusable() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let occupied = tmp.path().join("occupied");
        std::fs::write(&occupied, b"x").expect("write file");
        // `occupied` is a file, so creating `occupied/logs` under it fails.
        assert!(file_writer(&occupied.join("logs")).is_err());
    }
}
