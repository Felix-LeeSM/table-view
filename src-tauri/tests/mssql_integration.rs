//! Issue #1642 — SQL Server adapter integration gate: `stream_table_rows` plus
//! the vendor-restorable T-SQL schema-dump round-trip. Mirrors the #1654 MySQL
//! round-trip (`tests/mysql_integration.rs`).
//!
//! Docker-gated: `common::setup_mssql_adapter()` silent-skips (`None`) when no
//! SQL Server container/endpoint is reachable (Docker down, or the amd64-only
//! `mcr.microsoft.com/mssql/server` image unavailable on Apple silicon without
//! Rosetta). Point at an external server with
//! `MSSQL_HOST=... MSSQL_PORT=... cargo mssql-test`.
//!
//! The `stream_table_rows unsupported for oracle/duckdb` test is NOT docker-
//! gated — it asserts the trait-default `Unsupported` contract for engines that
//! never wire a streaming body, and runs anywhere.

mod common;

use table_view_lib::db::mssql::MssqlAdapter;
use table_view_lib::db::{DuckdbAdapter, RdbAdapter};
use table_view_lib::error::AppError;
use table_view_lib::models::{ColumnDefinition, CreateTableRequest, DropTableRequest};

// SQL Server's namespace is the schema; the testcontainer connects to `master`
// and everything lives under the default `dbo` schema.
const MSSQL_SCHEMA: &str = "dbo";

fn ts() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis()
}

fn col(name: &str, data_type: &str, nullable: bool) -> ColumnDefinition {
    ColumnDefinition {
        name: name.into(),
        data_type: data_type.into(),
        nullable,
        default_value: None,
        comment: None,
        is_identity: false,
    }
}

fn create_req(table: &str, columns: Vec<ColumnDefinition>) -> CreateTableRequest {
    CreateTableRequest {
        connection_id: "unused".into(),
        schema: MSSQL_SCHEMA.into(),
        name: table.into(),
        columns,
        primary_key: Some(vec!["id".into()]),
        preview_only: false,
        table_comment: None,
        expected_database: None,
    }
}

fn drop_req(table: &str) -> DropTableRequest {
    DropTableRequest {
        connection_id: "unused".into(),
        schema: MSSQL_SCHEMA.into(),
        table: table.into(),
        cascade: false,
        preview_only: false,
        expected_database: None,
    }
}

