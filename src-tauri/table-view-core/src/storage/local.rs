//! SQLite SOT skeleton.
//!
//! This module is the foundation for the single SQLite path described in
//! `memory/engineering/architecture/state-management/memory.md`.
//!
//! Responsibilities:
//! - Decide the `state.db` file path inside the app data directory
//! - SQLite pool init (sqlx, runtime-tokio-rustls + sqlite feature)
//! - Apply migrations (the sqlx migrate! macro) — idempotent, safe to re-run
//! - Q2 corrupt recovery — when `open_pool()` detects corruption it quarantines
//!   the file as `state.db.bak` and creates a fresh DB. v0.3.1: on recovery
//!   `corrupt_recovery::DID_RECOVER` is set and the frontend raises a toast.
//!
//! Q22 (the keyring migration) is out of scope here — this module only knows
//! the schema.

use crate::error::AppError;
use crate::storage::corrupt_recovery;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::path::{Component, Path, PathBuf};
use std::str::FromStr;
use std::sync::atomic::Ordering;
use tracing::{info, warn};

/// App data directory. Keeping the name in the SQLite area too is purely a
/// convenience for callers (storage/mod.rs is the file-based connections.json
/// area, this file is the SQLite area, and they share the directory); the
/// decision itself lives in one place, [`crate::storage::app_data_dir`].
/// Before #2184 this function carried its own copy of the override → fallback
/// body — three copies of the same body left the hole in #2183 open in three
/// places at once.
pub fn app_data_dir() -> Result<PathBuf, AppError> {
    crate::storage::app_data_dir()
}

/// SQLite DB file path. This is the permanent location.
pub fn db_path() -> Result<PathBuf, AppError> {
    Ok(app_data_dir()?.join("state.db"))
}

/// Validates the renderer-named target path a Tauri command will write to as a
/// file. Rejects a relative path (it must be absolute) and any path that
/// resolves inside the internal app data directory (`app_data_dir()`) — this
/// stops a compromised renderer from using an export target as a pretext to
/// overwrite or delete internal credentials such as `.key` (the master key),
/// `connections.json` and its `.bak` (#2183, both encrypted password blobs), or
/// `state.db` (plus its `.bak` and `-wal` sidecars).
/// Issue #1094, #1449. Reuses the same `reject_internal_app_data_path` guard
/// that sqlite connect/create uses.
pub fn validate_export_target_path(path: &Path) -> Result<(), AppError> {
    if !path.is_absolute() {
        return Err(AppError::Validation(
            "Export target path must be absolute".into(),
        ));
    }
    reject_internal_app_data_path(path)
}

/// Rejects the argument path when it resolves inside the internal app data
/// directory (`app_data_dir()`). The confinement covers the whole directory
/// rather than the single `state.db` file — it stops app-internal state such as
/// `connections.json` and its `.bak` (#2183, encrypted password blobs), `.key`
/// (the master key), or `state.db` (plus its `.bak` and `-wal` sidecars) from
/// being taken as an export/import/connect/create target or a DuckDB file
/// analytics source and then overwritten or read-exfiltrated (Issue #1106,
/// #1449). This is the single guard that export/import/connect/create and file
/// analytics share. It compares directory containment two ways: normalized
/// (`..` and `.` cleaned up) and canonical (symlinks resolved) — a target that
/// does not exist yet (a new export/create) fails canonicalize, so the
/// normalized comparison catches it, while existing files and symlinks are
/// caught by the canonical comparison. A caller may canonicalize beforehand
/// without harm.
pub fn reject_internal_app_data_path(path: &Path) -> Result<(), AppError> {
    // #2184 — resolve the directory instead of opening it: this check is
    // read-only, so it must not create the very directory it protects, and it
    // must not turn into an error in a process that has none. `None` = no boot
    // injection and no test override, which means this process has no
    // `connections.json` / `.key` / `state.db` at all — the confined set is empty
    // and no path can be inside it. The app cannot take that arm:
    // `lib.rs::setup` injects before the first IPC handler can fire and exits the
    // process if the injection fails.
    let Some(data_dir) = crate::storage::app_data_dir_path() else {
        return Ok(());
    };
    let normalized_within =
        normalize_absolute_path(path).starts_with(normalize_absolute_path(&data_dir));
    let canonical_within = matches!(
        (std::fs::canonicalize(path), std::fs::canonicalize(&data_dir)),
        (Ok(candidate), Ok(dir)) if candidate.starts_with(&dir)
    );
    if normalized_within || canonical_within {
        return Err(AppError::Validation(
            "Local file path cannot target the internal app data directory".into(),
        ));
    }
    Ok(())
}

