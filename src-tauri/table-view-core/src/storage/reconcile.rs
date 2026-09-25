//! Mismatch counter + boot reconciliation.
//!
//! Dual-write invariants:
//!   - The file/LS write is the success path. A failed SQLite mirror write is
//!     silent — a dev tracing::warn log plus `mismatch_counter` += 1 in this
//!     module.
//!   - `reconcile_pending_domains(pool)` re-projects the file/LS SOT onto
//!     SQLite: 3 retries per domain → on failure it stops with a dev console
//!     error. Zero user-visible impact.
//!
//! This module is backend-only — it exposes the counter, the reconcile
//! entrypoint, and the test override flag. The `commands::persist_*`
//! dual-write helpers call into it; `record_sqlite_result` documents which
//! domains hand a mirror-write failure here.
//!
//! Test injection: `set_force_failure_for_tests(true)` is a process-wide flag.
//! The dual-write helpers check it and return a simulated Err so the failure
//! path can be forced in a unit-test environment where real SQLite I/O always
//! succeeds.

use crate::error::AppError;
use crate::storage::load_storage_redacted;
use sqlx::SqlitePool;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tracing::{error, warn};

// ---------------------------------------------------------------------------
// mismatch counter — process-wide AtomicU64. A dual-write site bumps it when
// SQLite fails; a successful reconcile resets it. Read through `current()`.
// ---------------------------------------------------------------------------

pub mod mismatch_counter {
    use super::AtomicU64;
    use super::Ordering;

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    pub fn current() -> u64 {
        COUNTER.load(Ordering::SeqCst)
    }

