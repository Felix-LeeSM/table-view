use table_view_lib::commands::connection::{test_connection, TestConnectionRequest};
use table_view_lib::error::AppError;
use table_view_lib::models::{ConnectionConfigPublic, DatabaseType};
use tokio::net::TcpListener;

fn mssql_public(port: u16) -> ConnectionConfigPublic {
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
        connection_timeout: Some(1),
        keep_alive_interval: None,
        environment: None,
        has_password: true,
        paradigm: DatabaseType::Mssql.paradigm(),
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
        config: mssql_public(port),
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
