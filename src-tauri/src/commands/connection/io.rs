//! Sprint 209 — import / export (plain JSON + master-password envelope).
//!
//! Extracted from the 1710-line `commands/connection.rs` god file. Owns:
//!   - Schema types: `ExportPayload`, `RenamedEntry`, `ImportResult`,
//!     `EncryptedExportResult`.
//!   - Plain-JSON path: `export_connections` / `import_connections`.
//!     Passwords are NEVER exported — neither plaintext nor ciphertext —
//!     so users must re-enter passwords after import.
//!   - Encrypted path (Sprint 140 / b327227): `export_connections_encrypted`
//!     auto-generates a 12-word BIP39 mnemonic master password and wraps the
//!     plain JSON in an `EncryptedEnvelope`. `import_connections_encrypted`
//!     accepts both envelope and plain-JSON payloads (heuristic: presence of
//!     `kdf` + `ciphertext` fields routes to envelope decrypt).

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::models::{ConnectionConfig, ConnectionConfigPublic, ConnectionGroup, DatabaseType};
use crate::storage;

const EXPORT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportPayload {
    pub schema_version: u32,
    /// Unix epoch seconds of the export. Useful for back-dating a backup
    /// without pulling in a date-time crate just for serialization.
    pub exported_at_unix_secs: u64,
    pub app: String,
    pub connections: Vec<ConnectionConfigPublic>,
    pub groups: Vec<ConnectionGroup>,
}

#[derive(Debug, Serialize)]
pub struct RenamedEntry {
    pub original_name: String,
    pub new_name: String,
}

#[derive(Debug, Serialize, Default)]
pub struct ImportResult {
    pub imported: Vec<String>,
    pub renamed: Vec<RenamedEntry>,
    pub created_groups: Vec<String>,
    pub skipped_groups: Vec<String>,
}

/// Export the requested connections (and any groups they reference) as a
/// portable JSON string. Passwords are NEVER included — neither plaintext
/// nor ciphertext. The receiving side must re-enter passwords on import.
#[tauri::command]
pub fn export_connections(ids: Vec<String>) -> Result<String, AppError> {
    let data = storage::load_storage_redacted()?;
    let presence = storage::password_presence_map()?;

    // Filter connections by ids (empty = all)
    let conns: Vec<&ConnectionConfig> = if ids.is_empty() {
        data.connections.iter().collect()
    } else {
        let id_set: std::collections::HashSet<&str> = ids.iter().map(|s| s.as_str()).collect();
        data.connections
            .iter()
            .filter(|c| id_set.contains(c.id.as_str()))
            .collect()
    };

    // Collect referenced groups
    let referenced_group_ids: std::collections::HashSet<&str> =
        conns.iter().filter_map(|c| c.group_id.as_deref()).collect();
    let groups: Vec<ConnectionGroup> = data
        .groups
        .iter()
        .filter(|g| referenced_group_ids.contains(g.id.as_str()))
        .cloned()
        .collect();

    let publics: Vec<ConnectionConfigPublic> = conns
        .into_iter()
        .map(|c| {
            let mut p: ConnectionConfigPublic = c.into();
            p.has_password = *presence.get(&c.id).unwrap_or(&false);
            p.database = export_database_name(&p.db_type, &p.database);
            p
        })
        .collect();

    let exported_at_unix_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let payload = ExportPayload {
        schema_version: EXPORT_SCHEMA_VERSION,
        exported_at_unix_secs,
        app: "table-view".into(),
        connections: publics,
        groups,
    };

    serde_json::to_string_pretty(&payload).map_err(AppError::from)
}

// ---------------------------------------------------------------------------
// Sprint 140 — encrypted export / import (master-password envelope)
// 2026-05-05 — master password는 백엔드가 BIP39 12-word mnemonic으로
// 자동 생성한다. 사용자 입력 password 시절 정책(MIN_LEN 등)은 폐기:
// 자동 생성 = 약한 password 자체가 불가능하므로 프론트 검증 floor 불필요.
// ---------------------------------------------------------------------------

/// Auto-generated mnemonic + serialized envelope JSON returned together by
/// `export_connections_encrypted`. The caller must surface `password` to the
/// user exactly once (mnemonic is the only way to import the file again) and
/// persist `json` to disk.
#[derive(serde::Serialize)]
pub struct EncryptedExportResult {
    pub password: String,
    pub json: String,
}

