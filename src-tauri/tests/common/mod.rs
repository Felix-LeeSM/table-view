//! Shared test utilities for integration tests.
//!
//! Written 2026-05-08 — the test process manages the DB lifecycle itself.
//! testcontainers-rs lazily starts the PG/Mongo containers on the first call
//! and cleans them up with `docker rm -f -v` when the process exits. The
//! external docker-compose dependency is gone, so a single `cargo pg-test` /
//! `cargo mongo-test` line is enough as long as the caller has the Docker
//! daemon running.
//!
//! Fast-iteration escape hatch: when `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/
//! `PGDATABASE` are all set, an external PG is reused. Mongo follows the same
//! pattern (`MONGO_HOST` / `MONGO_PORT`).
//!
//! Where no Docker daemon is running, testcontainers fails immediately and the
//! helper returns `None`, preserving the existing integration tests'
//! silent-skip semantics.

pub mod query_result_contracts;

use std::sync::Arc;
use std::time::Duration;

use table_view_lib::db::mongodb::MongoAdapter;
use table_view_lib::db::mssql::MssqlAdapter;
use table_view_lib::db::mysql::MysqlAdapter;
use table_view_lib::db::oracle::OracleAdapter;
use table_view_lib::db::postgres::PostgresAdapter;
use table_view_lib::db::DbAdapter;
use table_view_lib::models::{ConnectionConfig, DatabaseType, SslMode};
use testcontainers::core::ImageExt;
use testcontainers::runners::AsyncRunner;
use testcontainers::ContainerAsync;
use testcontainers_modules::mariadb::Mariadb as MariadbImage;
use testcontainers_modules::mongo::Mongo as MongoImage;
use testcontainers_modules::mssql_server::MssqlServer as MssqlImage;
use testcontainers_modules::mysql::Mysql as MysqlImage;
// Issue #1674 — Oracle Database Free has no ARM image, so the module is
// `#[cfg]`-gated off on aarch64; the endpoint resolver silent-skips there.
#[cfg(not(any(target_arch = "arm", target_arch = "aarch64")))]
use testcontainers_modules::oracle::free::Oracle as OracleImage;
use testcontainers_modules::postgres::Postgres as PostgresImage;
use tokio::sync::OnceCell;

#[path = "../support/testcontainer_lifecycle.rs"]
mod testcontainer_lifecycle;

use testcontainer_lifecycle::{
    current_pid_label, ensure_sweep_once, register_container_for_process_cleanup, OWNED_LABEL,
    OWNER_PID_LABEL,
};

#[derive(Clone, Debug)]
struct PgEndpoint {
    host: String,
    port: u16,
    user: String,
    password: String,
    database: String,
}

#[derive(Clone, Debug)]
struct MongoEndpoint {
    host: String,
    port: u16,
    user: Option<String>,
    password: Option<String>,
    database: String,
    auth_source: Option<String>,
}

/// MySQL endpoint for the integration test binaries. The env-var defaults
/// follow the docker-compose port convention (`prod default 3306 + 10000 →
/// 13306`). See [`mysql_endpoint`] for how a value is resolved.
#[derive(Clone, Debug)]
struct MysqlEndpoint {
    host: String,
    port: u16,
    user: String,
    password: String,
    database: String,
}

/// Issue #1642 — SQL Server endpoint resolver. Mirrors the MySQL two-stage
/// pattern (external reuse via `MSSQL_HOST`, else lazy testcontainer spawn).
#[derive(Clone, Debug)]
struct MssqlEndpoint {
    host: String,
    port: u16,
    user: String,
    password: String,
    database: String,
}

/// Container handles are held in an `Arc<...>` so they stay alive until the
/// process exits. A static is never dropped, so instead of relying on
/// testcontainers' default Drop, an owner-pid label + a dead-owner sweep at
/// startup + a process-exit `rm -f -v` keep containers and anonymous volumes
/// from piling up.
static PG_CONTAINER: OnceCell<Option<Arc<ContainerAsync<PostgresImage>>>> = OnceCell::const_new();
static MONGO_CONTAINER: OnceCell<Option<Arc<ContainerAsync<MongoImage>>>> = OnceCell::const_new();
static MYSQL_CONTAINER: OnceCell<Option<Arc<ContainerAsync<MysqlImage>>>> = OnceCell::const_new();
static MARIADB_CONTAINER: OnceCell<Option<Arc<ContainerAsync<MariadbImage>>>> =
    OnceCell::const_new();
static MSSQL_CONTAINER: OnceCell<Option<Arc<ContainerAsync<MssqlImage>>>> = OnceCell::const_new();
#[cfg(not(any(target_arch = "arm", target_arch = "aarch64")))]
static ORACLE_CONTAINER: OnceCell<Option<Arc<ContainerAsync<OracleImage>>>> = OnceCell::const_new();

/// Issue #1077 Stage 2 (2026-08-02) — the CI fail-loud rule.
///
/// CI runs nextest `--profile push`, which sets
/// `success-output = "never"` and `status-level = "slow"`: a `SKIP:` println is
/// swallowed and the test name is never printed. "The container never started"
/// and "every gate ran" are therefore indistinguishable in the CI log, so a
/// green `Integration Tests (Docker)` proves nothing about the suites that
/// skipped.
///
/// This covers BOTH unavailability paths — an unresolved endpoint and a
/// connect that exhausts its retries. Guarding only the endpoint would leave
/// the second one silent, which is the same hole in a different function.
///
/// The `*_DISABLE=1` opt-outs are checked before this and stay deliberate.
fn fail_loud_under_ci(engine: &str, disable_var: &str, reason: &str) {
    assert!(
        std::env::var_os("CI").is_none(),
        "{engine} unavailable under CI ({reason}): the docker-gated {engine} tests \
         would silently no-op and still report PASS. Start the container (or point \
         the *_HOST env var at one), or set {disable_var}=1 to opt out on purpose."
    );
}

