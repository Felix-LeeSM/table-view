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
use tiberius::{AuthMethod, Client, Config as TdsConfig, EncryptionLevel};
use tokio::net::{TcpListener, TcpStream};
use tokio_util::compat::TokioAsyncWriteCompatExt;
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
        oracle_use_sid: None,
        wallet_path: None,
        has_wallet_password: false,
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
        oracle_use_sid: None,
        wallet_path: None,
        wallet_password: String::new(),
    }
}

async fn execute_mssql_admin_sql(port: u16, database: &str, sql: &str) -> Result<(), String> {
    let mut config = TdsConfig::new();
    config.host("127.0.0.1");
    config.port(port);
    config.database(database);
    config.authentication(AuthMethod::sql_server("sa", MSSQL_PASSWORD));
    config.encryption(EncryptionLevel::NotSupported);

    let tcp = TcpStream::connect(config.get_addr())
        .await
        .map_err(|error| format!("connect admin TDS: {error}"))?;
    tcp.set_nodelay(true)
        .map_err(|error| format!("configure admin TDS socket: {error}"))?;
    let mut client = Client::connect(config, tcp.compat_write())
        .await
        .map_err(|error| format!("login admin TDS: {error}"))?;
    client
        .simple_query(sql)
        .await
        .map_err(|error| format!("run admin SQL: {error}"))?
        .into_results()
        .await
        .map_err(|error| format!("consume admin SQL: {error}"))?;
    Ok(())
}

async fn seed_mssql_runtime_fixture(port: u16, database: &str) -> Result<(), String> {
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
        execute_mssql_admin_sql(port, database, sql).await?;
    }
    Ok(())
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
        wallet_password: None,
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
        wallet_password: None,
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
    execute_mssql_admin_sql(port, "master", &format!("CREATE DATABASE [{database}]"))
        .await
        .expect("create isolated test database");

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

    RdbAdapter::switch_database(&adapter, &database)
        .await
        .expect("switch to isolated test database");
    seed_mssql_runtime_fixture(port, &database)
        .await
        .expect("seed isolated test database");

    let result = run_mssql_runtime_assertions(&adapter, &database).await;
    let _ = adapter.disconnect().await;
    let _ = execute_mssql_admin_sql(
        port,
        "master",
        &format!(
            "ALTER DATABASE [{database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{database}]"
        ),
    )
    .await;

    result.expect("MSSQL runtime slice should pass");
}

