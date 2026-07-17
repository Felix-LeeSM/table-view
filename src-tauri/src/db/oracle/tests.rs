use super::*;
use crate::models::{ColumnChange, ColumnDefinition, ConstraintDefinition};
use oracle_rs::config::ServiceMethod;
use tokio_util::sync::CancellationToken;

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
        trust_server_certificate: None,
        oracle_use_sid: None,
        wallet_path: None,
        wallet_password: String::new(),
    }
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

    let mut explicit_false = oracle_config();
    explicit_false.tls_enabled = Some(false);
    explicit_false.trust_server_certificate = Some(false);
    OracleAdapter::connect_config(&explicit_false, 30)
        .expect("explicit false TLS flags should not enable unsupported Oracle TLS mode");
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
fn connect_config_rejects_empty_required_fields() {
    let mut config = oracle_config();
    config.host = " ".into();
    assert!(matches!(
        OracleAdapter::connect_config(&config, 5),
        Err(AppError::Validation(message)) if message.contains("host")
    ));

    config = oracle_config();
    config.port = 0;
    assert!(matches!(
        OracleAdapter::connect_config(&config, 5),
        Err(AppError::Validation(message)) if message.contains("port")
    ));

    config = oracle_config();
    config.user = " ".into();
    assert!(matches!(
        OracleAdapter::connect_config(&config, 5),
        Err(AppError::Validation(message)) if message.contains("user")
    ));
}

#[test]
fn connect_config_still_rejects_advanced_auth_and_mssql_tls_toggles() {
    // Reason: #1065 opens SID + wallet but keeps rejecting password-less
    // external auth and the MSSQL-only tls/trust toggles (Oracle exposes
    // neither; the wallet field is the only Oracle TLS trigger). (2026-07-17)
    let mut advanced = oracle_config();
    advanced.password.clear();
    assert!(matches!(
        OracleAdapter::connect_config(&advanced, 5),
        Err(AppError::Validation(message))
            if message.contains("password authentication") && message.contains("advanced")
    ));

    let mut auth_field = oracle_config();
    auth_field.auth_source = Some("kerberos".into());
    assert!(matches!(
        OracleAdapter::connect_config(&auth_field, 5),
        Err(AppError::Validation(message)) if message.contains("advanced auth")
    ));

    let mut replica_field = oracle_config();
    replica_field.replica_set = Some("tnsnames-alias".into());
    assert!(matches!(
        OracleAdapter::connect_config(&replica_field, 5),
        Err(AppError::Validation(_))
    ));

    let mut tls = oracle_config();
    tls.tls_enabled = Some(true);
    assert!(matches!(
        OracleAdapter::connect_config(&tls, 5),
        Err(AppError::Validation(message)) if message.contains("wallet")
    ));

    let mut trust = oracle_config();
    trust.trust_server_certificate = Some(true);
    assert!(matches!(
        OracleAdapter::connect_config(&trust, 5),
        Err(AppError::Validation(message)) if message.contains("wallet")
    ));
}

#[test]
fn connect_config_rejects_descriptor_injection_in_identifiers() {
    // Reason: #1065 — the driver's `build_connect_string` interpolates
    // host/service/SID into a TNS descriptor with zero escaping, so a `)(`
    // value could inject descriptor clauses (real trigger: an imported export
    // envelope, threat model §2.1). The character whitelist at this trust
    // boundary is the mitigation; injection strings must be rejected, never
    // passed to the driver. (2026-07-17)
    let injections = [
        "X)(SERVER=DEDICATED))(ADDRESS=(HOST=evil",
        "svc/../other",
        "svc name",
        "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)))",
        "svc);DROP",
    ];
    for bad in injections {
        let mut svc = oracle_config();
        svc.database = bad.into();
        assert!(
            matches!(
                OracleAdapter::connect_config(&svc, 5),
                Err(AppError::Validation(_))
            ),
            "service name injection not rejected: {bad}"
        );

        let mut host = oracle_config();
        host.host = bad.into();
        assert!(
            matches!(
                OracleAdapter::connect_config(&host, 5),
                Err(AppError::Validation(_))
            ),
            "host injection not rejected: {bad}"
        );
    }

    // A legitimate ADB-style dotted/underscored service name survives.
    let mut adb = oracle_config();
    adb.database = "g1a2b3_myadb_high.adb.oraclecloud.com".into();
    OracleAdapter::connect_config(&adb, 5)
        .expect("ADB service name with dots/underscores must be accepted");
}