async fn pg_endpoint() -> Option<PgEndpoint> {
    // 1) Reuse an external PG — when `PGHOST`/`PGPORT`/... are all present,
    //    use them as they are.
    if let (Ok(host), Ok(port_str), Ok(user), Ok(password), Ok(database)) = (
        std::env::var("PGHOST"),
        std::env::var("PGPORT"),
        std::env::var("PGUSER"),
        std::env::var("PGPASSWORD"),
        std::env::var("PGDATABASE"),
    ) {
        return Some(PgEndpoint {
            host,
            port: port_str.parse().unwrap_or(5432),
            user,
            password,
            database,
        });
    }

    // 2) testcontainers — lazy start. Stamp the owner-pid label and, before
    //    starting, clear the previous run's zombies with a dead-owner sweep.
    ensure_sweep_once().await;
    let pid = current_pid_label();
    let cell = PG_CONTAINER
        .get_or_init(|| async {
            match PostgresImage::default()
                .with_label(OWNED_LABEL, "1")
                .with_label(OWNER_PID_LABEL, &pid)
                .start()
                .await
            {
                Ok(c) => {
                    register_container_for_process_cleanup(c.id().to_string());
                    Some(Arc::new(c))
                }
                Err(e) => {
                    println!(
                        "SKIP: PostgreSQL testcontainer 시작 실패 ({}). \
                         Docker daemon 이 떠 있는지 확인하거나 \
                         PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE 환경 \
                         변수로 외부 PG 를 지정하세요.",
                        e
                    );
                    None
                }
            }
        })
        .await
        .as_ref()?;

    let port = match cell.get_host_port_ipv4(5432).await {
        Ok(p) => p,
        Err(e) => {
            println!("SKIP: PG container 포트 매핑 실패 ({})", e);
            return None;
        }
    };

    Some(PgEndpoint {
        host: "127.0.0.1".to_string(),
        port,
        user: "postgres".to_string(),
        password: "postgres".to_string(),
        database: "postgres".to_string(),
    })
}

async fn mongo_endpoint() -> Option<MongoEndpoint> {
    // 1) Reuse an external Mongo — host/port alone is enough (assuming a dev
    //    instance without auth). user/password are used too when present.
    if let (Ok(host), Ok(port_str)) = (std::env::var("MONGO_HOST"), std::env::var("MONGO_PORT")) {
        return Some(MongoEndpoint {
            host,
            port: port_str.parse().unwrap_or(27017),
            user: std::env::var("MONGO_USER").ok(),
            password: std::env::var("MONGO_PASSWORD").ok(),
            database: std::env::var("MONGO_DATABASE").unwrap_or_else(|_| "table_view_test".into()),
            auth_source: std::env::var("MONGO_AUTH_SOURCE").ok(),
        });
    }

    // 2) testcontainers — lazy start. The default Mongo image from
    //    testcontainers-modules has auth disabled, so anonymous connections
    //    work. The same owner-pid label + dead-owner sweep as PG stops zombies
    //    from piling up.
    ensure_sweep_once().await;
    let pid = current_pid_label();
    let cell = MONGO_CONTAINER
        .get_or_init(|| async {
            match MongoImage::default()
                .with_label(OWNED_LABEL, "1")
                .with_label(OWNER_PID_LABEL, &pid)
                .start()
                .await
            {
                Ok(c) => {
                    register_container_for_process_cleanup(c.id().to_string());
                    Some(Arc::new(c))
                }
                Err(e) => {
                    println!(
                        "SKIP: Mongo testcontainer 시작 실패 ({}). \
                         Docker daemon 이 떠 있는지 확인하거나 \
                         MONGO_HOST/MONGO_PORT 환경 변수로 외부 인스턴스를 \
                         지정하세요.",
                        e
                    );
                    None
                }
            }
        })
        .await
        .as_ref()?;

    let port = match cell.get_host_port_ipv4(27017).await {
        Ok(p) => p,
        Err(e) => {
            println!("SKIP: Mongo container 포트 매핑 실패 ({})", e);
            return None;
        }
    };

    Some(MongoEndpoint {
        host: "127.0.0.1".to_string(),
        port,
        user: None,
        password: None,
        database: "table_view_test".to_string(),
        auth_source: None,
    })
}

