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
    if let Ok(dir) = std::env::var("TABLE_VIEW_TEST_DATA_DIR") {
        let dir = PathBuf::from(dir);
        fs::create_dir_all(&dir)?;
        return Ok(dir);
    }
    let dir = dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .ok_or_else(|| AppError::Storage("Cannot determine app data directory".into()))?;
    let dir = dir.join("table-view");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn storage_file_path() -> Result<PathBuf, AppError> {
    Ok(app_data_dir()?.join("connections.json"))
}

/// Load storage from disk WITHOUT decrypting passwords. Each connection's
/// `password` field still holds the on-disk ciphertext (or "" when no
/// password is set). Use this when a function will not return password data
/// to its caller — passing through ciphertext is safer than decrypting and
/// re-encrypting (and avoids changing nonces unnecessarily).
fn load_storage_raw() -> Result<StorageData, AppError> {
    let path = storage_file_path()?;
    if !path.exists() {
        info!("Storage file not found, creating default");
        let default = StorageData {
            connections: vec![],
            groups: vec![],
        };
        save_storage_raw(&default)?;
        return Ok(default);
    }

    let content = fs::read_to_string(&path)?;
    let data: StorageData = serde_json::from_str(&content)?;
    debug!("Loaded {} connections (raw)", data.connections.len());
    Ok(data)
}

/// Save storage to disk WITHOUT re-encrypting passwords. Each connection's
/// `password` field MUST already contain ciphertext (or be empty).
fn save_storage_raw(data: &StorageData) -> Result<(), AppError> {
    let path = storage_file_path()?;
    let json = serde_json::to_string_pretty(data)?;
    fs::write(&path, &json)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
    }

    debug!("Saved {} connections (raw)", data.connections.len());
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

/// Load storage with passwords cleared. Each `ConnectionConfig.password` is
/// returned as an empty string regardless of whether one is stored on disk.
/// Use this for any path that ends in IPC/HTTP/file output.
pub fn load_storage_redacted() -> Result<StorageData, AppError> {
    with_lock(|| {
        let mut data = load_storage_raw()?;
        for conn in &mut data.connections {
            conn.password.clear();
        }
        Ok(data)
    })
}

/// Load storage with passwords decrypted. Use ONLY when a real database
/// connection is about to be made; never expose the result to the frontend.
pub fn load_storage_with_secrets() -> Result<StorageData, AppError> {
    with_lock(|| {
        let mut data = load_storage_raw()?;
        let key = crypto::get_or_create_key()?;
        for conn in &mut data.connections {
            if !conn.password.is_empty() {
                conn.password = crypto::decrypt(&conn.password, &key)?;
            }
        }
        Ok(data)
    })
}

/// Returns whether each connection currently has a stored password,
/// indexed by connection id. Cheap (no decryption performed).
pub fn password_presence_map() -> Result<std::collections::HashMap<String, bool>, AppError> {
    with_lock(|| {
        let data = load_storage_raw()?;
        Ok(data
            .connections
            .into_iter()
            .map(|c| (c.id, !c.password.is_empty()))
            .collect())
    })
}

/// Decrypt the password for a single connection. Returns:
/// - `Ok(None)` when the connection does not exist
/// - `Ok(Some(""))` when the connection exists with no password
/// - `Ok(Some(plaintext))` when the connection has a stored password
pub fn get_decrypted_password(id: &str) -> Result<Option<String>, AppError> {
    with_lock(|| {
        let data = load_storage_raw()?;
        let conn = data.connections.iter().find(|c| c.id == id);
        match conn {
            None => Ok(None),
            Some(c) if c.password.is_empty() => Ok(Some(String::new())),
            Some(c) => {
                let key = crypto::get_or_create_key()?;
                Ok(Some(crypto::decrypt(&c.password, &key)?))
            }
        }
    })
}

/// Save a connection. `new_password` semantics:
/// - `None`     → preserve the existing ciphertext (or empty for new ids)
/// - `Some("")` → explicitly clear the password
/// - `Some(s)`  → encrypt `s` and store
pub fn save_connection(
    mut conn: ConnectionConfig,
    new_password: Option<String>,
) -> Result<(), AppError> {
    with_lock(|| {
        let mut data = load_storage_raw()?;

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

        // Resolve the encrypted password to persist
        let encrypted = match new_password {
            Some(s) if !s.is_empty() => {
                let key = crypto::get_or_create_key()?;
                crypto::encrypt(&s, &key)?
            }
            Some(_) => String::new(),
            None => data
                .connections
                .iter()
                .find(|c| c.id == conn.id)
                .map(|c| c.password.clone())
                .unwrap_or_default(),
        };
        conn.password = encrypted;

        if let Some(existing) = data.connections.iter_mut().find(|c| c.id == conn.id) {
            *existing = conn;
        } else {
            data.connections.push(conn);
        }

        save_storage_raw(&data)
    })
}

pub fn delete_connection(id: &str) -> Result<(), AppError> {
    with_lock(|| {
        let mut data = load_storage_raw()?;
        let initial_len = data.connections.len();
        data.connections.retain(|c| c.id != id);

        if data.connections.len() == initial_len {
            return Err(AppError::NotFound(format!("Connection '{}' not found", id)));
        }

        save_storage_raw(&data)
    })
}

pub fn save_group(group: ConnectionGroup) -> Result<(), AppError> {
    with_lock(|| {
        let mut data = load_storage_raw()?;

        if let Some(existing) = data.groups.iter_mut().find(|g| g.id == group.id) {
            *existing = group;
        } else {
            data.groups.push(group);
        }

        save_storage_raw(&data)
    })
}

pub fn delete_group(id: &str) -> Result<(), AppError> {
    with_lock(|| {
        let mut data = load_storage_raw()?;

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

        save_storage_raw(&data)
    })
}

