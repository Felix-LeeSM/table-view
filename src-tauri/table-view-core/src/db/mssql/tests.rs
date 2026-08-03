use super::*;
use crate::db::{DbAdapter, RdbAdapter};
use crate::models::{ColumnChange, ColumnDefinition, ConstraintDefinition, SslMode};

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
        ssl_mode: SslMode::Prefer,
        ca_cert_path: None,
        oracle_use_sid: None,
        wallet_path: None,
        wallet_password: String::new(),
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

    let tds_config = MssqlAdapter::build_tds_config(&ConnectionConfig {
        host: " sqlserver.local ".into(),
        database: " ".into(),
        ssl_mode: SslMode::Prefer,
        ca_cert_path: None,
        oracle_use_sid: None,
        wallet_path: None,
        wallet_password: String::new(),
        ..config()
    })
    .unwrap();
    assert_eq!(tds_config.get_addr(), "sqlserver.local:1433");

    // Reason: #1649 — every TLS posture that can be honored must build a TDS
    // config. The two combinations `build_tds_config` used to reject ("TLS on
    // without a trust decision", "trust without TLS") cannot be spelled in
    // `SslMode`, so a rejection on any of these variants would be a regression.
    // `verify-ca` is excluded here because it carries a companion requirement
    // and is covered by its own test below. tiberius keeps
    // `Config::encryption`/`trust` private with no getter, so the posture itself
    // is not assertable from here — only that the config builds. (2026-08-02)
    for ssl_mode in [
        SslMode::Disable,
        SslMode::Prefer,
        SslMode::Require,
        SslMode::VerifyFull,
    ] {
        let tds_config = MssqlAdapter::build_tds_config(&ConnectionConfig {
            host: " sqlserver.local ".into(),
            port: 1445,
            ssl_mode,
            ..config()
        })
        .unwrap_or_else(|err| panic!("{ssl_mode:?} must build a TDS config, got {err:?}"));
        assert_eq!(tds_config.get_addr(), "sqlserver.local:1445");
    }
}

#[test]
fn build_tds_config_verify_ca_needs_a_ca_file_and_accepts_one() {
    // Reason: #1649 — MSSQL routes `verify-ca` through
    // `TdsConfig::trust_cert_ca`, which under the `native-tls` feature adds the
    // user's CA to the system roots and keeps hostname verification on. Both
    // halves are pinned: no CA file must fail closed with the shared message
    // (the adapter must not dial an unanchored `verify-ca`), and a CA file must
    // build. Dropping the `trust_cert_ca` call would leave the second half
    // passing, so the first half is what proves the posture is not silently
    // downgraded to `verify-full`. (2026-08-02)
    let err = MssqlAdapter::build_tds_config(&ConnectionConfig {
        ssl_mode: SslMode::VerifyCa,
        ca_cert_path: None,
        ..config()
    })
    .expect_err("verify-ca without a CA file must not reach tiberius");
    assert!(
        matches!(err, AppError::Validation(ref msg) if msg.contains("verify-ca")
            && msg.contains("CA certificate")),
        "the rejection must name the missing CA file, got: {err:?}"
    );

    let tds_config = MssqlAdapter::build_tds_config(&ConnectionConfig {
        ssl_mode: SslMode::VerifyCa,
        ca_cert_path: Some("/etc/ssl/private-ca.pem".into()),
        ..config()
    })
    .expect("verify-ca with a CA file must build");
    assert_eq!(tds_config.get_addr(), "localhost:1433");
}

