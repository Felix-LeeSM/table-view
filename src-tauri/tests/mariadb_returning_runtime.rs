use std::time::Duration;

use table_view_lib::db::mysql::MysqlAdapter;
use table_view_lib::models::{ConnectionConfig, DatabaseType, QueryType};
use testcontainers::core::{IntoContainerPort, WaitFor};
use testcontainers::runners::AsyncRunner;
use testcontainers::{ContainerAsync, GenericImage, ImageExt};

#[path = "support/testcontainer_lifecycle.rs"]
mod testcontainer_lifecycle;

struct MariaDbRuntime {
    adapter: MysqlAdapter,
    _container: Option<ContainerAsync<GenericImage>>,
}

struct MariaDbEndpoint {
    host: String,
    port: u16,
    user: String,
    password: String,
    database: String,
    container: Option<ContainerAsync<GenericImage>>,
}

async fn setup_mariadb_runtime() -> Option<MariaDbRuntime> {
    let endpoint = mariadb_endpoint().await?;
    let config = ConnectionConfig {
        id: "mariadb-returning-runtime".to_string(),
        name: "MariaDB RETURNING runtime".to_string(),
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
        tls_enabled: None,
        trust_server_certificate: None,
    };

    let adapter = MysqlAdapter::new_mariadb();
    for attempt in 0..8 {
        match adapter.connect_pool(&config).await {
            Ok(()) => {
                return Some(MariaDbRuntime {
                    adapter,
                    _container: endpoint.container,
                });
            }
            Err(_) if attempt < 7 => {
                tokio::time::sleep(Duration::from_millis(250 * (attempt + 1))).await;
            }
            Err(error) => {
                println!("SKIP: MariaDB connect_pool failed after retries ({error})");
                return None;
            }
        }
    }
    None
}

async fn mariadb_endpoint() -> Option<MariaDbEndpoint> {
    if std::env::var("MARIADB_DISABLE")
        .ok()
        .filter(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .is_some()
    {
        return None;
    }

    if let Ok(host) = std::env::var("MARIADB_HOST") {
        let port = std::env::var("MARIADB_PORT")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(23306);
        return Some(MariaDbEndpoint {
            host,
            port,
            user: std::env::var("MARIADB_USER").unwrap_or_else(|_| "testuser".into()),
            password: std::env::var("MARIADB_PASSWORD").unwrap_or_else(|_| "testpass".into()),
            database: std::env::var("MARIADB_DATABASE")
                .unwrap_or_else(|_| "table_view_test".into()),
            container: None,
        });
    }

    testcontainer_lifecycle::ensure_sweep_once().await;
    let pid = testcontainer_lifecycle::current_pid_label();
    let container = match GenericImage::new("mariadb", "11")
        .with_exposed_port(3306.tcp())
        .with_wait_for(WaitFor::message_on_stderr(
            "mariadbd: ready for connections.",
        ))
        .with_wait_for(WaitFor::message_on_stderr("port: 3306"))
        .with_env_var("MARIADB_ROOT_PASSWORD", "testroot")
        .with_env_var("MARIADB_USER", "testuser")
        .with_env_var("MARIADB_PASSWORD", "testpass")
        .with_env_var("MARIADB_DATABASE", "table_view_test")
        .with_label(testcontainer_lifecycle::OWNED_LABEL, "1")
        .with_label(testcontainer_lifecycle::OWNER_PID_LABEL, &pid)
        .start()
        .await
    {
        Ok(container) => {
            testcontainer_lifecycle::register_container_for_process_cleanup(
                container.id().to_string(),
            );
            container
        }
        Err(error) => {
            println!(
                "SKIP: MariaDB testcontainer start failed ({error}). Docker daemon or mariadb:11 image support required."
            );
            return None;
        }
    };
    let port = match container.get_host_port_ipv4(3306.tcp()).await {
        Ok(port) => port,
        Err(error) => {
            println!("SKIP: MariaDB container port mapping failed ({error})");
            return None;
        }
    };

    Some(MariaDbEndpoint {
        host: "127.0.0.1".to_string(),
        port,
        user: "testuser".to_string(),
        password: "testpass".to_string(),
        database: "table_view_test".to_string(),
        container: Some(container),
    })
}

#[tokio::test]
async fn mariadb_returning_runtime_boundary_is_server_resolved_for_fixture_version() {
    let runtime = match setup_mariadb_runtime().await {
        Some(runtime) => runtime,
        None => return,
    };
    let adapter = runtime.adapter;

    let version_result = adapter
        .execute_query(
            "SELECT VERSION() AS version",
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("SELECT VERSION()");
    let version = version_result.rows[0][0].as_str().unwrap_or_default();
    assert!(
        version.to_ascii_lowercase().contains("mariadb"),
        "expected MariaDB fixture version, got {version:?}"
    );

    let table_name = format!(
        "mariadb_returning_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );

    adapter
        .execute_query(
            &format!("CREATE TABLE {table_name} (id INT PRIMARY KEY, label VARCHAR(64))"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE");
    adapter
        .execute_query(
            &format!("INSERT INTO {table_name} VALUES (1, 'runtime-boundary')"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("INSERT seed row");

    let returning_result = adapter
        .execute_query(
            &format!("DELETE FROM {table_name} WHERE id = 1 RETURNING label"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("DELETE RETURNING should be server-resolved by the current MariaDB fixture");

    assert!(
        returning_result.columns.is_empty(),
        "adapter must not promote MariaDB RETURNING rows to a grid claim for version {version}"
    );
    assert!(
        returning_result.rows.is_empty(),
        "adapter must not expose returned rows for MariaDB RETURNING version {version}"
    );
    assert_eq!(
        returning_result.total_count, 0,
        "MariaDB RETURNING currently resolves at the server but reports no affected-row count through sqlx execute for version {version}"
    );
    match returning_result.query_type {
        QueryType::Dml { rows_affected } => assert_eq!(rows_affected, 0),
        other => panic!("expected DML envelope for MariaDB RETURNING, got {other:?}"),
    }

    let readback = adapter
        .execute_query(
            &format!("SELECT COUNT(*) AS remaining FROM {table_name} WHERE id = 1"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("RETURNING readback SELECT");
    // COUNT(*) 는 BIGINT 를 반환하므로 ADR 0026 (issue #1082) 에 따라 정밀도-보존
    // JSON string token 으로 wire 된다.
    assert_eq!(
        readback.rows[0][0]
            .as_str()
            .and_then(|s| s.parse::<i64>().ok()),
        Some(0)
    );

    adapter
        .execute_query(
            &format!("DROP TABLE {table_name}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}
