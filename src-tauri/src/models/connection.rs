use serde::{Deserialize, Serialize};
use std::str::FromStr;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseType {
    #[default]
    Postgresql,
    Mysql,
    Mariadb,
    Sqlite,
    Duckdb,
    Mssql,
    Oracle,
    Mongodb,
    Redis,
    Valkey,
    Elasticsearch,
    Opensearch,
}

impl DatabaseType {
    /// Paradigm tag exposed to the frontend. Sprint 65 promotes this from the
    /// previous `&'static str` return type to a typed `Paradigm` enum so the
    /// wire format is a validated discriminated tag rather than a free-form
    /// string.
    pub fn paradigm(&self) -> Paradigm {
        match self {
            DatabaseType::Postgresql
            | DatabaseType::Mysql
            | DatabaseType::Mariadb
            | DatabaseType::Sqlite
            | DatabaseType::Duckdb
            | DatabaseType::Mssql
            | DatabaseType::Oracle => Paradigm::Rdb,
            DatabaseType::Mongodb => Paradigm::Document,
            DatabaseType::Redis | DatabaseType::Valkey => Paradigm::Kv,
            DatabaseType::Elasticsearch | DatabaseType::Opensearch => Paradigm::Search,
        }
    }
}

impl FromStr for DatabaseType {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "postgresql" => Ok(DatabaseType::Postgresql),
            "mysql" => Ok(DatabaseType::Mysql),
            "mariadb" => Ok(DatabaseType::Mariadb),
            "sqlite" => Ok(DatabaseType::Sqlite),
            "duckdb" => Ok(DatabaseType::Duckdb),
            "mssql" | "sqlserver" | "sqlsrv" => Ok(DatabaseType::Mssql),
            "oracle" => Ok(DatabaseType::Oracle),
            "mongodb" => Ok(DatabaseType::Mongodb),
            "redis" => Ok(DatabaseType::Redis),
            "valkey" => Ok(DatabaseType::Valkey),
            "elasticsearch" | "elastic" | "es" => Ok(DatabaseType::Elasticsearch),
            "opensearch" | "os" => Ok(DatabaseType::Opensearch),
            _ => Err(()),
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

#[derive(Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub id: String,
    pub name: String,
    pub db_type: DatabaseType,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: String,
    /// SQLite-only: open the user-managed database file without write access.
    #[serde(default)]
    pub read_only: bool,
    pub group_id: Option<String>,
    pub color: Option<String>,
    #[serde(default)]
    pub connection_timeout: Option<u32>,
    #[serde(default)]
    pub keep_alive_interval: Option<u32>,
    #[serde(default)]
    pub environment: Option<String>,
    // ── Source-specific optional fields. ─────────────────────────────────
    // Fields are `#[serde(default)]` so existing persisted JSON
    // (which lacks these keys entirely) still deserializes unchanged.
    /// MongoDB authentication database (`authSource`). Ignored by non-mongo
    /// adapters.
    #[serde(default)]
    pub auth_source: Option<String>,
    /// MongoDB replica set name. Ignored by non-mongo adapters.
    #[serde(default)]
    pub replica_set: Option<String>,
    /// Whether to enable TLS/encryption for adapters that support it.
    #[serde(default)]
    pub tls_enabled: Option<bool>,
    /// SQL Server trust-server-certificate decision. `None` means the caller
    /// did not make an explicit certificate decision; MSSQL TLS paths require
    /// an explicit value.
    #[serde(default)]
    pub trust_server_certificate: Option<bool>,
}

/// P3-2 (#1455) — manual `Debug` so an accidental `{:?}` (log line, error
/// context, `#[derive(Debug)]` on an enclosing struct) never prints the
/// plaintext `password`. Every other field is rendered as-is; `password` is
/// masked to a fixed `"***"` regardless of length so the debug output leaks
/// neither the value nor whether one is set. The derived `Debug` printed the
/// password verbatim.
impl std::fmt::Debug for ConnectionConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ConnectionConfig")
            .field("id", &self.id)
            .field("name", &self.name)
            .field("db_type", &self.db_type)
            .field("host", &self.host)
            .field("port", &self.port)
            .field("user", &self.user)
            .field("password", &"***")
            .field("database", &self.database)
            .field("read_only", &self.read_only)
            .field("group_id", &self.group_id)
            .field("color", &self.color)
            .field("connection_timeout", &self.connection_timeout)
            .field("keep_alive_interval", &self.keep_alive_interval)
            .field("environment", &self.environment)
            .field("auth_source", &self.auth_source)
            .field("replica_set", &self.replica_set)
            .field("tls_enabled", &self.tls_enabled)
            .field("trust_server_certificate", &self.trust_server_certificate)
            .finish()
    }
}

