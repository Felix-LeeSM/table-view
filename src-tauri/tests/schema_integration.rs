mod common;

use std::sync::Arc;
use table_view_lib::db::postgres::PostgresAdapter;
use table_view_lib::db::{DbAdapter, RdbAdapter};
use table_view_lib::models::{
    AddColumnRequest, AddConstraintRequest, AlterTableRequest, ColumnChange, ColumnDefinition,
    ConstraintDefinition, CreateIndexRequest, CreateTablePlanIndex, CreateTablePlanRequest,
    CreateTableRequest, CreateTriggerRequest, DatabaseType, DropColumnRequest,
    DropConstraintRequest, DropIndexRequest, DropTableRequest, DropTriggerRequest, FilterCondition,
    FilterOperator, RenameTableRequest,
};

/// Helper: create a unique test table name to avoid collisions across tests.
fn unique_table_name(prefix: &str) -> String {
    format!(
        "test_{}_{}",
        prefix,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    )
}

fn unique_schema_name(prefix: &str) -> String {
    unique_table_name(prefix)
}

fn qualified_ident(schema: &str, name: &str) -> String {
    format!("\"{schema}\".\"{name}\"")
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

/// #1229 (사용자 리포트 2026-07-03) — `CREATE TEMP TABLE` 은 backend 슬롯별
/// 내부 스키마 `pg_temp_<N>` / `pg_toast_temp_<N>` 를 만들고, 그 pg_namespace
/// 항목은 세션 종료 후에도 잔존한다. `list_schemas` 가 정확 매칭 3개만
/// 제외하던 시절엔 이 temp 스키마가 사이드바로 샜다. 여기서는 실 PG 로
/// temp table 을 만든 뒤 `list_schemas` 결과에 temp 패턴이 없는지 + `public`
/// 같은 정상 스키마는 그대로 노출되는지(과차단 없음)를 가드한다. 같은
/// 소스에서 스키마를 나열하는 `list_types` 도 temp 를 흘리지 않음을 함께
/// 확인한다.
#[tokio::test]
async fn test_list_schemas_excludes_temp_namespaces() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };

    // 현재 세션에 temp table 을 만들면 backend 가 pg_temp_<N> 네임스페이스를
    // materialize 한다.
    adapter
        .execute("CREATE TEMP TABLE issue_1229_tmp (id INT, blob TEXT)")
        .await
        .expect("create temp table");

    let schemas = adapter.list_schemas().await.expect("list_schemas failed");
    let names: Vec<&str> = schemas.iter().map(|s| s.name.as_str()).collect();

    assert!(
        !names
            .iter()
            .any(|n| n.starts_with("pg_temp_") || n.starts_with("pg_toast_temp_")),
        "list_schemas must not surface internal temp namespaces, got: {names:?}"
    );
    // 과차단 금지: 정상 스키마는 그대로.
    assert!(
        names.contains(&"public"),
        "list_schemas must still surface 'public', got: {names:?}"
    );

    // 같은 카탈로그 소스인 list_types 도 temp 스키마를 흘리지 않아야 한다
    // (temp table 의 composite row type 은 `NOT EXISTS (reltype = t.oid)` 로
    // 이미 배제되지만, 회귀 가드로 명시).
    let types = adapter.list_types().await.expect("list_types failed");
    assert!(
        !types
            .iter()
            .any(|t| t.schema.starts_with("pg_temp_") || t.schema.starts_with("pg_toast_temp_")),
        "list_types must not surface types from internal temp namespaces, got schemas: {:?}",
        types.iter().map(|t| &t.schema).collect::<Vec<_>>()
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

/// PG parity (사용자 리포트 2026-07-07) — SchemaTree 에 `public` 은 뜨는데
/// 테이블이 0개였다. 근본 원인: `list_tables` 가 `information_schema.tables`
/// 를 소스로 써서 *접속 role 이 권한을 가진* 테이블만 노출했다. 타 role 이
/// 소유하고 접속 role 에 grant 가 없는 테이블은 psql `\dt` / TablePlus 에선
/// 보여도 앱 목록에선 사라졌다. 여기서는 admin 이 테이블을 만들고, 그 테이블에
/// **아무 권한도 없는** login role 을 만든 뒤 그 role 로 재접속해도 테이블이
/// 목록에 뜨는지 가드한다 — catalog(`pg_catalog.pg_class`) 기반 쿼리는 권한
/// 무관. 구 information_schema 쿼리에선 이 목록이 비어 RED, 신 쿼리에선 GREEN.
#[tokio::test]
async fn test_list_tables_visible_without_table_privilege() {
    let admin = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let base = common::pg_test_config()
        .await
        .expect("endpoint present when setup_adapter succeeded");

    let table = unique_table_name("noperm");
    let role = unique_table_name("restricted"); // valid identifier (test_<...>_<nanos>)
    let role_pw = "restricted_pw_1";

    // admin 이 테이블 + 그 테이블에 아무 grant 없는 login role 생성.
    admin
        .execute(&format!("CREATE TABLE \"{table}\" (id INT)"))
        .await
        .expect("admin create table");
    admin
        .execute(&format!(
            "CREATE ROLE \"{role}\" LOGIN PASSWORD '{role_pw}'"
        ))
        .await
        .expect("create restricted role");
    // 스키마 USAGE 만 부여 — 실제 "타 소유 테이블" 상황(스키마엔 접근되나
    // 테이블 권한은 없음)을 재현. 테이블 자체엔 어떤 grant 도 주지 않는다.
    admin
        .execute(&format!("GRANT USAGE ON SCHEMA public TO \"{role}\""))
        .await
        .expect("grant schema usage");

    // 제한 role 로 재접속.
    let mut restricted_cfg = base.clone();
    restricted_cfg.user = role.clone();
    restricted_cfg.password = role_pw.to_string();
    let restricted = PostgresAdapter::new();
    restricted
        .connect_pool(&restricted_cfg)
        .await
        .expect("restricted role connect");

    let tables = restricted
        .list_tables("public")
        .await
        .expect("list_tables as restricted role");
    let names: Vec<&str> = tables.iter().map(|t| t.name.as_str()).collect();
    let saw_table = names.contains(&table.as_str());

    // cleanup (assert 전에 정리해 role 이 남아 후속 테스트를 방해하지 않도록).
    restricted.disconnect_pool().await.ok();
    admin
        .execute(&format!("DROP TABLE IF EXISTS \"{table}\""))
        .await
        .ok();
    admin
        .execute(&format!("DROP ROLE IF EXISTS \"{role}\""))
        .await
        .ok();
    admin.disconnect_pool().await.ok();

    assert!(
        saw_table,
        "catalog-based list_tables must surface a table the role has no privilege on, got: {names:?}"
    );
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
async fn test_create_table_plan_executes_table_and_index_then_schema_reads_see_both() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let table_name = unique_table_name("structure_plan");
    let index_name = format!("idx_{table_name}_label");

    let preview_req = CreateTablePlanRequest {
        connection_id: "c".into(),
        schema: "public".into(),
        name: table_name.clone(),
        columns: vec![
            ColumnDefinition {
                name: "id".into(),
                data_type: "integer".into(),
                nullable: false,
                default_value: None,
                comment: None,
                is_identity: false,
            },
            ColumnDefinition {
                name: "label".into(),
                data_type: "text".into(),
                nullable: true,
                default_value: None,
                comment: None,
                is_identity: false,
            },
        ],
        primary_key: Some(vec!["id".into()]),
        table_comment: None,
        indexes: vec![CreateTablePlanIndex {
            index_name: index_name.clone(),
            columns: vec!["label".into()],
            index_type: "btree".into(),
            is_unique: false,
        }],
        constraints: vec![],
        preview_only: true,
        expected_database: None,
    };

    let preview = adapter
        .create_table_plan(&preview_req)
        .await
        .expect("preview create table plan");
    assert!(preview.sql.contains("CREATE TABLE"));
    assert!(preview.sql.contains("CREATE INDEX"));

    let before = adapter
        .list_tables("public")
        .await
        .expect("list tables before execute");
    assert!(
        before.iter().all(|t| t.name != table_name),
        "preview-only create_table_plan must not create the table"
    );

    let mut commit_req = preview_req.clone();
    commit_req.preview_only = false;
    adapter
        .create_table_plan(&commit_req)
        .await
        .expect("execute create table plan");

    let tables = adapter
        .list_tables("public")
        .await
        .expect("list tables after execute");
    assert!(
        tables.iter().any(|t| t.name == table_name),
        "schema refresh/list_tables must see the created table"
    );

    let indexes = adapter
        .get_table_indexes(&table_name, "public")
        .await
        .expect("get table indexes after execute");
    assert!(
        indexes.iter().any(|i| i.name == index_name),
        "schema refresh/get_table_indexes must see the created index"
    );

    adapter
        .execute(&format!("DROP TABLE IF EXISTS \"{table_name}\""))
        .await
        .ok();
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

    // Check id column (PK).
    // Sprint 259 — restore_serial 가 nextval(...) default 검출 시
    // underlying `integer` → `serial` 로 복원.
    let id_col = columns
        .iter()
        .find(|c| c.name == "id")
        .expect("id column missing");
    assert_eq!(id_col.data_type, "serial");
    assert!(!id_col.nullable);
    assert!(id_col.is_primary_key);
    assert!(!id_col.is_foreign_key);
    // #1433 — serial 은 attidentity='' (identity 아님). 생략은 nextval
    // default 경로로 커버되므로 is_identity 는 false 여야 한다.
    assert!(
        !id_col.is_identity,
        "serial must not report is_identity, got {id_col:?}"
    );

    // Check name column (NOT NULL, no default).
    // Sprint 258 — format_type + normalize_pg_type 으로 length 포함된
    // DDL-level 표기 (`varchar(100)`).
    let name_col = columns
        .iter()
        .find(|c| c.name == "name")
        .expect("name column missing");
    assert_eq!(name_col.data_type, "varchar(100)");
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

/// #1433 — `get_table_columns` 의 `is_identity` wiring 검증 (실 PG,
/// `pg_attribute.attidentity`). GENERATED ALWAYS('a') / BY DEFAULT('d') 는
/// true, serial(attidentity='') / plain 컬럼은 false — datagrid 의
/// INSERT 컬럼 생략이 이 flag 하나에 의존한다.
#[tokio::test]
async fn test_get_table_columns_identity_flags() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let table_name = unique_table_name("identity");

    adapter
        .execute(&format!(
            "CREATE TABLE \"{table_name}\" (\
             id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, \
             alt_id INT GENERATED BY DEFAULT AS IDENTITY, \
             seq_id SERIAL, \
             name TEXT)"
        ))
        .await
        .expect("Failed to create table");

    let columns = adapter
        .get_table_columns(&table_name, "public")
        .await
        .expect("get_table_columns failed");

    let flag = |name: &str| {
        columns
            .iter()
            .find(|c| c.name == name)
            .unwrap_or_else(|| panic!("{name} column missing, got {columns:?}"))
            .is_identity
    };
    assert!(flag("id"), "GENERATED ALWAYS AS IDENTITY must be identity");
    assert!(
        flag("alt_id"),
        "GENERATED BY DEFAULT AS IDENTITY must be identity"
    );
    assert!(!flag("seq_id"), "serial must NOT be identity");
    assert!(!flag("name"), "plain column must NOT be identity");

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
        .query_table_data(&table_name, "public", 1, 2, None, None, None, None)
        .await
        .expect("query_table_data failed");

    assert_eq!(data.columns.len(), 2, "Expected 2 columns");
    assert_eq!(data.rows.len(), 2, "Expected 2 rows on page 1");
    assert_eq!(data.total_count, 3, "Expected total_count = 3");
    assert_eq!(data.page, 1);
    assert_eq!(data.page_size, 2);

    // Query page 2
    let data_page2 = adapter
        .query_table_data(&table_name, "public", 2, 2, None, None, None, None)
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
        .query_table_data(
            &table_name,
            "public",
            1,
            50,
            Some("label"),
            None,
            None,
            None,
        )
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
        .query_table_data(
            &table_name,
            "public",
            1,
            50,
            Some("label DESC"),
            None,
            None,
            None,
        )
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
        .query_table_data(
            &table_name,
            "public",
            1,
            50,
            Some("label"),
            None,
            None,
            None,
        )
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
        .query_table_data(
            &table_name,
            "public",
            1,
            50,
            None,
            Some(&filters),
            None,
            None,
        )
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
        .query_table_data(
            &table_name,
            "public",
            1,
            50,
            None,
            Some(&filters),
            None,
            None,
        )
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
        .query_table_data(
            &table_name,
            "public",
            1,
            50,
            None,
            Some(&filters),
            None,
            None,
        )
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
    let schema = unique_schema_name("lsc_schema");
    let t1 = unique_table_name("lsc_a");
    let t2 = unique_table_name("lsc_b");
    let q1 = qualified_ident(&schema, &t1);
    let q2 = qualified_ident(&schema, &t2);

    adapter
        .execute(&format!("CREATE SCHEMA \"{schema}\""))
        .await
        .expect("create schema");

    adapter
        .execute(&format!(
            "CREATE TABLE {q1} (id INT PRIMARY KEY, label TEXT)"
        ))
        .await
        .expect("create t1");
    adapter
        .execute(&format!("CREATE TABLE {q2} (k INT, v BIGINT)"))
        .await
        .expect("create t2");

    let map = adapter
        .list_schema_columns(&schema)
        .await
        .expect("list_schema_columns");
    let cols_t1 = map.get(&t1).unwrap_or_else(|| panic!("t1 missing in map"));
    let cols_t2 = map.get(&t2).unwrap_or_else(|| panic!("t2 missing in map"));
    assert_eq!(cols_t1.len(), 2, "t1 should have 2 columns");
    assert_eq!(cols_t2.len(), 2, "t2 should have 2 columns");
    assert!(cols_t1.iter().any(|c| c.name == "id"));
    assert!(cols_t2.iter().any(|c| c.name == "v"));

    adapter
        .execute(&format!("DROP SCHEMA \"{schema}\" CASCADE"))
        .await
        .ok();
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

// ── Sprint 261 (ADR 0026) — numeric wire-format integration tests ────────
//
// 작성 2026-05-11. `query_table_data` / `execute_query` 가 bigint / numeric
// 컬럼 cell 을 `Value::String` 으로 wire 에 올리고, int4 같은 안전 범위
// 컬럼은 `Value::Number` 그대로 유지한다는 invariant 를 PG live DB 로 검증.
// ADR 0026 의 "JSON.parse 정밀도 손실 없이 frontend 에서 BigInt/Decimal 로
// wrap 가능" 전제의 기반.

#[tokio::test]
async fn test_query_table_data_bigint_value_is_string_wire() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let table_name = unique_table_name("wire_bigint");

    adapter
        .execute(&format!(
            "CREATE TABLE \"{table_name}\" (id BIGINT PRIMARY KEY)"
        ))
        .await
        .expect("create bigint table");
    // i64::MAX = 9223372036854775807, > 2^53-1 = 9007199254740991.
    adapter
        .execute(&format!(
            "INSERT INTO \"{table_name}\" (id) VALUES (9223372036854775807)"
        ))
        .await
        .expect("insert bigint");

    let data = adapter
        .query_table_data(&table_name, "public", 1, 50, None, None, None, None)
        .await
        .expect("query_table_data bigint");
    assert_eq!(data.rows.len(), 1);
    let cell = &data.rows[0][0];
    assert!(
        cell.is_string(),
        "bigint cell must be wire-encoded as JSON string, got: {cell:?}"
    );
    assert_eq!(cell.as_str(), Some("9223372036854775807"));

    adapter
        .execute(&format!("DROP TABLE \"{table_name}\""))
        .await
        .ok();
    adapter.disconnect_pool().await.unwrap();
}

#[tokio::test]
async fn test_query_table_data_numeric_value_is_string_wire() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let table_name = unique_table_name("wire_numeric");

    adapter
        .execute(&format!(
            "CREATE TABLE \"{table_name}\" (id INT PRIMARY KEY, amount NUMERIC(38, 18))"
        ))
        .await
        .expect("create numeric table");
    // High-precision decimal not representable as IEEE 754 binary float.
    adapter
        .execute(&format!(
            "INSERT INTO \"{table_name}\" (id, amount) VALUES (1, 123456789.123456789012345678)"
        ))
        .await
        .expect("insert numeric");

    let data = adapter
        .query_table_data(&table_name, "public", 1, 50, None, None, None, None)
        .await
        .expect("query_table_data numeric");
    assert_eq!(data.rows.len(), 1);
    // amount is column 1.
    let cell = &data.rows[0][1];
    assert!(
        cell.is_string(),
        "numeric cell must be wire-encoded as JSON string, got: {cell:?}"
    );
    // Exact base-10 representation is byte-preserved.
    assert_eq!(cell.as_str(), Some("123456789.123456789012345678"));

    adapter
        .execute(&format!("DROP TABLE \"{table_name}\""))
        .await
        .ok();
    adapter.disconnect_pool().await.unwrap();
}

