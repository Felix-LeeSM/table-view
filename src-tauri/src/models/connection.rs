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

    /// Paradigm tag exposed to the frontend. Sprint 64 introduces this so the
    /// UI can (eventually) branch on relational vs document vs search vs kv
    /// connections. This sprint only serializes the tag — consumers do not
    /// yet branch on it.
    pub fn paradigm(&self) -> &'static str {
        match self {
            DatabaseType::Postgresql | DatabaseType::Mysql | DatabaseType::Sqlite => "rdb",
            DatabaseType::Mongodb => "document",
            DatabaseType::Redis => "kv",
        }
    }
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
    /// Paradigm tag derived from `db_type` (`"rdb"`, `"document"`, `"search"`,
    /// `"kv"`). Added in Sprint 64 so the frontend can route UI off it in
    /// future phases. Serialized on every response; deserialization defaults
    /// to the empty string so that older persisted JSON (which lacks this
    /// field) still loads.
    #[serde(default)]
    pub paradigm: String,
}

impl From<&ConnectionConfig> for ConnectionConfigPublic {
    fn from(c: &ConnectionConfig) -> Self {
        Self {
            id: c.id.clone(),
            name: c.name.clone(),
            paradigm: c.db_type.paradigm().to_string(),
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
        assert_eq!(DatabaseType::Postgresql.paradigm(), "rdb");
        assert_eq!(DatabaseType::Mysql.paradigm(), "rdb");
        assert_eq!(DatabaseType::Sqlite.paradigm(), "rdb");
        assert_eq!(DatabaseType::Mongodb.paradigm(), "document");
        assert_eq!(DatabaseType::Redis.paradigm(), "kv");
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
        };
        let public = ConnectionConfigPublic::from(&conn);
        assert_eq!(public.paradigm, "rdb");

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
        };
        let public = ConnectionConfigPublic::from(&conn);
        assert_eq!(public.paradigm, "document");
    }

    #[test]
    fn connection_config_public_deserializes_without_paradigm_field() {
        // Payload shape from older Sprint 63 clients — no `paradigm` key.
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
        let public: ConnectionConfigPublic = serde_json::from_str(json).unwrap();
        // Default is empty string; callers must reconstruct via From<&ConnectionConfig>
        // when they need the derived value.
        assert_eq!(public.paradigm, "");
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
