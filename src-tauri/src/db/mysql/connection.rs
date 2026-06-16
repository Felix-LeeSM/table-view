//! MySQL connection lifecycle — `MysqlAdapter` struct + connect / disconnect
//! / ping + multi-DB sub-pool LRU.
//!
//! Sprint 279 (skeleton) → Sprint 287 (Slice G, multi-DB).
//!
//! PG (`db/postgres/connection.rs`) 의 패턴과 동일 — `Arc<Mutex<...>>` 안에
//! `db_name → MySqlPool` cache + LRU order + current_db. MySQL 은 PG 처럼
//! database 마다 독립 connection 이 자연스럽고 (`USE` 명령 대신 connect
//! string 의 `/database` 부분 교체), sub-pool 별로 자체 pool 식별이 유지돼
//! 다른 DB 의 long-running query 가 active DB 의 fairness 를 안 깬다.

use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use sqlx::MySqlPool;
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::info;

use crate::error::AppError;
use crate::models::ConnectionConfig;

use super::version::{parse_mysql_server_version, MysqlServerVersion};

/// Per-pool sqlx connection cap. PG 의 `PG_POOL_MAX_CONNECTIONS` (5) 와
/// 동일한 의도 — interactive UI 의 동시 in-flight 1 + meta probe 몇 개를
/// 커버하는 보수적 budget.
const MYSQL_POOL_MAX_CONNECTIONS: u32 = 5;

/// Hard ceiling for `MySqlPoolOptions::acquire_timeout`. PG 패턴 답습.
const MYSQL_POOL_ACQUIRE_TIMEOUT_MAX_SECS: u64 = 30;

/// Default fallback for `ConnectionConfig::connection_timeout` when unset.
const MYSQL_POOL_ACQUIRE_TIMEOUT_DEFAULT_SECS: u32 = 300;

/// PG `PG_SUBPOOL_CAP` (8) 와 동일 — sub-pool cache 가 무한히 자라지 않게
/// 막는 LRU 한계. 매 DB switch 마다 새 pool 을 열 수 있으므로 user 가 10+
/// DB 를 사이클링하면 cache 가 새지 않게 한다.
const MYSQL_SUBPOOL_CAP: usize = 8;

/// Inner mutable state. PG `PgPoolState` 와 동등.
#[derive(Default)]
pub struct MysqlPoolState {
    /// Connect 당시 config. credentials 가 후속 `switch_database` 에서
    /// 새 sub-pool 을 만들 때 재사용된다.
    config: Option<ConnectionConfig>,
    /// `db_name → MySqlPool` cache. `MYSQL_SUBPOOL_CAP` 로 bounded.
    pools: HashMap<String, MySqlPool>,
    /// 현재 활성 database. `None` 이면 disconnected.
    current_db: Option<String>,
    /// `SELECT VERSION()` parsed at connect time. Unknown means gated
    /// metadata features stay disabled.
    server_version: Option<MysqlServerVersion>,
    /// LRU ordering — 오래된 것이 front, 최근 사용된 것이 back.
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

    /// `MySqlConnectOptions` 를 builder 로 안전 조합 — string interpolation
    /// 회피로 injection 차단.
    fn connect_options(config: &ConnectionConfig) -> MySqlConnectOptions {
        MySqlConnectOptions::new()
            .host(&config.host)
            .port(config.port)
            .username(&config.user)
            .password(&config.password)
            .database(&config.database)
    }

    /// 5s timeout 의 one-shot probe. PG `test` 패턴 답습.
    pub async fn test(config: &ConnectionConfig) -> Result<(), AppError> {
        let options = Self::connect_options(config);
        let pool = MySqlPoolOptions::new()
            .max_connections(1)
            .acquire_timeout(std::time::Duration::from_secs(5))
            .connect_with(options)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;

        let result = sqlx::query("SELECT 1")
            .execute(&pool)
            .await
            .map_err(|e| AppError::Connection(e.to_string()));

        pool.close().await;
        result?;

        Ok(())
    }