/// Export the requested connections wrapped in a password-derived
/// `EncryptedEnvelope`. The master password is generated server-side as a
/// 12-word BIP39 mnemonic (~128-bit entropy) and returned alongside the
/// serialized envelope; the frontend is responsible for displaying the
/// mnemonic to the user and clearing it from memory after the export
/// dialog closes.
#[tauri::command]
pub fn export_connections_encrypted(ids: Vec<String>) -> Result<EncryptedExportResult, AppError> {
    let password = storage::crypto::generate_export_password()?;
    let plain_json = export_connections(ids)?;
    let envelope = storage::crypto::aead_encrypt_with_password(&plain_json, &password)?;
    let json = serde_json::to_string_pretty(&envelope).map_err(AppError::from)?;
    Ok(EncryptedExportResult { password, json })
}

/// Import connections from either an encrypted envelope or a plain
/// `ExportPayload` JSON. Envelope detection is purely structural: when
/// `payload` parses as an `EncryptedEnvelope`, the master password is
/// required and the ciphertext is decrypted; otherwise the call falls
/// through to the existing plain-JSON `import_connections` path so older
/// (or unencrypted) backups remain importable. Wrong password collapses to
/// the canonical `INCORRECT_MASTER_PASSWORD_MESSAGE`.
#[tauri::command]
pub fn import_connections_encrypted(
    payload: String,
    master_password: String,
) -> Result<ImportResult, AppError> {
    // Heuristic: an envelope JSON has a `kdf` field. Anything else routes
    // to the plain-JSON path. We try a strict envelope parse and only
    // accept it when the `kdf` field is present so a payload that
    // happens to deserialize loosely (e.g. via #[serde(default)]) does
    // not accidentally short-circuit the plain-JSON branch.
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&payload) {
        if value.get("kdf").is_some() && value.get("ciphertext").is_some() {
            let envelope: storage::crypto::EncryptedEnvelope = serde_json::from_str(&payload)
                .map_err(|e| AppError::Validation(format!("Invalid envelope JSON: {}", e)))?;
            let plain_json =
                storage::crypto::aead_decrypt_with_password(&envelope, &master_password)?;
            return import_connections(plain_json);
        }
    }

    // Plain-JSON fallback — backward compatibility with existing exports.
    import_connections(payload)
}

/// Import connections from a JSON payload produced by `export_connections`.
/// All imported connections start with no password — the user must re-enter
/// each one before connecting.
#[tauri::command]
pub fn import_connections(json: String) -> Result<ImportResult, AppError> {
    let payload: ExportPayload = serde_json::from_str(&json)
        .map_err(|e| AppError::Validation(format!("Invalid import JSON: {}", e)))?;

    if payload.schema_version != EXPORT_SCHEMA_VERSION {
        return Err(AppError::Validation(format!(
            "Unsupported export schema version {} (expected {})",
            payload.schema_version, EXPORT_SCHEMA_VERSION
        )));
    }

    let mut result = ImportResult::default();

    // Build set of existing names + group ids
    let existing = storage::load_storage_redacted()?;
    let mut existing_conn_names: std::collections::HashSet<String> = existing
        .connections
        .iter()
        .map(|c| c.name.clone())
        .collect();
    let existing_group_ids: std::collections::HashSet<String> =
        existing.groups.iter().map(|g| g.id.clone()).collect();

    // Group id remapping (payload group id → final stored group id)
    let mut group_id_map: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    // Process groups: keep id when it doesn't collide, otherwise reuse the
    // existing group with that id (treat as the same group).
    for grp in &payload.groups {
        if existing_group_ids.contains(&grp.id) {
            group_id_map.insert(grp.id.clone(), grp.id.clone());
        } else {
            storage::save_group(grp.clone())?;
            group_id_map.insert(grp.id.clone(), grp.id.clone());
            result.created_groups.push(grp.id.clone());
        }
    }

    // Process connections
    for conn in &payload.connections {
        reject_imported_local_database_path(conn)?;

        // Always regenerate id to avoid collisions with the receiving store
        let new_id = uuid::Uuid::new_v4().to_string();

        // Resolve target group_id: prefer mapping from payload groups, else
        // existing group with same id, else drop the reference and report.
        let target_group_id = match conn.group_id.as_deref() {
            None => None,
            Some(gid) => {
                if let Some(mapped) = group_id_map.get(gid) {
                    Some(mapped.clone())
                } else if existing_group_ids.contains(gid) {
                    Some(gid.to_string())
                } else {
                    result.skipped_groups.push(conn.name.clone());
                    None
                }
            }
        };

        // Auto-rename on name collision
        let mut final_name = conn.name.clone();
        if existing_conn_names.contains(&final_name) {
            let original = final_name.clone();
            let mut candidate = format!("{} (imported)", original);
            let mut suffix = 2u32;
            while existing_conn_names.contains(&candidate) {
                candidate = format!("{} (imported {})", original, suffix);
                suffix += 1;
            }
            result.renamed.push(RenamedEntry {
                original_name: original,
                new_name: candidate.clone(),
            });
            final_name = candidate;
        }
        existing_conn_names.insert(final_name.clone());

        let stored = ConnectionConfig {
            id: new_id.clone(),
            name: final_name,
            db_type: conn.db_type.clone(),
            host: conn.host.clone(),
            port: conn.port,
            user: conn.user.clone(),
            password: String::new(), // never imported
            database: conn.database.clone(),
            read_only: conn.read_only,
            group_id: target_group_id,
            color: conn.color.clone(),
            connection_timeout: conn.connection_timeout,
            keep_alive_interval: conn.keep_alive_interval,
            environment: conn.environment.clone(),
            auth_source: conn.auth_source.clone(),
            replica_set: conn.replica_set.clone(),
            tls_enabled: conn.tls_enabled,
            trust_server_certificate: conn.trust_server_certificate,
        };

        // Save with explicit empty password (no preserve / no encrypt)
        storage::save_connection(stored, Some(String::new()))?;
        result.imported.push(new_id);
    }

    Ok(result)
}

