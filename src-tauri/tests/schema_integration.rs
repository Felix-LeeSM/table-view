mod common;

use table_view_lib::models::{DatabaseType, FilterCondition, FilterOperator};

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

#[tokio::test]
async fn test_list_schemas() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
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
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
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
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
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
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
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
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
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
        .query_table_data(&table_name, "public", 1, 2, None, None, None)
        .await
        .expect("query_table_data failed");

    assert_eq!(data.columns.len(), 2, "Expected 2 columns");
    assert_eq!(data.rows.len(), 2, "Expected 2 rows on page 1");
    assert_eq!(data.total_count, 3, "Expected total_count = 3");
    assert_eq!(data.page, 1);
    assert_eq!(data.page_size, 2);

    // Query page 2
    let data_page2 = adapter
        .query_table_data(&table_name, "public", 2, 2, None, None, None)
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
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
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
        .query_table_data(&table_name, "public", 1, 50, Some("label"), None, None)
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

#[tokio::test]
async fn test_query_table_data_ordering_desc() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let table_name = unique_table_name("ordered_desc");

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

    // Query ordered by label DESC using "label DESC" format
    let data = adapter
        .query_table_data(&table_name, "public", 1, 50, Some("label DESC"), None, None)
        .await
        .expect("query_table_data with DESC ordering failed");

    assert_eq!(data.rows.len(), 3);

    // First row should be "charlie" for DESC
    let first_label = data.rows[0][1].as_str().unwrap_or("");
    assert_eq!(
        first_label, "charlie",
        "First row should be 'charlie' when ordered by label DESC"
    );

    let last_label = data.rows[2][1].as_str().unwrap_or("");
    assert_eq!(
        last_label, "alpha",
        "Last row should be 'alpha' when ordered by label DESC"
    );

    // Verify backward-compatible single-word still defaults to ASC
    let data_asc = adapter
        .query_table_data(&table_name, "public", 1, 50, Some("label"), None, None)
        .await
        .expect("query_table_data with default ASC ordering failed");

    let asc_first = data_asc.rows[0][1].as_str().unwrap_or("");
    assert_eq!(
        asc_first, "alpha",
        "First row should be 'alpha' when ordered by label (default ASC)"
    );

    // Clean up
    adapter
        .execute(&format!("DROP TABLE \"{table_name}\""))
        .await
        .expect("Failed to drop table");

    adapter.disconnect_pool().await.unwrap();
}

#[tokio::test]
async fn test_get_table_columns_with_comments() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let table_name = unique_table_name("comments");

    // Create table with known columns
    adapter
        .execute(&format!(
            "CREATE TABLE \"{table_name}\" (\
             id SERIAL PRIMARY KEY, \
             name TEXT NOT NULL, \
             email TEXT)"
        ))
        .await
        .expect("Failed to create table");

    // Add a comment on the "name" column only
    adapter
        .execute(&format!(
            "COMMENT ON COLUMN \"{table_name}\".name IS 'User display name'"
        ))
        .await
        .expect("Failed to add column comment");

    // Fetch columns and verify comment field
    let columns = adapter
        .get_table_columns(&table_name, "public")
        .await
        .expect("get_table_columns failed");

    // The "name" column should carry the comment
    let name_col = columns
        .iter()
        .find(|c| c.name == "name")
        .expect("name column missing");
    assert_eq!(
        name_col.comment,
        Some("User display name".to_string()),
        "Expected comment on 'name' column"
    );

    // The "id" column should have no comment
    let id_col = columns
        .iter()
        .find(|c| c.name == "id")
        .expect("id column missing");
    assert_eq!(id_col.comment, None, "Expected no comment on 'id' column");

    // The "email" column should also have no comment
    let email_col = columns
        .iter()
        .find(|c| c.name == "email")
        .expect("email column missing");
    assert_eq!(
        email_col.comment, None,
        "Expected no comment on 'email' column"
    );

    // Clean up
    adapter
        .execute(&format!("DROP TABLE \"{table_name}\""))
        .await
        .expect("Failed to drop table");

    adapter.disconnect_pool().await.unwrap();
}

