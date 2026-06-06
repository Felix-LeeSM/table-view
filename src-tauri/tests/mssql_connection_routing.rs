use std::time::{Duration, Instant};

use table_view_lib::commands::connection::{test_connection, TestConnectionRequest};
use table_view_lib::db::MssqlAdapter;
use table_view_lib::error::AppError;
use table_view_lib::models::{ConnectionConfig, ConnectionConfigPublic, DatabaseType};
use testcontainers::core::{IntoContainerPort, WaitFor};
use testcontainers::runners::AsyncRunner;
use testcontainers::{GenericImage, ImageExt};
use tokio::net::TcpListener;

#[path = "support/testcontainer_lifecycle.rs"]
mod testcontainer_lifecycle;

const MSSQL_PASSWORD: &str = "Str0ng!Passw0rd2026";

fn mssql_public(
    port: u16,
    timeout: Option<u32>,
    tls_enabled: Option<bool>,
) -> ConnectionConfigPublic {
    ConnectionConfigPublic {
        id: "mssql-c1".into(),
        name: "SQL Server fixture".into(),
        db_type: DatabaseType::Mssql,
        host: "127.0.0.1".into(),
        port,
        user: "sa".into(),
        database: "master".into(),
        read_only: false,
        group_id: None,
        color: None,
        connection_timeout: timeout,
        keep_alive_interval: None,
        environment: None,
        has_password: true,
        paradigm: DatabaseType::Mssql.paradigm(),
        auth_source: None,
        replica_set: None,
        tls_enabled,
    }
}

fn mssql_config(port: u16, password: &str, timeout: Option<u32>) -> ConnectionConfig {
    ConnectionConfig {
        id: "mssql-live".into(),
        name: "SQL Server live".into(),
        db_type: DatabaseType::Mssql,
        host: "127.0.0.1".into(),
        port,
        user: "sa".into(),
        password: password.into(),
        database: "master".into(),
        read_only: false,
        group_id: None,
        color: None,
        connection_timeout: timeout,
        keep_alive_interval: None,
        environment: None,
        auth_source: None,
        replica_set: None,
        tls_enabled: Some(false),
    }
}

async fn unused_tcp_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    port
}

#[tokio::test]
async fn test_connection_routes_mssql_to_mssql_adapter() {
    let port = unused_tcp_port().await;

    let result = test_connection(TestConnectionRequest {
        config: mssql_public(port, Some(1), Some(false)),
        password: Some("pw".into()),
        existing_id: None,
    })
    .await;

    match result {
        Err(AppError::Connection(msg)) => {
            assert!(
                msg.contains("SQL Server network connection failed"),
                "unexpected SQL Server connection error: {msg}"
            );
        }
        Err(AppError::Unsupported(msg)) => {
            panic!("MSSQL routing regressed to Unsupported: {msg}");
        }
        other => panic!("Expected SQL Server connection error, got: {other:?}"),
    }
}

#[tokio::test]
async fn mssql_login_uses_configured_connection_timeout() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let listener_task = tokio::spawn(async move {
        let Ok((_socket, _peer)) = listener.accept().await else {
            return;
        };
        tokio::time::sleep(Duration::from_secs(5)).await;
    });

    let start = Instant::now();
    let result = MssqlAdapter::test(&mssql_config(port, "pw", Some(1))).await;
    listener_task.abort();

    assert!(
        start.elapsed() < Duration::from_secs(4),
        "SQL Server login ignored the configured timeout"
    );
    match result {
        Err(AppError::Connection(msg)) => {
            assert!(
                msg.contains("SQL Server login failed") && msg.contains("timed out after 1s"),
                "unexpected SQL Server timeout error: {msg}"
            );
        }
        other => panic!("Expected SQL Server login timeout, got: {other:?}"),
    }
}

#[tokio::test]
async fn test_connection_succeeds_against_live_mssql_serverproperty_probe() {
    testcontainer_lifecycle::ensure_sweep_once().await;
    let pid = testcontainer_lifecycle::current_pid_label();
    let container = match GenericImage::new(
        "mcr.microsoft.com/mssql/server",
        "2022-CU14-ubuntu-22.04",
    )
    .with_exposed_port(1433.tcp())
    .with_wait_for(WaitFor::message_on_stdout(
        "SQL Server is now ready for client connections",
    ))
    .with_wait_for(WaitFor::message_on_stdout("Recovery is complete"))
    .with_env_var("ACCEPT_EULA", "Y")
    .with_env_var("MSSQL_SA_PASSWORD", MSSQL_PASSWORD)
    .with_env_var("MSSQL_PID", "Developer")
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
            skip_or_fail_on_ci(format!(
                "SQL Server testcontainer start failed ({error}). Docker daemon and amd64 SQL Server image support required."
            ));
            return;
        }
    };
    let port = match container.get_host_port_ipv4(1433.tcp()).await {
        Ok(port) => port,
        Err(error) => {
            skip_or_fail_on_ci(format!(
                "SQL Server container port mapping failed ({error})"
            ));
            return;
        }
    };

    let result = test_connection(TestConnectionRequest {
        config: mssql_public(port, Some(15), Some(false)),
        password: Some(MSSQL_PASSWORD.into()),
        existing_id: None,
    })
    .await;

    assert_eq!(result.unwrap(), "Connection successful");
}

fn skip_or_fail_on_ci(reason: String) {
    if std::env::var_os("CI").is_some() || std::env::var_os("GITHUB_ACTIONS").is_some() {
        panic!("{reason}");
    }
    println!("SKIP: {reason}");
}
