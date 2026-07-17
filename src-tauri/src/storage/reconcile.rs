//! Sprint 358 (Phase 1 W1 dual-write) — mismatch counter + boot reconciliation.
//!
//! Dual-write 의 invariant:
//!   - file/LS write 가 성공 path. SQLite mirror write 실패는 silent —
//!     dev tracing::warn 로그 + 본 module 의 `mismatch_counter` 가 += 1.
//!   - 다음 boot 직후 `reconcile_pending_domains(pool)` 호출 — file/LS SOT 를
//!     SQLite 에 재투영. 한 도메인당 3회 retry → 실패 시 stop + dev console
//!     error. user-visible 영향 0.
//!
//! 본 module 은 backend-only — counter / reconcile entrypoint / test override
//! flag 를 노출하고, 도메인별 `dual_write_*` 호출은 commands/persist_* 의
//! `dual_write_*` helper 에서 본 module 의 `record_sqlite_failure` 를 호출한다.
//!
//! Test injection: `set_force_failure_for_tests(true)` 는 process-wide flag.
//! 실제 SQLite I/O 가 항상 성공하는 unit-test 환경에서 실패 path 를 강제하기
//! 위해 dual-write helper 가 본 flag 를 검사해 simulated Err 를 반환한다.

use crate::error::AppError;
use crate::storage::load_storage_redacted;
use sqlx::SqlitePool;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tracing::{error, warn};

// ---------------------------------------------------------------------------
// mismatch counter — process-wide AtomicU64. dual-write 사이트가 SQLite 실패
// 시 증가. reconcile 성공 시 reset. UI / metrics 가 read.
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
// test-only force-failure flag. dual-write helper 가 SQLite query 직전에 본
// flag 를 확인해 simulated Err 반환. 프로덕션 path 에서는 항상 false.
// ---------------------------------------------------------------------------

static FORCE_FAILURE_FOR_TESTS: AtomicBool = AtomicBool::new(false);

pub fn set_force_failure_for_tests(on: bool) {
    FORCE_FAILURE_FOR_TESTS.store(on, Ordering::SeqCst);
}

pub fn is_force_failure_for_tests() -> bool {
    FORCE_FAILURE_FOR_TESTS.load(Ordering::SeqCst)
}

/// dual-write helper 가 SQLite mirror write 결과를 본 함수에 넘겨 silent 처리.
/// `Ok(())` 면 no-op. `Err(_)` 면 dev tracing::warn 로그 + counter 증가.
///
/// #1092 (2026-07-02) — 이 삼킴은 **file SOT 가 살아있는 도메인 전용**이다.
/// W3 이후 SQLite-only 가 된 favorites/mru/settings 는 대체 원본이 없어
/// 실패를 삼키면 무음 소실이 되므로, 그 커맨드들은 이제 실패를 IPC 경계로
/// 직접 전파한다. 유일한 현 호출자는 `persist_connections` — connections 는
/// file `connections.json` 이 read SOT 라 SQLite mirror 실패가 데이터 손실을
/// 일으키지 않는다 (다음 성공 write 까지 mirror 만 drift).
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
// Reconcile entrypoint — boot 직후 단일 task. file/LS SOT 를 SQLite 에 재투영.
// 한 도메인당 3회 retry → 모두 실패면 stop + dev console error.
// ---------------------------------------------------------------------------

const MAX_RETRIES: usize = 3;

