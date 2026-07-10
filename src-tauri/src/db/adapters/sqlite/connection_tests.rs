use super::*;
use crate::models::DatabaseType;
use serial_test::serial;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

fn sqlite_config(path: &str) -> ConnectionConfig {
    ConnectionConfig {
        id: "sqlite-1".to_string(),
        name: "SQLite".to_string(),
        db_type: DatabaseType::Sqlite,
        host: String::new(),
        port: 0,
        user: String::new(),
        password: String::new(),
        database: path.to_string(),
        read_only: false,
        group_id: None,
        color: None,
        connection_timeout: None,
        keep_alive_interval: None,
        environment: None,
        auth_source: None,
        replica_set: None,
        tls_enabled: None,
        trust_server_certificate: None,
    }
}

async fn seed_sqlite(path: &std::path::Path) {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(path)
                .create_if_missing(true)
                .foreign_keys(true),
        )
        .await
        .unwrap();
    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL
        )",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "CREATE TABLE orders (
            id INTEGER PRIMARY KEY,
            user_id INTEGER NOT NULL,
            total_cents INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO users(id, email, name) VALUES (1, 'ada@example.test', 'Ada')")
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;
}

#[tokio::test]
async fn test_sqlite_create_database_file_creates_valid_new_file() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("created.sqlite");

    let created = SqliteAdapter::create_database_file(db_path.to_str().unwrap())
        .await
        .unwrap();

    assert_eq!(created, db_path.display().to_string());
    assert!(db_path.exists());
    SqliteAdapter::test(&sqlite_config(db_path.to_str().unwrap()))
        .await
        .unwrap();
}

#[tokio::test]
async fn test_sqlite_create_database_file_rejects_existing_file() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("existing.sqlite");
    seed_sqlite(&db_path).await;

    let result = SqliteAdapter::create_database_file(db_path.to_str().unwrap()).await;

    match result {
        Err(AppError::Validation(message)) => assert!(message.contains("already exists")),
        other => panic!("Expected validation error, got: {:?}", other),
    }
}

#[tokio::test]
async fn test_sqlite_create_database_file_rejects_missing_parent() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("missing").join("app.sqlite");

    let result = SqliteAdapter::create_database_file(db_path.to_str().unwrap()).await;

    match result {
        Err(AppError::Validation(message)) => assert!(message.contains("parent directory")),
        other => panic!("Expected parent validation error, got: {:?}", other),
    }
    assert!(!db_path.exists());
}

#[tokio::test]
async fn test_sqlite_create_database_file_requires_absolute_path() {
    let result = SqliteAdapter::create_database_file("relative.sqlite").await;

    match result {
        Err(AppError::Validation(message)) => assert!(message.contains("absolute")),
        other => panic!("Expected absolute path validation error, got: {:?}", other),
    }
}

// [#1449] wave 27 보안 2차 P1-1. connect / create 가드가 `state.db`
// exact-match 만 막아, `state.db.bak`(유효 SQLite 포맷) 를 열어 내부 상태를
// read 하거나 `.key` / `connections.json` 을 create target 으로 덮어쓸 수
// 있었다. 가드를 app_data_dir 전체 confine 으로 넓혀 fix. fix 전 아래 reject
// assertion 은 RED — 모든 인접 파일이 connect/create 를 통과했다.
#[tokio::test]
#[serial]
async fn test_sqlite_rejects_internal_app_data_paths() {
    let dir = tempfile::tempdir().unwrap();
    std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());

    for name in [
        ".key",
        "connections.json",
        "state.db",
        "state.db.bak",
        "state.db-wal",
    ] {
        let target = dir.path().join(name);
        let target_str = target.to_str().unwrap();

        // connect 가드 — 존재하는 `state.db.bak` 도 read 대상으로 열 수 없다.
        match SqliteAdapter::validate_user_database_path(target_str) {
            Err(AppError::Validation(_)) => {}
            other => panic!("connect {name} must be rejected, got: {:?}", other),
        }
        // create 가드 — 인접 credential 을 create target 으로 줄 수 없다.
        match SqliteAdapter::create_database_file(target_str).await {
            Err(AppError::Validation(_)) => {}
            other => panic!("create {name} must be rejected, got: {:?}", other),
        }
        assert!(!target.exists(), "{name} must not be created");
    }

    // 정상 회귀: app_data_dir 밖의 파일은 계속 connect/create 허용.
    let outside = tempfile::tempdir().unwrap();
    let ok_db = outside.path().join("user.sqlite");
    SqliteAdapter::create_database_file(ok_db.to_str().unwrap())
        .await
        .unwrap();
    assert!(ok_db.exists(), "external db must still be created");

    // 정상 회귀: `<data_dir>-fixtures` 처럼 data_dir 와 문자열 prefix 만
    // 공유하는 sibling 은 내부가 아니다 (`Path::starts_with` 는 component
    // 단위) — e2e smoke fixture 배치가 이 속성에 기댄다 (#1472 회귀).
    let mut sibling = dir.path().as_os_str().to_owned();
    sibling.push("-fixtures");
    let sibling_db = std::path::PathBuf::from(sibling).join("fixture.sqlite");
    SqliteAdapter::validate_user_database_path(sibling_db.to_str().unwrap())
        .expect("sibling -fixtures dir must not be treated as internal");

    std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
}