#[test]
fn connect_config_uses_sid_method_when_flagged() {
    // Reason: #1065 — `oracle_use_sid = Some(true)` selects the driver's
    // native `Config::with_sid`; without it the identifier is a service name.
    // (2026-07-17)
    let mut sid = oracle_config();
    sid.oracle_use_sid = Some(true);
    sid.database = " ORCL ".into();
    let config = OracleAdapter::connect_config(&sid, 5).unwrap();
    assert!(matches!(
        config.service,
        ServiceMethod::Sid(ref s) if s == "ORCL"
    ));
    assert!(!config.is_tls_enabled());

    let mut empty_sid = oracle_config();
    empty_sid.oracle_use_sid = Some(true);
    empty_sid.database = "  ".into();
    assert!(matches!(
        OracleAdapter::connect_config(&empty_sid, 5),
        Err(AppError::Validation(message)) if message.contains("SID")
    ));
}

#[test]
fn connect_config_wallet_missing_dir_errors_without_leaking_path() {
    // Reason: #1065 — a wallet path that can't be loaded (no ewallet.pem) must
    // fail closed, and the error must NOT echo the wallet path (leaks the home
    // dir username / topology; redact contract §2.5 / #1453). (2026-07-17)
    let dir = tempfile::tempdir().unwrap();
    let wallet_path = dir.path().join("nope-oracle-wallet");
    let mut wallet = oracle_config();
    wallet.wallet_path = Some(wallet_path.to_string_lossy().into_owned());

    match OracleAdapter::connect_config(&wallet, 5) {
        Err(AppError::Connection(message)) => {
            assert!(
                !message.contains(&*wallet_path.to_string_lossy()),
                "wallet path leaked into error: {message}"
            );
        }
        other => panic!("expected redacted Connection error, got {other:?}"),
    }
}

#[test]
fn connect_config_without_wallet_leaves_tls_disabled() {
    // Reason: #1065 — no wallet path means plain TCP; the wallet field is the
    // only Oracle TLS trigger (1-way TLS / trust toggles are out of scope).
    // (2026-07-17)
    let config = OracleAdapter::connect_config(&oracle_config(), 5).unwrap();
    assert!(!config.is_tls_enabled());
    assert!(config.tls_config.is_none());
}

#[test]
fn configured_timeout_is_clamped_for_runtime_connect() {
    assert_eq!(connection_timeout_secs(&oracle_config()), 30);

    let mut config = oracle_config();
    config.connection_timeout = Some(2);
    assert_eq!(connection_timeout_secs(&config), 2);

    config.connection_timeout = Some(120);
    assert_eq!(connection_timeout_secs(&config), 30);

    config.connection_timeout = None;
    assert_eq!(connection_timeout_secs(&config), 30);
}

#[test]
fn oracle_connection_helpers_keep_error_and_empty_string_contracts() {
    assert_eq!(non_empty("  XEPDB1  ".into()).as_deref(), Some("XEPDB1"));
    assert_eq!(non_empty("   ".into()), None);

    let error = map_oracle_connection_error(oracle_rs::Error::oracle(12514, "listener failed"));
    assert!(matches!(
        error,
        AppError::Connection(message)
            if message.contains("ORA-12514") && message.contains("listener failed")
    ));
}