// Reason: #1649 — this test used to also cover two TLS rejections ("TLS on
// without an explicit trustServerCertificate decision" and "trust without
// TLS"). `SslMode` cannot express either combination, so the guards moved from
// runtime validation into the type and the assertions were dropped rather than
// weakened; every `SslMode` variant now builds a TDS config (see
// `connection_config_validation_and_lifecycle_errors_are_local`). (2026-08-02)
#[test]
fn connection_config_rejects_unsupported_mssql_auth_modes_before_network() {
    let err = MssqlAdapter::build_tds_config(&ConnectionConfig {
        host: "localhost\\SQLEXPRESS".into(),
        ..config()
    })
    .unwrap_err();
    assert!(matches!(err, AppError::Validation(message) if message.contains("named instances")));

    let err = MssqlAdapter::build_tds_config(&ConnectionConfig {
        user: "DOMAIN\\alice".into(),
        ..config()
    })
    .unwrap_err();
    assert!(
        matches!(err, AppError::Validation(message) if message.contains("Windows authentication"))
    );

    let err = MssqlAdapter::build_tds_config(&ConnectionConfig {
        auth_source: Some("ActiveDirectoryPassword".into()),
        ..config()
    })
    .unwrap_err();
    assert!(matches!(err, AppError::Validation(message) if message.contains("AAD")));

    let err = MssqlAdapter::build_tds_config(&ConnectionConfig {
        replica_set: Some("SQLEXPRESS".into()),
        ..config()
    })
    .unwrap_err();
    assert!(matches!(err, AppError::Validation(message) if message.contains("named instance")));
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
async fn timeout_helper_maps_success_error_and_elapsed_timeout() {
    let ok = with_timeout(
        "SQL Server synthetic ok",
        std::time::Duration::from_millis(10),
        async { Ok::<_, &'static str>(7) },
    )
    .await
    .unwrap();
    assert_eq!(ok, 7);

    let err = with_timeout(
        "SQL Server synthetic error",
        std::time::Duration::from_millis(10),
        async { Err::<(), _>("driver failed") },
    )
    .await
    .unwrap_err();
    assert!(
        matches!(err, AppError::Connection(ref message) if message.contains("driver failed")),
        "{err:?}"
    );

    let err = with_timeout(
        "SQL Server synthetic timeout",
        std::time::Duration::from_millis(1),
        async {
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
            Ok::<_, &'static str>(())
        },
    )
    .await
    .unwrap_err();
    assert!(
        matches!(err, AppError::Connection(ref message) if message.contains("timed out after 0s")),
        "{err:?}"
    );
}

#[tokio::test]
async fn db_adapter_lifecycle_paths_are_local_without_sql_server() {
    let adapter = MssqlAdapter::new();

    assert_not_open(adapter.ping().await);
    adapter.disconnect().await.unwrap();
    assert_not_open(adapter.ping().await);

    let err = adapter
        .connect(&ConnectionConfig {
            host: " ".into(),
            ..config()
        })
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::Validation(message) if message.contains("host")));

    let err = MssqlAdapter::test(&ConnectionConfig {
        user: " ".into(),
        ..config()
    })
    .await
    .unwrap_err();
    assert!(matches!(err, AppError::Validation(message) if message.contains("user")));

    let err = MssqlAdapter::test(&ConnectionConfig {
        host: "127.0.0.1".into(),
        port: 1,
        connection_timeout: Some(1),
        ..config()
    })
    .await
    .unwrap_err();
    assert!(matches!(err, AppError::Connection(message) if message.contains("network connection")));
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

    let err = RdbAdapter::query_table_data(
        &adapter,
        "dbo",
        "users",
        1,
        25,
        None,
        None,
        None,
        Some(&cancel),
    )
    .await
    .unwrap_err();
    assert!(matches!(err, AppError::Database(msg) if msg == "Operation cancelled"));
}

#[tokio::test]
async fn cancellable_trait_wrappers_return_work_result_without_open_connection() {
    let adapter = MssqlAdapter::new();
    let cancel = CancellationToken::new();

    assert_not_open(RdbAdapter::get_columns(&adapter, "dbo", "users", Some(&cancel)).await);
    assert_not_open(RdbAdapter::get_table_indexes(&adapter, "dbo", "users", Some(&cancel)).await);
    assert_not_open(
        RdbAdapter::get_table_constraints(&adapter, "dbo", "users", Some(&cancel)).await,
    );

    let batch = vec!["UPDATE dbo.users SET name = 'Ada'".to_string()];
    assert_not_open(RdbAdapter::execute_sql_batch(&adapter, &batch, Some(&cancel)).await);
    assert_not_open(RdbAdapter::dry_run_sql_batch(&adapter, &batch, Some(&cancel)).await);
    assert_not_open(
        RdbAdapter::query_table_data(
            &adapter,
            "dbo",
            "users",
            1,
            25,
            None,
            None,
            None,
            Some(&cancel),
        )
        .await,
    );
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
    // Issue #1071 (2차) — trigger introspection joins the connection guard set.
    assert_not_open(RdbAdapter::list_triggers(&adapter, "dbo", "users").await);

    let err = RdbAdapter::switch_database(&adapter, " ")
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::Validation(message) if message.contains("database name")));
}

#[tokio::test]
async fn table_data_and_structured_ddl_execute_paths_require_open_connection() {
    let adapter = MssqlAdapter::new();

    assert_not_open(
        RdbAdapter::query_table_data(&adapter, "dbo", "users", 1, 25, None, None, None, None).await,
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

    assert_not_open(adapter.drop_table(&drop_table).await);
    assert_not_open(adapter.rename_table(&rename_table).await);
    assert_not_open(adapter.alter_table(&alter_table).await);
    assert_not_open(adapter.add_column(&add_column).await);
    assert_not_open(adapter.drop_column(&drop_column).await);
    assert_not_open(adapter.create_table(&create_table).await);
    assert_not_open(adapter.create_index(&create_index).await);
    assert_not_open(adapter.drop_index(&drop_index).await);
    assert_not_open(adapter.add_constraint(&add_constraint).await);
    assert_not_open(adapter.drop_constraint(&drop_constraint).await);
}

fn assert_not_open<T>(result: Result<T, AppError>) {
    assert!(matches!(result, Err(AppError::Connection(message)) if message.contains("not open")));
}

// Reason: issue #1453 — driver/network text can echo the connection string;
// the shared connection-error mapper must mask URI userinfo and
// `Password=...` key=value credentials while keeping host/context so the
// error stays actionable (2026-07-10).
#[test]
fn mssql_connection_error_masks_credential_echo() {
    let err = mssql_connection_error(
        "SQL Server network connection failed",
        "cannot open mssql://sa:S3cretPw1@db.local:1433 with Password=S3cretPw1;Server=db.local",
    );
    let message = err.to_string();
    assert!(
        !message.contains("S3cretPw1"),
        "leaked plaintext credential: {message}"
    );
    assert!(message.contains("SQL Server network connection failed"));
    assert!(message.contains("db.local"));
}
