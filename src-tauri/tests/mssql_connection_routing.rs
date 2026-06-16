use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use table_view_lib::commands::connection::{test_connection, TestConnectionRequest};
use table_view_lib::db::{DbAdapter, MssqlAdapter, RdbAdapter};
use table_view_lib::error::AppError;
use table_view_lib::models::{
    ColumnCategory, ColumnInfo, ConnectionConfig, ConnectionConfigPublic, ConstraintInfo,
    DatabaseType, FunctionInfo,
};
use testcontainers::core::{IntoContainerPort, WaitFor};
use testcontainers::runners::AsyncRunner;
use testcontainers::{ContainerAsync, GenericImage, ImageExt};
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;

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

async fn start_mssql_container() -> Option<(ContainerAsync<GenericImage>, u16)> {
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
            return None;
        }
    };
    let port = match container.get_host_port_ipv4(1433.tcp()).await {
        Ok(port) => port,
        Err(error) => {
            skip_or_fail_on_ci(format!(
                "SQL Server container port mapping failed ({error})"
            ));
            return None;
        }
    };

    Some((container, port))
}

#[tokio::test]
async fn test_connection_rejects_mssql_declared_only_before_adapter_dispatch() {
    let port = unused_tcp_port().await;

    let result = test_connection(TestConnectionRequest {
        config: mssql_public(port, Some(1), Some(false)),
        password: Some("pw".into()),
        existing_id: None,
    })
    .await;

    match result {
        Err(AppError::Unsupported(msg)) => {
            assert!(msg.contains("SQL Server is declared-only"));
            assert!(msg.contains("source-specific connection.test"));
        }
        other => panic!("Expected SQL Server declared-only rejection, got: {other:?}"),
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
async fn mssql_adapter_inventory_probe_succeeds_against_live_mssql_serverproperty_probe() {
    let Some((_container, port)) = start_mssql_container().await else {
        return;
    };

    MssqlAdapter::test(&mssql_config(port, MSSQL_PASSWORD, Some(15)))
        .await
        .expect("live SQL Server adapter inventory probe should succeed");
}

#[tokio::test]
async fn mssql_runtime_executes_select_dml_error_and_cancel_paths() {
    let Some((_container, port)) = start_mssql_container().await else {
        return;
    };

    let adapter = Arc::new(MssqlAdapter::new());
    adapter
        .connect(&mssql_config(port, MSSQL_PASSWORD, Some(15)))
        .await
        .expect("live SQL Server connection should succeed");

    let selected = adapter
        .execute_sql(
            "SELECT CAST(42 AS INT) AS id, CAST(N'Ada' AS NVARCHAR(50)) AS name, CAST(1 AS BIT) AS active",
            None,
        )
        .await
        .expect("SELECT should return a tabular envelope");
    assert_eq!(selected.total_count, 1);
    assert_eq!(selected.columns.len(), 3);
    assert_eq!(selected.columns[0].name, "id");
    assert_eq!(selected.columns[0].data_type, "int");
    assert_eq!(selected.columns[0].category, ColumnCategory::Int);
    assert_eq!(selected.columns[1].name, "name");
    assert_eq!(selected.columns[1].category, ColumnCategory::Text);
    assert_eq!(selected.columns[2].name, "active");
    assert_eq!(selected.columns[2].category, ColumnCategory::Bool);
    assert_eq!(selected.rows[0][0], serde_json::json!(42));
    assert_eq!(selected.rows[0][1], serde_json::json!("Ada"));
    assert_eq!(selected.rows[0][2], serde_json::json!(true));

    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let table_name = format!("tv_mssql_runtime_{}_{}", std::process::id(), suffix);
    let table = format!("dbo.{table_name}");
    adapter
        .execute_sql(
            &format!(
                "CREATE TABLE {table} (id INT NOT NULL PRIMARY KEY, name NVARCHAR(50) NOT NULL)"
            ),
            None,
        )
        .await
        .expect("DDL should execute through the runtime path");

    let batch = vec![
        format!("INSERT INTO {table} (id, name) VALUES (1, N'Ada')"),
        format!("UPDATE {table} SET name = N'Grace' WHERE id = 1"),
    ];
    let batch_results = adapter
        .execute_sql_batch(&batch, None)
        .await
        .expect("DML batch should commit");
    assert_eq!(batch_results.len(), 2);
    assert_eq!(batch_results[0].total_count, 1);
    assert_eq!(batch_results[1].total_count, 1);

    let dry_run = vec![format!(
        "INSERT INTO {table} (id, name) VALUES (2, N'DryRun')"
    )];
    let dry_run_results = adapter
        .dry_run_sql_batch(&dry_run, None)
        .await
        .expect("DML dry-run batch should roll back");
    assert_eq!(dry_run_results.len(), 1);
    assert_eq!(dry_run_results[0].total_count, 1);

    let verified = adapter
        .execute_sql(&format!("SELECT id, name FROM {table} WHERE id = 1"), None)
        .await
        .expect("DML batch should be visible after commit");
    assert_eq!(
        verified.rows,
        vec![vec![serde_json::json!(1), serde_json::json!("Grace")]]
    );
    let dry_run_check = adapter
        .execute_sql(&format!("SELECT id FROM {table} WHERE id = 2"), None)
        .await
        .expect("dry-run verification query should succeed");
    assert_eq!(dry_run_check.total_count, 0);

    let table_data = <MssqlAdapter as RdbAdapter>::query_table_data(
        adapter.as_ref(),
        "dbo",
        &table_name,
        1,
        25,
        Some("id DESC"),
        None,
        None,
        None,
    )
    .await
    .expect("table data should load through the MSSQL adapter");
    assert_eq!(table_data.total_count, 1);
    assert_eq!(table_data.columns.len(), 2);
    assert_eq!(table_data.columns[0].name, "id");
    assert!(table_data.columns[0].is_primary_key);
    assert_eq!(
        table_data.rows,
        vec![vec![serde_json::json!(1), serde_json::json!("Grace")]]
    );
    assert!(table_data
        .executed_query
        .contains(&format!("FROM [dbo].[{table_name}]")));

    let failing_batch = vec![
        format!("INSERT INTO {table} (id, name) VALUES (3, N'RolledBack')"),
        format!("INSERT INTO {table} (id, name) VALUES (1, N'Duplicate')"),
    ];
    let rollback_error = adapter
        .execute_sql_batch(&failing_batch, None)
        .await
        .expect_err("failed DML batch should roll back");
    assert!(
        matches!(rollback_error, AppError::Database(ref message) if message.contains("statement 2 of 2 failed")),
        "unexpected rollback error: {rollback_error:?}"
    );
    let rollback_check = adapter
        .execute_sql(&format!("SELECT id FROM {table} WHERE id = 3"), None)
        .await
        .expect("rollback verification query should succeed");
    assert_eq!(rollback_check.total_count, 0);

    let error = adapter
        .execute_sql("SELECT * FROM dbo.tv_mssql_runtime_missing_table", None)
        .await
        .expect_err("server errors should surface as AppError");
    assert!(
        matches!(error, AppError::Database(ref message) if message.contains("SQL Server SELECT failed")),
        "unexpected server error: {error:?}"
    );

    let cancel = CancellationToken::new();
    let child = cancel.clone();
    let query_adapter = adapter.clone();
    let handle = tokio::spawn(async move {
        query_adapter
            .execute_sql("WAITFOR DELAY '00:00:10'; SELECT 1 AS done", Some(&child))
            .await
    });
    tokio::time::sleep(Duration::from_millis(500)).await;
    cancel.cancel();
    let cancelled = tokio::time::timeout(Duration::from_secs(4), handle)
        .await
        .expect("cancelled query should return promptly")
        .expect("query task should not panic")
        .expect_err("query should return a cancellation error");
    assert!(
        matches!(cancelled, AppError::Database(ref message) if message == "Query cancelled"),
        "unexpected cancellation error: {cancelled:?}"
    );

    let _ = adapter
        .execute_sql(&format!("DROP TABLE {table}"), None)
        .await;
    adapter.disconnect().await.unwrap();
}

#[tokio::test]
async fn mssql_catalog_surfaces_workbench_metadata() {
    let Some((_container, port)) = start_mssql_container().await else {
        return;
    };

    let adapter = MssqlAdapter::new();
    adapter
        .connect(&mssql_config(port, MSSQL_PASSWORD, Some(15)))
        .await
        .expect("live SQL Server connection should succeed");

    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let schema = format!(
        "tv_mssql_catalog_{}_{}",
        std::process::id(),
        suffix % 1_000_000
    );
    let pk_users = format!("pk_users_{}", suffix % 1_000_000);
    let pk_orders = format!("pk_orders_{}", suffix % 1_000_000);
    let fk_orders_users = format!("fk_orders_users_{}", suffix % 1_000_000);
    let uq_users_email = format!("uq_users_email_{}", suffix % 1_000_000);
    let ck_users_age = format!("ck_users_age_{}", suffix % 1_000_000);
    let ix_orders_user_id = format!("ix_orders_user_id_{}", suffix % 1_000_000);

    let create_statements = [
        format!("CREATE SCHEMA [{schema}]"),
        format!(
            "CREATE TABLE [{schema}].[users] (
                id INT NOT NULL CONSTRAINT [{pk_users}] PRIMARY KEY,
                email NVARCHAR(100) NOT NULL CONSTRAINT [{uq_users_email}] UNIQUE,
                active BIT NOT NULL DEFAULT 1,
                age INT NULL CONSTRAINT [{ck_users_age}] CHECK (age >= 0)
            )"
        ),
        format!(
            "CREATE TABLE [{schema}].[orders] (
                id INT NOT NULL CONSTRAINT [{pk_orders}] PRIMARY KEY,
                user_id INT NOT NULL,
                CONSTRAINT [{fk_orders_users}] FOREIGN KEY (user_id) REFERENCES [{schema}].[users](id)
            )"
        ),
        format!("CREATE INDEX [{ix_orders_user_id}] ON [{schema}].[orders](user_id)"),
        format!(
            "CREATE VIEW [{schema}].[active_users] AS SELECT id, email FROM [{schema}].[users] WHERE active = 1"
        ),
        format!(
            "CREATE PROCEDURE [{schema}].[catalog_ping] @input_id INT AS SELECT @input_id AS echoed_id"
        ),
        format!(
            "CREATE FUNCTION [{schema}].[tax_rate] (@price DECIMAL(10,2)) RETURNS DECIMAL(10,2) AS BEGIN RETURN @price * 0.10 END"
        ),
    ];
    for statement in create_statements {
        adapter
            .execute_sql(&statement, None)
            .await
            .expect("catalog fixture DDL should execute");
    }

    let databases = adapter
        .list_databases()
        .await
        .expect("database catalog should load");
    assert!(databases.iter().any(|db| db.name == "master"));
    assert_eq!(
        adapter
            .current_database_name()
            .await
            .expect("current database should load")
            .as_deref(),
        Some("master")
    );

    let namespaces = <MssqlAdapter as RdbAdapter>::list_namespaces(&adapter)
        .await
        .expect("schema tree namespace catalog should load");
    assert!(namespaces.iter().any(|namespace| namespace.name == schema));

    let tables = <MssqlAdapter as RdbAdapter>::list_tables(&adapter, &schema)
        .await
        .expect("schema tables should load");
    assert!(tables
        .iter()
        .any(|table| table.schema == schema && table.name == "users"));
    assert!(tables
        .iter()
        .any(|table| table.schema == schema && table.name == "orders"));

    let order_columns =
        <MssqlAdapter as RdbAdapter>::get_columns(&adapter, &schema, "orders", None)
            .await
            .expect("table columns should load");
    let order_id = column_named(&order_columns, "id");
    assert!(order_id.is_primary_key);
    assert_eq!(order_id.category, ColumnCategory::Int);
    let order_user_id = column_named(&order_columns, "user_id");
    assert!(order_user_id.is_foreign_key);
    assert_eq!(
        order_user_id.fk_reference.as_deref(),
        Some(format!("{schema}.users(id)").as_str())
    );

    let schema_columns = adapter
        .list_schema_columns(&schema)
        .await
        .expect("schema column cache should load");
    let cached_user_id = column_named(
        schema_columns
            .get("orders")
            .expect("orders should be present in schema cache"),
        "user_id",
    );
    assert_eq!(
        cached_user_id.fk_reference.as_deref(),
        Some(format!("{schema}.users(id)").as_str())
    );

    let indexes =
        <MssqlAdapter as RdbAdapter>::get_table_indexes(&adapter, &schema, "orders", None)
            .await
            .expect("table indexes should load");
    assert!(indexes.iter().any(|index| index.name == ix_orders_user_id
        && index.columns == vec!["user_id".to_string()]
        && !index.is_primary));
    assert!(indexes
        .iter()
        .any(|index| index.is_primary && index.columns == vec!["id".to_string()]));

    let order_constraints =
        <MssqlAdapter as RdbAdapter>::get_table_constraints(&adapter, &schema, "orders", None)
            .await
            .expect("table constraints should load");
    let fk = constraint_named(&order_constraints, &fk_orders_users);
    assert_eq!(fk.constraint_type, "FOREIGN KEY");
    assert_eq!(fk.columns, vec!["user_id".to_string()]);
    assert_eq!(fk.reference_table.as_deref(), Some("users"));
    assert_eq!(fk.reference_columns, Some(vec!["id".to_string()]));

    let user_constraints =
        <MssqlAdapter as RdbAdapter>::get_table_constraints(&adapter, &schema, "users", None)
            .await
            .expect("user constraints should load");
    assert_eq!(
        constraint_named(&user_constraints, &uq_users_email).constraint_type,
        "UNIQUE"
    );
    assert_eq!(
        constraint_named(&user_constraints, &ck_users_age).constraint_type,
        "CHECK"
    );

    let views = <MssqlAdapter as RdbAdapter>::list_views(&adapter, &schema)
        .await
        .expect("views should load");
    assert!(views
        .iter()
        .any(|view| view.schema == schema && view.name == "active_users"));
    let view_columns =
        <MssqlAdapter as RdbAdapter>::get_view_columns(&adapter, &schema, "active_users")
            .await
            .expect("view columns should load");
    assert_eq!(
        column_named(&view_columns, "email").category,
        ColumnCategory::Text
    );
    let view_definition =
        <MssqlAdapter as RdbAdapter>::get_view_definition(&adapter, &schema, "active_users")
            .await
            .expect("view definition should load");
    assert!(view_definition.to_ascii_uppercase().contains("SELECT"));

    let routines = <MssqlAdapter as RdbAdapter>::list_functions(&adapter, &schema)
        .await
        .expect("procedures and functions should load");
    let procedure = routine_named(&routines, "catalog_ping");
    assert_eq!(procedure.kind, "procedure");
    assert!(procedure
        .arguments
        .as_deref()
        .is_some_and(|args| args.contains("@input_id int")));
    let function = routine_named(&routines, "tax_rate");
    assert_eq!(function.kind, "function");
    assert_eq!(function.return_type.as_deref(), Some("decimal"));
    let procedure_source =
        <MssqlAdapter as RdbAdapter>::get_function_source(&adapter, &schema, "catalog_ping")
            .await
            .expect("procedure source should load");
    assert!(procedure_source
        .to_ascii_uppercase()
        .contains("CREATE PROCEDURE"));

    let drop_statements = [
        format!("DROP FUNCTION [{schema}].[tax_rate]"),
        format!("DROP PROCEDURE [{schema}].[catalog_ping]"),
        format!("DROP VIEW [{schema}].[active_users]"),
        format!("DROP TABLE [{schema}].[orders]"),
        format!("DROP TABLE [{schema}].[users]"),
        format!("DROP SCHEMA [{schema}]"),
    ];
    for statement in drop_statements {
        let _ = adapter.execute_sql(&statement, None).await;
    }
    adapter.disconnect().await.unwrap();
}

fn column_named<'a>(columns: &'a [ColumnInfo], name: &str) -> &'a ColumnInfo {
    columns
        .iter()
        .find(|column| column.name == name)
        .unwrap_or_else(|| panic!("missing column {name}; got {columns:?}"))
}

fn constraint_named<'a>(constraints: &'a [ConstraintInfo], name: &str) -> &'a ConstraintInfo {
    constraints
        .iter()
        .find(|constraint| constraint.name == name)
        .unwrap_or_else(|| panic!("missing constraint {name}; got {constraints:?}"))
}

fn routine_named<'a>(routines: &'a [FunctionInfo], name: &str) -> &'a FunctionInfo {
    routines
        .iter()
        .find(|routine| routine.name == name)
        .unwrap_or_else(|| panic!("missing routine {name}; got {routines:?}"))
}

fn skip_or_fail_on_ci(reason: String) {
    if std::env::var_os("CI").is_some() || std::env::var_os("GITHUB_ACTIONS").is_some() {
        panic!("{reason}");
    }
    println!("SKIP: {reason}");
}