    pub fn increment() -> u64 {
        COUNTER.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub fn reset() {
        COUNTER.store(0, Ordering::SeqCst);
    }
}

// ---------------------------------------------------------------------------
// test-only force-failure flag. The dual-write helpers check it right before
// the SQLite query and return a simulated Err. Always false on the production
// path.
// ---------------------------------------------------------------------------

static FORCE_FAILURE_FOR_TESTS: AtomicBool = AtomicBool::new(false);

pub fn set_force_failure_for_tests(on: bool) {
    FORCE_FAILURE_FOR_TESTS.store(on, Ordering::SeqCst);
}

pub fn is_force_failure_for_tests() -> bool {
    FORCE_FAILURE_FOR_TESTS.load(Ordering::SeqCst)
}

/// A dual-write helper hands its SQLite mirror write result here for silent
/// handling. `Ok(())` is a no-op; `Err(_)` logs a dev tracing::warn and bumps
/// the counter.
///
/// #1092 (2026-07-02) — this swallowing is **only for domains whose file SOT
/// is still alive**. favorites/mru/settings went SQLite-only after the W3 cut
/// and have no alternative source, so swallowing a failure there would be a
/// silent loss; those commands now propagate the failure straight to the IPC
/// boundary. The only caller is `persist_connections` — for connections the
/// file `connections.json` is the read SOT, so a SQLite mirror failure causes
/// no data loss (only the mirror drifts until the next successful write).
pub fn record_sqlite_result(domain: &str, result: Result<(), AppError>) {
    if let Err(e) = result {
        warn!(
            target: "dual_write",
            domain = domain,
            error = %e,
            "SQLite mirror write failed — file SOT preserved (mirror may drift until next successful write)"
        );
        mismatch_counter::increment();
    }
}

// ---------------------------------------------------------------------------
// Reconcile entrypoint — a single task that re-projects the file/LS SOT onto
// SQLite. 3 retries per domain → if all fail it stops with a dev console error.
// ---------------------------------------------------------------------------

const MAX_RETRIES: usize = 3;

pub async fn reconcile_pending_domains(pool: &SqlitePool) -> Result<(), AppError> {
    // A zero mismatch counter makes reconcile a no-op too.
    if mismatch_counter::current() == 0 {
        return Ok(());
    }

    // Calls the per-domain helper for mru / favorites / connections / settings
    // in that order; each replays that domain's file/LS content into SQLite.
    // `workspace` is SQLite-only and has no reconcile helper.

    // If even one domain fails to re-project, the counter is preserved so the
    // next boot tries again. An Err is only logged and swallowed, but `all_ok`
    // decides whether to reset.
    let mut all_ok = true;
    if let Err(e) = reconcile_mru(pool).await {
        error!(target: "dual_write", error = %e, "reconcile mru gave up after retries");
        all_ok = false;
    }
    if let Err(e) = reconcile_favorites(pool).await {
        error!(target: "dual_write", error = %e, "reconcile favorites gave up after retries");
        all_ok = false;
    }
    if let Err(e) = reconcile_connections(pool).await {
        error!(target: "dual_write", error = %e, "reconcile connections gave up after retries");
        all_ok = false;
    }
    if let Err(e) = reconcile_settings(pool).await {
        error!(target: "dual_write", error = %e, "reconcile settings gave up after retries");
        all_ok = false;
    }

    // Reset only when all four domains are Ok. On a partial or total failure
    // the counter is kept → the next boot's `counter != 0` resumes the retry.
    // (issue #1559)
    if all_ok {
        mismatch_counter::reset();
    }
    Ok(())
}

async fn reconcile_mru(pool: &SqlitePool) -> Result<(), AppError> {
    let entries = crate::storage::local_files::load_mru_file()?;
    for attempt in 0..MAX_RETRIES {
        let mut all_ok = true;
        for entry in &entries {
            // The failure simulation is honoured on the reconcile path too, so
            // the boot retry path stops when it meets a forced failure.
            if is_force_failure_for_tests() {
                all_ok = false;
                break;
            }
            let res =
                sqlx::query("INSERT OR REPLACE INTO mru(connection_id, last_used) VALUES (?, ?)")
                    .bind(&entry.connection_id)
                    .bind(entry.last_used)
                    .execute(pool)
                    .await;
            if let Err(e) = res {
                warn!(
                    target: "dual_write",
                    domain = "mru",
                    attempt = attempt,
                    error = %e,
                    "reconcile mru retry"
                );
                all_ok = false;
                break;
            }
        }
        if all_ok {
            return Ok(());
        }
    }
    Err(AppError::Storage("mru reconcile gave up".into()))
}

async fn reconcile_favorites(pool: &SqlitePool) -> Result<(), AppError> {
    let favs = crate::storage::local_files::load_favorites_file()?;
    for attempt in 0..MAX_RETRIES {
        let mut all_ok = true;
        for (idx, f) in favs.iter().enumerate() {
            if is_force_failure_for_tests() {
                all_ok = false;
                break;
            }
            let res = sqlx::query(
                "INSERT OR REPLACE INTO favorites \
                 (id, name, sql, connection_id, sort_order, created_at, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&f.id)
            .bind(&f.name)
            .bind(&f.sql)
            .bind(&f.connection_id)
            .bind(idx as i64)
            .bind(f.created_at)
            .bind(f.updated_at)
            .execute(pool)
            .await;
            if let Err(e) = res {
                warn!(
                    target: "dual_write",
                    domain = "favorites",
                    attempt = attempt,
                    error = %e,
                    "reconcile favorites retry"
                );
                all_ok = false;
                break;
            }
        }
        if all_ok {
            return Ok(());
        }
    }
    Err(AppError::Storage("favorites reconcile gave up".into()))
}

async fn reconcile_settings(pool: &SqlitePool) -> Result<(), AppError> {
    let settings = crate::storage::local_files::load_settings_file()?;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    for attempt in 0..MAX_RETRIES {
        let mut all_ok = true;
        for (key, value) in &settings {
            if is_force_failure_for_tests() {
                all_ok = false;
                break;
            }
            let res = sqlx::query(
                "INSERT OR REPLACE INTO settings(key, value_json, updated_at) VALUES (?, ?, ?)",
            )
            .bind(key)
            .bind(value)
            .bind(now_ms)
            .execute(pool)
            .await;
            if let Err(e) = res {
                warn!(
                    target: "dual_write",
                    domain = "settings",
                    attempt = attempt,
                    error = %e,
                    "reconcile settings retry"
                );
                all_ok = false;
                break;
            }
        }
        if all_ok {
            return Ok(());
        }
    }
    Err(AppError::Storage("settings reconcile gave up".into()))
}

async fn reconcile_connections(pool: &SqlitePool) -> Result<(), AppError> {
    // connections.json is managed as the SOT by storage::mod.rs. Read the
    // ciphertext-free list with load_storage_redacted, then UPSERT the SQLite mirror.
    let data = load_storage_redacted()?;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    for attempt in 0..MAX_RETRIES {
        let mut all_ok = true;
        for (idx, c) in data.connections.iter().enumerate() {
            if is_force_failure_for_tests() {
                all_ok = false;
                break;
            }
            let (legacy_tls, legacy_trust) = c.ssl_mode.to_legacy();
            let res = sqlx::query(
                "INSERT OR REPLACE INTO connections \
                 (id, name, db_type, host, port, user, password_enc, database, read_only, group_id, color, \
                 connection_timeout, keep_alive_interval, environment, auth_source, replica_set, \
                 tls_enabled, trust_server_certificate, sort_order, created_at, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&c.id)
            .bind(&c.name)
            .bind(
                serde_json::to_value(&c.db_type)
                    .ok()
                    .and_then(|v| v.as_str().map(String::from))
                    .unwrap_or_else(|| "postgresql".into()),
            )
            .bind(&c.host)
            .bind(c.port as i64)
            .bind(&c.user)
            .bind("") // ciphertext from redacted view is cleared; on reconcile the keyring SOT is separate
            .bind(&c.database)
            .bind(if c.read_only { 1i64 } else { 0i64 })
            .bind(&c.group_id)
            .bind(&c.color)
            .bind(c.connection_timeout.map(|v| v as i64))
            .bind(c.keep_alive_interval.map(|v| v as i64))
            .bind(&c.environment)
            .bind(&c.auth_source)
            .bind(&c.replica_set)
            // #1649 — the mirror keeps the legacy integer columns; the file-SOT
            // posture is projected onto them (`verify-ca` lands as `verify-full`,
            // the CA path is file-SOT-only). See `SslMode::to_legacy`.
            .bind(legacy_tls.map(|v| if v { 1i64 } else { 0i64 }))
            .bind(legacy_trust.map(|v| if v { 1i64 } else { 0i64 }))
            .bind(idx as i64)
            .bind(now_ms)
            .bind(now_ms)
            .execute(pool)
            .await;
            if let Err(e) = res {
                warn!(
                    target: "dual_write",
                    domain = "connections",
                    attempt = attempt,
                    error = %e,
                    "reconcile connections retry"
                );
                all_ok = false;
                break;
            }
        }
        if all_ok {
            return Ok(());
        }
    }
    Err(AppError::Storage("connections reconcile gave up".into()))
}

#[cfg(test)]
mod tests {
    //! Written 2026-05-16 — verifies the counter's monotonic / reset behaviour
    //! and the force-failure flag's toggle behaviour. The end-to-end reconcile
    //! scenario is delegated to the integration in
    //! `tests/dual_write_reconcile.rs`.

    use super::*;
    use serial_test::serial;

    #[test]
    #[serial]
    fn counter_increments_monotonically_then_resets() {
        mismatch_counter::reset();
        assert_eq!(mismatch_counter::current(), 0);
        let v1 = mismatch_counter::increment();
        let v2 = mismatch_counter::increment();
        let v3 = mismatch_counter::increment();
        assert_eq!(v1, 1);
        assert_eq!(v2, 2);
        assert_eq!(v3, 3);
        mismatch_counter::reset();
        assert_eq!(mismatch_counter::current(), 0);
    }

    #[test]
    #[serial]
    fn force_failure_flag_round_trips() {
        set_force_failure_for_tests(true);
        assert!(is_force_failure_for_tests());
        set_force_failure_for_tests(false);
        assert!(!is_force_failure_for_tests());
    }

    #[test]
    #[serial]
    fn record_sqlite_result_ok_does_not_increment() {
        mismatch_counter::reset();
        record_sqlite_result("test", Ok(()));
        assert_eq!(mismatch_counter::current(), 0);
    }

    #[test]
    #[serial]
    fn record_sqlite_result_err_increments_counter() {
        mismatch_counter::reset();
        record_sqlite_result("test", Err(AppError::Storage("boom".into())));
        assert_eq!(mismatch_counter::current(), 1);
        record_sqlite_result("test", Err(AppError::Storage("boom2".into())));
        assert_eq!(mismatch_counter::current(), 2);
    }

    // ----------------------------------------------------------------------
    // DB-backed unit smoke for reconcile helpers — `tests/dual_write_reconcile.rs`,
    // which holds the full E2E scenario, is run by no CI job (it is outside
    // `ci.yml`'s `--test` list). Left alone that would put every reconcile
    // domain helper at zero coverage, so this module covers the helper
    // happy/sad path inline once each to hold the floor.
    // ----------------------------------------------------------------------

    use crate::storage::local;
    use crate::storage::local_files::{
        save_favorites_file, save_mru_file, save_settings_file, FavoriteRecord, MruRecord,
    };
    use std::collections::BTreeMap;
    use tempfile::TempDir;

    async fn pool_setup() -> (TempDir, sqlx::SqlitePool) {
        let dir = TempDir::new().unwrap();
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
        let pool = local::open_pool().await.unwrap();
        (dir, pool)
    }

    fn pool_cleanup() {
        std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
        set_force_failure_for_tests(false);
        mismatch_counter::reset();
    }

    #[tokio::test]
    #[serial]
    async fn reconcile_noop_when_counter_is_zero() {
        let (_dir, pool) = pool_setup().await;
        mismatch_counter::reset();
        reconcile_pending_domains(&pool).await.unwrap();
        assert_eq!(mismatch_counter::current(), 0);
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn reconcile_replays_mru_from_file_sot() {
        let (_dir, pool) = pool_setup().await;
        // Seed an entry in the file SOT. The SQLite mirror is empty.
        save_mru_file(&[MruRecord {
            connection_id: "c-r".into(),
            last_used: 42,
        }])
        .unwrap();
        // mismatch trigger.
        mismatch_counter::increment();
        reconcile_pending_domains(&pool).await.unwrap();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mru")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn reconcile_replays_favorites_from_file_sot() {
        let (_dir, pool) = pool_setup().await;
        save_favorites_file(&[FavoriteRecord {
            id: "fav-r".into(),
            name: "n".into(),
            sql: "SELECT 1".into(),
            connection_id: None,
            created_at: 1,
            updated_at: 1,
        }])
        .unwrap();
        mismatch_counter::increment();
        reconcile_pending_domains(&pool).await.unwrap();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM favorites")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn reconcile_replays_settings_from_file_sot() {
        let (_dir, pool) = pool_setup().await;
        let mut s = BTreeMap::new();
        s.insert("theme".into(), r#"{"themeId":"x","mode":"light"}"#.into());
        save_settings_file(&s).unwrap();
        mismatch_counter::increment();
        reconcile_pending_domains(&pool).await.unwrap();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM settings")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn reconcile_replays_connections_from_file_sot() {
        let (_dir, pool) = pool_setup().await;
        // Seed the connections.json file SOT.
        use crate::models::{ConnectionConfig, DatabaseType, SslMode};
        let conn = ConnectionConfig {
            id: "c-recon".into(),
            name: "ReconConn".into(),
            db_type: DatabaseType::Postgresql,
            host: "h".into(),
            port: 5432,
            user: "u".into(),
            password: String::new(),
            database: "d".into(),
            read_only: false,
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
            environment: None,
            auth_source: None,
            replica_set: None,
            ssl_mode: SslMode::Prefer,
            ca_cert_path: None,
            oracle_use_sid: None,
            wallet_path: None,
            wallet_password: String::new(),
        };
        crate::storage::save_connection(conn, None).unwrap();
        mismatch_counter::increment();
        reconcile_pending_domains(&pool).await.unwrap();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM connections")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn reconcile_gives_up_when_force_failure_persistent() {
        let (_dir, pool) = pool_setup().await;
        // seed file SOT so reconcile has work.
        save_mru_file(&[MruRecord {
            connection_id: "c-fail".into(),
            last_used: 99,
        }])
        .unwrap();
        mismatch_counter::increment();
        set_force_failure_for_tests(true);
        reconcile_pending_domains(&pool).await.unwrap();
        // The counter is not reset.
        assert!(mismatch_counter::current() >= 1);
        // SQLite is unchanged.
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mru")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
        pool_cleanup();
    }

    // Reason: regression — issue #1559. The mismatch counter reset hung only on
    // `is_force_failure_for_tests()` (a test-only gate), so in prod the counter
    // was reset to 0 unconditionally even when `reconcile_*` returned a real
    // Err. Once reset, the next boot's `counter == 0` early return skips the
    // retry forever. Injects a real failure (pool close) without the force flag
    // to pin counter preservation plus the next-boot retry. (2026-07-17)
    #[tokio::test]
    #[serial]
    async fn reconcile_preserves_counter_on_real_failure_then_retries_next_boot() {
        let (_dir, pool) = pool_setup().await;
        save_mru_file(&[MruRecord {
            connection_id: "c-1559".into(),
            last_used: 7,
        }])
        .unwrap();
        mismatch_counter::increment();

        // Inject a real failure — the same Err path as prod, not the test gate.
        // execute on a closed pool fails with PoolClosed.
        pool.close().await;
        reconcile_pending_domains(&pool).await.unwrap();

        // BUG(old): unconditional reset on the prod path → 0 → next boot skips.
        // FIX: preserve the counter when some domain fails.
        assert!(
            mismatch_counter::current() >= 1,
            "counter must survive a real reconcile failure so next boot retries"
        );

        // Demonstrates the next-boot retry — reconciling again with a fresh
        // (working) pool does not early-return because counter > 0, and it
        // re-projects the file SOT into SQLite.
        let pool2 = local::open_pool().await.unwrap();
        reconcile_pending_domains(&pool2).await.unwrap();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mru")
            .fetch_one(&pool2)
            .await
            .unwrap();
        assert_eq!(count, 1, "next boot must replay the pending mru row");
        assert_eq!(
            mismatch_counter::current(),
            0,
            "counter resets once every domain reconciles cleanly"
        );
        pool_cleanup();
    }
}
