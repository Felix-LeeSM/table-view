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

/// `get_table_columns` populates `check_clauses` from `pg_constraint`
/// (contype='c'). Validates the per-column flatten over `conkey`:
/// a constraint over (a, b) appears in BOTH columns' clause vectors
/// with the canonical `pg_get_constraintdef()` form. Date 2026-05-08.
#[tokio::test]
async fn test_get_table_columns_populates_check_clauses() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let table_name = unique_table_name("chks");

    adapter
        .execute(&format!(
            "CREATE TABLE \"{table_name}\" (\
             id SERIAL PRIMARY KEY, \
             age INTEGER CHECK (age >= 0), \
             min_v INTEGER, \
             max_v INTEGER, \
             CONSTRAINT chk_range CHECK (min_v <= max_v))"
        ))
        .await
        .expect("Failed to create table");

    let columns = adapter
        .get_table_columns(&table_name, "public")
        .await
        .expect("get_table_columns failed");

    let age_col = columns
        .iter()
        .find(|c| c.name == "age")
        .expect("age column missing");
    assert_eq!(age_col.check_clauses.len(), 1, "age has 1 check");
    assert!(
        age_col.check_clauses[0].contains("age >= 0"),
        "age check should reference age >= 0, got: {:?}",
        age_col.check_clauses
    );

    // Both `min_v` and `max_v` should carry the table-level CHECK
    // because conkey lists both column attnums.
    let min_col = columns
        .iter()
        .find(|c| c.name == "min_v")
        .expect("min_v column missing");
    let max_col = columns
        .iter()
        .find(|c| c.name == "max_v")
        .expect("max_v column missing");
    assert_eq!(min_col.check_clauses.len(), 1, "min_v has 1 check");
    assert_eq!(max_col.check_clauses.len(), 1, "max_v has 1 check");
    assert!(
        min_col.check_clauses[0].contains("min_v <= max_v"),
        "min_v check def: {:?}",
        min_col.check_clauses
    );

    // Columns without CHECK constraints stay empty.
    let id_col = columns
        .iter()
        .find(|c| c.name == "id")
        .expect("id column missing");
    assert!(id_col.check_clauses.is_empty(), "id has no check");

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

// ── Sprint 237 P5+ refactor pass — coverage 확장 시나리오 (2026-05-08) ───
// 작성 이유: db/postgres/schema.rs 가 29.73% 커버. 미커버 함수들
// (list_views / list_functions / get_view_definition / get_function_source /
// list_types / list_databases / list_schema_columns / get_view_columns 의
// 데이터 path) 를 fixture-기반 통합 시나리오로 hit. 각 시나리오는
// unique 이름으로 격리.

#[tokio::test]
async fn test_list_views_returns_created_view() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let table_name = unique_table_name("lv_t");
    let view_name = format!("{table_name}_v");

    adapter
        .execute(&format!(
            "CREATE TABLE \"{table_name}\" (id SERIAL PRIMARY KEY, name TEXT)"
        ))
        .await
        .expect("create table");
    adapter
        .execute(&format!(
            "CREATE VIEW \"{view_name}\" AS SELECT id, name FROM \"{table_name}\""
        ))
        .await
        .expect("create view");

    let views = adapter.list_views("public").await.expect("list_views");
    assert!(
        views.iter().any(|v| v.name == view_name),
        "view '{view_name}' missing from list_views: {:?}",
        views.iter().map(|v| &v.name).collect::<Vec<_>>()
    );

    adapter
        .execute(&format!("DROP VIEW \"{view_name}\""))
        .await
        .ok();
    adapter
        .execute(&format!("DROP TABLE \"{table_name}\""))
        .await
        .ok();
    adapter.disconnect_pool().await.unwrap();
}

