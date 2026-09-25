//! MySQL connection lifecycle — `MysqlAdapter` struct + connect / disconnect
//! / ping + multi-DB sub-pool LRU.
//!
//! Same pattern as PG (`db/postgres/connection.rs`) — a `db_name → MySqlPool`
//! cache + LRU order + current_db inside an `Arc<Mutex<...>>`. Like PG, MySQL
//! takes an independent connection per database naturally (swap the
//! `/database` part of the connect string instead of issuing `USE`), and each
//! sub-pool keeps its own pool identity so a long-running query on another DB
//! does not break the active DB's fairness.

use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlSslMode};
use sqlx::MySqlPool;
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::info;

use crate::db::tls::{resolve_tls_decision, TlsDecision};
use crate::error::AppError;
use crate::models::ConnectionConfig;

use super::version::{parse_mysql_server_version, MysqlServerVersion};

/// Per-pool sqlx connection cap. Same intent as PG's `PG_POOL_MAX_CONNECTIONS`
/// (5) — a conservative budget covering the interactive UI's one concurrent
/// in-flight query plus a few meta probes.
const MYSQL_POOL_MAX_CONNECTIONS: u32 = 5;

/// Hard ceiling for `MySqlPoolOptions::acquire_timeout`. Follows the PG pattern.
pub(crate) const MYSQL_POOL_ACQUIRE_TIMEOUT_MAX_SECS: u32 = 30;

/// Issue #2429 — the same place as PG's `postgres::connection::pool_options`.
/// It ties the first `connect_pool` and a `switch_database` cache miss to the
/// same knob. The default for an unset timeout belongs to
/// [`ConnectionConfig::connect_timeout`], not to this adapter.
pub(crate) fn pool_options(config: &ConnectionConfig) -> MySqlPoolOptions {
    MySqlPoolOptions::new()
        .max_connections(MYSQL_POOL_MAX_CONNECTIONS)
        .acquire_timeout(config.connect_timeout(MYSQL_POOL_ACQUIRE_TIMEOUT_MAX_SECS))
}

/// Same as PG's `PG_SUBPOOL_CAP` (8) — the LRU limit that keeps the sub-pool
/// cache from growing without bound. Every DB switch can open a new pool, so
/// this stops the cache leaking when a user cycles through 10+ DBs.
const MYSQL_SUBPOOL_CAP: usize = 8;

/// Inner mutable state. Equivalent to PG's `PgPoolState`.
#[derive(Default)]
pub struct MysqlPoolState {
    /// Config as of connect. The credentials are reused when a later
    /// `switch_database` builds a new sub-pool.
    config: Option<ConnectionConfig>,
    /// `db_name → MySqlPool` cache. Bounded by `MYSQL_SUBPOOL_CAP`.
    pools: HashMap<String, MySqlPool>,
    /// The currently active database. `None` means disconnected.
    current_db: Option<String>,
    /// `SELECT VERSION()` parsed at connect time. Unknown means gated
    /// metadata features stay disabled.
    server_version: Option<MysqlServerVersion>,
    /// LRU ordering — oldest at the front, most recently used at the back.
    lru_order: VecDeque<String>,
}

#[derive(Clone)]
pub struct MysqlAdapter {
    inner: Arc<Mutex<MysqlPoolState>>,
    pub(super) kind: crate::models::DatabaseType,
}

impl Default for MysqlAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl MysqlAdapter {
    pub fn new() -> Self {
        Self::new_for(crate::models::DatabaseType::Mysql)
    }

    pub fn new_mariadb() -> Self {
        Self::new_for(crate::models::DatabaseType::Mariadb)
    }

    fn new_for(kind: crate::models::DatabaseType) -> Self {
        Self {
            inner: Arc::new(Mutex::new(MysqlPoolState::default())),
            kind,
        }
    }

