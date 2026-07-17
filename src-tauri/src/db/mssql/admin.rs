//! Issue #1073 (U1/U4/U5 SQL Server parity) — admin ops
//! (activity / kill / slow / info).
//!
//! SQL Server was one of the two RDB backends still inheriting the
//! `RdbAdapter` admin-op `Unsupported` defaults (PG/Mongo/MySQL already serve
//! the OperationsPanel flyout). The native sources are the `sys.dm_exec_*`
//! dynamic management views. All four reads open a fresh client (same as the
//! catalog surface), so the adapter's own session is excluded via `@@SPID`,
//! mirroring the PG `pg_backend_pid()` / MySQL `CONNECTION_ID()` filter.
//!
//! The server-scoped DMVs (`dm_exec_requests`, `dm_exec_sql_text`,
//! `dm_exec_query_stats`, `dm_os_sys_info`) need `VIEW SERVER STATE`; a login
//! without it makes the query error out — surfaced verbatim rather than
//! swallowed into a silently empty list (parity with the MySQL
//! performance_schema-off fail-loud contract).

use tiberius::Row;

use crate::error::AppError;
use crate::models::{ServerActivityRow, ServerInfoRow, SlowQueryRow};

use super::MssqlAdapter;

/// Backend sessions, own session excluded, most-recently-active first. `id` is
/// `CAST(... AS BIGINT)` for the wire i64 (`session_id` is a `smallint`);
/// `wait_type` is only populated while a request is actively waiting, else
/// `None`; `started_at` is `last_request_start_time` rendered ISO-8601 by the
/// server (style 126) to avoid a `chrono` decode dependency.
const ACTIVITY_SQL: &str = "\
SELECT CAST(s.session_id AS BIGINT), \
       DB_NAME(s.database_id), \
       s.login_name, \
       s.status, \
       t.text, \
       r.wait_type, \
       CONVERT(VARCHAR(33), s.last_request_start_time, 126) \
FROM sys.dm_exec_sessions s \
LEFT JOIN sys.dm_exec_requests r ON r.session_id = s.session_id \
OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t \
WHERE s.session_id <> @@SPID AND s.is_user_process = 1 \
ORDER BY s.last_request_start_time DESC";

/// Server identity via `SERVERPROPERTY` (no special grant) plus uptime /
/// active connections from `sys.dm_os_sys_info` + `sys.dm_exec_sessions`
/// (`VIEW SERVER STATE`). `extras` mirrors the PG `{ name: { setting } }`
/// shape so the panel's raw subsection renders both engines with one path.
const SERVER_INFO_SQL: &str = "\
SELECT CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(128)), \
       CAST(SERVERPROPERTY('MachineName') AS NVARCHAR(128)), \
       CAST(DATEDIFF(SECOND, si.sqlserver_start_time, GETDATE()) AS BIGINT), \
       CAST((SELECT COUNT(*) FROM sys.dm_exec_sessions WHERE is_user_process = 1) AS BIGINT), \
       CAST(SERVERPROPERTY('Edition') AS NVARCHAR(128)), \
       CAST(SERVERPROPERTY('ProductLevel') AS NVARCHAR(128)), \
       CAST(SERVERPROPERTY('Collation') AS NVARCHAR(128)) \
FROM sys.dm_os_sys_info si";

impl MssqlAdapter {
    /// Issue #1073 — list backend sessions from `sys.dm_exec_sessions`
    /// (+ `dm_exec_requests` / `dm_exec_sql_text` for the running statement).
    pub async fn list_server_activity(&self) -> Result<Vec<ServerActivityRow>, AppError> {
        let rows = self
            .admin_query("sys.dm_exec_sessions query failed", ACTIVITY_SQL)
            .await?;
        rows.iter()
            .map(|row| {
                Ok(ServerActivityRow {
                    id: req_i64(row, 0, "session id")?,
                    db: opt_str(row, 1, "db")?,
                    user: opt_str(row, 2, "login")?,
                    state: opt_str(row, 3, "status")?,
                    query: opt_str(row, 4, "sql text")?,
                    wait_event: opt_str(row, 5, "wait type")?,
                    started_at: opt_str(row, 6, "started at")?,
                })
            })
            .collect()
    }

    /// Issue #1073 — terminate a backend session by id. `KILL` is not accepted
    /// in the prepared-statement protocol, so the id is interpolated; this is
    /// injection-safe because `id: i64` is a typed integer. Parity with the PG
    /// `pg_terminate_backend` no-op contract: killing an id that is not an
    /// active/valid SPID (errors 6106 / 6101) is swallowed as a successful
    /// no-op. Any other error (e.g. missing `ALTER ANY CONNECTION`) surfaces.
    pub async fn kill_session(&self, id: i64) -> Result<(), AppError> {
        let config = self.connected_config().await?;
        let mut client = Self::connect_client(&config).await?;
        let sql = format!("KILL {id}");
        let started = client.simple_query(&sql).await;
        match started {
            Ok(stream) => match stream.into_results().await {
                Ok(_) => Ok(()),
                Err(err) => classify_kill_error(err),
            },
            Err(err) => classify_kill_error(err),
        }
    }

