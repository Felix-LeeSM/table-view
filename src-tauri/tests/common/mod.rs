//! Shared test utilities for integration tests.
//!
//! Sprint 237 P5+ (2026-05-08) — DB lifecycle을 테스트 프로세스가
//! 직접 관리. testcontainers-rs로 첫 호출 시 PG/Mongo 컨테이너를 lazy
//! 시작하고, 프로세스 종료 시 `docker rm -f -v` 로 자동 정리.
//! docker-compose 외부 의존을 끊었기 때문에 `cargo pg-test`/`cargo mongo-test` 한
//! 줄이면 호출자는 Docker daemon만 떠 있으면 된다.
//!
//! 빠른 iteration escape hatch: `PG_TEST_URL` (postgres://user:pass@host:port/db)
//! 또는 `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` 가 셋팅돼
//! 있으면 외부 PG 재사용. Mongo도 동일 패턴 (`MONGO_TEST_URL` 또는 host
//! 변수).
//!
//! Docker daemon이 없는 환경에서는 testcontainers가 즉시 실패하고 helper
//! 가 `None` 을 반환해 기존 통합 테스트의 silent-skip 시맨틱을 보존한다.

pub mod query_result_contracts;

use std::sync::Arc;
use std::time::Duration;

use table_view_lib::db::mongodb::MongoAdapter;
use table_view_lib::db::mysql::MysqlAdapter;
use table_view_lib::db::postgres::PostgresAdapter;
use table_view_lib::db::DbAdapter;
use table_view_lib::models::{ConnectionConfig, DatabaseType};
use testcontainers::core::ImageExt;
use testcontainers::runners::AsyncRunner;
use testcontainers::ContainerAsync;
use testcontainers_modules::mongo::Mongo as MongoImage;
use testcontainers_modules::mysql::Mysql as MysqlImage;
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

/// Sprint 250 — MySQL endpoint resolver for Phase 17 (Sprint 251-256).
///
/// Adapter still unimplemented today; this helper exists so the future
/// `mysql_integration.rs` test binary can resolve a connection endpoint
/// from env vars without re-deriving the docker-compose default port
/// convention (`prod default 3306 + 10000 → 13306`).
///
/// Unlike `pg_endpoint` / `mongo_endpoint`, this resolver is env-var only —
/// testcontainers-modules MySQL spawning will be wired in Sprint 253
/// alongside the `MysqlAdapter` itself, so we avoid pulling the extra
/// feature flag now and keep `cargo test` startup cost flat.
#[derive(Clone, Debug)]
struct MysqlEndpoint {
    host: String,
    port: u16,
    user: String,
    password: String,
    database: String,
}

/// 컨테이너 핸들을 process 종료까지 살려두기 위해 `Arc<...>` 로 보관.
/// static 은 Drop 되지 않으므로 testcontainers 기본 Drop 에 기대지 않고,
/// owner-pid 라벨 + 시작 시 dead-owner sweep + process-exit `rm -f -v` 로
/// 컨테이너와 anonymous volume 누적을 차단한다.
static PG_CONTAINER: OnceCell<Option<Arc<ContainerAsync<PostgresImage>>>> = OnceCell::const_new();
static MONGO_CONTAINER: OnceCell<Option<Arc<ContainerAsync<MongoImage>>>> = OnceCell::const_new();
static MYSQL_CONTAINER: OnceCell<Option<Arc<ContainerAsync<MysqlImage>>>> = OnceCell::const_new();

