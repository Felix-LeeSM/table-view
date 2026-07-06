use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Represents the type of SQL query that was executed
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QueryType {
    /// SELECT queries and other read-only statements (WITH, SHOW, etc.)
    Select,
    /// Data Manipulation Language (INSERT, UPDATE, DELETE)
    Dml { rows_affected: u64 },
    /// Data Definition Language (CREATE, ALTER, DROP, etc.)
    Ddl,
}

/// Display category for a column — drives DataGrid layout (default width
/// and text-align). Independent of the raw `data_type`, which is preserved
/// verbatim for structure / records views (Sprint 238 AC-238-02).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ColumnCategory {
    Int,
    Float,
    Text,
    Bool,
    Datetime,
    Object,
    Binary,
    Enum,
    /// UUID 류 (PG `uuid`, Mongo `objectId`). text 보다 폭이 넓고
    /// (36 자 고정 + dash 4 개), text-align left.
    Uuid,
    #[default]
    Unknown,
}

/// Column metadata for a query result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryColumn {
    /// Column name
    pub name: String,
    /// Column data type (database-specific type name)
    pub data_type: String,
    /// Display category — UI policy hint (width + alignment).
    pub category: ColumnCategory,
}

/// Sprint 336 — U1 wire shape. PG `pg_stat_activity` row / Mongo
/// `currentOp` op are flattened into the same struct so the activity
/// grid renders both paradigms with the same component. Optional
/// fields cover paradigm differences (PG has `wait_event`, Mongo has
/// `secs_running` etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerActivityRow {
    /// PG `pid` or Mongo `opid`. Wire shape uses i64 so very long-running
    /// Mongo ops fit even when the driver hands back a 64-bit integer.
    pub id: i64,
    pub db: Option<String>,
    pub user: Option<String>,
    pub state: Option<String>,
    pub query: Option<String>,
    pub wait_event: Option<String>,
    pub started_at: Option<String>,
}

/// Sprint 338 — U3 wire shape. PG `pg_stat_user_tables` + `pg_class`
/// row / Mongo `collStats` runCommand response are mapped into the
/// same struct so the stats panel renders both paradigms with the
/// same component. Paradigm-specific extras land in `extras` as a
/// loose JSON map (UI surfaces them as a "raw" subsection without
/// owning their semantics).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionStatsRow {
    /// Approximate row / document count.
    pub rows: i64,
    /// On-disk size in bytes (PG: `pg_total_relation_size`,
    /// Mongo: `storageSize`).
    pub size_bytes: i64,
    /// Number of secondary indexes (PG: `idx_scan` count not relevant —
    /// uses `pg_index` count; Mongo: `nindexes`).
    pub indexes: i64,
    /// Last vacuum / compaction (PG: `last_vacuum`; Mongo: None).
    pub last_vacuum: Option<String>,
    /// Last analyze / sample (PG: `last_analyze`; Mongo: None).
    pub last_analyze: Option<String>,
    /// Sequential scans (PG: `seq_scan`; Mongo: None).
    pub seq_scans: Option<i64>,
    /// Index scans (PG: `idx_scan`; Mongo: None).
    pub idx_scans: Option<i64>,
    /// Dead tuple count (PG: `n_dead_tup`; Mongo: None).
    pub n_dead: Option<i64>,
    /// Paradigm-specific extras (Mongo: `capped`, `avgObjSize`, etc.).
    pub extras: std::collections::HashMap<String, Value>,
}

/// Sprint 340 — U5 wire shape. PG `pg_stat_statements` row / Mongo
/// `system.profile` document flattened into the same struct for the
/// SlowQueryPanel. `extras` carries paradigm-specific fields (Mongo
/// keysExamined/docsExamined/ts/ns/...).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlowQueryRow {
    /// PG: `query` text; Mongo: `command` BSON serialised to JSON.
    pub query: String,
    /// PG: `calls`; Mongo: 1 per profile doc (no aggregation upstream).
    pub calls: i64,
    /// PG: `total_exec_time` ms; Mongo: `millis`.
    pub total_exec_time_ms: f64,
    /// PG: `mean_exec_time` ms; Mongo: same as total (single sample).
    pub mean_exec_time_ms: f64,
    /// PG: `rows`; Mongo: `nreturned`.
    pub rows: i64,
    /// Paradigm-specific raw fields (Mongo ts/ns/keysExamined/...).
    pub extras: std::collections::HashMap<String, Value>,
}