/// Public-facing connection shape returned to the frontend and exported to
/// JSON. Crucially this struct has **no password field** — the boolean
/// `hasPassword` is the only signal the UI gets about whether a password is
/// stored. The plaintext never leaves the backend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfigPublic {
    pub id: String,
    pub name: String,
    #[serde(alias = "db_type")]
    pub db_type: DatabaseType,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub database: String,
    #[serde(default, alias = "read_only")]
    pub read_only: bool,
    #[serde(alias = "group_id")]
    pub group_id: Option<String>,
    pub color: Option<String>,
    #[serde(default, alias = "connection_timeout")]
    pub connection_timeout: Option<u32>,
    #[serde(default, alias = "keep_alive_interval")]
    pub keep_alive_interval: Option<u32>,
    #[serde(default)]
    pub environment: Option<String>,
    /// Whether a password is stored on disk. Derived, never persisted.
    #[serde(default, alias = "has_password")]
    pub has_password: bool,
    /// Paradigm tag derived from `db_type`. Sprint 65 tightens this from the
    /// previous `String` + `#[serde(default)]` shape into a typed
    /// [`Paradigm`] enum; payloads lacking this field now fail to
    /// deserialize instead of silently defaulting to `""`. The frontend
    /// `Paradigm` string-literal union (`"rdb" | "document" | "search" |
    /// "kv"`) mirrors the lowercase serialization.
    pub paradigm: Paradigm,
    // ── Source-specific optional fields ──────────────────────────────────
    #[serde(default, alias = "auth_source")]
    pub auth_source: Option<String>,
    #[serde(default, alias = "replica_set")]
    pub replica_set: Option<String>,
    #[serde(default, alias = "tls_enabled")]
    pub tls_enabled: Option<bool>,
    #[serde(default, alias = "trust_server_certificate")]
    pub trust_server_certificate: Option<bool>,
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
            read_only: c.read_only,
            group_id: c.group_id.clone(),
            color: c.color.clone(),
            connection_timeout: c.connection_timeout,
            keep_alive_interval: c.keep_alive_interval,
            environment: c.environment.clone(),
            has_password: !c.password.is_empty(),
            auth_source: c.auth_source.clone(),
            replica_set: c.replica_set.clone(),
            tls_enabled: c.tls_enabled,
            trust_server_certificate: c.trust_server_certificate,
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
            read_only: self.read_only,
            group_id: self.group_id,
            color: self.color,
            connection_timeout: self.connection_timeout,
            keep_alive_interval: self.keep_alive_interval,
            environment: self.environment,
            auth_source: self.auth_source,
            replica_set: self.replica_set,
            tls_enabled: self.tls_enabled,
            trust_server_certificate: self.trust_server_certificate,
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