#[tokio::test]
async fn test_get_view_definition_returns_select_text() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let table_name = unique_table_name("gvd_t");
    let view_name = format!("{table_name}_v");

    adapter
        .execute(&format!(
            "CREATE TABLE \"{table_name}\" (id INT, name TEXT)"
        ))
        .await
        .expect("create table");
    adapter
        .execute(&format!(
            "CREATE VIEW \"{view_name}\" AS SELECT id FROM \"{table_name}\""
        ))
        .await
        .expect("create view");

    let def = adapter
        .get_view_definition("public", &view_name)
        .await
        .expect("get_view_definition");
    // PG `pg_get_viewdef` 는 본문을 SELECT … FROM … 형태로 정규화. 정확한
    // whitespace 는 PG 버전마다 달라 substring 검사로 fail-safe.
    assert!(
        def.to_lowercase().contains("select"),
        "view definition missing SELECT: {def}"
    );
    assert!(
        def.contains(&table_name),
        "view definition missing source table: {def}"
    );

    adapter
        .execute(&format!("DROP VIEW \"{view_name}\""))
        .await
        .ok();
    adapter
        .execute(&format!("DROP TABLE \"{table_name}\""))
        .await
        .ok();
    adapter.disconnect_pool().await.unwrap();
}

#[tokio::test]
async fn test_list_functions_returns_user_function() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let fn_name = format!("test_fn_{}", unique_table_name("x"));

    adapter
        .execute(&format!(
            "CREATE FUNCTION \"{fn_name}\"(x INT) RETURNS INT \
             LANGUAGE SQL AS $$ SELECT x + 1 $$"
        ))
        .await
        .expect("create function");

    let funcs = adapter
        .list_functions("public")
        .await
        .expect("list_functions");
    assert!(
        funcs.iter().any(|f| f.name == fn_name),
        "function '{fn_name}' missing from list_functions: {:?}",
        funcs.iter().map(|f| &f.name).collect::<Vec<_>>()
    );

    adapter
        .execute(&format!("DROP FUNCTION \"{fn_name}\"(INT)"))
        .await
        .ok();
    adapter.disconnect_pool().await.unwrap();
}

#[tokio::test]
async fn test_get_function_source_returns_body() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let fn_name = format!("src_fn_{}", unique_table_name("x"));

    adapter
        .execute(&format!(
            "CREATE FUNCTION \"{fn_name}\"(x INT) RETURNS INT \
             LANGUAGE SQL AS $$ SELECT x * 2 $$"
        ))
        .await
        .expect("create function");

    let source = adapter
        .get_function_source("public", &fn_name)
        .await
        .expect("get_function_source");
    assert!(
        source.contains("x * 2") || source.contains("x*2"),
        "function source missing body 'x * 2': {source}"
    );

    adapter
        .execute(&format!("DROP FUNCTION \"{fn_name}\"(INT)"))
        .await
        .ok();
    adapter.disconnect_pool().await.unwrap();
}

#[tokio::test]
async fn test_list_types_includes_pg_builtin_int4() {
    // pg_type 카탈로그 dump. PG 기본 타입 (`int4`, `text`) 이 즉시 반환되어야 한다.
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };

    let types = adapter.list_types().await.expect("list_types");
    assert!(
        types.iter().any(|t| t.name == "int4"),
        "expected 'int4' in list_types result"
    );
    assert!(
        types.iter().any(|t| t.name == "text"),
        "expected 'text' in list_types result"
    );

    adapter.disconnect_pool().await.unwrap();
}

#[tokio::test]
async fn test_list_databases_includes_admin_dbs() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let dbs = adapter.list_databases().await.expect("list_databases");
    // testcontainers의 PG는 default DB 'postgres'. external override 시
    // 'table_view_test'. 둘 중 하나는 항상 포함.
    let names: Vec<_> = dbs.iter().map(|d| &d.name).collect();
    assert!(
        names
            .iter()
            .any(|n| *n == "postgres" || *n == "table_view_test"),
        "expected 'postgres' or 'table_view_test' in list_databases: {:?}",
        names
    );

    adapter.disconnect_pool().await.unwrap();
}

#[tokio::test]
async fn test_list_schema_columns_aggregates_multiple_tables() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let t1 = unique_table_name("lsc_a");
    let t2 = unique_table_name("lsc_b");

    adapter
        .execute(&format!(
            "CREATE TABLE \"{t1}\" (id INT PRIMARY KEY, label TEXT)"
        ))
        .await
        .expect("create t1");
    adapter
        .execute(&format!("CREATE TABLE \"{t2}\" (k INT, v BIGINT)"))
        .await
        .expect("create t2");

    let map = adapter
        .list_schema_columns("public")
        .await
        .expect("list_schema_columns");
    let cols_t1 = map.get(&t1).unwrap_or_else(|| panic!("t1 missing in map"));
    let cols_t2 = map.get(&t2).unwrap_or_else(|| panic!("t2 missing in map"));
    assert_eq!(cols_t1.len(), 2, "t1 should have 2 columns");
    assert_eq!(cols_t2.len(), 2, "t2 should have 2 columns");
    assert!(cols_t1.iter().any(|c| c.name == "id"));
    assert!(cols_t2.iter().any(|c| c.name == "v"));

    adapter.execute(&format!("DROP TABLE \"{t1}\"")).await.ok();
    adapter.execute(&format!("DROP TABLE \"{t2}\"")).await.ok();
    adapter.disconnect_pool().await.unwrap();
}

