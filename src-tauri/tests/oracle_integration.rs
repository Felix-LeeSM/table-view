//! Issue #1674 — Oracle adapter integration gate: `stream_table_rows` plus the
//! vendor-restorable schema-dump round-trip. Mirrors the #1642 SQL Server
//! round-trip (`tests/mssql_integration.rs`) and the #1654 MySQL sibling.
//!
//! Docker-gated: `common::setup_oracle_adapter()` silent-skips (`None`) when no
//! Oracle endpoint is reachable — Docker down, or the amd64-only
//! `gvenzl/oracle-free` image unavailable on ARM (Oracle Database Free has no
//! ARM build). Point at an external server with
//! `ORACLE_HOST=... ORACLE_PORT=... cargo oracle-test`.
//!
//! The `stream_table_rows unsupported for duckdb` boundary test is NOT
//! docker-gated — it asserts the trait-default `Unsupported` contract for the
//! one remaining non-promoted RDB engine and that Oracle is now wired (validates
//! instead of rejecting), and runs anywhere.

mod common;

use table_view_lib::db::{DuckdbAdapter, OracleAdapter, RdbAdapter};
use table_view_lib::error::AppError;
use table_view_lib::models::{ColumnDefinition, CreateTableRequest, DropTableRequest};

// gvenzl/oracle-free's app user `test` owns the `TEST` schema. Uppercase
// identifiers throughout so the test's own unquoted SQL and the dump's
// double-quoted SQL resolve to the same catalog objects.
const ORACLE_SCHEMA: &str = "TEST";

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
        schema: ORACLE_SCHEMA.into(),
        name: table.into(),
        columns,
        primary_key: Some(vec!["ID".into()]),
        preview_only: false,
        table_comment: None,
        expected_database: None,
    }
}

fn drop_req(table: &str) -> DropTableRequest {
    DropTableRequest {
        connection_id: "unused".into(),
        schema: ORACLE_SCHEMA.into(),
        table: table.into(),
        cascade: false,
        preview_only: false,
        expected_database: None,
    }
}