fn export_database_name(db_type: &DatabaseType, database: &str) -> String {
    if !matches!(db_type, DatabaseType::Duckdb) {
        return database.to_string();
    }
    if !is_absolute_local_path(database) {
        return database.to_string();
    }
    local_path_file_name(database)
        .unwrap_or_default()
        .to_string()
}

fn reject_imported_local_database_path(conn: &ConnectionConfigPublic) -> Result<(), AppError> {
    if matches!(conn.db_type, DatabaseType::Duckdb) && is_absolute_local_path(&conn.database) {
        return Err(AppError::Validation(
            "DuckDB connection import payload cannot contain an absolute local database path"
                .into(),
        ));
    }
    Ok(())
}

fn is_absolute_local_path(value: &str) -> bool {
    let bytes = value.as_bytes();
    let is_windows_drive_path =
        bytes.len() > 2 && bytes[1] == b':' && matches!(bytes[2], b'\\' | b'/');
    Path::new(value).is_absolute() || is_windows_drive_path || value.starts_with("\\\\")
}

fn local_path_file_name(value: &str) -> Option<&str> {
    value
        .split(['/', '\\'])
        .filter(|part| !part.is_empty())
        .next_back()
}

#[cfg(test)]
mod tests {
    use super::super::test_helpers::*;
    use super::*;
    use crate::models::DatabaseType;
    use serial_test::serial;

    // -------------------------------------------------------------------
    // Export / Import (Phase C)
    // -------------------------------------------------------------------

