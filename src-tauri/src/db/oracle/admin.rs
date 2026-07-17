//! Issue #1073 (U1/U4/U5 Oracle parity) — admin ops
//! (activity / kill / slow / info).
//!
//! Oracle was the last RDB backend inheriting the `RdbAdapter` admin-op
//! `Unsupported` defaults. The native sources are the `v$` dynamic performance
//! views (`v$session`, `v$sql`, `v$instance`). Like the catalog surface, each
//! op opens a fresh connection and closes it.
//!
//! The `v$` views require a catalog read grant (`SELECT_CATALOG_ROLE` /
//! `SELECT ANY DICTIONARY` / an explicit `V_$SESSION` grant). A login without
//! it raises `ORA-00942` (table or view does not exist) — surfaced verbatim as
//! a `Database` error rather than swallowed into a silently empty list. The
//! strict `query_rows` path (no metadata-denied fallback) is what makes that
//! fail-loud, per the issue's Oracle privilege note.

use std::collections::HashMap;

use oracle_rs::{Connection as OracleConnection, Row, Value};

use crate::error::AppError;
use crate::models::{ServerActivityRow, ServerInfoRow, SlowQueryRow};

use super::{connection_timeout_secs, OracleAdapter};

/// Backend user sessions, own session excluded via `USERENV('SID')`, newest
/// logon first. `sid` is the wire `id` (Oracle's per-session key; the composite
/// `serial#` is resolved at kill time). The active statement text is joined
/// from `v$sql`; `event` is the current wait event.
const ACTIVITY_SQL: &str = "\
SELECT s.sid, \
       s.service_name, \
       s.username, \
       s.status, \
       q.sql_text, \
       s.event, \
       TO_CHAR(s.logon_time, 'YYYY-MM-DD HH24:MI:SS') \
FROM v$session s \
LEFT JOIN v$sql q ON q.sql_id = s.sql_id AND q.child_number = s.sql_child_number \
WHERE s.type = 'USER' \
  AND s.sid <> SYS_CONTEXT('USERENV', 'SID') \
ORDER BY s.logon_time DESC";

/// Top-N statements from `v$sql` ordered by mean elapsed time. `elapsed_time`
/// is microseconds — divided by 1000 to milliseconds to match the PG `_ms`
/// wire fields. `:1` is the trusted, caller-clamped limit bound as an integer.
const SLOW_QUERIES_SQL: &str = "\
SELECT sql_text, \
       executions, \
       elapsed_time / 1000, \
       elapsed_time / GREATEST(executions, 1) / 1000, \
       rows_processed \
FROM ( \
    SELECT sql_text, executions, elapsed_time, rows_processed \
    FROM v$sql \
    WHERE executions > 0 \
    ORDER BY elapsed_time / GREATEST(executions, 1) DESC \
) \
WHERE ROWNUM <= :1";

/// Server identity + uptime + active user sessions from `v$instance`, with
/// instance/status facts in `extras` (PG `{ name: { setting } }` shape).
const SERVER_INFO_SQL: &str = "\
SELECT i.version, \
       i.host_name, \
       ROUND((SYSDATE - i.startup_time) * 86400), \
       (SELECT COUNT(*) FROM v$session WHERE type = 'USER'), \
       i.instance_name, \
       i.status, \
       i.database_status \
FROM v$instance i";

/// Resolve the current `serial#` for a `sid` so the composite kill key can be
/// built. No row means the session is already gone (no-op parity).
const KILL_LOOKUP_SQL: &str = "SELECT serial# FROM v$session WHERE sid = :1";

impl OracleAdapter {
    /// Issue #1073 — list backend user sessions from `v$session` (+ `v$sql`).
    pub async fn list_server_activity(&self) -> Result<Vec<ServerActivityRow>, AppError> {
        let rows = self
            .admin_query("Oracle v$session query failed", ACTIVITY_SQL, &[])
            .await?;
        rows.iter()
            .map(|row| {
                Ok(ServerActivityRow {
                    id: row_i64(row, 0, "session sid")?
                        .ok_or_else(|| AppError::Database("Oracle session sid was NULL".into()))?,
                    db: row_opt_string(row, 1, "service name")?,
                    user: row_opt_string(row, 2, "username")?,
                    state: row_opt_string(row, 3, "status")?,
                    query: row_opt_string(row, 4, "sql text")?,
                    wait_event: row_opt_string(row, 5, "event")?,
                    started_at: row_opt_string(row, 6, "logon time")?,
                })
            })
            .collect()
    }