    /// Compose `MySqlConnectOptions` through the builder — avoiding string
    /// interpolation blocks injection.
    ///
    /// Issue #1062 / #1649 — wire the model's sslmode posture onto
    /// `MySqlSslMode` so an operator who turned TLS on is never silently
    /// downgraded to plaintext by sqlx's default `ssl-mode=PREFERRED`. #1649
    /// (ADR 0058) adds `verify-ca` — the user CA (`ca_cert_path`) is handed to
    /// `ssl_ca` as an **additional** trust anchor.
    ///
    /// `MySqlSslMode::VerifyCa` is deliberately never chosen: that mode turns
    /// hostname verification off (`sqlx-mysql-0.8.6/src/connection/tls.rs:64`)
    /// while removing none of the bundled Mozilla roots
    /// (`sqlx-core-0.8.6/src/net/tls/tls_rustls.rs:141`), so it only gets
    /// weaker than `VerifyIdentity`, never narrower. The `db::tls` module docs
    /// carry the evidence. The one reason this is fallible is the fail-closed
    /// rejection of `verify-ca` with no CA.
    fn connect_options(config: &ConnectionConfig) -> Result<MySqlConnectOptions, AppError> {
        let options = MySqlConnectOptions::new()
            .host(&config.host)
            .port(config.port)
            .username(&config.user)
            .password(&config.password)
            .database(&config.database);
        Ok(match resolve_tls_decision(config)? {
            TlsDecision::Disable => options.ssl_mode(MySqlSslMode::Disabled),
            TlsDecision::Default => options,
            TlsDecision::RequireSkipVerify => options.ssl_mode(MySqlSslMode::Required),
            TlsDecision::RequireVerifyFull { extra_ca_cert_path } => {
                let options = options.ssl_mode(MySqlSslMode::VerifyIdentity);
                match extra_ca_cert_path {
                    Some(ca_cert_path) => options.ssl_ca(ca_cert_path),
                    None => options,
                }
            }
        })
    }

    /// One-shot probe with a 5s timeout. Follows the PG `test` pattern.
    pub async fn test(config: &ConnectionConfig) -> Result<(), AppError> {
        let options = Self::connect_options(config)?;
        let pool = MySqlPoolOptions::new()
            .max_connections(1)
            .acquire_timeout(std::time::Duration::from_secs(5))
            .connect_with(options)
            .await
            .map_err(mysql_connection_error)?;

        let result = sqlx::query("SELECT 1")
            .execute(&pool)
            .await
            .map_err(mysql_connection_error);

        pool.close().await;
        result?;

        Ok(())
    }

    pub async fn connect_pool(&self, config: &ConnectionConfig) -> Result<(), AppError> {
        let options = Self::connect_options(config)?;
        let pool = pool_options(config)
            .connect_with(options)
            .await
            .map_err(mysql_connection_error)?;

        let server_version = detect_server_version(&pool, &self.kind).await;

        info!("Connected to MySQL at {}:{}", config.host, config.port);

        // Same as the PG pattern — clone first, then enter the lock and update
        // multiple fields.
        let stored_config = config.clone();
        let db_for_pools = config.database.clone();
        let db_for_lru = config.database.clone();
        let db_for_current = config.database.clone();
        let mut guard = self.inner.lock().await;
        guard.config = Some(stored_config);
        guard.pools.insert(db_for_pools, pool);
        guard.lru_order.push_back(db_for_lru);
        guard.current_db = Some(db_for_current);
        guard.server_version = server_version;
        Ok(())
    }

    pub async fn disconnect_pool(&self) -> Result<(), AppError> {
        let mut guard = self.inner.lock().await;
        let pools: Vec<MySqlPool> = guard.pools.drain().map(|(_, p)| p).collect();
        guard.lru_order.clear();
        guard.current_db = None;
        guard.config = None;
        guard.server_version = None;
        let had_pools = !pools.is_empty();
        drop(guard);
        for pool in pools {
            pool.close().await;
        }
        if had_pools {
            info!("Disconnected from MySQL");
        }
        Ok(())
    }

    /// A clone of the active sub-pool. Called while disconnected it returns
    /// `Not connected`.
    pub(super) async fn active_pool(&self) -> Result<MySqlPool, AppError> {
        let guard = self.inner.lock().await;
        let db = guard
            .current_db
            .as_ref()
            .ok_or_else(|| AppError::Connection("Not connected".into()))?;
        guard
            .pools
            .get(db)
            .cloned()
            .ok_or_else(|| AppError::Connection("Not connected".into()))
    }

