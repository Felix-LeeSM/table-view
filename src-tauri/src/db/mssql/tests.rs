use super::*;
use crate::db::{DbAdapter, RdbAdapter};
use crate::models::{ColumnChange, ColumnDefinition, ConstraintDefinition};

fn config() -> ConnectionConfig {
    ConnectionConfig {
        id: "conn".into(),
        name: "mssql".into(),
        db_type: DatabaseType::Mssql,
        host: "localhost".into(),
        port: 1433,
        user: "sa".into(),
        password: "secret".into(),
        database: "master".into(),
        read_only: false,
        group_id: None,
        color: None,
        connection_timeout: None,
        keep_alive_interval: None,
        environment: None,
        auth_source: None,
        replica_set: None,
        tls_enabled: None,
    }
}

#[test]
fn connection_config_validation_and_lifecycle_errors_are_local() {
    let adapter = MssqlAdapter::default();
    assert!(matches!(adapter.kind(), DatabaseType::Mssql));
    assert!(matches!(adapter.namespace_label(), NamespaceLabel::Schema));

    let err = MssqlAdapter::build_tds_config(&ConnectionConfig {
        host: " ".into(),
        ..config()
    })
    .unwrap_err();
    assert!(matches!(err, AppError::Validation(_)));

    let err = MssqlAdapter::build_tds_config(&ConnectionConfig {
        user: " ".into(),
        ..config()
    })
    .unwrap_err();
    assert!(matches!(err, AppError::Validation(_)));
}

#[test]
fn connection_timeout_clamps_ui_value() {
    assert_eq!(MssqlAdapter::connection_timeout(&config()).as_secs(), 10);
    assert_eq!(
        MssqlAdapter::connection_timeout(&ConnectionConfig {
            connection_timeout: Some(0),
            ..config()
        })
        .as_secs(),
        1
    );
    assert_eq!(
        MssqlAdapter::connection_timeout(&ConnectionConfig {
            connection_timeout: Some(301),
            ..config()
        })
        .as_secs(),
        300
    );
    assert_eq!(
        MssqlAdapter::connection_timeout(&ConnectionConfig {
            connection_timeout: Some(42),
            ..config()
        })
        .as_secs(),
        42
    );
}

#[tokio::test]
async fn pre_cancelled_query_short_circuits_before_connection_lookup() {
    let adapter = MssqlAdapter::new();
    let cancel = CancellationToken::new();
    cancel.cancel();

    let err = adapter
        .execute_sql("SELECT 1", Some(&cancel))
        .await
        .unwrap_err();

    assert!(matches!(err, AppError::Database(msg) if msg == "Query cancelled"));
}

#[tokio::test]
async fn catalog_surfaces_fail_locally_without_open_connection() {
    let adapter = MssqlAdapter::new();

    assert_not_open(RdbAdapter::list_namespaces(&adapter).await);
    assert_not_open(RdbAdapter::list_databases(&adapter).await);
    assert_not_open(RdbAdapter::switch_database(&adapter, "master").await);
    assert_not_open(RdbAdapter::current_database(&adapter).await);
    assert_not_open(RdbAdapter::list_tables(&adapter, "dbo").await);
    assert_not_open(RdbAdapter::get_columns(&adapter, "dbo", "users", None).await);
    assert_not_open(RdbAdapter::get_table_indexes(&adapter, "dbo", "users", None).await);
    assert_not_open(RdbAdapter::get_table_constraints(&adapter, "dbo", "users", None).await);
    assert_not_open(RdbAdapter::list_views(&adapter, "dbo").await);
    assert_not_open(RdbAdapter::get_view_definition(&adapter, "dbo", "active_users").await);
    assert_not_open(RdbAdapter::get_view_columns(&adapter, "dbo", "active_users").await);
    assert_not_open(RdbAdapter::list_schema_columns(&adapter, "dbo").await);
    assert_not_open(RdbAdapter::list_functions(&adapter, "dbo").await);
    assert_not_open(RdbAdapter::get_function_source(&adapter, "dbo", "touch_user").await);

    let err = RdbAdapter::switch_database(&adapter, " ")
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::Validation(message) if message.contains("database name")));
}

