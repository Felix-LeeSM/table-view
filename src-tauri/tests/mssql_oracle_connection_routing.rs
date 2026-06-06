use table_view_lib::{
    commands::connection::{test_connection, TestConnectionRequest},
    error::AppError,
    models::{ConnectionConfig, ConnectionConfigPublic, DatabaseType},
};
use tokio::net::TcpListener;

#[tokio::test]
async fn test_connection_routes_mssql_to_mssql_adapter() {
    let mut conn = sample_connection("ms1", "Mssql1");
    conn.db_type = DatabaseType::Mssql;
    conn.port = unused_tcp_port().await;
    conn.host = "127.0.0.1".into();
    conn.user = "sa".into();
    conn.database = "master".into();

    let result = test_connection(TestConnectionRequest {
        config: ConnectionConfigPublic::from(&conn),
        password: Some("Testpass123!".into()),
        existing_id: None,
    })
    .await;

    match result {
        Err(AppError::Connection(msg)) => {
            assert!(msg.contains("SQL Server network connection failed"));
        }
        Err(AppError::Unsupported(msg)) => {
            panic!("SQL Server routing regressed: {msg}");
        }
        other => panic!("Expected SQL Server connection error, got: {other:?}"),
    }
}

#[tokio::test]
async fn test_connection_routes_oracle_to_oracle_adapter() {
    let mut conn = sample_connection("ora1", "Oracle1");
    conn.db_type = DatabaseType::Oracle;
    conn.port = unused_tcp_port().await;
    conn.host = "127.0.0.1".into();
    conn.user = "system".into();
    conn.database = "XEPDB1".into();

    let result = test_connection(TestConnectionRequest {
        config: ConnectionConfigPublic::from(&conn),
        password: Some("testpass".into()),
        existing_id: None,
    })
    .await;

    match result {
        Err(AppError::Connection(msg)) => {
            assert!(msg.contains("Oracle login failed"));
        }
        Err(AppError::Unsupported(msg)) => {
            panic!("Oracle routing regressed: {msg}");
        }
        other => panic!("Expected Oracle connection error, got: {other:?}"),
    }
}

fn sample_connection(id: &str, name: &str) -> ConnectionConfig {
    ConnectionConfig {
        id: id.to_string(),
        name: name.to_string(),
        db_type: DatabaseType::Postgresql,
        host: "localhost".to_string(),
        port: 5432,
        user: "postgres".to_string(),
        password: String::new(),
        database: "postgres".to_string(),
        read_only: false,
        group_id: None,
        color: None,
        connection_timeout: Some(1),
        keep_alive_interval: None,
        environment: None,
        auth_source: None,
        replica_set: None,
        tls_enabled: None,
    }
}

async fn unused_tcp_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    listener.local_addr().unwrap().port()
}
