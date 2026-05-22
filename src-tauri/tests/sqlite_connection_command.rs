use serial_test::serial;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use table_view_lib::commands::connection::{
    create_sqlite_database_file, save_connection, test_connection, SaveConnectionRequest,
    TestConnectionRequest,
};
use table_view_lib::error::AppError;
use table_view_lib::models::{ConnectionConfigPublic, DatabaseType};
use table_view_lib::storage::local as app_sqlite_state;
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
        read_only: false,
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
fn sqlite_public_wire_preserves_read_only() {
    let public: ConnectionConfigPublic = serde_json::from_value(serde_json::json!({
        "id": "sqlite-ro",
        "name": "SQLite read only",
        "dbType": "sqlite",
        "host": "",
        "port": 0,
        "user": "",
        "database": "/tmp/user-owned.sqlite",
        "groupId": null,
        "color": null,
        "hasPassword": false,
        "paradigm": "rdb",
        "readOnly": true
    }))
    .unwrap();

    let stored = public.into_config_with_empty_password();
    let returned = ConnectionConfigPublic::from(&stored);
    let value = serde_json::to_value(returned).unwrap();

    assert_eq!(value.get("readOnly").and_then(|v| v.as_bool()), Some(true));
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

#[test]
#[serial]
fn save_connection_rejects_sqlite_relative_file_path() {
    let _dir = setup();
    let result = save_connection(SaveConnectionRequest {
        connection: sqlite_public("relative.sqlite"),
        password: Some(String::new()),
        is_new: Some(false),
    });

    match result {
        Err(AppError::Validation(msg)) => assert!(msg.contains("absolute")),
        other => panic!(
            "Expected SQLite absolute path validation error, got: {:?}",
            other
        ),
    }

    cleanup();
}

#[test]
#[serial]
fn save_connection_rejects_internal_app_state_db_path() {
    let _dir = setup();
    let state_path = app_sqlite_state::db_path().unwrap();

    let result = save_connection(SaveConnectionRequest {
        connection: sqlite_public(state_path.to_str().unwrap()),
        password: Some(String::new()),
        is_new: Some(false),
    });

    match result {
        Err(AppError::Validation(message)) => {
            assert!(message.contains("internal app SQLite state"))
        }
        other => panic!(
            "Expected internal app SQLite state validation error, got: {:?}",
            other
        ),
    }

    cleanup();
}

#[test]
#[serial]
fn save_connection_rejects_normalized_internal_app_state_db_path_before_file_exists() {
    let dir = setup();
    let state_path = app_sqlite_state::db_path().unwrap();
    assert!(!state_path.exists());
    let normalized_equivalent = format!("{}/./state.db", dir.path().display());

    let result = save_connection(SaveConnectionRequest {
        connection: sqlite_public(&normalized_equivalent),
        password: Some(String::new()),
        is_new: Some(false),
    });

    match result {
        Err(AppError::Validation(message)) => {
            assert!(message.contains("internal app SQLite state"))
        }
        other => panic!(
            "Expected normalized internal app SQLite state validation error, got: {:?}",
            other
        ),
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

#[tokio::test]
#[serial]
async fn test_connection_rejects_internal_app_state_db_path() {
    let _dir = setup();
    let pool = app_sqlite_state::open_pool().await.unwrap();
    let state_path = app_sqlite_state::db_path().unwrap();

    let result = test_connection(TestConnectionRequest {
        config: sqlite_public(state_path.to_str().unwrap()),
        password: Some(String::new()),
        existing_id: None,
    })
    .await;

    pool.close().await;

    match result {
        Err(AppError::Validation(message)) => {
            assert!(message.contains("internal app SQLite state"))
        }
        other => panic!(
            "Expected internal app SQLite state validation error, got: {:?}",
            other
        ),
    }

    cleanup();
}

#[tokio::test]
#[serial]
async fn create_sqlite_database_file_creates_new_valid_database() {
    let dir = setup();
    let db_path = dir.path().join("created.sqlite");

    let created = create_sqlite_database_file(db_path.to_str().unwrap().to_string())
        .await
        .unwrap();

    assert_eq!(created, db_path.display().to_string());
    assert!(db_path.exists());

    let result = test_connection(TestConnectionRequest {
        config: sqlite_public(&created),
        password: Some(String::new()),
        existing_id: None,
    })
    .await
    .unwrap();
    assert_eq!(result, "Connection successful");

    cleanup();
}

#[tokio::test]
#[serial]
async fn create_sqlite_database_file_rejects_existing_file() {
    let dir = setup();
    let db_path = dir.path().join("existing.sqlite");
    create_sqlite_file(&db_path).await;

    let result = create_sqlite_database_file(db_path.to_str().unwrap().to_string()).await;

    match result {
        Err(AppError::Validation(message)) => assert!(message.contains("already exists")),
        other => panic!("Expected existing-file validation error, got: {:?}", other),
    }

    cleanup();
}

#[tokio::test]
#[serial]
async fn create_sqlite_database_file_rejects_missing_parent() {
    let dir = setup();
    let db_path = dir.path().join("missing").join("app.sqlite");

    let result = create_sqlite_database_file(db_path.to_str().unwrap().to_string()).await;

    match result {
        Err(AppError::Validation(message)) => assert!(message.contains("parent directory")),
        other => panic!(
            "Expected parent-directory validation error, got: {:?}",
            other
        ),
    }
    assert!(!db_path.exists());

    cleanup();
}