pub async fn reconcile_pending_domains(pool: &SqlitePool) -> Result<(), AppError> {
    // mismatch counter 가 0 이면 reconcile 도 no-op.
    if mismatch_counter::current() == 0 {
        return Ok(());
    }

    // Phase 1 W1 시점에는 mru / settings / favorites / connections 4 도메인의
    // file/LS SOT 가 모두 SQLite mirror 보다 우위. 각 도메인 helper 를 순서
    // 그대로 호출. workspace 는 SQLite-only 라 reconcile target 에서 제외.

    // 한 도메인이라도 재투영에 실패하면 counter 를 보존해 다음 boot 가 다시
    // 시도하게 한다. Err 는 로깅만 하고 삼키되, all_ok 로 reset 여부를 결정.
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

    // 4개 도메인이 전부 Ok 일 때만 reset. 일부/전부 실패면 counter 유지 →
    // 다음 boot 의 `counter != 0` 이 재시도를 재개한다. (issue #1559)
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
            // 실패 simulation 은 reconcile path 에선 무시 (boot 시 retry path 가
            // forced-failure 를 만나면 멈춰야 하므로 그대로 검사).
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
    // connections.json 는 기존 storage::mod.rs 가 SOT 로 관리. load_storage_redacted
    // 로 ciphertext 없는 list 를 read 한 뒤 SQLite mirror UPSERT.
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
            .bind("") // ciphertext from redacted view is cleared; reconcile 에선 keyring SOT 가 별개
            .bind(&c.database)
            .bind(if c.read_only { 1i64 } else { 0i64 })
            .bind(&c.group_id)
            .bind(&c.color)
            .bind(c.connection_timeout.map(|v| v as i64))
            .bind(c.keep_alive_interval.map(|v| v as i64))
            .bind(&c.environment)
            .bind(&c.auth_source)
            .bind(&c.replica_set)
            .bind(c.tls_enabled.map(|v| if v { 1i64 } else { 0i64 }))
            .bind(
                c.trust_server_certificate
                    .map(|v| if v { 1i64 } else { 0i64 }),
            )
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
    //! 작성 2026-05-16 (Phase 1 sprint-358) — counter 의 monotonic / reset
    //! 동작과 force-failure flag 의 toggle 동작 검증. Reconcile 의 end-to-end
    //! 시나리오는 `tests/dual_write_reconcile.rs` 의 integration 에 위임.

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
    // DB-backed unit smoke for reconcile helpers — `cargo llvm-cov --lib` 가
    // 통합 테스트를 포함하지 않아, reconcile 의 각 도메인 helper coverage 가
    // 0 이 된다. 본 모듈은 pre-commit Tier 1 floor 유지를 위해 helper happy/
    // sad path 를 inline 으로 1회씩 cover. 전체 E2E 시나리오는
    // `tests/dual_write_reconcile.rs` 통합 테스트가 담당.
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
        // file SOT 에 entry 준비. SQLite mirror 는 비어있음.
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
        // connections.json file SOT 준비.
        use crate::models::{ConnectionConfig, DatabaseType};
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
            tls_enabled: None,
            trust_server_certificate: None,
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
        // counter 는 reset 되지 않음.
        assert!(mismatch_counter::current() >= 1);
        // SQLite 변경 없음.
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mru")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
        pool_cleanup();
    }

    // Reason: 회귀 — issue #1559. mismatch counter reset 이 `is_force_failure_for_tests()`
    // (테스트 전용 게이트) 에만 걸려 있어, prod 에서 `reconcile_*` 가 실제 Err 를
    // 반환해도 counter 가 무조건 0 으로 reset 됐다. reset 되면 다음 boot 의
    // `counter == 0` 조기 return 이 재시도를 영구 skip 한다. force flag 없이 실제
    // 실패(pool close)를 주입해 counter 보존 + 다음 boot 재시도를 잠근다. (2026-07-17)
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

        // 실제 실패 주입 — 테스트 게이트가 아니라 prod 와 동일한 Err 경로.
        // closed pool 의 execute 는 PoolClosed 로 실패한다.
        pool.close().await;
        reconcile_pending_domains(&pool).await.unwrap();

        // BUG(old): prod 경로에서 무조건 reset → 0 → 다음 boot skip.
        // FIX: 일부 도메인 실패 시 counter 보존.
        assert!(
            mismatch_counter::current() >= 1,
            "counter must survive a real reconcile failure so next boot retries"
        );

        // 다음 boot 재시도 실증 — fresh(working) pool 로 다시 reconcile 하면
        // counter > 0 이라 조기 return 안 하고, file SOT 를 SQLite 로 재투영한다.
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