    /// Issue #1073 — terminate a session by id. Oracle's kill key is the
    /// composite `sid,serial#`, so the current `serial#` is resolved for `id`
    /// (an already-gone session yields no row → successful no-op, parity with
    /// PG `pg_terminate_backend`). `ALTER SYSTEM KILL` is not parameterizable,
    /// so both integers are interpolated — injection-safe because `id: i64` is
    /// typed and `serial#` comes from the catalog. A vanished session between
    /// lookup and kill (`ORA-00030`) is also swallowed; a privilege error
    /// (`ORA-01031`) surfaces.
    pub async fn kill_session(&self, id: i64) -> Result<(), AppError> {
        let lookup = self
            .admin_query(
                "Oracle v$session serial# lookup failed",
                KILL_LOOKUP_SQL,
                &[Value::Integer(id)],
            )
            .await?;
        let Some(serial) = lookup.first().and_then(|row| match row.values().first() {
            Some(Value::Integer(value)) => Some(*value),
            Some(Value::Number(value)) => value.to_i64().ok(),
            _ => None,
        }) else {
            return Ok(());
        };

        let statement = format!("ALTER SYSTEM KILL SESSION '{id},{serial}'");
        let connection = self.open_admin_connection().await?;
        let result = match connection.execute(&statement, &[]).await {
            Ok(_) => Ok(()),
            Err(err) => {
                let msg = err.to_string();
                if msg.to_ascii_uppercase().contains("ORA-00030") {
                    Ok(())
                } else {
                    Err(AppError::Database(format!(
                        "Oracle kill session failed: {msg}"
                    )))
                }
            }
        };
        close_connection(connection, result).await
    }

    /// Issue #1073 — top-N slow statements from `v$sql`.
    pub async fn slow_queries(&self, limit: i64) -> Result<Vec<SlowQueryRow>, AppError> {
        let rows = self
            .admin_query(
                "Oracle v$sql query failed",
                SLOW_QUERIES_SQL,
                &[Value::Integer(limit)],
            )
            .await?;
        Ok(rows
            .iter()
            .map(|row| SlowQueryRow {
                query: row_opt_string(row, 0, "sql text")
                    .ok()
                    .flatten()
                    .unwrap_or_default(),
                calls: row_i64(row, 1, "executions").ok().flatten().unwrap_or(0),
                total_exec_time_ms: row_f64(row, 2).unwrap_or(0.0),
                mean_exec_time_ms: row_f64(row, 3).unwrap_or(0.0),
                rows: row_i64(row, 4, "rows processed")
                    .ok()
                    .flatten()
                    .unwrap_or(0),
                extras: HashMap::new(),
            })
            .collect())
    }

    /// Issue #1073 — server identity + uptime from `v$instance`.
    pub async fn server_info(&self) -> Result<ServerInfoRow, AppError> {
        let rows = self
            .admin_query("Oracle v$instance query failed", SERVER_INFO_SQL, &[])
            .await?;
        let row = rows
            .first()
            .ok_or_else(|| AppError::Database("Oracle v$instance returned no row".into()))?;

        let mut extras = HashMap::new();
        for (idx, name) in [(4, "instanceName"), (5, "status"), (6, "databaseStatus")] {
            if let Some(value) = row_opt_string(row, idx, name)? {
                extras.insert(name.to_string(), serde_json::json!({ "setting": value }));
            }
        }

        Ok(ServerInfoRow {
            version: row_opt_string(row, 0, "version")?.unwrap_or_default(),
            host: row_opt_string(row, 1, "host name")?,
            uptime_sec: row_i64(row, 2, "uptime")?,
            connections_active: row_i64(row, 3, "active connections")?,
            extras,
        })
    }

    async fn admin_query(
        &self,
        context: &'static str,
        sql: &str,
        params: &[Value],
    ) -> Result<Vec<Row>, AppError> {
        let connection = self.open_admin_connection().await?;
        let result = query_rows(&connection, context, sql, params).await;
        close_connection(connection, result).await
    }

    async fn open_admin_connection(&self) -> Result<OracleConnection, AppError> {
        let config = self.connected_config().await?;
        let timeout_secs = connection_timeout_secs(&config);
        Self::open_connection(&config, timeout_secs).await
    }
}

/// Strict fetch (no metadata-denied fallback) so a `v$` privilege denial fails
/// loud. Mirrors the catalog `query_rows` cursor-pagination shape.
async fn query_rows(
    connection: &OracleConnection,
    context: &'static str,
    sql: &str,
    params: &[Value],
) -> Result<Vec<Row>, AppError> {
    let mut result = connection
        .query(sql, params)
        .await
        .map_err(|err| AppError::Database(format!("{context}: {err}")))?;
    let columns = result.columns.clone();
    let mut rows = result.rows;

    while result.has_more_rows {
        if result.cursor_id == 0 {
            return Err(AppError::Database(format!(
                "{context}: Oracle returned a partial cursor without a cursor id"
            )));
        }
        result = connection
            .fetch_more(result.cursor_id, &columns, 100)
            .await
            .map_err(|err| AppError::Database(format!("{context}: {err}")))?;
        rows.extend(result.rows);
    }

    Ok(rows)
}

