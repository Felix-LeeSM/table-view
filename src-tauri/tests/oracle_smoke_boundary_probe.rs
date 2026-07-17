use oracle_rs::{Config as OracleDriverConfig, Value};
use serial_test::serial;
use table_view_lib::{
    db::{DbAdapter, OracleAdapter, RdbAdapter},
    error::AppError,
    models::{
        ColumnDefinition, ConnectionConfig, CreateTableRequest, DatabaseType, DropTableRequest,
        QueryType,
    },
};

fn oracle_env(name: &str, fallback: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| fallback.to_string())
}

fn oracle_config() -> ConnectionConfig {
    ConnectionConfig {
        id: "oracle-boundary-probe".into(),
        name: "Oracle boundary probe".into(),
        db_type: DatabaseType::Oracle,
        host: oracle_env("E2E_ORACLE_HOST", &oracle_env("ORACLE_HOST", "localhost")),
        port: oracle_env("E2E_ORACLE_PORT", &oracle_env("ORACLE_PORT", "1521"))
            .parse()
            .expect("Oracle port must be numeric"),
        user: oracle_env("ORACLE_USER", "testuser"),
        password: oracle_env("ORACLE_PASSWORD", "testpass"),
        database: oracle_env(
            "E2E_ORACLE_SERVICE",
            &oracle_env("ORACLE_SERVICE", "XEPDB1"),
        ),
        read_only: false,
        group_id: None,
        color: None,
        connection_timeout: Some(30),
        keep_alive_interval: None,
        environment: None,
        auth_source: None,
        replica_set: None,
        tls_enabled: None,
        trust_server_certificate: None,
    }
}

fn schema_name(config: &ConnectionConfig) -> String {
    config.user.trim().to_ascii_uppercase()
}

fn number_cell_as_i64(value: &serde_json::Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_str().and_then(|s| s.parse::<i64>().ok()))
}

async fn scalar_count(adapter: &OracleAdapter, sql: &str) -> i64 {
    let result = RdbAdapter::execute_sql(adapter, sql, None)
        .await
        .unwrap_or_else(|err| panic!("{sql} failed: {err}"));
    number_cell_as_i64(&result.rows[0][0]).unwrap_or_else(|| {
        panic!(
            "{sql} returned non-numeric first cell: {:?}",
            result.rows.first()
        )
    })
}

async fn connected_adapter() -> (ConnectionConfig, String, OracleAdapter) {
    let config = oracle_config();
    let schema = schema_name(&config);
    let adapter = OracleAdapter::new();
    DbAdapter::connect(&adapter, &config)
        .await
        .expect("Oracle probe connection should open");
    (config, schema, adapter)
}

async fn disconnect_adapter(adapter: &OracleAdapter) {
    DbAdapter::disconnect(adapter)
        .await
        .expect("Oracle probe connection should close");
}

#[tokio::test]
#[serial]
#[ignore = "requires local Oracle container plus e2e/fixtures/seed.oracle.sql"]
async fn oracle_seed_data_exists() {
    let (_config, _schema, adapter) = connected_adapter().await;
    let user_count = scalar_count(&adapter, "SELECT COUNT(*) AS user_count FROM users").await;
    let active_user_count = scalar_count(
        &adapter,
        "SELECT COUNT(*) AS active_user_count FROM active_oracle_users",
    )
    .await;
    let ping = scalar_count(
        &adapter,
        "SELECT oracle_catalog_ping() AS catalog_ping FROM dual",
    )
    .await;
    println!(
        "ORACLE_PROBE A seed users={user_count} active_oracle_users={active_user_count} oracle_catalog_ping={ping}"
    );
    assert!(user_count >= 2, "seeded users should include Alice and Bob");
    assert!(
        active_user_count >= 2,
        "active_oracle_users view should resolve"
    );
    assert_eq!(ping, 1, "oracle_catalog_ping function should return 1");
    disconnect_adapter(&adapter).await;
}

#[tokio::test]
#[serial]
#[ignore = "requires local Oracle container plus e2e/fixtures/seed.oracle.sql"]
async fn oracle_catalog_lists_names_without_long_view_text() {
    let (_config, schema, adapter) = connected_adapter().await;
    let tables = RdbAdapter::list_tables(&adapter, &schema)
        .await
        .expect("Oracle table list should succeed");
    let table_names = tables.iter().map(|t| t.name.as_str()).collect::<Vec<_>>();
    let views = RdbAdapter::list_views(&adapter, &schema)
        .await
        .expect("Oracle view list should succeed");
    let view_names = views.iter().map(|v| v.name.as_str()).collect::<Vec<_>>();
    let routines = RdbAdapter::list_functions(&adapter, &schema)
        .await
        .expect("Oracle function/sequence/synonym list should succeed");
    let routine_names = routines
        .iter()
        .map(|f| format!("{}:{}", f.kind, f.name))
        .collect::<Vec<_>>();
    println!(
        "ORACLE_PROBE B catalog tables={table_names:?} views={view_names:?} routines={routine_names:?}"
    );
    assert!(table_names.contains(&"USERS"));
    assert!(view_names.contains(&"ACTIVE_ORACLE_USERS"));
    assert!(routine_names
        .iter()
        .any(|name| name == "function:ORACLE_CATALOG_PING"));
    assert!(
        !views.iter().any(|view| view.definition.is_some()),
        "browse path should not read ALL_VIEWS.TEXT LONG definitions"
    );
    disconnect_adapter(&adapter).await;
}