    pub async fn connect_pool(&self, config: &ConnectionConfig) -> Result<(), AppError> {
        let options = Self::connect_options(config);
        let timeout_secs = config
            .connection_timeout
            .unwrap_or(MYSQL_POOL_ACQUIRE_TIMEOUT_DEFAULT_SECS);
        let pool = MySqlPoolOptions::new()
            .max_connections(MYSQL_POOL_MAX_CONNECTIONS)
            .acquire_timeout(std::time::Duration::from_secs(
                (timeout_secs as u64).min(MYSQL_POOL_ACQUIRE_TIMEOUT_MAX_SECS),
            ))
            .connect_with(options)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;

        let server_version = detect_server_version(&pool, &self.kind).await;

        info!("Connected to MySQL at {}:{}", config.host, config.port);

        // PG 패턴과 동일 — clone 후 lock 안에 들어가서 multi-field 갱신.
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

    /// 활성 sub-pool 의 clone. disconnect 상태에서 호출되면 `Not connected`.
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

    /// Sprint 287 — sub-pool LRU 기반 `USE <db>` 등가. PG `switch_active_db`
    /// 와 동일한 4-step pattern: lock → hit/miss → (miss 면 새 pool 빌드,
    /// await 동안 lock 놓음) → 재-lock 후 install + evict.
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
                let options = Self::connect_options(&config);
                let timeout_secs = config
                    .connection_timeout
                    .unwrap_or(MYSQL_POOL_ACQUIRE_TIMEOUT_DEFAULT_SECS);
                let new_pool = MySqlPoolOptions::new()
                    .max_connections(MYSQL_POOL_MAX_CONNECTIONS)
                    .acquire_timeout(std::time::Duration::from_secs(
                        (timeout_secs as u64).min(MYSQL_POOL_ACQUIRE_TIMEOUT_MAX_SECS),
                    ))
                    .connect_with(options)
                    .await
                    .map_err(|e| {
                        AppError::Connection(format!(
                            "Failed to open sub-pool for db {}: {}",
                            db_name, e
                        ))
                    })?;

                let evicted: Option<MySqlPool> = {
                    let mut guard = self.inner.lock().await;
                    if guard.pools.contains_key(db_name) {
                        // race: 다른 작업이 동일 db_name 을 install 함.
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

    /// 현재 활성 database 이름 (`switch_active_db` 마지막 선택, 또는
    /// `connect_pool` 의 seed). disconnect 상태에선 `None`.
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
            .map_err(|e| AppError::Connection(e.to_string()))?;
        Ok(())
    }

    /// Sprint 359 (Q5.3 MySQL) — `KILL QUERY <thread_id>` on a **fresh,
    /// side connection**. The thread we are killing is busy executing
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

        let options = Self::connect_options(&config);
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

/// LRU front 의 `current` 가 아닌 첫 entry 를 eviction 대상으로 선택. PG
/// `select_eviction_target` 와 동등 — 현재 active 가 우선 보호된다.
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
    //! 작성 이유 (2026-05-13, Sprint 279 → 287 확장): MySQL pool 호출은 실
    //! DB 없이는 검증 불가. 여기서는 sync state (struct 생성, 초기 상태,
    //! ping/active_pool 의 disconnect 경로, LRU eviction selector) 만 검증.
    //! 실 DB 통합 test 는 Sprint 280+ 에서 `mysql_test_config` opt-in 으로.
    use super::*;
    use crate::models::{ConnectionConfig, DatabaseType};

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
            tls_enabled: None,
            trust_server_certificate: None,
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
        let opts = MysqlAdapter::connect_options(&config);
        let opts_str = format!("{opts:?}");
        assert!(
            opts_str.contains("localhost") || opts_str.contains("3306"),
            "Options should reflect the config parameters: {opts_str}"
        );
    }

    #[test]
    fn select_eviction_target_skips_current() {
        let mut lru = VecDeque::new();
        lru.push_back("a".to_string());
        lru.push_back("b".to_string());
        lru.push_back("c".to_string());
        // front 의 "a" 가 current 일 때 — 두 번째 "b" 를 골라야 한다.
        assert_eq!(select_eviction_target(&lru, "a"), Some("b".to_string()));
        // current 가 LRU 어디에도 없으면 front 그대로 (보호 대상 없음).
        assert_eq!(select_eviction_target(&lru, "z"), Some("a".to_string()));
    }

    #[test]
    fn select_eviction_target_only_current_returns_none() {
        let mut lru = VecDeque::new();
        lru.push_back("solo".to_string());
        // current 만 있으면 eviction 후보 없음 (PG 와 동일 정책).
        assert_eq!(select_eviction_target(&lru, "solo"), None);
    }
}
