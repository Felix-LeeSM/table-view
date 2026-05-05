//! Sprint 209 — connection-group CRUD + connection→group reassignment.
//!
//! Extracted from the 1710-line `commands/connection.rs` god file. Owns:
//!   - `list_groups` / `save_group` / `delete_group`.
//!   - `move_connection_to_group` (re-parents an existing connection;
//!     `group_id = None` removes the group reference).

use crate::error::AppError;
use crate::models::ConnectionGroup;
use crate::storage;

#[tauri::command]
pub fn list_groups() -> Result<Vec<ConnectionGroup>, AppError> {
    let data = storage::load_storage_redacted()?;
    Ok(data.groups)
}

#[tauri::command]
pub fn save_group(
    group: ConnectionGroup,
    is_new: Option<bool>,
) -> Result<ConnectionGroup, AppError> {
    if group.name.trim().is_empty() {
        return Err(AppError::Validation("Group name is required".into()));
    }

    let grp = if is_new.unwrap_or(false) {
        let mut new_group = group;
        new_group.id = uuid::Uuid::new_v4().to_string();
        new_group
    } else {
        group
    };

    storage::save_group(grp.clone())?;
    Ok(grp)
}

#[tauri::command]
pub fn delete_group(id: String) -> Result<(), AppError> {
    storage::delete_group(&id)
}

#[tauri::command]
pub fn move_connection_to_group(
    connection_id: String,
    group_id: Option<String>,
) -> Result<(), AppError> {
    storage::move_connection_to_group(&connection_id, group_id.as_deref())
}

#[cfg(test)]
mod tests {
    use super::super::test_helpers::*;
    use super::*;
    use serial_test::serial;

    // AC-13: list_groups returns groups from storage
    #[test]
    #[serial]
    fn test_list_groups_returns_from_storage() {
        let _dir = setup_test_env();

        storage::save_group(sample_group("g1", "Production")).unwrap();
        storage::save_group(sample_group("g2", "Development")).unwrap();

        let groups = list_groups().unwrap();
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].id, "g1");
        assert_eq!(groups[0].name, "Production");
        assert_eq!(groups[1].id, "g2");
        assert_eq!(groups[1].name, "Development");

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_list_groups_returns_empty_when_no_groups() {
        let _dir = setup_test_env();

        let groups = list_groups().unwrap();
        assert!(groups.is_empty());

        cleanup_test_env();
    }

    // AC-14: save_group validates empty name
    #[test]
    fn test_save_group_rejects_empty_name() {
        let group = sample_group("g1", "");
        let result = save_group(group, None);
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Validation(msg) => assert!(msg.contains("Group name is required")),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[test]
    fn test_save_group_rejects_whitespace_name() {
        let group = sample_group("g1", "   ");
        let result = save_group(group, None);
        assert!(result.is_err());
    }

    #[test]
    #[serial]
    fn test_save_group_generates_uuid_when_is_new() {
        let _dir = setup_test_env();

        let group = sample_group("placeholder-id", "MyGroup");
        let result = save_group(group, Some(true)).unwrap();

        assert_ne!(result.id, "placeholder-id");
        assert_eq!(result.id.len(), 36);
        assert!(result.id.contains('-'));

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_delete_group_command_removes_group() {
        let _dir = setup_test_env();

        storage::save_group(sample_group("g1", "Group1")).unwrap();
        delete_group("g1".to_string()).unwrap();

        let loaded = load_storage().unwrap();
        assert!(loaded.groups.is_empty());

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_move_connection_to_group_command() {
        let _dir = setup_test_env();

        storage::save_group(sample_group("g1", "Group1")).unwrap();
        storage_save_conn(sample_connection("c1", "DB1")).unwrap();

        move_connection_to_group("c1".to_string(), Some("g1".to_string())).unwrap();

        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections[0].group_id, Some("g1".to_string()));

        cleanup_test_env();
    }
}