/// Sprint 339 — U4 wire shape. PG `version() + pg_settings` row /
/// Mongo `buildInfo + serverStatus` response flattened into the same
/// struct for the ServerInfoPanel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfoRow {
    /// PG: `version()` string; Mongo: `buildInfo.version`.
    pub version: String,
    /// PG: `inet_server_addr()` (optional, NULL on local socket);
    /// Mongo: `serverStatus.host`.
    pub host: Option<String>,
    /// PG: `pg_postmaster_start_time()` (relative seconds);
    /// Mongo: `serverStatus.uptime`.
    pub uptime_sec: Option<i64>,
    /// PG: count from `pg_stat_activity`;
    /// Mongo: `serverStatus.connections.active`.
    pub connections_active: Option<i64>,
    /// Paradigm-specific raw blob — pg_settings rows or
    /// serverStatus subsections.
    pub extras: std::collections::HashMap<String, Value>,
}

/// Issue #1077 Stage 2 — users/roles read-only wire shape. A PG `pg_roles`
/// row flattened for the read-only accounts/permissions panel. `pg_roles`
/// is deliberately the source (NOT `pg_authid` / `pg_shadow`): it masks
/// `rolpassword` as `********` and never exposes the password hash, so this
/// struct carries no secret column. `member_of` lists the roles this role is
/// a member of (the "permissions" surface). Non-PG RDB engines and non-RDB
/// paradigms are unsupported for now (PG-first parity lane).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseUserRow {
    /// Role name (`rolname`). Both login "users" and non-login "roles"
    /// appear — PG unifies them, so this panel is genuinely users + roles.
    pub name: String,
    /// `rolcanlogin` — true for a login-capable account, false for a group role.
    pub can_login: bool,
    /// `rolsuper` — superuser flag.
    pub is_superuser: bool,
    /// `rolcreatedb` — may create databases.
    pub can_create_db: bool,
    /// `rolcreaterole` — may create/alter other roles.
    pub can_create_role: bool,
    /// `rolreplication` — replication privilege.
    pub replication: bool,
    /// `rolconnlimit` — max concurrent connections (-1 = unlimited).
    pub conn_limit: i64,
    /// `rolvaliduntil` — password expiry as ISO-8601 UTC text, or None if
    /// no expiry set. This is an expiry timestamp, NOT a credential.
    pub valid_until: Option<String>,
    /// Roles this role is a member of (`pg_auth_members`), sorted by name.
    pub member_of: Vec<String>,
}