    /// Issue #1073 — top-N slow queries from `sys.dm_exec_query_stats` joined to
    /// the normalised statement text. Ordered by mean elapsed time. Timer
    /// columns are microseconds — `CAST(... AS FLOAT)` divides to milliseconds
    /// to match the PG `_ms` wire fields. `limit` is trusted (the caller clamps
    /// it) and interpolated as a typed i64 into `TOP (n)` — injection-safe.
    pub async fn slow_queries(&self, limit: i64) -> Result<Vec<SlowQueryRow>, AppError> {
        let sql = format!(
            "SELECT t.text, \
                    qs.execution_count, \
                    CAST(qs.total_elapsed_time / 1000.0 AS FLOAT), \
                    CAST(qs.total_elapsed_time / NULLIF(qs.execution_count, 0) / 1000.0 AS FLOAT), \
                    qs.total_rows \
             FROM sys.dm_exec_query_stats qs \
             CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) t \
             WHERE t.text IS NOT NULL \
             ORDER BY qs.total_elapsed_time / NULLIF(qs.execution_count, 0) DESC \
             OFFSET 0 ROWS FETCH NEXT {limit} ROWS ONLY"
        );
        let rows = self
            .admin_query("sys.dm_exec_query_stats query failed", &sql)
            .await?;
        Ok(rows
            .iter()
            .map(|row| SlowQueryRow {
                query: opt_str_lossy(row, 0),
                calls: opt_i64(row, 1).unwrap_or(0),
                total_exec_time_ms: opt_f64(row, 2).unwrap_or(0.0),
                mean_exec_time_ms: opt_f64(row, 3).unwrap_or(0.0),
                rows: opt_i64(row, 4).unwrap_or(0),
                extras: std::collections::HashMap::new(),
            })
            .collect())
    }

    /// Issue #1073 — server identity + uptime / active connections + a few
    /// `SERVERPROPERTY` tuning facts (edition/level/collation) in `extras`.
    pub async fn server_info(&self) -> Result<ServerInfoRow, AppError> {
        let rows = self
            .admin_query("SQL Server info query failed", SERVER_INFO_SQL)
            .await?;
        let row = rows
            .first()
            .ok_or_else(|| AppError::Database("SQL Server info query returned no row".into()))?;

        let mut extras = std::collections::HashMap::new();
        for (idx, name) in [(4, "edition"), (5, "productLevel"), (6, "collation")] {
            if let Some(value) = opt_str(row, idx, name)? {
                extras.insert(name.to_string(), serde_json::json!({ "setting": value }));
            }
        }

        Ok(ServerInfoRow {
            version: opt_str(row, 0, "version")?.unwrap_or_default(),
            host: opt_str(row, 1, "host")?,
            uptime_sec: opt_i64(row, 2),
            connections_active: opt_i64(row, 3),
            extras,
        })
    }

    /// Open a fresh client (same as the catalog surface) and return the first
    /// result set. A `VIEW SERVER STATE`-denied login is classified as
    /// `CapabilityNotEnabled` so the panel renders a passive grant hint; any
    /// other error fails loud as `Database` rather than a silently empty list.
    async fn admin_query(&self, context: &'static str, sql: &str) -> Result<Vec<Row>, AppError> {
        let config = self.connected_config().await?;
        let mut client = Self::connect_client(&config).await?;
        let stream = client
            .simple_query(sql)
            .await
            .map_err(|err| admin_query_error(context, err))?;
        let rows = stream
            .into_first_result()
            .await
            .map_err(|err| admin_query_error(context, err))?;
        Ok(rows)
    }
}

/// Map a DMV query error to `CapabilityNotEnabled` when the login lacks
/// `VIEW SERVER STATE`, else `Database`. Kept separate from `admin_query` so the
/// classification is unit-testable without a live server.
fn admin_query_error(context: &'static str, err: tiberius::error::Error) -> AppError {
    let msg = err.to_string();
    match classify_view_server_state_error(err.code(), &msg) {
        Some(code) => AppError::CapabilityNotEnabled {
            code: code.into(),
            message: format!("{context}: {msg}"),
        },
        None => AppError::Database(format!("{context}: {msg}")),
    }
}

/// `Some("mssql_view_server_state")` when the error is a `VIEW SERVER STATE`
/// permission denial (error 300 / the generic permission error 297, or the
/// message text), `None` otherwise. Pure for unit testing.
fn classify_view_server_state_error(code: Option<u32>, msg: &str) -> Option<&'static str> {
    if matches!(code, Some(300) | Some(297)) || msg.contains("VIEW SERVER STATE") {
        Some("mssql_view_server_state")
    } else {
        None
    }
}