#[tokio::test]
async fn test_query_table_data_int4_value_remains_number_wire() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let table_name = unique_table_name("wire_int4");

    adapter
        .execute(&format!(
            "CREATE TABLE \"{table_name}\" (id INT PRIMARY KEY)"
        ))
        .await
        .expect("create int4 table");
    adapter
        .execute(&format!("INSERT INTO \"{table_name}\" (id) VALUES (42)"))
        .await
        .expect("insert int4");

    let data = adapter
        .query_table_data(&table_name, "public", 1, 50, None, None, None, None)
        .await
        .expect("query_table_data int4");
    assert_eq!(data.rows.len(), 1);
    let cell = &data.rows[0][0];
    assert!(
        cell.is_number(),
        "int4 cell must remain JSON number (safe within ±2^53-1), got: {cell:?}"
    );
    assert_eq!(cell.as_i64(), Some(42));

    adapter
        .execute(&format!("DROP TABLE \"{table_name}\""))
        .await
        .ok();
    adapter.disconnect_pool().await.unwrap();
}

#[tokio::test]
async fn test_execute_query_bigint_select_emits_string_wire() {
    // execute_query path (free-form SELECT) — `SELECT 9223372036854775807::bigint`.
    // ADR 0026 의 두 번째 적용 site. `Pg::type_info().to_string()` 이
    // bigint 컬럼에 대해 "INT8" 을 반환하므로 헬퍼의 `lower == "int8"`
    // 분기에 매칭.
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };

    let result = adapter
        .execute_query(
            "SELECT 9223372036854775807::bigint AS big",
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("execute_query bigint literal");
    assert_eq!(result.rows.len(), 1);
    let cell = &result.rows[0][0];
    assert!(
        cell.is_string(),
        "execute_query bigint cell must be string wire, got: {cell:?}"
    );
    assert_eq!(cell.as_str(), Some("9223372036854775807"));

    adapter.disconnect_pool().await.unwrap();
}

