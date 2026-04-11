pub mod crypto;

use crate::error::AppError;
use crate::models::{ConnectionConfig, ConnectionGroup, StorageData};
use std::fs;
use std::path::PathBuf;
use std::sync::LazyLock;
use tracing::{debug, info};

/// In-process lock to prevent TOCTOU race conditions between concurrent Tauri commands.
/// Storage operations are all synchronous (blocking file I/O), so std::sync::Mutex is correct.
static STORAGE_LOCK: LazyLock<std::sync::Mutex<()>> = LazyLock::new(|| std::sync::Mutex::new(()));

fn app_data_dir() -> Result<PathBuf, AppError> {
    // Allow tests to override data directory via env var
    if let Ok(dir) = std::env::var("VIEWTABLE_TEST_DATA_DIR") {
        let dir = PathBuf::from(dir);
        fs::create_dir_all(&dir)?;
        return Ok(dir);
    }
    let dir = dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .ok_or_else(|| AppError::Storage("Cannot determine app data directory".into()))?;
    let dir = dir.join("view-table");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn storage_file_path() -> Result<PathBuf, AppError> {
    Ok(app_data_dir()?.join("connections.json"))
}

fn load_storage_inner() -> Result<StorageData, AppError> {
    let path = storage_file_path()?;
    if !path.exists() {
        info!("Storage file not found, creating default");
        let default = StorageData {
            connections: vec![],
            groups: vec![],
        };
        save_storage_inner(&default)?;
        return Ok(default);
    }

    let content = fs::read_to_string(&path)?;
    let mut data: StorageData = serde_json::from_str(&content)?;

    // Decrypt passwords
    let key = crypto::get_or_create_key()?;
    for conn in &mut data.connections {
        if !conn.password.is_empty() {
            conn.password = crypto::decrypt(&conn.password, &key)?;
        }
    }

    debug!("Loaded {} connections", data.connections.len());
    Ok(data)
}

fn save_storage_inner(data: &StorageData) -> Result<(), AppError> {
    let path = storage_file_path()?;
    let key = crypto::get_or_create_key()?;

    // Encrypt passwords before saving
    let mut save_data = data.clone();
    for conn in &mut save_data.connections {
        if !conn.password.is_empty() {
            conn.password = crypto::encrypt(&conn.password, &key)?;
        }
    }

    let json = serde_json::to_string_pretty(&save_data)?;
    fs::write(&path, &json)?;

    // Restrict file permissions to owner-only
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
    }

    debug!("Saved {} connections", data.connections.len());
    Ok(())
}

/// Acquire the storage lock and load data. The caller must hold the lock
/// for the entire load-modify-save cycle.
fn with_lock<F, T>(f: F) -> Result<T, AppError>
where
    F: FnOnce() -> Result<T, AppError>,
{
    let _guard = STORAGE_LOCK
        .lock()
        .map_err(|e| AppError::Storage(format!("Storage lock error: {}", e)))?;
    f()
}

// --- Public API (each acquires STORAGE_LOCK to prevent TOCTOU) ---

pub fn load_storage() -> Result<StorageData, AppError> {
    with_lock(load_storage_inner)
}

pub fn save_connection(conn: ConnectionConfig) -> Result<(), AppError> {
    with_lock(|| {
        let mut data = load_storage_inner()?;

        // Check for duplicate name
        if data
            .connections
            .iter()
            .any(|c| c.id != conn.id && c.name == conn.name)
        {
            return Err(AppError::Validation(format!(
                "Connection with name '{}' already exists",
                conn.name
            )));
        }

        if let Some(existing) = data.connections.iter_mut().find(|c| c.id == conn.id) {
            *existing = conn;
        } else {
            data.connections.push(conn);
        }

        save_storage_inner(&data)
    })
}

pub fn delete_connection(id: &str) -> Result<(), AppError> {
    with_lock(|| {
        let mut data = load_storage_inner()?;
        let initial_len = data.connections.len();
        data.connections.retain(|c| c.id != id);

        if data.connections.len() == initial_len {
            return Err(AppError::NotFound(format!("Connection '{}' not found", id)));
        }

        save_storage_inner(&data)
    })
}

pub fn save_group(group: ConnectionGroup) -> Result<(), AppError> {
    with_lock(|| {
        let mut data = load_storage_inner()?;

        if let Some(existing) = data.groups.iter_mut().find(|g| g.id == group.id) {
            *existing = group;
        } else {
            data.groups.push(group);
        }

        save_storage_inner(&data)
    })
}

pub fn delete_group(id: &str) -> Result<(), AppError> {
    with_lock(|| {
        let mut data = load_storage_inner()?;

        let initial_len = data.groups.len();
        data.groups.retain(|g| g.id != id);
        if data.groups.len() == initial_len {
            return Err(AppError::NotFound(format!("Group '{}' not found", id)));
        }

        // Move connections from deleted group to root
        for conn in &mut data.connections {
            if conn.group_id.as_deref() == Some(id) {
                conn.group_id = None;
            }
        }

        save_storage_inner(&data)
    })
}