async fn pg_endpoint() -> Option<PgEndpoint> {
    // 1) 외부 PG 재사용 — `PGHOST`/`PGPORT`/... 가 모두 있으면 그 값을 그대로.
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

    // 2) testcontainers — lazy 시작. owner-pid 라벨을 박고, 시작 전에
    //    dead-owner sweep 으로 이전 run 의 좀비를 정리한다.
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
    // 1) 외부 Mongo 재사용 — host/port 만이라도 있으면 됨 (auth 없는 dev
    //    인스턴스 가정). user/password 도 있으면 함께 사용.
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

    // 2) testcontainers — lazy 시작. testcontainers-modules의 기본 Mongo
    //    image는 auth 비활성, 익명 연결 가능. PG 와 동일한 owner-pid 라벨
    //    + dead-owner sweep 으로 좀비 누적 차단.
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

/// Sprint 296 — testcontainers MySQL spawn helper. PG/Mongo 와 동일한
/// 두 단계 패턴:
///   1) `MYSQL_HOST` 가 있으면 외부 MySQL 재사용 — docker-compose 또는
///      host-native (homebrew 등) 인스턴스. PORT/USER/PASSWORD/DATABASE 는
///      override 가능, 기본은 sprint-250 docker-compose 컨벤션
///      (port 13306, testuser/testpass/table_view_test).
///   2) `MYSQL_DISABLE=1` 가 아니면 testcontainers 가 MySQL 8.x image 를
///      lazy spawn. owner-pid 라벨 + dead-owner sweep 으로 PG/Mongo 와 같은
///      좀비 청소 패턴 공유.
///
/// `MYSQL_DISABLE=1` escape hatch 는 sprint-250 정책 그대로 유지 — adapter
/// 단위 테스트가 MySQL 게이트를 명시적으로 끌 때 사용.
#[allow(dead_code)]
async fn mysql_endpoint() -> Option<MysqlEndpoint> {
    if std::env::var("MYSQL_DISABLE")
        .ok()
        .filter(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .is_some()
    {
        return None;
    }

    // 1) 외부 MySQL 재사용 — `MYSQL_HOST` 가 있을 때만. PG 가 모든 env 를
    //    요구하는 것과 달리, MySQL 은 host 만 있으면 PORT/USER/PASSWORD/
    //    DATABASE 는 docker-compose 컨벤션 default 로 fill.
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

    // 2) testcontainers — lazy 시작. PG/Mongo 와 정확히 같은 owner-pid +
    //    sweep 패턴.
    //
    // 환경변수 3 종:
    // - `MYSQL_ROOT_HOST=%`     — testcontainers-modules MysqlImage 의 default
    //   는 `'root'@'localhost'` 만 grant. macOS Docker Desktop 의 NAT 동작으로
    //   client source IP 가 wireless / LAN interface 로 인식되는 경우 grant
    //   table 매칭 실패. `%` 로 host 와일드카드 보장.
    // - `MYSQL_ROOT_PASSWORD=testpass` — image default `MYSQL_ALLOW_EMPTY_PASSWORD=yes`
    //   는 caching_sha2_password 의 empty-password handshake 가 macOS NAT
    //   환경에서 `1045 Access denied (using password: YES)` 로 fail. password
    //   를 명시하면 sqlx 의 caching_sha2 challenge-response 가 정상 동작.
    //   `MYSQL_ROOT_PASSWORD` 가 set 되면 image entrypoint 가 ALLOW_EMPTY 를
    //   자동 무시 (mutually exclusive).
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

    // testcontainers-modules Mysql image 8.1 default — db `test`. user `root`.
    // password 는 본 helper 가 MYSQL_ROOT_PASSWORD env 로 명시 set 한 값.
    Some(MysqlEndpoint {
        host: "127.0.0.1".to_string(),
        port,
        user: "root".to_string(),
        password: "testpass".to_string(),
        database: "test".to_string(),
    })
}

/// MySQL endpoint reflected into a `ConnectionConfig`. Phase 17 Sprint 253
/// will call this from `mysql_integration.rs` once the adapter compiles.
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
        tls_enabled: None,
    })
}

/// Return a `ConnectionConfig` for the given database type.
///
/// PG/Mongo는 testcontainers (또는 환경변수 override) 가 endpoint를 결정.
/// 이 함수는 동기지만 endpoint resolution은 비동기라 panic-on-missing 시그너처를
/// 유지하기 어렵다. 따라서 Postgresql/Mongodb 분기는 placeholder를 반환하고,
/// 실제 endpoint 주입은 `setup_adapter` / `setup_mongo_adapter` 가 직접 처리한다.
/// MySQL은 이전 시그너처 보존 (env override 만).
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
            read_only: false,
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
            tls_enabled: None,
        },
        other => panic!("test_config: unsupported DatabaseType {:?}", other),
    }
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

/// PG endpoint를 반영한 `ConnectionConfig`. setup_adapter 에서도 동일
/// endpoint 를 쓰므로, 직접 sqlx Pool 같은 sibling 클라이언트를 만드는
/// 테스트는 이 helper 로 endpoint 를 통일하면 된다.
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
        tls_enabled: None,
    })
}

/// Mongo endpoint를 반영한 `ConnectionConfig`. mongo_integration.rs 가
/// sibling driver client (`seed_client`) 를 만들 때 이 helper 의 결과를
/// 그대로 넘기면 testcontainers 의 random port 와 일치한다.
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
        tls_enabled: None,
    })
}

/// Attempt to connect to the requested database and return a connected adapter.
///
/// Returns `Some(adapter)` on success, or `None` when the testcontainer cannot
/// start (e.g. Docker daemon not running) or `connect_pool` fails. 호출자는
/// `match … None => return` 패턴으로 silent-skip 한다.
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
        tls_enabled: None,
    };

    let adapter = PostgresAdapter::new();
    // testcontainers의 PG image는 readiness probe를 자체 실행하지만, sqlx
    // pool 생성이 race로 한두 번 실패할 수 있으므로 짧은 retry.
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

/// Sprint 296 — MySQL 도 PG/Mongo 와 같은 lifecycle helper. testcontainers
/// 가 spawn 또는 외부 인스턴스 reuse 후 `connect_pool` 5-retry. silent-skip
/// 시맨틱 (`None`) 보존.
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
        tls_enabled: None,
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

/// Mongo는 PostgresAdapter와 다른 concrete type이라 별도 helper.
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
        tls_enabled: None,
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