#[tokio::test]
async fn table_data_and_edit_surfaces_stay_explicitly_unsupported() {
    let adapter = MssqlAdapter::new();

    assert_unsupported(
        adapter
            .query_table_data("dbo", "users", 1, 25, None, None, None, None)
            .await,
    );

    let column = ColumnDefinition {
        name: "id".into(),
        data_type: "int".into(),
        nullable: false,
        default_value: None,
        comment: None,
        is_identity: false,
    };
    let drop_table = DropTableRequest {
        connection_id: "conn".into(),
        schema: "dbo".into(),
        table: "users".into(),
        cascade: false,
        preview_only: false,
        expected_database: None,
    };
    let rename_table = RenameTableRequest {
        connection_id: "conn".into(),
        schema: "dbo".into(),
        table: "users".into(),
        new_name: "people".into(),
        preview_only: false,
        expected_database: None,
    };
    let alter_table = AlterTableRequest {
        connection_id: "conn".into(),
        schema: "dbo".into(),
        table: "users".into(),
        changes: vec![ColumnChange::Drop { name: "old".into() }],
        preview_only: false,
        expected_database: None,
    };
    let add_column = AddColumnRequest {
        connection_id: "conn".into(),
        schema: "dbo".into(),
        table: "users".into(),
        column: column.clone(),
        check_expression: None,
        preview_only: false,
        expected_database: None,
    };
    let drop_column = DropColumnRequest {
        connection_id: "conn".into(),
        schema: "dbo".into(),
        table: "users".into(),
        column_name: "old".into(),
        cascade: false,
        preview_only: false,
        expected_database: None,
    };
    let create_table = CreateTableRequest {
        connection_id: "conn".into(),
        schema: "dbo".into(),
        name: "users".into(),
        columns: vec![column],
        primary_key: None,
        preview_only: false,
        table_comment: None,
        expected_database: None,
    };
    let create_index = CreateIndexRequest {
        connection_id: "conn".into(),
        schema: "dbo".into(),
        table: "users".into(),
        index_name: "idx_users_id".into(),
        columns: vec!["id".into()],
        index_type: "btree".into(),
        is_unique: false,
        preview_only: false,
        expected_database: None,
    };
    let drop_index = DropIndexRequest {
        connection_id: "conn".into(),
        schema: "dbo".into(),
        index_name: "idx_users_id".into(),
        table: "users".into(),
        if_exists: false,
        preview_only: false,
        expected_database: None,
    };
    let add_constraint = AddConstraintRequest {
        connection_id: "conn".into(),
        schema: "dbo".into(),
        table: "users".into(),
        constraint_name: "pk_users".into(),
        definition: ConstraintDefinition::PrimaryKey {
            columns: vec!["id".into()],
        },
        preview_only: false,
        expected_database: None,
    };
    let drop_constraint = DropConstraintRequest {
        connection_id: "conn".into(),
        schema: "dbo".into(),
        table: "users".into(),
        constraint_name: "pk_users".into(),
        preview_only: false,
        expected_database: None,
    };

    assert_unsupported(adapter.drop_table(&drop_table).await);
    assert_unsupported(adapter.rename_table(&rename_table).await);
    assert_unsupported(adapter.alter_table(&alter_table).await);
    assert_unsupported(adapter.add_column(&add_column).await);
    assert_unsupported(adapter.drop_column(&drop_column).await);
    assert_unsupported(adapter.create_table(&create_table).await);
    assert_unsupported(adapter.create_index(&create_index).await);
    assert_unsupported(adapter.drop_index(&drop_index).await);
    assert_unsupported(adapter.add_constraint(&add_constraint).await);
    assert_unsupported(adapter.drop_constraint(&drop_constraint).await);
}

fn assert_unsupported<T>(result: Result<T, AppError>) {
    assert!(
        matches!(result, Err(AppError::Unsupported(message)) if message.contains("not implemented"))
    );
}

fn assert_not_open<T>(result: Result<T, AppError>) {
    assert!(matches!(result, Err(AppError::Connection(message)) if message.contains("not open")));
}
