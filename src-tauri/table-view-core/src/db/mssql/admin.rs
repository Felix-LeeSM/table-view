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
//!
//! Issue #1077 Stage 2 adds the read-only users/roles listing, whose source
//! (`sys.server_principals`) is deliberately NOT a DMV and therefore does NOT
//! share that fail-loud property: a catalog view is metadata-visibility
//! filtered, so an under-privileged login silently receives a truncated row set.
//! That path is gated by its own `VIEW ANY DEFINITION` probe instead — see
//! `USERS_PERMISSION_PROBE_SQL`. The probe closes the server-wide truncation,
//! not every truncation: a per-principal `DENY VIEW DEFINITION ON LOGIN::x`
//! still hides that one row from a caller that holds the server-scope grant
//! (recorded in `docs/product/known-limitations-rdbms.md`).

use tiberius::Row;

use crate::error::AppError;
use crate::models::{DatabaseUserRow, ServerActivityRow, ServerInfoRow, SlowQueryRow};

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

/// Issue #1077 Stage 2 — `sys.server_principals` is a catalog view, NOT a DMV.
/// SQL Server applies metadata-visibility filtering to it, so a login without
/// `VIEW ANY DEFINITION` gets a silently TRUNCATED principal list instead of an
/// error: `classify_view_server_state_error` never fires on that path and an
/// account-audit screen would render a partial list as complete. Probing the
/// effective permission first turns that into a loud `CapabilityNotEnabled`.
///
/// Residual, measured on SQL Server 2022 (16.0.4265.3): the probe answers for
/// the SERVER scope, so a caller holding `VIEW ANY DEFINITION` still loses a
/// single principal that carries `DENY VIEW DEFINITION ON LOGIN::x` for it —
/// probe `1`, row silently absent. Detecting that needs per-principal
/// permission reads that are themselves metadata-filtered; the boundary is
/// recorded in `docs/product/known-limitations-rdbms.md` instead.
const USERS_PERMISSION_PROBE_SQL: &str =
    "SELECT CAST(ISNULL(HAS_PERMS_BY_NAME(NULL, NULL, 'VIEW ANY DEFINITION'), 0) AS BIGINT)";

