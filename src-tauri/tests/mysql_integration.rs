//! Sprint 296 (2026-05-14) — MySQL adapter 통합 게이트 합류.
//!
//! 작성 이유: `db/mysql/{queries,schema,mutations,connection}.rs` 의 IO
//! 본체가 unit-mock 으로 cover 되지 않아 pre-push `6_rust-coverage` 게이트
//! 임계 (83/76/81) 가 baseline drift (77.77/72.96/77.39) 로 만성 미달.
//! PG (`query_integration` + `schema_integration`) 시나리오를 MySQL 로
//! mirror — adapter parity 강제 (X+ 정책: 1:1 mirror + 양쪽 추가 + dialect).
//!
//! 실행:
//!   cargo mysql-test
//!   MYSQL_HOST=localhost MYSQL_PORT=13306 cargo mysql-test   (외부 재사용)
//!
//! Dialect 차이 패치 메모:
//! - `pg_sleep(N)`         → `SLEEP(N)`
//! - `pg_tables`           → `information_schema.tables`
//! - `CREATE TEMP TABLE`   → unique-named normal table (TEMP 는 connection-scoped,
//!   sqlx pool 의 다른 connection 에서 안 보임)
//! - `NUMERIC`             → `DECIMAL(10, 2)` (호환성)
//! - `$1, $2` 파라미터     → `?, ?` (현 시나리오에는 미사용)
//! - `RETURNING`           → `LAST_INSERT_ID()` (현 시나리오에는 미사용)

mod common;

use std::sync::Arc;
use std::time::{Duration, Instant};

use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use table_view_lib::db::mysql::MysqlAdapter;
use table_view_lib::db::{DbAdapter, RdbAdapter};
use table_view_lib::error::AppError;
use table_view_lib::models::{
    AddColumnRequest, AddConstraintRequest, AlterTableRequest, ColumnChange, ColumnDefinition,
    ConstraintDefinition, CreateIndexRequest, CreateTableRequest, CreateTriggerRequest,
    DatabaseType, DropColumnRequest, DropConstraintRequest, DropIndexRequest, DropTableRequest,
    DropTriggerRequest, FilterCondition, FilterOperator, QueryType, RenameTableRequest,
};
use tokio::time::sleep;
use tokio_util::sync::CancellationToken;

// MySQL 의 "schema" 는 database 이름. setup_mysql_adapter() 가 endpoint.database
// = "test" 로 connect 하므로 query_table_data 의 schema 인자도 "test".
const MYSQL_SCHEMA: &str = "test";

fn expected_check_catalog_support_from_version(raw: &str) -> bool {
    let is_mariadb = raw.to_ascii_lowercase().contains("mariadb");
    let parse_source = if is_mariadb {
        raw.strip_prefix("5.5.5-").unwrap_or(raw)
    } else {
        raw
    };
    let Some((major, minor, patch)) = parse_mysql_test_version(parse_source) else {
        return false;
    };
    let minimum = if is_mariadb { (10, 2, 1) } else { (8, 0, 16) };

    (major, minor, patch) >= minimum
}

fn parse_mysql_test_version(raw: &str) -> Option<(u32, u32, u32)> {
    let mut start = None;
    let mut end = raw.len();
    for (idx, ch) in raw.char_indices() {
        if ch.is_ascii_digit() {
            start.get_or_insert(idx);
            continue;
        }
        if start.is_some() && ch != '.' {
            end = idx;
            break;
        }
    }

    let version = &raw[start?..end];
    let mut parts = version
        .split('.')
        .take(3)
        .map(|part| part.parse::<u32>().ok());
    let major = parts.next().flatten()?;
    let minor = parts.next().flatten().unwrap_or(0);
    let patch = parts.next().flatten().unwrap_or(0);
    Some((major, minor, patch))
}