    /// The sub-pool LRU equivalent of `USE <db>`. Same 4-step pattern as PG's
    /// `switch_active_db`: lock → hit/miss → (on a miss build a new pool,
    /// releasing the lock across the await) → re-lock, then install + evict.
    pub async fn switch_active_db(&self, db_name: &str) -> Result<(), AppError> {
        if db_name.is_empty() {
            return Err(AppError::Validation(
                "Database name must not be empty".into(),
            ));
        }

        enum SwitchPath {
            Hit,
            Miss(Box<ConnectionConfig>),
        }
        let path = {
            let mut guard = self.inner.lock().await;
            if guard.pools.contains_key(db_name) {
                guard.current_db = Some(db_name.to_string());
                guard.lru_order.retain(|name| name != db_name);
                guard.lru_order.push_back(db_name.to_string());
                SwitchPath::Hit
            } else {
                let config = guard
                    .config
                    .as_ref()
                    .cloned()
                    .ok_or_else(|| AppError::Connection("Not connected".into()))?;
                SwitchPath::Miss(Box::new(config))
            }
        };

        match path {
            SwitchPath::Hit => {
                info!("Switched active MySQL db to {}", db_name);
                Ok(())
            }
            SwitchPath::Miss(boxed_config) => {
                let mut config = *boxed_config;
                config.database = db_name.to_string();
                let options = Self::connect_options(&config)?;
                let new_pool = pool_options(&config)
                    .connect_with(options)
                    .await
                    .map_err(|e| {
                        mysql_connection_error(format!(
                            "Failed to open sub-pool for db {db_name}: {e}"
                        ))
                    })?;

                let evicted: Option<MySqlPool> = {
                    let mut guard = self.inner.lock().await;
                    if guard.pools.contains_key(db_name) {
                        // race: another task installed the same db_name.
                        guard.current_db = Some(db_name.to_string());
                        guard.lru_order.retain(|name| name != db_name);
                        guard.lru_order.push_back(db_name.to_string());
                        drop(guard);
                        new_pool.close().await;
                        info!("Switched active MySQL db to {} (race resolved)", db_name);
                        return Ok(());
                    }
                    let evicted_pool = if guard.pools.len() >= MYSQL_SUBPOOL_CAP {
                        let current = guard
                            .current_db
                            .clone()
                            .unwrap_or_else(|| db_name.to_string());
                        let target = select_eviction_target(&guard.lru_order, &current);
                        target.and_then(|name| {
                            guard.lru_order.retain(|x| x != &name);
                            guard.pools.remove(&name)
                        })
                    } else {
                        None
                    };
                    guard.pools.insert(db_name.to_string(), new_pool);
                    guard.lru_order.push_back(db_name.to_string());
                    guard.current_db = Some(db_name.to_string());
                    evicted_pool
                };

                if let Some(pool) = evicted {
                    pool.close().await;
                }
                info!("Switched active MySQL db to {}", db_name);
                Ok(())
            }
        }
    }

    /// Name of the currently active database (the last `switch_active_db`
    /// choice, or the `connect_pool` seed). `None` while disconnected.
    pub async fn current_database_name(&self) -> Option<String> {
        self.inner.lock().await.current_db.clone()
    }

    pub async fn supports_check_constraint_catalog(&self) -> bool {
        self.inner
            .lock()
            .await
            .server_version
            .as_ref()
            .is_some_and(MysqlServerVersion::supports_check_constraint_catalog)
    }

    pub async fn ping(&self) -> Result<(), AppError> {
        let pool = self.active_pool().await?;
        sqlx::query("SELECT 1")
            .execute(&pool)
            .await
            .map_err(mysql_connection_error)?;
        Ok(())
    }

