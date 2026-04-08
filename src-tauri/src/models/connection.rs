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