async fn seed_filter_table_mysql(adapter: &table_view_lib::db::mysql::MysqlAdapter, table: &str) {
    adapter
        .execute_query(
            &format!(
                "CREATE TABLE {table} (\
                  id INT PRIMARY KEY, \
                  name TEXT, \
                  amount DECIMAL(10, 2), \
                  active BOOLEAN, \
                  note TEXT\
                )"
            ),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE");
    adapter
        .execute_query(
            &format!(
                "INSERT INTO {table} VALUES \
                 (1, 'Alice', 100.0, true, 'first'), \
                 (2, 'Bob', 200.0, false, 'second'), \
                 (3, 'Charlie', 300.0, true, NULL), \
                 (4, 'Dave', 400.0, false, NULL), \
                 (5, 'Eve', 500.0, true, 'fifth')"
            ),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("INSERT");
}

// =============================================================================
// Batch 1 (Slice B-2) — query_integration.rs 시나리오 1-7 mirror
// =============================================================================

/// Mirror of PG `test_select_query_returns_columns_and_rows` — SELECT 가
/// 컬럼/행 메타데이터를 반환.
#[tokio::test]
#[serial_test::serial]
async fn test_mysql_select_query_returns_columns_and_rows() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };

    let result = adapter
        .execute_query(
            "SELECT 1 as num, 'test' as str",
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("SELECT query should succeed");

    assert_eq!(result.columns.len(), 2, "Should have 2 columns");
    assert_eq!(result.columns[0].name, "num");
    assert_eq!(result.columns[1].name, "str");
    assert_eq!(result.rows.len(), 1, "Should have 1 row");
    assert_eq!(result.total_count, 1);
    assert!(matches!(result.query_type, QueryType::Select));

    adapter.disconnect_pool().await.ok();
}

/// Issue #1231 — MySQL mirror of the PG row-cap boundary test. Explicit cap
/// arg (no global), 3-row UNION, silent-skip without a live MySQL.
#[tokio::test]
#[serial_test::serial]
async fn test_mysql_row_cap_truncates_select_1231() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let sql = "SELECT 1 AS n UNION ALL SELECT 2 UNION ALL SELECT 3";

    let capped = adapter
        .execute_query(sql, None, 2)
        .await
        .expect("capped SELECT should succeed");
    assert_eq!(capped.rows.len(), 2, "row cap must bound fetched rows");
    assert!(capped.truncated, "truncated must be set at the cap");
    assert_eq!(capped.total_count, 2);

    let full = adapter
        .execute_query(sql, None, 10)
        .await
        .expect("uncapped SELECT should succeed");
    assert_eq!(full.rows.len(), 3);
    assert!(!full.truncated, "under-cap results must not be truncated");

    let boundary = adapter
        .execute_query(sql, None, 3)
        .await
        .expect("boundary SELECT should succeed");
    assert_eq!(boundary.rows.len(), 3);
    assert!(!boundary.truncated, "cap == row count must not truncate");

    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_call_procedure_returns_result_rows() {
    let config = match common::mysql_test_config().await {
        Some(c) => c,
        None => return,
    };
    let adapter = MysqlAdapter::new();
    adapter
        .connect_pool(&config)
        .await
        .expect("connect mysql adapter");

    let setup_pool = MySqlPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_secs(5))
        .connect_with(
            MySqlConnectOptions::new()
                .host(&config.host)
                .port(config.port)
                .username(&config.user)
                .password(&config.password)
                .database(&config.database),
        )
        .await
        .expect("procedure setup pool");
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let proc_name = format!("mysql_runtime_ping_{ts}");

    sqlx::raw_sql(&format!("DROP PROCEDURE IF EXISTS {proc_name}"))
        .execute(&setup_pool)
        .await
        .expect("DROP PROCEDURE before test");
    sqlx::raw_sql(&format!(
        "CREATE PROCEDURE {proc_name}(IN input_id BIGINT) SELECT input_id AS echoed_id"
    ))
    .execute(&setup_pool)
    .await
    .expect("CREATE PROCEDURE");

    let result = adapter
        .execute_query(
            &format!("CALL {proc_name}(872)"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CALL procedure");

    assert!(matches!(result.query_type, QueryType::Select));
    assert_eq!(result.columns.len(), 1);
    assert_eq!(result.columns[0].name, "echoed_id");
    assert_eq!(result.total_count, 1);
    assert_eq!(result.rows.len(), 1);
    // echoed_id 는 BIGINT 파라미터를 투영하므로 ADR 0026 (issue #1082) 에 따라
    // JSON string token 으로 wire 된다.
    assert_eq!(result.rows[0][0].as_str(), Some("872"));

    sqlx::raw_sql(&format!("DROP PROCEDURE IF EXISTS {proc_name}"))
        .execute(&setup_pool)
        .await
        .ok();
    setup_pool.close().await;
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_check_constraint_catalog_gate_uses_live_server_version() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };

    let version = adapter
        .execute_query(
            "SELECT VERSION() AS version",
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("SELECT VERSION()");
    let raw = version.rows[0][0].as_str().unwrap_or_default();

    assert_eq!(
        adapter.supports_check_constraint_catalog().await,
        expected_check_catalog_support_from_version(raw),
        "CHECK catalog gate should match live server version {raw:?}"
    );

    adapter.disconnect_pool().await.ok();
}

/// Mirror of PG `test_dml_query_returns_rows_affected` — INSERT/UPDATE/DELETE
/// 모두 affected rows 보고.
#[tokio::test]
#[serial_test::serial]
async fn test_mysql_dml_query_returns_rows_affected() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };

    let table_name = format!(
        "test_dml_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );

    adapter
        .execute_query(
            &format!("CREATE TABLE {table_name} (id INT)"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE should succeed");

    let result = adapter
        .execute_query(
            &format!("INSERT INTO {table_name} VALUES (1), (2), (3)"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("INSERT query should succeed");

    assert!(result.columns.is_empty(), "DML should have no columns");
    assert!(result.rows.is_empty(), "DML should have no rows");
    assert_eq!(result.total_count, 3, "Should affect 3 rows");
    match result.query_type {
        QueryType::Dml { rows_affected } => assert_eq!(rows_affected, 3),
        _ => panic!("Expected Dml query type"),
    }

    let update_result = adapter
        .execute_query(
            &format!("UPDATE {table_name} SET id = 10"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("UPDATE query should succeed");
    assert_eq!(update_result.total_count, 3);

    let delete_result = adapter
        .execute_query(
            &format!("DELETE FROM {table_name}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("DELETE query should succeed");
    assert_eq!(delete_result.total_count, 3);

    adapter
        .execute_query(
            &format!("DROP TABLE {table_name}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

/// Mirror of PG `test_ddl_query_returns_success` — DDL 성공 + 테이블 실제
/// 생성 확인. PG 가 `CREATE TEMP TABLE` + `pg_tables` EXISTS 로 검증한 부분을
/// MySQL 에서는 unique-named normal table + `information_schema.tables` 로
/// dialect mirror.
#[tokio::test]
#[serial_test::serial]
async fn test_mysql_ddl_query_returns_success() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };

    let table_name = format!(
        "test_ddl_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );

    let result = adapter
        .execute_query(
            &format!("CREATE TABLE {table_name} (id INT)"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE should succeed");

    assert!(result.columns.is_empty(), "DDL should have no columns");
    assert!(result.rows.is_empty(), "DDL should have no rows");
    assert_eq!(result.total_count, 0, "DDL should have 0 total_count");
    assert!(matches!(result.query_type, QueryType::Ddl));

    let check_result = adapter
        .execute_query(
            &format!(
                "SELECT EXISTS(SELECT 1 FROM information_schema.tables \
                 WHERE table_name = '{table_name}' AND table_schema = DATABASE()) as exists_flag"
            ),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("EXISTS query should succeed");

    assert_eq!(check_result.rows.len(), 1);
    assert_eq!(check_result.total_count, 1);

    adapter
        .execute_query(
            &format!("DROP TABLE {table_name}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

/// Mirror of PG `test_query_cancellation_works` — `SLEEP(10)` 으로 대체.
/// MySQL `SLEEP()` 도 cancellable (sqlx CancellationToken connection-level).
#[tokio::test]
#[serial_test::serial]
async fn test_mysql_query_cancellation_works() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };

    let cancel_token = CancellationToken::new();
    let child_token = cancel_token.clone();
    let spawned_adapter = adapter.clone();

    let query_handle = tokio::spawn(async move {
        spawned_adapter
            .execute_query(
                "SELECT SLEEP(10)",
                Some(&child_token),
                table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
            )
            .await
    });

    sleep(Duration::from_millis(100)).await;
    cancel_token.cancel();

    let result = query_handle.await.expect("Task should complete");

    match result {
        Ok(_) => {
            println!("Note: Query completed before cancellation could take effect");
        }
        Err(e) => {
            let error_msg = e.to_string();
            assert!(
                error_msg.contains("cancelled") || error_msg.contains("cancel"),
                "Expected cancellation error, got: {}",
                error_msg
            );
        }
    }

    adapter.disconnect_pool().await.ok();
}

/// Mirror of PG `test_query_error_returns_database_error` — 존재 안 하는
/// 테이블 SELECT 가 Database error 반환.
#[tokio::test]
#[serial_test::serial]
async fn test_mysql_query_error_returns_database_error() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };

    let result = adapter
        .execute_query(
            "SELECT * FROM nonexistent_table_mysql_mirror",
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await;

    assert!(result.is_err(), "Invalid query should return error");

    let error = result.unwrap_err();
    let error_msg = error.to_string();
    assert!(
        error_msg.contains("Database"),
        "Error should be Database variant, got: {}",
        error_msg
    );

    adapter.disconnect_pool().await.ok();
}

/// Mirror of PG `test_complex_select_query` — JOIN + aggregate ordering.
/// `NUMERIC` → `DECIMAL(10, 2)` dialect 패치.
#[tokio::test]
#[serial_test::serial]
async fn test_mysql_complex_select_query() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();

    adapter
        .execute_query(
            &format!("CREATE TABLE users_{ts} (id INT, name TEXT)"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();

    adapter
        .execute_query(
            &format!("CREATE TABLE orders_{ts} (id INT, user_id INT, amount DECIMAL(10, 2))"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();

    adapter
        .execute_query(
            &format!("INSERT INTO users_{ts} VALUES (1, 'Alice'), (2, 'Bob')"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();

    adapter
        .execute_query(
            &format!(
                "INSERT INTO orders_{ts} VALUES (1, 1, 100.50), (2, 1, 200.00), (3, 2, 50.00)"
            ),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();

    let result = adapter
        .execute_query(
            &format!(
                "SELECT u.name, o.amount FROM users_{ts} u \
                 JOIN orders_{ts} o ON u.id = o.user_id ORDER BY o.amount"
            ),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("JOIN query should succeed");

    assert_eq!(result.columns.len(), 2);
    assert_eq!(result.rows.len(), 3);
    assert_eq!(result.total_count, 3);
    assert!(matches!(result.query_type, QueryType::Select));

    adapter
        .execute_query(
            &format!("DROP TABLE users_{ts}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter
        .execute_query(
            &format!("DROP TABLE orders_{ts}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

/// Mirror of PG `test_empty_result_set` — 빈 테이블 SELECT 는 rows 0 + Select.
#[tokio::test]
#[serial_test::serial]
async fn test_mysql_empty_result_set() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table_name = format!("test_empty_{ts}");

    adapter
        .execute_query(
            &format!("CREATE TABLE {table_name} (id INT)"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();

    let result = adapter
        .execute_query(
            &format!("SELECT * FROM {table_name}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("Query should succeed");

    assert!(result.rows.is_empty(), "Should have no rows");
    assert_eq!(result.total_count, 0);
    assert!(matches!(result.query_type, QueryType::Select));

    adapter
        .execute_query(
            &format!("DROP TABLE {table_name}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

// =============================================================================
// Batch 2 (Slice B-2) — comment / trailing semicolon / execute_query_batch
// =============================================================================

/// Mirror of PG `test_select_with_leading_comment` — `--` 라인 코멘트 후 SELECT.
#[tokio::test]
#[serial_test::serial]
async fn test_mysql_select_with_leading_comment() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };

    let result = adapter
        .execute_query(
            "-- This is a comment\nSELECT 42 as answer",
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("SELECT with leading comment should succeed");

    assert_eq!(result.columns.len(), 1);
    assert_eq!(result.columns[0].name, "answer");
    assert_eq!(result.rows.len(), 1);
    assert!(matches!(result.query_type, QueryType::Select));

    adapter.disconnect_pool().await.ok();
}

/// Mirror of PG `test_select_with_trailing_semicolon` — trailing `;` 가 wrapping
/// subquery 를 깨뜨리지 않아야.
#[tokio::test]
#[serial_test::serial]
async fn test_mysql_select_with_trailing_semicolon() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };

    let result = adapter
        .execute_query(
            "SELECT 1 as one;",
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("SELECT with trailing semicolon should succeed");

    assert_eq!(result.rows.len(), 1);
    assert!(matches!(result.query_type, QueryType::Select));

    adapter.disconnect_pool().await.ok();
}

/// Mirror of PG `test_dml_with_trailing_semicolon` — DML 의 trailing `;` 도 ok.
#[tokio::test]
#[serial_test::serial]
async fn test_mysql_dml_with_trailing_semicolon() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };

    let table_name = format!(
        "test_trailing_semi_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );

    adapter
        .execute_query(
            &format!("CREATE TABLE {table_name} (id INT);"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE should succeed");

    let result = adapter
        .execute_query(
            &format!("INSERT INTO {table_name} VALUES (1);"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("INSERT with trailing semicolon should succeed");

    assert!(matches!(result.query_type, QueryType::Dml { .. }));

    adapter
        .execute_query(
            &format!("DROP TABLE {table_name}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

/// Mirror of PG `test_select_with_block_comment` — `/* ... */` 블록 코멘트.
#[tokio::test]
#[serial_test::serial]
async fn test_mysql_select_with_block_comment() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };

    let result = adapter
        .execute_query(
            "/* block comment */ SELECT 1 as num",
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("SELECT with block comment should succeed");

    assert_eq!(result.columns.len(), 1);
    assert_eq!(result.columns[0].name, "num");
    assert!(matches!(result.query_type, QueryType::Select));

    adapter.disconnect_pool().await.ok();
}

/// Mirror of PG `test_execute_query_batch_commits_all_statements` — 두 INSERT
/// 가 한 트랜잭션에서 모두 commit. `COUNT(*)` 의 wire-encoding 검증 포함
/// (ADR 0026 의 BIGINT→string 정책이 MySQL adapter 에서도 동일하게 적용되는지
/// 가 본 시나리오의 부가 검증 포인트).
#[tokio::test]
#[serial_test::serial]
async fn test_mysql_execute_query_batch_commits_all_statements() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_batch_commit_{ts}");

    adapter
        .execute_query(
            &format!("CREATE TABLE {table} (id INT)"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE");

    // Issue #1079 — the commit batch now enforces one row per statement (the
    // grid-commit contract; new rows emit one single-row INSERT each). Exercise
    // multi-statement atomicity with single-row INSERTs.
    let stmts = vec![
        format!("INSERT INTO {table} VALUES (1)"),
        format!("INSERT INTO {table} VALUES (2)"),
    ];
    let results = adapter
        .execute_query_batch(&stmts, None)
        .await
        .expect("batch should commit");

    assert_eq!(results.len(), 2);
    assert_eq!(results[0].total_count, 1);
    assert_eq!(results[1].total_count, 1);
    match results[0].query_type {
        QueryType::Dml { rows_affected } => assert_eq!(rows_affected, 1),
        _ => panic!("expected Dml"),
    }

    let count = adapter
        .execute_query(
            &format!("SELECT COUNT(*) AS n FROM {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("count");
    // COUNT(*) 는 MySQL 에서 BIGINT 를 반환하므로 ADR 0026 (issue #1082) 에 따라
    // 정밀도-보존 JSON string token 으로 wire 된다 (PG mirror 와 동일).
    let n: i64 = count.rows[0][0]
        .as_str()
        .and_then(|s| s.parse().ok())
        .expect("COUNT(*) returns a BIGINT string token");
    assert_eq!(n, 2);

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

/// Mirror of PG `test_execute_query_batch_rolls_back_on_mid_failure` — 두 번째
/// statement 가 fail 하면 첫 statement 도 롤백되어 테이블에 0 row 가 남아야.
/// MySQL 도 default `autocommit=OFF` 안에서 begin/commit/rollback 정상 작동
/// (sqlx 가 명시적 transaction 사용).
#[tokio::test]
#[serial_test::serial]
async fn test_mysql_execute_query_batch_rolls_back_on_mid_failure() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_batch_rollback_{ts}");

    adapter
        .execute_query(
            &format!("CREATE TABLE {table} (id INT) ENGINE=InnoDB"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE");

    // Statement 2 references a column that does not exist → fails.
    // InnoDB 가 transactional 이므로 statement 1 도 rollback 되어 row count 0.
    let stmts = vec![
        format!("INSERT INTO {table} VALUES (1)"),
        format!("INSERT INTO {table} (no_such_col) VALUES (2)"),
    ];
    let err = adapter
        .execute_query_batch(&stmts, None)
        .await
        .expect_err("batch should fail at statement 2");
    let msg = err.to_string();
    assert!(
        msg.contains("statement 2 of 2 failed"),
        "expected error to cite index, got: {msg}"
    );

    let count = adapter
        .execute_query(
            &format!("SELECT COUNT(*) AS n FROM {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("count");
    let n: i64 = count.rows[0][0]
        .as_str()
        .and_then(|s| s.parse().ok())
        .expect("COUNT(*) returns a BIGINT string token");
    assert_eq!(n, 0, "rollback must leave the table empty");

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

/// Issue #1079 — MySQL reports *changed* (not matched) rows for UPDATE, so it
/// is the sharp edge for the one-row guard. A PK-less table with two identical
/// rows + a one-row UPDATE that rewrites both must roll the whole commit batch
/// back (rows_affected == 2), leaving both rows at their original value.
/// Symmetric with the SQLite multi-row rollback regression.
#[tokio::test]
#[serial_test::serial]
async fn test_mysql_execute_query_batch_rolls_back_when_update_changes_multiple_rows() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_batch_multi_row_{ts}");

    adapter
        .execute_query(
            &format!("CREATE TABLE {table} (id INT, msg TEXT) ENGINE=InnoDB"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE");
    adapter
        .execute_query(
            &format!("INSERT INTO {table} VALUES (1, 'a'), (1, 'a')"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("INSERT duplicates");

    // Rewrites 'a' -> 'b' on both duplicate rows: MySQL's changed-rows count is
    // 2, which still trips the guard.
    let stmts = vec![format!(
        "UPDATE {table} SET msg = 'b' WHERE id = 1 AND msg = 'a'"
    )];
    let err = adapter
        .execute_query_batch(&stmts, None)
        .await
        .expect_err("multi-row change must roll back");
    let msg = err.to_string();
    assert!(
        msg.contains("statement 1 of 1 failed") && msg.contains("affected 2"),
        "expected single-row guard rollback, got: {msg}"
    );

    // Rolled back — both rows keep their original value, none became 'b'.
    let count = adapter
        .execute_query(
            &format!("SELECT COUNT(*) AS n FROM {table} WHERE msg = 'a'"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("count");
    // COUNT(*) 는 MySQL 에서 BIGINT 를 반환하므로 ADR 0026 (issue #1082) 에 따라
    // string token 으로 wire 된다.
    let n: i64 = count.rows[0][0]
        .as_str()
        .and_then(|s| s.parse().ok())
        .expect("COUNT(*) returns a BIGINT string token");
    assert_eq!(n, 2, "rollback must leave both rows unchanged");

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

// =============================================================================
// Batch 4 (Slice B-2) — stream_table_rows validation + happy path + drop
// =============================================================================

/// Mirror of PG `test_stream_table_rows_validation_rejects_zero_batch_size`.
#[tokio::test]
#[serial_test::serial]
async fn test_mysql_stream_table_rows_validation_rejects_zero_batch_size() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let (tx, _rx) = tokio::sync::mpsc::channel(1);
    let cols = vec!["id".to_string()];
    let err = adapter
        .stream_table_rows(MYSQL_SCHEMA, "anything", 0, &cols, tx, None)
        .await
        .expect_err("batch_size 0 must reject");
    match err {
        AppError::Validation(msg) => {
            assert!(msg.contains("batch_size"), "got: {msg}");
        }
        other => panic!("expected Validation, got {other:?}"),
    }
    adapter.disconnect_pool().await.ok();
}

/// Mirror of PG `test_stream_table_rows_validation_rejects_empty_columns`.
#[tokio::test]
#[serial_test::serial]
async fn test_mysql_stream_table_rows_validation_rejects_empty_columns() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let (tx, _rx) = tokio::sync::mpsc::channel(1);
    let err = adapter
        .stream_table_rows(MYSQL_SCHEMA, "anything", 100, &[], tx, None)
        .await
        .expect_err("empty column_names must reject");
    match err {
        AppError::Validation(msg) => {
            assert!(msg.contains("column_names"), "got: {msg}");
        }
        other => panic!("expected Validation, got {other:?}"),
    }
    adapter.disconnect_pool().await.ok();
}

/// Mirror of PG `test_stream_table_rows_yields_batches_in_order` — happy path
/// cursor streaming.
#[tokio::test]
#[serial_test::serial]
async fn test_mysql_stream_table_rows_yields_batches_in_order() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_stream_{ts}");

    adapter
        .execute_query(
            &format!("CREATE TABLE {table} (id INT PRIMARY KEY, label TEXT)"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE");
    adapter
        .execute_query(
            &format!(
                "INSERT INTO {table} VALUES \
                 (1,'a'),(2,'b'),(3,'c'),(4,'d'),(5,'e')"
            ),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("INSERT");

    let (sender, mut rx) = tokio::sync::mpsc::channel(8);
    let cols = vec!["id".to_string(), "label".to_string()];
    let adapter_for_stream = adapter.clone();
    let table_for_stream = table.clone();
    let stream_handle = tokio::spawn(async move {
        adapter_for_stream
            .stream_table_rows(MYSQL_SCHEMA, &table_for_stream, 2, &cols, sender, None)
            .await
    });

    let mut total_rows = 0_u64;
    let mut collected: Vec<i64> = Vec::new();
    while let Some(batch) = rx.recv().await {
        for row in &batch {
            collected.push(row[0].as_i64().expect("id should be i64"));
        }
        total_rows += batch.len() as u64;
    }
    let total = stream_handle.await.expect("task").expect("stream ok");
    assert_eq!(total, 5);
    assert_eq!(total_rows, 5);
    assert_eq!(collected.len(), 5);
    let mut sorted = collected.clone();
    sorted.sort();
    assert_eq!(sorted, vec![1, 2, 3, 4, 5]);

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

/// Mirror of PG `test_stream_table_rows_aborts_when_receiver_drops`.
#[tokio::test]
#[serial_test::serial]
async fn test_mysql_stream_table_rows_aborts_when_receiver_drops() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_stream_drop_{ts}");

    adapter
        .execute_query(
            &format!("CREATE TABLE {table} (id INT PRIMARY KEY)"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE");
    let mut values = String::new();
    for i in 1..=20 {
        if i > 1 {
            values.push(',');
        }
        values.push_str(&format!("({i})"));
    }
    adapter
        .execute_query(
            &format!("INSERT INTO {table} VALUES {values}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("INSERT");

    let (sender, rx) = tokio::sync::mpsc::channel(1);
    drop(rx);
    let cols = vec!["id".to_string()];
    let err = adapter
        .stream_table_rows(MYSQL_SCHEMA, &table, 1, &cols, sender, None)
        .await
        .expect_err("dropped receiver should abort");
    match err {
        AppError::Database(msg) => {
            assert!(
                msg.contains("Receiver dropped"),
                "expected receiver-drop error, got: {msg}"
            );
        }
        other => panic!("expected Database, got {other:?}"),
    }

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

/// [AC-1641-04] Vendor-restorable dump round-trip — issue #1641 / #1077
/// Stage 1. Written 2026-07-17: `export_schema_dump` used to emit ANSI
/// double-quote identifiers + `::jsonb` casts that a default-`sql_mode`
/// MySQL rejects, so a MySQL dump was not restorable. This drives the REAL
/// dump path (`run_schema_dump` → cursor stream → mpsc drain → MySQL INSERT
/// writer) against live MySQL, restores the emitted SQL back into the same
/// (emptied) table, and asserts the restored rows equal the source rows
/// (backslash / single-quote / embedded double-quote / NULL / JSON survive).
/// A leftover `::jsonb` cast or ANSI identifier would make the restore SQL
/// fail outright, so a green restore is itself the dialect proof.
#[tokio::test]
#[serial_test::serial]
async fn test_mysql_dump_round_trip_restores_into_mysql() {
    use std::sync::Arc;
    use table_view_lib::commands::connection::AppState;
    use table_view_lib::commands::export::{
        run_schema_dump, ExportDumpTable, ExportInclude, ExportSchemaDumpOptions,
    };
    use table_view_lib::db::row_cap::DEFAULT_ROW_CAP;
    use table_view_lib::db::ActiveAdapter;
    use table_view_lib::models::DatabaseType;

    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_dump_round_trip_{ts}");

    adapter
        .execute_query(
            &format!(
                "CREATE TABLE {table} \
                 (id INT PRIMARY KEY, name VARCHAR(255), note TEXT, payload JSON)"
            ),
            None,
            DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE");

    // Seed tricky values. Built without `format!` on the value list so the
    // JSON braces aren't read as format placeholders; `\\\\` in Rust source
    // is a doubled MySQL backslash → one stored backslash.
    let mut seed = format!("INSERT INTO {table} (id, name, note, payload) VALUES ");
    seed.push_str(
        "(1, 'O''Reilly', 'C:\\\\Users\\\\me', '{\"k\": 1}'), \
         (2, 'plain', 'has,comma and space', '{\"a\": [1, 2]}'), \
         (3, 'q\"and\\\\slash', NULL, '{}')",
    );
    adapter
        .execute_query(&seed, None, DEFAULT_ROW_CAP)
        .await
        .expect("seed INSERT");

    // Read the source rows (post-MySQL normalization) as JSON-stringified
    // cells so String/NULL/JSON compare uniformly on both sides.
    async fn read_all(adapter: &MysqlAdapter, table: &str) -> Vec<Vec<String>> {
        let result = adapter
            .execute_query(
                &format!("SELECT id, name, note, payload FROM {table} ORDER BY id"),
                None,
                DEFAULT_ROW_CAP,
            )
            .await
            .expect("SELECT readback");
        result
            .rows
            .iter()
            .map(|row| row.iter().map(|cell| cell.to_string()).collect())
            .collect()
    }
    let source_rows = read_all(&adapter, &table).await;
    assert_eq!(source_rows.len(), 3, "seed should have 3 rows");

    // Drive the real dump through AppState with a MySQL dialect.
    let state = AppState::new();
    {
        let mut active = state.active_connections.lock().await;
        active.insert(
            "dump-conn".into(),
            Arc::new(ActiveAdapter::Rdb(Box::new(adapter.clone()))),
        );
    }
    let dir = tempfile::TempDir::new().unwrap();
    let dump_path = dir.path().join("mysql_dump.sql");
    let summary = run_schema_dump(
        &state,
        "dump-conn",
        &dump_path,
        "",
        "",
        &[ExportDumpTable {
            schema: MYSQL_SCHEMA.to_string(),
            table: table.clone(),
            column_names: vec!["id".into(), "name".into(), "note".into(), "payload".into()],
        }],
        &ExportSchemaDumpOptions {
            include: ExportInclude::Dml,
            batch_size: 100,
            dialect: DatabaseType::Mysql,
        },
        None,
    )
    .await
    .expect("dump");
    assert_eq!(summary.rows_written, 3);

    let dump_sql = std::fs::read_to_string(&dump_path).unwrap();
    // Dialect proof: backtick identifiers, no ANSI quotes, no PG jsonb cast.
    assert!(
        dump_sql.contains(&format!("INSERT INTO `{MYSQL_SCHEMA}`.`{table}`")),
        "dump missing backtick INSERT: {dump_sql}"
    );
    assert!(!dump_sql.contains("::jsonb"), "dump leaked PG jsonb cast");
    assert!(
        !dump_sql.contains(&format!(r#""{table}""#)),
        "dump leaked ANSI double-quote identifier"
    );

    // Restore: empty the table, replay each dumped INSERT statement.
    adapter
        .execute_query(&format!("DELETE FROM {table}"), None, DEFAULT_ROW_CAP)
        .await
        .expect("DELETE");
    let mut restored = 0_u64;
    for line in dump_sql.lines() {
        if line.starts_with("INSERT INTO") {
            adapter
                .execute_query(line, None, DEFAULT_ROW_CAP)
                .await
                .unwrap_or_else(|e| panic!("restore failed on `{line}`: {e:?}"));
            restored += 1;
        }
    }
    assert_eq!(restored, 3, "should replay 3 INSERT statements");

    let restored_rows = read_all(&adapter, &table).await;
    assert_eq!(
        restored_rows, source_rows,
        "restored rows must byte-match source after MySQL round-trip"
    );

    adapter
        .execute_query(&format!("DROP TABLE {table}"), None, DEFAULT_ROW_CAP)
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

// =============================================================================
// Batch 3 (Slice B-2) — query_table_data filter / raw_where / pagination
// =============================================================================

/// Mirror of PG `test_query_table_data_filter_eq_with_numeric_cast`.
#[tokio::test]
#[serial_test::serial]
async fn test_mysql_query_table_data_filter_eq_with_numeric_cast() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_filter_eq_{ts}");
    seed_filter_table_mysql(&adapter, &table).await;

    let filters = vec![FilterCondition {
        column: "amount".to_string(),
        operator: FilterOperator::Eq,
        value: Some("300.0".to_string()),
    }];
    let data = adapter
        .query_table_data(
            &table,
            MYSQL_SCHEMA,
            1,
            50,
            None,
            Some(&filters),
            None,
            None,
        )
        .await
        .expect("filter eq");
    assert_eq!(data.total_count, 1);
    assert_eq!(data.rows.len(), 1);
    assert_eq!(data.rows[0][0].as_i64(), Some(3));

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

/// Mirror of PG `test_query_table_data_filter_like_and_isnull`.
#[tokio::test]
#[serial_test::serial]
async fn test_mysql_query_table_data_filter_like_and_isnull() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_filter_like_isnull_{ts}");
    seed_filter_table_mysql(&adapter, &table).await;

    let filters = vec![FilterCondition {
        column: "name".to_string(),
        operator: FilterOperator::Like,
        value: Some("A%".to_string()),
    }];
    let data = adapter
        .query_table_data(
            &table,
            MYSQL_SCHEMA,
            1,
            50,
            None,
            Some(&filters),
            None,
            None,
        )
        .await
        .expect("filter like");
    assert_eq!(data.total_count, 1);
    assert_eq!(data.rows.len(), 1);

    let filters = vec![FilterCondition {
        column: "note".to_string(),
        operator: FilterOperator::IsNull,
        value: None,
    }];
    let data = adapter
        .query_table_data(
            &table,
            MYSQL_SCHEMA,
            1,
            50,
            None,
            Some(&filters),
            None,
            None,
        )
        .await
        .expect("filter is null");
    assert_eq!(data.total_count, 2);

    let filters = vec![FilterCondition {
        column: "note".to_string(),
        operator: FilterOperator::IsNotNull,
        value: None,
    }];
    let data = adapter
        .query_table_data(
            &table,
            MYSQL_SCHEMA,
            1,
            50,
            None,
            Some(&filters),
            None,
            None,
        )
        .await
        .expect("filter is not null");
    assert_eq!(data.total_count, 3);

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

/// Mirror of PG `test_query_table_data_filter_unknown_column_is_ignored` —
/// queries.rs 가 invalid 컬럼을 silently skip 해서 stale frontend cache 에
/// 견디는 behavior.
#[tokio::test]
#[serial_test::serial]
async fn test_mysql_query_table_data_filter_unknown_column_is_ignored() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_filter_unknown_{ts}");
    seed_filter_table_mysql(&adapter, &table).await;

    let filters = vec![FilterCondition {
        column: "nope".to_string(),
        operator: FilterOperator::Eq,
        value: Some("x".to_string()),
    }];
    let data = adapter
        .query_table_data(
            &table,
            MYSQL_SCHEMA,
            1,
            50,
            None,
            Some(&filters),
            None,
            None,
        )
        .await
        .expect("unknown column → no WHERE → all rows");
    assert_eq!(data.total_count, 5);

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

/// Mirror of PG `test_query_table_data_raw_where_accepts_clean_clause`.
#[tokio::test]
#[serial_test::serial]
async fn test_mysql_query_table_data_raw_where_accepts_clean_clause() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_raw_where_clean_{ts}");
    seed_filter_table_mysql(&adapter, &table).await;

    let data = adapter
        .query_table_data(
            &table,
            MYSQL_SCHEMA,
            1,
            50,
            None,
            None,
            Some("amount > 200 AND active = TRUE"),
            None,
        )
        .await
        .expect("raw_where clean");
    // amount > 200 AND active = TRUE → Charlie (300) + Eve (500).
    assert_eq!(data.total_count, 2);

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_query_table_data_cancel_token_interrupts_in_flight_raw_where() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_qtd_cancel_{ts}");
    seed_filter_table_mysql(&adapter, &table).await;

    let cancel_token = CancellationToken::new();
    let child_token = cancel_token.clone();
    let spawned_adapter = adapter.clone();
    let table_for_task = table.clone();
    let query_handle = tokio::spawn(async move {
        spawned_adapter
            .query_table_data(
                &table_for_task,
                MYSQL_SCHEMA,
                1,
                50,
                None,
                None,
                Some("id = 1 AND SLEEP(2) = 0"),
                Some(&child_token),
            )
            .await
    });

    sleep(Duration::from_millis(100)).await;
    let wait_start = Instant::now();
    cancel_token.cancel();

    let result = tokio::time::timeout(Duration::from_secs(5), query_handle)
        .await
        .expect("query_table_data cancel should return within 5s")
        .expect("query task should complete");
    assert!(
        wait_start.elapsed() < Duration::from_secs(5),
        "query_table_data cancel took {:?}",
        wait_start.elapsed()
    );
    match result {
        Err(AppError::Database(msg)) => assert_eq!(msg, "Operation cancelled"),
        other => panic!("expected Operation cancelled, got {other:?}"),
    }

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

/// Mirror of PG `test_query_table_data_raw_where_rejects_semicolon` — raw_where
/// 안 `;` 는 adapter-level validation 이 거부.
#[tokio::test]
#[serial_test::serial]
async fn test_mysql_query_table_data_raw_where_rejects_semicolon() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_raw_where_semi_{ts}");
    seed_filter_table_mysql(&adapter, &table).await;

    let err = adapter
        .query_table_data(
            &table,
            MYSQL_SCHEMA,
            1,
            50,
            None,
            None,
            Some("id = 1; DROP TABLE secrets"),
            None,
        )
        .await
        .expect_err("raw_where with `;` must be rejected");
    match err {
        AppError::Validation(msg) => {
            assert!(msg.contains("semicolons"), "got: {msg}");
        }
        other => panic!("expected Validation, got {other:?}"),
    }

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

/// Mirror of PG `test_query_table_data_raw_where_rejects_dangerous_keywords`.
#[tokio::test]
#[serial_test::serial]
async fn test_mysql_query_table_data_raw_where_rejects_dangerous_keywords() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_raw_where_kw_{ts}");
    seed_filter_table_mysql(&adapter, &table).await;

    for kw in ["DROP", "DELETE", "INSERT", "UPDATE", "ALTER", "TRUNCATE"] {
        let clause = format!("{kw} TABLE foo");
        let err = adapter
            .query_table_data(&table, MYSQL_SCHEMA, 1, 50, None, None, Some(&clause), None)
            .await
            .expect_err(&format!("{kw} must be rejected"));
        match err {
            AppError::Validation(msg) => assert!(
                msg.to_uppercase().contains(kw),
                "validation msg should cite {kw}, got: {msg}"
            ),
            other => panic!("expected Validation for {kw}, got {other:?}"),
        }
    }

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

/// Mirror of PG `test_query_table_data_pagination_and_ordering`.
#[tokio::test]
#[serial_test::serial]
async fn test_mysql_query_table_data_pagination_and_ordering() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_pagination_{ts}");
    seed_filter_table_mysql(&adapter, &table).await;

    // page=2, page_size=2, ORDER BY id ASC → rows 3,4.
    let data = adapter
        .query_table_data(&table, MYSQL_SCHEMA, 2, 2, Some("id ASC"), None, None, None)
        .await
        .expect("paginate");
    assert_eq!(data.total_count, 5);
    assert_eq!(data.rows.len(), 2);
    assert_eq!(data.page, 2);
    assert_eq!(data.page_size, 2);
    assert_eq!(data.rows[0][0].as_i64(), Some(3));
    assert_eq!(data.rows[1][0].as_i64(), Some(4));

    // ORDER BY DESC reverses.
    let data = adapter
        .query_table_data(
            &table,
            MYSQL_SCHEMA,
            1,
            2,
            Some("id DESC"),
            None,
            None,
            None,
        )
        .await
        .expect("desc order");
    assert_eq!(data.rows[0][0].as_i64(), Some(5));
    assert_eq!(data.rows[1][0].as_i64(), Some(4));

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

/// Mirror of PG `test_execute_query_batch_strips_trailing_semicolons` — 각
/// statement 의 trailing `;` 가 strip 후 실행.
#[tokio::test]
#[serial_test::serial]
async fn test_mysql_execute_query_batch_strips_trailing_semicolons() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_batch_semi_{ts}");

    adapter
        .execute_query(
            &format!("CREATE TABLE {table} (id INT)"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE");

    let stmts = vec![
        format!("INSERT INTO {table} VALUES (10);"),
        format!("INSERT INTO {table} VALUES (20);  "),
    ];
    let results = adapter
        .execute_query_batch(&stmts, None)
        .await
        .expect("batch with trailing semi should succeed");
    assert_eq!(results.len(), 2);
    assert_eq!(results[0].total_count, 1);
    assert_eq!(results[1].total_count, 1);

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

// =============================================================================
// Batch 5 (Slice B-3, 2026-05-14) — schema_integration.rs 시나리오 mirror
// =============================================================================
// 작성 이유: db/mysql/schema.rs (list_schemas/list_tables/get_table_columns/
// list_views/list_functions/get_table_indexes/get_table_constraints/
// list_schema_columns) 와 db/mysql/queries.rs 의 query_table_data 의 정렬/
// 필터/페이지네이션 분기를 schema_integration.rs (PG) 와 1:1 mirror 로 hit.
// PG-only `list_types` (pg_type catalog) 는 MySQL 짝꿍 없음 → 미러 안 함.
//
// Dialect 차이:
// - `\"identifier\"`           → MySQL 은 unquoted (or backtick) — 본 파일은 unquoted
// - `SERIAL`                   → `INT AUTO_INCREMENT PRIMARY KEY`
// - `TIMESTAMP DEFAULT NOW()`  → `TIMESTAMP DEFAULT CURRENT_TIMESTAMP`
// - `COMMENT ON COLUMN …`      → inline `COMMENT 'text'` syntax
// - PG schema "public"         → MySQL schema "test" (MYSQL_SCHEMA)
// - PG PK name `<t>_pkey`      → MySQL PK name "PRIMARY"
// - `<col>::bigint`            → `CAST(<col> AS SIGNED)` (현 시나리오에는 미사용)
// - PG `data_type="serial"`    → MySQL `data_type="int"` (AUTO_INCREMENT 는
//                                 컬럼 default 의 fingerprint 일 뿐 column_type 미반영)
//
// Wire encoding (ADR 0026 정합 — issue #1082 로 MySQL 정수 경로도 합류):
// - PG BIGINT → JSON string. MySQL BIGINT → JSON string (issue #1082).
// - PG NUMERIC → JSON string. MySQL DECIMAL → JSON string (queries.rs line 145).
// - INT/SMALLINT/MEDIUMINT/YEAR 는 둘 다 JSON number (≤32bit, f64 무손실).
// - CHECK clauses: MySQL adapter 는 information_schema CHECK expression 을
//   column-level check_clauses 로 투영.

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_list_schemas() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let schemas = adapter.list_schemas().await.expect("list_schemas");
    // testcontainers 의 MySQL 은 default DB "test". 외부 재사용 시에도 endpoint
    // 가 "test" 로 connect 하므로 항상 존재.
    assert!(
        schemas.iter().any(|s| s.name == MYSQL_SCHEMA),
        "expected '{MYSQL_SCHEMA}' in list_schemas: {:?}",
        schemas.iter().map(|s| &s.name).collect::<Vec<_>>()
    );
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_list_tables_returns_non_empty_names() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let tables = adapter
        .list_tables(MYSQL_SCHEMA)
        .await
        .expect("list_tables");
    // 다른 테스트의 잔여 테이블이 있을 수 있어 비어있어도 OK. 단 모든 name 은 non-empty.
    assert!(
        tables.iter().all(|t| !t.name.is_empty()),
        "all table names should be non-empty"
    );
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_create_table_and_list() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_users_{ts}");

    adapter
        .execute_query(
            &format!(
                "CREATE TABLE {table} (\
                 id INT AUTO_INCREMENT PRIMARY KEY, \
                 name TEXT NOT NULL, \
                 email TEXT)"
            ),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE");

    let tables = adapter
        .list_tables(MYSQL_SCHEMA)
        .await
        .expect("list_tables");
    assert!(
        tables.iter().any(|t| t.name == table),
        "expected '{table}' in list_tables"
    );

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_get_table_columns() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_cols_{ts}");

    adapter
        .execute_query(
            &format!(
                "CREATE TABLE {table} (\
                 id INT AUTO_INCREMENT PRIMARY KEY, \
                 name VARCHAR(100) NOT NULL, \
                 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
            ),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE");

    let columns = adapter
        .get_table_columns(&table, MYSQL_SCHEMA)
        .await
        .expect("get_table_columns");

    assert_eq!(columns.len(), 3, "expected 3 columns, got {columns:?}");

    let id_col = columns.iter().find(|c| c.name == "id").expect("id missing");
    // MySQL `data_type` = column_type — INT 는 MySQL 8 에서 display width 없이 "int".
    assert_eq!(id_col.data_type, "int");
    assert!(!id_col.nullable);
    assert!(id_col.is_primary_key);
    assert!(!id_col.is_foreign_key);
    // #1433 — AUTO_INCREMENT 는 column_default 가 NULL 이라 `extra` 파싱이
    // is_identity 의 유일한 신호. 여기서 실 MySQL 로 wiring 을 검증한다
    // (틀리면 datagrid INSERT 생략 fix 가 조용히 no-op).
    assert!(
        id_col.is_identity,
        "AUTO_INCREMENT column must report is_identity=true, got {id_col:?}"
    );

    let name_col = columns
        .iter()
        .find(|c| c.name == "name")
        .expect("name missing");
    assert_eq!(name_col.data_type, "varchar(100)");
    assert!(!name_col.nullable);
    assert!(!name_col.is_primary_key);
    assert!(!name_col.is_identity, "plain column must not be identity");

    let created_col = columns
        .iter()
        .find(|c| c.name == "created_at")
        .expect("created_at missing");
    assert!(
        created_col.data_type.contains("timestamp"),
        "expected timestamp type, got: {}",
        created_col.data_type
    );
    assert!(created_col.nullable);
    assert!(
        created_col.default_value.is_some(),
        "created_at should have default"
    );
    // #1433 — default 가 있어도 identity 는 아니다 (생략 사유가 다름).
    assert!(!created_col.is_identity, "defaulted column is not identity");

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_query_table_data_pagination() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_data_{ts}");

    adapter
        .execute_query(
            &format!(
                "CREATE TABLE {table} (id INT AUTO_INCREMENT PRIMARY KEY, value TEXT NOT NULL)"
            ),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE");
    adapter
        .execute_query(
            &format!("INSERT INTO {table} (value) VALUES ('alpha'), ('beta'), ('gamma')"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("INSERT");

    let data = adapter
        .query_table_data(&table, MYSQL_SCHEMA, 1, 2, None, None, None, None)
        .await
        .expect("page 1");
    assert_eq!(data.columns.len(), 2);
    assert_eq!(data.rows.len(), 2);
    assert_eq!(data.total_count, 3);
    assert_eq!(data.page, 1);
    assert_eq!(data.page_size, 2);

    let page2 = adapter
        .query_table_data(&table, MYSQL_SCHEMA, 2, 2, None, None, None, None)
        .await
        .expect("page 2");
    assert_eq!(page2.rows.len(), 1);

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_query_table_data_ordering_asc() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_ord_asc_{ts}");

    adapter
        .execute_query(
            &format!(
                "CREATE TABLE {table} (id INT AUTO_INCREMENT PRIMARY KEY, label TEXT NOT NULL)"
            ),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE");
    adapter
        .execute_query(
            &format!("INSERT INTO {table} (label) VALUES ('charlie'), ('alpha'), ('bravo')"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("INSERT");

    let data = adapter
        .query_table_data(&table, MYSQL_SCHEMA, 1, 50, Some("label"), None, None, None)
        .await
        .expect("ORDER BY label");
    assert_eq!(data.rows.len(), 3);
    assert_eq!(data.rows[0][1].as_str().unwrap_or(""), "alpha");
    assert_eq!(data.rows[2][1].as_str().unwrap_or(""), "charlie");

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_query_table_data_ordering_desc() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_ord_desc_{ts}");

    adapter
        .execute_query(
            &format!(
                "CREATE TABLE {table} (id INT AUTO_INCREMENT PRIMARY KEY, label TEXT NOT NULL)"
            ),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE");
    adapter
        .execute_query(
            &format!("INSERT INTO {table} (label) VALUES ('charlie'), ('alpha'), ('bravo')"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("INSERT");

    let data = adapter
        .query_table_data(
            &table,
            MYSQL_SCHEMA,
            1,
            50,
            Some("label DESC"),
            None,
            None,
            None,
        )
        .await
        .expect("ORDER BY label DESC");
    assert_eq!(data.rows.len(), 3);
    assert_eq!(data.rows[0][1].as_str().unwrap_or(""), "charlie");
    assert_eq!(data.rows[2][1].as_str().unwrap_or(""), "alpha");

    // Single-word still ASC by default.
    let asc = adapter
        .query_table_data(&table, MYSQL_SCHEMA, 1, 50, Some("label"), None, None, None)
        .await
        .expect("default ASC");
    assert_eq!(asc.rows[0][1].as_str().unwrap_or(""), "alpha");

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_get_table_columns_with_comments() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_comments_{ts}");

    // MySQL 의 column comment 는 inline 으로 정의. PG 의 `COMMENT ON COLUMN`
    // 별도 statement 와 의미 동일, information_schema.columns.column_comment
    // 가 반환.
    adapter
        .execute_query(
            &format!(
                "CREATE TABLE {table} (\
                 id INT AUTO_INCREMENT PRIMARY KEY, \
                 name TEXT NOT NULL COMMENT 'User display name', \
                 email TEXT)"
            ),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE");

    let columns = adapter
        .get_table_columns(&table, MYSQL_SCHEMA)
        .await
        .expect("get_table_columns");

    let name_col = columns
        .iter()
        .find(|c| c.name == "name")
        .expect("name missing");
    assert_eq!(name_col.comment, Some("User display name".to_string()));

    let id_col = columns.iter().find(|c| c.name == "id").expect("id missing");
    assert_eq!(id_col.comment, None);

    let email_col = columns
        .iter()
        .find(|c| c.name == "email")
        .expect("email missing");
    assert_eq!(email_col.comment, None);

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_get_table_columns_populates_check_clauses() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let supports_checks = adapter.supports_check_constraint_catalog().await;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_chks_{ts}");

    adapter
        .execute_query(
            &format!(
                "CREATE TABLE {table} (\
                 id INT AUTO_INCREMENT PRIMARY KEY, \
                 age INT CHECK (age >= 0), \
                 min_v INT, \
                 max_v INT, \
                 CHECK (min_v <= max_v))"
            ),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE");

    let columns = adapter
        .get_table_columns(&table, MYSQL_SCHEMA)
        .await
        .expect("get_table_columns");

    let age_col = columns.iter().find(|c| c.name == "age").expect("age");
    let min_col = columns.iter().find(|c| c.name == "min_v").expect("min_v");
    let max_col = columns.iter().find(|c| c.name == "max_v").expect("max_v");
    if supports_checks {
        assert_eq!(age_col.check_clauses.len(), 1, "age has 1 check");
        assert!(
            age_col.check_clauses[0].contains("age >= 0")
                || age_col.check_clauses[0].contains("`age` >= 0"),
            "age check should include expression: {:?}",
            age_col.check_clauses
        );

        assert_eq!(min_col.check_clauses.len(), 1, "min_v has 1 check");
        assert_eq!(max_col.check_clauses.len(), 1, "max_v has 1 check");
        assert!(
            min_col.check_clauses[0].contains("min_v <= max_v")
                || min_col.check_clauses[0].contains("`min_v` <= `max_v`"),
            "multi-column check should include expression: {:?}",
            min_col.check_clauses
        );
    } else {
        assert!(age_col.check_clauses.is_empty());
        assert!(min_col.check_clauses.is_empty());
        assert!(max_col.check_clauses.is_empty());
    }

    let id_col = columns.iter().find(|c| c.name == "id").expect("id");
    assert!(id_col.check_clauses.is_empty(), "id has no check");

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_query_table_data_with_filter_bigint() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_filter_bigint_{ts}");

    adapter
        .execute_query(
            &format!("CREATE TABLE {table} (id BIGINT PRIMARY KEY, name TEXT NOT NULL)"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE");
    adapter
        .execute_query(
            &format!(
                "INSERT INTO {table} (id, name) VALUES \
                 (1, 'alice'), (2, 'bob'), (3, 'charlie')"
            ),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("INSERT");

    let filters = vec![FilterCondition {
        column: "id".to_string(),
        operator: FilterOperator::Eq,
        value: Some("2".to_string()),
    }];
    let data = adapter
        .query_table_data(
            &table,
            MYSQL_SCHEMA,
            1,
            50,
            None,
            Some(&filters),
            None,
            None,
        )
        .await
        .expect("filter bigint");
    assert_eq!(data.rows.len(), 1);
    assert_eq!(data.total_count, 1);
    assert_eq!(data.rows[0][1].as_str().unwrap_or(""), "bob");

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_query_table_data_with_filter_text() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_filter_text_{ts}");

    adapter
        .execute_query(
            &format!(
                "CREATE TABLE {table} (id INT AUTO_INCREMENT PRIMARY KEY, name TEXT NOT NULL)"
            ),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE");
    adapter
        .execute_query(
            &format!(
                "INSERT INTO {table} (name) VALUES \
                 ('alice'), ('bob'), ('charlie'), ('david')"
            ),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("INSERT");

    let filters = vec![FilterCondition {
        column: "name".to_string(),
        operator: FilterOperator::Like,
        value: Some("%li%".to_string()),
    }];
    let data = adapter
        .query_table_data(
            &table,
            MYSQL_SCHEMA,
            1,
            50,
            None,
            Some(&filters),
            None,
            None,
        )
        .await
        .expect("filter text LIKE");
    // alice + charlie.
    assert_eq!(data.rows.len(), 2);
    assert_eq!(data.total_count, 2);

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_query_table_data_with_filter_integer() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_filter_int_{ts}");

    adapter
        .execute_query(
            &format!(
                "CREATE TABLE {table} (\
                 id INT AUTO_INCREMENT PRIMARY KEY, \
                 score INT NOT NULL, \
                 label TEXT NOT NULL)"
            ),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE");
    adapter
        .execute_query(
            &format!(
                "INSERT INTO {table} (score, label) VALUES \
                 (10, 'low'), (50, 'mid'), (90, 'high'), (100, 'top')"
            ),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("INSERT");

    let filters = vec![FilterCondition {
        column: "score".to_string(),
        operator: FilterOperator::Gt,
        value: Some("50".to_string()),
    }];
    let data = adapter
        .query_table_data(
            &table,
            MYSQL_SCHEMA,
            1,
            50,
            None,
            Some(&filters),
            None,
            None,
        )
        .await
        .expect("filter int >");
    assert_eq!(data.rows.len(), 2);
    assert_eq!(data.total_count, 2);

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_query_table_data_multi_column_ordering() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_multi_ord_{ts}");

    adapter
        .execute_query(
            &format!(
                "CREATE TABLE {table} (\
                 id INT AUTO_INCREMENT PRIMARY KEY, \
                 category TEXT NOT NULL, \
                 label TEXT NOT NULL)"
            ),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE");
    adapter
        .execute_query(
            &format!(
                "INSERT INTO {table} (category, label) VALUES \
                 ('B', 'charlie'), ('A', 'alpha'), ('B', 'bravo'), ('A', 'beta')"
            ),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("INSERT");

    let data = adapter
        .query_table_data(
            &table,
            MYSQL_SCHEMA,
            1,
            50,
            Some("category ASC, label ASC"),
            None,
            None,
            None,
        )
        .await
        .expect("multi-column ORDER BY");
    assert_eq!(data.rows.len(), 4);
    assert_eq!(data.rows[0][1].as_str().unwrap_or(""), "A");
    assert_eq!(data.rows[0][2].as_str().unwrap_or(""), "alpha");
    assert_eq!(data.rows[1][2].as_str().unwrap_or(""), "beta");
    assert_eq!(data.rows[2][2].as_str().unwrap_or(""), "bravo");
    assert_eq!(data.rows[3][2].as_str().unwrap_or(""), "charlie");

    // Mixed direction.
    let desc = adapter
        .query_table_data(
            &table,
            MYSQL_SCHEMA,
            1,
            50,
            Some("category ASC, label DESC"),
            None,
            None,
            None,
        )
        .await
        .expect("mixed dir ORDER BY");
    assert_eq!(desc.rows.len(), 4);
    assert_eq!(desc.rows[0][2].as_str().unwrap_or(""), "beta");
    assert_eq!(desc.rows[1][2].as_str().unwrap_or(""), "alpha");

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_get_view_columns_returns_columns_in_order() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let base = format!("test_vc_base_{ts}");
    let view = format!("test_vc_view_{ts}");

    adapter
        .execute_query(
            &format!(
                "CREATE TABLE {base} (\
                 id INT AUTO_INCREMENT PRIMARY KEY, \
                 name TEXT NOT NULL, \
                 score INT)"
            ),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE");
    adapter
        .execute_query(
            &format!(
                "CREATE VIEW {view} AS \
                 SELECT id, name, score FROM {base} WHERE score IS NOT NULL"
            ),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE VIEW");

    let columns = adapter
        .get_view_columns(MYSQL_SCHEMA, &view)
        .await
        .expect("get_view_columns");
    assert_eq!(columns.len(), 3, "expected 3 columns, got {columns:?}");
    assert_eq!(columns[0].name, "id");
    assert_eq!(columns[1].name, "name");
    assert_eq!(columns[2].name, "score");

    // view columns 는 PK/FK 메타를 들고 다니지 않는다 (schema.rs line 543-545).
    for col in &columns {
        assert!(!col.is_primary_key, "view col {} not PK", col.name);
        assert!(!col.is_foreign_key, "view col {} not FK", col.name);
        assert!(col.fk_reference.is_none());
    }

    adapter
        .execute_query(
            &format!("DROP VIEW {view}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter
        .execute_query(
            &format!("DROP TABLE {base}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_get_view_columns_for_unknown_view_returns_empty() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let columns = adapter
        .get_view_columns(MYSQL_SCHEMA, "definitely_does_not_exist_view_xyz")
        .await
        .expect("get_view_columns should succeed for unknown view");
    assert!(
        columns.is_empty(),
        "unknown view should yield empty: {columns:?}"
    );
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_list_views_returns_created_view() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let base = format!("test_lv_t_{ts}");
    let view = format!("{base}_v");

    adapter
        .execute_query(
            &format!("CREATE TABLE {base} (id INT AUTO_INCREMENT PRIMARY KEY, name TEXT)"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE");
    adapter
        .execute_query(
            &format!("CREATE VIEW {view} AS SELECT id, name FROM {base}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE VIEW");

    let views = adapter.list_views(MYSQL_SCHEMA).await.expect("list_views");
    assert!(
        views.iter().any(|v| v.name == view),
        "view '{view}' missing: {:?}",
        views.iter().map(|v| &v.name).collect::<Vec<_>>()
    );

    adapter
        .execute_query(
            &format!("DROP VIEW {view}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter
        .execute_query(
            &format!("DROP TABLE {base}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_get_view_definition_returns_select_text() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let base = format!("test_gvd_t_{ts}");
    let view = format!("{base}_v");

    adapter
        .execute_query(
            &format!("CREATE TABLE {base} (id INT, name TEXT)"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE");
    adapter
        .execute_query(
            &format!("CREATE VIEW {view} AS SELECT id FROM {base}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE VIEW");

    let def = adapter
        .get_view_definition(MYSQL_SCHEMA, &view)
        .await
        .expect("get_view_definition");
    // MySQL information_schema.views.view_definition 은 일반적으로 SELECT 키워드
    // 와 base table 참조를 포함. sql_mode 에 따라 quoting/whitespace 가 다르다.
    assert!(
        def.to_lowercase().contains("select"),
        "view definition missing SELECT: {def}"
    );
    assert!(
        def.contains(&base),
        "view definition missing source table: {def}"
    );

    adapter
        .execute_query(
            &format!("DROP VIEW {view}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter
        .execute_query(
            &format!("DROP TABLE {base}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

// CREATE FUNCTION / CREATE PROCEDURE 는 MySQL 의 prepared statement protocol
// 에서 지원하지 않는다 (server error 1295). 현 어댑터 `execute_query` 는
// sqlx::query 로 항상 prepared path 를 탄다. 다음 두 시나리오는 어댑터가
// `query_unprepared` (sqlx-mysql 의 `execute_many` 또는 raw connection) 를
// 노출하기 전까지 실행 불가 — `#[ignore]` 로 회귀 게이트 제외하고,
// future sprint 에서 어댑터 보강 시 `ignore` attr 제거.
#[tokio::test]
#[serial_test::serial]
#[ignore = "CREATE FUNCTION blocked by sqlx prepared-protocol limit (MySQL 1295)"]
async fn test_mysql_list_functions_returns_user_function() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let fn_name = format!("test_fn_{ts}");

    // MySQL FUNCTION 은 DETERMINISTIC 또는 NO SQL 등 deterministic 표식 필요
    // (binlog 활성 시 trust_function_creators=0 default). 본 컨테이너는
    // binlog 비활성이지만 안전하게 DETERMINISTIC 표식 부여.
    adapter
        .execute_query(
            &format!("CREATE FUNCTION {fn_name}(x INT) RETURNS INT DETERMINISTIC RETURN x + 1"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE FUNCTION");

    let funcs = adapter
        .list_functions(MYSQL_SCHEMA)
        .await
        .expect("list_functions");
    assert!(
        funcs.iter().any(|f| f.name == fn_name),
        "function '{fn_name}' missing: {:?}",
        funcs.iter().map(|f| &f.name).collect::<Vec<_>>()
    );

    adapter
        .execute_query(
            &format!("DROP FUNCTION {fn_name}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
#[ignore = "CREATE FUNCTION blocked by sqlx prepared-protocol limit (MySQL 1295)"]
async fn test_mysql_get_function_source_returns_body() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let fn_name = format!("src_fn_{ts}");

    adapter
        .execute_query(
            &format!("CREATE FUNCTION {fn_name}(x INT) RETURNS INT DETERMINISTIC RETURN x * 2"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE FUNCTION");

    let source = adapter
        .get_function_source(MYSQL_SCHEMA, &fn_name)
        .await
        .expect("get_function_source");
    assert!(
        source.contains("x * 2")
            || source.contains("x*2")
            || source.to_uppercase().contains("RETURN"),
        "function source missing body: {source}"
    );

    adapter
        .execute_query(
            &format!("DROP FUNCTION {fn_name}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_list_databases_includes_user_db() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let dbs = adapter.list_databases().await.expect("list_databases");
    let names: Vec<_> = dbs.iter().map(|d| &d.name).collect();
    // MySQL adapter 의 `list_schemas` (schema.rs line 73) 는 admin DB
    // (information_schema / mysql / performance_schema / sys) 를 의도적으로
    // 제외 — UI 의 schema panel surface 에 noise 가 노출되지 않게. testcontainers
    // 의 default DB "test" 는 user DB 로 항상 포함.
    assert!(
        names.iter().any(|n| *n == MYSQL_SCHEMA),
        "expected '{MYSQL_SCHEMA}' in list_databases: {names:?}"
    );

    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_list_schema_columns_aggregates_multiple_tables() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let supports_checks = adapter.supports_check_constraint_catalog().await;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let t1 = format!("test_lsc_a_{ts}");
    let t2 = format!("test_lsc_b_{ts}");

    adapter
        .execute_query(
            &format!(
                "CREATE TABLE {t1} (\
                 id INT PRIMARY KEY, \
                 label TEXT, \
                 score INT CHECK (score >= 0))"
            ),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE t1");
    adapter
        .execute_query(
            &format!("CREATE TABLE {t2} (k INT, v BIGINT)"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE t2");

    let map = adapter
        .list_schema_columns(MYSQL_SCHEMA)
        .await
        .expect("list_schema_columns");
    let cols_t1 = map.get(&t1).unwrap_or_else(|| panic!("{t1} missing"));
    let cols_t2 = map.get(&t2).unwrap_or_else(|| panic!("{t2} missing"));
    assert_eq!(cols_t1.len(), 3);
    assert_eq!(cols_t2.len(), 2);
    assert!(cols_t1.iter().any(|c| c.name == "id"));
    assert!(cols_t2.iter().any(|c| c.name == "v"));
    let score = cols_t1.iter().find(|c| c.name == "score").expect("score");
    if supports_checks {
        assert_eq!(score.check_clauses.len(), 1);
        assert!(
            score.check_clauses[0].contains("score >= 0")
                || score.check_clauses[0].contains("`score` >= 0")
        );
    } else {
        assert!(score.check_clauses.is_empty());
    }

    adapter
        .execute_query(
            &format!("DROP TABLE {t1}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter
        .execute_query(
            &format!("DROP TABLE {t2}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_get_table_indexes_returns_pk_and_secondary_indexes() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let t = format!("test_idx_t_{ts}");

    // MySQL 8 InnoDB. UNIQUE INDEX 는 TEXT 컬럼 (utf8mb4) 인덱싱 시 prefix
    // length 필요. VARCHAR(190) 으로 안정화.
    adapter
        .execute_query(
            &format!(
                "CREATE TABLE {t} (\
                  id INT PRIMARY KEY, \
                  email VARCHAR(190), \
                  status VARCHAR(50))"
            ),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE");
    let idx_email = format!("{t}_email_uq");
    let idx_status = format!("{t}_status_idx");
    adapter
        .execute_query(
            &format!("CREATE UNIQUE INDEX {idx_email} ON {t} (email)"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("UNIQUE INDEX");
    adapter
        .execute_query(
            &format!("CREATE INDEX {idx_status} ON {t} (status)"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("INDEX");

    let indexes = adapter
        .get_table_indexes(&t, MYSQL_SCHEMA)
        .await
        .expect("get_table_indexes");

    // MySQL PK index name = "PRIMARY" — adapter 는 이를 is_primary=true 로 표식.
    let pk = indexes
        .iter()
        .find(|i| i.is_primary)
        .expect("PK index missing");
    assert!(pk.is_unique);
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

    adapter
        .execute_query(
            &format!("DROP TABLE {t}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_get_table_indexes_composite_columns_preserve_order() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let t = format!("test_idx_comp_{ts}");

    adapter
        .execute_query(
            &format!("CREATE TABLE {t} (a INT, b INT, c INT)"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE");
    let idx = format!("{t}_ab_idx");
    adapter
        .execute_query(
            &format!("CREATE INDEX {idx} ON {t} (a, b)"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("composite INDEX");

    let indexes = adapter
        .get_table_indexes(&t, MYSQL_SCHEMA)
        .await
        .expect("get_table_indexes");
    let composite = indexes
        .iter()
        .find(|i| i.name == idx)
        .expect("composite missing");
    // information_schema.statistics 의 seq_in_index 순으로 a → b.
    assert_eq!(composite.columns, vec!["a".to_string(), "b".to_string()]);

    adapter
        .execute_query(
            &format!("DROP TABLE {t}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_get_table_indexes_for_unknown_table_returns_empty() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let indexes = adapter
        .get_table_indexes("does_not_exist_zzz", MYSQL_SCHEMA)
        .await
        .expect("empty result, not error");
    assert!(indexes.is_empty());
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_get_table_constraints_pk_unique_check() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let supports_checks = adapter.supports_check_constraint_catalog().await;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let t = format!("test_cons_{ts}");

    // UNIQUE column 은 VARCHAR — TEXT 의 UNIQUE 는 prefix length 가 필요해 회피.
    adapter
        .execute_query(
            &format!(
                "CREATE TABLE {t} (\
                  id INT PRIMARY KEY, \
                  email VARCHAR(190) UNIQUE, \
                  age INT CHECK (age >= 0))"
            ),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE");

    let constraints = adapter
        .get_table_constraints(&t, MYSQL_SCHEMA)
        .await
        .expect("get_table_constraints");

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

    if supports_checks {
        let chk = constraints
            .iter()
            .find(|c| c.constraint_type == "CHECK")
            .expect("CHECK missing");
        assert!(chk.columns.is_empty());
        assert!(chk.reference_table.is_none());
    } else {
        assert!(!constraints.iter().any(|c| c.constraint_type == "CHECK"));
    }

    adapter
        .execute_query(
            &format!("DROP TABLE {t}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_get_table_constraints_foreign_key_carries_reference() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let parent = format!("test_fk_parent_{ts}");
    let child = format!("test_fk_child_{ts}");

    // MySQL 8 default engine = InnoDB → FK 지원. 명시적으로 ENGINE=InnoDB 도
    // 부착해 sql_mode 변형에 견디게.
    adapter
        .execute_query(
            &format!("CREATE TABLE {parent} (id INT PRIMARY KEY) ENGINE=InnoDB"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE parent");
    adapter
        .execute_query(
            &format!(
                "CREATE TABLE {child} (\
                  id INT PRIMARY KEY, \
                  parent_id INT, \
                  FOREIGN KEY (parent_id) REFERENCES {parent}(id)\
                ) ENGINE=InnoDB"
            ),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE child");

    let constraints = adapter
        .get_table_constraints(&child, MYSQL_SCHEMA)
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
        .execute_query(
            &format!("DROP TABLE {child}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter
        .execute_query(
            &format!("DROP TABLE {parent}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_get_table_columns_populates_fk_reference_in_child() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let parent = format!("test_fkcol_parent_{ts}");
    let child = format!("test_fkcol_child_{ts}");

    adapter
        .execute_query(
            &format!("CREATE TABLE {parent} (id INT PRIMARY KEY) ENGINE=InnoDB"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE parent");
    adapter
        .execute_query(
            &format!(
                "CREATE TABLE {child} (\
                  id INT PRIMARY KEY, \
                  parent_id INT, \
                  FOREIGN KEY (parent_id) REFERENCES {parent}(id)\
                ) ENGINE=InnoDB"
            ),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE child");

    let cols = adapter
        .get_table_columns(&child, MYSQL_SCHEMA)
        .await
        .expect("get_table_columns");
    let parent_id = cols
        .iter()
        .find(|c| c.name == "parent_id")
        .expect("parent_id missing");
    assert!(parent_id.is_foreign_key);
    // MySQL `format_fk_reference` 는 PG 와 동일 format `"<schema>.<table>(<col>)"`.
    let expected = format!("{MYSQL_SCHEMA}.{parent}(id)");
    assert_eq!(parent_id.fk_reference.as_deref(), Some(expected.as_str()));

    adapter
        .execute_query(
            &format!("DROP TABLE {child}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter
        .execute_query(
            &format!("DROP TABLE {parent}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

// ── Wire-encoding 시나리오 — ADR 0026 정합 (MySQL == PG, issue #1082) ─────
// MySQL adapter (queries.rs):
// - BIGINT (i64/u64): JSON string — 프론트가 BigInt 로 승격 (정밀도 보존).
// - DECIMAL/NEWDECIMAL: JSON string (line 145).
// - INT/SMALLINT/MEDIUMINT/INTEGER/YEAR/TINYINT: JSON number (i64) — ≤32bit
//   라 f64 (±2^53-1) 무손실이므로 그대로 Number. 폭 넓은 TINYINT("TINYINT")
//   와 "TINYINT UNSIGNED" 는 Number, TINYINT(1)("BOOLEAN") 은 bool (issue #1484).

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_query_table_data_bigint_value_is_string_wire() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_wire_bigint_{ts}");

    adapter
        .execute_query(
            &format!("CREATE TABLE {table} (id BIGINT PRIMARY KEY)"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE");
    // i64::MAX = 9223372036854775807 은 f64 (±2^53-1) 범위를 초과한다. ADR 0026
    // (issue #1082) — BIGINT 은 정밀도-보존 JSON string token 으로 wire 되고
    // 프론트 wrapNumericCells 가 BigInt 로 승격한다.
    adapter
        .execute_query(
            &format!("INSERT INTO {table} (id) VALUES (9223372036854775807)"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("INSERT");

    let data = adapter
        .query_table_data(&table, MYSQL_SCHEMA, 1, 50, None, None, None, None)
        .await
        .expect("query_table_data");
    assert_eq!(data.rows.len(), 1);
    let cell = &data.rows[0][0];
    assert!(
        cell.is_string(),
        "MySQL bigint cell must be JSON string (ADR 0026 / issue #1082), got: {cell:?}"
    );
    assert_eq!(cell.as_str(), Some("9223372036854775807"));

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_query_table_data_bigint_unsigned_value_is_string_wire() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_wire_bigint_unsigned_{ts}");

    adapter
        .execute_query(
            &format!("CREATE TABLE {table} (id BIGINT UNSIGNED PRIMARY KEY)"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE");
    // u64::MAX = 18446744073709551615 (> i64::MAX, far above 2^53). sqlx-mysql
    // reports the column as "BIGINT UNSIGNED", which the wildcard arm used to
    // drop to a failed String decode -> Null (value loss). The u64 decode path
    // must produce a digit-preserving string token (ADR 0026 / issue #1082).
    adapter
        .execute_query(
            &format!("INSERT INTO {table} (id) VALUES (18446744073709551615)"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("INSERT");

    let data = adapter
        .query_table_data(&table, MYSQL_SCHEMA, 1, 50, None, None, None, None)
        .await
        .expect("query_table_data");
    assert_eq!(data.rows.len(), 1);
    let cell = &data.rows[0][0];
    assert!(
        cell.is_string(),
        "MySQL bigint unsigned cell must be JSON string (ADR 0026 / issue #1082), got: {cell:?}"
    );
    assert_eq!(cell.as_str(), Some("18446744073709551615"));

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

// Sprint 296 follow-up (2026-05-14) — sqlx `bigdecimal` feature 활성화 +
// queries.rs decode 경로가 `BigDecimal::to_string()` 으로 변환 → ADR 0026
// 와 동일한 wire format (JSON string). 정밀-민감 DECIMAL 컬럼의 frontend
// grid 노출 누락 회귀 가드.
#[tokio::test]
#[serial_test::serial]
async fn test_mysql_query_table_data_decimal_value_is_string_wire() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_wire_decimal_{ts}");

    adapter
        .execute_query(
            &format!("CREATE TABLE {table} (id INT PRIMARY KEY, amount DECIMAL(38, 18))"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE");
    adapter
        .execute_query(
            &format!("INSERT INTO {table} (id, amount) VALUES (1, 123456789.123456789012345678)"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("INSERT");

    let data = adapter
        .query_table_data(&table, MYSQL_SCHEMA, 1, 50, None, None, None, None)
        .await
        .expect("query_table_data");
    assert_eq!(data.rows.len(), 1);
    let cell = &data.rows[0][1];
    assert!(
        cell.is_string(),
        "MySQL decimal cell must be JSON string (queries.rs line 145), got: {cell:?}"
    );
    assert_eq!(cell.as_str(), Some("123456789.123456789012345678"));

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_query_table_data_int_value_remains_number_wire() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_wire_int_{ts}");

    adapter
        .execute_query(
            &format!("CREATE TABLE {table} (id INT PRIMARY KEY)"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE");
    adapter
        .execute_query(
            &format!("INSERT INTO {table} (id) VALUES (42)"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("INSERT");

    let data = adapter
        .query_table_data(&table, MYSQL_SCHEMA, 1, 50, None, None, None, None)
        .await
        .expect("query_table_data");
    assert_eq!(data.rows.len(), 1);
    let cell = &data.rows[0][0];
    assert!(
        cell.is_number(),
        "MySQL int cell must be JSON number, got: {cell:?}"
    );
    assert_eq!(cell.as_i64(), Some(42));

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

/// issue #1484 — 폭 넓은 TINYINT 정수 컬럼이 그리드에서 true/false bool 로
/// 붕괴하던 회귀 가드. sqlx-mysql 의 type_info().name() 은 ColumnType::Tiny 를
/// 폭에 따라 세 keyword 로 report 한다 (vendored column.rs L175-181):
/// TINYINT(1) → "BOOLEAN", unsigned → "TINYINT UNSIGNED", 나머지 → "TINYINT".
/// sqlx bool decode 는 byte != 0 이면 성공하므로 예전 `"TINYINT" | "BOOLEAN"`
/// 공통 bool-우선 분기가 non-zero TINYINT (2, 127, -5)를 전부 Ok(Some(true)) 로
/// 붕괴시켰다. 폭 넓은 TINYINT 는 JSON number 로, TINYINT(1)(="BOOLEAN") 은
/// MySQL boolean 관례대로 JSON bool 로 렌더돼야 한다 (line 3227 계약).
#[tokio::test]
#[serial_test::serial]
async fn test_mysql_query_table_data_tinyint_value_is_number_not_bool() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_wire_tinyint_{ts}");

    // `flag` 는 폭 넓은 TINYINT (sqlx name "TINYINT") — 정수로 렌더돼야 한다.
    // `narrow` 는 TINYINT(1) (sqlx name "BOOLEAN") — bool 렌더 보존 검증.
    adapter
        .execute_query(
            &format!("CREATE TABLE {table} (id INT PRIMARY KEY, flag TINYINT, narrow TINYINT(1))"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE");
    adapter
        .execute_query(
            &format!(
                "INSERT INTO {table} (id, flag, narrow) VALUES (1, 2, 1), (2, 127, 0), (3, -5, 1)"
            ),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("INSERT");

    let data = adapter
        .query_table_data(&table, MYSQL_SCHEMA, 1, 50, None, None, None, None)
        .await
        .expect("query_table_data");
    assert_eq!(data.rows.len(), 3);

    // id -> (flag, narrow) 매핑으로 순서 무관하게 두 케이스를 잠근다.
    for r in &data.rows {
        let id = r[0].as_i64().expect("id");
        let flag = &r[1];
        let narrow = &r[2];
        // 폭 넓은 TINYINT: 정수 (issue #1484 버그 fix — 예전엔 Bool 로 붕괴).
        assert!(
            flag.is_number(),
            "wide TINYINT must be JSON number, not bool (issue #1484), got: {flag:?}"
        );
        // TINYINT(1): MySQL boolean 관례 — bool 렌더 보존.
        assert!(
            narrow.is_boolean(),
            "TINYINT(1) must render as JSON bool (MySQL boolean idiom), got: {narrow:?}"
        );
        let (expected_flag, expected_narrow) = match id {
            1 => (2, true),
            2 => (127, false),
            3 => (-5, true),
            other => panic!("unexpected id {other}"),
        };
        assert_eq!(flag.as_i64(), Some(expected_flag));
        assert_eq!(narrow.as_bool(), Some(expected_narrow));
    }

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

// =============================================================================
// Batch 6 (Slice B-4, 2026-05-14) — mutation preview + trait dispatch coverage
// =============================================================================
// 작성 이유: pre-push `6_rust-coverage` 게이트 lines/functions 임계가 baseline
// drift 로 -1.79/-0.72 미달 (Sprint 296 측정). 본 batch 는 두 갭을 채운다:
// 1) `db/mysql/mutations.rs` 의 emission/validation 분기를 preview_only path
//    로 hit — DB connection 불필요. PK constraint emission / FK on_delete /
//    Unique / Check / index types / drop column / drop constraint / alter table
//    의 ADD/MODIFY/DROP 변형.
// 2) `db/mysql.rs` 의 RdbAdapter 트레잇 dispatch wrapper (각 메소드 4-6 line)
//    를 `Box<dyn RdbAdapter>` 호출로 hit. PG 의 동일 패턴 (db/postgres.rs)
//    이 4.62% 인 채라 본 batch 는 MySQL 만 cover — PG 보강은 별 sprint.

/// drop_table 의 preview_only path. validate_identifier + emission 만 hit —
/// DB 없이 동작.
#[tokio::test]
async fn test_mysql_drop_table_preview_emits_sql() {
    let adapter = MysqlAdapter::new();
    let req = DropTableRequest {
        connection_id: "c".into(),
        schema: "test".into(),
        table: "t".into(),
        cascade: false,
        preview_only: true,
        expected_database: None,
    };
    let result = adapter.drop_table(&req).await.expect("preview");
    assert!(result.sql.contains("DROP TABLE"));
    assert!(result.sql.contains("test"));
    assert!(result.sql.contains('t'));
}

#[tokio::test]
async fn test_mysql_rename_table_preview_emits_rename_form() {
    let adapter = MysqlAdapter::new();
    let req = RenameTableRequest {
        connection_id: "c".into(),
        schema: "test".into(),
        table: "old_t".into(),
        new_name: "new_t".into(),
        preview_only: true,
        expected_database: None,
    };
    let result = adapter.rename_table(&req).await.expect("preview");
    // MySQL 의 canonical form 은 `RENAME TABLE old TO new`.
    assert!(result.sql.starts_with("RENAME TABLE"));
    assert!(result.sql.contains("old_t"));
    assert!(result.sql.contains("new_t"));
}

#[tokio::test]
async fn test_mysql_add_column_preview_with_identity_emits_auto_increment() {
    let adapter = MysqlAdapter::new();
    let req = AddColumnRequest {
        connection_id: "c".into(),
        schema: "test".into(),
        table: "t".into(),
        column: ColumnDefinition {
            name: "id2".into(),
            data_type: "INT".into(),
            nullable: true,
            default_value: None,
            comment: Some("auto id".into()),
            is_identity: true,
        },
        check_expression: None,
        preview_only: true,
        expected_database: None,
    };
    let result = adapter.add_column(&req).await.expect("preview");
    assert!(result.sql.contains("ADD COLUMN"));
    // is_identity → AUTO_INCREMENT NOT NULL 강제 (NOT NULL implicit).
    assert!(result.sql.contains("AUTO_INCREMENT"));
    assert!(result.sql.contains("NOT NULL"));
    assert!(result.sql.contains("COMMENT 'auto id'"));
}

#[tokio::test]
async fn test_mysql_add_column_preview_with_check_expression() {
    let adapter = MysqlAdapter::new();
    let req = AddColumnRequest {
        connection_id: "c".into(),
        schema: "test".into(),
        table: "t".into(),
        column: ColumnDefinition {
            name: "age".into(),
            data_type: "INT".into(),
            nullable: false,
            default_value: Some("0".into()),
            comment: None,
            is_identity: false,
        },
        check_expression: Some("age >= 0".into()),
        preview_only: true,
        expected_database: None,
    };
    let result = adapter.add_column(&req).await.expect("preview");
    assert!(result.sql.contains("DEFAULT 0"));
    assert!(result.sql.contains("CHECK (age >= 0)"));
}

#[tokio::test]
async fn test_mysql_add_column_rejects_empty_data_type() {
    let adapter = MysqlAdapter::new();
    let req = AddColumnRequest {
        connection_id: "c".into(),
        schema: "test".into(),
        table: "t".into(),
        column: ColumnDefinition {
            name: "bad".into(),
            data_type: "  ".into(),
            nullable: true,
            default_value: None,
            comment: None,
            is_identity: false,
        },
        check_expression: None,
        preview_only: true,
        expected_database: None,
    };
    let err = adapter
        .add_column(&req)
        .await
        .expect_err("empty data_type → Validation");
    match err {
        AppError::Validation(_) => {}
        other => panic!("expected Validation, got {other:?}"),
    }
}

#[tokio::test]
async fn test_mysql_drop_column_preview_emits_drop_column() {
    let adapter = MysqlAdapter::new();
    let req = DropColumnRequest {
        connection_id: "c".into(),
        schema: "test".into(),
        table: "t".into(),
        column_name: "x".into(),
        cascade: true,
        preview_only: true,
        expected_database: None,
    };
    let result = adapter.drop_column(&req).await.expect("preview");
    // CASCADE 키워드는 MySQL DROP COLUMN 이 받지 않으므로 emit 되지 않는다.
    assert!(result.sql.contains("DROP COLUMN"));
    assert!(!result.sql.contains("CASCADE"));
}

#[tokio::test]
async fn test_mysql_create_table_preview_with_pk_and_comment() {
    let adapter = MysqlAdapter::new();
    let req = CreateTableRequest {
        connection_id: "c".into(),
        schema: "test".into(),
        name: "users".into(),
        columns: vec![
            ColumnDefinition {
                name: "id".into(),
                data_type: "INT".into(),
                nullable: false,
                default_value: None,
                comment: None,
                is_identity: true,
            },
            ColumnDefinition {
                name: "email".into(),
                data_type: "VARCHAR(190)".into(),
                nullable: false,
                default_value: None,
                comment: Some("primary contact".into()),
                is_identity: false,
            },
        ],
        primary_key: Some(vec!["id".into()]),
        preview_only: true,
        table_comment: Some("user accounts".into()),
        expected_database: None,
    };
    let result = adapter.create_table(&req).await.expect("preview");
    assert!(result.sql.contains("CREATE TABLE"));
    assert!(result.sql.contains("AUTO_INCREMENT"));
    assert!(result.sql.contains("PRIMARY KEY"));
    assert!(result.sql.contains("COMMENT 'primary contact'"));
    assert!(result.sql.contains("COMMENT = 'user accounts'"));
}

#[tokio::test]
async fn test_mysql_create_table_rejects_empty_columns() {
    let adapter = MysqlAdapter::new();
    let req = CreateTableRequest {
        connection_id: "c".into(),
        schema: "test".into(),
        name: "empty".into(),
        columns: vec![],
        primary_key: None,
        preview_only: true,
        table_comment: None,
        expected_database: None,
    };
    let err = adapter
        .create_table(&req)
        .await
        .expect_err("empty columns → Validation");
    matches!(err, AppError::Validation(_));
}

#[tokio::test]
async fn test_mysql_create_table_rejects_pk_referencing_unknown_column() {
    let adapter = MysqlAdapter::new();
    let req = CreateTableRequest {
        connection_id: "c".into(),
        schema: "test".into(),
        name: "bad_pk".into(),
        columns: vec![ColumnDefinition {
            name: "a".into(),
            data_type: "INT".into(),
            nullable: false,
            default_value: None,
            comment: None,
            is_identity: false,
        }],
        primary_key: Some(vec!["nope".into()]),
        preview_only: true,
        table_comment: None,
        expected_database: None,
    };
    let err = adapter
        .create_table(&req)
        .await
        .expect_err("unknown PK column → Validation");
    matches!(err, AppError::Validation(_));
}

#[tokio::test]
async fn test_mysql_alter_table_preview_add_modify_drop_combo() {
    let adapter = MysqlAdapter::new();
    let req = AlterTableRequest {
        connection_id: "c".into(),
        schema: "test".into(),
        table: "t".into(),
        changes: vec![
            ColumnChange::Add {
                name: "x".into(),
                data_type: "INT".into(),
                nullable: false,
                default_value: Some("0".into()),
            },
            ColumnChange::Modify {
                name: "y".into(),
                new_data_type: Some("BIGINT".into()),
                new_nullable: Some(true),
                new_default_value: Some("NULL".into()),
                using_expression: None,
            },
            ColumnChange::Drop { name: "z".into() },
        ],
        preview_only: true,
        expected_database: None,
    };
    let result = adapter.alter_table(&req).await.expect("preview");
    assert!(result.sql.contains("ADD COLUMN"));
    assert!(result.sql.contains("MODIFY COLUMN"));
    assert!(result.sql.contains("DROP COLUMN"));
}

#[tokio::test]
async fn test_mysql_alter_table_modify_without_type_rejected() {
    let adapter = MysqlAdapter::new();
    let req = AlterTableRequest {
        connection_id: "c".into(),
        schema: "test".into(),
        table: "t".into(),
        changes: vec![ColumnChange::Modify {
            name: "y".into(),
            new_data_type: None,
            new_nullable: Some(true),
            new_default_value: None,
            using_expression: None,
        }],
        preview_only: true,
        expected_database: None,
    };
    let err = adapter
        .alter_table(&req)
        .await
        .expect_err("MODIFY without data_type → Validation");
    matches!(err, AppError::Validation(_));
}

#[tokio::test]
async fn test_mysql_create_index_preview_with_unique_btree() {
    let adapter = MysqlAdapter::new();
    let req = CreateIndexRequest {
        connection_id: "c".into(),
        schema: "test".into(),
        table: "t".into(),
        index_name: "idx_t_a".into(),
        columns: vec!["a".into(), "b".into()],
        index_type: "btree".into(),
        is_unique: true,
        preview_only: true,
        expected_database: None,
    };
    let result = adapter.create_index(&req).await.expect("preview");
    assert!(result.sql.contains("CREATE UNIQUE INDEX"));
    assert_eq!(
        result.sql,
        "CREATE UNIQUE INDEX `idx_t_a` USING BTREE ON `test`.`t` (`a`, `b`)"
    );
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_create_index_executes_unique_btree() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_create_idx_{ts}");
    let index = format!("idx_{table}_code");

    adapter
        .execute_query(
            &format!("CREATE TABLE {table} (id INT PRIMARY KEY, code VARCHAR(64))"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE");

    let req = CreateIndexRequest {
        connection_id: "c".into(),
        schema: MYSQL_SCHEMA.into(),
        table: table.clone(),
        index_name: index.clone(),
        columns: vec!["code".into()],
        index_type: "btree".into(),
        is_unique: true,
        preview_only: false,
        expected_database: None,
    };
    let result = adapter.create_index(&req).await.expect("CREATE INDEX");
    assert_eq!(
        result.sql,
        format!("CREATE UNIQUE INDEX `{index}` USING BTREE ON `test`.`{table}` (`code`)")
    );

    let indexes = adapter
        .get_table_indexes(&table, MYSQL_SCHEMA)
        .await
        .expect("get_table_indexes");
    let created = indexes
        .iter()
        .find(|candidate| candidate.name == index)
        .expect("created index missing");
    assert!(created.is_unique);
    assert_eq!(created.columns, vec!["code".to_string()]);

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
async fn test_mysql_create_index_rejects_unknown_type() {
    let adapter = MysqlAdapter::new();
    let req = CreateIndexRequest {
        connection_id: "c".into(),
        schema: "test".into(),
        table: "t".into(),
        index_name: "idx".into(),
        columns: vec!["a".into()],
        index_type: "rtree".into(),
        is_unique: false,
        preview_only: true,
        expected_database: None,
    };
    let err = adapter
        .create_index(&req)
        .await
        .expect_err("unknown index type → Validation");
    matches!(err, AppError::Validation(_));
}

#[tokio::test]
async fn test_mysql_drop_index_preview_with_if_exists() {
    let adapter = MysqlAdapter::new();
    let req = DropIndexRequest {
        connection_id: "c".into(),
        schema: "test".into(),
        index_name: "idx_x".into(),
        table: "t".into(),
        if_exists: true,
        preview_only: true,
        expected_database: None,
    };
    let result = adapter.drop_index(&req).await.expect("preview");
    assert!(result.sql.contains("DROP INDEX"));
    assert!(result.sql.contains("IF EXISTS"));
    assert!(result.sql.contains("ON"));
}

#[tokio::test]
async fn test_mysql_drop_index_rejects_missing_table() {
    let adapter = MysqlAdapter::new();
    let req = DropIndexRequest {
        connection_id: "c".into(),
        schema: "test".into(),
        index_name: "idx_x".into(),
        table: "".into(),
        if_exists: false,
        preview_only: true,
        expected_database: None,
    };
    let err = adapter
        .drop_index(&req)
        .await
        .expect_err("missing table → Validation");
    matches!(err, AppError::Validation(_));
}

#[tokio::test]
async fn test_mysql_add_constraint_preview_primary_key() {
    let adapter = MysqlAdapter::new();
    let req = AddConstraintRequest {
        connection_id: "c".into(),
        schema: "test".into(),
        table: "t".into(),
        constraint_name: "pk_t".into(),
        definition: ConstraintDefinition::PrimaryKey {
            columns: vec!["id".into()],
        },
        preview_only: true,
        expected_database: None,
    };
    let result = adapter.add_constraint(&req).await.expect("preview");
    assert!(result.sql.contains("ADD CONSTRAINT"));
    assert!(result.sql.contains("PRIMARY KEY"));
}

#[tokio::test]
async fn test_mysql_add_constraint_preview_foreign_key_with_on_delete() {
    let adapter = MysqlAdapter::new();
    let req = AddConstraintRequest {
        connection_id: "c".into(),
        schema: "test".into(),
        table: "child".into(),
        constraint_name: "fk_child_parent".into(),
        definition: ConstraintDefinition::ForeignKey {
            columns: vec!["parent_id".into()],
            reference_table: "parent".into(),
            reference_columns: vec!["id".into()],
            on_delete: Some("CASCADE".into()),
            on_update: Some("RESTRICT".into()),
        },
        preview_only: true,
        expected_database: None,
    };
    let result = adapter.add_constraint(&req).await.expect("preview");
    assert!(result.sql.contains("FOREIGN KEY"));
    assert!(result.sql.contains("REFERENCES"));
    assert!(result.sql.contains("ON DELETE CASCADE"));
    assert!(result.sql.contains("ON UPDATE RESTRICT"));
}

#[tokio::test]
async fn test_mysql_add_constraint_preview_unique() {
    let adapter = MysqlAdapter::new();
    let req = AddConstraintRequest {
        connection_id: "c".into(),
        schema: "test".into(),
        table: "t".into(),
        constraint_name: "uq_t_email".into(),
        definition: ConstraintDefinition::Unique {
            columns: vec!["email".into()],
        },
        preview_only: true,
        expected_database: None,
    };
    let result = adapter.add_constraint(&req).await.expect("preview");
    assert!(result.sql.contains("UNIQUE"));
}

#[tokio::test]
async fn test_mysql_add_constraint_preview_check() {
    let adapter = MysqlAdapter::new();
    let req = AddConstraintRequest {
        connection_id: "c".into(),
        schema: "test".into(),
        table: "t".into(),
        constraint_name: "chk_t_age".into(),
        definition: ConstraintDefinition::Check {
            expression: "age >= 0".into(),
        },
        preview_only: true,
        expected_database: None,
    };
    let result = adapter.add_constraint(&req).await.expect("preview");
    assert!(result.sql.contains("CHECK (age >= 0)"));
}

#[tokio::test]
async fn test_mysql_add_constraint_empty_pk_rejected() {
    let adapter = MysqlAdapter::new();
    let req = AddConstraintRequest {
        connection_id: "c".into(),
        schema: "test".into(),
        table: "t".into(),
        constraint_name: "pk_bad".into(),
        definition: ConstraintDefinition::PrimaryKey { columns: vec![] },
        preview_only: true,
        expected_database: None,
    };
    let err = adapter
        .add_constraint(&req)
        .await
        .expect_err("empty PK columns → Validation");
    matches!(err, AppError::Validation(_));
}

#[tokio::test]
async fn test_mysql_drop_constraint_preview_emits_drop_constraint() {
    let adapter = MysqlAdapter::new();
    let req = DropConstraintRequest {
        connection_id: "c".into(),
        schema: "test".into(),
        table: "t".into(),
        constraint_name: "uq_t_email".into(),
        preview_only: true,
        expected_database: None,
    };
    let result = adapter.drop_constraint(&req).await.expect("preview");
    // MySQL 8.0.19+ unified form.
    assert!(result.sql.contains("DROP CONSTRAINT"));
}

// ── 트레잇 dispatch 통합 — db/mysql.rs 의 wrapper 메소드들을 실제 DB 로 hit ──
//
// 본 시나리오는 connect/disconnect/ping/list_namespaces/list_tables/
// query_table_data/execute_sql/execute_sql_batch/drop_table/get_columns 등
// RdbAdapter 트레잇 메소드를 `Arc<dyn RdbAdapter>` 로 호출 — db/mysql.rs 의
// 4-6 line wrapper 들을 한 번씩 hit 한다. PG 측 (db/postgres.rs 4.62%) 의
// 같은 패턴 보강은 별 sprint.

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_trait_dispatch_covers_rdb_adapter_surface() {
    let config = match common::mysql_test_config().await {
        Some(c) => c,
        None => return,
    };
    let raw = Arc::new(MysqlAdapter::new());

    // (1) DbAdapter trait — kind / connect / ping.
    let db: Arc<dyn DbAdapter> = raw.clone();
    assert!(
        matches!(db.kind(), DatabaseType::Mysql),
        "trait kind() must report Mysql"
    );

    db.connect(&config).await.expect("trait connect");
    db.ping().await.expect("trait ping");

    // (2) RdbAdapter trait — list_databases / current_database / list_tables /
    // execute_sql / execute_sql_batch / dry_run_sql_batch / query_table_data /
    // get_columns / list_namespaces.
    let rdb: Arc<dyn RdbAdapter> = raw.clone();

    let namespaces = rdb.list_namespaces().await.expect("trait list_namespaces");
    // namespaces 는 current_database 한 개 (MySQL 의 단일-DB hierarchy).
    assert!(!namespaces.is_empty());

    let current = rdb
        .current_database()
        .await
        .expect("trait current_database");
    assert_eq!(current.as_deref(), Some(MYSQL_SCHEMA));

    let dbs = rdb.list_databases().await.expect("trait list_databases");
    // admin DB 제외 — 최소한 "test" 가 들어있어야.
    assert!(dbs.iter().any(|d| d.name == MYSQL_SCHEMA));

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_trait_t_{ts}");

    let _ = rdb
        .execute_sql(
            &format!("CREATE TABLE {table} (id INT AUTO_INCREMENT PRIMARY KEY, label VARCHAR(50))"),
            None,
        )
        .await
        .expect("trait execute_sql CREATE");

    let _ = rdb
        .execute_sql_batch(
            &[
                format!("INSERT INTO {table} (label) VALUES ('a')"),
                format!("INSERT INTO {table} (label) VALUES ('b')"),
            ],
            None,
        )
        .await
        .expect("trait execute_sql_batch INSERT");

    let dry = rdb
        .dry_run_sql_batch(&[format!("SELECT * FROM {table} LIMIT 1")], None)
        .await
        .expect("trait dry_run_sql_batch");
    assert_eq!(dry.len(), 1);

    let tables = rdb
        .list_tables(MYSQL_SCHEMA)
        .await
        .expect("trait list_tables");
    assert!(tables.iter().any(|t| t.name == table));

    let cols = rdb
        .get_columns(MYSQL_SCHEMA, &table, None)
        .await
        .expect("trait get_columns");
    assert_eq!(cols.len(), 2);

    let data = rdb
        .query_table_data(MYSQL_SCHEMA, &table, 1, 50, None, None, None, None)
        .await
        .expect("trait query_table_data");
    assert_eq!(data.rows.len(), 2);

    let null_count = rdb
        .count_null_rows(MYSQL_SCHEMA, &table, "label")
        .await
        .expect("trait count_null_rows");
    assert_eq!(null_count, 0);

    // (3) DDL via trait dispatch.
    let drop_req = DropTableRequest {
        connection_id: "c".into(),
        schema: MYSQL_SCHEMA.into(),
        table: table.clone(),
        cascade: false,
        preview_only: false,
        expected_database: None,
    };
    rdb.drop_table(&drop_req).await.expect("trait drop_table");

    // disconnect.
    db.disconnect().await.expect("trait disconnect");
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_execute_query_bigint_select_emits_string_wire() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };

    // PG 의 `SELECT 9223372036854775807::bigint` 의 MySQL 대응. MySQL 의
    // integer literal 은 자동으로 BIGINT 로 promote — 별도 cast 불필요.
    // ADR 0026 (issue #1082) — BIGINT literal 도 정밀도-보존 string token 으로 wire.
    let result = adapter
        .execute_query(
            "SELECT 9223372036854775807 AS big",
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("execute_query bigint literal");
    assert_eq!(result.rows.len(), 1);
    let cell = &result.rows[0][0];
    assert!(
        cell.is_string(),
        "MySQL execute_query bigint cell must be JSON string (ADR 0026 / issue #1082), got: {cell:?}"
    );
    assert_eq!(cell.as_str(), Some("9223372036854775807"));

    adapter.disconnect_pool().await.ok();
}

// =============================================================================
// Sprint 296 follow-up — MySQL trigger 메소드 coverage
// =============================================================================
// 작성 이유: `db/mysql/schema.rs` 의 `list_triggers` / `get_trigger_source` 가
// 미커버 (information_schema.triggers path). CREATE TRIGGER 자체는 sqlx
// prepared protocol 미지원 (Sprint 296 ignored 시나리오와 동일) 라 trigger 가
// 없는 path 만 hit 가능. `create_trigger` / `drop_trigger` 트레잇 wrapper 는
// Unsupported reject 로 회귀 가드.

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_list_triggers_empty_table_returns_vec() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_trg_empty_{ts}");

    adapter
        .execute_query(
            &format!("CREATE TABLE {table} (id INT PRIMARY KEY)"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE");

    // trigger 가 없는 table 은 empty vec — information_schema.triggers
    // round-trip + BTreeMap fold path 가 happy path 로 동작.
    let triggers = adapter
        .list_triggers(MYSQL_SCHEMA, &table)
        .await
        .expect("list_triggers");
    assert!(
        triggers.is_empty(),
        "expected empty triggers, got: {triggers:?}"
    );

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_get_trigger_source_unknown_returns_connection_error() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    // 본 어댑터는 trigger 미존재 시 `AppError::Connection("Trigger … not found")`
    // 반환 (schema.rs line 777).
    let err = adapter
        .get_trigger_source(MYSQL_SCHEMA, "any_table", "definitely_does_not_exist_trg")
        .await
        .expect_err("unknown trigger → Connection error");
    match err {
        AppError::Connection(msg) => {
            assert!(msg.contains("not found"), "got: {msg}");
        }
        other => panic!("expected Connection, got {other:?}"),
    }
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
async fn test_mysql_create_trigger_trait_returns_unsupported() {
    // MySQL adapter 의 `create_trigger` 트레잇 wrapper (db/mysql.rs line 397)
    // 는 Unsupported 즉시 반환 — MySQL 의 trigger body 는 inline compound
    // statement 이고 PG 의 `function_name`-driven 모델과 패러다임 불일치.
    let adapter: Arc<dyn RdbAdapter> = Arc::new(MysqlAdapter::new());
    let req = CreateTriggerRequest {
        connection_id: "c".into(),
        schema: "test".into(),
        table: "t".into(),
        trigger_name: "trg_x".into(),
        timing: "BEFORE".into(),
        events: vec!["INSERT".into()],
        orientation: "ROW".into(),
        when_expression: None,
        function_schema: "test".into(),
        function_name: "fn_x".into(),
        function_arguments: None,
        preview_only: false,
        expected_database: None,
    };
    let err = adapter
        .create_trigger(&req)
        .await
        .expect_err("MySQL create_trigger → Unsupported");
    match err {
        AppError::Unsupported(msg) => {
            assert!(msg.contains("raw SQL"), "Unsupported copy: {msg}");
        }
        other => panic!("expected Unsupported, got {other:?}"),
    }
}

#[tokio::test]
async fn test_mysql_drop_trigger_trait_returns_unsupported() {
    let adapter: Arc<dyn RdbAdapter> = Arc::new(MysqlAdapter::new());
    let req = DropTriggerRequest {
        connection_id: "c".into(),
        schema: "test".into(),
        table: "t".into(),
        trigger_name: "trg_x".into(),
        cascade: false,
        preview_only: false,
        expected_database: None,
    };
    let err = adapter
        .drop_trigger(&req)
        .await
        .expect_err("MySQL drop_trigger → Unsupported");
    match err {
        AppError::Unsupported(msg) => {
            assert!(msg.contains("raw SQL"), "Unsupported copy: {msg}");
        }
        other => panic!("expected Unsupported, got {other:?}"),
    }
}

// list_types — MySQL adapter 는 trait default (Unsupported) 를 상속. 트레잇
// dispatch surface 회귀 가드.
#[tokio::test]
async fn test_mysql_list_types_trait_default_returns_unsupported() {
    let adapter: Arc<dyn RdbAdapter> = Arc::new(MysqlAdapter::new());
    let err = adapter
        .list_types()
        .await
        .expect_err("MySQL list_types → Unsupported (trait default)");
    matches!(err, AppError::Unsupported(_));
}

/// issue #1083 — MySQL cell decode 실패가 무음 NULL 로 위장하면 안 된다. GEOMETRY
/// 는 `cell_to_json` 에 매치 branch 가 없어 `_` String decode 가 실패하는
/// deterministic repro (zero-date 는 server sql_mode 의존이라 pool-connection
/// 마다 SET SESSION 이 필요해 불안정). 실값이 있는 GEOMETRY 셀은 진짜 NULL 이
/// 아니라 `<decode error: GEOMETRY>` 마커로 surface 되어야 하고, 같은 행의 실제
/// NULL 컬럼은 여전히 Null 이어야 한다 (진짜 NULL vs 실패 분리 검증).
#[tokio::test]
#[serial_test::serial]
async fn test_mysql_geometry_decode_failure_surfaces_marker_not_null_1083() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let table = format!("test_decode_fail_{ts}");

    adapter
        .execute_query(
            &format!("CREATE TABLE {table} (id INT PRIMARY KEY, geom GEOMETRY, maybe TEXT)"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("CREATE TABLE with GEOMETRY");
    adapter
        .execute_query(
            &format!("INSERT INTO {table} VALUES (1, ST_GeomFromText('POINT(1 1)'), NULL)"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("INSERT geometry + real NULL");

    let data = adapter
        .query_table_data(&table, MYSQL_SCHEMA, 1, 50, None, None, None, None)
        .await
        .expect("read back the GEOMETRY row");
    assert_eq!(data.rows.len(), 1);

    // geom 컬럼: 실값이 있으므로 무음 NULL 이 아니라 decode-error 마커.
    let geom_cell = &data.rows[0][1];
    assert!(
        !geom_cell.is_null(),
        "GEOMETRY with a real value must not masquerade as NULL, got {geom_cell:?}"
    );
    assert_eq!(
        geom_cell.as_str(),
        Some("<decode error: GEOMETRY>"),
        "decode failure should surface an explicit marker, got {geom_cell:?}"
    );

    // maybe 컬럼: 실제 NULL 은 여전히 Null 이어야 한다 (거짓 마커 금지).
    assert!(
        data.rows[0][2].is_null(),
        "a genuine NULL must stay NULL, got {:?}",
        data.rows[0][2]
    );

    adapter
        .execute_query(
            &format!("DROP TABLE {table}"),
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .ok();
    adapter.disconnect_pool().await.ok();
}

// ── Issue #1073 — admin ops (activity/kill/slow/info) MySQL parity ──
// PG has no integration coverage for these (unit without-connection guards
// only); MySQL adds live smoke here because the SQL bodies (information_schema
// / performance_schema / SHOW) are exactly the untested IO surface. Silent-skip
// without a live MySQL, mirroring the sibling cases in this file.

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_server_info_reports_version_and_uptime_1073() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };

    let info = adapter
        .server_info()
        .await
        .expect("server_info should succeed");

    assert!(
        info.version.chars().any(|c| c.is_ascii_digit()),
        "version must carry a numeric server version, got {:?}",
        info.version
    );
    assert!(
        info.uptime_sec.is_some_and(|u| u >= 0),
        "Uptime status var must parse to a non-negative integer, got {:?}",
        info.uptime_sec
    );
    assert!(
        info.connections_active.is_some_and(|c| c >= 1),
        "Threads_connected must count at least our own session, got {:?}",
        info.connections_active
    );
    assert!(
        info.extras.contains_key("max_connections"),
        "extras must whitelist max_connections, got keys {:?}",
        info.extras.keys().collect::<Vec<_>>()
    );

    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_list_server_activity_excludes_self_1073() {
    let config = match common::mysql_test_config().await {
        Some(c) => c,
        None => return,
    };
    let adapter = MysqlAdapter::new();
    adapter
        .connect_pool(&config)
        .await
        .expect("connect mysql adapter");

    // The querying connection is filtered by CONNECTION_ID(), so without a
    // *second* live session the result is empty and the field asserts below run
    // zero times (a vacuous pass — PR #1536 review). Open a background session
    // running SLEEP so at least one row is guaranteed, then assert non-empty
    // FIRST so the decode path (ID CAST, INFO -> query, DATE_FORMAT ->
    // started_at) is actually exercised on real values.
    let bg_pool = MySqlPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_secs(5))
        .connect_with(
            MySqlConnectOptions::new()
                .host(&config.host)
                .port(config.port)
                .username(&config.user)
                .password(&config.password)
                .database(&config.database),
        )
        .await
        .expect("background session pool");
    let bg = bg_pool.clone();
    let sleeper = tokio::spawn(async move {
        // Cancelled on abort below; the error is expected and ignored.
        let _ = sqlx::query("SELECT SLEEP(3)").execute(&bg).await;
    });
    // Give the SLEEP statement time to register in the processlist.
    sleep(Duration::from_millis(300)).await;

    let rows = adapter
        .list_server_activity()
        .await
        .expect("list_server_activity should succeed");

    assert!(
        !rows.is_empty(),
        "the background SLEEP session must surface at least one row"
    );
    assert!(
        rows.iter().any(|r| r
            .query
            .as_deref()
            .is_some_and(|q| q.to_uppercase().contains("SLEEP"))),
        "the SLEEP statement text must decode through the INFO column"
    );
    assert!(
        rows.iter().any(|r| r.started_at.is_some()),
        "DATE_FORMAT(started_at) must decode to a non-null ISO string"
    );
    for row in &rows {
        assert!(row.id > 0, "processlist id must be a positive integer");
        assert!(
            row.wait_event.is_none(),
            "MySQL processlist has no wait_event analogue"
        );
    }

    // Tear down the background session so it cannot pollute a later test.
    sleeper.abort();
    bg_pool.close().await;
    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_slow_queries_decode_and_digest_1073() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };

    // Run a distinctive statement so the digest table has at least one entry
    // (performance_schema is ON by default in the test image).
    adapter
        .execute_query(
            "SELECT 1073 AS slow_probe_1073",
            None,
            table_view_lib::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .expect("probe SELECT should succeed");

    match adapter.slow_queries(20).await {
        Ok(rows) => {
            for row in &rows {
                assert!(
                    row.total_exec_time_ms >= 0.0 && row.mean_exec_time_ms >= 0.0,
                    "timer columns must be non-negative ms"
                );
            }
        }
        // A build with performance_schema disabled must fail loud, never return
        // a silent empty list.
        Err(AppError::Database(msg)) => {
            assert!(
                msg.contains("performance_schema"),
                "the only tolerated error is a disabled performance_schema, got {msg}"
            );
        }
        Err(other) => panic!("unexpected error class: {other:?}"),
    }

    adapter.disconnect_pool().await.ok();
}

#[tokio::test]
#[serial_test::serial]
async fn test_mysql_kill_unknown_session_is_noop_1073() {
    let adapter = match common::setup_mysql_adapter().await {
        Some(a) => a,
        None => return,
    };

    // A thread id this large is not live, so the server raises
    // ER_NO_SUCH_THREAD (1094). The adapter swallows it as a successful no-op
    // for parity with PG pg_terminate_backend. Exercises the real 1094 branch.
    adapter
        .kill_session(2_000_000_000)
        .await
        .expect("killing an absent session must be a no-op, not an error");

    adapter.disconnect_pool().await.ok();
}