    /// Export must contain neither plaintext nor ciphertext password data.
    #[test]
    #[serial]
    fn test_export_connections_omits_password_field() {
        let _dir = setup_test_env();

        let plaintext = "P!ainSecret";
        let mut conn = sample_connection("c1", "DB1");
        conn.password = plaintext.into();
        storage_save_conn(conn).unwrap();

        // Capture the on-disk ciphertext to assert it is also absent.
        let data_dir = std::env::var("TABLE_VIEW_TEST_DATA_DIR").unwrap();
        let raw = std::fs::read_to_string(std::path::Path::new(&data_dir).join("connections.json"))
            .unwrap();
        let raw_json: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let ciphertext = raw_json["connections"][0]["password"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(!ciphertext.is_empty(), "Ciphertext should exist on disk");

        let exported = export_connections(vec![]).unwrap();
        assert!(
            !exported.contains(plaintext),
            "Exported JSON must not contain plaintext password"
        );
        assert!(
            !exported.contains(&ciphertext),
            "Exported JSON must not contain on-disk ciphertext"
        );
        // Public payload field that signals presence is fine.
        assert!(exported.contains("\"hasPassword\": true"));

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_export_connections_includes_referenced_groups() {
        let _dir = setup_test_env();

        storage::save_group(sample_group("g-prod", "Production")).unwrap();
        let mut conn = sample_connection("c1", "DB1");
        conn.group_id = Some("g-prod".to_string());
        storage_save_conn(conn).unwrap();

        // Add a second group with no connection — must NOT appear in export
        storage::save_group(sample_group("g-unused", "Unused")).unwrap();

        let exported = export_connections(vec!["c1".into()]).unwrap();
        let payload: ExportPayload = serde_json::from_str(&exported).unwrap();
        assert_eq!(payload.groups.len(), 1);
        assert_eq!(payload.groups[0].id, "g-prod");

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_export_connections_hides_duckdb_absolute_database_path() {
        let _dir = setup_test_env();
        let absolute_path = "/Users/felix/private/app.duckdb";
        let mut conn = sample_connection("duck-1", "Local DuckDB");
        conn.db_type = DatabaseType::Duckdb;
        conn.database = absolute_path.into();
        storage_save_conn(conn).unwrap();

        let exported = export_connections(vec!["duck-1".into()]).unwrap();
        let payload: ExportPayload = serde_json::from_str(&exported).unwrap();

        assert!(!exported.contains(absolute_path));
        assert_eq!(payload.connections[0].database, "app.duckdb");
        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_export_connections_omits_duckdb_registered_file_analytics_source_data() {
        let _dir = setup_test_env();
        let source_path = "/Users/felix/private/sales.csv";
        let source_alias = "sales_csv";
        let source_file_name = "sales.csv";
        let source_preview_sql = "SELECT * FROM \"sales_csv\" LIMIT 100";
        let mut conn = sample_connection("duck-analytics", "Duck Analytics");
        conn.db_type = DatabaseType::Duckdb;
        conn.database = "/Users/felix/private/app.duckdb".into();
        storage_save_conn(conn).unwrap();

        let data_dir = std::env::var("TABLE_VIEW_TEST_DATA_DIR").unwrap();
        let storage_path = std::path::Path::new(&data_dir).join("connections.json");
        let raw = std::fs::read_to_string(&storage_path).unwrap();
        let mut raw_json: serde_json::Value = serde_json::from_str(&raw).unwrap();
        raw_json["connections"][0]["registeredSources"] = serde_json::json!([{
            "path": source_path,
            "source": {
                "id": "duckdb-file-1",
                "alias": source_alias,
                "fileName": source_file_name,
                "kind": "csv",
                "sizeBytes": 42
            },
            "columns": [{"name": "amount", "data_type": "DOUBLE"}],
            "previewSql": source_preview_sql
        }]);
        std::fs::write(
            &storage_path,
            serde_json::to_string_pretty(&raw_json).unwrap(),
        )
        .unwrap();

        let exported = export_connections(vec!["duck-analytics".into()]).unwrap();
        let payload: ExportPayload = serde_json::from_str(&exported).unwrap();
        let exported_json: serde_json::Value = serde_json::from_str(&exported).unwrap();
        let exported_connection = exported_json["connections"][0].as_object().unwrap();

        assert_eq!(payload.connections[0].database, "app.duckdb");
        assert!(!exported.contains(source_path));
        assert!(!exported.contains(source_alias));
        assert!(!exported.contains(source_file_name));
        assert!(!exported.contains(source_preview_sql));
        assert!(exported_connection.get("registeredSources").is_none());
        assert!(exported_connection.get("fileAnalyticsSources").is_none());
        assert!(exported_connection.get("sourceMetadata").is_none());

        cleanup_test_env();
    }

    #[test]
    fn export_database_name_strips_windows_absolute_path() {
        assert_eq!(
            export_database_name(&DatabaseType::Duckdb, r"C:\Users\felix\private\app.duckdb"),
            "app.duckdb"
        );
    }

    #[test]
    #[serial]
    fn test_import_connections_regenerates_uuids() {
        let _dir = setup_test_env();

        // Create a payload that already has fixed connection ids
        let payload = ExportPayload {
            schema_version: EXPORT_SCHEMA_VERSION,
            exported_at_unix_secs: 0,
            app: "table-view".into(),
            connections: vec![ConnectionConfigPublic {
                id: "fixed-id".into(),
                name: "Imported".into(),
                db_type: DatabaseType::Postgresql,
                host: "localhost".into(),
                port: 5432,
                user: "u".into(),
                database: "d".into(),
                read_only: false,
                group_id: None,
                color: None,
                connection_timeout: None,
                keep_alive_interval: None,
                environment: None,
                has_password: false,
                paradigm: crate::models::Paradigm::Rdb,
                auth_source: None,
                replica_set: None,
                tls_enabled: None,
                trust_server_certificate: None,
            }],
            groups: vec![],
        };
        let json = serde_json::to_string(&payload).unwrap();

        let r1 = import_connections(json.clone()).unwrap();
        let r2 = import_connections(json).unwrap();

        // Both imports succeed and produce different new ids
        assert_eq!(r1.imported.len(), 1);
        assert_eq!(r2.imported.len(), 1);
        assert_ne!(r1.imported[0], r2.imported[0]);
        // Storage holds two distinct connections
        let stored = storage::load_storage_redacted().unwrap();
        assert_eq!(stored.connections.len(), 2);

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_import_connections_rejects_duckdb_absolute_database_path() {
        let _dir = setup_test_env();
        let absolute_path = "/Users/felix/private/app.duckdb";
        let mut conn: ConnectionConfigPublic =
            (&sample_connection("duck-import", "Duck Import")).into();
        conn.db_type = DatabaseType::Duckdb;
        conn.paradigm = crate::models::Paradigm::Rdb;
        conn.database = absolute_path.into();
        let payload = ExportPayload {
            schema_version: EXPORT_SCHEMA_VERSION,
            exported_at_unix_secs: 0,
            app: "table-view".into(),
            connections: vec![conn],
            groups: vec![],
        };

        let err = import_connections(serde_json::to_string(&payload).unwrap()).unwrap_err();

        match err {
            AppError::Validation(message) => {
                assert!(message.contains("absolute local database path"));
                assert!(!message.contains(absolute_path));
            }
            other => panic!("Expected Validation, got {other:?}"),
        }
        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_import_connections_drops_duckdb_registered_file_analytics_source_data() {
        let _dir = setup_test_env();
        let source_path = "/Users/felix/private/import-sales.csv";
        let source_alias = "import_sales_csv";
        let source_file_name = "import-sales.csv";
        let source_preview_sql = "SELECT * FROM \"import_sales_csv\" LIMIT 100";
        let mut conn: ConnectionConfigPublic =
            (&sample_connection("duck-import", "Duck Import")).into();
        conn.db_type = DatabaseType::Duckdb;
        conn.paradigm = crate::models::Paradigm::Rdb;
        conn.database = "imported.duckdb".into();

        let mut payload = serde_json::to_value(ExportPayload {
            schema_version: EXPORT_SCHEMA_VERSION,
            exported_at_unix_secs: 0,
            app: "table-view".into(),
            connections: vec![conn],
            groups: vec![],
        })
        .unwrap();
        let source_metadata = serde_json::json!({
            "path": source_path,
            "source": {
                "id": "duckdb-file-1",
                "alias": source_alias,
                "fileName": source_file_name,
                "kind": "csv",
                "sizeBytes": 42
            },
            "columns": [{"name": "amount", "data_type": "DOUBLE"}],
            "previewSql": source_preview_sql
        });
        payload["registeredSources"] = serde_json::json!([source_metadata.clone()]);
        payload["connections"][0]["registeredSources"] =
            serde_json::json!([source_metadata.clone()]);
        payload["connections"][0]["fileAnalyticsSources"] =
            serde_json::json!([source_metadata.clone()]);
        payload["connections"][0]["sourceMetadata"] = source_metadata;

        let import_json = payload.to_string();
        assert!(import_json.contains(source_path));
        assert!(import_json.contains(source_alias));
        let result = import_connections(import_json).unwrap();

        assert_eq!(result.imported.len(), 1);
        let stored = storage::load_storage_redacted().unwrap();
        assert_eq!(stored.connections.len(), 1);
        assert!(matches!(
            stored.connections[0].db_type,
            DatabaseType::Duckdb
        ));
        assert_eq!(stored.connections[0].database, "imported.duckdb");
        assert_eq!(stored.connections[0].password, "");

        let data_dir = std::env::var("TABLE_VIEW_TEST_DATA_DIR").unwrap();
        let raw = std::fs::read_to_string(std::path::Path::new(&data_dir).join("connections.json"))
            .unwrap();
        assert!(!raw.contains(source_path));
        assert!(!raw.contains(source_alias));
        assert!(!raw.contains(source_file_name));
        assert!(!raw.contains(source_preview_sql));

        let exported = export_connections(vec![result.imported[0].clone()]).unwrap();
        let exported_json: serde_json::Value = serde_json::from_str(&exported).unwrap();
        let exported_connection = exported_json["connections"][0].as_object().unwrap();
        assert!(!exported.contains(source_path));
        assert!(!exported.contains(source_alias));
        assert!(!exported.contains(source_file_name));
        assert!(!exported.contains(source_preview_sql));
        assert!(exported_connection.get("registeredSources").is_none());
        assert!(exported_connection.get("fileAnalyticsSources").is_none());
        assert!(exported_connection.get("sourceMetadata").is_none());

        cleanup_test_env();
    }

    #[test]
    fn reject_imported_local_database_path_rejects_windows_absolute_path() {
        let mut conn: ConnectionConfigPublic =
            (&sample_connection("duck-import", "Duck Import")).into();
        conn.db_type = DatabaseType::Duckdb;
        conn.database = r"C:\Users\felix\private\app.duckdb".into();

        let err = reject_imported_local_database_path(&conn).unwrap_err();

        match err {
            AppError::Validation(message) => {
                assert!(message.contains("absolute local database path"));
                assert!(!message.contains(r"C:\Users\felix\private\app.duckdb"));
            }
            other => panic!("Expected Validation, got {other:?}"),
        }
    }

    #[test]
    #[serial]
    fn test_import_connections_auto_renames_on_name_collision() {
        let _dir = setup_test_env();

        storage_save_conn(sample_connection("c1", "MyDB")).unwrap();

        let payload = ExportPayload {
            schema_version: EXPORT_SCHEMA_VERSION,
            exported_at_unix_secs: 0,
            app: "table-view".into(),
            connections: vec![ConnectionConfigPublic {
                id: "x".into(),
                name: "MyDB".into(),
                db_type: DatabaseType::Postgresql,
                host: "h".into(),
                port: 5432,
                user: "u".into(),
                database: "d".into(),
                read_only: false,
                group_id: None,
                color: None,
                connection_timeout: None,
                keep_alive_interval: None,
                environment: None,
                has_password: false,
                paradigm: crate::models::Paradigm::Rdb,
                auth_source: None,
                replica_set: None,
                tls_enabled: None,
                trust_server_certificate: None,
            }],
            groups: vec![],
        };
        let json = serde_json::to_string(&payload).unwrap();

        let r = import_connections(json).unwrap();
        assert_eq!(r.renamed.len(), 1);
        assert_eq!(r.renamed[0].original_name, "MyDB");
        assert!(r.renamed[0].new_name.contains("(imported"));

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_import_connections_drops_unknown_group_reference() {
        let _dir = setup_test_env();

        let payload = ExportPayload {
            schema_version: EXPORT_SCHEMA_VERSION,
            exported_at_unix_secs: 0,
            app: "table-view".into(),
            connections: vec![ConnectionConfigPublic {
                id: "x".into(),
                name: "Lonely".into(),
                db_type: DatabaseType::Postgresql,
                host: "h".into(),
                port: 5432,
                user: "u".into(),
                database: "d".into(),
                read_only: false,
                group_id: Some("g-missing".into()),
                color: None,
                connection_timeout: None,
                keep_alive_interval: None,
                environment: None,
                has_password: false,
                paradigm: crate::models::Paradigm::Rdb,
                auth_source: None,
                replica_set: None,
                tls_enabled: None,
                trust_server_certificate: None,
            }],
            groups: vec![], // group_id refers to nothing
        };
        let json = serde_json::to_string(&payload).unwrap();

        let r = import_connections(json).unwrap();
        assert_eq!(r.skipped_groups, vec!["Lonely".to_string()]);

        let stored = storage::load_storage_redacted().unwrap();
        assert_eq!(stored.connections.len(), 1);
        assert_eq!(stored.connections[0].group_id, None);

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_import_connections_creates_new_groups_when_absent() {
        let _dir = setup_test_env();

        let payload = ExportPayload {
            schema_version: EXPORT_SCHEMA_VERSION,
            exported_at_unix_secs: 0,
            app: "table-view".into(),
            connections: vec![ConnectionConfigPublic {
                id: "x".into(),
                name: "InGrp".into(),
                db_type: DatabaseType::Postgresql,
                host: "h".into(),
                port: 5432,
                user: "u".into(),
                database: "d".into(),
                read_only: false,
                group_id: Some("g-new".into()),
                color: None,
                connection_timeout: None,
                keep_alive_interval: None,
                environment: None,
                has_password: false,
                paradigm: crate::models::Paradigm::Rdb,
                auth_source: None,
                replica_set: None,
                tls_enabled: None,
                trust_server_certificate: None,
            }],
            groups: vec![ConnectionGroup {
                id: "g-new".into(),
                name: "Brand New".into(),
                color: None,
                collapsed: false,
            }],
        };
        let json = serde_json::to_string(&payload).unwrap();

        let r = import_connections(json).unwrap();
        assert_eq!(r.created_groups, vec!["g-new".to_string()]);

        let stored = storage::load_storage_redacted().unwrap();
        assert!(stored.groups.iter().any(|g| g.id == "g-new"));
        assert_eq!(stored.connections[0].group_id, Some("g-new".to_string()));

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_import_round_trip() {
        let _dir = setup_test_env();

        // Seed with two connections, one in a group with a password
        storage::save_group(sample_group("g1", "G1")).unwrap();
        let mut c1 = sample_connection("c1", "DB1");
        c1.password = "h@s_pw".into();
        c1.group_id = Some("g1".into());
        storage_save_conn(c1).unwrap();

        let mut c2 = sample_connection("c2", "DB2");
        c2.password = String::new();
        storage_save_conn(c2).unwrap();

        let exported = export_connections(vec![]).unwrap();

        // Reset storage by deleting everything
        storage::delete_connection("c1").unwrap();
        storage::delete_connection("c2").unwrap();
        storage::delete_group("g1").unwrap();

        let r = import_connections(exported).unwrap();
        assert_eq!(r.imported.len(), 2);
        // No password should be set on any imported connection
        let stored = storage::load_storage_redacted().unwrap();
        assert_eq!(stored.connections.len(), 2);
        for c in &stored.connections {
            let pw = storage::get_decrypted_password(&c.id).unwrap();
            assert_eq!(pw, Some(String::new()), "Imported password must be empty");
        }

        cleanup_test_env();
    }

    #[test]
    fn test_import_connections_rejects_invalid_schema_version() {
        let bad = serde_json::json!({
            "schema_version": 99,
            "exported_at_unix_secs": 0,
            "app": "table-view",
            "connections": [],
            "groups": []
        })
        .to_string();
        let result = import_connections(bad);
        assert!(matches!(result, Err(AppError::Validation(_))));
    }

    // -------------------------------------------------------------------
    // Sprint 140 — encrypted export / import command tests
    // -------------------------------------------------------------------

    #[test]
    #[serial]
    fn test_export_connections_encrypted_round_trip() {
        let _dir = setup_test_env();

        storage::save_group(sample_group("g1", "G1")).unwrap();
        let mut c1 = sample_connection("c1", "DB1");
        c1.password = "p@ss1".into();
        c1.group_id = Some("g1".into());
        storage_save_conn(c1).unwrap();

        let mut c2 = sample_connection("c2", "DB2");
        c2.password = String::new();
        storage_save_conn(c2).unwrap();

        let result = export_connections_encrypted(vec![]).unwrap();
        // Auto-generated mnemonic must be a 12-word BIP39 phrase.
        assert_eq!(result.password.split_whitespace().count(), 12);
        // Envelope shape sanity (locked schema)
        assert!(result.json.contains("\"v\": 1"));
        assert!(result.json.contains("\"kdf\": \"argon2id\""));
        assert!(result.json.contains("\"alg\": \"aes-256-gcm\""));
        assert!(result.json.contains("\"tag_attached\": true"));
        // Wrong password must be rejected — proves ciphertext is opaque
        // without the key. (Substring search on base64 output is flaky:
        // random ciphertext can coincidentally spell "DB1".)
        assert!(
            import_connections_encrypted(result.json.clone(), "wrong passphrase".into()).is_err(),
            "wrong password must fail to decrypt"
        );

        // Reset storage and import via the encrypted path using the
        // mnemonic the backend just emitted.
        storage::delete_connection("c1").unwrap();
        storage::delete_connection("c2").unwrap();
        storage::delete_group("g1").unwrap();

        let r = import_connections_encrypted(result.json, result.password).unwrap();
        assert_eq!(r.imported.len(), 2);

        let stored = storage::load_storage_redacted().unwrap();
        assert_eq!(stored.connections.len(), 2);

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_export_connections_encrypted_emits_unique_mnemonic_per_call() {
        // 자동 생성 = 호출마다 다른 mnemonic. 같은 connection 두 번 export
        // 했을 때 두 envelope이 서로 풀리지 않아야 함 (각자 자기 mnemonic만).
        let _dir = setup_test_env();
        storage_save_conn(sample_connection("c1", "DB1")).unwrap();

        let r1 = export_connections_encrypted(vec![]).unwrap();
        let r2 = export_connections_encrypted(vec![]).unwrap();
        assert_ne!(r1.password, r2.password);

        // r1.json는 r2.password로 풀리면 안 됨.
        let err = import_connections_encrypted(r1.json.clone(), r2.password.clone()).unwrap_err();
        assert!(matches!(err, AppError::Encryption(_)));

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_import_connections_encrypted_wrong_password_rejected() {
        let _dir = setup_test_env();

        storage_save_conn(sample_connection("c1", "DB1")).unwrap();
        let result = export_connections_encrypted(vec![]).unwrap();

        let err = import_connections_encrypted(result.json, "wrong mnemonic words go here".into())
            .unwrap_err();
        match err {
            AppError::Encryption(msg) => {
                assert_eq!(msg, storage::crypto::INCORRECT_MASTER_PASSWORD_MESSAGE);
            }
            other => panic!("Expected Encryption error, got: {:?}", other),
        }

        cleanup_test_env();
    }

    /// Plain JSON pass-through: when the payload is not an envelope, the
    /// command falls back to the existing `import_connections` flow and
    /// the master password is ignored. This guards backward compatibility
    /// with older exports.
    #[test]
    #[serial]
    fn test_import_connections_encrypted_plain_json_pass_through() {
        let _dir = setup_test_env();

        let payload = ExportPayload {
            schema_version: EXPORT_SCHEMA_VERSION,
            exported_at_unix_secs: 0,
            app: "table-view".into(),
            connections: vec![ConnectionConfigPublic {
                id: "x".into(),
                name: "PlainImport".into(),
                db_type: DatabaseType::Postgresql,
                host: "h".into(),
                port: 5432,
                user: "u".into(),
                database: "d".into(),
                read_only: false,
                group_id: None,
                color: None,
                connection_timeout: None,
                keep_alive_interval: None,
                environment: None,
                has_password: false,
                paradigm: crate::models::Paradigm::Rdb,
                auth_source: None,
                replica_set: None,
                tls_enabled: None,
                trust_server_certificate: None,
            }],
            groups: vec![],
        };
        let plain_json = serde_json::to_string(&payload).unwrap();

        // Empty password is fine for plain-JSON fallback path.
        let r = import_connections_encrypted(plain_json, String::new()).unwrap();
        assert_eq!(r.imported.len(), 1);

        let stored = storage::load_storage_redacted().unwrap();
        assert_eq!(stored.connections.len(), 1);
        assert_eq!(stored.connections[0].name, "PlainImport");

        cleanup_test_env();
    }

    /// Schema version round-trip — a v1 payload encrypted to an envelope
    /// then decrypted must yield the same `schema_version`.
    #[test]
    #[serial]
    fn test_import_connections_encrypted_preserves_schema_version() {
        let _dir = setup_test_env();

        storage_save_conn(sample_connection("c1", "DB1")).unwrap();
        let result = export_connections_encrypted(vec![]).unwrap();

        // Re-clear storage and import — the decrypted body must still
        // carry schema_version=1 to be accepted by import_connections.
        storage::delete_connection("c1").unwrap();
        let r = import_connections_encrypted(result.json, result.password).unwrap();
        assert_eq!(r.imported.len(), 1);

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_import_connections_encrypted_invalid_envelope_json() {
        let _dir = setup_test_env();

        // Looks like an envelope (has kdf/ciphertext) but base64 garbage.
        let bad = serde_json::json!({
            "v": 1,
            "kdf": "argon2id",
            "m_cost": 19456,
            "t_cost": 2,
            "p_cost": 1,
            "salt": "AAAA",
            "nonce": "AAAA",
            "alg": "aes-256-gcm",
            "ciphertext": "AAAA",
            "tag_attached": true
        })
        .to_string();
        let err = import_connections_encrypted(bad, "any-pass-12".into()).unwrap_err();
        match err {
            AppError::Encryption(msg) => {
                assert_eq!(msg, storage::crypto::INCORRECT_MASTER_PASSWORD_MESSAGE);
            }
            other => panic!("Expected Encryption error, got: {:?}", other),
        }

        cleanup_test_env();
    }
}
