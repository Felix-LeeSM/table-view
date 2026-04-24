use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseType {
    #[default]
    Postgresql,
    Mysql,
    Sqlite,
    Mongodb,
    Redis,
}

impl DatabaseType {
    #[allow(dead_code)]
    pub fn default_port(&self) -> u16 {
        match self {
            DatabaseType::Postgresql => 5432,
            DatabaseType::Mysql => 3306,
            DatabaseType::Sqlite => 0,
            DatabaseType::Mongodb => 27017,
            DatabaseType::Redis => 6379,
        }
    }

    /// Paradigm tag exposed to the frontend. Sprint 65 promotes this from the
    /// previous `&'static str` return type to a typed `Paradigm` enum so the
    /// wire format is a validated discriminated tag rather than a free-form
    /// string.
    pub fn paradigm(&self) -> Paradigm {
        match self {
            DatabaseType::Postgresql | DatabaseType::Mysql | DatabaseType::Sqlite => Paradigm::Rdb,
            DatabaseType::Mongodb => Paradigm::Document,
            DatabaseType::Redis => Paradigm::Kv,
        }
    }
}

/// Database paradigm tag. Serialized lowercase (`"rdb"`, `"document"`,
/// `"search"`, `"kv"`) to match the frontend `Paradigm` string-literal union.
///
/// Sprint 65 promotes this from a bare `String` on `ConnectionConfigPublic` to
/// a typed enum so that wire payloads can no longer carry an arbitrary empty
/// string via `#[serde(default)]`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Paradigm {
    Rdb,
    Document,
    Search,
    Kv,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub id: String,
    pub name: String,
    pub db_type: DatabaseType,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: String,
    pub group_id: Option<String>,
    pub color: Option<String>,
    #[serde(default)]
    pub connection_timeout: Option<u32>,
    #[serde(default)]
    pub keep_alive_interval: Option<u32>,
    #[serde(default)]
    pub environment: Option<String>,
    // ── MongoDB-specific optional fields (Sprint 65). ─────────────────────
    // All three are `#[serde(default)]` so existing non-mongo persisted JSON
    // (which lacks these keys entirely) still deserializes unchanged.
    /// MongoDB authentication database (`authSource`). Ignored by non-mongo
    /// adapters.
    #[serde(default)]
    pub auth_source: Option<String>,
    /// MongoDB replica set name. Ignored by non-mongo adapters.
    #[serde(default)]
    pub replica_set: Option<String>,
    /// Whether to enable TLS for the MongoDB connection. Ignored by non-mongo
    /// adapters.
    #[serde(default)]
    pub tls_enabled: Option<bool>,
}

/// Public-facing connection shape returned to the frontend and exported to
/// JSON. Crucially this struct has **no password field** — the boolean
/// `has_password` is the only signal the UI gets about whether a password is
/// stored. The plaintext never leaves the backend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfigPublic {
    pub id: String,
    pub name: String,
    pub db_type: DatabaseType,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub database: String,
    pub group_id: Option<String>,
    pub color: Option<String>,
    #[serde(default)]
    pub connection_timeout: Option<u32>,
    #[serde(default)]
    pub keep_alive_interval: Option<u32>,
    #[serde(default)]
    pub environment: Option<String>,
    /// Whether a password is stored on disk. Derived, never persisted.
    #[serde(default)]
    pub has_password: bool,
    /// Paradigm tag derived from `db_type`. Sprint 65 tightens this from the
    /// previous `String` + `#[serde(default)]` shape into a typed
    /// [`Paradigm`] enum; payloads lacking this field now fail to
    /// deserialize instead of silently defaulting to `""`. The frontend
    /// `Paradigm` string-literal union (`"rdb" | "document" | "search" |
    /// "kv"`) mirrors the lowercase serialization.
    pub paradigm: Paradigm,
    // ── MongoDB-specific optional fields (Sprint 65) ─────────────────────
    #[serde(default)]
    pub auth_source: Option<String>,
    #[serde(default)]
    pub replica_set: Option<String>,
    #[serde(default)]
    pub tls_enabled: Option<bool>,
}