#[tokio::test]
async fn test_query_table_data_with_filter_bigint() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let table_name = unique_table_name("filter_bigint");

    // Create table with a BIGINT column
    adapter
        .execute(&format!(
            "CREATE TABLE \"{table_name}\" (\
             id BIGINT PRIMARY KEY, \
             name TEXT NOT NULL)"
        ))
        .await
        .expect("Failed to create table");

    adapter
        .execute(&format!(
            "INSERT INTO \"{table_name}\" (id, name) VALUES \
             (1, 'alice'), (2, 'bob'), (3, 'charlie')"
        ))
        .await
        .expect("Failed to insert data");

    // Filter by bigint column with Eq operator
    let filters = vec![FilterCondition {
        column: "id".to_string(),
        operator: FilterOperator::Eq,
        value: Some("2".to_string()),
    }];

    let data = adapter
        .query_table_data(&table_name, "public", 1, 50, None, Some(&filters), None)
        .await
        .expect("query_table_data with bigint filter failed");

    assert_eq!(
        data.rows.len(),
        1,
        "Expected 1 row for id=2 filter, got {}",
        data.rows.len()
    );
    assert_eq!(data.total_count, 1, "Expected total_count = 1");
    let name_val = data.rows[0][1].as_str().unwrap_or("");
    assert_eq!(name_val, "bob", "Filtered row should be 'bob'");

    // Clean up
    adapter
        .execute(&format!("DROP TABLE \"{table_name}\""))
        .await
        .expect("Failed to drop table");

    adapter.disconnect_pool().await.unwrap();
}

#[tokio::test]
async fn test_query_table_data_with_filter_text() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let table_name = unique_table_name("filter_text");

    // Create table with a TEXT column
    adapter
        .execute(&format!(
            "CREATE TABLE \"{table_name}\" (\
             id SERIAL PRIMARY KEY, \
             name TEXT NOT NULL)"
        ))
        .await
        .expect("Failed to create table");

    adapter
        .execute(&format!(
            "INSERT INTO \"{table_name}\" (name) VALUES \
             ('alice'), ('bob'), ('charlie'), ('david')"
        ))
        .await
        .expect("Failed to insert data");

    // Filter by text column with LIKE operator
    let filters = vec![FilterCondition {
        column: "name".to_string(),
        operator: FilterOperator::Like,
        value: Some("%li%".to_string()),
    }];

    let data = adapter
        .query_table_data(&table_name, "public", 1, 50, None, Some(&filters), None)
        .await
        .expect("query_table_data with text LIKE filter failed");

    // Should match 'alice' and 'charlie' (both contain 'li')
    assert_eq!(
        data.rows.len(),
        2,
        "Expected 2 rows for LIKE '%li%' filter, got {}",
        data.rows.len()
    );
    assert_eq!(data.total_count, 2, "Expected total_count = 2");

    // Clean up
    adapter
        .execute(&format!("DROP TABLE \"{table_name}\""))
        .await
        .expect("Failed to drop table");

    adapter.disconnect_pool().await.unwrap();
}

#[tokio::test]
async fn test_query_table_data_with_filter_integer() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let table_name = unique_table_name("filter_int");

    // Create table with an INTEGER (SERIAL) column
    adapter
        .execute(&format!(
            "CREATE TABLE \"{table_name}\" (\
             id SERIAL PRIMARY KEY, \
             score INTEGER NOT NULL, \
             label TEXT NOT NULL)"
        ))
        .await
        .expect("Failed to create table");

    adapter
        .execute(&format!(
            "INSERT INTO \"{table_name}\" (score, label) VALUES \
             (10, 'low'), (50, 'mid'), (90, 'high'), (100, 'top')"
        ))
        .await
        .expect("Failed to insert data");

    // Filter by integer column with Gt (>) operator
    let filters = vec![FilterCondition {
        column: "score".to_string(),
        operator: FilterOperator::Gt,
        value: Some("50".to_string()),
    }];

    let data = adapter
        .query_table_data(&table_name, "public", 1, 50, None, Some(&filters), None)
        .await
        .expect("query_table_data with integer Gt filter failed");

    // Should match score 90 and 100
    assert_eq!(
        data.rows.len(),
        2,
        "Expected 2 rows for score > 50 filter, got {}",
        data.rows.len()
    );
    assert_eq!(data.total_count, 2, "Expected total_count = 2");

    // Clean up
    adapter
        .execute(&format!("DROP TABLE \"{table_name}\""))
        .await
        .expect("Failed to drop table");

    adapter.disconnect_pool().await.unwrap();
}