/// [AC-1674-04] Vendor-restorable dump round-trip — issue #1674 / #1077 Stage 1.
/// Drives the REAL dump path (`run_schema_dump` → `stream_table_rows` → mpsc
/// drain → Oracle INSERT writer) against live Oracle, restores the emitted SQL
/// into the same (emptied) table, and asserts the restored rows equal the source
/// rows. A leftover `::jsonb` cast, MySQL backtick, or a `TRUE`/`FALSE` boolean
/// (which Oracle's NUMBER-mapped bool rejects) would make the restore fail
/// outright, so a green restore is itself the dialect proof.
#[tokio::test]
#[serial_test::serial]
async fn test_oracle_dump_round_trip_restores_into_oracle() {
    use std::sync::Arc;
    use table_view_lib::commands::connection::AppState;
    use table_view_lib::commands::export::{
        run_schema_dump, ExportDumpTable, ExportInclude, ExportSchemaDumpOptions,
    };
    use table_view_lib::db::row_cap::DEFAULT_ROW_CAP;
    use table_view_lib::db::ActiveAdapter;
    use table_view_lib::models::{ColumnCategory, DatabaseType};

    // `OracleAdapter` is not `Clone`, so take two independent connections to the
    // same container: one for seed/readback, one to hand to `AppState`.
    let adapter = match common::setup_oracle_adapter().await {
        Some(a) => a,
        None => return,
    };
    let dump_adapter = match common::setup_oracle_adapter().await {
        Some(a) => a,
        None => return,
    };
    let table = format!("DUMP_RT_{}", ts());

    // Oracle `execute_query` rejects raw DDL by design (#905), so the table is
    // created through the structured DDL builder. NUMBER(1) FLAG stands in for a
    // boolean (no pre-23c BOOLEAN column type); RAW(16) exercises the
    // `HEXTORAW(...)` binary-literal dump path.
    adapter
        .create_table(&create_req(
            &table,
            vec![
                col("ID", "NUMBER", false),
                col("NAME", "VARCHAR2(255)", true),
                col("NOTE", "VARCHAR2(255)", true),
                col("FLAG", "NUMBER(1)", true),
                col("BIN_COL", "RAW(16)", true),
            ],
        ))
        .await
        .expect("CREATE TABLE");

    // Seed tricky values: single quote (→ `''`), backslash (an Oracle literal,
    // NOT escaped — like T-SQL, unlike MySQL), NULL, a NUMBER(1) flag (0/1), a
    // RAW column with a control byte (`0aff00`) that only survives a HEXTORAW
    // literal plus a NULL binary cell, and (AL32UTF8) non-ASCII Unicode. Oracle
    // has no multi-row VALUES, so seed one row per statement.
    let seeds = [
        format!(
            "INSERT INTO {ORACLE_SCHEMA}.{table} (ID, NAME, NOTE, FLAG, BIN_COL) \
             VALUES (1, 'O''Reilly', 'C:\\path\\file', 1, hextoraw('0aff00'))"
        ),
        format!(
            "INSERT INTO {ORACLE_SCHEMA}.{table} (ID, NAME, NOTE, FLAG, BIN_COL) \
             VALUES (2, 'plain', 'has,comma and space', 0, hextoraw('deadbeef'))"
        ),
        format!(
            "INSERT INTO {ORACLE_SCHEMA}.{table} (ID, NAME, NOTE, FLAG, BIN_COL) \
             VALUES (3, 'quote\"slash', NULL, 1, NULL)"
        ),
        format!(
            "INSERT INTO {ORACLE_SCHEMA}.{table} (ID, NAME, NOTE, FLAG, BIN_COL) \
             VALUES (4, '안녕세계', '日本語 emoji 💡', 0, hextoraw('00'))"
        ),
    ];
    for seed in &seeds {
        adapter
            .execute_query(seed, None, DEFAULT_ROW_CAP)
            .await
            .expect("seed INSERT");
    }

    async fn read_all(adapter: &OracleAdapter, table: &str) -> Vec<Vec<String>> {
        let result = adapter
            .execute_query(
                &format!(
                    "SELECT ID, NAME, NOTE, FLAG, BIN_COL FROM {ORACLE_SCHEMA}.{table} ORDER BY ID"
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

    // Drive the real dump through AppState with an Oracle dialect.
    let state = AppState::new();
    {
        let mut active = state.active_connections.lock().await;
        active.insert(
            "dump-conn".into(),
            Arc::new(ActiveAdapter::Rdb(Box::new(dump_adapter))),
        );
    }
    let dir = tempfile::TempDir::new().unwrap();
    let dump_path = dir.path().join("oracle_dump.sql");
    let summary = run_schema_dump(
        &state,
        "dump-conn",
        &dump_path,
        "",
        "",
        &[ExportDumpTable {
            schema: ORACLE_SCHEMA.to_string(),
            table: table.clone(),
            column_names: vec![
                "ID".into(),
                "NAME".into(),
                "NOTE".into(),
                "FLAG".into(),
                "BIN_COL".into(),
            ],
            // BIN_COL is Binary → `HEXTORAW('…')`; the rest keep the quoted path.
            column_categories: vec![
                ColumnCategory::Int,
                ColumnCategory::Text,
                ColumnCategory::Text,
                ColumnCategory::Int,
                ColumnCategory::Binary,
            ],
        }],
        &ExportSchemaDumpOptions {
            include: ExportInclude::Dml,
            batch_size: 100,
            dialect: DatabaseType::Oracle,
        },
        None,
    )
    .await
    .expect("dump");
    assert_eq!(summary.rows_written, 4);

    let dump_sql = std::fs::read_to_string(&dump_path).unwrap();
    // Dialect proof: double-quote identifiers; no MySQL backtick, no PG jsonb
    // cast, no non-Oracle boolean literal, backslash stays single, Unicode
    // survives, and the RAW cell dumps as a HEXTORAW literal (never a quoted
    // '0x…' string that would restore the hex text).
    assert!(
        dump_sql.contains(&format!(r#"INSERT INTO "{ORACLE_SCHEMA}"."{table}""#)),
        "dump missing double-quote INSERT: {dump_sql}"
    );
    assert!(!dump_sql.contains("::jsonb"), "dump leaked PG jsonb cast");
    assert!(
        !dump_sql.contains(&format!("`{table}`")),
        "dump leaked MySQL backtick identifier: {dump_sql}"
    );
    assert!(
        !dump_sql.contains("TRUE") && !dump_sql.contains("FALSE"),
        "dump leaked non-Oracle boolean literal: {dump_sql}"
    );
    assert!(
        dump_sql.contains(r"'C:\path\file'"),
        "Oracle literal must keep a single backslash: {dump_sql}"
    );
    assert!(
        dump_sql.contains("'안녕세계'"),
        "Unicode literal must survive: {dump_sql}"
    );
    assert!(
        dump_sql.contains("hextoraw('0aff00')") && !dump_sql.contains("'0x0aff00'"),
        "binary column must dump as a HEXTORAW literal: {dump_sql}"
    );

    // Restore: empty the table, replay each dumped INSERT statement.
    adapter
        .execute_query(
            &format!("DELETE FROM {ORACLE_SCHEMA}.{table}"),
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
        "restored rows must match source after Oracle round-trip (incl. Unicode + RAW)"
    );

    adapter.drop_table(&drop_req(&table)).await.ok();
}

/// Issue #1735 — Oracle column-comment round-trip (set → read back → clear →
/// read back) against live Oracle.
///
/// The `ddl_tests.rs` preview cases can only pin the emitted *string*; this is
/// the only layer that proves the string PARSES. Oracle's `COMMENT ON` grammar
/// takes a text literal, so the first cut's `IS NULL` clear (correct for PG,
/// which shares the emitter shape) was an ORA parse error while every unit test
/// stayed green. `''` IS NULL in Oracle, so `IS ''` both parses and removes the
/// comment. Read-back goes through `ALL_COL_COMMENTS` — the catalog view the
/// structure panel's own column fetch reads.
#[tokio::test]
#[serial_test::serial]
async fn test_oracle_column_comment_set_and_clear_round_trip() {
    use table_view_lib::db::row_cap::DEFAULT_ROW_CAP;
    use table_view_lib::models::{AlterTableRequest, ColumnChange};

    let adapter = match common::setup_oracle_adapter().await {
        Some(a) => a,
        None => return,
    };
    let table = format!("COL_COMMENT_{}", ts());
    adapter
        .create_table(&create_req(
            &table,
            vec![
                col("ID", "NUMBER", false),
                col("NOTE", "VARCHAR2(255)", true),
            ],
        ))
        .await
        .expect("CREATE TABLE");

    fn comment_req(table: &str, new_comment: &str) -> AlterTableRequest {
        AlterTableRequest {
            connection_id: "unused".into(),
            schema: ORACLE_SCHEMA.into(),
            table: table.into(),
            changes: vec![ColumnChange::Modify {
                name: "NOTE".into(),
                new_data_type: None,
                new_nullable: None,
                new_default_value: None,
                using_expression: None,
                new_comment: Some(new_comment.into()),
            }],
            preview_only: false,
            expected_database: None,
        }
    }

    // `<cleared>` sentinel keeps the assertion on a plain string instead of the
    // JSON `null` rendering of a NULL cell.
    async fn read_comment(adapter: &OracleAdapter, table: &str) -> String {
        let result = adapter
            .execute_query(
                &format!(
                    "SELECT NVL(COMMENTS, '<cleared>') FROM ALL_COL_COMMENTS \
                     WHERE OWNER = '{ORACLE_SCHEMA}' AND TABLE_NAME = '{table}' \
                     AND COLUMN_NAME = 'NOTE'"
                ),
                None,
                DEFAULT_ROW_CAP,
            )
            .await
            .expect("ALL_COL_COMMENTS readback");
        result
            .rows
            .first()
            .and_then(|row| row.first())
            .map(|cell| cell.to_string())
            .unwrap_or_default()
    }

    // Set — the apostrophe exercises the `''` doubling escape end to end.
    adapter
        .alter_table(&comment_req(&table, "O'Brien's note"))
        .await
        .expect("COMMENT ON COLUMN set must parse on live Oracle");
    let stored = read_comment(&adapter, &table).await;
    assert!(
        stored.contains("O'Brien's note"),
        "comment set did not land in ALL_COL_COMMENTS: {stored}"
    );

    // Clear — regression guard for the `IS NULL` dialect bug. `IS NULL` is a
    // parse error here, so a green execute is itself the grammar proof.
    adapter
        .alter_table(&comment_req(&table, ""))
        .await
        .expect("COMMENT ON COLUMN clear must parse on live Oracle");
    let cleared = read_comment(&adapter, &table).await;
    assert!(
        cleared.contains("<cleared>"),
        "comment clear left a value behind: {cleared}"
    );

    adapter.drop_table(&drop_req(&table)).await.ok();
}

/// Mirror of the MySQL/MSSQL `stream_table_rows aborts when receiver drops` gate.
#[tokio::test]
#[serial_test::serial]
async fn test_oracle_stream_table_rows_aborts_when_receiver_drops() {
    use table_view_lib::db::row_cap::DEFAULT_ROW_CAP;

    let adapter = match common::setup_oracle_adapter().await {
        Some(a) => a,
        None => return,
    };
    let table = format!("STREAM_DROP_{}", ts());
    adapter
        .create_table(&create_req(&table, vec![col("ID", "NUMBER", false)]))
        .await
        .expect("CREATE");

    for i in 1..=20 {
        adapter
            .execute_query(
                &format!("INSERT INTO {ORACLE_SCHEMA}.{table} (ID) VALUES ({i})"),
                None,
                DEFAULT_ROW_CAP,
            )
            .await
            .expect("INSERT");
    }

    let (sender, rx) = tokio::sync::mpsc::channel(1);
    drop(rx);
    let cols = vec!["ID".to_string()];
    let err = adapter
        .stream_table_rows(ORACLE_SCHEMA, &table, 1, &cols, sender, None)
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

/// [AC-1674-05] DuckDB keeps the trait-default `Unsupported` `stream_table_rows`;
/// Oracle is now a wired streaming engine (#1674), so it validates its inputs
/// instead of rejecting outright. No docker required — guards the capability
/// flip in both directions.
#[tokio::test]
async fn test_stream_table_rows_boundary_duckdb_unsupported_oracle_validated() {
    let cols = vec!["ID".to_string()];

    // DuckDB has no streaming body → trait-default Unsupported.
    let duckdb = DuckdbAdapter::new();
    let (tx, _rx) = tokio::sync::mpsc::channel(1);
    let err = duckdb
        .stream_table_rows("s", "t", 100, &cols, tx, None)
        .await
        .expect_err("duckdb stream must be unsupported");
    assert!(matches!(err, AppError::Unsupported(_)), "duckdb: {err:?}");

    // Oracle is wired: a zero batch_size is a Validation error (not the
    // trait-default Unsupported), proving the override is live.
    let oracle = OracleAdapter::new();
    let (tx, _rx) = tokio::sync::mpsc::channel(1);
    let err = oracle
        .stream_table_rows("TEST", "T", 0, &cols, tx, None)
        .await
        .expect_err("oracle zero batch must be a Validation error");
    assert!(
        matches!(&err, AppError::Validation(msg) if msg.contains("batch_size")),
        "oracle: {err:?}"
    );
}

// ── Issue #1072 — switch-database gate ────────────────────────────────────
//
// These live in the CI-run `--test oracle_integration` target
// (`.github/workflows/ci.yml`), not in the `#[ignore]`d smoke probes, because
// the switch path's only real failure mode is the one a live listener decides:
// whether a name the picker offered can actually be dialed.

/// [AC-1072-01] `CDB$ROOT` is a container, never a listener service, so the
/// picker must never offer it and the switch must refuse it at the trust
/// boundary — before the connection lookup, so the rejection is deterministic
/// and needs no live Oracle. Dialing it would reach the whitelist
/// (`is_oracle_identifier_safe` allows `$`) and then die with ORA-12514.
#[tokio::test]
async fn test_oracle_switch_database_refuses_the_root_container_1072() {
    let adapter = OracleAdapter::new();

    for name in ["CDB$ROOT", "cdb$root", "  Cdb$Root  "] {
        let err = RdbAdapter::switch_database(&adapter, name)
            .await
            .expect_err("the root container must never be a switch target");
        assert!(
            matches!(&err, AppError::Validation(message) if message.contains("CDB$ROOT")),
            "expected a Validation rejection for {name:?}, got {err:?}"
        );
    }
}

/// [AC-1072-02] The list axis and the dial axis must be the same axis. From a
/// CDB root session the picker has more than one entry, so this is the only
/// configuration where the contract is observable: the stored service must stay
/// in its own list, `CDB$ROOT` must not appear, and **every** offered entry must
/// be dialable with the same credentials (Oracle auto-creates a default service
/// per PDB, which is why PDB names are dialable and the root container is not).
#[tokio::test]
#[serial_test::serial]
async fn test_oracle_switch_database_round_trip_from_cdb_root_1072() {
    let adapter = match common::setup_oracle_cdb_root_adapter().await {
        Some(a) => a,
        None => return,
    };
    let root_service = RdbAdapter::current_database(&adapter)
        .await
        .expect("current database should resolve")
        .expect("a connected adapter stores its service name");

    let names: Vec<String> = RdbAdapter::list_databases(&adapter)
        .await
        .expect("container list should succeed from CDB root")
        .into_iter()
        .map(|db| db.name)
        .collect();

    assert!(
        names.iter().any(|name| name == &root_service),
        "the service this session dialed must stay in its own picker: {names:?}"
    );
    assert!(
        !names.iter().any(|n| n.eq_ignore_ascii_case("CDB$ROOT")),
        "CDB$ROOT has no listener service and must not be offered: {names:?}"
    );
    assert!(
        !names.iter().any(|n| n.eq_ignore_ascii_case("PDB$SEED")),
        "PDB$SEED is a read-only clone template, never a switch target: {names:?}"
    );
    assert!(
        names.len() >= 2,
        "a privileged CDB-root session must see at least one PDB besides its own service: {names:?}"
    );

    for name in &names {
        RdbAdapter::switch_database(&adapter, name)
            .await
            .unwrap_or_else(|e| panic!("picker offered a target it cannot dial: {name} ({e:?})"));
        assert_eq!(
            RdbAdapter::current_database(&adapter)
                .await
                .expect("current database should resolve after a switch")
                .as_deref(),
            Some(name.as_str()),
            "the switch must re-point the stored target"
        );
    }

    RdbAdapter::switch_database(&adapter, &root_service)
        .await
        .expect("returning to the original container must work");
}

/// [AC-1072-03] Oracle service/container names are case-insensitive, so a
/// case-only re-select is the *same* target: it must short-circuit instead of
/// tearing down a working session, and it must not rewrite the stored spelling
/// (the picker highlights the current entry by comparing against it).
#[tokio::test]
#[serial_test::serial]
async fn test_oracle_switch_database_same_target_ignores_case_1072() {
    use table_view_lib::db::row_cap::DEFAULT_ROW_CAP;

    let adapter = match common::setup_oracle_adapter().await {
        Some(a) => a,
        None => return,
    };
    let service = RdbAdapter::current_database(&adapter)
        .await
        .expect("current database should resolve")
        .expect("a connected adapter stores its service name");
    let refolded = if service.chars().any(|c| c.is_ascii_uppercase()) {
        service.to_ascii_lowercase()
    } else {
        service.to_ascii_uppercase()
    };

    RdbAdapter::switch_database(&adapter, &refolded)
        .await
        .expect("a case-only re-select must be accepted");
    assert_eq!(
        RdbAdapter::current_database(&adapter)
            .await
            .expect("current database should resolve")
            .as_deref(),
        Some(service.as_str()),
        "a case-only re-select is a no-op and must not rewrite the stored target"
    );

    adapter
        .execute_query("SELECT 1 FROM DUAL", None, DEFAULT_ROW_CAP)
        .await
        .expect("the working session must survive a case-only re-select");
}