async fn close_connection<T>(
    connection: OracleConnection,
    result: Result<T, AppError>,
) -> Result<T, AppError> {
    let close_result = connection
        .close()
        .await
        .map_err(super::map_oracle_connection_error);
    match (result, close_result) {
        (Ok(value), Ok(())) => Ok(value),
        (Ok(_), Err(error)) => Err(error),
        (Err(error), _) => Err(error),
    }
}

fn row_opt_string(row: &Row, idx: usize, label: &'static str) -> Result<Option<String>, AppError> {
    let value = row.values().get(idx).ok_or_else(|| {
        AppError::Database(format!(
            "Oracle {label} decode failed: missing column {idx}"
        ))
    })?;
    Ok(match value {
        Value::Null => None,
        Value::String(value) => Some(value.clone()),
        Value::Integer(value) => Some(value.to_string()),
        Value::Float(value) => Some(value.to_string()),
        Value::Number(value) => Some(value.as_str().to_string()),
        other => Some(other.to_string()),
    })
}

fn row_i64(row: &Row, idx: usize, label: &'static str) -> Result<Option<i64>, AppError> {
    let value = row.values().get(idx).ok_or_else(|| {
        AppError::Database(format!(
            "Oracle {label} decode failed: missing column {idx}"
        ))
    })?;
    match value {
        Value::Null => Ok(None),
        Value::Integer(value) => Ok(Some(*value)),
        Value::Number(value) => value
            .to_i64()
            .map(Some)
            .map_err(|err| AppError::Database(format!("Oracle {label} decode failed: {err}"))),
        Value::Float(value) => Ok(Some(*value as i64)),
        _ => Err(AppError::Database(format!(
            "Oracle {label} decode failed: expected numeric value"
        ))),
    }
}

fn row_f64(row: &Row, idx: usize) -> Option<f64> {
    match row.values().get(idx)? {
        Value::Integer(value) => Some(*value as f64),
        Value::Float(value) => Some(*value),
        Value::Number(value) => value.to_f64().ok(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    //! The SQL bodies need a live Oracle (covered by the ignored smoke in
    //! `tests/oracle_smoke_boundary_probe.rs`, run against the seeded CI Oracle
    //! per #1609). The connection guard is the branch reachable without a
    //! server, mirroring the PG/MySQL/MSSQL `*_without_connection_fails` cases.
    //! The decoders are exercised directly on synthetic `v$` rows.
    use super::*;
    use crate::error::AppError;
    use oracle_rs::types::OracleNumber;

    #[tokio::test]
    async fn list_server_activity_without_connection_fails() {
        let adapter = OracleAdapter::new();
        assert!(matches!(
            adapter.list_server_activity().await,
            Err(AppError::Connection(_))
        ));
    }

    #[tokio::test]
    async fn kill_session_without_connection_fails() {
        let adapter = OracleAdapter::new();
        assert!(matches!(
            adapter.kill_session(42).await,
            Err(AppError::Connection(_))
        ));
    }

    #[tokio::test]
    async fn slow_queries_without_connection_fails() {
        let adapter = OracleAdapter::new();
        assert!(matches!(
            adapter.slow_queries(10).await,
            Err(AppError::Connection(_))
        ));
    }

    #[tokio::test]
    async fn server_info_without_connection_fails() {
        let adapter = OracleAdapter::new();
        assert!(matches!(
            adapter.server_info().await,
            Err(AppError::Connection(_))
        ));
    }

    #[test]
    fn decoders_map_v_dollar_row_shapes() {
        // A v$sql-like row: sql_text, executions, total_ms, mean_ms, rows.
        let row = Row::new(vec![
            Value::String("SELECT 1 FROM dual".into()),
            Value::Integer(7),
            Value::Number(OracleNumber::new("1234.5")),
            Value::Float(176.35),
            Value::Null,
        ]);

        assert_eq!(
            row_opt_string(&row, 0, "sql text").unwrap().as_deref(),
            Some("SELECT 1 FROM dual")
        );
        assert_eq!(row_i64(&row, 1, "executions").unwrap(), Some(7));
        assert_eq!(row_f64(&row, 2), Some(1234.5));
        assert_eq!(row_f64(&row, 3), Some(176.35));
        assert_eq!(row_i64(&row, 4, "rows").unwrap(), None);
        assert_eq!(row_f64(&row, 4), None);
    }
}