// =============================================================================
// Sprint 296 follow-up (2026-05-14) — PG RdbAdapter 트레잇 dispatch 통합
// =============================================================================
// 작성 이유: `db/postgres.rs` (390 line) 의 트레잇 dispatch wrapper 가
// 4.62% 만 hit. inherent method 만 직접 호출하던 기존 시나리오는 트레잇 surface
// 를 건너뛴다. Sprint 296 의 MySQL 측 (`db/mysql.rs`) 합류를 PG 로 mirror —
// `Arc<dyn DbAdapter>` / `Arc<dyn RdbAdapter>` 로 호출해 wrapper 본체를 hit.
// PG-only `create_trigger` / `drop_trigger` / `list_types` 도 같은 path 로.

// Trait dispatch test — 단일 통합 시나리오로 38개 wrapper 메소드를 한 번씩 hit.
// 시나리오 분할 비용보다 한 commit 안에서 surface 전체 회귀 가드 가치가 큼.
#[tokio::test]
async fn test_pg_trait_dispatch_covers_rdb_adapter_surface() {
    let adapter = match common::setup_adapter(DatabaseType::Postgresql).await {
        Some(a) => a,
        None => return,
    };
    let raw = Arc::new(adapter);

    // (1) DbAdapter — kind / ping. connect/disconnect 은 setup_adapter 이미 호출.
    let db: Arc<dyn DbAdapter> = raw.clone();
    assert!(
        matches!(db.kind(), DatabaseType::Postgresql),
        "trait kind() must report Postgresql"
    );
    db.ping().await.expect("trait ping");

    // (2) RdbAdapter — read paths.
    let rdb: Arc<dyn RdbAdapter> = raw.clone();

    let namespaces = rdb.list_namespaces().await.expect("trait list_namespaces");
    assert!(!namespaces.is_empty());

    let dbs = rdb.list_databases().await.expect("trait list_databases");
    assert!(!dbs.is_empty());

    // PG `current_database` 는 trait default — execute_sql 경로로 SELECT
    // current_database(). 명시적으로 호출해 default 분기 hit.
    let cur = rdb
        .current_database()
        .await
        .expect("trait current_database");
    assert!(cur.is_some());

    // (3) DDL / schema introspection — fresh table 으로 모든 path.
    let table_name = unique_table_name("trait_disp");
    let view_name = format!("{table_name}_v");
    let parent_name = unique_table_name("trait_parent");
    let child_name = unique_table_name("trait_child");
    let fn_name = format!("fn_{}", unique_table_name("trait_fn"));
    let trigger_name = format!("trg_{}", unique_table_name("trait_trg"));
    let idx_name = format!("{table_name}_idx");
    let table_ident = format!("\"{table_name}\"");
    let view_ident = format!("\"{view_name}\"");
    let fn_ident = format!("\"{fn_name}\"");

    // create_table via trait.
    let create_req = CreateTableRequest {
        connection_id: "c".into(),
        schema: "public".into(),
        name: table_name.clone(),
        columns: vec![
            ColumnDefinition {
                name: "id".into(),
                data_type: "integer".into(),
                nullable: false,
                default_value: None,
                comment: None,
                is_identity: true,
            },
            ColumnDefinition {
                name: "label".into(),
                data_type: "text".into(),
                nullable: false,
                default_value: None,
                comment: None,
                is_identity: false,
            },
        ],
        primary_key: Some(vec!["id".into()]),
        preview_only: false,
        table_comment: Some("trait dispatch fixture".into()),
        expected_database: None,
    };
    rdb.create_table(&create_req)
        .await
        .expect("trait create_table");

    // execute_sql / execute_sql_batch / dry_run_sql_batch.
    let _ = rdb
        .execute_sql(
            &format!("INSERT INTO {table_ident} (label) VALUES ('a')"),
            None,
        )
        .await
        .expect("trait execute_sql INSERT");

    let _ = rdb
        .execute_sql_batch(
            &[
                format!("INSERT INTO {table_ident} (label) VALUES ('b')"),
                format!("INSERT INTO {table_ident} (label) VALUES ('c')"),
            ],
            None,
        )
        .await
        .expect("trait execute_sql_batch");

    let dry = rdb
        .dry_run_sql_batch(&[format!("SELECT COUNT(*) FROM {table_ident}")], None)
        .await
        .expect("trait dry_run_sql_batch");
    assert_eq!(dry.len(), 1);

    // Introspection — list_tables / get_columns / query_table_data / count_null_rows.
    let tables = rdb.list_tables("public").await.expect("trait list_tables");
    assert!(tables.iter().any(|t| t.name == table_name));

    let cols = rdb
        .get_columns("public", &table_name, None)
        .await
        .expect("trait get_columns");
    assert_eq!(cols.len(), 2);

    let data = rdb
        .query_table_data("public", &table_name, 1, 50, None, None, None, None)
        .await
        .expect("trait query_table_data");
    assert_eq!(data.rows.len(), 3);

    let null_count = rdb
        .count_null_rows("public", &table_name, "label")
        .await
        .expect("trait count_null_rows");
    assert_eq!(null_count, 0);

    // stream_table_rows.
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<Vec<serde_json::Value>>>(4);
    let streamed = rdb
        .stream_table_rows(
            "public",
            &table_name,
            10,
            &["id".to_string(), "label".to_string()],
            tx,
            None,
        )
        .await
        .expect("trait stream_table_rows");
    assert_eq!(streamed, 3);
    let mut total = 0usize;
    while let Some(batch) = rx.recv().await {
        total += batch.len();
    }
    assert_eq!(total, 3);

    // create_index / get_table_indexes.
    let idx_req = CreateIndexRequest {
        connection_id: "c".into(),
        schema: "public".into(),
        table: table_name.clone(),
        index_name: idx_name.clone(),
        columns: vec!["label".into()],
        index_type: "btree".into(),
        is_unique: false,
        preview_only: false,
        expected_database: None,
    };
    rdb.create_index(&idx_req)
        .await
        .expect("trait create_index");

    let indexes = rdb
        .get_table_indexes("public", &table_name, None)
        .await
        .expect("trait get_table_indexes");
    assert!(indexes.iter().any(|i| i.name == idx_name));

    // drop_index. NOTE: PG drop_index 에 `IF EXISTS` 위치 버그 (issue 별도) —
    // `DROP INDEX "public".IF EXISTS "name"` 으로 emit 되어 syntax error. 본
    // 시나리오는 `if_exists: false` 로 우회.
    let drop_idx_req = DropIndexRequest {
        connection_id: "c".into(),
        schema: "public".into(),
        index_name: idx_name.clone(),
        table: String::new(),
        if_exists: false,
        preview_only: false,
        expected_database: None,
    };
    rdb.drop_index(&drop_idx_req)
        .await
        .expect("trait drop_index");

    // add_constraint + get_table_constraints + drop_constraint.
    let uq_name = format!("{table_name}_uq_label");
    let add_cons_req = AddConstraintRequest {
        connection_id: "c".into(),
        schema: "public".into(),
        table: table_name.clone(),
        constraint_name: uq_name.clone(),
        definition: ConstraintDefinition::Unique {
            columns: vec!["label".into()],
        },
        preview_only: false,
        expected_database: None,
    };
    rdb.add_constraint(&add_cons_req)
        .await
        .expect("trait add_constraint");
    let constraints = rdb
        .get_table_constraints("public", &table_name, None)
        .await
        .expect("trait get_table_constraints");
    assert!(constraints.iter().any(|c| c.name == uq_name));

    let drop_cons_req = DropConstraintRequest {
        connection_id: "c".into(),
        schema: "public".into(),
        table: table_name.clone(),
        constraint_name: uq_name,
        preview_only: false,
        expected_database: None,
    };
    rdb.drop_constraint(&drop_cons_req)
        .await
        .expect("trait drop_constraint");

    // alter_table / add_column / drop_column.
    let add_col_req = AddColumnRequest {
        connection_id: "c".into(),
        schema: "public".into(),
        table: table_name.clone(),
        column: ColumnDefinition {
            name: "extra".into(),
            data_type: "text".into(),
            nullable: true,
            default_value: None,
            comment: None,
            is_identity: false,
        },
        check_expression: None,
        preview_only: false,
        expected_database: None,
    };
    rdb.add_column(&add_col_req)
        .await
        .expect("trait add_column");

    let alter_req = AlterTableRequest {
        connection_id: "c".into(),
        schema: "public".into(),
        table: table_name.clone(),
        changes: vec![ColumnChange::Modify {
            name: "extra".into(),
            new_data_type: Some("varchar(100)".into()),
            new_nullable: Some(true),
            new_default_value: None,
            using_expression: None,
        }],
        preview_only: true,
        expected_database: None,
    };
    rdb.alter_table(&alter_req)
        .await
        .expect("trait alter_table preview");

    let drop_col_req = DropColumnRequest {
        connection_id: "c".into(),
        schema: "public".into(),
        table: table_name.clone(),
        column_name: "extra".into(),
        cascade: false,
        preview_only: false,
        expected_database: None,
    };
    rdb.drop_column(&drop_col_req)
        .await
        .expect("trait drop_column");

    // View introspection — create view, list/get/get_columns.
    let _ = rdb
        .execute_sql(
            &format!("CREATE VIEW {view_ident} AS SELECT id, label FROM {table_ident}"),
            None,
        )
        .await
        .expect("CREATE VIEW");
    let views = rdb.list_views("public").await.expect("trait list_views");
    assert!(views.iter().any(|v| v.name == view_name));
    let view_def = rdb
        .get_view_definition("public", &view_name)
        .await
        .expect("trait get_view_definition");
    assert!(view_def.to_lowercase().contains("select"));
    let view_cols = rdb
        .get_view_columns("public", &view_name)
        .await
        .expect("trait get_view_columns");
    assert_eq!(view_cols.len(), 2);
    let _ = rdb
        .execute_sql(&format!("DROP VIEW {view_ident}"), None)
        .await
        .ok();

    // list_schema_columns. Use a private schema so this catalog-wide scan does
    // not race with sibling tests dropping tables in public.
    let schema_columns_schema = unique_schema_name("trait_lsc_schema");
    let schema_columns_table = unique_table_name("trait_lsc");
    let schema_columns_ident = qualified_ident(&schema_columns_schema, &schema_columns_table);
    rdb.execute_sql(&format!("CREATE SCHEMA \"{schema_columns_schema}\""), None)
        .await
        .expect("create trait list_schema_columns schema");
    rdb.execute_sql(
        &format!("CREATE TABLE {schema_columns_ident} (id INT PRIMARY KEY)"),
        None,
    )
    .await
    .expect("create trait list_schema_columns table");
    let schema_map = rdb
        .list_schema_columns(&schema_columns_schema)
        .await
        .expect("trait list_schema_columns");
    assert!(schema_map.contains_key(&schema_columns_table));
    let _ = rdb
        .execute_sql(
            &format!("DROP SCHEMA \"{schema_columns_schema}\" CASCADE"),
            None,
        )
        .await
        .ok();

    // Functions — create + list + get_function_source.
    let _ = rdb
        .execute_sql(
            &format!(
                "CREATE FUNCTION {fn_ident}(x INT) RETURNS INT \
                 LANGUAGE SQL AS $$ SELECT x + 1 $$"
            ),
            None,
        )
        .await
        .expect("CREATE FUNCTION");
    let funcs = rdb
        .list_functions("public")
        .await
        .expect("trait list_functions");
    assert!(funcs.iter().any(|f| f.name == fn_name));
    let fn_src = rdb
        .get_function_source("public", &fn_name)
        .await
        .expect("trait get_function_source");
    assert!(fn_src.contains("x + 1") || fn_src.contains("x+1"));

    // Triggers — create_trigger / list_triggers / get_trigger_source / drop_trigger.
    let create_trg_req = CreateTriggerRequest {
        connection_id: "c".into(),
        schema: "public".into(),
        table: table_name.clone(),
        trigger_name: trigger_name.clone(),
        timing: "BEFORE".into(),
        events: vec!["INSERT".into()],
        orientation: "ROW".into(),
        when_expression: None,
        function_schema: "public".into(),
        function_name: fn_name.clone(),
        function_arguments: Some("NEW.id".into()),
        preview_only: true,
        expected_database: None,
    };
    let trg_preview = rdb
        .create_trigger(&create_trg_req)
        .await
        .expect("trait create_trigger preview");
    assert!(trg_preview.sql.contains("CREATE TRIGGER"));

    // Real trigger 는 BEFORE INSERT trigger function 이 reuse 가능한 형태로 작성
    // 돼야 함. 본 시나리오의 fn 은 SQL function 으로 trigger function 자격이
    // 없으므로 preview_only 로 dispatcher 만 hit. 실제 execute 는 sprint 별
    // PG trigger 시나리오에서 cover.

    let triggers = rdb
        .list_triggers("public", &table_name)
        .await
        .expect("trait list_triggers");
    // 본 fixture 는 trigger 를 실제로 만들지 않아 빈 vec — 동작 path 자체만 pin.
    let _ = triggers;

    let drop_trg_req = DropTriggerRequest {
        connection_id: "c".into(),
        schema: "public".into(),
        table: table_name.clone(),
        trigger_name: trigger_name.clone(),
        cascade: false,
        preview_only: true,
        expected_database: None,
    };
    let drop_trg_preview = rdb
        .drop_trigger(&drop_trg_req)
        .await
        .expect("trait drop_trigger preview");
    assert!(drop_trg_preview.sql.contains("DROP TRIGGER"));

    // get_trigger_source — unknown trigger 도 path 만 hit. PG 는 not-found 시
    // Err(Connection) 을 반환할 수 있어 .ok() 로 두고 err 도 허용.
    let _ = rdb
        .get_trigger_source("public", &table_name, &trigger_name)
        .await
        .ok();

    // list_types (PG-only override — MySQL 은 default Unsupported).
    let types = rdb.list_types().await.expect("trait list_types");
    assert!(types.iter().any(|t| t.name == "int4"));

    // FK chain — parent/child + rename + drop.
    let create_parent = CreateTableRequest {
        connection_id: "c".into(),
        schema: "public".into(),
        name: parent_name.clone(),
        columns: vec![ColumnDefinition {
            name: "id".into(),
            data_type: "integer".into(),
            nullable: false,
            default_value: None,
            comment: None,
            is_identity: false,
        }],
        primary_key: Some(vec!["id".into()]),
        preview_only: false,
        table_comment: None,
        expected_database: None,
    };
    rdb.create_table(&create_parent)
        .await
        .expect("trait create_table parent");

    let create_child = CreateTableRequest {
        connection_id: "c".into(),
        schema: "public".into(),
        name: child_name.clone(),
        columns: vec![
            ColumnDefinition {
                name: "id".into(),
                data_type: "integer".into(),
                nullable: false,
                default_value: None,
                comment: None,
                is_identity: false,
            },
            ColumnDefinition {
                name: "parent_id".into(),
                data_type: "integer".into(),
                nullable: false,
                default_value: None,
                comment: None,
                is_identity: false,
            },
        ],
        primary_key: Some(vec!["id".into()]),
        preview_only: false,
        table_comment: None,
        expected_database: None,
    };
    rdb.create_table(&create_child)
        .await
        .expect("trait create_table child");

    let fk_name = format!("{child_name}_fk_parent");
    let add_fk_req = AddConstraintRequest {
        connection_id: "c".into(),
        schema: "public".into(),
        table: child_name.clone(),
        constraint_name: fk_name.clone(),
        definition: ConstraintDefinition::ForeignKey {
            columns: vec!["parent_id".into()],
            reference_table: parent_name.clone(),
            reference_columns: vec!["id".into()],
            on_delete: Some("CASCADE".into()),
            on_update: None,
        },
        preview_only: false,
        expected_database: None,
    };
    rdb.add_constraint(&add_fk_req)
        .await
        .expect("trait add_constraint FK");

    // rename_table.
    let renamed = format!("{child_name}_renamed");
    let rename_req = RenameTableRequest {
        connection_id: "c".into(),
        schema: "public".into(),
        table: child_name.clone(),
        new_name: renamed.clone(),
        preview_only: false,
        expected_database: None,
    };
    rdb.rename_table(&rename_req)
        .await
        .expect("trait rename_table");

    // namespace_label / switch_database — both default to schema/Unsupported
    // 가 아니라 PG impl 이 schema namespace + sub-pool switch 를 제공.
    let label = raw.namespace_label();
    assert!(matches!(label, table_view_lib::db::NamespaceLabel::Schema));

    // switch_database — PG sub-pool 가 default DB ("postgres" / "table_view_test") 로
    // 전환. 본 fixture 의 default DB 와 동일한 이름으로 호출해 dispatch wrapper hit.
    if let Some(target_db) = cur.as_deref() {
        rdb.switch_database(target_db).await.ok();
    }

    // Cleanup — drop_table via trait (parent/child/renamed/base).
    for t in [renamed, parent_name, table_name] {
        let drop_req = DropTableRequest {
            connection_id: "c".into(),
            schema: "public".into(),
            table: t,
            cascade: true,
            preview_only: false,
            expected_database: None,
        };
        rdb.drop_table(&drop_req).await.ok();
    }
    // Drop function (not via trait — no fn DDL in trait surface).
    let _ = rdb
        .execute_sql(&format!("DROP FUNCTION {fn_ident}(INT)"), None)
        .await
        .ok();
    // disconnect via DbAdapter trait.
    db.disconnect().await.expect("trait disconnect");
}

// 별도 단위 — DbAdapter trait dispatch 의 connect path 회귀 가드. setup_adapter
// 이 이미 connect 한 후 라 위 통합 시나리오는 connect 트레잇 wrapper 를 hit
// 안 함. 본 시나리오는 raw adapter 로 시작해 trait connect 만 호출.
#[tokio::test]
async fn test_pg_trait_connect_dispatch_via_box_dyn_db_adapter() {
    let config = match common::pg_test_config().await {
        Some(c) => c,
        None => return,
    };
    let raw = Arc::new(PostgresAdapter::new());
    let db: Arc<dyn DbAdapter> = raw.clone();
    db.connect(&config).await.expect("trait connect");
    db.ping().await.expect("trait ping after connect");
    db.disconnect().await.expect("trait disconnect");
}
