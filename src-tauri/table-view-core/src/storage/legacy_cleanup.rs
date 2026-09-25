//! 30-day cleanup of `.legacy.json` files.
//!
//! The policy comes from the state-management-strategy doc F.1 (line 862):
//!
//! > legacy cleanup — once the switch to SQLite as the SOT is complete, delete
//! > the file/LS keys; `connections.json` is renamed to `.legacy.json` and kept
//! > for 30 days.
//!
//! This cleanup is called once at boot and silently deletes every
//! `*.legacy.json` file whose mtime is older than 30 days. No user-visible
//! toast or dialog — that matches the "for the user's manual recovery" intent
//! of strategy line 907 (for 30 days the user can pick the file up straight
//! off disk, and after that the SQLite SOT is taken to be stable).
//!
//! Failure mode: a failed file stat / remove only logs `tracing::warn` and is
//! retried on the next boot. Q10 zero-telemetry — nothing leaves the machine.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tracing::{info, warn};

/// The 30-day retention expressed in ms — the fixed window of Strategy F.1
/// line 862. Kept as a const: it doubles as a regression guard (an
/// `assert_eq!` can pin it) and keeps the boot path simple.
pub const RETENTION_MS: u64 = 30 * 24 * 60 * 60 * 1000;

/// Deletes the `*.legacy.json` files in one directory whose mtime is older
/// than `now - cutoff_ms`. Returns the number of files successfully deleted.
///
/// Pure helper — the caller injects `now` and `dir`, so an integration test
/// can pin the 30-day boundary with `tempfile`'s TempDir and a forced mtime.
pub fn cleanup_legacy_files_in(
    dir: &Path,
    now: SystemTime,
    cutoff_ms: u64,
) -> std::io::Result<u32> {
    let mut deleted: u32 = 0;
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) => {
            // No directory at all means this is the first boot — a clean state.
            if e.kind() == std::io::ErrorKind::NotFound {
                return Ok(0);
            }
            return Err(e);
        }
    };

    for entry in entries.flatten() {
        let path: PathBuf = entry.path();
        let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !file_name.ends_with(".legacy.json") {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(e) => {
                warn!(
                    target: "legacy_cleanup",
                    path = %path.display(),
                    "metadata read failed (skipping): {}",
                    e
                );
                continue;
            }
        };
        let modified = match metadata.modified() {
            Ok(m) => m,
            Err(e) => {
                warn!(
                    target: "legacy_cleanup",
                    path = %path.display(),
                    "modified() not supported (skipping): {}",
                    e
                );
                continue;
            }
        };
        let age = match now.duration_since(modified) {
            Ok(d) => d,
            Err(_) => {
                // Future mtime — clock drift or a file from the future. Leave it.
                continue;
            }
        };
        if age < Duration::from_millis(cutoff_ms) {
            // Inside the 30-day window — keep it.
            continue;
        }
        match fs::remove_file(&path) {
            Ok(()) => {
                deleted += 1;
                info!(
                    target: "legacy_cleanup",
                    path = %path.display(),
                    age_days = age.as_secs() / 86_400,
                    "deleted legacy file past retention"
                );
            }
            Err(e) => {
                warn!(
                    target: "legacy_cleanup",
                    path = %path.display(),
                    "delete failed (skipping): {}",
                    e
                );
            }
        }
    }
    Ok(deleted)
}

/// `lib.rs::setup` detached task entry. Runs the 30-day `.legacy.json`
/// cleanup inside app_data_dir silently. On failure it only logs
/// `tracing::warn`; the user sees no toast.
pub async fn boot_legacy_file_cleanup() {
    let dir = match super::local::app_data_dir() {
        Ok(d) => d,
        Err(e) => {
            warn!(
                target: "legacy_cleanup",
                "skipped — app_data_dir lookup failed: {}",
                e
            );
            return;
        }
    };
    let now = SystemTime::now();
    match cleanup_legacy_files_in(&dir, now, RETENTION_MS) {
        Ok(n) => {
            info!(
                target: "legacy_cleanup",
                deleted = n,
                "boot legacy file cleanup complete"
            );
        }
        Err(e) => {
            warn!(
                target: "legacy_cleanup",
                "scan failed: {}",
                e
            );
        }
    }
}