#[tokio::test]
async fn test_query_table_data_multi_column_ordering() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let table_name = unique_table_name("multi_order");

    // Create and populate table
    adapter
        .execute(&format!(
            "CREATE TABLE \"{table_name}\" (\
             id SERIAL PRIMARY KEY, \
             category TEXT NOT NULL, \
             label TEXT NOT NULL)"
        ))
        .await
        .expect("Failed to create table");

    adapter
        .execute(&format!(
            "INSERT INTO \"{table_name}\" (category, label) VALUES \
             ('B', 'charlie'), ('A', 'alpha'), ('B', 'bravo'), ('A', 'beta')"
        ))
        .await
        .expect("Failed to insert data");

    // Query ordered by category ASC, label ASC using "category ASC, label ASC" format
    let data = adapter
        .query_table_data(
            &table_name,
            "public",
            1,
            50,
            Some("category ASC, label ASC"),
            None,
            None,
        )
        .await
        .expect("query_table_data with multi-column ordering failed");

    assert_eq!(data.rows.len(), 4);

    // First row should be category='A', label='alpha'
    let first_category = data.rows[0][1].as_str().unwrap_or("");
    let first_label = data.rows[0][2].as_str().unwrap_or("");
    assert_eq!(first_category, "A");
    assert_eq!(first_label, "alpha");

    // Second row should be category='A', label='beta'
    let second_category = data.rows[1][1].as_str().unwrap_or("");
    let second_label = data.rows[1][2].as_str().unwrap_or("");
    assert_eq!(second_category, "A");
    assert_eq!(second_label, "beta");

    // Third row should be category='B', label='bravo'
    let third_category = data.rows[2][1].as_str().unwrap_or("");
    let third_label = data.rows[2][2].as_str().unwrap_or("");
    assert_eq!(third_category, "B");
    assert_eq!(third_label, "bravo");

    // Fourth row should be category='B', label='charlie'
    let fourth_category = data.rows[3][1].as_str().unwrap_or("");
    let fourth_label = data.rows[3][2].as_str().unwrap_or("");
    assert_eq!(fourth_category, "B");
    assert_eq!(fourth_label, "charlie");

    // Query with mixed directions: category ASC, label DESC
    let data_desc = adapter
        .query_table_data(
            &table_name,
            "public",
            1,
            50,
            Some("category ASC, label DESC"),
            None,
            None,
        )
        .await
        .expect("query_table_data with mixed direction ordering failed");

    assert_eq!(data_desc.rows.len(), 4);

    // First row should be category='A', label='beta' (reversed within category)
    let first_label_desc = data_desc.rows[0][2].as_str().unwrap_or("");
    assert_eq!(first_label_desc, "beta");

    // Second row should be category='A', label='alpha'
    let second_label_desc = data_desc.rows[1][2].as_str().unwrap_or("");
    assert_eq!(second_label_desc, "alpha");

    // Clean up
    adapter
        .execute(&format!("DROP TABLE \"{table_name}\""))
        .await
        .expect("Failed to drop table");

    adapter.disconnect_pool().await.unwrap();
}

#[tokio::test]
async fn test_get_view_columns_returns_columns_in_order() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let table_name = unique_table_name("vc_base");
    let view_name = unique_table_name("vc_view");

    adapter
        .execute(&format!(
            "CREATE TABLE \"{table_name}\" (\
             id SERIAL PRIMARY KEY, \
             name TEXT NOT NULL, \
             score INTEGER)"
        ))
        .await
        .expect("Failed to create base table");

    adapter
        .execute(&format!(
            "CREATE VIEW \"{view_name}\" AS \
             SELECT id, name, score FROM \"{table_name}\" WHERE score IS NOT NULL"
        ))
        .await
        .expect("Failed to create view");

    let columns = adapter
        .get_view_columns("public", &view_name)
        .await
        .expect("get_view_columns failed");

    assert_eq!(
        columns.len(),
        3,
        "Expected 3 columns, got {}: {:?}",
        columns.len(),
        columns
    );
    assert_eq!(columns[0].name, "id");
    assert_eq!(columns[1].name, "name");
    assert_eq!(columns[2].name, "score");

    // Views never carry primary/foreign key metadata
    for col in &columns {
        assert!(
            !col.is_primary_key,
            "View column {} should not be a primary key",
            col.name
        );
        assert!(
            !col.is_foreign_key,
            "View column {} should not be a foreign key",
            col.name
        );
        assert!(col.fk_reference.is_none());
    }

    // Note: PostgreSQL reports every view column as nullable in
    // information_schema.columns regardless of the underlying table's NOT NULL
    // constraints, because the view itself has no own constraints. We do not
    // attempt to back-propagate nullability from the base table.
    for col in &columns {
        assert!(
            col.nullable,
            "View column {} should be reported nullable by information_schema",
            col.name
        );
    }

    // Clean up
    adapter
        .execute(&format!("DROP VIEW \"{view_name}\""))
        .await
        .expect("Failed to drop view");
    adapter
        .execute(&format!("DROP TABLE \"{table_name}\""))
        .await
        .expect("Failed to drop table");

    adapter.disconnect_pool().await.unwrap();
}

#[tokio::test]
async fn test_get_view_columns_for_unknown_view_returns_empty() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };

    let columns = adapter
        .get_view_columns("public", "definitely_does_not_exist_view")
        .await
        .expect("get_view_columns should succeed even for unknown views");

    assert!(
        columns.is_empty(),
        "Expected empty columns for unknown view, got: {:?}",
        columns
    );

    adapter.disconnect_pool().await.unwrap();
}
