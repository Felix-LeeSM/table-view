use std::fs;

use serial_test::serial;
use tempfile::TempDir;
use view_table_lib::models::{ConnectionConfig, ConnectionGroup, DatabaseType};
use view_table_lib::storage;

/// Set up a temp directory as the test data dir and return the TempDir
/// (must be kept alive for the duration of the test).
fn setup_test_dir() -> TempDir {
    let tmp = TempDir::new().unwrap();
    std::env::set_var("VIEWTABLE_TEST_DATA_DIR", tmp.path());
    tmp
}

fn cleanup_test_dir() {
    std::env::remove_var("VIEWTABLE_TEST_DATA_DIR");
}

fn sample_connection(id: &str, name: &str) -> ConnectionConfig {
    ConnectionConfig {
        id: id.to_string(),
        name: name.to_string(),
        db_type: DatabaseType::Postgresql,
        host: "localhost".to_string(),
        port: 5432,
        user: "postgres".to_string(),
        password: "secret".to_string(),
        database: "testdb".to_string(),
        group_id: None,
        color: None,
        connection_timeout: None,
        keep_alive_interval: None,
        environment: None,
    }
}

fn sample_group(id: &str, name: &str) -> ConnectionGroup {
    ConnectionGroup {
        id: id.to_string(),
        name: name.to_string(),
        color: None,
        collapsed: false,
    }
}

#[test]
#[serial]
fn test_save_and_load_connection() {
    let _dir = setup_test_dir();
    let conn = sample_connection("c1", "MyDB");
    storage::save_connection(conn.clone()).unwrap();

    let loaded = storage::load_storage().unwrap();
    assert_eq!(loaded.connections.len(), 1);
    assert_eq!(loaded.connections[0].id, "c1");
    assert_eq!(loaded.connections[0].name, "MyDB");
    assert_eq!(loaded.connections[0].password, "secret");
    cleanup_test_dir();
}

#[test]
#[serial]
fn test_save_connection_updates_existing() {
    let _dir = setup_test_dir();
    let conn = sample_connection("c1", "MyDB");
    storage::save_connection(conn).unwrap();

    let mut updated = sample_connection("c1", "MyDB Updated");
    updated.port = 3306;
    storage::save_connection(updated).unwrap();

    let loaded = storage::load_storage().unwrap();
    assert_eq!(loaded.connections.len(), 1);
    assert_eq!(loaded.connections[0].name, "MyDB Updated");
    assert_eq!(loaded.connections[0].port, 3306);
    cleanup_test_dir();
}

#[test]
#[serial]
fn test_save_connection_rejects_duplicate_name() {
    let _dir = setup_test_dir();
    storage::save_connection(sample_connection("c1", "MyDB")).unwrap();

    let result = storage::save_connection(sample_connection("c2", "MyDB"));
    assert!(result.is_err());
    cleanup_test_dir();
}

#[test]
#[serial]
fn test_delete_connection() {
    let _dir = setup_test_dir();
    storage::save_connection(sample_connection("c1", "DB1")).unwrap();
    storage::save_connection(sample_connection("c2", "DB2")).unwrap();

    storage::delete_connection("c1").unwrap();

    let loaded = storage::load_storage().unwrap();
    assert_eq!(loaded.connections.len(), 1);
    assert_eq!(loaded.connections[0].id, "c2");
    cleanup_test_dir();
}

#[test]
#[serial]
fn test_delete_nonexistent_connection_fails() {
    let _dir = setup_test_dir();
    let result = storage::delete_connection("nonexistent");
    assert!(result.is_err());
    cleanup_test_dir();
}

#[test]
#[serial]
fn test_save_and_list_groups() {
    let _dir = setup_test_dir();
    storage::save_group(sample_group("g1", "Production")).unwrap();
    storage::save_group(sample_group("g2", "Development")).unwrap();

    let loaded = storage::load_storage().unwrap();
    assert_eq!(loaded.groups.len(), 2);
    assert_eq!(loaded.groups[0].name, "Production");
    assert_eq!(loaded.groups[1].name, "Development");
    cleanup_test_dir();
}

#[test]
#[serial]
fn test_delete_group_moves_connections_to_root() {
    let _dir = setup_test_dir();
    storage::save_group(sample_group("g1", "Group1")).unwrap();

    let mut conn = sample_connection("c1", "DB1");
    conn.group_id = Some("g1".to_string());
    storage::save_connection(conn).unwrap();

    storage::delete_group("g1").unwrap();

    let loaded = storage::load_storage().unwrap();
    assert_eq!(loaded.groups.len(), 0);
    assert_eq!(loaded.connections.len(), 1);
    assert_eq!(loaded.connections[0].group_id, None);
    cleanup_test_dir();
}

#[test]
#[serial]
fn test_move_connection_to_group() {
    let _dir = setup_test_dir();
    storage::save_group(sample_group("g1", "Group1")).unwrap();
    storage::save_connection(sample_connection("c1", "DB1")).unwrap();

    storage::move_connection_to_group("c1", Some("g1")).unwrap();

    let loaded = storage::load_storage().unwrap();
    assert_eq!(loaded.connections[0].group_id, Some("g1".to_string()));
    cleanup_test_dir();
}

#[test]
#[serial]
fn test_move_connection_to_root() {
    let _dir = setup_test_dir();
    storage::save_group(sample_group("g1", "Group1")).unwrap();

    let mut conn = sample_connection("c1", "DB1");
    conn.group_id = Some("g1".to_string());
    storage::save_connection(conn).unwrap();

    storage::move_connection_to_group("c1", None).unwrap();

    let loaded = storage::load_storage().unwrap();
    assert_eq!(loaded.connections[0].group_id, None);
    cleanup_test_dir();
}

#[test]
#[serial]
fn test_password_is_encrypted_at_rest() {
    let _dir = setup_test_dir();
    let conn = sample_connection("c1", "MyDB");
    storage::save_connection(conn).unwrap();

    // Read raw file and verify password is NOT stored in plaintext
    let data_dir = std::env::var("VIEWTABLE_TEST_DATA_DIR").unwrap();
    let raw = fs::read_to_string(std::path::Path::new(&data_dir).join("connections.json")).unwrap();
    assert!(
        !raw.contains("secret"),
        "Password should not appear in plaintext in storage file"
    );
    cleanup_test_dir();
}

#[test]
#[serial]
fn test_load_empty_storage() {
    let _dir = setup_test_dir();
    // No file created yet — should return empty defaults
    let loaded = storage::load_storage().unwrap();
    assert!(loaded.connections.is_empty());
    assert!(loaded.groups.is_empty());
    cleanup_test_dir();
}

#[test]
#[serial]
fn test_connection_timeout_and_keepalive_persist() {
    let _dir = setup_test_dir();
    let mut conn = sample_connection("c1", "DB1");
    conn.connection_timeout = Some(60);
    conn.keep_alive_interval = Some(10);
    storage::save_connection(conn).unwrap();

    let loaded = storage::load_storage().unwrap();
    assert_eq!(loaded.connections[0].connection_timeout, Some(60));
    assert_eq!(loaded.connections[0].keep_alive_interval, Some(10));
    cleanup_test_dir();
}
