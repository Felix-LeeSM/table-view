use serial_test::serial;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use table_view_lib::commands::connection::{
    save_connection, test_connection, SaveConnectionRequest, TestConnectionRequest,
};
use table_view_lib::error::AppError;
use table_view_lib::models::{ConnectionConfigPublic, DatabaseType};
use tempfile::TempDir;

fn sqlite_public(path: &str) -> ConnectionConfigPublic {
    ConnectionConfigPublic {
        id: "sqlite-c1".into(),
        name: "SQLite fixture".into(),
        db_type: DatabaseType::Sqlite,
        host: String::new(),
        port: 0,
        user: String::new(),
        database: path.into(),
        group_id: None,
        color: None,
        connection_timeout: None,
        keep_alive_interval: None,
        environment: None,
        has_password: false,
        paradigm: DatabaseType::Sqlite.paradigm(),
        auth_source: None,
        replica_set: None,
        tls_enabled: None,
    }
}

async fn create_sqlite_file(path: &std::path::Path) {
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
    sqlx::query("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT UNIQUE)")
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;
}

fn setup() -> TempDir {
    let dir = TempDir::new().unwrap();
    std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
    dir
}

fn cleanup() {
    std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
}

#[test]
#[serial]
fn save_connection_accepts_sqlite_without_host() {
    let dir = setup();
    let db_path = dir.path().join("app.sqlite");
    std::fs::File::create(&db_path).unwrap();

    let saved = save_connection(SaveConnectionRequest {
        connection: sqlite_public(db_path.to_str().unwrap()),
        password: Some(String::new()),
        is_new: Some(false),
    })
    .unwrap();

    assert!(matches!(saved.db_type, DatabaseType::Sqlite));
    assert_eq!(saved.host, "");
    assert_eq!(saved.database, db_path.display().to_string());

    cleanup();
}

#[test]
#[serial]
fn save_connection_rejects_sqlite_without_file_path() {
    let _dir = setup();
    let result = save_connection(SaveConnectionRequest {
        connection: sqlite_public("   "),
        password: Some(String::new()),
        is_new: Some(false),
    });

    match result {
        Err(AppError::Validation(msg)) => assert!(msg.contains("SQLite database file")),
        other => panic!("Expected SQLite validation error, got: {:?}", other),
    }

    cleanup();
}

#[tokio::test]
#[serial]
async fn test_connection_routes_sqlite_to_adapter() {
    let dir = setup();
    let db_path = dir.path().join("app.sqlite");
    create_sqlite_file(&db_path).await;

    let result = test_connection(TestConnectionRequest {
        config: sqlite_public(db_path.to_str().unwrap()),
        password: Some(String::new()),
        existing_id: None,
    })
    .await
    .unwrap();

    assert_eq!(result, "Connection successful");

    cleanup();
}