    /// Q5.3 (MySQL) — `KILL QUERY <thread_id>` on a **fresh, side
    /// connection**. The thread we are killing is busy executing
    /// the slow statement so it cannot accept the cancel itself; we open
    /// a dedicated 1-connection pool with a 5-second acquire timeout.
    ///
    /// MySQL semantics:
    /// * Success                → server replies OK, statement aborted.
    /// * Unknown thread id      → ER_NO_SUCH_THREAD (1094) — we surface
    ///   "unknown thread" so `classify_cancel_error` folds it onto
    ///   `AlreadyCompleted`.
    /// * Insufficient privilege → ER_KILL_DENIED_ERROR (1095) — surfaced
    ///   with "permission" so classification yields `PermissionDenied`.
    /// * Driver fault           → original sqlx error string forwarded.
    pub async fn cancel_query_native(&self, thread_id: i64) -> Result<(), AppError> {
        let config = {
            let guard = self.inner.lock().await;
            guard
                .config
                .clone()
                .ok_or_else(|| AppError::Connection("Not connected — cannot issue cancel".into()))?
        };

        let options = Self::connect_options(&config)?;
        let cancel_pool = MySqlPoolOptions::new()
            .max_connections(1)
            .acquire_timeout(std::time::Duration::from_secs(5))
            .connect_with(options)
            .await
            .map_err(|e| AppError::Database(format!("cancel side-connect failed: {e}")))?;

        // KILL QUERY accepts no parameter binding — build the SQL with
        // the integer interpolated directly. Cast `thread_id` to u64 so
        // negative numbers (impossible in MySQL but possible from
        // callers) never produce a leading minus.
        let safe_id = thread_id.max(0) as u64;
        let sql = format!("KILL QUERY {safe_id}");
        let result = sqlx::query(&sql).execute(&cancel_pool).await;

        cancel_pool.close().await;

        match result {
            Ok(_) => Ok(()),
            Err(e) => {
                let msg = e.to_string();
                // Re-shape the canonical MySQL strings so classify_cancel_error
                // routes onto our three buckets deterministically.
                let normalised = if msg.contains("1094")
                    || msg.to_ascii_lowercase().contains("unknown thread id")
                {
                    format!("unknown thread id: {msg}")
                } else if msg.contains("1095")
                    || msg.to_ascii_lowercase().contains("not permitted")
                    || msg.to_ascii_lowercase().contains("kill denied")
                {
                    format!("permission denied: {msg}")
                } else {
                    msg
                };
                Err(AppError::Database(normalised))
            }
        }
    }
}

/// Issue #1453 — every driver-sourced connect/ping error routes through the
/// redacting constructor so a conn-string / URI echo in the driver text can
/// never surface a plaintext password. Follows the PG `pg_connection_error`
/// pattern.
fn mysql_connection_error(err: impl std::fmt::Display) -> AppError {
    AppError::connection_redacted(err.to_string())
}

async fn detect_server_version(
    pool: &MySqlPool,
    kind: &crate::models::DatabaseType,
) -> Option<MysqlServerVersion> {
    let raw = sqlx::query_scalar::<_, String>("SELECT VERSION()")
        .fetch_one(pool)
        .await
        .ok()?;
    parse_mysql_server_version(&raw, kind)
}