fn normalize_absolute_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::Normal(segment) => normalized.push(segment),
        }
    }
    normalized
}

/// Opens the SQLite pool and applies migrations. A corrupt file is quarantined
/// automatically (Q2). The caller registers the resulting pool in AppState or in
/// a `OnceCell`.
pub async fn open_pool() -> Result<SqlitePool, AppError> {
    let path = db_path()?;

    // Pre-open corruption check — the probe catches magic header damage. Waiting
    // until the pool is open and a query fails before attempting quarantine
    // would race, so this runs once at boot.
    if path.exists() {
        if let Err(e) = corrupt_recovery::probe(&path).await {
            warn!(
                target: "storage",
                error = %e,
                path = %path.display(),
                "SQLite file appears corrupt — quarantining and starting fresh"
            );
            corrupt_recovery::quarantine(&path)?;
            corrupt_recovery::DID_RECOVER.store(true, Ordering::SeqCst);
        }
    }

    // Attempt connect + migrate + boot health check together. Body corruption
    // (damage the probe passes but that kills the read path) is caught here.
    let pool = match open_pool_inner(&path).await {
        Ok(p) => p,
        Err(e) if is_lock_error(&e) || is_migration_error(&e) => {
            // Recovery (quarantine+fresh) is limited to read-path damage. Neither
            // case below is corruption, so quarantining them only loses data:
            // - Lock (a second instance, say): quarantine+fresh changes nothing,
            //   the re-run fails on the same file lock. The root fix is a
            //   single-instance guarantee.
            // - Migration failure (downgrade VersionMissing / dirty / version
            //   mismatch / broken SQL): the DB bytes are fine, yet quarantining
            //   makes connections/favorites/query_history/settings disappear
            //   silently (#1558).
            // Both propagate as-is, so boot fails with a clear error and the data
            // is preserved.
            return Err(e);
        }
        Err(e) => {
            warn!(
                target: "storage",
                error = %e,
                path = %path.display(),
                "SQLite health check failed — quarantining and retrying once"
            );
            corrupt_recovery::quarantine(&path)?;
            corrupt_recovery::DID_RECOVER.store(true, Ordering::SeqCst);
            // One fresh retry. A failure here too is a genuine error.
            open_pool_inner(&path).await?
        }
    };

    info!(target: "storage", path = %path.display(), "SQLite pool opened, migrations applied");
    Ok(pool)
}

/// Runs connect + migrate + boot health check. On failure it closes the pool and
/// then returns the error (cleaning up background connections is what makes the
/// quarantine rename safe).
async fn open_pool_inner(path: &Path) -> Result<SqlitePool, AppError> {
    let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", path.display()))
        .map_err(|e| AppError::Storage(format!("SQLite connect options: {}", e)))?
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .connect_with(options)
        .await?;

    // `run_migrations` splits a migration failure into corruption (→ `Storage`, a
    // quarantine candidate) and logical failure (downgrade/dirty/broken SQL →
    // `Migration`, propagated) (#1558). health_check catches page body corruption
    // once more through the read path.
    if let Err(e) = run_migrations(&pool).await {
        let _ = pool.close().await;
        return Err(e);
    }
    if let Err(e) = health_check(&pool).await {
        let _ = pool.close().await;
        return Err(e);
    }
    // sqlx creates state.db and the WAL/SHM sidecars under the process umask
    // (umask 022 → 0644), and a sidecar copies the db mode at creation time —
    // narrow all three to 0600. Same policy as the other credential files
    // (connections.json / .key) (Issue #1452).
    restrict_state_db_permissions(path);
    Ok(pool)
}

/// Restricts state.db and the WAL/SHM sidecars to Unix 0600. sqlx cannot specify
/// a file mode, so this narrows them after creation, and an existing 0644 file is
/// corrected on the next boot as well. A chmod failure does not block boot, it
/// only logs a warning (the DB itself keeps working).
#[cfg(unix)]
fn restrict_state_db_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    for suffix in ["", "-wal", "-shm"] {
        let mut os = path.as_os_str().to_os_string();
        os.push(suffix);
        let target = PathBuf::from(os);
        match std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o600)) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => warn!(
                target: "storage",
                error = %e,
                path = %target.display(),
                "failed to restrict state.db permissions to 0600"
            ),
        }
    }
}

