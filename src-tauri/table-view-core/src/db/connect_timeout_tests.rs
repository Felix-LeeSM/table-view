//! Issue #2429 — what every dialing adapter hands its driver as the connect
//! deadline.
//!
//! The reported symptom is wall-clock ("a dead host takes ~30s to fail"), so
//! what has to hold is that the wait ends. Where the adapter hands the value
//! to a driver knob whose whole job is to end it, asserting the **value handed
//! to the driver** carries that, and those tests stop there.
//!
//! Oracle is where stopping there stopped being enough: oracle-rs 0.1.7 stores
//! `Config::connect_timeout` and never reads it while connecting, so the
//! handed value decided nothing. `OracleAdapter::dial` runs the connect under
//! its own budget instead, and
//! [`oracle_dial_gives_up_on_a_silent_server_within_its_budget`] asserts the
//! wall-clock that produces — against a local listener that accepts and then
//! stays silent, which hangs without needing a network or an unreachable host.
//! Read every other test here as "the adapter hands this out", never as "the
//! wait ends here".
//!
//! The unset-default tests run one per adapter that dials a network host, off
//! the same `connection_timeout: None` the UI stores for a connection whose
//! Advanced segment was never opened; the rest pin the ceilings and the
//! floor. File-backed adapters (SQLite, DuckDB) are out of the population:
//! they have no host to be unreachable, and their `connection_timeout` is a
//! pool-acquire budget on a local file.

use std::time::Duration;

use tokio::net::TcpListener;

use crate::db::mongodb::connection::{MongoAdapter, MONGO_CONNECT_TIMEOUT_MAX_SECS};
use crate::db::mssql::MssqlAdapter;
use crate::db::mysql::connection::pool_options as mysql_pool_options;
use crate::db::oracle::{connection_timeout_secs as oracle_connection_timeout_secs, OracleAdapter};
use crate::db::postgres::connection::pool_options as pg_pool_options;
use crate::db::redis::helpers::connect_timeout as redis_connect_timeout;
use crate::db::search_http::search_http_timeout;
use crate::db::DbAdapter;
use crate::models::{ConnectionConfig, DatabaseType, SslMode};

/// The shipped default, written as a literal rather than read back from
/// `CONNECT_TIMEOUT_DEFAULT_SECS`. A test that derives its expectation from the
/// constant it is testing passes for whatever value that constant drifts to.
const EXPECTED_DEFAULT_SECS: u64 = 10;

/// A connection saved without opening the Advanced segment — the shape behind
/// the report. `db_type` is per-test irrelevant: the resolvers below read
/// `connection_timeout` alone, and the one test that really dials overrides
/// `host` and `port` itself.
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

/// Oracle's value does not go to the driver the way the others do — it goes to
/// `OracleAdapter::dial`'s own budget (and, redundantly, to a
/// `Config::connect_timeout` the driver ignores). So this asserts the resolved
/// number only; what that number does to the wall-clock is
/// [`oracle_dial_gives_up_on_a_silent_server_within_its_budget`].
#[test]
fn connect_timeout_unset_resolves_to_the_default_for_the_oracle_dial() {
    assert_eq!(
        oracle_connection_timeout_secs(&unset(DatabaseType::Oracle, 1521)),
        EXPECTED_DEFAULT_SECS
    );
}

/// The wall-clock claim this whole file is a proxy for, asserted where a
/// runner can hold it still.
///
/// The server accepts the TCP connection and then never sends a byte, so the
/// dial gets past `TcpStream::connect` and blocks in the driver's handshake
/// read — untimed in oracle-rs 0.1.7, meaning nothing but
/// `OracleAdapter::dial`'s wrapper can end it. Delete that wrapper and this
/// test fails on the outer bound instead of hanging the suite forever.
#[tokio::test]
async fn oracle_dial_gives_up_on_a_silent_server_within_its_budget() {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind a loopback listener");
    let port = listener
        .local_addr()
        .expect("read the listener's bound port")
        .port();
    let _silent_server = tokio::spawn(async move {
        // Hold the accepted socket: dropping it would close the connection and
        // let the driver's read fail fast, which passes with or without the
        // wrapper under test and so would prove nothing.
        let _held = listener.accept().await;
        std::future::pending::<()>().await;
    });

    let mut config = unset(DatabaseType::Oracle, port);
    config.host = "127.0.0.1".into();
    // One second, not the unset default: the assertion is that the budget ends
    // the dial, and a 10s green path would pay 10s on every suite run.
    config.connection_timeout = Some(1);

    let adapter = OracleAdapter::new();
    let outcome = tokio::time::timeout(Duration::from_secs(15), adapter.connect(&config))
        .await
        .expect("the adapter must end the dial itself; reaching 15s means it did not");

    let error = outcome.expect_err("a server that never answers cannot complete a connect");
    assert!(
        error.to_string().contains("timed out after 1s"),
        "expected the adapter's own dial budget to fire, got: {error}"
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

/// Before this branch Redis handed the driver no timeout at all, so every
/// stored value alike fell through to the OS TCP default. That makes this
/// ceiling the only thing standing between a large stored value and a wait
/// *longer* than the connection used to have — the direction the issue asked
/// to move away from. And a stored `Some(300)` need not be a value anyone
/// chose: the dialog wrote 300 into `connectionTimeout` by itself whenever the
/// field was cleared or zeroed (`parseInt(...) || 300`, merge-base
/// `src/features/connection/components/ConnectionDialog/ConnectionDialogBody.tsx`),
/// and nothing rewrites those saved rows. So the ceiling is 30 like PG/MySQL/
/// Oracle, not 300 like MSSQL/Mongo/Search, which did honour a stored value
/// already. 30 is asserted as a literal here rather than read back off the
/// constant.
#[test]
fn redis_ceiling_keeps_a_stored_300_from_outwaiting_the_old_default() {
    let mut config = unset(DatabaseType::Redis, 6379);
    config.connection_timeout = Some(300);

    assert_eq!(redis_connect_timeout(&config), Duration::from_secs(30));
}

/// A stored `0` used to mean "fail every connect instantly" wherever the value
/// became a pool `acquire_timeout`, which surfaces as an unreachable server
/// rather than as a bad setting. The shared resolver floors it at one second.
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