#[tokio::test]
async fn test_and_connect_reject_invalid_config_before_network_open() {
    let mut config = oracle_config();
    config.host = " ".into();
    assert!(matches!(
        OracleAdapter::test(&config).await,
        Err(AppError::Validation(message)) if message.contains("host")
    ));

    config = oracle_config();
    config.user = " ".into();
    let adapter = OracleAdapter::new();
    assert!(matches!(
        <OracleAdapter as DbAdapter>::connect(&adapter, &config).await,
        Err(AppError::Validation(message)) if message.contains("user")
    ));
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
async fn db_adapter_lifecycle_fails_closed_without_connection() {
    let adapter = OracleAdapter::new();

    assert!(matches!(adapter.kind(), DatabaseType::Oracle));
    assert_eq!(
        <OracleAdapter as RdbAdapter>::current_database(&adapter)
            .await
            .unwrap(),
        None
    );
    assert_oracle_not_open(<OracleAdapter as DbAdapter>::ping(&adapter).await);
    assert!(<OracleAdapter as DbAdapter>::disconnect(&adapter)
        .await
        .is_ok());
}

#[tokio::test]
async fn cancellable_metadata_obeys_cancel_token_before_work_completes() {
    let token = CancellationToken::new();
    token.cancel();

    let result =
        cancellable_metadata(std::future::pending::<Result<(), AppError>>(), Some(&token)).await;
    assert!(matches!(
        result,
        Err(AppError::Database(message)) if message.contains("cancelled")
    ));
}

#[tokio::test]
async fn raw_ddl_admin_execution_fails_closed_without_connection() {
    let adapter = OracleAdapter::new();
    let err = adapter
        .execute_query(
            "ALTER SESSION SET CURRENT_SCHEMA = HR",
            None,
            crate::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .unwrap_err();

    assert!(matches!(
        err,
        AppError::Unsupported(message)
            if message.contains("raw DDL/admin") && message.contains("issue #905")
    ));
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
async fn rdb_trait_catalog_surfaces_require_open_connection() {
    let adapter = OracleAdapter::new();
    let statements = vec!["SELECT 1 FROM DUAL".to_string()];

    fn assert_trait_not_open<T>(label: &str, result: Result<T, AppError>) {
        assert!(
            matches!(
                result,
                Err(AppError::Connection(message)) if message.contains("not open")
            ),
            "{label} did not fail closed as Oracle connection not open"
        );
    }

    assert_trait_not_open("list_databases", RdbAdapter::list_databases(&adapter).await);
    assert_trait_not_open(
        "list_tables",
        RdbAdapter::list_tables(&adapter, "SYSTEM").await,
    );
    assert_trait_not_open(
        "execute_sql",
        RdbAdapter::execute_sql(&adapter, "SELECT 1 FROM DUAL", None).await,
    );
    assert!(RdbAdapter::execute_sql_batch(&adapter, &statements, None)
        .await
        .is_err());
    assert!(RdbAdapter::dry_run_sql_batch(&adapter, &statements, None)
        .await
        .is_err());
    assert_trait_not_open(
        "query_table_data",
        RdbAdapter::query_table_data(&adapter, "SYSTEM", "T", 1, 10, None, None, None, None).await,
    );
    assert_trait_not_open(
        "list_views",
        RdbAdapter::list_views(&adapter, "SYSTEM").await,
    );
    assert_trait_not_open(
        "list_functions",
        RdbAdapter::list_functions(&adapter, "SYSTEM").await,
    );
    assert_trait_not_open(
        "get_view_definition",
        RdbAdapter::get_view_definition(&adapter, "SYSTEM", "V").await,
    );
    assert_trait_not_open(
        "get_view_columns",
        RdbAdapter::get_view_columns(&adapter, "SYSTEM", "V").await,
    );
    assert_trait_not_open(
        "list_schema_columns",
        RdbAdapter::list_schema_columns(&adapter, "SYSTEM").await,
    );
    assert_trait_not_open(
        "get_function_source",
        RdbAdapter::get_function_source(&adapter, "SYSTEM", "F").await,
    );

    let triggers = RdbAdapter::list_triggers(&adapter, "SYSTEM", "T")
        .await
        .unwrap();
    assert!(triggers.is_empty());
}

#[tokio::test]
async fn table_data_and_structured_ddl_execute_paths_require_open_connection() {
    let adapter = OracleAdapter::new();
    let drop_table = DropTableRequest {
        connection_id: "oracle-1".into(),
        schema: "SYSTEM".into(),
        table: "T".into(),
        cascade: false,
        preview_only: false,
        expected_database: None,
    };
    let rename_table = RenameTableRequest {
        connection_id: "oracle-1".into(),
        schema: "SYSTEM".into(),
        table: "T".into(),
        new_name: "T2".into(),
        preview_only: false,
        expected_database: None,
    };
    let alter_table = AlterTableRequest {
        connection_id: "oracle-1".into(),
        schema: "SYSTEM".into(),
        table: "T".into(),
        changes: vec![ColumnChange::Drop { name: "C".into() }],
        preview_only: false,
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
        preview_only: false,
        expected_database: None,
    };
    let add_column_req = AddColumnRequest {
        connection_id: "oracle-1".into(),
        schema: "SYSTEM".into(),
        table: "T".into(),
        column: column.clone(),
        check_expression: None,
        preview_only: false,
        expected_database: None,
    };
    let create_table = CreateTableRequest {
        connection_id: "oracle-1".into(),
        schema: "SYSTEM".into(),
        name: "T".into(),
        columns: vec![column],
        primary_key: None,
        preview_only: false,
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
        preview_only: false,
        expected_database: None,
    };
    let drop_index = DropIndexRequest {
        connection_id: "oracle-1".into(),
        schema: "SYSTEM".into(),
        index_name: "T_C_IDX".into(),
        table: "T".into(),
        if_exists: false,
        preview_only: false,
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
        preview_only: false,
        expected_database: None,
    };
    let drop_constraint = DropConstraintRequest {
        connection_id: "oracle-1".into(),
        schema: "SYSTEM".into(),
        table: "T".into(),
        constraint_name: "T_C_UNIQ".into(),
        preview_only: false,
        expected_database: None,
    };

    assert_oracle_not_open(
        adapter
            .query_table_data("SYSTEM", "T", 1, 100, None, None, None, None)
            .await,
    );
    assert_oracle_not_open(adapter.drop_table(&drop_table).await);
    assert_oracle_not_open(adapter.rename_table(&rename_table).await);
    assert_oracle_not_open(adapter.alter_table(&alter_table).await);
    assert_oracle_not_open(adapter.add_column(&add_column_req).await);
    assert_oracle_not_open(adapter.drop_column(&drop_column).await);
    assert_oracle_not_open(adapter.create_table(&create_table).await);
    assert_oracle_not_open(adapter.create_index(&create_index).await);
    assert_oracle_not_open(adapter.drop_index(&drop_index).await);
    assert_oracle_not_open(adapter.add_constraint(&add_constraint).await);
    assert_oracle_not_open(adapter.drop_constraint(&drop_constraint).await);
}

// Reason: issue #1453 — Oracle connect errors can echo a URL / DSN with
// credentials; `map_oracle_connection_error` must mask the secret while
// preserving the ORA code and host (2026-07-10).
#[test]
fn oracle_connection_error_masks_credential_echo() {
    let error = map_oracle_connection_error(oracle_rs::Error::oracle(
        12154,
        "cannot resolve oracle://app:S3cretPw1@dbhost:1521/XEPDB1 password=S3cretPw1",
    ));
    match error {
        AppError::Connection(message) => {
            assert!(
                !message.contains("S3cretPw1"),
                "leaked plaintext credential: {message}"
            );
            assert!(message.contains("ORA-12154"));
            assert!(message.contains("dbhost:1521"));
        }
        other => panic!("expected Connection error, got {other:?}"),
    }
}