#[cfg(not(unix))]
fn restrict_state_db_permissions(_path: &Path) {}

/// Boot health check — runs the same transaction (`BEGIN IMMEDIATE` + read) as
/// the read path `get_initial_app_state_inner` executes, so damage that would
/// fail at boot (page body corruption and the like; the cases the probe's magic
/// check passes) is caught at the init stage. Sub-ms on a healthy DB.
async fn health_check(pool: &SqlitePool) -> Result<(), AppError> {
    let mut tx = pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(|e| AppError::Storage(format!("health check begin: {}", e)))?;
    let _: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE type='table'")
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| AppError::Storage(format!("health check read: {}", e)))?;
    tx.commit()
        .await
        .map_err(|e| AppError::Storage(format!("health check commit: {}", e)))?;
    Ok(())
}

/// Skips recovery when the error message is about a SQLite lock (busy) — a lock
/// is not released by quarantine+fresh, it only loses data.
fn is_lock_error(e: &AppError) -> bool {
    let msg = e.to_string().to_lowercase();
    msg.contains("locked") || msg.contains("busy")
}

/// Decides whether this is a logical migration failure (downgrade
/// `VersionMissing` / dirty / version mismatch / broken migration SQL). In that
/// case the DB bytes are fine, so quarantining would make user data disappear
/// silently (#1558) — recovery is skipped and the error propagates. Genuine
/// read-path damage is left as `Storage` by `run_migrations` (the
/// `_ => quarantine` arm below) and recovers normally.
fn is_migration_error(e: &AppError) -> bool {
    matches!(e, AppError::Migration(_))
}

