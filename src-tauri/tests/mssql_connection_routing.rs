use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use table_view_lib::commands::connection::{test_connection, TestConnectionRequest};
use table_view_lib::db::{DbAdapter, MssqlAdapter, RdbAdapter};
use table_view_lib::error::AppError;
use table_view_lib::models::{
    ConnectionConfig, ConnectionConfigPublic, DatabaseType, DropTableRequest, QueryType,
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
    host: &str,
    port: u16,
    timeout: Option<u32>,
    tls_enabled: Option<bool>,
    trust_server_certificate: Option<bool>,
) -> ConnectionConfigPublic {
    ConnectionConfigPublic {
        id: "mssql-c1".into(),
        name: "SQL Server fixture".into(),
        db_type: DatabaseType::Mssql,
        host: host.into(),
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
        trust_server_certificate,
    }
}

fn mssql_config(
    port: u16,
    password: &str,
    timeout: Option<u32>,
    tls_enabled: Option<bool>,
    trust_server_certificate: Option<bool>,
) -> ConnectionConfig {
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
        tls_enabled,
        trust_server_certificate,
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
async fn test_connection_dispatches_mssql_validation_instead_of_declared_only_rejection() {
    let port = unused_tcp_port().await;

    let result = test_connection(TestConnectionRequest {
        config: mssql_public("localhost\\SQLEXPRESS", port, Some(1), Some(false), None),
        password: Some("pw".into()),
        existing_id: None,
    })
    .await;

    match result {
        Err(AppError::Validation(msg)) => {
            assert!(msg.contains("named instances"));
        }
        other => panic!("Expected SQL Server validation rejection, got: {other:?}"),
    }
}

#[tokio::test]
async fn test_connection_requires_tls_trust_decision_before_network() {
    let port = unused_tcp_port().await;

    let result = test_connection(TestConnectionRequest {
        config: mssql_public("127.0.0.1", port, Some(1), Some(true), None),
        password: Some("pw".into()),
        existing_id: None,
    })
    .await;

    match result {
        Err(AppError::Validation(msg)) => {
            assert!(msg.contains("trustServerCertificate"));
        }
        other => panic!("Expected SQL Server TLS validation rejection, got: {other:?}"),
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
    let result = MssqlAdapter::test(&mssql_config(port, "pw", Some(1), Some(false), None)).await;
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

    MssqlAdapter::test(&mssql_config(
        port,
        MSSQL_PASSWORD,
        Some(15),
        Some(false),
        None,
    ))
    .await
    .expect("live SQL Server connection test probe should succeed");
}

#[tokio::test]
async fn mssql_runtime_slice_covers_catalog_query_batch_and_cancel() {
    let Some((_container, port)) = start_mssql_container().await else {
        return;
    };

    let database = unique_database_name();
    let adapter = MssqlAdapter::new();
    adapter
        .connect(&mssql_config(
            port,
            MSSQL_PASSWORD,
            Some(20),
            Some(false),
            None,
        ))
        .await
        .expect("connect MSSQL runtime adapter");

    RdbAdapter::execute_sql(&adapter, &format!("CREATE DATABASE [{database}]"), None)
        .await
        .expect("create isolated test database");
    RdbAdapter::switch_database(&adapter, &database)
        .await
        .expect("switch to isolated test database");

    let result = run_mssql_runtime_assertions(&adapter, &database).await;
    let _ = adapter.disconnect().await;
    let cleanup = MssqlAdapter::new();
    if cleanup
        .connect(&mssql_config(
            port,
            MSSQL_PASSWORD,
            Some(20),
            Some(false),
            None,
        ))
        .await
        .is_ok()
    {
        let _ = RdbAdapter::execute_sql(
            &cleanup,
            &format!(
                "ALTER DATABASE [{database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{database}]"
            ),
            None,
        )
        .await;
    }

    result.expect("MSSQL runtime slice should pass");
}

async fn run_mssql_runtime_assertions(
    adapter: &MssqlAdapter,
    database: &str,
) -> Result<(), AppError> {
    for sql in [
        "CREATE SCHEMA vt902",
        "CREATE TABLE vt902.authors (id INT NOT NULL PRIMARY KEY, name NVARCHAR(80) NOT NULL)",
        "CREATE TABLE vt902.books (id INT NOT NULL PRIMARY KEY, author_id INT NOT NULL, title NVARCHAR(120) NOT NULL, CONSTRAINT fk_books_authors FOREIGN KEY (author_id) REFERENCES vt902.authors(id))",
        "CREATE INDEX ix_books_title ON vt902.books(title)",
        "INSERT INTO vt902.authors (id, name) VALUES (1, N'Ada'), (2, N'Grace')",
        "INSERT INTO vt902.books (id, author_id, title) VALUES (10, 1, N'Analytical Engines'), (11, 2, N'Compilers')",
        "CREATE VIEW vt902.book_titles AS SELECT b.id, b.title, a.name AS author_name FROM vt902.books AS b JOIN vt902.authors AS a ON a.id = b.author_id",
        "CREATE PROCEDURE vt902.list_books AS SELECT id, title FROM vt902.books ORDER BY id",
    ] {
        RdbAdapter::execute_sql(adapter, sql, None).await?;
    }

    let databases = RdbAdapter::list_databases(adapter).await?;
    assert!(databases.iter().any(|db| db.name == database));

    let current = RdbAdapter::current_database(adapter).await?;
    assert_eq!(current.as_deref(), Some(database));

    let schemas = RdbAdapter::list_namespaces(adapter).await?;
    assert!(schemas.iter().any(|schema| schema.name == "vt902"));

    let tables = RdbAdapter::list_tables(adapter, "vt902").await?;
    assert!(tables.iter().any(|table| table.name == "authors"));
    assert!(tables.iter().any(|table| table.name == "books"));

    let views = RdbAdapter::list_views(adapter, "vt902").await?;
    assert!(views.iter().any(|view| view.name == "book_titles"));
    let view_columns = RdbAdapter::get_view_columns(adapter, "vt902", "book_titles").await?;
    assert!(view_columns
        .iter()
        .any(|column| column.name == "author_name"));

    let routines = RdbAdapter::list_functions(adapter, "vt902").await?;
    assert!(routines
        .iter()
        .any(|routine| routine.name == "list_books" && routine.kind == "procedure"));
    let routine_source = RdbAdapter::get_function_source(adapter, "vt902", "list_books").await?;
    assert!(routine_source.contains("SELECT id, title"));

    let author_columns = RdbAdapter::get_columns(adapter, "vt902", "authors", None).await?;
    assert!(author_columns
        .iter()
        .any(|column| column.name == "id" && column.is_primary_key));

    let book_columns = RdbAdapter::get_columns(adapter, "vt902", "books", None).await?;
    assert!(book_columns.iter().any(|column| {
        column.name == "author_id"
            && column.is_foreign_key
            && column.fk_reference.as_deref() == Some("vt902.authors(id)")
    }));

    let indexes = RdbAdapter::get_table_indexes(adapter, "vt902", "books", None).await?;
    assert!(indexes.iter().any(|index| {
        index.name == "ix_books_title" && index.columns == vec!["title".to_string()]
    }));

    let constraints = RdbAdapter::get_table_constraints(adapter, "vt902", "books", None).await?;
    assert!(constraints.iter().any(|constraint| {
        constraint.constraint_type == "PRIMARY KEY" && constraint.columns == vec!["id".to_string()]
    }));
    assert!(constraints.iter().any(|constraint| {
        constraint.name == "fk_books_authors"
            && constraint.constraint_type == "FOREIGN KEY"
            && constraint.reference_table.as_deref() == Some("authors")
            && constraint
                .reference_columns
                .as_deref()
                .is_some_and(|columns| columns == ["id"])
    }));

    let select = RdbAdapter::execute_sql(
        adapter,
        "SELECT id, title FROM vt902.books WHERE author_id = 1 ORDER BY id",
        None,
    )
    .await?;
    assert!(matches!(select.query_type, QueryType::Select));
    assert_eq!(select.columns.len(), 2);
    assert_eq!(select.rows.len(), 1);
    assert_eq!(select.rows[0][1], serde_json::json!("Analytical Engines"));

    let table_data = RdbAdapter::query_table_data(
        adapter,
        "vt902",
        "books",
        1,
        10,
        Some("id ASC"),
        None,
        None,
        None,
    )
    .await?;
    assert_eq!(table_data.total_count, 2);
    assert_eq!(table_data.rows.len(), 2);

    let batch = vec![
        "INSERT INTO vt902.books (id, author_id, title) VALUES (12, 1, N'Runtime Slice')"
            .to_string(),
        "UPDATE vt902.books SET title = N'Runtime Slice Verified' WHERE id = 12".to_string(),
    ];
    let batch_result = RdbAdapter::execute_sql_batch(adapter, &batch, None).await?;
    assert_eq!(batch_result.len(), 2);
    assert!(batch_result
        .iter()
        .all(|result| matches!(result.query_type, QueryType::Dml { rows_affected: 1 })));

    let drop = DropTableRequest {
        connection_id: "mssql".into(),
        schema: "vt902".into(),
        table: "books".into(),
        cascade: false,
        preview_only: false,
        expected_database: Some(database.to_string()),
    };
    let ddl = RdbAdapter::drop_table(adapter, &drop).await;
    assert!(
        matches!(ddl, Err(AppError::Unsupported(message)) if message.contains("outside issue #902"))
    );

    let pre_cancel = CancellationToken::new();
    pre_cancel.cancel();
    let err = RdbAdapter::execute_sql(adapter, "SELECT 1", Some(&pre_cancel))
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::Database(message) if message == "Query cancelled"));

    let live_cancel = CancellationToken::new();
    let query_token = live_cancel.clone();
    let started = Instant::now();
    let query = RdbAdapter::execute_sql(
        adapter,
        "WAITFOR DELAY '00:00:05'; SELECT 1 AS slow_value",
        Some(&query_token),
    );
    tokio::pin!(query);
    tokio::time::sleep(Duration::from_millis(100)).await;
    live_cancel.cancel();
    let err = query.await.unwrap_err();
    assert!(matches!(err, AppError::Database(message) if message == "Query cancelled"));
    assert!(
        started.elapsed() < Duration::from_secs(3),
        "MSSQL cooperative cancel did not short-circuit"
    );

    Ok(())
}

fn unique_database_name() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    format!("vt902_{}_{}", std::process::id(), millis)
}

fn skip_or_fail_on_ci(reason: String) {
    if std::env::var_os("CI").is_some() || std::env::var_os("GITHUB_ACTIONS").is_some() {
        panic!("{reason}");
    }
    println!("SKIP: {reason}");
}
