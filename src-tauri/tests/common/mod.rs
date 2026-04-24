//! Shared test utilities for integration tests.
//!
//! Provides per-DBMS connection configuration, a graceful adapter setup
//! function that returns `None` (and prints a skip message) when the target
//! database is unavailable, and a helper to enumerate which DBMS types have
//! running instances.

use table_view_lib::db::mongodb::MongoAdapter;
use table_view_lib::db::postgres::PostgresAdapter;
use table_view_lib::db::DbAdapter;
use table_view_lib::models::{ConnectionConfig, DatabaseType};

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
///   MySQL      — `MYSQL_HOST`, `MYSQL_TCP_PORT`, `MYSQL_USER`, `MYSQL_PWD`, `MYSQL_DATABASE`
///   MongoDB    — `MONGO_HOST`, `MONGO_PORT`, `MONGO_USER`, `MONGO_PASSWORD`, `MONGO_DATABASE`
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
            database: env_or("PGDATABASE", "table_view_test"),
            group_id: None,
            color: None,
            connection_timeout: Some(5),
            keep_alive_interval: None,
            environment: None,
            auth_source: None,
            replica_set: None,
            tls_enabled: None,
        },
        DatabaseType::Mysql => ConnectionConfig {
            id: "test-conn".to_string(),
            name: "TestDB".to_string(),
            db_type: DatabaseType::Mysql,
            host: env_or("MYSQL_HOST", "localhost"),
            port: env_or("MYSQL_TCP_PORT", "3306").parse().unwrap_or(3306),
            user: env_or("MYSQL_USER", "testuser"),
            password: env_or("MYSQL_PWD", "testpass"),
            database: env_or("MYSQL_DATABASE", "table_view_test"),
            group_id: None,
            color: None,
            connection_timeout: Some(5),
            keep_alive_interval: None,
            environment: None,
            auth_source: None,
            replica_set: None,
            tls_enabled: None,
        },
        DatabaseType::Mongodb => ConnectionConfig {
            id: "test-conn".to_string(),
            name: "TestMongo".to_string(),
            db_type: DatabaseType::Mongodb,
            host: env_or("MONGO_HOST", "localhost"),
            port: env_or("MONGO_PORT", "27017").parse().unwrap_or(27017),
            user: env_or("MONGO_USER", "testuser"),
            password: env_or("MONGO_PASSWORD", "testpass"),
            database: env_or("MONGO_DATABASE", "table_view_test"),
            group_id: None,
            color: None,
            connection_timeout: Some(5),
            keep_alive_interval: None,
            environment: None,
            // docker-compose.test.yml initialises mongo with the default
            // auth database `admin`, so auth_source must point there when
            // credentials are exercised.
            auth_source: Some("admin".to_string()),
            replica_set: None,
            tls_enabled: None,
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
    // Currently only PostgresAdapter is returned by this helper; the mongo
    // variant has its own dedicated helper (`setup_mongo_adapter`) because
    // the concrete adapter type differs.
    assert!(
        matches!(db_type, DatabaseType::Postgresql),
        "setup_adapter: only PostgreSQL is supported at this time. \
         Use setup_mongo_adapter for MongoDB."
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

/// Attempt to connect to the MongoDB test database and return a connected
/// `MongoAdapter`. Returns `None` with a skip message when the database is
/// unavailable — mirrors the Postgres skip pattern so the integration test
/// can exit 0 when Docker is not running.
#[allow(dead_code)]
pub async fn setup_mongo_adapter() -> Option<MongoAdapter> {
    let config = test_config(DatabaseType::Mongodb);
    let adapter = MongoAdapter::new();
    match adapter.connect(&config).await {
        Ok(()) => Some(adapter),
        Err(e) => {
            println!(
                "SKIP: MongoDB database not available ({}). \
                 Start with: docker compose -f docker-compose.test.yml up -d mongodb",
                e
            );
            None
        }
    }
}

/// Return the list of DBMS types that are currently reachable.
///
/// Probes each supported DBMS by attempting a short-lived connection using
/// [`test_config`]. Only types whose connection succeeds are included in the
/// returned vec. This is useful for parameterised or conditional test
/// selection in future multi-DBMS integration suites.
#[allow(dead_code)]
pub async fn available_dbms() -> Vec<DatabaseType> {
    let candidates = vec![DatabaseType::Postgresql, DatabaseType::Mongodb];
    let mut available = Vec::new();

    for db_type in candidates {
        match db_type {
            DatabaseType::Postgresql => {
                let config = test_config(db_type.clone());
                let adapter = PostgresAdapter::new();
                if adapter.connect_pool(&config).await.is_ok() {
                    available.push(db_type);
                }
            }
            DatabaseType::Mongodb => {
                let config = test_config(db_type.clone());
                let adapter = MongoAdapter::new();
                if adapter.connect(&config).await.is_ok() {
                    available.push(db_type);
                }
            }
            _ => {}
        }
    }

    available
}
