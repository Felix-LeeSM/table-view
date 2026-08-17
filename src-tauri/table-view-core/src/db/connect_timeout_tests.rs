//! Issue #2429 — what every dialing adapter hands its driver as the connect
//! deadline.
//!
//! The reported symptom is wall-clock ("a dead host takes ~30s to fail"), but
//! asserting wall-clock needs a host that swallows packets, which no CI runner
//! can promise. So each test asserts the **value that reaches the driver**,
//! which is what decides that wall-clock.
//!
//! One test per adapter that dials a network host, driven off the same
//! `connection_timeout: None` the UI stores for a connection whose Advanced
//! Settings were never touched. File-backed adapters (SQLite, DuckDB) are out
//! of the population: they have no host to be unreachable, and their
//! `connection_timeout` is a pool-acquire budget on a local file.

use std::time::Duration;

use crate::db::mongodb::connection::{MongoAdapter, MONGO_CONNECT_TIMEOUT_MAX_SECS};
use crate::db::mssql::MssqlAdapter;
use crate::db::mysql::connection::pool_options as mysql_pool_options;
use crate::db::oracle::connection_timeout_secs as oracle_connection_timeout_secs;
use crate::db::postgres::connection::pool_options as pg_pool_options;
use crate::db::redis::helpers::connect_timeout as redis_connect_timeout;
use crate::db::search_http::search_http_timeout;
use crate::models::{ConnectionConfig, DatabaseType, SslMode};

/// The shipped default, written as a literal rather than read back from
/// `CONNECT_TIMEOUT_DEFAULT_SECS`. A test that derives its expectation from the
/// constant it is testing passes for whatever value that constant drifts to.
const EXPECTED_DEFAULT_SECS: u64 = 10;

/// A connection saved without touching Advanced Settings — the shape behind
/// the report. `db_type` is per-test irrelevant: every resolver below reads
/// `connection_timeout` alone.
fn unset(db_type: DatabaseType, port: u16) -> ConnectionConfig {
    ConnectionConfig {
        id: "c1".into(),
        name: "unreachable".into(),
        db_type,
        host: "192.0.2.1".into(), // TEST-NET-1, guaranteed unroutable (RFC 5737)
        port,
        user: "u".into(),
        password: "p".into(),
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
    }
}

fn default_timeout() -> Duration {
    Duration::from_secs(EXPECTED_DEFAULT_SECS)
}

#[test]
fn connect_timeout_unset_reaches_postgres_driver_as_default() {
    assert_eq!(
        pg_pool_options(&unset(DatabaseType::Postgresql, 5432)).get_acquire_timeout(),
        default_timeout()
    );
}

#[test]
fn connect_timeout_unset_reaches_mysql_driver_as_default() {
    assert_eq!(
        mysql_pool_options(&unset(DatabaseType::Mysql, 3306)).get_acquire_timeout(),
        default_timeout()
    );
}

#[test]
fn connect_timeout_unset_reaches_mssql_driver_as_default() {
    assert_eq!(
        MssqlAdapter::connection_timeout(&unset(DatabaseType::Mssql, 1433)),
        default_timeout()
    );
}

#[test]
fn connect_timeout_unset_reaches_oracle_driver_as_default() {
    assert_eq!(
        oracle_connection_timeout_secs(&unset(DatabaseType::Oracle, 1521)),
        EXPECTED_DEFAULT_SECS
    );
}

/// Mongo needs both knobs. `server_selection_timeout` is the one that decides
/// the wait for an unreachable host — the driver keeps re-dialing until that
/// deadline, so a `connect_timeout` on its own would not shorten anything.
#[test]
fn connect_timeout_unset_reaches_mongodb_driver_as_default() {
    let opts = MongoAdapter::build_options(&unset(DatabaseType::Mongodb, 27017))
        .expect("build_options should succeed for a plain host/port config");
    assert_eq!(opts.connect_timeout, Some(default_timeout()));
    assert_eq!(opts.server_selection_timeout, Some(default_timeout()));
}

#[test]
fn connect_timeout_unset_reaches_redis_driver_as_default() {
    assert_eq!(
        redis_connect_timeout(&unset(DatabaseType::Redis, 6379)),
        default_timeout()
    );
}

#[test]
fn connect_timeout_unset_reaches_search_driver_as_default() {
    assert_eq!(
        search_http_timeout(&unset(DatabaseType::Elasticsearch, 9200)),
        default_timeout()
    );
}

/// The default is a fallback, not an override: an explicit value the user
/// typed still wins, and each driver still applies its own ceiling.
#[test]
fn connect_timeout_honours_user_value_up_to_each_driver_ceiling() {
    let mut config = unset(DatabaseType::Postgresql, 5432);

    config.connection_timeout = Some(3);
    assert_eq!(
        pg_pool_options(&config).get_acquire_timeout(),
        Duration::from_secs(3)
    );
    assert_eq!(
        MssqlAdapter::connection_timeout(&config),
        Duration::from_secs(3)
    );

    // Above the ceiling the two ceilings differ, and both still hold.
    config.connection_timeout = Some(600);
    assert_eq!(
        pg_pool_options(&config).get_acquire_timeout(),
        Duration::from_secs(u64::from(
            crate::db::postgres::connection::PG_POOL_ACQUIRE_TIMEOUT_MAX_SECS
        ))
    );
    assert_eq!(
        MssqlAdapter::connection_timeout(&config),
        Duration::from_secs(u64::from(MssqlAdapter::MAX_CONNECTION_TIMEOUT_SECS))
    );
    assert_eq!(
        MongoAdapter::build_options(&config)
            .expect("build_options should succeed")
            .server_selection_timeout,
        Some(Duration::from_secs(u64::from(
            MONGO_CONNECT_TIMEOUT_MAX_SECS
        )))
    );
}

/// A stored `0` used to mean "fail every connect instantly" on the pool-backed
/// adapters, which surfaces as an unreachable server rather than as a bad
/// setting. The shared resolver floors it at one second.
#[test]
fn connect_timeout_floors_a_stored_zero_at_one_second() {
    let mut config = unset(DatabaseType::Postgresql, 5432);
    config.connection_timeout = Some(0);

    assert_eq!(
        pg_pool_options(&config).get_acquire_timeout(),
        Duration::from_secs(1)
    );
    assert_eq!(
        mysql_pool_options(&config).get_acquire_timeout(),
        Duration::from_secs(1)
    );
    assert_eq!(oracle_connection_timeout_secs(&config), 1);
    assert_eq!(redis_connect_timeout(&config), Duration::from_secs(1));
    assert_eq!(search_http_timeout(&config), Duration::from_secs(1));
}