#[tokio::test]
async fn test_sqlite_connection_opens_existing_file() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("app.sqlite");
    seed_sqlite(&db_path).await;

    SqliteAdapter::test(&sqlite_config(db_path.to_str().unwrap()))
        .await
        .unwrap();
}

#[tokio::test]
async fn test_sqlite_connection_requires_absolute_path() {
    let result = SqliteAdapter::test(&sqlite_config("relative.sqlite")).await;

    match result {
        Err(AppError::Validation(message)) => assert!(message.contains("absolute")),
        other => panic!("Expected absolute path validation error, got: {:?}", other),
    }
}

#[tokio::test]
async fn test_sqlite_read_only_connection_rejects_writes() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("app.sqlite");
    seed_sqlite(&db_path).await;
    let mut config = sqlite_config(db_path.to_str().unwrap());
    config.read_only = true;
    let adapter = SqliteAdapter::new();

    adapter.connect_pool(&config).await.unwrap();
    adapter
        .execute_query(
            "SELECT COUNT(*) FROM users",
            None,
            crate::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await
        .unwrap();
    let result = adapter
        .execute_query(
            "INSERT INTO users(id, email, name) VALUES (2, 'ro@example.test', 'Read Only')",
            None,
            crate::db::row_cap::DEFAULT_ROW_CAP,
        )
        .await;

    match result {
        Err(AppError::Unsupported(message)) => {
            assert!(message.contains("read-only SQLite connection"))
        }
        other => panic!(
            "read-only SQLite connection must reject writes clearly: {:?}",
            other
        ),
    }
}

#[tokio::test]
async fn test_sqlite_connection_rejects_missing_file() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("missing.sqlite");

    let result = SqliteAdapter::test(&sqlite_config(db_path.to_str().unwrap())).await;

    assert!(matches!(result, Err(AppError::Connection(_))));
    assert!(!db_path.exists(), "test_connection must not create files");
}

#[tokio::test]
async fn test_sqlite_adapter_lists_main_namespace_and_tables() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("app.sqlite");
    seed_sqlite(&db_path).await;
    let adapter = SqliteAdapter::new();
    adapter
        .connect_pool(&sqlite_config(db_path.to_str().unwrap()))
        .await
        .unwrap();

    assert_eq!(
        adapter.current_database_path().await,
        Some(db_path.display().to_string())
    );
    let tables = adapter.list_tables("main").await.unwrap();
    assert_eq!(
        tables.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(),
        vec!["orders", "users"]
    );
    assert_eq!(
        tables.iter().find(|t| t.name == "users").unwrap().row_count,
        Some(1)
    );
}