/// Result of an arbitrary SQL query execution
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    /// Column metadata (names and types)
    pub columns: Vec<QueryColumn>,
    /// Row data as JSON values (organized by column)
    pub rows: Vec<Vec<Value>>,
    /// Total number of rows returned/affected
    pub total_count: i64,
    /// Query execution time in milliseconds
    pub execution_time_ms: u64,
    /// Type of query that was executed
    pub query_type: QueryType,
    /// Issue #1231 — `true` when the SELECT result hit the raw-query row cap
    /// and rows beyond the cap were dropped at fetch time. Only meaningful
    /// for `QueryType::Select`; DML/DDL always leave this `false`. Tolerant
    /// of absent (`#[serde(default)]`) so legacy payloads / non-adapter
    /// constructors deserialize unchanged.
    #[serde(default)]
    pub truncated: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json;

    #[test]
    fn column_category_int_serializes_lowercase() {
        // Sprint 238 AC-238-02 — category enum 은 frontend 의 ColumnCategory
        // string-literal 과 일치해야 한다 (snake_case → "int").
        let category = ColumnCategory::Int;
        let json = serde_json::to_string(&category).unwrap();
        assert_eq!(json, "\"int\"");
    }

    #[test]
    fn all_column_categories_serialize_lowercase() {
        // 9 종 + unknown = 10. Frontend ColumnCategory union 과 일치 검증.
        let pairs: &[(ColumnCategory, &str)] = &[
            (ColumnCategory::Int, "int"),
            (ColumnCategory::Float, "float"),
            (ColumnCategory::Text, "text"),
            (ColumnCategory::Bool, "bool"),
            (ColumnCategory::Datetime, "datetime"),
            (ColumnCategory::Object, "object"),
            (ColumnCategory::Binary, "binary"),
            (ColumnCategory::Enum, "enum"),
            (ColumnCategory::Uuid, "uuid"),
            (ColumnCategory::Unknown, "unknown"),
        ];
        for (variant, expected) in pairs {
            let json = serde_json::to_string(variant).unwrap();
            assert_eq!(json, format!("\"{expected}\""));
        }
    }

    #[test]
    fn query_type_select_serializes_correctly() {
        let qt = QueryType::Select;
        let json = serde_json::to_string(&qt).unwrap();
        assert_eq!(json, "\"select\"");

        let deserialized: QueryType = serde_json::from_str(&json).unwrap();
        assert!(matches!(deserialized, QueryType::Select));
    }

    #[test]
    fn query_type_dml_serializes_correctly() {
        let qt = QueryType::Dml { rows_affected: 42 };
        let json = serde_json::to_string(&qt).unwrap();
        assert_eq!(json, "{\"dml\":{\"rows_affected\":42}}");

        let deserialized: QueryType = serde_json::from_str(&json).unwrap();
        match deserialized {
            QueryType::Dml { rows_affected } => {
                assert_eq!(rows_affected, 42);
            }
            _ => panic!("Expected Dml variant"),
        }
    }

    #[test]
    fn query_type_ddl_serializes_correctly() {
        let qt = QueryType::Ddl;
        let json = serde_json::to_string(&qt).unwrap();
        assert_eq!(json, "\"ddl\"");

        let deserialized: QueryType = serde_json::from_str(&json).unwrap();
        assert!(matches!(deserialized, QueryType::Ddl));
    }

    #[test]
    fn query_column_serializes_correctly() {
        let col = QueryColumn {
            name: "user_id".to_string(),
            data_type: "integer".to_string(),
            category: ColumnCategory::Unknown,
        };
        let json = serde_json::to_string(&col).unwrap();
        assert!(
            json.contains("\"dataType\":\"integer\""),
            "query column wire shape must be camelCase: {json}"
        );
        assert!(
            !json.contains("data_type"),
            "query column wire shape must not expose snake_case: {json}"
        );
        let deserialized: QueryColumn = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.name, "user_id");
        assert_eq!(deserialized.data_type, "integer");
    }

    #[test]
    fn query_result_select_serializes_correctly() {
        let result = QueryResult {
            truncated: false,
            columns: vec![
                QueryColumn {
                    name: "id".to_string(),
                    data_type: "integer".to_string(),
                    category: ColumnCategory::Unknown,
                },
                QueryColumn {
                    name: "name".to_string(),
                    data_type: "text".to_string(),
                    category: ColumnCategory::Unknown,
                },
            ],
            rows: vec![
                vec![Value::Number(1.into()), Value::String("Alice".to_string())],
                vec![Value::Number(2.into()), Value::String("Bob".to_string())],
            ],
            total_count: 2,
            execution_time_ms: 15,
            query_type: QueryType::Select,
        };

        let json = serde_json::to_string(&result).unwrap();
        assert!(
            json.contains("\"dataType\":\"integer\""),
            "nested query column wire shape must be camelCase: {json}"
        );
        assert!(
            json.contains("\"totalCount\":2"),
            "query result total_count must serialize as totalCount: {json}"
        );
        assert!(
            json.contains("\"executionTimeMs\":15"),
            "query result execution_time_ms must serialize as executionTimeMs: {json}"
        );
        assert!(
            json.contains("\"queryType\":\"select\""),
            "query result query_type must serialize as queryType: {json}"
        );
        assert!(
            !json.contains("total_count")
                && !json.contains("execution_time_ms")
                && !json.contains("query_type"),
            "query result wire shape must not expose snake_case keys: {json}"
        );
        let deserialized: QueryResult = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.columns.len(), 2);
        assert_eq!(deserialized.rows.len(), 2);
        assert_eq!(deserialized.total_count, 2);
        assert_eq!(deserialized.execution_time_ms, 15);
        assert!(matches!(deserialized.query_type, QueryType::Select));
    }

    #[test]
    fn query_result_dml_serializes_correctly() {
        let result = QueryResult {
            truncated: false,
            columns: vec![],
            rows: vec![],
            total_count: 5,
            execution_time_ms: 8,
            query_type: QueryType::Dml { rows_affected: 5 },
        };

        let json = serde_json::to_string(&result).unwrap();
        let deserialized: QueryResult = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.total_count, 5);
        assert_eq!(deserialized.execution_time_ms, 8);
        match deserialized.query_type {
            QueryType::Dml { rows_affected } => {
                assert_eq!(rows_affected, 5);
            }
            _ => panic!("Expected Dml variant"),
        }
    }

    #[test]
    fn query_result_ddl_serializes_correctly() {
        let result = QueryResult {
            truncated: false,
            columns: vec![],
            rows: vec![],
            total_count: 0,
            execution_time_ms: 120,
            query_type: QueryType::Ddl,
        };

        let json = serde_json::to_string(&result).unwrap();
        let deserialized: QueryResult = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.total_count, 0);
        assert_eq!(deserialized.execution_time_ms, 120);
        assert!(matches!(deserialized.query_type, QueryType::Ddl));
    }
}
