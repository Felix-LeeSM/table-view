//! MySQL connection lifecycle — `MysqlAdapter` struct + connect / disconnect
//! / ping. Sprint 279 (Phase 17, skeleton).
//!
//! PG (`db/postgres/connection.rs`) 의 패턴을 답습한 minimal scaffold:
//! - sqlx 의 `MySqlPool` 을 `Arc<Mutex<...>>` 로 감싼 inner state.
//! - `test` (one-shot 5s acquire timeout) / `connect_pool` /
//!   `disconnect_pool` / `ping` 4 lifecycle method.
//!
//! Phase 17 의 이후 sprint (schema / queries / mutations) 에서 sub-pool
//! cache (PG `PgPoolState::pools`) 와 dialect-specific helper 를 점진
//! 확장한다. 현재는 단일 pool + 단일 active database 만 보유.

use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use sqlx::MySqlPool;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::info;

use crate::error::AppError;
use crate::models::ConnectionConfig;

/// Per-pool sqlx connection cap. PG 의 `PG_POOL_MAX_CONNECTIONS` (5) 와
/// 동일한 의도 — interactive UI 의 동시 in-flight 1 + meta probe 몇 개를
/// 커버하는 보수적 budget.
const MYSQL_POOL_MAX_CONNECTIONS: u32 = 5;

/// Hard ceiling for `MySqlPoolOptions::acquire_timeout`. PG 패턴 답습.
const MYSQL_POOL_ACQUIRE_TIMEOUT_MAX_SECS: u64 = 30;

/// Default fallback for `ConnectionConfig::connection_timeout` when unset.
const MYSQL_POOL_ACQUIRE_TIMEOUT_DEFAULT_SECS: u32 = 300;

/// Inner mutable state for a `MysqlAdapter`. PG 의 multi-db sub-pool cache
/// 와 달리 MySQL 은 database 가 곧 schema (`USE <db>`) 라 단일 pool 로
/// 시작; Sprint 280+ 에서 `current_db` 트래킹 + `USE <db>` 분기를 추가
/// 한다 (PG 의 `switch_active_db` 와 다른 design — Phase 17 sprint 17-04
/// 합류 시 결정).
#[derive(Default)]
pub struct MysqlPoolState {
    /// Connected pool. `None` 이면 disconnected.
    pool: Option<MySqlPool>,
    /// 마지막으로 `connect_pool` 에 넘어온 config. credentials / database 가
    /// 후속 sprint 의 `switch_database` 에서 새 pool 을 만들 때 재사용
    /// 된다. 현재는 logging / debug 용도만.
    config: Option<ConnectionConfig>,
}

#[derive(Clone)]
pub struct MysqlAdapter {
    inner: Arc<Mutex<MysqlPoolState>>,
}

impl Default for MysqlAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl MysqlAdapter {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(MysqlPoolState::default())),
        }
    }

    /// `MySqlConnectOptions` 를 builder 로 안전 조합 (PG 패턴 — string
    /// interpolation 회피 → injection 방지).
    fn connect_options(config: &ConnectionConfig) -> MySqlConnectOptions {
        MySqlConnectOptions::new()
            .host(&config.host)
            .port(config.port)
            .username(&config.user)
            .password(&config.password)
            .database(&config.database)
    }

    /// 5s timeout 으로 단일-connection probe (`SELECT 1`). PG 의 `test`
    /// 와 동일 — `CONNECT → SELECT 1 → CLOSE` defer 패턴.
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

        info!("Connected to MySQL at {}:{}", config.host, config.port);

        let stored_config = config.clone();
        let mut guard = self.inner.lock().await;
        guard.pool = Some(pool);
        guard.config = Some(stored_config);
        Ok(())
    }

    pub async fn disconnect_pool(&self) -> Result<(), AppError> {
        let mut guard = self.inner.lock().await;
        let pool = guard.pool.take();
        guard.config = None;
        let had_pool = pool.is_some();
        drop(guard);
        if let Some(p) = pool {
            p.close().await;
        }
        if had_pool {
            info!("Disconnected from MySQL");
        }
        Ok(())
    }

    /// 활성 pool 을 clone 해 반환 (PG 의 `active_pool` 패턴). disconnect
    /// 상태에서 호출되면 `Not connected` 에러.
    #[allow(dead_code)] // Sprint 280+ 의 schema / query 가 사용 예정
    pub(super) async fn active_pool(&self) -> Result<MySqlPool, AppError> {
        let guard = self.inner.lock().await;
        guard
            .pool
            .as_ref()
            .cloned()
            .ok_or_else(|| AppError::Connection("Not connected".into()))
    }

    pub async fn ping(&self) -> Result<(), AppError> {
        let pool = self.active_pool().await?;
        sqlx::query("SELECT 1")
            .execute(&pool)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    //! 작성 이유 (2026-05-13, Sprint 279): MySQL pool 호출은 실 DB 없이는
    //! 검증 불가. 여기서는 sync state (struct 생성, 초기 상태, ping/active_pool
    //! 의 disconnect 경로) 만 검증. real-DB 통합 test 는 Sprint 280+ 에서
    //! `mysql_test_config` opt-in 으로 추가.
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
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
            environment: None,
            auth_source: None,
            replica_set: None,
            tls_enabled: None,
        }
    }

    #[tokio::test]
    async fn new_adapter_has_no_pool() {
        let adapter = MysqlAdapter::new();
        let guard = adapter.inner.lock().await;
        assert!(guard.pool.is_none(), "New adapter should have no MySqlPool");
        assert!(
            guard.config.is_none(),
            "New adapter should have no stored config"
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

    #[test]
    fn connect_options_builder_reflects_config() {
        let config = sample_config();
        let opts = MysqlAdapter::connect_options(&config);
        // Sprint 279: PG 의 connect_options 와 동일 패턴 — Debug 출력에서
        // host/port 만 가시 확인. 비밀번호 / username 은 sqlx 가 의도적으로
        // mask 하므로 확인 불가능 (즉 password leak 회귀 가드 역할도 함).
        let opts_str = format!("{opts:?}");
        assert!(
            opts_str.contains("localhost") || opts_str.contains("3306"),
            "Options should reflect the config parameters: {opts_str}"
        );
    }
}