#[tokio::test]
async fn test_sqlite_adapter_caches_capability_inventory_until_disconnect() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("app.sqlite");
    seed_sqlite(&db_path).await;
    let adapter = SqliteAdapter::new();
    adapter
        .connect_pool(&sqlite_config(db_path.to_str().unwrap()))
        .await
        .unwrap();

    let inventory = adapter.capability_inventory().await.unwrap();
    if inventory.json1 {
        adapter
            .execute_query(
                "SELECT json_extract('{\"a\":1}', '$.a') AS value",
                None,
                crate::db::row_cap::DEFAULT_ROW_CAP,
            )
            .await
            .unwrap();
    }

    adapter.disconnect_pool().await.unwrap();
    assert!(matches!(
        adapter.capability_inventory().await,
        Err(AppError::Connection(_))
    ));
}

#[tokio::test]
async fn test_sqlite_adapter_reads_columns_and_foreign_keys() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("app.sqlite");
    seed_sqlite(&db_path).await;
    let adapter = SqliteAdapter::new();
    adapter
        .connect_pool(&sqlite_config(db_path.to_str().unwrap()))
        .await
        .unwrap();

    let columns = adapter.get_table_columns("main", "orders").await.unwrap();
    let user_id = columns.iter().find(|c| c.name == "user_id").unwrap();

    assert_eq!(user_id.data_type, "INTEGER");
    assert!(user_id.is_foreign_key);
    assert_eq!(user_id.fk_reference.as_deref(), Some("users(id)"));
    assert_eq!(user_id.category, ColumnCategory::Int);
}

async fn seed_trigger(path: &std::path::Path, create_sql: &str) {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(SqliteConnectOptions::new().filename(path))
        .await
        .unwrap();
    sqlx::query(create_sql).execute(&pool).await.unwrap();
    pool.close().await;
}

#[tokio::test]
async fn test_sqlite_adapter_lists_triggers_scoped_to_table() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("app.sqlite");
    seed_sqlite(&db_path).await;
    seed_trigger(
        &db_path,
        "CREATE TRIGGER z_after_upd AFTER UPDATE ON users \
         BEGIN UPDATE orders SET total_cents = total_cents WHERE user_id = NEW.id; END",
    )
    .await;
    seed_trigger(
        &db_path,
        "CREATE TRIGGER a_before_ins BEFORE INSERT ON users \
         BEGIN SELECT RAISE(IGNORE) WHERE NEW.email IS NULL; END",
    )
    .await;
    let adapter = SqliteAdapter::new();
    adapter
        .connect_pool(&sqlite_config(db_path.to_str().unwrap()))
        .await
        .unwrap();

    let triggers = adapter.list_triggers("main", "users").await.unwrap();
    // Ordered by name; parsed timing/event header + inline definition.
    assert_eq!(
        triggers.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(),
        vec!["a_before_ins", "z_after_upd"]
    );
    let before = &triggers[0];
    assert_eq!(before.timing, "BEFORE");
    assert_eq!(before.events, vec!["INSERT".to_string()]);
    assert_eq!(before.orientation, "ROW");
    // SQLite triggers have an inline body, not a named function.
    assert!(before.function_name.is_empty());
    assert!(before.definition.contains("CREATE TRIGGER"));

    let after = &triggers[1];
    assert_eq!(after.timing, "AFTER");
    assert_eq!(after.events, vec!["UPDATE".to_string()]);

    // Triggers on a different table are not returned.
    assert!(adapter
        .list_triggers("main", "orders")
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn test_sqlite_adapter_reads_and_misses_trigger_source() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("app.sqlite");
    seed_sqlite(&db_path).await;
    seed_trigger(
        &db_path,
        "CREATE TRIGGER users_guard AFTER DELETE ON users \
         BEGIN SELECT 1; END",
    )
    .await;
    let adapter = SqliteAdapter::new();
    adapter
        .connect_pool(&sqlite_config(db_path.to_str().unwrap()))
        .await
        .unwrap();

    let source = adapter
        .get_trigger_source("main", "users", "users_guard")
        .await
        .unwrap();
    assert!(source.contains("AFTER DELETE"));

    // Unknown trigger surfaces NotFound rather than a misleading empty string.
    assert!(matches!(
        adapter.get_trigger_source("main", "users", "absent").await,
        Err(AppError::NotFound(_))
    ));
}
