use oracle_rs::{Config as OracleDriverConfig, Value};
use serial_test::serial;
use table_view_lib::{
    db::{DbAdapter, OracleAdapter, RdbAdapter},
    models::{ConnectionConfig, DatabaseType, QueryType},
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