#[tokio::test]
#[serial]
#[ignore = "requires local Oracle container plus e2e/fixtures/seed.oracle.sql"]
async fn oracle_table_data_returns_rows_columns_and_pk_metadata() {
    let (_config, schema, adapter) = connected_adapter().await;
    let table_data =
        RdbAdapter::query_table_data(&adapter, &schema, "USERS", 1, 10, None, None, None, None)
            .await
            .expect("Oracle table browse should return rows and metadata");
    println!(
        "ORACLE_PROBE C table rows={} columns={:?} pk={:?}",
        table_data.rows.len(),
        table_data
            .columns
            .iter()
            .map(|c| c.name.as_str())
            .collect::<Vec<_>>(),
        table_data
            .columns
            .iter()
            .filter(|c| c.is_primary_key)
            .map(|c| c.name.as_str())
            .collect::<Vec<_>>()
    );
    assert!(table_data.rows.len() >= 2);
    assert!(table_data
        .columns
        .iter()
        .any(|c| c.name == "ID" && c.is_primary_key));
    assert!(table_data.columns.iter().any(|c| c.name == "EMAIL"));
    disconnect_adapter(&adapter).await;
}

#[tokio::test]
#[serial]
#[ignore = "requires local Oracle container plus e2e/fixtures/seed.oracle.sql"]
async fn oracle_commit_batch_rolls_back_zero_row_update_1432() {
    // Issue #1432 — Oracle's commit batch must enforce the same single-row guard
    // as PG/MySQL/SQLite: a statement matching zero rows (the target row was
    // changed/removed since load, or a PK-less all-column WHERE matched nothing)
    // rolls the whole transaction back with the shared `statement K of N failed`
    // error instead of silently committing a phantom success. Oracle's
    // SQL%ROWCOUNT reports matched rows, so a 0 is a genuine no-match, not a
    // MySQL-style unchanged-value read.
    let (_config, _schema, adapter) = connected_adapter().await;
    let before = scalar_count(
        &adapter,
        "SELECT COUNT(*) FROM users WHERE name = 'Phantom1432'",
    )
    .await;
    assert_eq!(
        before, 0,
        "precondition: no Phantom1432 row before the batch"
    );

    let zero_row_batch = vec!["UPDATE users SET name = 'Phantom1432' WHERE id = 9999".to_string()];
    let guard_err = RdbAdapter::execute_sql_batch(&adapter, &zero_row_batch, None)
        .await
        .expect_err("zero-row Oracle commit must roll back, not silently succeed");
    assert!(
        matches!(&guard_err, AppError::Database(message)
            if message.contains("statement 1 of 1 failed")
                && message.contains("affected 0")
                && !message.contains("add a primary key")),
        "expected single-row guard rollback, got {guard_err:?}"
    );

    let after = scalar_count(
        &adapter,
        "SELECT COUNT(*) FROM users WHERE name = 'Phantom1432'",
    )
    .await;
    assert_eq!(after, 0, "zero-row guard must not persist a phantom write");
    disconnect_adapter(&adapter).await;
}