// ── get_table_indexes / get_table_constraints / FK 통합 시나리오 ──────────
// 작성: 2026-05-08. db/postgres/schema.rs 의 indexes/constraints SQL +
// BTreeMap 집계 분기, get_table_columns 의 FK reference (`format_fk_reference`)
// 분기는 통합으로만 hit 된다. UI 의 schema panel 이 직접 노출하는 메타라
// 회귀 가드 가치가 크다.

#[tokio::test]
async fn test_get_table_indexes_returns_pk_and_secondary_indexes() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let t = unique_table_name("idx_t");
    adapter
        .execute(&format!(
            "CREATE TABLE \"{t}\" (\
              id INT PRIMARY KEY, \
              email TEXT, \
              status TEXT\
            )"
        ))
        .await
        .expect("create");
    let idx_email = format!("{t}_email_uq");
    let idx_status = format!("{t}_status_idx");
    adapter
        .execute(&format!(
            "CREATE UNIQUE INDEX \"{idx_email}\" ON \"{t}\" (email)"
        ))
        .await
        .expect("unique idx");
    adapter
        .execute(&format!(
            "CREATE INDEX \"{idx_status}\" ON \"{t}\" (status)"
        ))
        .await
        .expect("plain idx");

    let indexes = adapter
        .get_table_indexes(&t, "public")
        .await
        .expect("get_table_indexes");

    // PK + unique email + plain status — PG names PK as `<table>_pkey` so
    // we look it up by the primary flag rather than asserting the name.
    let pk = indexes
        .iter()
        .find(|i| i.is_primary)
        .expect("PK index missing");
    assert!(pk.is_unique, "PK must be unique");
    assert_eq!(pk.columns, vec!["id".to_string()]);

    let uniq = indexes
        .iter()
        .find(|i| i.name == idx_email)
        .expect("unique idx missing");
    assert!(uniq.is_unique);
    assert!(!uniq.is_primary);
    assert_eq!(uniq.columns, vec!["email".to_string()]);

    let plain = indexes
        .iter()
        .find(|i| i.name == idx_status)
        .expect("plain idx missing");
    assert!(!plain.is_unique);
    assert!(!plain.is_primary);
    assert_eq!(plain.columns, vec!["status".to_string()]);

    adapter.execute(&format!("DROP TABLE \"{t}\"")).await.ok();
    adapter.disconnect_pool().await.unwrap();
}

#[tokio::test]
async fn test_get_table_indexes_composite_columns_preserve_attnum_order() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let t = unique_table_name("idx_comp");
    adapter
        .execute(&format!("CREATE TABLE \"{t}\" (a INT, b INT, c INT)"))
        .await
        .expect("create");
    let idx = format!("{t}_ab_idx");
    adapter
        .execute(&format!("CREATE INDEX \"{idx}\" ON \"{t}\" (a, b)"))
        .await
        .expect("composite idx");

    let indexes = adapter
        .get_table_indexes(&t, "public")
        .await
        .expect("get_table_indexes");
    let composite = indexes.iter().find(|i| i.name == idx).expect("missing");
    // attnum-ordered: a then b.
    assert_eq!(composite.columns, vec!["a".to_string(), "b".to_string()]);

    adapter.execute(&format!("DROP TABLE \"{t}\"")).await.ok();
    adapter.disconnect_pool().await.unwrap();
}

#[tokio::test]
async fn test_get_table_indexes_for_unknown_table_returns_empty() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let indexes = adapter
        .get_table_indexes("does_not_exist_zzz", "public")
        .await
        .expect("empty result, not error");
    assert!(indexes.is_empty());
    adapter.disconnect_pool().await.unwrap();
}