pub fn move_connection_to_group(
    connection_id: &str,
    group_id: Option<&str>,
) -> Result<(), AppError> {
    with_lock(|| {
        let mut data = load_storage_raw()?;

        let conn = data
            .connections
            .iter_mut()
            .find(|c| c.id == connection_id)
            .ok_or_else(|| {
                AppError::NotFound(format!("Connection '{}' not found", connection_id))
            })?;

        conn.group_id = group_id.map(String::from);
        save_storage_raw(&data)
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
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
        dir
    }

    fn cleanup_test_env() {
        std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
    }

    /// Test helper: previous-style save that treats the conn.password field
    /// as the source of truth for the new password. Equivalent to the old
    /// single-arg `save_connection`.
    fn save_conn(conn: ConnectionConfig) -> Result<(), AppError> {
        let pw = Some(conn.password.clone());
        save_connection(conn, pw)
    }

    fn load_storage() -> Result<StorageData, AppError> {
        load_storage_with_secrets()
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
        save_conn(conn.clone()).unwrap();

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
        save_conn(conn).unwrap();

        let mut updated = sample_connection("c1", "MyDB Updated");
        updated.port = 3306;
        updated.host = "newhost".to_string();
        save_conn(updated).unwrap();

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

        save_conn(sample_connection("c1", "MyDB")).unwrap();

        let result = save_conn(sample_connection("c2", "MyDB"));
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

        save_conn(sample_connection("c1", "DB1")).unwrap();
        save_conn(sample_connection("c2", "DB2")).unwrap();

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
        save_conn(conn).unwrap();

        // Verify password is NOT stored in plaintext in the file
        let data_dir = std::env::var("TABLE_VIEW_TEST_DATA_DIR").unwrap();
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
        save_conn(conn).unwrap();

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
        save_conn(sample_connection("c1", "DB1")).unwrap();

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
        save_conn(conn).unwrap();

        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections[0].password, "");

        cleanup_test_env();
    }

    // Additional: multiple connections can be saved and all loaded back
    #[test]
    #[serial]
    fn test_save_multiple_connections() {
        let _dir = setup_test_env();

        save_conn(sample_connection("c1", "DB1")).unwrap();
        save_conn(sample_connection("c2", "DB2")).unwrap();
        save_conn(sample_connection("c3", "DB3")).unwrap();

        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections.len(), 3);

        cleanup_test_env();
    }

    // -------------------------------------------------------------------
    // Phase B password security
    // -------------------------------------------------------------------

    /// load_storage_redacted must NEVER return decrypted plaintext.
    #[test]
    #[serial]
    fn test_load_storage_redacted_omits_plaintext() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("c1", "DB1");
        conn.password = "noleak".into();
        save_conn(conn).unwrap();

        let data = load_storage_redacted().unwrap();
        for c in &data.connections {
            assert!(
                !c.password.contains("noleak"),
                "Plaintext leaked from load_storage_redacted: {}",
                c.password
            );
            assert!(c.password.is_empty(), "Redacted password must be empty");
        }

        cleanup_test_env();
    }

    /// load_storage_with_secrets must round-trip plaintext correctly.
    #[test]
    #[serial]
    fn test_load_storage_with_secrets_decrypts() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("c1", "DB1");
        conn.password = "rtrip".into();
        save_conn(conn).unwrap();

        let data = load_storage_with_secrets().unwrap();
        assert_eq!(data.connections[0].password, "rtrip");

        cleanup_test_env();
    }

    /// save_connection with `None` preserves the existing ciphertext (and the
    /// decrypted plaintext when read back).
    #[test]
    #[serial]
    fn test_save_connection_with_none_preserves_existing() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("c1", "DB1");
        conn.password = "alpha".into();
        save_conn(conn).unwrap();

        // Save again with `None`: should keep the existing password
        let mut updated = sample_connection("c1", "DB1 renamed");
        updated.password = String::new(); // value is irrelevant when None
        save_connection(updated, None).unwrap();

        let data = load_storage_with_secrets().unwrap();
        assert_eq!(data.connections[0].password, "alpha");
        assert_eq!(data.connections[0].name, "DB1 renamed");

        cleanup_test_env();
    }

    /// password_presence_map reports has-password without decrypting.
    #[test]
    #[serial]
    fn test_password_presence_map_reports_correctly() {
        let _dir = setup_test_env();

        let mut with = sample_connection("c1", "DB1");
        with.password = "yes".into();
        save_conn(with).unwrap();

        let mut without = sample_connection("c2", "DB2");
        without.password = String::new();
        save_conn(without).unwrap();

        let map = password_presence_map().unwrap();
        assert_eq!(map.get("c1"), Some(&true));
        assert_eq!(map.get("c2"), Some(&false));

        cleanup_test_env();
    }

    /// get_decrypted_password returns the right plaintext for the right id.
    #[test]
    #[serial]
    fn test_get_decrypted_password_returns_plaintext() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("c1", "DB1");
        conn.password = "lkpw".into();
        save_conn(conn).unwrap();

        let pw = get_decrypted_password("c1").unwrap();
        assert_eq!(pw, Some("lkpw".to_string()));

        let missing = get_decrypted_password("nope").unwrap();
        assert_eq!(missing, None);

        cleanup_test_env();
    }

    // Additional: updating same-name same-id connection succeeds
    #[test]
    #[serial]
    fn test_save_connection_same_name_same_id_succeeds() {
        let _dir = setup_test_env();

        save_conn(sample_connection("c1", "MyDB")).unwrap();

        // Same id and same name should succeed (it's an update)
        let updated = sample_connection("c1", "MyDB");
        let result = save_conn(updated);
        assert!(result.is_ok());

        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections.len(), 1);

        cleanup_test_env();
    }
}