pub fn move_connection_to_group(
    connection_id: &str,
    group_id: Option<&str>,
) -> Result<(), AppError> {
    with_lock(|| {
        let mut data = load_storage_inner()?;

        let conn = data
            .connections
            .iter_mut()
            .find(|c| c.id == connection_id)
            .ok_or_else(|| {
                AppError::NotFound(format!("Connection '{}' not found", connection_id))
            })?;

        conn.group_id = group_id.map(String::from);
        save_storage_inner(&data)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ConnectionConfig, ConnectionGroup, DatabaseType};
    use serial_test::serial;
    use tempfile::TempDir;

    /// Helper: set up a temp directory as the test data dir.
    /// Returns the TempDir which must be kept alive for the duration of the test.
    fn setup_test_env() -> TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("VIEWTABLE_TEST_DATA_DIR", dir.path());
        dir
    }

    fn cleanup_test_env() {
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
            password: "testpass".to_string(),
            database: "testdb".to_string(),
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
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

    // AC-01: load_storage creates default empty storage when file doesn't exist
    #[test]
    #[serial]
    fn test_load_storage_creates_default_when_no_file() {
        let _dir = setup_test_env();

        let data = load_storage().unwrap();
        assert!(data.connections.is_empty());
        assert!(data.groups.is_empty());

        cleanup_test_env();
    }

    // AC-02: save_connection adds new connection and can load it back
    #[test]
    #[serial]
    fn test_save_connection_adds_new_and_loads_back() {
        let _dir = setup_test_env();

        let conn = sample_connection("c1", "MyDB");
        save_connection(conn.clone()).unwrap();

        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections.len(), 1);
        assert_eq!(loaded.connections[0].id, "c1");
        assert_eq!(loaded.connections[0].name, "MyDB");
        assert_eq!(loaded.connections[0].host, "localhost");
        assert_eq!(loaded.connections[0].port, 5432);

        cleanup_test_env();
    }

    // AC-03: save_connection updates existing connection by id
    #[test]
    #[serial]
    fn test_save_connection_updates_existing_by_id() {
        let _dir = setup_test_env();

        let conn = sample_connection("c1", "MyDB");
        save_connection(conn).unwrap();

        let mut updated = sample_connection("c1", "MyDB Updated");
        updated.port = 3306;
        updated.host = "newhost".to_string();
        save_connection(updated).unwrap();

        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections.len(), 1);
        assert_eq!(loaded.connections[0].name, "MyDB Updated");
        assert_eq!(loaded.connections[0].port, 3306);
        assert_eq!(loaded.connections[0].host, "newhost");

        cleanup_test_env();
    }

    // AC-04: save_connection rejects duplicate name (different id, same name)
    #[test]
    #[serial]
    fn test_save_connection_rejects_duplicate_name() {
        let _dir = setup_test_env();

        save_connection(sample_connection("c1", "MyDB")).unwrap();

        let result = save_connection(sample_connection("c2", "MyDB"));
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Validation(msg) => {
                assert!(msg.contains("already exists"));
            }
            other => panic!("Expected Validation error, got: {:?}", other),
        }

        // Verify original connection is still intact
        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections.len(), 1);
        assert_eq!(loaded.connections[0].id, "c1");

        cleanup_test_env();
    }

    // AC-05: delete_connection removes connection by id
    #[test]
    #[serial]
    fn test_delete_connection_removes_by_id() {
        let _dir = setup_test_env();

        save_connection(sample_connection("c1", "DB1")).unwrap();
        save_connection(sample_connection("c2", "DB2")).unwrap();

        delete_connection("c1").unwrap();

        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections.len(), 1);
        assert_eq!(loaded.connections[0].id, "c2");
        assert_eq!(loaded.connections[0].name, "DB2");

        cleanup_test_env();
    }

    // AC-06: delete_connection returns NotFound for non-existent id
    #[test]
    #[serial]
    fn test_delete_connection_not_found_for_missing_id() {
        let _dir = setup_test_env();

        let result = delete_connection("nonexistent");
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::NotFound(msg) => {
                assert!(msg.contains("nonexistent"));
            }
            other => panic!("Expected NotFound error, got: {:?}", other),
        }

        cleanup_test_env();
    }

    // AC-07: password encryption/decryption roundtrip
    #[test]
    #[serial]
    fn test_password_roundtrip_encrypted() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("c1", "MyDB");
        conn.password = "pwd_tst".to_string();
        save_connection(conn).unwrap();

        // Verify password is NOT stored in plaintext in the file
        let data_dir = std::env::var("VIEWTABLE_TEST_DATA_DIR").unwrap();
        let raw = std::fs::read_to_string(std::path::Path::new(&data_dir).join("connections.json"))
            .unwrap();
        assert!(
            !raw.contains("pwd_tst"),
            "Password should not appear in plaintext in storage file"
        );

        // Verify loading decrypts the password correctly
        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections[0].password, "pwd_tst");

        cleanup_test_env();
    }

    // AC-08: save_group adds and updates groups
    #[test]
    #[serial]
    fn test_save_group_adds_and_updates() {
        let _dir = setup_test_env();

        // Add a group
        save_group(sample_group("g1", "Production")).unwrap();

        let loaded = load_storage().unwrap();
        assert_eq!(loaded.groups.len(), 1);
        assert_eq!(loaded.groups[0].id, "g1");
        assert_eq!(loaded.groups[0].name, "Production");

        // Update the group
        let updated_group = ConnectionGroup {
            id: "g1".to_string(),
            name: "Production Updated".to_string(),
            color: Some("#ff0000".to_string()),
            collapsed: true,
        };
        save_group(updated_group).unwrap();

        let loaded = load_storage().unwrap();
        assert_eq!(loaded.groups.len(), 1);
        assert_eq!(loaded.groups[0].name, "Production Updated");
        assert_eq!(loaded.groups[0].color, Some("#ff0000".to_string()));
        assert!(loaded.groups[0].collapsed);

        cleanup_test_env();
    }

    // AC-09: delete_group moves orphaned connections to root
    #[test]
    #[serial]
    fn test_delete_group_moves_orphaned_connections_to_root() {
        let _dir = setup_test_env();

        save_group(sample_group("g1", "Group1")).unwrap();

        let mut conn = sample_connection("c1", "DB1");
        conn.group_id = Some("g1".to_string());
        save_connection(conn).unwrap();

        delete_group("g1").unwrap();

        let loaded = load_storage().unwrap();
        assert_eq!(loaded.groups.len(), 0);
        assert_eq!(loaded.connections.len(), 1);
        assert_eq!(loaded.connections[0].group_id, None);

        cleanup_test_env();
    }

    // AC-10: move_connection_to_group changes group_id
    #[test]
    #[serial]
    fn test_move_connection_to_group_changes_group() {
        let _dir = setup_test_env();

        save_group(sample_group("g1", "Group1")).unwrap();
        save_connection(sample_connection("c1", "DB1")).unwrap();

        // Move to group
        move_connection_to_group("c1", Some("g1")).unwrap();
        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections[0].group_id, Some("g1".to_string()));

        // Move back to root
        move_connection_to_group("c1", None).unwrap();
        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections[0].group_id, None);

        cleanup_test_env();
    }

    // Additional: move_connection_to_group returns NotFound for missing connection
    #[test]
    #[serial]
    fn test_move_connection_to_group_not_found() {
        let _dir = setup_test_env();

        let result = move_connection_to_group("nonexistent", Some("g1"));
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::NotFound(msg) => {
                assert!(msg.contains("nonexistent"));
            }
            other => panic!("Expected NotFound error, got: {:?}", other),
        }

        cleanup_test_env();
    }

    // Additional: delete_group returns NotFound for non-existent group
    #[test]
    #[serial]
    fn test_delete_group_not_found() {
        let _dir = setup_test_env();

        let result = delete_group("nonexistent");
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::NotFound(msg) => {
                assert!(msg.contains("nonexistent"));
            }
            other => panic!("Expected NotFound error, got: {:?}", other),
        }

        cleanup_test_env();
    }

    // Additional: empty password is not encrypted
    #[test]
    #[serial]
    fn test_save_connection_empty_password_not_encrypted() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("c1", "MyDB");
        conn.password = String::new();
        save_connection(conn).unwrap();

        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections[0].password, "");

        cleanup_test_env();
    }

    // Additional: multiple connections can be saved and all loaded back
    #[test]
    #[serial]
    fn test_save_multiple_connections() {
        let _dir = setup_test_env();

        save_connection(sample_connection("c1", "DB1")).unwrap();
        save_connection(sample_connection("c2", "DB2")).unwrap();
        save_connection(sample_connection("c3", "DB3")).unwrap();

        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections.len(), 3);

        cleanup_test_env();
    }

    // Additional: updating same-name same-id connection succeeds
    #[test]
    #[serial]
    fn test_save_connection_same_name_same_id_succeeds() {
        let _dir = setup_test_env();

        save_connection(sample_connection("c1", "MyDB")).unwrap();

        // Same id and same name should succeed (it's an update)
        let updated = sample_connection("c1", "MyDB");
        let result = save_connection(updated);
        assert!(result.is_ok());

        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections.len(), 1);

        cleanup_test_env();
    }
}
