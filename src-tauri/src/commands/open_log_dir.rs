//! `open_log_dir` — reveal the diagnostics log folder in the OS file explorer.
//!
//! Issue #1566. Packaged builds write rotating logs under
//! `diagnostics::log_dir()` (#1599), but a non-developer user has no way to
//! find `.../table-view/logs` and attach it to a bug report. This command
//! reveals that exact folder in Finder/Explorer via the already-present
//! `tauri-plugin-shell` (Cargo.toml) — no new dependency.
//!
//! It reveals `diagnostics::log_dir()` (the path files are actually written to)
//! rather than `app.path().app_log_dir()`, so the user opens the folder that
//! holds their logs.
//!
//! Create-then-open: on a fresh install no log line may have been flushed yet,
//! so `shell().open()` on a missing path would error. Creating the directory
//! first guarantees the reveal always lands on a real folder.

use crate::error::AppError;
use std::path::PathBuf;
use tauri::{AppHandle, Runtime};
use tauri_plugin_shell::ShellExt;

/// Ensure the reveal target exists and return the path string handed to
/// `shell().open`. Split from the command so a unit test can lock the
/// create-then-return contract without launching the OS file explorer
/// (`shell().open` cannot run headless).
fn reveal_target(dir: PathBuf) -> std::io::Result<String> {
    std::fs::create_dir_all(&dir)?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Reveal the diagnostics log directory in the OS file explorer, returning the
/// opened path so the caller can surface it if needed.
///
/// `#[allow(deprecated)]`: `Shell::open` is soft-deprecated in favour of
/// `tauri-plugin-opener`, but #1566 mandates reusing the already-present
/// `tauri-plugin-shell` with zero new dependencies. The method still works on
/// every desktop target; migrating to `tauri-plugin-opener` is the upgrade
/// path if the shell plugin ever removes it.
#[tauri::command]
#[allow(deprecated)]
pub async fn open_log_dir<R: Runtime>(app: AppHandle<R>) -> Result<String, AppError> {
    let path = reveal_target(crate::diagnostics::log_dir())?;
    app.shell()
        .open(path.clone(), None)
        .map_err(std::io::Error::other)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Reason: a fresh install may have flushed no log line yet, so the reveal
    // must CREATE the dir before opening it — otherwise `shell().open` on a
    // missing path errors and the user sees a failure instead of an empty
    // folder. Assert the create-then-return contract on a tempdir subpath so no
    // Finder/Explorer launches and the real user data dir stays untouched
    // (#1566).
    #[test]
    fn reveal_target_creates_missing_dir_and_returns_its_path() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let dir = tmp.path().join("logs");
        assert!(!dir.exists(), "precondition: dir absent");

        let path = reveal_target(dir.clone()).expect("reveal_target");

        assert!(dir.is_dir(), "reveal must create the log dir");
        assert_eq!(path, dir.to_string_lossy());
    }

    // Reason: reveal is idempotent — an existing folder (logs already written)
    // must succeed, not fail on "already exists" (#1566).
    #[test]
    fn reveal_target_is_idempotent_when_dir_exists() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let dir = tmp.path().join("logs");
        std::fs::create_dir_all(&dir).expect("pre-create");

        let path = reveal_target(dir.clone()).expect("reveal_target on existing dir");
        assert_eq!(path, dir.to_string_lossy());
    }
}