#[tokio::test]
async fn test_get_table_constraints_pk_unique_check() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let t = unique_table_name("cons_t");
    adapter
        .execute(&format!(
            "CREATE TABLE \"{t}\" (\
              id INT PRIMARY KEY, \
              email TEXT UNIQUE, \
              age INT CHECK (age >= 0)\
            )"
        ))
        .await
        .expect("create");

    let constraints = adapter
        .get_table_constraints(&t, "public")
        .await
        .expect("get_table_constraints");

    // PG generates implicit constraint names; lookup by type.
    let pk = constraints
        .iter()
        .find(|c| c.constraint_type == "PRIMARY KEY")
        .expect("PK missing");
    assert_eq!(pk.columns, vec!["id".to_string()]);
    assert!(pk.reference_table.is_none());

    let uniq = constraints
        .iter()
        .find(|c| c.constraint_type == "UNIQUE")
        .expect("UNIQUE missing");
    assert_eq!(uniq.columns, vec!["email".to_string()]);

    let chk = constraints
        .iter()
        .find(|c| c.constraint_type == "CHECK")
        .expect("CHECK missing");
    // CHECK 의 column list 는 information_schema.key_column_usage 에 채워지지
    // 않으므로 빈 vec 가 가능. 변형 존재 자체만 pin.
    let _ = chk;

    adapter.execute(&format!("DROP TABLE \"{t}\"")).await.ok();
    adapter.disconnect_pool().await.unwrap();
}

#[tokio::test]
async fn test_get_table_constraints_foreign_key_carries_reference() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let parent = unique_table_name("fk_parent");
    let child = unique_table_name("fk_child");
    adapter
        .execute(&format!("CREATE TABLE \"{parent}\" (id INT PRIMARY KEY)"))
        .await
        .expect("create parent");
    adapter
        .execute(&format!(
            "CREATE TABLE \"{child}\" (\
              id INT PRIMARY KEY, \
              parent_id INT REFERENCES \"{parent}\"(id)\
            )"
        ))
        .await
        .expect("create child");

    let constraints = adapter
        .get_table_constraints(&child, "public")
        .await
        .expect("get_table_constraints");

    let fk = constraints
        .iter()
        .find(|c| c.constraint_type == "FOREIGN KEY")
        .expect("FK missing");
    assert_eq!(fk.columns, vec!["parent_id".to_string()]);
    assert_eq!(fk.reference_table.as_deref(), Some(parent.as_str()));
    assert_eq!(
        fk.reference_columns.as_deref(),
        Some(&["id".to_string()][..])
    );

    adapter
        .execute(&format!("DROP TABLE \"{child}\""))
        .await
        .ok();
    adapter
        .execute(&format!("DROP TABLE \"{parent}\""))
        .await
        .ok();
    adapter.disconnect_pool().await.unwrap();
}

#[tokio::test]
async fn test_get_table_columns_populates_fk_reference_in_child() {
    // get_table_columns 의 FK 분기는 `format_fk_reference("schema.table(col)")`
    // 형식 string 을 ColumnInfo.fk_reference 에 채운다. 이 분기는 plain
    // CREATE TABLE 만으로는 hit 안 되고 REFERENCES 가 있어야 활성.
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let parent = unique_table_name("fkcol_parent");
    let child = unique_table_name("fkcol_child");
    adapter
        .execute(&format!("CREATE TABLE \"{parent}\" (id INT PRIMARY KEY)"))
        .await
        .expect("create parent");
    adapter
        .execute(&format!(
            "CREATE TABLE \"{child}\" (\
              id INT PRIMARY KEY, \
              parent_id INT REFERENCES \"{parent}\"(id)\
            )"
        ))
        .await
        .expect("create child");

    let cols = adapter
        .get_table_columns(&child, "public")
        .await
        .expect("get_table_columns");
    let parent_id = cols
        .iter()
        .find(|c| c.name == "parent_id")
        .expect("parent_id missing");
    assert!(parent_id.is_foreign_key);
    let expected = format!("public.{parent}(id)");
    assert_eq!(parent_id.fk_reference.as_deref(), Some(expected.as_str()));

    adapter
        .execute(&format!("DROP TABLE \"{child}\""))
        .await
        .ok();
    adapter
        .execute(&format!("DROP TABLE \"{parent}\""))
        .await
        .ok();
    adapter.disconnect_pool().await.unwrap();
}
