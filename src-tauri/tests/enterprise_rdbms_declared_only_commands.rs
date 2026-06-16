use table_view_lib::commands::connection::{test_connection, TestConnectionRequest};
use table_view_lib::error::AppError;
use table_view_lib::models::{ConnectionConfigPublic, DatabaseType};

fn oracle_public() -> ConnectionConfigPublic {
    ConnectionConfigPublic {
        id: "oracle-c1".into(),
        name: "Oracle fixture".into(),
        db_type: DatabaseType::Oracle,
        host: "127.0.0.1".into(),
        port: 1521,
        user: "system".into(),
        database: "ORCLPDB1".into(),
        read_only: false,
        group_id: None,
        color: None,
        connection_timeout: Some(1),
        keep_alive_interval: None,
        environment: None,
        has_password: true,
        paradigm: DatabaseType::Oracle.paradigm(),
        auth_source: None,
        replica_set: None,
        tls_enabled: None,
        trust_server_certificate: None,
    }
}

#[tokio::test]
async fn test_connection_rejects_oracle_declared_only_before_adapter_dispatch() {
    let result = test_connection(TestConnectionRequest {
        config: oracle_public(),
        password: Some("pw".into()),
        existing_id: None,
    })
    .await;

    match result {
        Err(AppError::Unsupported(msg)) => {
            assert!(msg.contains("Oracle is declared-only"));
            assert!(msg.contains("source-specific connection.test"));
        }
        other => panic!("Expected Oracle declared-only rejection, got: {other:?}"),
    }
}