/// [AC-1642-04] Vendor-restorable dump round-trip — issue #1642 / #1077 Stage 1.
/// Drives the REAL dump path (`run_schema_dump` → `stream_table_rows` → mpsc
/// drain → T-SQL INSERT writer) against live SQL Server, restores the emitted
/// SQL into the same (emptied) table, and asserts the restored rows equal the
/// source rows. A leftover `::jsonb` cast, ANSI/backtick identifier, or a
/// `TRUE`/`FALSE` boolean (which T-SQL rejects) would make the restore fail
/// outright, so a green restore is itself the dialect proof.
#[tokio::test]
#[serial_test::serial]
async fn test_mssql_dump_round_trip_restores_into_mssql() {
    use std::sync::Arc;
    use table_view_lib::commands::connection::AppState;
    use table_view_lib::commands::export::{
        run_schema_dump, ExportDumpTable, ExportInclude, ExportSchemaDumpOptions,
    };
    use table_view_lib::db::row_cap::DEFAULT_ROW_CAP;
    use table_view_lib::db::ActiveAdapter;
    use table_view_lib::models::{ColumnCategory, DatabaseType};

    // `MssqlAdapter` is not `Clone` (Mutex-guarded config), so take two
    // independent connections to the same container: one for seed/readback,
    // one to hand to `AppState` for the dump.
    let adapter = match common::setup_mssql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let dump_adapter = match common::setup_mssql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let table = format!("test_dump_rt_{}", ts());

    // MSSQL `execute_query` rejects raw DDL by design (#903), so the table is
    // created through the structured DDL builder.
    adapter
        .create_table(&create_req(
            &table,
            vec![
                col("id", "int", false),
                col("name", "nvarchar(255)", true),
                col("note", "nvarchar(255)", true),
                col("flag", "bit", true),
                // #1677 — varbinary exercises the binary-literal dump path.
                col("bin_col", "varbinary(16)", true),
            ],
        ))
        .await
        .expect("CREATE TABLE");

    // Seed tricky values: single quote (→ `''`), backslash (a T-SQL literal,
    // NOT escaped — the opposite of MySQL), embedded double quote, NULL, a BIT
    // column (proves bool → `1`/`0`), and (#1642 B1) non-ASCII Unicode that a
    // non-`N` restore literal would code-page-fold to `?`. Seed literals carry
    // their own `N` prefix so the source rows store the true Unicode. (#1677)
    // `bin_col` carries a control byte (`0x0aff00`) that only survives an
    // unquoted binary literal, plus a NULL binary cell to prove NULL is left
    // alone.
    let seed = format!(
        "INSERT INTO {MSSQL_SCHEMA}.{table} (id, name, note, flag, bin_col) VALUES \
         (1, N'O''Reilly', N'C:\\path\\file', 1, 0x0aff00), \
         (2, N'plain', N'has,comma and space', 0, 0xdeadbeef), \
         (3, N'quote\"and\\slash', NULL, 1, NULL), \
         (4, N'안녕세계', N'日本語 emoji 💡', 0, 0x00)"
    );
    adapter
        .execute_query(&seed, None, DEFAULT_ROW_CAP)
        .await
        .expect("seed INSERT");

    async fn read_all(adapter: &MssqlAdapter, table: &str) -> Vec<Vec<String>> {
        let result = adapter
            .execute_query(
                &format!(
                    "SELECT id, name, note, flag, bin_col FROM {MSSQL_SCHEMA}.{table} ORDER BY id"
                ),
                None,
                DEFAULT_ROW_CAP,
            )
            .await
            .expect("SELECT readback");
        result
            .rows
            .iter()
            .map(|row| row.iter().map(|cell| cell.to_string()).collect())
            .collect()
    }
    let source_rows = read_all(&adapter, &table).await;
    assert_eq!(source_rows.len(), 4, "seed should have 4 rows");

    // Drive the real dump through AppState with an MSSQL dialect.
    let state = AppState::new();
    {
        let mut active = state.active_connections.lock().await;
        active.insert(
            "dump-conn".into(),
            Arc::new(ActiveAdapter::Rdb(Box::new(dump_adapter))),
        );
    }
    let dir = tempfile::TempDir::new().unwrap();
    let dump_path = dir.path().join("mssql_dump.sql");
    let summary = run_schema_dump(
        &state,
        "dump-conn",
        &dump_path,
        "",
        "",
        &[ExportDumpTable {
            schema: MSSQL_SCHEMA.to_string(),
            table: table.clone(),
            column_names: vec![
                "id".into(),
                "name".into(),
                "note".into(),
                "flag".into(),
                "bin_col".into(),
            ],
            // #1677 — `bin_col` is Binary → unquoted `0x…` literal; the rest keep
            // the quoted path. Order mirrors `column_names`.
            column_categories: vec![
                ColumnCategory::Int,
                ColumnCategory::Text,
                ColumnCategory::Text,
                ColumnCategory::Bool,
                ColumnCategory::Binary,
            ],
        }],
        &ExportSchemaDumpOptions {
            include: ExportInclude::Dml,
            batch_size: 100,
            dialect: DatabaseType::Mssql,
        },
        None,
    )
    .await
    .expect("dump");
    assert_eq!(summary.rows_written, 4);

    let dump_sql = std::fs::read_to_string(&dump_path).unwrap();
    // Dialect proof: bracket identifiers; no ANSI/backtick identifier, no PG
    // jsonb cast, no non-T-SQL boolean literal, backslash stays single, and
    // (#1642 B1) every string literal is `N'...'` so Unicode survives restore.
    assert!(
        dump_sql.contains(&format!("INSERT INTO [{MSSQL_SCHEMA}].[{table}]")),
        "dump missing bracket INSERT: {dump_sql}"
    );
    assert!(!dump_sql.contains("::jsonb"), "dump leaked PG jsonb cast");
    assert!(
        !dump_sql.contains(&format!("`{table}`")),
        "dump leaked MySQL backtick identifier: {dump_sql}"
    );
    assert!(
        !dump_sql.contains(&format!(r#""{table}""#)),
        "dump leaked ANSI double-quote identifier: {dump_sql}"
    );
    assert!(
        !dump_sql.contains("TRUE") && !dump_sql.contains("FALSE"),
        "dump leaked non-T-SQL boolean literal: {dump_sql}"
    );
    assert!(
        dump_sql.contains(r"N'C:\path\file'"),
        "T-SQL literal must keep a single backslash under N-prefix: {dump_sql}"
    );
    assert!(
        dump_sql.contains("N'안녕세계'"),
        "Unicode literal must be N-prefixed to survive restore: {dump_sql}"
    );
    // #1677 — the varbinary cell dumps as an unquoted T-SQL binary literal, never
    // a quoted `N'0x…'` (which would restore the hex text rather than the bytes).
    assert!(
        dump_sql.contains("0x0aff00") && !dump_sql.contains("N'0x0aff00'"),
        "binary column must dump as an unquoted T-SQL binary literal: {dump_sql}"
    );

    // Restore: empty the table, replay each dumped INSERT statement.
    adapter
        .execute_query(
            &format!("DELETE FROM {MSSQL_SCHEMA}.{table}"),
            None,
            DEFAULT_ROW_CAP,
        )
        .await
        .expect("DELETE");
    let mut restored = 0_u64;
    for line in dump_sql.lines() {
        if line.starts_with("INSERT INTO") {
            adapter
                .execute_query(line, None, DEFAULT_ROW_CAP)
                .await
                .unwrap_or_else(|e| panic!("restore failed on `{line}`: {e:?}"));
            restored += 1;
        }
    }
    assert_eq!(restored, 4, "should replay 4 INSERT statements");

    let restored_rows = read_all(&adapter, &table).await;
    assert_eq!(
        restored_rows, source_rows,
        "restored rows must match source after T-SQL round-trip (incl. Unicode)"
    );

    adapter.drop_table(&drop_req(&table)).await.ok();
}

/// Mirror of the MySQL `stream_table_rows aborts when receiver drops` gate.
#[tokio::test]
#[serial_test::serial]
async fn test_mssql_stream_table_rows_aborts_when_receiver_drops() {
    use table_view_lib::db::row_cap::DEFAULT_ROW_CAP;

    let adapter = match common::setup_mssql_adapter().await {
        Some(a) => a,
        None => return,
    };
    let table = format!("test_stream_drop_{}", ts());
    adapter
        .create_table(&create_req(&table, vec![col("id", "int", false)]))
        .await
        .expect("CREATE");

    let mut values = String::new();
    for i in 1..=20 {
        if i > 1 {
            values.push(',');
        }
        values.push_str(&format!("({i})"));
    }
    adapter
        .execute_query(
            &format!("INSERT INTO {MSSQL_SCHEMA}.{table} (id) VALUES {values}"),
            None,
            DEFAULT_ROW_CAP,
        )
        .await
        .expect("INSERT");

    let (sender, rx) = tokio::sync::mpsc::channel(1);
    drop(rx);
    let cols = vec!["id".to_string()];
    let err = adapter
        .stream_table_rows(MSSQL_SCHEMA, &table, 1, &cols, sender, None)
        .await
        .expect_err("dropped receiver should abort");
    match err {
        AppError::Database(msg) => assert!(
            msg.contains("Receiver dropped"),
            "expected receiver-drop error, got: {msg}"
        ),
        other => panic!("expected Database, got {other:?}"),
    }

    adapter.drop_table(&drop_req(&table)).await.ok();
}

/// [AC-1642-05] DuckDB keeps the trait-default `Unsupported` `stream_table_rows`
/// — no docker required. Guards against a stray override silently opening
/// DML/Full dumps for the one remaining non-promoted RDB engine. Oracle used to
/// share this guard but is now a promoted streaming engine (#1674); its boundary
/// lives in `tests/oracle_integration.rs`.
#[tokio::test]
async fn test_stream_table_rows_unsupported_for_duckdb() {
    let cols = vec!["id".to_string()];

    let duckdb = DuckdbAdapter::new();
    let (tx, _rx) = tokio::sync::mpsc::channel(1);
    let err = duckdb
        .stream_table_rows("s", "t", 100, &cols, tx, None)
        .await
        .expect_err("duckdb stream must be unsupported");
    assert!(matches!(err, AppError::Unsupported(_)), "duckdb: {err:?}");
}

/// Issue #1077 Stage 2 — row-shape gate for `list_database_users`. The unit
/// guards in `db/mssql/admin.rs` only assert the SQL text; the decode path is
/// only observable against a live server. tiberius rejects a non-NULL `I32`
/// when `opt_i64` asks for `i64`, and `opt_i64` swallows that error into
/// `None` — so a T-SQL `int` projection renders EVERY row as "No" with no
/// error anywhere. `sa` is an enabled sysadmin, which pins the flags true.
#[tokio::test]
#[serial_test::serial]
async fn test_mssql_list_database_users_row_shape_1077() {
    let adapter = match common::setup_mssql_adapter().await {
        Some(a) => a,
        None => return,
    };

    let rows = adapter
        .list_database_users()
        .await
        .expect("sa holds VIEW ANY DEFINITION → the listing must succeed");

    let sa = rows
        .iter()
        .find(|r| r.name == "sa")
        .expect("the sa login must be listed");
    assert!(sa.can_login, "sa is enabled and not a role → can_login");
    assert!(sa.is_superuser, "sa is a sysadmin member → is_superuser");
    assert!(sa.can_create_db, "sysadmin implies CREATE DATABASE");
    assert!(
        sa.can_create_role,
        "sysadmin implies CREATE LOGIN/server roles"
    );

    // Fixed server roles are principals too, and they are not login-capable.
    let public_role = rows
        .iter()
        .find(|r| r.name == "public")
        .expect("the public fixed server role must be listed");
    assert!(!public_role.can_login, "a server role cannot log in");

    // `##MS_*` are internal certificate/role principals — audit noise, and the
    // certificate-mapped ones make `IS_SRVROLEMEMBER` return NULL.
    assert!(
        rows.iter().all(|r| !r.name.starts_with("##MS_")),
        "internal ##MS_* principals must not reach the panel"
    );
}

/// Issue #1077 Stage 2 SECURITY — PR #1786 re-review (2026-07-25). Two defects
/// only a real principal fixture can catch, both measured on SQL Server 2022
/// (16.0.4265.3) through `sqlcmd` before this test existed:
///
/// - `IS_SRVROLEMEMBER('dbcreator', <certificate-mapped login>)` is NULL even
///   though `sys.server_role_members` records the membership, so the previous
///   `ISNULL(IS_SRVROLEMEMBER(...), 0)` reported a real `dbcreator` as unable to
///   create databases — "cannot resolve" collapsed into "not a member" on an
///   account-audit surface. Same for `securityadmin` and an asymmetric-key login.
/// - a `'C'`/`'K'` principal exists only to carry permissions for signed
///   modules and can never authenticate, yet `type <> 'R'` reported it as a
///   loginable account.
///
/// The unit guards in `db/mssql/admin.rs` only pin the SQL text; the server's
/// NULL answer is the part that has to come from a live server. Fixture DDL
/// goes through `common::mssql_admin_batch` because the adapter refuses raw DDL
/// by design (#903).
#[tokio::test]
#[serial_test::serial]
async fn test_mssql_users_null_role_membership_and_non_login_principals_1077() {
    let adapter = match common::setup_mssql_adapter().await {
        Some(a) => a,
        None => return,
    };

    // Idempotent: a previous aborted run must not fail the fixture.
    const TEARDOWN_SQL: &str = "\
        IF EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'tv1077_cert_login') \
            DROP LOGIN tv1077_cert_login; \
        IF EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'tv1077_key_login') \
            DROP LOGIN tv1077_key_login; \
        IF EXISTS (SELECT 1 FROM sys.certificates WHERE name = 'tv1077_cert') \
            DROP CERTIFICATE tv1077_cert; \
        IF EXISTS (SELECT 1 FROM sys.asymmetric_keys WHERE name = 'tv1077_key') \
            DROP ASYMMETRIC KEY tv1077_key;";
    common::mssql_admin_batch(TEARDOWN_SQL)
        .await
        .expect("pre-clean principal fixture");
    common::mssql_admin_batch(
        // A `#`-leading SUBJECT is read as RFC 4514 hex DN data and rejected
        // with "certificate data is invalid" (error 15297), so no issue anchor
        // here.
        "CREATE CERTIFICATE tv1077_cert ENCRYPTION BY PASSWORD = 'Fixture!1077Pass' \
             WITH SUBJECT = 'issue 1077 stage 2 users listing fixture'; \
         CREATE LOGIN tv1077_cert_login FROM CERTIFICATE tv1077_cert; \
         CREATE ASYMMETRIC KEY tv1077_key \
             WITH ALGORITHM = RSA_2048 ENCRYPTION BY PASSWORD = 'Fixture!1077Pass'; \
         CREATE LOGIN tv1077_key_login FROM ASYMMETRIC KEY tv1077_key; \
         ALTER SERVER ROLE dbcreator ADD MEMBER tv1077_cert_login; \
         ALTER SERVER ROLE securityadmin ADD MEMBER tv1077_key_login;",
    )
    .await
    .expect("create certificate/asymmetric-key principal fixture");

    let listed = adapter.list_database_users().await;

    // Read the rows out before asserting so a failure still drops the fixture.
    let found = listed.as_ref().ok().map(|rows| {
        let pick = |name: &str| {
            rows.iter()
                .find(|r| r.name == name)
                .map(|r| (r.can_login, r.can_create_db, r.can_create_role))
        };
        (pick("tv1077_cert_login"), pick("tv1077_key_login"))
    });
    common::mssql_admin_batch(TEARDOWN_SQL)
        .await
        .expect("drop principal fixture");

    listed.expect("sa holds VIEW ANY DEFINITION → the listing must succeed");
    let (cert_login, key_login) = found.expect("listing succeeded");
    let (cert_can_login, cert_can_create_db, _) =
        cert_login.expect("the certificate-mapped login must be listed");
    let (key_can_login, _, key_can_create_role) =
        key_login.expect("the asymmetric-key-mapped login must be listed");

    assert!(
        cert_can_create_db,
        "dbcreator membership is recorded in sys.server_role_members — a NULL \
         IS_SRVROLEMEMBER answer must not report the member as unprivileged"
    );
    assert!(
        key_can_create_role,
        "securityadmin membership is recorded in sys.server_role_members — a NULL \
         IS_SRVROLEMEMBER answer must not report the member as unprivileged"
    );
    assert!(
        !cert_can_login,
        "a certificate-mapped principal carries permissions for signed modules and \
         cannot authenticate"
    );
    assert!(
        !key_can_login,
        "an asymmetric-key-mapped principal cannot authenticate either"
    );
}

/// Issue #1077 Stage 2 SECURITY — PR #1786 3rd review B4 (2026-07-25), data
/// loss. The listing gated rows on `sp.type IN ('S', 'U', 'G', 'R', 'C', 'K')`,
/// which silently dropped every `'E'` (Microsoft Entra login) and `'X'` (Entra
/// group) principal: no row, no error. On an Entra-authenticated SQL Server /
/// Azure SQL those two are the primary login subjects, so the audit screen
/// rendered a list missing them as complete. The fix removes the type predicate
/// entirely, and this is its live gate: the adapter must return exactly the
/// principals the server holds, whatever their type.
///
/// A container cannot provision an `'E'`/`'X'` principal (Entra logins need an
/// Entra-configured instance), so the Entra membership of the `can_login`
/// whitelist is pinned by the `USERS_SQL` text guards in `db/mssql/admin.rs`
/// (`users_sql_limits_can_login_to_authenticatable_principal_types`,
/// `users_sql_row_filter_drops_no_principal_type`). What this test owns is the
/// class against a real catalog: reintroduce ANY type whitelist that misses a
/// type this server actually holds (`'R'` roles, the `'C'`/`'K'` fixture logins
/// of the sibling test, …) and the two sets diverge here.
#[tokio::test]
#[serial_test::serial]
async fn test_mssql_users_listing_drops_no_principal_type_1077() {
    use table_view_lib::db::row_cap::DEFAULT_ROW_CAP;

    let adapter = match common::setup_mssql_adapter().await {
        Some(a) => a,
        None => return,
    };

    // Control: same source, same `##MS_%` name filter, NO type predicate.
    let control = adapter
        .execute_query(
            "SELECT name FROM sys.server_principals \
             WHERE name NOT LIKE '##MS_%' ORDER BY name",
            None,
            DEFAULT_ROW_CAP,
        )
        .await
        .expect("control sys.server_principals SELECT");
    let expected: Vec<String> = control
        .rows
        .iter()
        .map(|row| {
            row[0]
                .as_str()
                .expect("principal name is a string cell")
                .to_string()
        })
        .collect();
    assert!(
        expected.len() >= 2,
        "control must see real principals (sa + fixed server roles), got {expected:?}"
    );

    let listed: Vec<String> = adapter
        .list_database_users()
        .await
        .expect("sa holds VIEW ANY DEFINITION → the listing must succeed")
        .into_iter()
        .map(|r| r.name)
        .collect();

    assert_eq!(
        listed, expected,
        "every principal must reach the panel — a type filter drops accounts \
         with no row and no error"
    );
}