/// Internally-tagged enum for a clean discriminated union on the frontend.
///
/// Sprint 364 (Phase 3 Q14) — `Connecting` variant 추가 + `Connected` 가
/// struct variant 로 승격되어 `active_db: Option<String>` 을 운반한다.
/// `active_db` 는 PG `USE db` 결과 또는 connection string 의 `dbname` 으로,
/// `connect` IPC 가 pool 을 열 때 결정된다.
///
/// Serializes as:
/// - `{"type": "connecting"}` — connect IPC 진행 중 (pool acquire 전).
/// - `{"type": "connected"}` — pool ready, active_db 미지정.
/// - `{"type": "connected", "activeDb": "foo"}` — pool ready, active_db 지정.
/// - `{"type": "disconnected"}`
/// - `{"type": "error", "message": "..."}`
///
/// `active_db: None` 일 때 wire 에 `activeDb: null` 이 나타나지 않도록
/// `skip_serializing_if = "Option::is_none"` 로 필드를 omit (codex 3차 #6).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum ConnectionStatus {
    Connecting,
    Connected {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        active_db: Option<String>,
    },
    #[default]
    Disconnected,
    Error {
        message: String,
    },
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

    /// P3-2 (#1455) — `{:?}` on a `ConnectionConfig` must never leak the
    /// plaintext password. Low-entropy fake password keeps the no-secrets gate
    /// quiet while still proving the mask fires.
    #[test]
    fn debug_masks_password() {
        let conn = ConnectionConfig {
            id: "c1".into(),
            name: "DB".into(),
            db_type: DatabaseType::Postgresql,
            host: "h".into(),
            port: 5432,
            user: "u".into(),
            password: "pass@789ZZ".into(),
            database: "d".into(),
            read_only: false,
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
            environment: None,
            auth_source: None,
            replica_set: None,
            tls_enabled: None,
            trust_server_certificate: None,
        };
        let debug = format!("{conn:?}");
        assert!(
            !debug.contains("pass@789ZZ"),
            "debug output leaked the password: {debug}"
        );
        assert!(
            debug.contains("password: \"***\""),
            "debug output missing the password mask: {debug}"
        );
        // The rest of the struct still renders so debug stays useful.
        assert!(debug.contains("host: \"h\""));
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
            DatabaseType::Mariadb,
            DatabaseType::Sqlite,
            DatabaseType::Duckdb,
            DatabaseType::Mssql,
            DatabaseType::Oracle,
            DatabaseType::Mongodb,
            DatabaseType::Redis,
            DatabaseType::Valkey,
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
        let json = serde_json::to_string(&DatabaseType::Mariadb).unwrap();
        assert_eq!(json, "\"mariadb\"");
        let json = serde_json::to_string(&DatabaseType::Duckdb).unwrap();
        assert_eq!(json, "\"duckdb\"");
        let json = serde_json::to_string(&DatabaseType::Mssql).unwrap();
        assert_eq!(json, "\"mssql\"");
        let json = serde_json::to_string(&DatabaseType::Oracle).unwrap();
        assert_eq!(json, "\"oracle\"");
        let json = serde_json::to_string(&DatabaseType::Valkey).unwrap();
        assert_eq!(json, "\"valkey\"");
    }

    #[test]
    fn database_type_paradigm_maps_expected_tags() {
        assert_eq!(DatabaseType::Postgresql.paradigm(), Paradigm::Rdb);
        assert_eq!(DatabaseType::Mysql.paradigm(), Paradigm::Rdb);
        assert_eq!(DatabaseType::Mariadb.paradigm(), Paradigm::Rdb);
        assert_eq!(DatabaseType::Sqlite.paradigm(), Paradigm::Rdb);
        assert_eq!(DatabaseType::Duckdb.paradigm(), Paradigm::Rdb);
        assert_eq!(DatabaseType::Mssql.paradigm(), Paradigm::Rdb);
        assert_eq!(DatabaseType::Oracle.paradigm(), Paradigm::Rdb);
        assert_eq!(DatabaseType::Mongodb.paradigm(), Paradigm::Document);
        assert_eq!(DatabaseType::Redis.paradigm(), Paradigm::Kv);
        assert_eq!(DatabaseType::Valkey.paradigm(), Paradigm::Kv);
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
            read_only: false,
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
            environment: None,
            auth_source: None,
            replica_set: None,
            tls_enabled: None,
            trust_server_certificate: None,
        };
        let public = ConnectionConfigPublic::from(&conn);
        assert_eq!(public.paradigm, Paradigm::Rdb);

        let json = serde_json::to_string(&public).unwrap();
        assert!(
            json.contains("\"paradigm\":\"rdb\""),
            "paradigm tag missing from payload: {}",
            json
        );
        assert!(
            json.contains("\"dbType\":\"postgresql\""),
            "db_type must serialize as dbType: {}",
            json
        );
        assert!(
            json.contains("\"hasPassword\":true"),
            "has_password must serialize as hasPassword: {}",
            json
        );
        assert!(
            !json.contains("db_type") && !json.contains("has_password"),
            "public connection wire shape must not expose snake_case keys: {}",
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
            read_only: false,
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
            environment: None,
            auth_source: Some("admin".into()),
            replica_set: Some("rs0".into()),
            tls_enabled: Some(true),
            trust_server_certificate: None,
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
            json.contains("\"authSource\":\"admin\""),
            "authSource missing from payload: {}",
            json
        );
        assert!(
            json.contains("\"replicaSet\":\"rs0\""),
            "replicaSet missing from payload: {}",
            json
        );
        assert!(
            json.contains("\"tlsEnabled\":true"),
            "tlsEnabled missing from payload: {}",
            json
        );
        assert!(
            !json.contains("auth_source")
                && !json.contains("replica_set")
                && !json.contains("tls_enabled"),
            "public connection wire shape must not expose snake_case keys: {}",
            json
        );
    }

    #[test]
    fn connection_config_public_deserializes_legacy_snake_case_payload() {
        let json = r#"{
            "id": "c1",
            "name": "DB",
            "db_type": "mongodb",
            "host": "localhost",
            "port": 27017,
            "user": "u",
            "database": "admin",
            "group_id": "g1",
            "color": null,
            "connection_timeout": 30,
            "keep_alive_interval": 60,
            "environment": "production",
            "has_password": true,
            "paradigm": "document",
            "auth_source": "admin",
            "replica_set": "rs0",
            "tls_enabled": true
        }"#;

        let public: ConnectionConfigPublic = serde_json::from_str(json).unwrap();

        assert!(matches!(public.db_type, DatabaseType::Mongodb));
        assert_eq!(public.group_id.as_deref(), Some("g1"));
        assert_eq!(public.connection_timeout, Some(30));
        assert_eq!(public.keep_alive_interval, Some(60));
        assert!(public.has_password);
        assert_eq!(public.auth_source.as_deref(), Some("admin"));
        assert_eq!(public.replica_set.as_deref(), Some("rs0"));
        assert_eq!(public.tls_enabled, Some(true));
        assert_eq!(public.trust_server_certificate, None);
    }

    #[test]
    fn connection_config_public_deserializes_trust_server_certificate_wire_keys() {
        let camel = r#"{
            "id": "c1",
            "name": "SQL Server",
            "dbType": "mssql",
            "host": "localhost",
            "port": 1433,
            "user": "sa",
            "database": "master",
            "groupId": null,
            "color": null,
            "paradigm": "rdb",
            "trustServerCertificate": true
        }"#;
        let public: ConnectionConfigPublic = serde_json::from_str(camel).unwrap();
        assert_eq!(public.trust_server_certificate, Some(true));

        let snake = r#"{
            "id": "c1",
            "name": "SQL Server",
            "db_type": "mssql",
            "host": "localhost",
            "port": 1433,
            "user": "sa",
            "database": "master",
            "group_id": null,
            "color": null,
            "paradigm": "rdb",
            "trust_server_certificate": false
        }"#;
        let public: ConnectionConfigPublic = serde_json::from_str(snake).unwrap();
        assert_eq!(public.trust_server_certificate, Some(false));
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
            "dbType": "postgresql",
            "host": "h",
            "port": 5432,
            "user": "u",
            "database": "d",
            "groupId": null,
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
        // Sprint 364 (2026-05-16) — `Connected { active_db: None }` 평면
        // 직렬화 + `Error { message: ... }` struct variant 평면 직렬화
        // 회귀 가드. 4-case 전체 wire shape 는 `tests/connection_status_serde.rs`.
        let connected = ConnectionStatus::Connected { active_db: None };
        let json = serde_json::to_string(&connected).unwrap();
        assert_eq!(json, "{\"type\":\"connected\"}");

        let disconnected = ConnectionStatus::Disconnected;
        let json = serde_json::to_string(&disconnected).unwrap();
        assert_eq!(json, "{\"type\":\"disconnected\"}");

        let error = ConnectionStatus::Error {
            message: "timeout".into(),
        };
        let json = serde_json::to_string(&error).unwrap();
        assert_eq!(json, "{\"type\":\"error\",\"message\":\"timeout\"}");
    }

    #[test]
    fn connection_status_deserializes_from_discriminated_union() {
        let status: ConnectionStatus = serde_json::from_str("{\"type\":\"connected\"}").unwrap();
        match status {
            ConnectionStatus::Connected { active_db } => assert!(active_db.is_none()),
            other => panic!("Expected Connected variant, got {:?}", other),
        }

        let status: ConnectionStatus =
            serde_json::from_str("{\"type\":\"error\",\"message\":\"lost\"}").unwrap();
        match status {
            ConnectionStatus::Error { message } => assert_eq!(message, "lost"),
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
            read_only: false,
            group_id: Some("group-1".into()),
            color: None,
            connection_timeout: Some(60),
            keep_alive_interval: Some(15),
            environment: Some("production".into()),
            auth_source: None,
            replica_set: None,
            tls_enabled: None,
            trust_server_certificate: None,
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
        assert_eq!(config.trust_server_certificate, None);
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
            read_only: false,
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
            environment: None,
            auth_source: Some("admin".into()),
            replica_set: Some("rs0".into()),
            tls_enabled: Some(true),
            trust_server_certificate: None,
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
                read_only: false,
                group_id: None,
                color: Some("#ff0000".into()),
                connection_timeout: None,
                keep_alive_interval: None,
                environment: None,
                auth_source: None,
                replica_set: None,
                tls_enabled: None,
                trust_server_certificate: None,
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