/// Issue #1077 Stage 2 — read-only logins/roles from `sys.server_principals`.
/// Only the principal name + coarse capability flags are projected;
/// `sys.sql_logins.password_hash` (the only server-login credential) is never
/// joined or selected, mirroring the PG `pg_roles`-only posture (see the
/// `users_sql_*` guard tests).
///
/// Every flag is `CAST(... AS BIGINT)` for the same reason `ACTIVITY_SQL`
/// documents above: tiberius' `i64` `FromSql` rejects a non-NULL `I32` with
/// `Error::Conversion`, and `opt_i64` swallows that into `None`, so a T-SQL
/// `int` projection would render every row as "No" with no error anywhere.
///
/// Every privilege flag is the OR of two independent sources, never a lone
/// `ISNULL(IS_SRVROLEMEMBER(...), 0)`. Measured on SQL Server 2022
/// (16.0.4265.3): `IS_SRVROLEMEMBER` returns NULL for a certificate-mapped
/// (`type = 'C'`) or asymmetric-key-mapped (`'K'`) principal and for a caller
/// that cannot resolve the membership, so collapsing NULL to 0 turns "cannot
/// resolve" into "not a member" — a false negative on an account-audit screen
/// (a `dbcreator` member rendered as unable to create databases). The recursive
/// `sys.server_role_members` walk is the NULL-free second source, while
/// `IS_SRVROLEMEMBER` still contributes the Windows-group-derived membership
/// that the catalog does not record (e.g. `NT AUTHORITY\\SYSTEM` via
/// `BUILTIN\\Administrators`), so OR-ing the two can only ever raise a flag.
/// `can_create_db` / `can_create_role` follow the fixed roles that actually
/// confer the right (`dbcreator` / `securityadmin`, plus `sysadmin`, which
/// implies both).
///
/// `can_login` whitelists the principal types that are an authentication path:
/// `'S'` SQL login, `'U'` Windows login, `'G'` Windows group, `'E'` Microsoft
/// Entra (Azure AD) login, `'X'` Entra group. A server role (`'R'`) never logs
/// in, and neither does a `'C'`/`'K'` principal — those exist only to carry
/// permissions for signed modules, so `type <> 'R'` reported them as loginable
/// accounts (false positive).
///
/// The row filter carries NO type predicate, only the `##MS_*` name filter.
/// An earlier `sp.type IN ('S', 'U', 'G', 'R', 'C', 'K')` whitelist dropped
/// every `'E'`/`'X'` Entra principal with no row and no error — on an
/// Entra-authenticated server those are the primary login subjects, so the
/// account-audit screen lost its main population silently. A type whitelist has
/// to be re-edited for every principal type SQL Server adds; listing every row
/// and deciding loginability per type cannot lose one. `##MS_*` internal
/// principals stay filtered — they are audit noise, never real accounts. Server
/// principals expose no per-login connection cap or password expiry.
const USERS_SQL: &str = "\
WITH fixed_role_members AS ( \
    SELECT r.name AS role_name, rm.member_principal_id \
    FROM sys.server_role_members rm \
    JOIN sys.server_principals r ON r.principal_id = rm.role_principal_id \
    WHERE r.name IN ('sysadmin', 'dbcreator', 'securityadmin') \
    UNION ALL \
    SELECT m.role_name, rm.member_principal_id \
    FROM sys.server_role_members rm \
    JOIN fixed_role_members m ON m.member_principal_id = rm.role_principal_id \
), principal_flags AS ( \
    SELECT sp.name AS name, \
           CASE WHEN sp.is_disabled = 0 AND sp.type IN ('S', 'U', 'G', 'E', 'X') \
                THEN 1 ELSE 0 END AS can_login, \
           CASE WHEN IS_SRVROLEMEMBER('sysadmin', sp.name) = 1 \
                     OR EXISTS (SELECT 1 FROM fixed_role_members fm \
                                WHERE fm.role_name = 'sysadmin' \
                                  AND fm.member_principal_id = sp.principal_id) \
                THEN 1 ELSE 0 END AS is_sysadmin, \
           CASE WHEN IS_SRVROLEMEMBER('dbcreator', sp.name) = 1 \
                     OR EXISTS (SELECT 1 FROM fixed_role_members fm \
                                WHERE fm.role_name = 'dbcreator' \
                                  AND fm.member_principal_id = sp.principal_id) \
                THEN 1 ELSE 0 END AS is_dbcreator, \
           CASE WHEN IS_SRVROLEMEMBER('securityadmin', sp.name) = 1 \
                     OR EXISTS (SELECT 1 FROM fixed_role_members fm \
                                WHERE fm.role_name = 'securityadmin' \
                                  AND fm.member_principal_id = sp.principal_id) \
                THEN 1 ELSE 0 END AS is_securityadmin \
    FROM sys.server_principals sp \
    WHERE sp.name NOT LIKE '##MS_%' \
) \
SELECT name, \
       CAST(can_login AS BIGINT), \
       CAST(is_sysadmin AS BIGINT), \
       CAST(CASE WHEN is_sysadmin = 1 OR is_dbcreator = 1 THEN 1 ELSE 0 END AS BIGINT), \
       CAST(CASE WHEN is_sysadmin = 1 OR is_securityadmin = 1 THEN 1 ELSE 0 END AS BIGINT) \
FROM principal_flags \
ORDER BY name";

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

    /// Issue #1077 Stage 2 — read-only logins/roles from `sys.server_principals`
    /// (`USERS_SQL`). No credential column is read. The PG-shaped
    /// `DatabaseUserRow` is reused: `name` is the principal name, `can_login`
    /// marks an enabled principal whose type is an authentication path (SQL /
    /// Windows / Entra login, Windows / Entra group — see `USERS_SQL`; a role
    /// and a certificate-/key-mapped principal are listed as non-loginable),
    /// `is_superuser` reflects `sysadmin` membership, and `can_create_db` /
    /// `can_create_role` follow the `dbcreator` / `securityadmin` fixed roles.
    /// Every principal reaches the list regardless of type. SQL Server exposes no
    /// per-login connection cap, password expiry, or portable role-membership
    /// array on the server principal, so `conn_limit` is -1 (unlimited),
    /// `valid_until` is None, and `member_of` is empty (the server-role graph
    /// is a later #1077 depth step).
    ///
    /// `sys.server_principals` is a catalog view, so a login without `VIEW ANY
    /// DEFINITION` would receive a silently truncated list rather than an
    /// error. The permission is probed first and a denial surfaces as
    /// `CapabilityNotEnabled` — an account-audit screen must never render a
    /// partial principal list as if it were complete. That probe answers for
    /// the SERVER scope, so it closes the server-wide truncation and not every
    /// truncation: a principal carrying `DENY VIEW DEFINITION ON LOGIN::x`
    /// against the connected login stays silently absent even when the probe
    /// returns `1` (recorded in `docs/product/known-limitations-rdbms.md`).
    pub async fn list_database_users(&self) -> Result<Vec<DatabaseUserRow>, AppError> {
        let probe = self
            .admin_query(
                "VIEW ANY DEFINITION probe failed",
                USERS_PERMISSION_PROBE_SQL,
            )
            .await?;
        let metadata_visible = probe.first().and_then(|row| opt_i64(row, 0)).unwrap_or(0) == 1;
        if !metadata_visible {
            return Err(AppError::CapabilityNotEnabled {
                code: "mssql_view_any_definition".into(),
                message: "This login lacks VIEW ANY DEFINITION, so SQL Server would return a \
                          silently truncated sys.server_principals list. Ask an administrator \
                          for: GRANT VIEW ANY DEFINITION TO [<login>];"
                    .into(),
            });
        }

        let rows = self
            .admin_query("sys.server_principals query failed", USERS_SQL)
            .await?;
        rows.iter()
            .map(|row| {
                // Every flag projection is a `CASE`/`ISNULL` that cannot be
                // NULL, so `req_i64` fails loud if a future edit reintroduces a
                // nullable (or non-BIGINT) expression instead of silently
                // reporting the account as unprivileged.
                Ok(DatabaseUserRow {
                    name: opt_str(row, 0, "principal name")?.unwrap_or_default(),
                    can_login: req_i64(row, 1, "can_login flag")? == 1,
                    is_superuser: req_i64(row, 2, "sysadmin flag")? == 1,
                    can_create_db: req_i64(row, 3, "dbcreator flag")? == 1,
                    can_create_role: req_i64(row, 4, "securityadmin flag")? == 1,
                    replication: false,
                    conn_limit: -1,
                    valid_until: None,
                    member_of: Vec::new(),
                })
            })
            .collect()
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

    // Issue #1077 Stage 2 (2026-07-25) — the sys.server_principals row shape
    // needs a live SQL Server (integration); the pool-acquisition guard is the
    // branch reachable without a server, mirroring the admin-op guards above.
    #[tokio::test]
    async fn list_database_users_without_connection_fails() {
        let adapter = MssqlAdapter::new();
        assert!(matches!(
            adapter.list_database_users().await,
            Err(AppError::Connection(_))
        ));
    }

    // Issue #1077 Stage 2 SECURITY (2026-07-25) — the users query must read
    // `sys.server_principals` and must NEVER touch `sys.sql_logins` or select a
    // `password_hash`, the only server-login credential. Fails if the query
    // regresses toward a secret source.
    #[test]
    fn users_sql_never_reads_login_credential() {
        assert!(
            USERS_SQL.contains("sys.server_principals"),
            "must source sys.server_principals"
        );
        let lower = USERS_SQL.to_ascii_lowercase();
        assert!(
            !lower.contains("sql_logins"),
            "sys.sql_logins carries password_hash — must not be referenced"
        );
        assert!(
            !lower.contains("password"),
            "no password_hash credential column may be selected"
        );
    }

    // Issue #1077 Stage 2 (2026-07-25) — GREEN half 1 of
    // `users_sql_projects_tsql_int_and_collapses_null_sysadmin_pre_impl`.
    // tiberius' `i64` FromSql rejects a non-NULL `I32` with `Error::Conversion`
    // and `opt_i64` swallows it into `None`, so a T-SQL `int` projection
    // renders EVERY row as "No" with no error anywhere. `ACTIVITY_SQL` already
    // documents the `CAST(... AS BIGINT)` discipline in this file.
    #[test]
    fn users_sql_casts_flag_projections_to_bigint() {
        assert!(
            !USERS_SQL.contains(" AS INT)"),
            "a T-SQL int projection decodes as I32 and is swallowed by opt_i64 — \
             every integer flag must CAST(... AS BIGINT)"
        );
        assert_eq!(
            USERS_SQL.matches("AS BIGINT").count(),
            4,
            "can_login / is_superuser / can_create_db / can_create_role must each \
             cast to BIGINT"
        );
    }

    // Issue #1077 Stage 2 SECURITY (2026-07-25) — GREEN half 2, widened to all
    // three fixed roles after the re-review (PR #1786). Verified against SQL
    // Server 2022 (16.0.4265.3): `IS_SRVROLEMEMBER` returns NULL for a
    // certificate-/asymmetric-key-mapped principal, so a lone `ISNULL(..., 0)`
    // reports "cannot resolve" as "not a member" — a real `dbcreator` renders
    // as unable to create databases. The catalog membership walk is the
    // NULL-free second source; OR-ing the two can only ever raise a flag, never
    // lower it (`IS_SRVROLEMEMBER` still contributes the Windows-group-derived
    // membership that `sys.server_role_members` does not record — e.g.
    // `NT AUTHORITY\SYSTEM` via `BUILTIN\Administrators`). The behavioral gate
    // is `test_mssql_users_null_role_membership_and_non_login_principals_1077`
    // in `tests/mssql_integration.rs`.
    #[test]
    fn users_sql_backs_every_privilege_flag_with_a_null_free_source() {
        assert!(
            USERS_SQL.contains("sys.server_role_members"),
            "the catalog membership walk is the NULL-free membership source"
        );
        assert!(
            !USERS_SQL.contains("ISNULL(IS_SRVROLEMEMBER"),
            "collapsing IS_SRVROLEMEMBER's NULL to 0 turns 'cannot resolve' into \
             'not a member' — a privilege false negative"
        );
        for role in ["sysadmin", "dbcreator", "securityadmin"] {
            assert!(
                USERS_SQL.contains(&format!("IS_SRVROLEMEMBER('{role}'")),
                "{role}: IS_SRVROLEMEMBER still contributes Windows-group-derived \
                 membership"
            );
            assert!(
                USERS_SQL.contains(&format!("WHERE fm.role_name = '{role}'")),
                "{role}: the two membership sources must be OR-ed, not a lone \
                 IS_SRVROLEMEMBER answer"
            );
        }
    }

    // Issue #1077 Stage 2 SECURITY (2026-07-25) — re-review (PR #1786): a
    // certificate-mapped (`'C'`) or asymmetric-key-mapped (`'K'`) principal
    // carries permissions for signed modules and can never authenticate, so
    // `type <> 'R'` reported it as a loginable account. 3rd review B4 widened
    // the whitelist to the Entra principals: `'E'` (Microsoft Entra login) and
    // `'X'` (Entra group) authenticate exactly like a Windows login/group, and
    // on an Entra-enabled server they are the primary login subjects.
    #[test]
    fn users_sql_limits_can_login_to_authenticatable_principal_types() {
        assert!(
            USERS_SQL.contains("sp.is_disabled = 0 AND sp.type IN ('S', 'U', 'G', 'E', 'X')"),
            "can_login must whitelist every authenticatable principal type \
             (Entra 'E'/'X' included), not exclude roles only"
        );
    }

    // Issue #1077 Stage 2 SECURITY (2026-07-25) — PR #1786 3rd review B4, data
    // loss. The row filter used to be `sp.type IN ('S', 'U', 'G', 'R', 'C', 'K')`,
    // which dropped every `'E'`/`'X'` Entra principal with no row and no error —
    // on an Entra-authenticated server that is the whole account population,
    // silently missing from an audit screen. A type whitelist has to be
    // re-edited for every principal type SQL Server adds, so the row filter must
    // stay name-only; loginability is decided per type in the projection above.
    // The live completeness gate is
    // `test_mssql_users_listing_drops_no_principal_type_1077` in
    // `tests/mssql_integration.rs`.
    #[test]
    fn users_sql_row_filter_drops_no_principal_type() {
        // The whole WHERE clause, up to the CTE's closing paren: nothing else
        // may be ANDed in, so a re-added type predicate fails here.
        assert!(
            USERS_SQL.contains("WHERE sp.name NOT LIKE '##MS_%' )"),
            "the listed-row filter must be the ##MS_* name filter only — a type \
             predicate would silently drop every type it forgets"
        );
    }

    // Issue #1077 Stage 2 SECURITY (2026-07-25) — `sys.server_principals` is a
    // catalog view, not a DMV: metadata-visibility filtering silently returns a
    // TRUNCATED row set to a login without `VIEW ANY DEFINITION` instead of
    // erroring, so `classify_view_server_state_error` never fires and an
    // account-audit screen would render a partial list as complete. The probe
    // must run first and fail loud as a capability gap.
    #[test]
    fn users_permission_probe_gates_metadata_visibility() {
        assert!(
            USERS_PERMISSION_PROBE_SQL.contains("HAS_PERMS_BY_NAME"),
            "the probe must ask the server for the effective permission"
        );
        assert!(
            USERS_PERMISSION_PROBE_SQL.contains("VIEW ANY DEFINITION"),
            "VIEW ANY DEFINITION is the permission that lifts metadata filtering"
        );
        assert!(
            USERS_PERMISSION_PROBE_SQL.contains("AS BIGINT"),
            "the probe answer decodes through opt_i64 like every other flag"
        );
    }

    // Issue #1077 Stage 2 (2026-07-25) — `##MS_*` are internal certificate/role
    // principals. They are audit noise, and the certificate-mapped ones are
    // exactly the rows where `IS_SRVROLEMEMBER` returns NULL.
    #[test]
    fn users_sql_filters_internal_ms_principals() {
        assert!(
            USERS_SQL.contains("NOT LIKE '##MS_%'"),
            "internal ##MS_* principals must not reach the panel"
        );
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