impl From<&ConnectionConfig> for ConnectionConfigPublic {
    fn from(c: &ConnectionConfig) -> Self {
        Self {
            id: c.id.clone(),
            name: c.name.clone(),
            paradigm: c.db_type.paradigm(),
            db_type: c.db_type.clone(),
            host: c.host.clone(),
            port: c.port,
            user: c.user.clone(),
            database: c.database.clone(),
            group_id: c.group_id.clone(),
            color: c.color.clone(),
            connection_timeout: c.connection_timeout,
            keep_alive_interval: c.keep_alive_interval,
            environment: c.environment.clone(),
            has_password: !c.password.is_empty(),
            auth_source: c.auth_source.clone(),
            replica_set: c.replica_set.clone(),
            tls_enabled: c.tls_enabled,
        }
    }
}

impl ConnectionConfigPublic {
    /// Promote a public config to a full ConnectionConfig with an empty
    /// password slot. Used by command handlers that accept this struct over
    /// IPC and then forward to the storage layer (which separately receives
    /// the optional new password).
    pub fn into_config_with_empty_password(self) -> ConnectionConfig {
        ConnectionConfig {
            id: self.id,
            name: self.name,
            db_type: self.db_type,
            host: self.host,
            port: self.port,
            user: self.user,
            password: String::new(),
            database: self.database,
            group_id: self.group_id,
            color: self.color,
            connection_timeout: self.connection_timeout,
            keep_alive_interval: self.keep_alive_interval,
            environment: self.environment,
            auth_source: self.auth_source,
            replica_set: self.replica_set,
            tls_enabled: self.tls_enabled,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionGroup {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub collapsed: bool,
}

/// Adjacently-tagged enum for clean discriminated union on the frontend.
/// Serializes as:
/// - `{"type": "connected"}`
/// - `{"type": "disconnected"}`
/// - `{"type": "error", "message": "..."}`
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase", tag = "type", content = "message")]
pub enum ConnectionStatus {
    Connected,
    #[default]
    Disconnected,
    Error(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageData {
    pub connections: Vec<ConnectionConfig>,
    pub groups: Vec<ConnectionGroup>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn database_type_default_is_postgresql() {
        assert!(matches!(DatabaseType::default(), DatabaseType::Postgresql));
    }

    #[test]
    fn default_port_returns_correct_values() {
        assert_eq!(DatabaseType::Postgresql.default_port(), 5432);
        assert_eq!(DatabaseType::Mysql.default_port(), 3306);
        assert_eq!(DatabaseType::Sqlite.default_port(), 0);
        assert_eq!(DatabaseType::Mongodb.default_port(), 27017);
        assert_eq!(DatabaseType::Redis.default_port(), 6379);
    }

    #[test]
    fn connection_status_default_is_disconnected() {
        assert!(matches!(
            ConnectionStatus::default(),
            ConnectionStatus::Disconnected
        ));
    }

    #[test]
    fn database_type_serde_roundtrip() {
        let types = vec![
            DatabaseType::Postgresql,
            DatabaseType::Mysql,
            DatabaseType::Sqlite,
            DatabaseType::Mongodb,
            DatabaseType::Redis,
        ];
        for db_type in types {
            let json = serde_json::to_string(&db_type).unwrap();
            let deserialized: DatabaseType = serde_json::from_str(&json).unwrap();
            assert_eq!(format!("{:?}", db_type), format!("{:?}", deserialized));
        }
    }

    #[test]
    fn database_type_serializes_to_lowercase() {
        let json = serde_json::to_string(&DatabaseType::Postgresql).unwrap();
        assert_eq!(json, "\"postgresql\"");
        let json = serde_json::to_string(&DatabaseType::Mysql).unwrap();
        assert_eq!(json, "\"mysql\"");
    }

    #[test]
    fn database_type_paradigm_maps_expected_tags() {
        assert_eq!(DatabaseType::Postgresql.paradigm(), Paradigm::Rdb);
        assert_eq!(DatabaseType::Mysql.paradigm(), Paradigm::Rdb);
        assert_eq!(DatabaseType::Sqlite.paradigm(), Paradigm::Rdb);
        assert_eq!(DatabaseType::Mongodb.paradigm(), Paradigm::Document);
        assert_eq!(DatabaseType::Redis.paradigm(), Paradigm::Kv);
    }

    #[test]
    fn paradigm_serializes_to_expected_lowercase_tags() {
        assert_eq!(serde_json::to_string(&Paradigm::Rdb).unwrap(), "\"rdb\"");
        assert_eq!(
            serde_json::to_string(&Paradigm::Document).unwrap(),
            "\"document\""
        );
        assert_eq!(
            serde_json::to_string(&Paradigm::Search).unwrap(),
            "\"search\""
        );
        assert_eq!(serde_json::to_string(&Paradigm::Kv).unwrap(), "\"kv\"");
    }

    #[test]
    fn connection_config_public_serializes_paradigm_for_postgres() {
        let conn = ConnectionConfig {
            id: "c1".into(),
            name: "DB".into(),
            db_type: DatabaseType::Postgresql,
            host: "h".into(),
            port: 5432,
            user: "u".into(),
            password: "p".into(),
            database: "d".into(),
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
            environment: None,
            auth_source: None,
            replica_set: None,
            tls_enabled: None,
        };
        let public = ConnectionConfigPublic::from(&conn);
        assert_eq!(public.paradigm, Paradigm::Rdb);

        let json = serde_json::to_string(&public).unwrap();
        assert!(
            json.contains("\"paradigm\":\"rdb\""),
            "paradigm tag missing from payload: {}",
            json
        );
    }

    #[test]
    fn connection_config_public_serializes_paradigm_for_mongodb() {
        let conn = ConnectionConfig {
            id: "c1".into(),
            name: "DB".into(),
            db_type: DatabaseType::Mongodb,
            host: "h".into(),
            port: 27017,
            user: "u".into(),
            password: String::new(),
            database: "d".into(),
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
            environment: None,
            auth_source: Some("admin".into()),
            replica_set: Some("rs0".into()),
            tls_enabled: Some(true),
        };
        let public = ConnectionConfigPublic::from(&conn);
        assert_eq!(public.paradigm, Paradigm::Document);

        let json = serde_json::to_string(&public).unwrap();
        assert!(
            json.contains("\"paradigm\":\"document\""),
            "paradigm tag missing from payload: {}",
            json
        );
        assert!(
            json.contains("\"auth_source\":\"admin\""),
            "auth_source missing from payload: {}",
            json
        );
        assert!(
            json.contains("\"replica_set\":\"rs0\""),
            "replica_set missing from payload: {}",
            json
        );
        assert!(
            json.contains("\"tls_enabled\":true"),
            "tls_enabled missing from payload: {}",
            json
        );
    }

    #[test]
    fn connection_config_public_rejects_payload_without_paradigm_field() {
        // Sprint 65 tightens this: a payload lacking `paradigm` must no
        // longer silently default to an empty string. (Sprint 64 allowed it
        // via `#[serde(default)]`; the ability to round-trip old clients
        // without a paradigm tag is now removed by design.)
        let json = r#"{
            "id": "c1",
            "name": "DB",
            "db_type": "postgresql",
            "host": "h",
            "port": 5432,
            "user": "u",
            "database": "d",
            "group_id": null,
            "color": null
        }"#;
        let result: Result<ConnectionConfigPublic, _> = serde_json::from_str(json);
        assert!(
            result.is_err(),
            "expected missing paradigm field to fail deserialization"
        );
    }

    #[test]
    fn connection_status_serializes_as_discriminated_union() {
        let connected = ConnectionStatus::Connected;
        let json = serde_json::to_string(&connected).unwrap();
        assert_eq!(json, "{\"type\":\"connected\"}");

        let disconnected = ConnectionStatus::Disconnected;
        let json = serde_json::to_string(&disconnected).unwrap();
        assert_eq!(json, "{\"type\":\"disconnected\"}");

        let error = ConnectionStatus::Error("timeout".into());
        let json = serde_json::to_string(&error).unwrap();
        assert_eq!(json, "{\"type\":\"error\",\"message\":\"timeout\"}");
    }

    #[test]
    fn connection_status_deserializes_from_discriminated_union() {
        let status: ConnectionStatus = serde_json::from_str("{\"type\":\"connected\"}").unwrap();
        assert!(matches!(status, ConnectionStatus::Connected));

        let status: ConnectionStatus =
            serde_json::from_str("{\"type\":\"error\",\"message\":\"lost\"}").unwrap();
        match status {
            ConnectionStatus::Error(msg) => assert_eq!(msg, "lost"),
            _ => panic!("Expected Error variant"),
        }
    }

    #[test]
    fn connection_config_serde_roundtrip() {
        let config = ConnectionConfig {
            id: "test-id".into(),
            name: "My DB".into(),
            db_type: DatabaseType::Postgresql,
            host: "localhost".into(),
            port: 5432,
            user: "postgres".into(),
            password: "secret".into(),
            database: "mydb".into(),
            group_id: Some("group-1".into()),
            color: None,
            connection_timeout: Some(60),
            keep_alive_interval: Some(15),
            environment: Some("production".into()),
            auth_source: None,
            replica_set: None,
            tls_enabled: None,
        };
        let json = serde_json::to_string(&config).unwrap();
        let deserialized: ConnectionConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(config.id, deserialized.id);
        assert_eq!(config.name, deserialized.name);
        assert_eq!(config.port, deserialized.port);
        assert_eq!(config.connection_timeout, deserialized.connection_timeout);
        assert_eq!(config.keep_alive_interval, deserialized.keep_alive_interval);
        assert_eq!(config.environment, deserialized.environment);
    }

    #[test]
    fn connection_config_optional_fields_default_to_none() {
        // Simulates data saved before timeout/keep_alive/environment were added
        // — and, from Sprint 65, before auth_source/replica_set/tls_enabled.
        let json = r#"{
            "id": "test",
            "name": "test",
            "db_type": "postgresql",
            "host": "localhost",
            "port": 5432,
            "user": "postgres",
            "password": "",
            "database": "test",
            "group_id": null,
            "color": null
        }"#;
        let config: ConnectionConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.connection_timeout, None);
        assert_eq!(config.keep_alive_interval, None);
        assert_eq!(config.environment, None);
        // Sprint 65 additions remain None for legacy payloads.
        assert_eq!(config.auth_source, None);
        assert_eq!(config.replica_set, None);
        assert_eq!(config.tls_enabled, None);
    }

    #[test]
    fn connection_config_preserves_mongo_fields_across_roundtrip() {
        let config = ConnectionConfig {
            id: "mongo-1".into(),
            name: "Mongo".into(),
            db_type: DatabaseType::Mongodb,
            host: "localhost".into(),
            port: 27017,
            user: "u".into(),
            password: "p".into(),
            database: "d".into(),
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
            environment: None,
            auth_source: Some("admin".into()),
            replica_set: Some("rs0".into()),
            tls_enabled: Some(true),
        };
        let json = serde_json::to_string(&config).unwrap();
        let deserialized: ConnectionConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.auth_source.as_deref(), Some("admin"));
        assert_eq!(deserialized.replica_set.as_deref(), Some("rs0"));
        assert_eq!(deserialized.tls_enabled, Some(true));
    }

    #[test]
    fn storage_data_serde_roundtrip() {
        let data = StorageData {
            connections: vec![ConnectionConfig {
                id: "c1".into(),
                name: "DB1".into(),
                db_type: DatabaseType::Postgresql,
                host: "host".into(),
                port: 5432,
                user: "user".into(),
                password: "pass".into(),
                database: "db".into(),
                group_id: None,
                color: Some("#ff0000".into()),
                connection_timeout: None,
                keep_alive_interval: None,
                environment: None,
                auth_source: None,
                replica_set: None,
                tls_enabled: None,
            }],
            groups: vec![ConnectionGroup {
                id: "g1".into(),
                name: "Production".into(),
                color: None,
                collapsed: false,
            }],
        };
        let json = serde_json::to_string(&data).unwrap();
        let deserialized: StorageData = serde_json::from_str(&json).unwrap();
        assert_eq!(data.connections.len(), deserialized.connections.len());
        assert_eq!(data.groups.len(), deserialized.groups.len());
        assert_eq!(data.connections[0].color, deserialized.connections[0].color);
    }
}