/// Migration runner — applies `src-tauri/table-view-core/migrations/*.sql`
/// through `sqlx::migrate!()`. Safe to re-run (sqlx tracks the applied history in
/// the `_sqlx_migrations` table).
pub async fn run_migrations(pool: &SqlitePool) -> Result<(), AppError> {
    use sqlx::migrate::MigrateError;
    sqlx::migrate!("./migrations")
        .run(pool)
        .await
        .map_err(|e| match &e {
            // `Execute` = the migrator's bookkeeping (reading/creating
            // `_sqlx_migrations` and so on) blew up. Read-path damage (page body
            // corruption) lands here, so it stays a candidate for the existing
            // corruption recovery (quarantine)
            // (`tests/corrupt_body_recovery.rs` regression).
            MigrateError::Execute(_) => AppError::Storage(format!("Migration failed: {}", e)),
            // The rest are logical failures where the DB bytes are fine:
            // downgrade (`VersionMissing`) / checksum `VersionMismatch` /
            // `Dirty` / a specific migration's SQL failing (`ExecuteMigration`)
            // and so on. Quarantining would make connections/favorites/
            // query_history/settings disappear silently (#1558), so the data is
            // preserved and the error propagates as a clear boot error.
            _ => AppError::Migration(e.to_string()),
        })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    //! Written 2026-05-16 — happy-path unit checks for open_pool /
    //! run_migrations. The detailed PK / index / corrupt recovery checks live in
    //! the `tests/migration_apply.rs` and `tests/corrupt_recovery.rs` integration
    //! test files.

    use super::*;
    use serial_test::serial;
    use tempfile::TempDir;

    fn setup_env() -> TempDir {
        let dir = TempDir::new().unwrap();
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
        dir
    }

    fn cleanup_env() {
        std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
    }

    /// #2184 — the confinement check is scoped to the directory this process
    /// actually has. With none resolved there is no `connections.json`, no `.key`
    /// and no `state.db` to target, so the confined set is empty and the check
    /// must pass rather than turn every export / import / connect into an error.
    /// It must NOT resolve one to answer the question: doing so is what had 76
    /// sqlite/duckdb adapter tests creating the developer's real app data
    /// directory on every `cargo test` run.
    ///
    /// The second half is the part that must never weaken: as soon as a directory
    /// is resolved, a path inside it is rejected again. The app only ever runs in
    /// that state — `lib.rs::setup` injects before the first IPC handler can fire
    /// and exits the process if the injection fails.
    #[test]
    #[serial]
    fn confinement_is_empty_without_a_data_dir_and_closed_with_one() {
        cleanup_env();
        let outside = TempDir::new().unwrap();
        let target = outside.path().join("export.csv");
        assert!(
            reject_internal_app_data_path(&target).is_ok(),
            "nothing to confine when this process has no app data directory"
        );
        assert!(validate_export_target_path(&target).is_ok());

        let dir = setup_env();
        let internal = dir.path().join("connections.json");
        assert!(
            reject_internal_app_data_path(&internal).is_err(),
            "a resolved data directory must still be closed to renderer-named paths"
        );
        assert!(validate_export_target_path(&internal).is_err());
        assert!(
            reject_internal_app_data_path(&target).is_ok(),
            "paths outside the resolved directory stay allowed"
        );
        cleanup_env();
    }

    #[tokio::test]
    #[serial]
    async fn test_open_pool_creates_db_when_missing() {
        let _dir = setup_env();
        let path = db_path().unwrap();
        assert!(!path.exists(), "precondition: db file absent");

        let _pool = open_pool().await.unwrap();
        assert!(path.exists(), "open_pool should create state.db");

        cleanup_env();
    }

    #[tokio::test]
    #[serial]
    async fn test_run_migrations_is_idempotent() {
        let _dir = setup_env();
        let pool = open_pool().await.unwrap();
        // Calling again must not error.
        run_migrations(&pool).await.unwrap();
        cleanup_env();
    }

    /// state.db is the SQLite SOT holding credential-bearing data. Like the other
    /// credential files (connections.json / .key) it must be Unix 0600 (Issue
    /// #1452). WAL journal mode means sqlite also creates `-wal` / `-shm`
    /// sidecars, and those are checked too — when present they must be 0600 as
    /// well.
    #[cfg(unix)]
    #[tokio::test]
    #[serial]
    async fn test_state_db_files_are_0600() {
        use std::os::unix::fs::PermissionsExt;

        let _dir = setup_env();
        let path = db_path().unwrap();

        let pool = open_pool().await.unwrap();
        // Force a write so the WAL/SHM sidecars definitely exist.
        sqlx::query("CREATE TABLE IF NOT EXISTS _perm_probe (id INTEGER PRIMARY KEY)")
            .execute(&pool)
            .await
            .unwrap();

        for suffix in ["", "-wal", "-shm"] {
            let mut os = path.as_os_str().to_os_string();
            os.push(suffix);
            let target = PathBuf::from(os);
            if !target.exists() {
                continue;
            }
            let mode = std::fs::metadata(&target).unwrap().permissions().mode() & 0o777;
            assert_eq!(
                mode,
                0o600,
                "{} must be 0600, got {:o}",
                target.display(),
                mode
            );
        }

        cleanup_env();
    }

    /// #1653 regression — checks that `reject_internal_app_data_path` blocks a
    /// symlink escape through the canonical comparison. Even when a compromised
    /// renderer puts a symbolic link **outside** app_data_dir and points that
    /// link at an internal credential (`connections.json` / `.key` /
    /// `state.db`), canonicalize resolves the link, the containment in the
    /// internal directory becomes visible, and the path must be rejected (Err).
    /// The normalized comparison alone would look like a pass because the link
    /// sits outside, so the canonical arm is essential. A path that honestly
    /// points outside passes (Ok) as the contrast case.
    #[cfg(unix)]
    #[tokio::test]
    #[serial]
    async fn test_reject_internal_app_data_path_rejects_symlink_escape() {
        use std::os::unix::fs::symlink;

        let _dir = setup_env();
        let data_dir = app_data_dir().unwrap();

        // A real file standing in for an internal credential, so symlink
        // canonicalize succeeds.
        let internal_secret = data_dir.join("connections.json");
        std::fs::write(&internal_secret, b"secret").unwrap();

        // Create a symlink in a separate directory outside app_data_dir that
        // points at the internal file.
        let outside = TempDir::new().unwrap();
        let link = outside.path().join("escape_link");
        symlink(&internal_secret, &link).unwrap();

        // Escape attempt: the link sits outside, but canonicalize points it
        // inside → rejected.
        assert!(
            reject_internal_app_data_path(&link).is_err(),
            "symlink resolving into app data dir must be rejected"
        );

        // Contrast: a path that honestly points outside passes.
        let outside_file = outside.path().join("legit_export.csv");
        assert!(
            reject_internal_app_data_path(&outside_file).is_ok(),
            "path outside app data dir must be allowed"
        );

        cleanup_env();
    }
}
