use super::*;
use crate::models::{ColumnChange, ColumnDefinition, ConstraintDefinition};
use oracle_rs::config::ServiceMethod;

fn oracle_config() -> ConnectionConfig {
    ConnectionConfig {
        id: "oracle-1".into(),
        name: "Oracle".into(),
        db_type: DatabaseType::Oracle,
        host: " localhost ".into(),
        port: 1521,
        user: " testuser ".into(),
        password: "testpass".into(),
        database: " XEPDB1 ".into(),
        read_only: false,
        group_id: None,
        color: None,
        connection_timeout: Some(120),
        keep_alive_interval: None,
        environment: None,
        auth_source: None,
        replica_set: None,
        tls_enabled: None,
    }
}

fn assert_oracle_unsupported<T>(result: Result<T, AppError>) {
    assert!(matches!(
        result,
        Err(AppError::Unsupported(message)) if message == ORACLE_UNSUPPORTED_RUNTIME
    ));
}

fn assert_oracle_not_open<T>(result: Result<T, AppError>) {
    assert!(matches!(
        result,
        Err(AppError::Connection(message)) if message.contains("not open")
    ));
}

#[test]
fn connect_config_uses_service_name_without_sid_wallet_or_tls() {
    let config = OracleAdapter::connect_config(&oracle_config(), 30).unwrap();

    assert_eq!(config.host, "localhost");
    assert_eq!(config.port, 1521);
    assert_eq!(config.username, "testuser");
    assert_eq!(config.connect_timeout, Duration::from_secs(30));
    assert!(!config.is_tls_enabled());
    assert!(config.tls_config.is_none());
    assert!(matches!(
        config.service,
        ServiceMethod::ServiceName(ref service) if service == "XEPDB1"
    ));
}

#[test]
fn connect_config_rejects_empty_service_name() {
    let mut config = oracle_config();
    config.database = " ".into();

    assert!(matches!(
        OracleAdapter::connect_config(&config, 5),
        Err(AppError::Validation(message)) if message.contains("service name")
    ));
}

#[test]
fn configured_timeout_is_clamped_for_runtime_connect() {
    assert_eq!(connection_timeout_secs(&oracle_config()), 30);

    let mut config = oracle_config();
    config.connection_timeout = Some(2);
    assert_eq!(connection_timeout_secs(&config), 2);
}

#[tokio::test]
async fn current_database_returns_service_name_identity_when_connected() {
    let adapter = OracleAdapter::new();
    {
        let mut guard = adapter.state.lock().await;
        guard.connected_config = Some(oracle_config());
    }

    assert_eq!(
        adapter.current_database().await.unwrap(),
        Some("XEPDB1".into())
    );
}

#[tokio::test]
async fn current_database_without_connection_returns_none_for_fail_closed_guard() {
    let adapter = OracleAdapter::new();

    assert_eq!(adapter.current_database().await.unwrap(), None);
}

#[tokio::test]
async fn catalog_surfaces_require_open_connection() {
    let adapter = OracleAdapter::new();
    assert!(matches!(adapter.namespace_label(), NamespaceLabel::Schema));

    assert_oracle_not_open(adapter.list_namespaces().await);
    assert_oracle_not_open(adapter.list_databases().await);
    assert_oracle_not_open(adapter.list_tables("SYSTEM").await);
    assert_oracle_not_open(adapter.get_columns("SYSTEM", "T", None).await);
    assert_oracle_not_open(RdbAdapter::get_table_indexes(&adapter, "SYSTEM", "T", None).await);
    assert_oracle_not_open(RdbAdapter::get_table_constraints(&adapter, "SYSTEM", "T", None).await);
    assert_oracle_not_open(adapter.list_views("SYSTEM").await);
    assert_oracle_not_open(adapter.list_functions("SYSTEM").await);
    assert_oracle_not_open(adapter.get_view_definition("SYSTEM", "V").await);
    assert_oracle_not_open(adapter.get_view_columns("SYSTEM", "V").await);
    assert_oracle_not_open(adapter.list_schema_columns("SYSTEM").await);
    assert_oracle_not_open(adapter.get_function_source("SYSTEM", "F").await);

    let triggers = adapter.list_triggers("SYSTEM", "T").await.unwrap();
    assert!(triggers.is_empty());
}