#[tokio::test]
#[serial]
#[ignore = "requires local Oracle container plus e2e/fixtures/seed.oracle.sql"]
async fn oracle_free_form_select_returns_rows_columns_and_allows_complete_cursor_id() {
    let (config, _schema, adapter) = connected_adapter().await;
    let select = RdbAdapter::execute_sql(
        &adapter,
        "SELECT name AS oracle_name FROM users FETCH FIRST 1 ROWS ONLY",
        None,
    )
    .await
    .expect("Oracle free-form SELECT should return a tabular envelope");
    println!(
        "ORACLE_PROBE D envelope rows={} columns={:?} query_type={:?}",
        select.rows.len(),
        select
            .columns
            .iter()
            .map(|c| c.name.as_str())
            .collect::<Vec<_>>(),
        select.query_type
    );
    assert_eq!(select.rows.len(), 1);
    assert_eq!(select.columns[0].name, "ORACLE_NAME");
    assert!(matches!(select.query_type, QueryType::Select));

    let driver_config = OracleDriverConfig::new(
        config.host.as_str(),
        config.port,
        config.database.as_str(),
        config.user.as_str(),
        config.password.as_str(),
    );
    let driver = oracle_rs::Connection::connect_with_config(driver_config)
        .await
        .expect("Oracle direct cursor probe connection should open");
    let cursor_result = driver
        .query(
            "SELECT name AS oracle_name FROM users FETCH FIRST 1 ROWS ONLY",
            &[] as &[Value],
        )
        .await
        .expect("Oracle direct cursor probe SELECT should run");
    println!(
        "ORACLE_PROBE D_CURSOR rows={} columns={:?} cursor_id={} has_more_rows={}",
        cursor_result.rows.len(),
        cursor_result
            .columns
            .iter()
            .map(|c| c.name.as_str())
            .collect::<Vec<_>>(),
        cursor_result.cursor_id,
        cursor_result.has_more_rows
    );
    assert_eq!(cursor_result.rows.len(), 1);
    assert_eq!(cursor_result.columns[0].name, "ORACLE_NAME");
    assert!(
        !cursor_result.has_more_rows,
        "FETCH FIRST 1 ROWS ONLY should not leave a pending cursor"
    );
    driver
        .close()
        .await
        .expect("Oracle direct cursor probe should close");
    disconnect_adapter(&adapter).await;
}

#[tokio::test]
#[serial]
#[ignore = "requires local Oracle container plus e2e/fixtures/seed.oracle.sql"]
async fn oracle_structured_ddl_creates_and_drops_a_probe_table_after_1072() {
    // Issue #1072 — dissolving the runtime slice wires the full OracleAdapter, so
    // structured table/index/constraint DDL now executes against the live
    // container (previously the #905 slice returned Unsupported). This probe
    // proves the promoted posture end to end: the preview path builds the SQL,
    // the execute path runs CREATE then DROP, and a follow-up SELECT surfaces an
    // ORA-00942 invalid-object database error proving the table is gone. Raw DDL
    // through execute_sql stays blocked by `runtime.rs` (asserted in the lib
    // unit tests), so ad-hoc DDL typed into the query editor is still rejected.
    let (_config, schema, adapter) = connected_adapter().await;
    let probe_table = "VT1072_DDL_PROBE";

    let create = CreateTableRequest {
        connection_id: "oracle-boundary-probe".into(),
        schema: schema.clone(),
        name: probe_table.into(),
        columns: vec![ColumnDefinition {
            name: "ID".into(),
            data_type: "NUMBER".into(),
            nullable: false,
            default_value: None,
            comment: None,
            is_identity: false,
        }],
        primary_key: Some(vec!["ID".into()]),
        preview_only: true,
        table_comment: None,
        expected_database: None,
    };
    let created_preview = adapter
        .create_table(&create)
        .await
        .expect("structured CREATE TABLE preview must build the SQL after #1072");
    println!("ORACLE_PROBE E create_preview sql={}", created_preview.sql);
    assert!(created_preview
        .sql
        .contains(&format!("CREATE TABLE \"{schema}\".\"{probe_table}\"")));

    adapter
        .create_table(&CreateTableRequest {
            preview_only: false,
            ..create
        })
        .await
        .expect("structured CREATE TABLE must execute after #1072");
    let present = scalar_count(
        &adapter,
        &format!("SELECT COUNT(*) FROM \"{schema}\".\"{probe_table}\""),
    )
    .await;
    assert_eq!(present, 0, "freshly created probe table should be empty");

    let drop = DropTableRequest {
        connection_id: "oracle-boundary-probe".into(),
        schema: schema.clone(),
        table: probe_table.into(),
        cascade: false,
        preview_only: true,
        expected_database: None,
    };
    let dropped_preview = adapter
        .drop_table(&drop)
        .await
        .expect("structured DROP TABLE preview must build the SQL after #1072");
    assert_eq!(
        dropped_preview.sql,
        format!("DROP TABLE \"{schema}\".\"{probe_table}\"")
    );

    adapter
        .drop_table(&DropTableRequest {
            preview_only: false,
            ..drop
        })
        .await
        .expect("structured DROP TABLE must execute after #1072");
    let missing = RdbAdapter::execute_sql(
        &adapter,
        &format!("SELECT COUNT(*) FROM \"{schema}\".\"{probe_table}\""),
        None,
    )
    .await
    .expect_err("probe table must be gone after the structured drop executes");
    println!("ORACLE_PROBE E drop_verify err={missing:?}");
    assert!(
        matches!(missing, AppError::Database(ref message) if message.contains("ORA-00942")),
        "expected an ORA-00942 invalid-object database error, got {missing:?}"
    );
    disconnect_adapter(&adapter).await;
}
