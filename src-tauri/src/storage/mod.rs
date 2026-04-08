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