#[tokio::test]
async fn table_data_edit_and_structured_ddl_surfaces_remain_unsupported() {
    let adapter = OracleAdapter::new();
    let drop_table = DropTableRequest {
        connection_id: "oracle-1".into(),
        schema: "SYSTEM".into(),
        table: "T".into(),
        cascade: false,
        preview_only: true,
        expected_database: None,
    };
    let rename_table = RenameTableRequest {
        connection_id: "oracle-1".into(),
        schema: "SYSTEM".into(),
        table: "T".into(),
        new_name: "T2".into(),
        preview_only: true,
        expected_database: None,
    };
    let alter_table = AlterTableRequest {
        connection_id: "oracle-1".into(),
        schema: "SYSTEM".into(),
        table: "T".into(),
        changes: vec![ColumnChange::Drop { name: "C".into() }],
        preview_only: true,
        expected_database: None,
    };
    let column = ColumnDefinition {
        name: "C".into(),
        data_type: "NUMBER".into(),
        nullable: true,
        default_value: None,
        comment: None,
        is_identity: false,
    };
    let drop_column = DropColumnRequest {
        connection_id: "oracle-1".into(),
        schema: "SYSTEM".into(),
        table: "T".into(),
        column_name: "C".into(),
        cascade: false,
        preview_only: true,
        expected_database: None,
    };
    let add_column_req = AddColumnRequest {
        connection_id: "oracle-1".into(),
        schema: "SYSTEM".into(),
        table: "T".into(),
        column: column.clone(),
        check_expression: None,
        preview_only: true,
        expected_database: None,
    };
    let create_table = CreateTableRequest {
        connection_id: "oracle-1".into(),
        schema: "SYSTEM".into(),
        name: "T".into(),
        columns: vec![column],
        primary_key: None,
        preview_only: true,
        table_comment: None,
        expected_database: None,
    };
    let create_index = CreateIndexRequest {
        connection_id: "oracle-1".into(),
        schema: "SYSTEM".into(),
        table: "T".into(),
        index_name: "T_C_IDX".into(),
        columns: vec!["C".into()],
        index_type: "btree".into(),
        is_unique: false,
        preview_only: true,
        expected_database: None,
    };
    let drop_index = DropIndexRequest {
        connection_id: "oracle-1".into(),
        schema: "SYSTEM".into(),
        index_name: "T_C_IDX".into(),
        table: "T".into(),
        if_exists: false,
        preview_only: true,
        expected_database: None,
    };
    let add_constraint = AddConstraintRequest {
        connection_id: "oracle-1".into(),
        schema: "SYSTEM".into(),
        table: "T".into(),
        constraint_name: "T_C_UNIQ".into(),
        definition: ConstraintDefinition::Unique {
            columns: vec!["C".into()],
        },
        preview_only: true,
        expected_database: None,
    };
    let drop_constraint = DropConstraintRequest {
        connection_id: "oracle-1".into(),
        schema: "SYSTEM".into(),
        table: "T".into(),
        constraint_name: "T_C_UNIQ".into(),
        preview_only: true,
        expected_database: None,
    };

    assert_oracle_unsupported(
        adapter
            .query_table_data("SYSTEM", "T", 1, 100, None, None, None, None)
            .await,
    );
    assert_oracle_unsupported(adapter.drop_table(&drop_table).await);
    assert_oracle_unsupported(adapter.rename_table(&rename_table).await);
    assert_oracle_unsupported(adapter.alter_table(&alter_table).await);
    assert_oracle_unsupported(adapter.add_column(&add_column_req).await);
    assert_oracle_unsupported(adapter.drop_column(&drop_column).await);
    assert_oracle_unsupported(adapter.create_table(&create_table).await);
    assert_oracle_unsupported(adapter.create_index(&create_index).await);
    assert_oracle_unsupported(adapter.drop_index(&drop_index).await);
    assert_oracle_unsupported(adapter.add_constraint(&add_constraint).await);
    assert_oracle_unsupported(adapter.drop_constraint(&drop_constraint).await);
}