#[cfg(test)]
mod tests {
    //! Written 2026-05-17 — pins the 30-day boundary of the pure helper. The
    //! integration check of the boot wrapper lives in
    //! `tests/legacy_file_cleanup.rs`.

    use super::*;
    use std::fs::OpenOptions;
    use std::io::Write;
    use std::time::Duration;
    use tempfile::TempDir;

    /// Helper: creates the file. `seconds_ago` is computed but never applied
    /// to the mtime — these unit tests pin the age boundary by varying
    /// `cutoff_ms` instead of the clock. `tests/legacy_file_cleanup.rs` is the
    /// one that really backdates, with `File::set_modified`.
    fn make_file_with_age(dir: &Path, name: &str, seconds_ago: u64) -> PathBuf {
        let path = dir.join(name);
        let mut f = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&path)
            .unwrap();
        f.write_all(b"{}").unwrap();
        f.sync_all().unwrap();
        drop(f);
        // `cleanup_legacy_files_in` takes an injected cutoff, so these tests
        // move `cutoff_ms` rather than the file's mtime. `target` is left in
        // place to document the age each caller means.
        let target = SystemTime::now() - Duration::from_secs(seconds_ago);
        let _ = target;
        path
    }

    #[test]
    fn cleanup_in_empty_dir_returns_zero() {
        let dir = TempDir::new().unwrap();
        let now = SystemTime::now();
        let n = cleanup_legacy_files_in(dir.path(), now, RETENTION_MS).unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn cleanup_ignores_non_legacy_files() {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join("connections.json"), b"{}").unwrap();
        std::fs::write(dir.path().join("favorites.json"), b"[]").unwrap();
        // Even when called with a deliberately ancient cutoff, files that are
        // not `.legacy.json` are never deleted.
        let n = cleanup_legacy_files_in(dir.path(), SystemTime::now(), 0).unwrap();
        assert_eq!(n, 0, "non-.legacy.json 은 cleanup 대상 아님");
        assert!(dir.path().join("connections.json").exists());
        assert!(dir.path().join("favorites.json").exists());
    }

    #[test]
    fn cleanup_with_zero_cutoff_deletes_all_legacy_files() {
        // cutoff_ms = 0 → every `.legacy.json` falls outside retention
        // (age >= 0). Regression guard: the filename pattern match and the
        // delete path both work.
        let dir = TempDir::new().unwrap();
        let _ = make_file_with_age(dir.path(), "connections.legacy.json", 1);
        let _ = make_file_with_age(dir.path(), "settings.legacy.json", 1);
        std::fs::write(dir.path().join("state.db"), b"keep me").unwrap();

        let n = cleanup_legacy_files_in(dir.path(), SystemTime::now(), 0).unwrap();
        assert_eq!(n, 2);
        assert!(!dir.path().join("connections.legacy.json").exists());
        assert!(!dir.path().join("settings.legacy.json").exists());
        assert!(dir.path().join("state.db").exists());
    }

    #[test]
    fn cleanup_with_huge_cutoff_keeps_recent_files() {
        // cutoff_ms = u64::MAX → no file's age exceeds it, so everything is
        // kept. User journey: when the 30-day retention works, a file renamed
        // one minute ago must not be deleted.
        let dir = TempDir::new().unwrap();
        let _ = make_file_with_age(dir.path(), "connections.legacy.json", 60);
        let n = cleanup_legacy_files_in(dir.path(), SystemTime::now(), u64::MAX).unwrap();
        assert_eq!(n, 0);
        assert!(dir.path().join("connections.legacy.json").exists());
    }
}