/// Pick the first entry from the LRU front that is not `current` as the
/// eviction target. Equivalent to PG's `select_eviction_target` — the currently
/// active DB is protected first.
fn select_eviction_target(lru: &VecDeque<String>, current: &str) -> Option<String> {
    for name in lru {
        if name != current {
            return Some(name.clone());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    //! Reason (2026-05-13): MySQL pool calls cannot be verified without a real
    //! DB. This module checks only the sync state — struct construction, the
    //! initial state, the disconnect path of ping/active_pool, and the LRU
    //! eviction selector. Real-DB integration tests run behind the
    //! `mysql_test_config` opt-in (`tests/mysql_integration.rs`).
    use super::*;
    use crate::models::{ConnectionConfig, DatabaseType, SslMode};

    fn sample_config() -> ConnectionConfig {
        ConnectionConfig {
            id: "test".to_string(),
            name: "TestMysql".to_string(),
            db_type: DatabaseType::Mysql,
            host: "localhost".to_string(),
            port: 3306,
            user: "root".to_string(),
            password: "secret".to_string(),
            database: "testdb".to_string(),
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
        }
    }

    #[tokio::test]
    async fn new_adapter_has_no_pool() {
        let adapter = MysqlAdapter::new();
        let guard = adapter.inner.lock().await;
        assert!(
            guard.pools.is_empty(),
            "New adapter should have no MySqlPool"
        );
        assert!(
            guard.current_db.is_none(),
            "New adapter should have no current_db"
        );
        assert!(
            guard.config.is_none(),
            "New adapter should have no stored config"
        );
        assert!(
            guard.server_version.is_none(),
            "New adapter should have no server_version"
        );
    }

    #[tokio::test]
    async fn ping_without_connection_fails() {
        let adapter = MysqlAdapter::new();
        let result = adapter.ping().await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("Not connected"),
            "Expected 'Not connected' error, got: {err_msg}"
        );
    }

    #[tokio::test]
    async fn active_pool_without_connection_fails() {
        let adapter = MysqlAdapter::new();
        let result = adapter.active_pool().await;
        match result {
            Err(AppError::Connection(msg)) => assert!(msg.contains("Not connected")),
            other => panic!("Expected Connection error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn switch_active_db_empty_rejects() {
        let adapter = MysqlAdapter::new();
        let result = adapter.switch_active_db("").await;
        match result {
            Err(AppError::Validation(msg)) => assert!(msg.contains("must not be empty")),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn switch_active_db_without_connection_fails() {
        let adapter = MysqlAdapter::new();
        let result = adapter.switch_active_db("other").await;
        match result {
            Err(AppError::Connection(msg)) => assert!(msg.contains("Not connected")),
            other => panic!("Expected Connection error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn check_constraint_catalog_support_is_false_without_version_context() {
        let adapter = MysqlAdapter::new();

        assert!(!adapter.supports_check_constraint_catalog().await);
    }

    #[test]
    fn connect_options_builder_reflects_config() {
        let config = sample_config();
        let opts = MysqlAdapter::connect_options(&config).unwrap();
        let opts_str = format!("{opts:?}");
        assert!(
            opts_str.contains("localhost") || opts_str.contains("3306"),
            "Options should reflect the config parameters: {opts_str}"
        );
    }

    // Issue #1062 / #1649 — regression guard for the silent TLS downgrade and
    // for the sslmode → MySqlSslMode mapping. Before #1062 `connect_options`
    // never set `ssl_mode`, so an encrypting posture fell back to sqlx's default
    // `Preferred` ("encrypt if possible, else plaintext"). These pin each
    // posture's mapping.

    #[test]
    fn connect_options_prefer_preserves_preferred() {
        let config = sample_config();
        let opts = MysqlAdapter::connect_options(&config).unwrap();
        assert!(
            matches!(opts.get_ssl_mode(), MySqlSslMode::Preferred),
            "ssl_mode=prefer must leave the default Preferred ssl_mode"
        );
    }

    #[test]
    fn connect_options_require_maps_to_required() {
        let mut config = sample_config();
        config.ssl_mode = SslMode::Require;
        let opts = MysqlAdapter::connect_options(&config).unwrap();
        assert!(
            matches!(opts.get_ssl_mode(), MySqlSslMode::Required),
            "ssl_mode=require must force encryption without cert verification"
        );
    }

    #[test]
    fn connect_options_verify_full_maps_to_verify_identity() {
        let mut config = sample_config();
        config.ssl_mode = SslMode::VerifyFull;
        let opts = MysqlAdapter::connect_options(&config).unwrap();
        assert!(
            matches!(opts.get_ssl_mode(), MySqlSslMode::VerifyIdentity),
            "ssl_mode=verify-full must verify CA + host identity"
        );
    }

    #[test]
    fn connect_options_verify_ca_keeps_hostname_verification_and_adds_the_ca() {
        // Reason: #1649 — `MySqlSslMode::VerifyCa` sets
        // `accept_invalid_hostnames = true`
        // (`sqlx-mysql-0.8.6/src/connection/tls.rs:64`) on a root store that
        // still holds every bundled Mozilla root — `ssl_ca` is `add()`ed on top
        // of `certs_from_webpki()`, never substituted for it
        // (`sqlx-core-0.8.6/src/net/tls/tls_rustls.rs:141` + `:153`). The posture
        // must land on `VerifyIdentity` with the CA as an *extra* anchor. The
        // path assertion is load-bearing: the mode alone would still pass if the
        // `ssl_ca` call were dropped, which is the whole feature. (2026-08-02)
        let mut config = sample_config();
        config.ssl_mode = SslMode::VerifyCa;
        config.ca_cert_path = Some("/etc/ssl/private-ca.pem".into());
        let opts = MysqlAdapter::connect_options(&config).unwrap();
        assert!(
            matches!(opts.get_ssl_mode(), MySqlSslMode::VerifyIdentity),
            "ssl_mode=verify-ca must keep hostname verification on, got {:?}",
            opts.get_ssl_mode()
        );
        let opts_str = format!("{opts:?}");
        assert!(
            opts_str.contains("private-ca.pem"),
            "verify-ca must forward the CA path to ssl_ca: {opts_str}"
        );
    }

    #[test]
    fn connect_options_never_select_the_hostname_skipping_mode() {
        // Reason: #1649 — PG parity guard. `MySqlSslMode::VerifyCa` is the one
        // verifying mode sqlx routes through `NoHostnameTlsVerifier`
        // (`sqlx-core-0.8.6/src/net/tls/tls_rustls.rs:165`); no posture may reach
        // it. (2026-08-02)
        for mode in [
            SslMode::Disable,
            SslMode::Prefer,
            SslMode::Require,
            SslMode::VerifyCa,
            SslMode::VerifyFull,
        ] {
            let mut config = sample_config();
            config.ssl_mode = mode;
            config.ca_cert_path = Some("/etc/ssl/private-ca.pem".into());
            let opts = MysqlAdapter::connect_options(&config)
                .unwrap_or_else(|e| panic!("{mode:?} must resolve, got: {e}"));
            assert!(
                !matches!(opts.get_ssl_mode(), MySqlSslMode::VerifyCa),
                "{mode:?} reached MySqlSslMode::VerifyCa, which disables hostname \
                 verification while still trusting every bundled public root"
            );
        }
    }

    #[test]
    fn connect_options_verify_ca_without_ca_fails_closed() {
        // Reason: #1649 — a `verify-ca` posture with no CA file names a trust
        // anchor it does not have, making it byte-for-byte the verify-full it
        // advertises itself as stricter than. Rejected before it reaches sqlx
        // (PG parity, libpq semantics). (2026-08-02)
        let mut config = sample_config();
        config.ssl_mode = SslMode::VerifyCa;
        config.ca_cert_path = None;
        let err = MysqlAdapter::connect_options(&config)
            .expect_err("verify-ca without a CA file must not reach sqlx");
        assert!(
            matches!(err, AppError::Validation(_)),
            "expected a validation rejection, got: {err}"
        );
    }

    #[test]
    fn connect_options_disable_forces_plaintext() {
        // Reason: #1063 — the sslmode `disable` selection must reach
        // `MySqlSslMode::Disabled`, distinct from the opportunistic Preferred
        // default an unset config keeps. (2026-07-17)
        let mut config = sample_config();
        config.ssl_mode = SslMode::Disable;
        let opts = MysqlAdapter::connect_options(&config).unwrap();
        assert!(
            matches!(opts.get_ssl_mode(), MySqlSslMode::Disabled),
            "sslmode=disable must force plaintext, not opportunistic Preferred"
        );
    }

    #[test]
    fn select_eviction_target_skips_current() {
        let mut lru = VecDeque::new();
        lru.push_back("a".to_string());
        lru.push_back("b".to_string());
        lru.push_back("c".to_string());
        // When the front entry "a" is current, the second one, "b", is picked.
        assert_eq!(select_eviction_target(&lru, "a"), Some("b".to_string()));
        // When current is nowhere in the LRU, the front stands (nothing to
        // protect).
        assert_eq!(select_eviction_target(&lru, "z"), Some("a".to_string()));
    }

    #[test]
    fn select_eviction_target_only_current_returns_none() {
        let mut lru = VecDeque::new();
        lru.push_back("solo".to_string());
        // With only current present there is no eviction candidate (same policy
        // as PG).
        assert_eq!(select_eviction_target(&lru, "solo"), None);
    }

    // Reason: issue #1453 — sqlx/driver error text can echo the connection
    // URI or `password=` pair; the shared connection-error mapper must mask
    // the secret while keeping the host so the error stays actionable
    // (2026-07-10).
    #[test]
    fn mysql_connection_error_masks_credential_echo() {
        let message = mysql_connection_error(
            "cannot connect to mysql://root:S3cretPw1@db.local:3306/app password=S3cretPw1",
        )
        .to_string();
        assert!(
            !message.contains("S3cretPw1"),
            "leaked plaintext credential: {message}"
        );
        assert!(message.contains("db.local:3306"));
    }
}
