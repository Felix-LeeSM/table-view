//! Shared test utilities for integration tests.
//!
//! Provides per-DBMS connection configuration and a graceful adapter setup
//! function that returns `None` (and prints a skip message) when the target
//! database is unavailable, allowing tests to pass without Docker.

use view_table_lib::db::postgres::PostgresAdapter;
use view_table_lib::models::{ConnectionConfig, DatabaseType};

/// Default host, port, user, password, and database for each DBMS when running
/// under `docker-compose.test.yml`. Values can be overridden with environment
/// variables.
fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

/// Return a `ConnectionConfig` for the given database type.
///
/// Environment variable overrides (per DBMS prefix):
///   PostgreSQL — `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`
///   MySQL      — `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`
pub fn test_config(db_type: DatabaseType) -> ConnectionConfig {
    match db_type {
        DatabaseType::Postgresql => ConnectionConfig {
            id: "test-conn".to_string(),
            name: "TestDB".to_string(),
            db_type: DatabaseType::Postgresql,
            host: env_or("PGHOST", "localhost"),
            port: env_or("PGPORT", "5432").parse().unwrap_or(5432),
            user: env_or("PGUSER", "testuser"),
            password: env_or("PGPASSWORD", "testpass"),
            database: env_or("PGDATABASE", "viewtable_test"),
            group_id: None,
            color: None,
            connection_timeout: Some(5),
            keep_alive_interval: None,
        },
        DatabaseType::Mysql => ConnectionConfig {
            id: "test-conn".to_string(),
            name: "TestDB".to_string(),
            db_type: DatabaseType::Mysql,
            host: env_or("MYSQL_HOST", "localhost"),
            port: env_or("MYSQL_PORT", "3306").parse().unwrap_or(3306),
            user: env_or("MYSQL_USER", "testuser"),
            password: env_or("MYSQL_PASSWORD", "testpass"),
            database: env_or("MYSQL_DATABASE", "viewtable_test"),
            group_id: None,
            color: None,
            connection_timeout: Some(5),
            keep_alive_interval: None,
        },
        other => panic!("test_config: unsupported DatabaseType {:?}", other),
    }
}

/// Attempt to connect to the requested database and return a connected adapter.
///
/// Returns `Some(adapter)` on success, or `None` with a skip message when the
/// database is unavailable. This pattern lets integration tests exit with code 0
/// even when Docker is not running.
#[allow(dead_code)]
pub async fn setup_adapter(db_type: DatabaseType) -> Option<PostgresAdapter> {
    // Currently only PostgresAdapter exists in the codebase.
    assert!(
        matches!(db_type, DatabaseType::Postgresql),
        "setup_adapter: only PostgreSQL is supported at this time"
    );

    let config = test_config(db_type);
    let adapter = PostgresAdapter::new();
    match adapter.connect_pool(&config).await {
        Ok(()) => Some(adapter),
        Err(e) => {
            println!(
                "SKIP: PostgreSQL database not available ({}). \
                 Start with: docker compose -f docker-compose.test.yml up -d",
                e
            );
            None
        }
    }
}