fn classify_kill_error(err: tiberius::error::Error) -> Result<(), AppError> {
    let msg = err.to_string();
    if kill_error_is_absent_spid(err.code(), &msg) {
        Ok(())
    } else {
        Err(AppError::Database(format!("KILL failed: {msg}")))
    }
}

/// SQL Server raises 6106 ("not an active process ID") / 6101 ("not a valid
/// process ID") when `KILL` targets an id that is not a live session. Both are
/// swallowed as a no-op for parity with the PG `pg_terminate_backend` contract.
fn kill_error_is_absent_spid(code: Option<u32>, msg: &str) -> bool {
    if matches!(code, Some(6106) | Some(6101)) {
        return true;
    }
    let lower = msg.to_ascii_lowercase();
    lower.contains("not an active process") || lower.contains("not a valid process")
}

fn req_i64(row: &Row, idx: usize, label: &'static str) -> Result<i64, AppError> {
    opt_i64(row, idx).ok_or_else(|| AppError::Database(format!("SQL Server {label} was NULL")))
}

fn opt_i64(row: &Row, idx: usize) -> Option<i64> {
    row.try_get::<i64, _>(idx).ok().flatten()
}

fn opt_f64(row: &Row, idx: usize) -> Option<f64> {
    row.try_get::<f64, _>(idx).ok().flatten()
}

fn opt_str(row: &Row, idx: usize, label: &'static str) -> Result<Option<String>, AppError> {
    row.try_get::<&str, _>(idx)
        .map(|value| value.map(str::to_string))
        .map_err(|err| AppError::Database(format!("SQL Server {label} decode failed: {err}")))
}

fn opt_str_lossy(row: &Row, idx: usize) -> String {
    row.try_get::<&str, _>(idx)
        .ok()
        .flatten()
        .unwrap_or_default()
        .to_string()
}

#[cfg(test)]
mod tests {
    //! The SQL bodies need a live SQL Server (covered by the testcontainer smoke
    //! in `tests/mssql_connection_routing.rs`); the pool-acquisition guard is the
    //! branch reachable without a server, mirroring the PG/MySQL
    //! `*_without_connection_fails` unit cases. `kill_session` takes a typed i64
    //! (no identifier to validate) — its guard also documents that no string
    //! reaches the SQL.
    use super::*;
    use crate::error::AppError;

    #[tokio::test]
    async fn list_server_activity_without_connection_fails() {
        let adapter = MssqlAdapter::new();
        assert!(matches!(
            adapter.list_server_activity().await,
            Err(AppError::Connection(_))
        ));
    }

    #[tokio::test]
    async fn kill_session_without_connection_fails() {
        let adapter = MssqlAdapter::new();
        assert!(matches!(
            adapter.kill_session(42).await,
            Err(AppError::Connection(_))
        ));
    }

    #[tokio::test]
    async fn slow_queries_without_connection_fails() {
        let adapter = MssqlAdapter::new();
        assert!(matches!(
            adapter.slow_queries(10).await,
            Err(AppError::Connection(_))
        ));
    }

    #[tokio::test]
    async fn server_info_without_connection_fails() {
        let adapter = MssqlAdapter::new();
        assert!(matches!(
            adapter.server_info().await,
            Err(AppError::Connection(_))
        ));
    }

    #[test]
    fn kill_swallows_absent_spid_and_surfaces_other_errors() {
        // Parity no-op: an id that is not an active/valid SPID is a success,
        // matched by the server error code or the message text.
        assert!(kill_error_is_absent_spid(Some(6106), "irrelevant"));
        assert!(kill_error_is_absent_spid(Some(6101), "irrelevant"));
        assert!(kill_error_is_absent_spid(
            None,
            "Process ID 2000000000 is not an active process ID."
        ));
        assert!(kill_error_is_absent_spid(
            None,
            "Process ID 5 is not a valid process ID. Choose a number between 1 and 100."
        ));
        // Anything else fails loud (e.g. a permission error).
        assert!(!kill_error_is_absent_spid(
            Some(297),
            "The user does not have permission to perform this action."
        ));
        assert!(!kill_error_is_absent_spid(
            None,
            "some unrelated driver error"
        ));
    }

    // Reason: a login without VIEW SERVER STATE is a permission gap, not a bug —
    // the DMV admin queries must classify it as CapabilityNotEnabled (passive UI
    // grant hint) while unrelated errors stay Database (2026-07-17, slow-query UX).
    #[test]
    fn classify_view_server_state_maps_permission_denial_only() {
        assert_eq!(
            classify_view_server_state_error(Some(300), "irrelevant"),
            Some("mssql_view_server_state")
        );
        assert_eq!(
            classify_view_server_state_error(Some(297), "irrelevant"),
            Some("mssql_view_server_state")
        );
        assert_eq!(
            classify_view_server_state_error(
                None,
                "VIEW SERVER STATE permission was denied on object 'server'"
            ),
            Some("mssql_view_server_state")
        );
        assert_eq!(
            classify_view_server_state_error(Some(208), "Invalid object name"),
            None
        );
    }
}