/// testcontainers MySQL spawn helper. Same two stages as PG/Mongo:
///   1) With `MYSQL_HOST` set, reuse an external MySQL — a docker-compose or
///      host-native (homebrew and the like) instance. PORT/USER/PASSWORD/
///      DATABASE can be overridden; the defaults follow the docker-compose
///      convention (port 13306, testuser/testpass/table_view_test).
///   2) Otherwise, unless `MYSQL_DISABLE=1`, testcontainers lazily spawns a
///      MySQL 8.x image. The owner-pid label + dead-owner sweep share the same
///      zombie-cleanup pattern as PG/Mongo.
///
/// The `MYSQL_DISABLE=1` escape hatch is for an adapter unit test that wants to
/// turn the MySQL gate off explicitly.
#[allow(dead_code)]
async fn mysql_endpoint() -> Option<MysqlEndpoint> {
    if std::env::var("MYSQL_DISABLE")
        .ok()
        .filter(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .is_some()
    {
        return None;
    }

    // 1) Reuse an external MySQL — only when `MYSQL_HOST` is set. Unlike PG,
    //    which demands every env var, MySQL only needs the host: PORT/USER/
    //    PASSWORD/DATABASE are filled from the docker-compose defaults.
    if let Ok(host) = std::env::var("MYSQL_HOST") {
        let port = std::env::var("MYSQL_PORT")
            .ok()
            .and_then(|s| s.parse().ok())
            // `MYSQL_TCP_PORT` is the mysql CLI's own env var; keep
            // backwards-compat with `test_config(DatabaseType::Mysql)`
            // which already consulted it.
            .or_else(|| {
                std::env::var("MYSQL_TCP_PORT")
                    .ok()
                    .and_then(|s| s.parse().ok())
            })
            .unwrap_or(13306);
        return Some(MysqlEndpoint {
            host,
            port,
            user: std::env::var("MYSQL_USER").unwrap_or_else(|_| "testuser".into()),
            password: std::env::var("MYSQL_PASSWORD")
                .or_else(|_| std::env::var("MYSQL_PWD"))
                .unwrap_or_else(|_| "testpass".into()),
            database: std::env::var("MYSQL_DATABASE").unwrap_or_else(|_| "table_view_test".into()),
        });
    }

    // 2) testcontainers — lazy start, exactly the same owner-pid + sweep
    //    pattern as PG/Mongo.
    //
    // Env vars:
    // - `MYSQL_ROOT_HOST=%`     — the testcontainers-modules MysqlImage default
    //   grants only `'root'@'localhost'`. Under macOS Docker Desktop's NAT the
    //   client source IP can be seen as the wireless / LAN interface, and the
    //   grant table then fails to match. `%` guarantees the host wildcard.
    // - `MYSQL_ROOT_PASSWORD=testpass` — with the image default
    //   `MYSQL_ALLOW_EMPTY_PASSWORD=yes`, the empty-password handshake of
    //   caching_sha2_password fails under macOS NAT with
    //   `1045 Access denied (using password: YES)`. Spelling the password out
    //   makes sqlx's caching_sha2 challenge-response work. When
    //   `MYSQL_ROOT_PASSWORD` is set the image entrypoint ignores ALLOW_EMPTY
    //   automatically (they are mutually exclusive).
    ensure_sweep_once().await;
    let pid = current_pid_label();
    let cell = MYSQL_CONTAINER
        .get_or_init(|| async {
            match MysqlImage::default()
                .with_env_var("MYSQL_ROOT_HOST", "%")
                .with_env_var("MYSQL_ROOT_PASSWORD", "testpass")
                .with_label(OWNED_LABEL, "1")
                .with_label(OWNER_PID_LABEL, &pid)
                .start()
                .await
            {
                Ok(c) => {
                    register_container_for_process_cleanup(c.id().to_string());
                    Some(Arc::new(c))
                }
                Err(e) => {
                    println!(
                        "SKIP: MySQL testcontainer 시작 실패 ({}). \
                         Docker daemon 이 떠 있는지 확인하거나 \
                         MYSQL_HOST/MYSQL_PORT/MYSQL_USER/MYSQL_PASSWORD \
                         환경 변수로 외부 MySQL 을 지정하세요.",
                        e
                    );
                    None
                }
            }
        })
        .await
        .as_ref()?;

    let port = match cell.get_host_port_ipv4(3306).await {
        Ok(p) => p,
        Err(e) => {
            println!("SKIP: MySQL container 포트 매핑 실패 ({})", e);
            return None;
        }
    };

    // testcontainers-modules Mysql image 8.1 defaults — db `test`, user
    // `root`. The password is the value this helper sets explicitly through the
    // MYSQL_ROOT_PASSWORD env var.
    Some(MysqlEndpoint {
        host: "127.0.0.1".to_string(),
        port,
        user: "root".to_string(),
        password: "testpass".to_string(),
        database: "test".to_string(),
    })
}

/// Issue #1077 Stage 2 (2026-08-02) — MariaDB endpoint resolver.
///
/// MariaDB shares `MysqlAdapter`, so for most surfaces the MySQL container is
/// representative and a second container would be pure cost. `mysql.user` is
/// the exception: the users listing is the one code path where the two vendors
/// run different SQL. What this container adds is executing that SQL against a
/// real MariaDB and decoding the result — the arm selection and the row mapping
/// are already unit-covered in `db/mysql/schema.rs`.
///
/// Same two stages as MySQL — `MARIADB_HOST` reuses an external server
/// (`docker-compose.yml` publishes `mariadb:11` on `${MARIADB_PORT:-23306}`),
/// otherwise testcontainers spawns `mariadb:11.3`, the module default.
/// `MARIADB_DISABLE=1` opts out.
/// The two root env vars mirror the MySQL helper's: `MARIADB_ROOT_HOST=%` so
/// the grant table matches through Docker Desktop's NAT, and an explicit
/// password because sqlx's handshake needs one.
#[allow(dead_code)]
async fn mariadb_endpoint() -> Option<MysqlEndpoint> {
    if std::env::var("MARIADB_DISABLE")
        .ok()
        .filter(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .is_some()
    {
        return None;
    }

    if let Ok(host) = std::env::var("MARIADB_HOST") {
        return Some(MysqlEndpoint {
            host,
            port: std::env::var("MARIADB_PORT")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(23306),
            user: std::env::var("MARIADB_USER").unwrap_or_else(|_| "testuser".into()),
            password: std::env::var("MARIADB_PASSWORD").unwrap_or_else(|_| "testpass".into()),
            database: std::env::var("MARIADB_DATABASE")
                .unwrap_or_else(|_| "table_view_test".into()),
        });
    }

    ensure_sweep_once().await;
    let pid = current_pid_label();
    let cell = MARIADB_CONTAINER
        .get_or_init(|| async {
            match MariadbImage::default()
                .with_env_var("MARIADB_ROOT_HOST", "%")
                .with_env_var("MARIADB_ROOT_PASSWORD", "testpass")
                .with_label(OWNED_LABEL, "1")
                .with_label(OWNER_PID_LABEL, &pid)
                .start()
                .await
            {
                Ok(c) => {
                    register_container_for_process_cleanup(c.id().to_string());
                    Some(Arc::new(c))
                }
                Err(e) => {
                    println!("SKIP: MariaDB testcontainer 시작 실패 ({})", e);
                    None
                }
            }
        })
        .await
        .as_ref();

    let cell = match cell {
        Some(c) => c,
        None => {
            fail_loud_under_ci("MariaDB", "MARIADB_DISABLE", "container failed to start");
            return None;
        }
    };

    let port = match cell.get_host_port_ipv4(3306).await {
        Ok(p) => p,
        Err(e) => {
            println!("SKIP: MariaDB container 포트 매핑 실패 ({})", e);
            fail_loud_under_ci("MariaDB", "MARIADB_DISABLE", &format!("port mapping: {e}"));
            return None;
        }
    };

    Some(MysqlEndpoint {
        host: "127.0.0.1".to_string(),
        port,
        user: "root".to_string(),
        password: "testpass".to_string(),
        database: "test".to_string(),
    })
}

/// Issue #1642 — SQL Server endpoint resolver. Two-stage like MySQL:
///   1) `MSSQL_HOST` set → reuse an external SQL Server (host-native or
///      compose). PORT/USER/PASSWORD/DATABASE override the container defaults.
///   2) else, unless `MSSQL_DISABLE=1`, lazily spawn the official
///      `mcr.microsoft.com/mssql/server` testcontainer (amd64-only; on Apple
///      silicon it needs Rosetta and otherwise fails → silent-skip).
///
/// Issue #1077 Stage 2 (2026-08-02) — the silent skip is local-only; under `CI`
/// an absent endpoint is a failure. See [`fail_loud_under_ci`] for why, and
/// [`setup_mssql_adapter`] for the second half of the same guard (a connect
/// that exhausts its retries). `MSSQL_DISABLE=1` is checked first and stays an
/// explicit, deliberate opt-out.
#[allow(dead_code)]
async fn mssql_endpoint() -> Option<MssqlEndpoint> {
    if std::env::var("MSSQL_DISABLE")
        .ok()
        .filter(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .is_some()
    {
        return None;
    }

    let endpoint = mssql_endpoint_available().await;
    if endpoint.is_none() {
        fail_loud_under_ci("SQL Server", "MSSQL_DISABLE", "no endpoint resolved");
    }
    endpoint
}

/// The resolver proper. Returns `None` on every unavailable path so
/// [`mssql_endpoint`] owns the endpoint-path CI fail-loud decision. The connect
/// path has its own, in [`setup_mssql_adapter`].
async fn mssql_endpoint_available() -> Option<MssqlEndpoint> {
    if let Ok(host) = std::env::var("MSSQL_HOST") {
        let port = std::env::var("MSSQL_PORT")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(1433);
        return Some(MssqlEndpoint {
            host,
            port,
            user: std::env::var("MSSQL_USER").unwrap_or_else(|_| "sa".into()),
            password: std::env::var("MSSQL_PASSWORD")
                .unwrap_or_else(|_| MssqlImage::DEFAULT_SA_PASSWORD.into()),
            database: std::env::var("MSSQL_DATABASE").unwrap_or_else(|_| "master".into()),
        });
    }

    ensure_sweep_once().await;
    let pid = current_pid_label();
    let cell = MSSQL_CONTAINER
        .get_or_init(|| async {
            match MssqlImage::default()
                .with_accept_eula()
                .with_label(OWNED_LABEL, "1")
                .with_label(OWNER_PID_LABEL, &pid)
                .start()
                .await
            {
                Ok(c) => {
                    register_container_for_process_cleanup(c.id().to_string());
                    Some(Arc::new(c))
                }
                Err(e) => {
                    println!(
                        "SKIP: SQL Server testcontainer 시작 실패 ({}). \
                         Docker daemon (amd64/Rosetta) 확인 또는 \
                         MSSQL_HOST/MSSQL_PORT/MSSQL_USER/MSSQL_PASSWORD 로 \
                         외부 SQL Server 를 지정하세요.",
                        e
                    );
                    None
                }
            }
        })
        .await
        .as_ref()?;

    let port = match cell.get_host_port_ipv4(1433).await {
        Ok(p) => p,
        Err(e) => {
            println!("SKIP: SQL Server container 포트 매핑 실패 ({})", e);
            return None;
        }
    };

    Some(MssqlEndpoint {
        host: "127.0.0.1".to_string(),
        port,
        user: "sa".to_string(),
        password: MssqlImage::DEFAULT_SA_PASSWORD.to_string(),
        database: "master".to_string(),
    })
}

/// MySQL endpoint reflected into a `ConnectionConfig`.
#[allow(dead_code)]
pub async fn mysql_test_config() -> Option<ConnectionConfig> {
    let endpoint = mysql_endpoint().await?;
    Some(ConnectionConfig {
        id: "test-conn".to_string(),
        name: "TestMysql".to_string(),
        db_type: DatabaseType::Mysql,
        host: endpoint.host,
        port: endpoint.port,
        user: endpoint.user,
        password: endpoint.password,
        database: endpoint.database,
        read_only: false,
        group_id: None,
        color: None,
        connection_timeout: Some(10),
        keep_alive_interval: None,
        environment: None,
        auth_source: None,
        replica_set: None,
        ssl_mode: SslMode::Prefer,
        ca_cert_path: None,
        oracle_use_sid: None,
        wallet_path: None,
        wallet_password: String::new(),
    })
}

/// Return a `ConnectionConfig` for the given database type.
///
/// For PG/Mongo the endpoint is decided by testcontainers (or an env-var
/// override). This function is sync while endpoint resolution is async, which
/// makes a panic-on-missing signature hard to keep. So the Postgresql/Mongodb
/// arms return a placeholder and the real endpoint injection is handled by
/// `setup_adapter` / `setup_mongo_adapter` themselves. MySQL keeps the older
/// signature (env override only).
#[allow(dead_code)]
pub fn test_config(db_type: DatabaseType) -> ConnectionConfig {
    match db_type {
        DatabaseType::Postgresql => ConnectionConfig {
            id: "test-conn".to_string(),
            name: "TestDB".to_string(),
            db_type: DatabaseType::Postgresql,
            host: "127.0.0.1".to_string(),
            port: 5432,
            user: "postgres".to_string(),
            password: "postgres".to_string(),
            database: "postgres".to_string(),
            read_only: false,
            group_id: None,
            color: None,
            connection_timeout: Some(5),
            keep_alive_interval: None,
            environment: None,
            auth_source: None,
            replica_set: None,
            ssl_mode: SslMode::Prefer,
            ca_cert_path: None,
            oracle_use_sid: None,
            wallet_path: None,
            wallet_password: String::new(),
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
            read_only: false,
            group_id: None,
            color: None,
            connection_timeout: Some(5),
            keep_alive_interval: None,
            environment: None,
            auth_source: None,
            replica_set: None,
            ssl_mode: SslMode::Prefer,
            ca_cert_path: None,
            oracle_use_sid: None,
            wallet_path: None,
            wallet_password: String::new(),
        },
        DatabaseType::Mongodb => ConnectionConfig {
            id: "test-conn".to_string(),
            name: "TestMongo".to_string(),
            db_type: DatabaseType::Mongodb,
            host: "127.0.0.1".to_string(),
            port: 27017,
            user: String::new(),
            password: String::new(),
            database: "table_view_test".to_string(),
            read_only: false,
            group_id: None,
            color: None,
            connection_timeout: Some(5),
            keep_alive_interval: None,
            environment: None,
            auth_source: None,
            replica_set: None,
            ssl_mode: SslMode::Prefer,
            ca_cert_path: None,
            oracle_use_sid: None,
            wallet_path: None,
            wallet_password: String::new(),
        },
        other => panic!("test_config: unsupported DatabaseType {:?}", other),
    }
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

/// PG endpoint reflected into a `ConnectionConfig`. setup_adapter uses the same
/// endpoint, so a test that builds a sibling client such as its own sqlx Pool
/// can line the endpoint up through this helper.
#[allow(dead_code)]
pub async fn pg_test_config() -> Option<ConnectionConfig> {
    let endpoint = pg_endpoint().await?;
    Some(ConnectionConfig {
        id: "test-conn".to_string(),
        name: "TestDB".to_string(),
        db_type: DatabaseType::Postgresql,
        host: endpoint.host,
        port: endpoint.port,
        user: endpoint.user,
        password: endpoint.password,
        database: endpoint.database,
        read_only: false,
        group_id: None,
        color: None,
        connection_timeout: Some(10),
        keep_alive_interval: None,
        environment: None,
        auth_source: None,
        replica_set: None,
        ssl_mode: SslMode::Prefer,
        ca_cert_path: None,
        oracle_use_sid: None,
        wallet_path: None,
        wallet_password: String::new(),
    })
}

/// Mongo endpoint reflected into a `ConnectionConfig`. When
/// mongo_integration.rs builds a sibling driver client (`seed_client`), passing
/// this helper's result through as-is matches the random port testcontainers
/// picked.
#[allow(dead_code)]
pub async fn mongo_test_config() -> Option<ConnectionConfig> {
    let endpoint = mongo_endpoint().await?;
    Some(ConnectionConfig {
        id: "test-conn".to_string(),
        name: "TestMongo".to_string(),
        db_type: DatabaseType::Mongodb,
        host: endpoint.host,
        port: endpoint.port,
        user: endpoint.user.clone().unwrap_or_default(),
        password: endpoint.password.clone().unwrap_or_default(),
        database: endpoint.database,
        read_only: false,
        group_id: None,
        color: None,
        connection_timeout: Some(10),
        keep_alive_interval: None,
        environment: None,
        auth_source: endpoint.auth_source,
        replica_set: None,
        ssl_mode: SslMode::Prefer,
        ca_cert_path: None,
        oracle_use_sid: None,
        wallet_path: None,
        wallet_password: String::new(),
    })
}

/// Attempt to connect to the requested database and return a connected adapter.
///
/// Returns `Some(adapter)` on success, or `None` when the testcontainer cannot
/// start (e.g. Docker daemon not running) or `connect_pool` fails. Callers
/// silent-skip with a `match … None => return` pattern.
#[allow(dead_code)]
pub async fn setup_adapter(db_type: DatabaseType) -> Option<PostgresAdapter> {
    assert!(
        matches!(db_type, DatabaseType::Postgresql),
        "setup_adapter: only PostgreSQL is supported at this time. \
         Use setup_mongo_adapter for MongoDB."
    );

    let endpoint = pg_endpoint().await?;
    let config = ConnectionConfig {
        id: "test-conn".to_string(),
        name: "TestDB".to_string(),
        db_type: DatabaseType::Postgresql,
        host: endpoint.host,
        port: endpoint.port,
        user: endpoint.user,
        password: endpoint.password,
        database: endpoint.database,
        read_only: false,
        group_id: None,
        color: None,
        connection_timeout: Some(10),
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

    let adapter = PostgresAdapter::new();
    // The testcontainers PG image runs its own readiness probe, but sqlx pool
    // creation can lose a race once or twice, hence the short retry.
    for attempt in 0..5 {
        match adapter.connect_pool(&config).await {
            Ok(()) => return Some(adapter),
            Err(_) if attempt < 4 => {
                tokio::time::sleep(Duration::from_millis(200 * (attempt + 1))).await;
            }
            Err(e) => {
                println!("SKIP: PG connect_pool failed after retries ({})", e);
                return None;
            }
        }
    }
    None
}

/// The same lifecycle helper for MySQL as PG/Mongo has. After testcontainers
/// spawns one or an external instance is reused, `connect_pool` retries 5
/// times. The silent-skip semantics (`None`) are preserved.
#[allow(dead_code)]
pub async fn setup_mysql_adapter() -> Option<MysqlAdapter> {
    let endpoint = mysql_endpoint().await?;
    let config = ConnectionConfig {
        id: "test-conn".to_string(),
        name: "TestMysql".to_string(),
        db_type: DatabaseType::Mysql,
        host: endpoint.host,
        port: endpoint.port,
        user: endpoint.user,
        password: endpoint.password,
        database: endpoint.database,
        read_only: false,
        group_id: None,
        color: None,
        connection_timeout: Some(10),
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

    let adapter = MysqlAdapter::new();
    for attempt in 0..5 {
        match adapter.connect_pool(&config).await {
            Ok(()) => return Some(adapter),
            Err(_) if attempt < 4 => {
                tokio::time::sleep(Duration::from_millis(200 * (attempt + 1))).await;
            }
            Err(e) => {
                println!("SKIP: MySQL connect_pool failed after retries ({})", e);
                return None;
            }
        }
    }
    None
}

/// Issue #1077 Stage 2 (2026-08-02) — MariaDB lifecycle helper. Same shape as
/// [`setup_mysql_adapter`] with two differences that carry the whole point of
/// the file: the adapter is built by `MysqlAdapter::new_mariadb()`, which is
/// what `commands/connection.rs` does for a MariaDB connection and what selects
/// the MariaDB users projection, and unavailability is fail-loud under `CI` so
/// a green `Integration Tests (Docker)` cannot mean "the gate never ran".
#[allow(dead_code)]
pub async fn setup_mariadb_adapter() -> Option<MysqlAdapter> {
    let endpoint = mariadb_endpoint().await?;
    let config = ConnectionConfig {
        id: "test-conn".to_string(),
        name: "TestMariadb".to_string(),
        db_type: DatabaseType::Mariadb,
        host: endpoint.host,
        port: endpoint.port,
        user: endpoint.user,
        password: endpoint.password,
        database: endpoint.database,
        read_only: false,
        group_id: None,
        color: None,
        connection_timeout: Some(10),
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

    let adapter = MysqlAdapter::new_mariadb();
    for attempt in 0..5 {
        match adapter.connect_pool(&config).await {
            Ok(()) => return Some(adapter),
            Err(_) if attempt < 4 => {
                tokio::time::sleep(Duration::from_millis(200 * (attempt + 1))).await;
            }
            Err(e) => {
                println!("SKIP: MariaDB connect_pool failed after retries ({})", e);
                fail_loud_under_ci(
                    "MariaDB",
                    "MARIADB_DISABLE",
                    &format!("connect failed: {e}"),
                );
                return None;
            }
        }
    }
    None
}

/// Issue #1642 — SQL Server lifecycle helper. `MssqlAdapter` has no sqlx pool;
/// `connect` runs a version probe and stores the config, so each connected
/// adapter opens fresh tiberius clients per query (two adapters over the same
/// container are independent — the round-trip test uses that to keep one for
/// seed/readback and hand another to `AppState`). TLS is required + trusted to
/// match the container's self-signed cert. Silent-skip (`None`) preserved.
#[allow(dead_code)]
pub async fn setup_mssql_adapter() -> Option<MssqlAdapter> {
    let endpoint = mssql_endpoint().await?;
    let config = ConnectionConfig {
        id: "test-conn".to_string(),
        name: "TestMssql".to_string(),
        db_type: DatabaseType::Mssql,
        host: endpoint.host,
        port: endpoint.port,
        user: endpoint.user,
        password: endpoint.password,
        database: endpoint.database,
        read_only: false,
        group_id: None,
        color: None,
        connection_timeout: Some(20),
        keep_alive_interval: None,
        environment: None,
        auth_source: None,
        replica_set: None,
        ssl_mode: SslMode::Require,
        ca_cert_path: None,
        oracle_use_sid: None,
        wallet_path: None,
        wallet_password: String::new(),
    };

    let adapter = MssqlAdapter::new();
    for attempt in 0..5 {
        match adapter.connect(&config).await {
            Ok(()) => return Some(adapter),
            Err(_) if attempt < 4 => {
                tokio::time::sleep(Duration::from_millis(500 * (attempt + 1))).await;
            }
            Err(e) => {
                println!("SKIP: SQL Server connect failed after retries ({})", e);
                // Every gate below still returns on `None`. Without this the CI
                // guard would cover only half the unavailability surface —
                // an unresolved endpoint, but not a connect that runs out of
                // retries (issue #1077).
                fail_loud_under_ci(
                    "SQL Server",
                    "MSSQL_DISABLE",
                    &format!("connect failed: {e}"),
                );
                return None;
            }
        }
    }
    None
}

/// Issue #1077 Stage 2 (2026-08-02) — run server-scoped MariaDB DDL
/// (`CREATE ROLE`) against the same server [`setup_mariadb_adapter`] uses.
/// Call only after `setup_mariadb_adapter()` returned `Some` — an absent
/// endpoint is an error here, not a skip.
#[allow(dead_code)]
pub async fn mariadb_admin_sql(statements: &[&str]) -> Result<(), String> {
    use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};

    let endpoint = mariadb_endpoint()
        .await
        .ok_or_else(|| "no MariaDB endpoint".to_string())?;
    let pool = MySqlPoolOptions::new()
        .max_connections(1)
        .connect_with(
            MySqlConnectOptions::new()
                .host(&endpoint.host)
                .port(endpoint.port)
                .username(&endpoint.user)
                .password(&endpoint.password)
                .database(&endpoint.database),
        )
        .await
        .map_err(|e| format!("MariaDB admin pool: {e}"))?;

    for sql in statements {
        sqlx::query(sql)
            .execute(&pool)
            .await
            .map_err(|e| format!("MariaDB admin statement failed ({sql}): {e}"))?;
    }
    pool.close().await;
    Ok(())
}

/// Issue #1077 Stage 2 (2026-07-25) — run a server-scoped T-SQL batch
/// (`CREATE LOGIN`, `CREATE CERTIFICATE`, `ALTER SERVER ROLE`, …) against the
/// same SQL Server `setup_mssql_adapter` uses. The adapter classifies every
/// non-SELECT/DML statement as `QueryType::Ddl` and refuses it by design
/// (#903), so a server-principal fixture needs its own TDS client. Same
/// `EncryptionLevel::NotSupported` admin-client idiom as
/// `tests/mssql_connection_routing.rs`. Call only after
/// `setup_mssql_adapter()` returned `Some` — an absent endpoint is an error
/// here, not a skip.
#[allow(dead_code)]
pub async fn mssql_admin_batch(sql: &str) -> Result<(), String> {
    use tiberius::{AuthMethod, Client, Config as TdsConfig, EncryptionLevel};
    use tokio::net::TcpStream;
    use tokio_util::compat::TokioAsyncWriteCompatExt;

    let endpoint = mssql_endpoint()
        .await
        .ok_or_else(|| "no SQL Server endpoint".to_string())?;
    let mut config = TdsConfig::new();
    config.host(&endpoint.host);
    config.port(endpoint.port);
    config.database(&endpoint.database);
    config.authentication(AuthMethod::sql_server(&endpoint.user, &endpoint.password));
    config.encryption(EncryptionLevel::NotSupported);

    let tcp = TcpStream::connect(config.get_addr())
        .await
        .map_err(|error| format!("connect admin TDS: {error}"))?;
    tcp.set_nodelay(true)
        .map_err(|error| format!("configure admin TDS socket: {error}"))?;
    let mut client = Client::connect(config, tcp.compat_write())
        .await
        .map_err(|error| format!("login admin TDS: {error}"))?;
    client
        .simple_query(sql)
        .await
        .map_err(|error| format!("run admin SQL: {error}"))?
        .into_results()
        .await
        .map_err(|error| format!("consume admin SQL: {error}"))?;
    Ok(())
}

#[derive(Clone, Debug)]
#[allow(dead_code)]
struct OracleEndpoint {
    host: String,
    port: u16,
    user: String,
    password: String,
    /// Oracle service name (`database` in `ConnectionConfig`).
    service: String,
}

/// Issue #1674 — Oracle endpoint resolver. Env override first (`ORACLE_HOST`,
/// works on any arch); otherwise spawn the `gvenzl/oracle-free` testcontainer.
/// Oracle Database Free has no ARM image, so on aarch64 the testcontainers
/// module is `#[cfg]`-gated off and this silent-skips (`None`) — mirroring the
/// MSSQL amd64-only skip. Point at an external instance with
/// `ORACLE_HOST=... ORACLE_PORT=... cargo oracle-test`. CI sets `ORACLE_HOST`
/// to the job's `oracle` service container so the boot cost stays off the
/// per-test timeout clock (#2569).
#[allow(dead_code)]
async fn oracle_endpoint() -> Option<OracleEndpoint> {
    if std::env::var("ORACLE_DISABLE")
        .ok()
        .filter(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .is_some()
    {
        return None;
    }

    if let Ok(host) = std::env::var("ORACLE_HOST") {
        return Some(OracleEndpoint {
            host,
            port: std::env::var("ORACLE_PORT")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(1521),
            user: std::env::var("ORACLE_USER").unwrap_or_else(|_| "test".into()),
            password: std::env::var("ORACLE_PASSWORD").unwrap_or_else(|_| "test".into()),
            service: std::env::var("ORACLE_SERVICE").unwrap_or_else(|_| "FREEPDB1".into()),
        });
    }

    #[cfg(not(any(target_arch = "arm", target_arch = "aarch64")))]
    {
        oracle_container_endpoint().await
    }
    #[cfg(any(target_arch = "arm", target_arch = "aarch64"))]
    {
        println!(
            "SKIP: Oracle Database Free has no ARM image; set \
             ORACLE_HOST/ORACLE_PORT/ORACLE_USER/ORACLE_PASSWORD/ORACLE_SERVICE \
             to reuse an external Oracle."
        );
        None
    }
}

/// Lazily spawn the `gvenzl/oracle-free:23-slim-faststart` testcontainer
/// (amd64-only). Oracle takes ~30-90s to reach "DATABASE IS READY TO USE!", so
/// the startup timeout is raised well past the 60s default.
#[cfg(not(any(target_arch = "arm", target_arch = "aarch64")))]
async fn oracle_container_endpoint() -> Option<OracleEndpoint> {
    ensure_sweep_once().await;
    let pid = current_pid_label();
    let cell = match ORACLE_CONTAINER
        .get_or_init(|| async {
            match OracleImage::default()
                .with_startup_timeout(Duration::from_secs(300))
                .with_label(OWNED_LABEL, "1")
                .with_label(OWNER_PID_LABEL, &pid)
                .start()
                .await
            {
                Ok(c) => {
                    register_container_for_process_cleanup(c.id().to_string());
                    Some(Arc::new(c))
                }
                Err(e) => {
                    println!(
                        "SKIP: Oracle testcontainer 시작 실패 ({}). Docker daemon \
                         (amd64) 확인 또는 ORACLE_HOST/ORACLE_PORT/ORACLE_USER/\
                         ORACLE_PASSWORD/ORACLE_SERVICE 로 외부 Oracle 을 지정하세요.",
                        e
                    );
                    None
                }
            }
        })
        .await
        .as_ref()
    {
        Some(c) => c,
        None => {
            fail_loud_under_ci("Oracle", "ORACLE_DISABLE", "container failed to start");
            return None;
        }
    };

    let port = match cell.get_host_port_ipv4(1521).await {
        Ok(p) => p,
        Err(e) => {
            println!("SKIP: Oracle container 포트 매핑 실패 ({})", e);
            fail_loud_under_ci("Oracle", "ORACLE_DISABLE", &format!("port mapping: {e}"));
            return None;
        }
    };

    // gvenzl/oracle-free app user is `test`/`test` in the `FREEPDB1` PDB schema.
    Some(OracleEndpoint {
        host: "127.0.0.1".to_string(),
        port,
        user: "test".to_string(),
        password: "test".to_string(),
        service: "FREEPDB1".to_string(),
    })
}

/// Issue #1674 — Oracle lifecycle helper. `OracleAdapter::connect` opens a
/// service-name connection + version probe and stores the config; each streamed
/// dump opens fresh connections from that config (two adapters over the same
/// container stay independent, like MSSQL). Silent-skip (`None`) preserved.
#[allow(dead_code)]
pub async fn setup_oracle_adapter() -> Option<OracleAdapter> {
    let endpoint = oracle_endpoint().await?;
    let config = ConnectionConfig {
        id: "test-conn".to_string(),
        name: "TestOracle".to_string(),
        db_type: DatabaseType::Oracle,
        host: endpoint.host,
        port: endpoint.port,
        user: endpoint.user,
        password: endpoint.password,
        database: endpoint.service,
        read_only: false,
        group_id: None,
        color: None,
        connection_timeout: Some(30),
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

    let adapter = OracleAdapter::new();
    for attempt in 0..5 {
        match adapter.connect(&config).await {
            Ok(()) => return Some(adapter),
            Err(_) if attempt < 4 => {
                tokio::time::sleep(Duration::from_millis(500 * (attempt + 1))).await;
            }
            Err(e) => {
                println!("SKIP: Oracle connect failed after retries ({})", e);
                // CI 는 oracle service container 를 `ORACLE_HOST` 로 노출한다
                // (#2569) — 그 자리에서 connect 가 죽으면 조용한 skip 이 아니라
                // 실패여야 한다 (#1077 fail-loud rule, MSSQL 의 같은 가드와
                // 같은 형태).
                fail_loud_under_ci("Oracle", "ORACLE_DISABLE", &format!("connect failed: {e}"));
                return None;
            }
        }
    }
    None
}

/// Mongo needs its own helper because it is a different concrete type from
/// PostgresAdapter.
#[allow(dead_code)]
pub async fn setup_mongo_adapter() -> Option<MongoAdapter> {
    let endpoint = mongo_endpoint().await?;
    let config = ConnectionConfig {
        id: "test-conn".to_string(),
        name: "TestMongo".to_string(),
        db_type: DatabaseType::Mongodb,
        host: endpoint.host,
        port: endpoint.port,
        user: endpoint.user.clone().unwrap_or_default(),
        password: endpoint.password.clone().unwrap_or_default(),
        database: endpoint.database,
        read_only: false,
        group_id: None,
        color: None,
        connection_timeout: Some(10),
        keep_alive_interval: None,
        environment: None,
        auth_source: endpoint.auth_source,
        replica_set: None,
        ssl_mode: SslMode::Prefer,
        ca_cert_path: None,
        oracle_use_sid: None,
        wallet_path: None,
        wallet_password: String::new(),
    };

    let adapter = MongoAdapter::new();
    for attempt in 0..5 {
        match adapter.connect(&config).await {
            Ok(()) => return Some(adapter),
            Err(_) if attempt < 4 => {
                tokio::time::sleep(Duration::from_millis(200 * (attempt + 1))).await;
            }
            Err(e) => {
                println!("SKIP: Mongo connect failed after retries ({})", e);
                return None;
            }
        }
    }
    None
}

/// Return the list of DBMS types that are currently reachable.
#[allow(dead_code)]
pub async fn available_dbms() -> Vec<DatabaseType> {
    let mut available = Vec::new();
    if setup_adapter(DatabaseType::Postgresql).await.is_some() {
        available.push(DatabaseType::Postgresql);
    }
    if setup_mysql_adapter().await.is_some() {
        available.push(DatabaseType::Mysql);
    }
    if setup_mongo_adapter().await.is_some() {
        available.push(DatabaseType::Mongodb);
    }
    available
}
