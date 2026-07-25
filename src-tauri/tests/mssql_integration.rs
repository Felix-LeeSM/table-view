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
use table_view_lib::models::{
    AlterTableRequest, ColumnChange, ColumnDefinition, CreateTableRequest, DropTableRequest,
};

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

fn modify_default(column: &str, data_type: Option<&str>, default_value: &str) -> ColumnChange {
    ColumnChange::Modify {
        name: column.into(),
        new_data_type: data_type.map(Into::into),
        new_nullable: data_type.map(|_| false),
        new_default_value: Some(default_value.into()),
        using_expression: None,
        // #1735/#1788 — SQL Server has no ANSI `COMMENT ON`; the MSSQL emitter
        // discards `new_comment` (`db/mssql/ddl.rs`) and the ColumnsEditor
        // comment cell is capability-gated off, so the DEFAULT-swap fixtures
        // carry none.
        new_comment: None,
    }
}

fn alter_preview(changes: Vec<ColumnChange>) -> AlterTableRequest {
    AlterTableRequest {
        connection_id: "unused".into(),
        schema: MSSQL_SCHEMA.into(),
        table: "users".into(),
        changes,
        preview_only: true,
        expected_database: None,
    }
}

/// Issue #1071 — structural emit-order invariants for the column DEFAULT swap.
/// Not docker-gated: `preview_only` never opens a connection, and the invariants
/// are about statement ORDER and batch scoping, which the byte-exact golden in
/// `src/db/mssql/ddl_tests.rs` cannot express once its expected string is
/// itself the thing under review.
///
/// 1. `ALTER TABLE ... ALTER COLUMN` on a column that still owns a default
///    definition is restricted to length/precision/scale edits, so a real type
///    change behind a live default fails with Msg 5074 -> 4922 and rolls the
///    whole `alter_table` transaction back. The DROP has to come first (the
///    order SSMS generates too).
/// 2. `preview_or_execute` joins the statement list with "; " and
///    `SqlPreviewDialog` hands that exact string to Copy/history, so the preview
///    must stay runnable as one T-SQL batch: two columns editing their DEFAULT
///    cannot declare the same variable name twice (Msg 134).
#[tokio::test]
async fn test_mssql_default_swap_drops_before_alter_and_scopes_its_declare() {
    let adapter = MssqlAdapter::new();

    let sql = adapter
        .alter_table(&alter_preview(vec![modify_default(
            "status",
            Some("NVARCHAR(32)"),
            "N'active'",
        )]))
        .await
        .expect("preview")
        .sql;
    let drop_at = sql
        .find("DROP CONSTRAINT")
        .expect("drop constraint emitted");
    let alter_at = sql.find("ALTER COLUMN").expect("alter column emitted");
    let rebind_at = sql.find("ADD DEFAULT").expect("default rebind emitted");
    assert!(
        drop_at < alter_at && alter_at < rebind_at,
        "expected drop -> alter -> rebind order, got {sql:?}"
    );

    let batch = adapter
        .alter_table(&alter_preview(vec![
            modify_default("status", None, "N'active'"),
            modify_default("tier", None, "N'free'"),
        ]))
        .await
        .expect("preview")
        .sql;
    let declares: Vec<&str> = batch
        .split("; ")
        .filter(|statement| statement.starts_with("DECLARE "))
        .collect();
    assert_eq!(
        declares.len(),
        2,
        "expected one DECLARE per column: {batch:?}"
    );
    assert_ne!(
        declares[0], declares[1],
        "joined preview batch redeclares the same variable (Msg 134): {batch:?}"
    );
}

// Reason: PR #1795 re-review B1 — the DEFAULT swap has to be *runnable* T-SQL,
// not merely correctly ordered. The character-string `EXECUTE` form is
// `EXEC ( { @string_variable | [N]'tsql_string' } [ + ...n ] )`: its `+`
// operands are literals and variables only, so a function call in the operand
// list (`EXEC(N'…' + QUOTENAME(@v))`) never reaches execution — SQL Server
// rejects it at parse time with `Msg 102, Incorrect syntax near 'QUOTENAME'`
// and the whole alter rolls back at statement 1 of 3. Neither the byte-exact
// golden (`src/db/mssql/ddl_tests.rs`) nor the `preview_only` order invariant
// above can see that: both compare strings the emitter itself produced. Only
// the server is the oracle for "does this parse", so this drives the real
// execute path (`preview_only: false`) and reads the outcome back out of
// `sys.columns` / `sys.default_constraints`. (2026-07-25)
#[tokio::test]
#[serial_test::serial]
async fn test_mssql_default_swap_executes_against_sql_server() {
    use table_view_lib::db::row_cap::DEFAULT_ROW_CAP;

    let adapter = match common::setup_mssql_adapter().await {
        Some(adapter) => adapter,
        None => return,
    };
    let table = format!("test_default_swap_{}", ts());

    let mut seeded = col("status", "nvarchar(16)", false);
    seeded.default_value = Some("N'new'".into());
    adapter
        .create_table(&create_req(&table, vec![col("id", "int", false), seeded]))
        .await
        .expect("CREATE TABLE");

    let swap = AlterTableRequest {
        connection_id: "unused".into(),
        schema: MSSQL_SCHEMA.into(),
        table: table.clone(),
        changes: vec![modify_default("status", Some("NVARCHAR(32)"), "N'active'")],
        preview_only: false,
        expected_database: None,
    };
    // Msg 102 surfaces here, before any readback: the drop statement is the
    // first of the three the swap emits.
    adapter
        .alter_table(&swap)
        .await
        .expect("DEFAULT swap must execute on SQL Server");

    let readback = adapter
        .execute_query(
            &format!(
                "SELECT CAST(c.max_length AS nvarchar(16)) AS max_length, \
                 ISNULL(dc.definition, N'<none>') AS definition \
                 FROM sys.columns AS c \
                 LEFT JOIN sys.default_constraints AS dc \
                 ON dc.parent_object_id = c.object_id \
                 AND dc.parent_column_id = c.column_id \
                 WHERE c.object_id = OBJECT_ID(N'[{MSSQL_SCHEMA}].[{table}]') \
                 AND c.name = N'status'"
            ),
            None,
            DEFAULT_ROW_CAP,
        )
        .await
        .expect("readback");
    let row: Vec<String> = readback
        .rows
        .first()
        .expect("status column row")
        .iter()
        .map(|cell| cell.as_str().unwrap_or_default().to_string())
        .collect();

    // NVARCHAR(32) is 64 bytes: proves the ALTER COLUMN ran *after* the drop
    // (a still-bound default restricts it to length/precision/scale and would
    // have failed with Msg 5074 -> 4922), and the rebound definition proves the
    // swap replaced `N'new'` rather than leaving the seeded constraint behind.
    assert_eq!(
        (row[0].as_str(), row[1].as_str()),
        ("64", "(N'active')"),
        "expected NVARCHAR(32) + rebound default, got {row:?}"
    );

    adapter
        .drop_table(&drop_req(&table))
        .await
        .expect("cleanup");
}