async fn run_mssql_runtime_assertions(
    adapter: &MssqlAdapter,
    database: &str,
) -> Result<(), AppError> {
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

    // Issue #1432 — a committed batch statement that matches zero rows (the
    // target row was changed/removed since load, or a PK-less all-column WHERE
    // matched nothing) must roll the whole transaction back with the shared
    // `statement K of N failed` guard error instead of silently committing a
    // phantom success. Mirrors the SQLite/PG `matches_no_rows` regression so all
    // five adapters behave uniformly.
    let zero_row_batch =
        vec!["UPDATE vt902.books SET title = N'Phantom1432' WHERE id = 9999".to_string()];
    let guard_err = RdbAdapter::execute_sql_batch(adapter, &zero_row_batch, None)
        .await
        .expect_err("zero-row MSSQL commit must roll back, not silently succeed");
    assert!(
        matches!(&guard_err, AppError::Database(message)
            if message.contains("statement 1 of 1 failed")
                && message.contains("affected 0")
                && !message.contains("add a primary key")),
        "expected single-row guard rollback, got {guard_err:?}"
    );
    let phantom = RdbAdapter::execute_sql(
        adapter,
        "SELECT id FROM vt902.books WHERE title = N'Phantom1432'",
        None,
    )
    .await?;
    assert!(
        phantom.rows.is_empty(),
        "zero-row guard must not persist a phantom write"
    );

    // Issue #1071 — structured DDL is now wired: the drop_table trait method
    // executes a real DROP TABLE against the live container (previously the
    // #903 boundary returned Unsupported). Raw DDL through execute_sql /
    // execute_sql_batch stays blocked below, so the runtime slice still rejects
    // ad-hoc DDL typed into the query editor.
    let drop_preview = DropTableRequest {
        connection_id: "mssql".into(),
        schema: "vt902".into(),
        table: "books".into(),
        cascade: false,
        preview_only: true,
        expected_database: Some(database.to_string()),
    };
    let previewed = RdbAdapter::drop_table(adapter, &drop_preview)
        .await
        .expect("structured DROP TABLE preview must build the T-SQL after #1071");
    assert_eq!(previewed.sql, "DROP TABLE [vt902].[books]");

    let drop = DropTableRequest {
        preview_only: false,
        ..drop_preview
    };
    let dropped = RdbAdapter::drop_table(adapter, &drop)
        .await
        .expect("structured DROP TABLE must execute after #1071");
    assert_eq!(dropped.sql, "DROP TABLE [vt902].[books]");
    let missing = RdbAdapter::execute_sql(adapter, "SELECT id FROM vt902.books", None)
        .await
        .expect_err("books must be gone after the structured drop executes");
    assert!(
        matches!(missing, AppError::Database(_)),
        "expected an invalid-object database error for the dropped table, got {missing:?}"
    );

    for sql in [
        "CREATE TABLE vt902.raw_ddl_blocked (id int)",
        "EXEC vt902.list_books",
        "UPDATE vt902.books SET title = N'bad'; DROP TABLE vt902.books",
    ] {
        let err = RdbAdapter::execute_sql(adapter, sql, None)
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::Unsupported(ref message) if message.contains("outside issue #903")),
            "expected MSSQL runtime boundary for {sql}, got {err:?}"
        );
    }

    let ddl_batch = vec!["CREATE TABLE vt902.raw_batch_blocked (id int)".to_string()];
    let err = RdbAdapter::execute_sql_batch(adapter, &ddl_batch, None)
        .await
        .unwrap_err();
    assert!(
        matches!(err, AppError::Unsupported(message) if message.contains("batch supports INSERT/UPDATE/DELETE/MERGE"))
    );

    // Issue #1073 — admin ops (activity/kill/slow/info) parity. The sa login
    // has VIEW SERVER STATE, so the sys.dm_exec_* DMV bodies decode against the
    // live container (the untested IO surface); the without-connection guards
    // live in the mssql/admin.rs unit module.
    let info = RdbAdapter::server_info(adapter).await?;
    assert!(
        info.version.chars().any(|c| c.is_ascii_digit()),
        "ProductVersion must carry a numeric server version, got {:?}",
        info.version
    );
    assert!(
        info.uptime_sec.is_some_and(|u| u >= 0),
        "sqlserver_start_time must yield a non-negative uptime, got {:?}",
        info.uptime_sec
    );
    assert!(
        info.connections_active.is_some_and(|c| c >= 1),
        "must count at least our own user session, got {:?}",
        info.connections_active
    );
    assert!(
        info.extras.contains_key("edition"),
        "extras must whitelist the SERVERPROPERTY edition, got keys {:?}",
        info.extras.keys().collect::<Vec<_>>()
    );

    // A distinctive probe so dm_exec_query_stats has at least one digest entry.
    RdbAdapter::execute_sql(adapter, "SELECT 1073 AS slow_probe_1073", None).await?;
    for row in &RdbAdapter::slow_queries(adapter, 20).await? {
        assert!(
            row.total_exec_time_ms >= 0.0 && row.mean_exec_time_ms >= 0.0,
            "timer columns must be non-negative ms"
        );
    }

    for row in &RdbAdapter::list_server_activity(adapter).await? {
        assert!(row.id > 0, "session id must be a positive integer");
    }

    // Killing an id that is not an active SPID (6106) is a no-op for parity with
    // PG pg_terminate_backend, not an error.
    RdbAdapter::kill_session(adapter, 2_000_000_000)
        .await
        .expect("killing an absent SPID must be a no-op, not an error");

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
        "WITH slow(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM slow WHERE n < 100000000) SELECT MAX(n) AS slow_value FROM slow OPTION (MAXRECURSION 0)",
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
