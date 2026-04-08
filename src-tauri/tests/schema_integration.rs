use view_table_lib::db::postgres::PostgresAdapter;
use view_table_lib::models::{ConnectionConfig, DatabaseType};

fn test_config() -> ConnectionConfig {
    ConnectionConfig {
        id: "test".to_string(),
        name: "TestDB".to_string(),
        db_type: DatabaseType::Postgresql,
        host: "localhost".to_string(),
        port: 5432,
        user: "postgres".to_string(),
        password: "postgres".to_string(),
        database: "viewtable_test".to_string(),
        group_id: None,
        color: None,
        connection_timeout: None,
        keep_alive_interval: None,
    }
}

/// Helper: create a unique test table name to avoid collisions across tests.
fn unique_table_name(prefix: &str) -> String {
    format!(
        "test_{}_{}",
        prefix,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    )
}

async fn setup_adapter() -> PostgresAdapter {
    let adapter = PostgresAdapter::new();
    adapter
        .connect_pool(&test_config())
        .await
        .expect("Failed to connect to test database");
    adapter
}

#[tokio::test]
async fn test_list_schemas() {
    let adapter = setup_adapter().await;
    let schemas = adapter.list_schemas().await.expect("list_schemas failed");

    assert!(
        schemas.iter().any(|s| s.name == "public"),
        "Expected 'public' schema, got: {:?}",
        schemas
    );

    adapter.disconnect_pool().await.unwrap();
}

#[tokio::test]
async fn test_list_tables_empty() {
    let adapter = setup_adapter().await;
    let tables = adapter
        .list_tables("public")
        .await
        .expect("list_tables failed");

    // There may be tables from other tests, so we just verify non-empty names
    assert!(
        tables.iter().all(|t| !t.name.is_empty()),
        "All table names should be non-empty"
    );

    adapter.disconnect_pool().await.unwrap();
}

#[tokio::test]
async fn test_create_table_and_list() {
    let adapter = setup_adapter().await;
    let table_name = unique_table_name("users");

    // Create a test table
    adapter
        .execute(&format!(
            "CREATE TABLE \"{table_name}\" (\
             id SERIAL PRIMARY KEY, \
             name TEXT NOT NULL, \
             email TEXT)"
        ))
        .await
        .expect("Failed to create table");

    // List tables — should contain our table
    let tables = adapter
        .list_tables("public")
        .await
        .expect("list_tables failed");
    assert!(
        tables.iter().any(|t| t.name == table_name),
        "Expected table '{table_name}' in list"
    );

    // Clean up
    adapter
        .execute(&format!("DROP TABLE \"{table_name}\""))
        .await
        .expect("Failed to drop table");

    adapter.disconnect_pool().await.unwrap();
}

#[tokio::test]
async fn test_get_table_columns() {
    let adapter = setup_adapter().await;
    let table_name = unique_table_name("cols");

    // Create table with known columns
    adapter
        .execute(&format!(
            "CREATE TABLE \"{table_name}\" (\
             id SERIAL PRIMARY KEY, \
             name VARCHAR(100) NOT NULL, \
             created_at TIMESTAMP DEFAULT NOW())"
        ))
        .await
        .expect("Failed to create table");

    let columns = adapter
        .get_table_columns(&table_name, "public")
        .await
        .expect("get_table_columns failed");

    // Should have 3 columns
    assert_eq!(columns.len(), 3, "Expected 3 columns, got {columns:?}");

    // Check id column (PK)
    let id_col = columns
        .iter()
        .find(|c| c.name == "id")
        .expect("id column missing");
    assert_eq!(id_col.data_type, "integer");
    assert!(!id_col.nullable);
    assert!(id_col.is_primary_key);
    assert!(!id_col.is_foreign_key);

    // Check name column (NOT NULL, no default)
    let name_col = columns
        .iter()
        .find(|c| c.name == "name")
        .expect("name column missing");
    assert_eq!(name_col.data_type, "character varying");
    assert!(!name_col.nullable);
    assert!(!name_col.is_primary_key);

    // Check created_at column (nullable, has default)
    let created_col = columns
        .iter()
        .find(|c| c.name == "created_at")
        .expect("created_at column missing");
    assert!(
        created_col.data_type.contains("timestamp"),
        "Expected timestamp type, got: {}",
        created_col.data_type
    );
    assert!(created_col.nullable);
    assert!(
        created_col.default_value.is_some(),
        "created_at should have a default value"
    );

    // Clean up
    adapter
        .execute(&format!("DROP TABLE \"{table_name}\""))
        .await
        .expect("Failed to drop table");

    adapter.disconnect_pool().await.unwrap();
}

#[tokio::test]
async fn test_query_table_data() {
    let adapter = setup_adapter().await;
    let table_name = unique_table_name("data");

    // Create and populate table
    adapter
        .execute(&format!(
            "CREATE TABLE \"{table_name}\" (id SERIAL PRIMARY KEY, value TEXT NOT NULL)"
        ))
        .await
        .expect("Failed to create table");

    adapter
        .execute(&format!(
            "INSERT INTO \"{table_name}\" (value) VALUES ('alpha'), ('beta'), ('gamma')"
        ))
        .await
        .expect("Failed to insert data");

    // Query page 1, page_size 2
    let data = adapter
        .query_table_data(&table_name, "public", 1, 2, None)
        .await
        .expect("query_table_data failed");

    assert_eq!(data.columns.len(), 2, "Expected 2 columns");
    assert_eq!(data.rows.len(), 2, "Expected 2 rows on page 1");
    assert_eq!(data.total_count, 3, "Expected total_count = 3");
    assert_eq!(data.page, 1);
    assert_eq!(data.page_size, 2);

    // Query page 2
    let data_page2 = adapter
        .query_table_data(&table_name, "public", 2, 2, None)
        .await
        .expect("query_table_data page 2 failed");
    assert_eq!(data_page2.rows.len(), 1, "Expected 1 row on page 2");

    // Clean up
    adapter
        .execute(&format!("DROP TABLE \"{table_name}\""))
        .await
        .expect("Failed to drop table");

    adapter.disconnect_pool().await.unwrap();
}

#[tokio::test]
async fn test_query_table_data_ordering() {
    let adapter = setup_adapter().await;
    let table_name = unique_table_name("ordered");

    // Create and populate table
    adapter
        .execute(&format!(
            "CREATE TABLE \"{table_name}\" (id SERIAL PRIMARY KEY, label TEXT NOT NULL)"
        ))
        .await
        .expect("Failed to create table");

    adapter
        .execute(&format!(
            "INSERT INTO \"{table_name}\" (label) VALUES ('charlie'), ('alpha'), ('bravo')"
        ))
        .await
        .expect("Failed to insert data");

    // Query ordered by label ASC
    let data = adapter
        .query_table_data(&table_name, "public", 1, 50, Some("label"))
        .await
        .expect("query_table_data with ordering failed");

    assert_eq!(data.rows.len(), 3);

    // First row should be "alpha" when ordered by label
    let first_label = data.rows[0][1].as_str().unwrap_or("");
    assert_eq!(
        first_label, "alpha",
        "First row should be 'alpha' when ordered by label"
    );

    let last_label = data.rows[2][1].as_str().unwrap_or("");
    assert_eq!(
        last_label, "charlie",
        "Last row should be 'charlie' when ordered by label"
    );

    // Clean up
    adapter
        .execute(&format!("DROP TABLE \"{table_name}\""))
        .await
        .expect("Failed to drop table");

    adapter.disconnect_pool().await.unwrap();
}
