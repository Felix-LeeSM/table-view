//! Unit tests for `commands/export/*` — moved out of the inline
//! `mod tests` block (Sprint P5 step 1, commit a60074d). Sprint 213
//! (P5 step 2b) then split format-specific writers into the
//! `grid_writers` sibling module, so this file imports the writer
//! helpers explicitly. No test logic changed.

use super::dump_writers::quote_pg_string;
use super::grid_writers::{
    json_to_cell_string, json_to_sql_literal, quote_sql_identifier, quote_sql_string,
};
use super::*;
use serde_json::json;
use std::path::Path;
use tempfile::TempDir;

fn read_to_string(p: &Path) -> String {
    std::fs::read_to_string(p).unwrap()
}

fn read_to_bytes(p: &Path) -> Vec<u8> {
    std::fs::read(p).unwrap()
}

fn table_ctx() -> ExportContext {
    ExportContext::Table {
        schema: "public".into(),
        name: "users".into(),
    }
}

// [AC-181-03] CSV RFC 4180 escape — comma / quote / CRLF cells.
// 2026-05-01 — guards deterministic CSV output across surfaces.
#[test]
fn test_csv_rfc4180_escape() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("out.csv");
    let headers = vec!["name".to_string(), "note".to_string()];
    let rows = vec![vec![
        json!("alice, with comma"),
        json!("line1\nline2 \"quoted\""),
    ]];
    write_export(
        ExportFormat::Csv,
        &path,
        &headers,
        &rows,
        &table_ctx(),
        None,
    )
    .unwrap();
    let body = read_to_string(&path);
    // Header row uses CRLF.
    assert!(body.contains("name,note\r\n"), "csv body: {:?}", body);
    // Cell with comma is quoted; cell with quote uses doubled quote.
    assert!(
        body.contains("\"alice, with comma\""),
        "csv body: {:?}",
        body
    );
    assert!(
        body.contains("\"line1\nline2 \"\"quoted\"\"\""),
        "csv body: {:?}",
        body
    );
}

// [AC-181-03] CSV BOM prefix (Excel compatibility).
// 2026-05-01 — guards Excel UTF-8 round-trip.
#[test]
fn test_csv_utf8_bom_prefix() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("bom.csv");
    write_export(
        ExportFormat::Csv,
        &path,
        &["c".into()],
        &[vec![json!("v")]],
        &table_ctx(),
        None,
    )
    .unwrap();
    let bytes = read_to_bytes(&path);
    assert_eq!(
        &bytes[..3],
        b"\xEF\xBB\xBF",
        "missing BOM: {:?}",
        &bytes[..6]
    );
}

// [AC-181-04] TSV: tab/newline in cell collapsed to space.
// 2026-05-01 — TSV has no escape spec so we sanitize.
#[test]
fn test_tsv_strips_tab_in_cell() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("out.tsv");
    write_export(
        ExportFormat::Tsv,
        &path,
        &["a".into(), "b".into()],
        &[vec![json!("x\ty"), json!("line1\nline2")]],
        &table_ctx(),
        None,
    )
    .unwrap();
    let body = read_to_string(&path);
    assert_eq!(body, "a\tb\nx y\tline1 line2\n");
}

// [AC-181-05] SQL: identifier with embedded double-quote.
// 2026-05-01 — ANSI quoting (`"` → `""`).
#[test]
fn test_sql_identifier_double_quote_escape() {
    assert_eq!(quote_sql_identifier(r#"weird"col"#), r#""weird""col""#);
    assert_eq!(quote_sql_identifier("plain"), r#""plain""#);
}

// [AC-181-05] SQL: string value with single quote.
// 2026-05-01 — SQL string escape (`'` → `''`).
#[test]
fn test_sql_string_single_quote_escape() {
    assert_eq!(quote_sql_string("O'Reilly"), "'O''Reilly'");
}

// [AC-181-05] SQL: NULL is bare literal, not quoted.
// 2026-05-01 — null vs string disambiguation.
#[test]
fn test_sql_null_literal() {
    assert_eq!(json_to_sql_literal(&JsonValue::Null), "NULL");
    assert_eq!(json_to_sql_literal(&json!("")), "''");
}

// [AC-181-05] SQL: Query context with single source_table is allowed.
// 2026-05-01 — single-table SELECT inference.
#[test]
fn test_sql_source_table_inference_single() {
    let ctx = ExportContext::Query {
        source_table: Some(SourceTable {
            schema: "public".into(),
            name: "events".into(),
        }),
    };
    assert!(require_sql_source_table(&ctx).is_ok());
}

// [AC-181-05] SQL: Query context without source_table is rejected.
// 2026-05-01 — JOIN/aggregate result cannot infer table.
#[test]
fn test_sql_source_table_inference_multi_disabled() {
    let ctx = ExportContext::Query { source_table: None };
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("nope.sql");
    let err = write_export(
        ExportFormat::Sql,
        &path,
        &["c".into()],
        &[vec![json!(1)]],
        &ctx,
        None,
    )
    .unwrap_err();
    assert!(err.to_string().contains("single-table SELECT"));
    // Pre-flight rejection means no file was created.
    assert!(!path.exists(), "partial file should not exist");
}

// [AC-181-06] Mongo Extended JSON: $oid passes through.
// 2026-05-01 — BSON layer already produces Relaxed; we preserve it.
#[test]
fn test_extended_json_objectid_oid_key() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("out.json");
    let rows = vec![vec![
        json!({"_id": {"$oid": "5099803df3f4948bd2f98391"}, "name": "alice"}),
    ]];
    write_export(
        ExportFormat::Json,
        &path,
        &["_doc".into()],
        &rows,
        &ExportContext::Collection {
            name: "users".into(),
        },
        None,
    )
    .unwrap();
    let body = read_to_string(&path);
    assert!(body.contains("\"$oid\""), "missing $oid: {}", body);
    assert!(body.contains("5099803df3f4948bd2f98391"));
}

// [AC-181-06] Mongo Extended JSON: $date and $numberDecimal preserved.
// 2026-05-01 — Relaxed mode key set per BSON spec.
#[test]
fn test_extended_json_date_and_decimal() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("out.json");
    let rows = vec![vec![json!({
        "ts": {"$date": "2026-05-01T00:00:00Z"},
        "amount": {"$numberDecimal": "12.34"}
    })]];
    write_export(
        ExportFormat::Json,
        &path,
        &["_doc".into()],
        &rows,
        &ExportContext::Collection {
            name: "ledger".into(),
        },
        None,
    )
    .unwrap();
    let body = read_to_string(&path);
    assert!(body.contains("\"$date\""));
    assert!(body.contains("\"$numberDecimal\""));
}

// [AC-181-06] Mongo Extended JSON: $binary preserved end-to-end.
// 2026-05-01 — guarantees BinData passes through `relax_extended_json`
// tree walk without flattening. Closes the four-key gate from the
// contract Verification Plan static grep (`$oid|$date|$binary|$numberDecimal`).
#[test]
fn test_extended_json_binary_preserved() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("out.json");
    let rows = vec![vec![json!({
        "blob": {"$binary": {"base64": "aGVsbG8=", "subType": "00"}}
    })]];
    write_export(
        ExportFormat::Json,
        &path,
        &["_doc".into()],
        &rows,
        &ExportContext::Collection {
            name: "files".into(),
        },
        None,
    )
    .unwrap();
    let body = read_to_string(&path);
    assert!(body.contains("\"$binary\""), "missing $binary: {}", body);
    assert!(body.contains("aGVsbG8="));
}

// [AC-181-07] Streaming 100k rows — file line count + bytes_written.
// 2026-05-01 — proves we don't load all rows into memory at once
// (BufWriter sized at default 8 KiB writes incrementally).
#[test]
fn test_streaming_100k_rows_writes_all_lines() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("big.csv");
    let headers = vec!["i".to_string(), "v".to_string()];
    let rows: Vec<Vec<JsonValue>> = (0..100_000_u64)
        .map(|i| vec![json!(i), json!(format!("row-{}", i))])
        .collect();
    let summary = write_export(
        ExportFormat::Csv,
        &path,
        &headers,
        &rows,
        &table_ctx(),
        None,
    )
    .unwrap();
    assert_eq!(summary.rows_written, 100_000);
    let body = read_to_string(&path);
    // 100k rows + 1 header + final empty after last CRLF.
    let line_count = body.matches("\r\n").count();
    assert_eq!(line_count, 100_001, "csv line count mismatch");
}

// [AC-181-07] Cancellation mid-write removes the partial file path.
// 2026-05-01 — token cancel before call → Err + cleanup callers.
#[test]
fn test_export_cancellation_aborts_write() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("cancel.csv");
    let headers = vec!["i".to_string()];
    let rows: Vec<Vec<JsonValue>> = (0..10).map(|i| vec![json!(i)]).collect();
    let token = CancellationToken::new();
    token.cancel();
    let err = write_export(
        ExportFormat::Csv,
        &path,
        &headers,
        &rows,
        &table_ctx(),
        Some(&token),
    )
    .unwrap_err();
    assert!(err.to_string().contains("cancelled"));
    // The synchronous core created the file but the caller-side
    // (export_grid_rows) is responsible for unlinking. The handler's
    // partial-file cleanup is exercised in the operator smoke; here
    // we only assert the error surface.
}

// [AC-181-08] NULL serialization is consistent across CSV / TSV / SQL.
// 2026-05-01 — single fixture, three formats.
#[test]
fn test_null_consistent_across_formats() {
    let dir = TempDir::new().unwrap();
    let headers = vec!["a".to_string(), "b".to_string()];
    let rows = vec![vec![JsonValue::Null, json!(1)]];

    let csv_path = dir.path().join("n.csv");
    write_export(
        ExportFormat::Csv,
        &csv_path,
        &headers,
        &rows,
        &table_ctx(),
        None,
    )
    .unwrap();
    let body = read_to_string(&csv_path);
    // Empty cell for NULL.
    assert!(body.contains(",1\r\n"));

    let tsv_path = dir.path().join("n.tsv");
    write_export(
        ExportFormat::Tsv,
        &tsv_path,
        &headers,
        &rows,
        &table_ctx(),
        None,
    )
    .unwrap();
    let body = read_to_string(&tsv_path);
    assert!(body.contains("\t1\n"));

    let sql_path = dir.path().join("n.sql");
    write_export(
        ExportFormat::Sql,
        &sql_path,
        &headers,
        &rows,
        &table_ctx(),
        None,
    )
    .unwrap();
    let body = read_to_string(&sql_path);
    assert!(body.contains("(NULL, 1);"), "sql body: {}", body);
}

// [AC-181-08] Boolean serializes as `TRUE` / `FALSE` in SQL but
// `true` / `false` in CSV/TSV (lowercase per common convention).
// 2026-05-01.
#[test]
fn test_boolean_serialization() {
    assert_eq!(json_to_sql_literal(&json!(true)), "TRUE");
    assert_eq!(json_to_sql_literal(&json!(false)), "FALSE");
    assert_eq!(json_to_cell_string(&json!(true)), "true");
    assert_eq!(json_to_cell_string(&json!(false)), "false");
}

// [AC-181-08] Number serializes without quoting in all formats.
// 2026-05-01.
#[test]
fn test_number_serialization_unquoted() {
    assert_eq!(json_to_sql_literal(&json!(42)), "42");
    assert_eq!(json_to_sql_literal(&json!(2.5)), "2.5");
    assert_eq!(json_to_cell_string(&json!(42)), "42");
}

// [AC-181-08] JSON / array values get the `::jsonb` cast in SQL.
// 2026-05-01 — mirrors PG `to_jsonb` ergonomics.
#[test]
fn test_sql_object_value_cast_to_jsonb() {
    let lit = json_to_sql_literal(&json!({"k": "v"}));
    assert!(lit.ends_with("::jsonb"), "lit: {}", lit);
    assert!(lit.contains("'{\"k\":\"v\"}'"), "lit: {}", lit);
}

// [AC-181-09 / Invariant] Header-only export with zero rows is valid.
// 2026-05-01 — empty result set still produces a parsable file.
#[test]
fn test_zero_rows_produces_header_only() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("empty.csv");
    let summary = write_export(
        ExportFormat::Csv,
        &path,
        &["c".into()],
        &[],
        &table_ctx(),
        None,
    )
    .unwrap();
    assert_eq!(summary.rows_written, 0);
    let body = read_to_string(&path);
    assert!(body.ends_with("c\r\n"));
}

// [AC-192-02] Sprint 192 — write_text_file_export round-trip.
// UTF-8 content (CR/LF + non-ASCII) 가 그대로 저장되고 byte 카운트
// 가 정확한지 단언. spawn_blocking 경유의 async wrapper 가 아니라
// 동기 core 를 직접 호출 — 본 함수가 책임지는 IO 자체만 검증.
// date 2026-05-02
#[test]
fn test_write_text_file_export_roundtrip() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("migration.sql");
    let content = "-- header\nCREATE TABLE \"t\" (\n  \"한글\" TEXT\n);\n";
    let summary = write_text_file(&path, content).unwrap();
    assert_eq!(summary.rows_written, 0);
    assert_eq!(summary.bytes_written, content.len() as u64);
    let body = read_to_string(&path);
    assert_eq!(body, content);
}

// [AC-192-02] target_path 가 디렉토리 / 부모가 없는 경로 등 file
// create 자체가 실패하는 케이스는 Err 로 보고. 호출 측 (handler)
// 이 best-effort 정리 + toast 로 사용자에게 surface 한다.
// date 2026-05-02
#[test]
fn test_write_text_file_export_rejects_invalid_path() {
    let dir = TempDir::new().unwrap();
    // 디렉토리 자체에 쓰려고 하면 OS 가 거절.
    let result = write_text_file(dir.path(), "ignored");
    assert!(result.is_err(), "expected failure writing to a directory");
}

// [Invariant] ExportFormat round-trips through serde with lowercase
// wire strings — frontend and backend share the same enum literals.
// 2026-05-01.
#[test]
fn test_export_format_serde_lowercase() {
    assert_eq!(
        serde_json::to_string(&ExportFormat::Csv).unwrap(),
        "\"csv\""
    );
    assert_eq!(
        serde_json::to_string(&ExportFormat::Tsv).unwrap(),
        "\"tsv\""
    );
    assert_eq!(
        serde_json::to_string(&ExportFormat::Sql).unwrap(),
        "\"sql\""
    );
    assert_eq!(
        serde_json::to_string(&ExportFormat::Json).unwrap(),
        "\"json\""
    );
    let parsed: ExportFormat = serde_json::from_str("\"csv\"").unwrap();
    assert_eq!(parsed, ExportFormat::Csv);
}

// ── Sprint 192 schema dump helpers ────────────────────────────────────
//
// Reason for these tests (2026-05-02): PG INSERT formatter 의 dialect
// 별 escape 가 schema dump SQL 의 round-trip 을 결정한다. lib pure
// 함수만 격리해 회귀 가드 — streaming / cursor 자체는 real PG 가
// 필요해 smoke 로 미룸.

// [AC-192-05] Identifier escape: ANSI double-quote with embedded `"`
// doubled. PG/SQLite 공통 ANSI rule.
#[test]
fn test_quote_pg_identifier_doubles_embedded_quote() {
    assert_eq!(quote_pg_identifier("plain"), r#""plain""#);
    assert_eq!(quote_pg_identifier(r#"weird"col"#), r#""weird""col""#);
    assert_eq!(
        quote_pg_identifier("스키마"),
        "\"\u{c2a4}\u{d0a4}\u{b9c8}\""
    );
}

// [AC-192-05] String literal escape: single-quote doubled, embedded
// CR/LF preserved (PG 는 multi-line literal 허용).
#[test]
fn test_quote_pg_string_single_quote_escape() {
    assert_eq!(quote_pg_string("O'Reilly"), "'O''Reilly'");
    assert_eq!(quote_pg_string(""), "''");
    assert_eq!(quote_pg_string("a\nb"), "'a\nb'");
}

// [AC-192-05] qualified table builds `"schema"."table"`.
#[test]
fn test_qualified_pg_table_builds_dot_form() {
    assert_eq!(qualified_pg_table("public", "users"), r#""public"."users""#);
    assert_eq!(
        qualified_pg_table(r#"weird"sc"#, r#"weird"tb"#),
        r#""weird""sc"."weird""tb""#
    );
}

// [AC-192-05] pg_value_to_sql_literal: NULL is bare literal.
#[test]
fn test_pg_value_to_sql_literal_null_is_bare() {
    assert_eq!(pg_value_to_sql_literal(&JsonValue::Null), "NULL");
}

// [AC-192-05] pg_value_to_sql_literal: Bool → TRUE/FALSE (PG keyword).
#[test]
fn test_pg_value_to_sql_literal_bool_uppercase() {
    assert_eq!(pg_value_to_sql_literal(&json!(true)), "TRUE");
    assert_eq!(pg_value_to_sql_literal(&json!(false)), "FALSE");
}

// [AC-192-05] Number passes through unquoted (preserves int / float).
#[test]
fn test_pg_value_to_sql_literal_number_unquoted() {
    assert_eq!(pg_value_to_sql_literal(&json!(42)), "42");
    assert_eq!(pg_value_to_sql_literal(&json!(-7)), "-7");
    assert_eq!(pg_value_to_sql_literal(&json!(2.5)), "2.5");
}

// [AC-192-05] String → quoted + escaped. row_to_json 으로 들어온
// bytea hex (`\\x...`), uuid, timestamp ISO 8601 모두 String variant
// 라 같은 path — restore 시 PG 가 column type 에 따라 implicit cast.
#[test]
fn test_pg_value_to_sql_literal_string_escapes_quote() {
    assert_eq!(pg_value_to_sql_literal(&json!("hello")), "'hello'");
    assert_eq!(pg_value_to_sql_literal(&json!("O'Reilly")), "'O''Reilly'");
    // bytea round-trip: row_to_json 의 `"\\x6162"` → literal `'\x6162'`.
    // serde_json 의 `"\\x6162"` 직렬화는 backslash 1개 + x. INSERT
    // 시점에 PG 가 bytea column type 이면 implicit cast 된다.
    assert_eq!(pg_value_to_sql_literal(&json!("\\x6162")), "'\\x6162'");
}

// [AC-192-05] Array / Object → '...'::jsonb. PG 의 implicit cast 가
// text → jsonb 로 가능하지만 명시 cast 가 restore 견고함을 보장.
#[test]
fn test_pg_value_to_sql_literal_object_casts_jsonb() {
    let lit = pg_value_to_sql_literal(&json!({"k": "v"}));
    assert!(lit.ends_with("::jsonb"), "lit: {}", lit);
    assert!(lit.contains("'{\"k\":\"v\"}'"), "lit: {}", lit);
}

#[test]
fn test_pg_value_to_sql_literal_array_casts_jsonb() {
    let lit = pg_value_to_sql_literal(&json!([1, 2, "a"]));
    assert!(lit.ends_with("::jsonb"), "lit: {}", lit);
    assert!(lit.contains("'[1,2,\"a\"]'"), "lit: {}", lit);
}

// ── run_schema_dump direct tests (Sprint 237 P5) ─────────────────────
//
// 작성 이유 (2026-05-08): export/mod.rs 의 `run_schema_dump` body 가
// 0% coverage (Tauri command wrapper `export_schema_dump` 만 통합
// smoke 로 doctored). private async fn 이지만 `&AppState` 만 받으므로
// `AppState::new()` + 공유 stub 으로 직접 구동 가능. dispatch 분기
// (NotFound / Unsupported / Ok / Cancel / batch_size=0) 와 mpsc drain
// 회로 (table 별 INSERT formatting) 를 격리해 회귀 가드.

use crate::commands::connection::AppState;
use crate::db::testing::StubRdbAdapter;
use crate::db::ActiveAdapter;
use crate::error::AppError;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

fn dump_table(schema: &str, table: &str, cols: Vec<&str>) -> ExportDumpTable {
    ExportDumpTable {
        schema: schema.into(),
        table: table.into(),
        column_names: cols.into_iter().map(|s| s.into()).collect(),
    }
}

fn dump_opts(include: ExportInclude, batch_size: u32) -> ExportSchemaDumpOptions {
    ExportSchemaDumpOptions {
        include,
        batch_size,
    }
}

#[tokio::test]
async fn run_schema_dump_rejects_zero_batch_size() {
    let state = AppState::new();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("dump.sql");
    let res = super::run_schema_dump(
        &state,
        "conn-x",
        &path,
        "",
        "",
        &[],
        &dump_opts(ExportInclude::Both, 0),
        None,
    )
    .await;
    match res {
        Err(AppError::Validation(msg)) => assert!(msg.contains("batch_size")),
        other => panic!("expected Validation err, got {:?}", other.is_ok()),
    }
}

#[tokio::test]
async fn run_schema_dump_writes_ddl_header_only_when_include_ddl_no_tables() {
    let state = AppState::new();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("ddl_only.sql");
    // 끝에 `\n` 없는 header → 자동 append 되는 분기 검증.
    let header = "CREATE TABLE t();";
    let summary = super::run_schema_dump(
        &state,
        "conn-x",
        &path,
        header,
        "",
        &[],
        &dump_opts(ExportInclude::Ddl, 100),
        None,
    )
    .await
    .unwrap();
    assert_eq!(summary.rows_written, 0);
    let body = std::fs::read_to_string(&path).unwrap();
    assert_eq!(body, format!("{}\n", header));
    assert_eq!(summary.bytes_written as usize, body.len());
}

#[tokio::test]
async fn run_schema_dump_appends_footer_with_sequence_resets_section() {
    let state = AppState::new();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("footer.sql");
    let footer = "SELECT setval('s', 1);";
    let summary = super::run_schema_dump(
        &state,
        "conn-x",
        &path,
        "",
        footer,
        &[],
        &dump_opts(ExportInclude::Ddl, 100),
        None,
    )
    .await
    .unwrap();
    let body = std::fs::read_to_string(&path).unwrap();
    assert!(body.contains("Sequence resets"));
    assert!(body.contains(footer));
    assert!(body.ends_with('\n'));
    assert_eq!(summary.bytes_written as usize, body.len());
}

#[tokio::test]
async fn run_schema_dump_dml_returns_database_err_when_connection_missing() {
    let state = AppState::new();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("missing.sql");
    let res = super::run_schema_dump(
        &state,
        "no-such-conn",
        &path,
        "",
        "",
        &[dump_table("public", "t", vec!["id"])],
        &dump_opts(ExportInclude::Dml, 100),
        None,
    )
    .await;
    match res {
        Err(AppError::Database(msg)) => assert!(msg.contains("not found")),
        other => panic!("expected Database not-found, got {:?}", other.is_ok()),
    }
}

#[tokio::test]
async fn run_schema_dump_dml_rejects_non_rdb_paradigm_with_unsupported() {
    use crate::db::testing::StubDocumentAdapter;

    let state = AppState::new();
    {
        let mut active = state.active_connections.lock().await;
        active.insert(
            "doc-conn".into(),
            ActiveAdapter::Document(Box::new(StubDocumentAdapter::default())),
        );
    }
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("paradigm.sql");
    let res = super::run_schema_dump(
        &state,
        "doc-conn",
        &path,
        "",
        "",
        &[dump_table("db", "c", vec!["id"])],
        &dump_opts(ExportInclude::Dml, 100),
        None,
    )
    .await;
    match res {
        Err(AppError::Unsupported(msg)) => assert!(msg.contains("relational")),
        other => panic!("expected Unsupported, got {:?}", other.is_ok()),
    }
}

#[tokio::test]
async fn run_schema_dump_skips_tables_with_empty_column_names() {
    // column_names 가 비어 있으면 INSERT 생성을 skip — DDL 만 의미 있는
    // 테이블에 대한 보호.
    let state = AppState::new();
    {
        let mut active = state.active_connections.lock().await;
        active.insert(
            "rdb-conn".into(),
            ActiveAdapter::Rdb(Box::new(StubRdbAdapter::default())),
        );
    }
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("skip.sql");
    let summary = super::run_schema_dump(
        &state,
        "rdb-conn",
        &path,
        "",
        "",
        &[dump_table("public", "t", vec![])], // empty cols
        &dump_opts(ExportInclude::Dml, 100),
        None,
    )
    .await
    .unwrap();
    assert_eq!(summary.rows_written, 0);
    let body = std::fs::read_to_string(&path).unwrap();
    assert!(!body.contains("INSERT"));
    // 빈 column 테이블은 header 도 안 찍음.
    assert!(!body.contains("Data:"));
}

#[tokio::test]
async fn run_schema_dump_short_circuits_when_pre_cancelled() {
    let state = AppState::new();
    {
        let mut active = state.active_connections.lock().await;
        active.insert(
            "rdb-conn".into(),
            ActiveAdapter::Rdb(Box::new(StubRdbAdapter::default())),
        );
    }
    let token = CancellationToken::new();
    token.cancel();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("cancel.sql");
    let res = super::run_schema_dump(
        &state,
        "rdb-conn",
        &path,
        "",
        "",
        &[dump_table("public", "t", vec!["id"])],
        &dump_opts(ExportInclude::Dml, 100),
        Some(&token),
    )
    .await;
    match res {
        Err(AppError::Database(msg)) => assert!(msg.contains("cancelled")),
        other => panic!("expected cancelled, got {:?}", other.is_ok()),
    }
}

#[tokio::test]
async fn run_schema_dump_writes_insert_lines_for_streamed_rows() {
    // stub adapter 의 stream_table_rows 는 default = Unsupported.
    // 통합 검증을 위해 stream_table_rows_fn 이 closure 로 batch 를 보낼
    // 수 있어야 — testing.rs 가 그 hook 을 노출하지 않으므로 별도 inline
    // adapter 를 작성한다.
    use crate::db::traits::{DbAdapter, RdbAdapter};
    use crate::db::types::{BoxFuture, NamespaceInfo, NamespaceLabel, RdbQueryResult};
    use crate::models::{
        AddColumnRequest, AddConstraintRequest, AlterTableRequest, ColumnInfo, ConnectionConfig,
        ConstraintInfo, CreateIndexRequest, CreateTableRequest, DatabaseType, DropColumnRequest,
        DropConstraintRequest, DropIndexRequest, DropTableRequest, FilterCondition, IndexInfo,
        RenameTableRequest, SchemaChangeResult, TableData, TableInfo,
    };
    use std::collections::HashMap;

    struct StreamingStub {
        batches: Arc<std::sync::Mutex<Vec<Vec<Vec<JsonValue>>>>>,
    }
    impl DbAdapter for StreamingStub {
        fn kind(&self) -> DatabaseType {
            DatabaseType::Postgresql
        }
        fn connect<'a>(&'a self, _c: &'a ConnectionConfig) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
        fn disconnect<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
        fn ping<'a>(&'a self) -> BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
    }
    impl RdbAdapter for StreamingStub {
        fn namespace_label(&self) -> NamespaceLabel {
            NamespaceLabel::Schema
        }
        fn list_namespaces<'a>(&'a self) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
            Box::pin(async { Ok(Vec::new()) })
        }
        fn list_tables<'a>(
            &'a self,
            _ns: &'a str,
        ) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>> {
            Box::pin(async { Ok(Vec::new()) })
        }
        fn get_columns<'a>(
            &'a self,
            _ns: &'a str,
            _t: &'a str,
            _c: Option<&'a CancellationToken>,
        ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
            Box::pin(async { Ok(Vec::new()) })
        }
        fn execute_sql<'a>(
            &'a self,
            _s: &'a str,
            _c: Option<&'a CancellationToken>,
        ) -> BoxFuture<'a, Result<RdbQueryResult, AppError>> {
            Box::pin(async {
                Ok(RdbQueryResult {
                    columns: Vec::new(),
                    rows: Vec::new(),
                    total_count: 0,
                    execution_time_ms: 0,
                    query_type: crate::models::QueryType::Select,
                })
            })
        }
        #[allow(clippy::too_many_arguments)]
        fn query_table_data<'a>(
            &'a self,
            _ns: &'a str,
            _t: &'a str,
            _p: i32,
            _ps: i32,
            _ob: Option<&'a str>,
            _f: Option<&'a [FilterCondition]>,
            _rw: Option<&'a str>,
            _c: Option<&'a CancellationToken>,
        ) -> BoxFuture<'a, Result<TableData, AppError>> {
            Box::pin(async {
                Ok(TableData {
                    columns: Vec::new(),
                    rows: Vec::new(),
                    total_count: 0,
                    page: 1,
                    page_size: 0,
                    executed_query: String::new(),
                })
            })
        }
        fn drop_table<'a>(
            &'a self,
            _r: &'a DropTableRequest,
        ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
            Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
        }
        fn rename_table<'a>(
            &'a self,
            _r: &'a RenameTableRequest,
        ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
            Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
        }
        fn alter_table<'a>(
            &'a self,
            _r: &'a AlterTableRequest,
        ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
            Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
        }
        fn add_column<'a>(
            &'a self,
            _r: &'a AddColumnRequest,
        ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
            Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
        }
        fn drop_column<'a>(
            &'a self,
            _r: &'a DropColumnRequest,
        ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
            Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
        }
        fn create_table<'a>(
            &'a self,
            _r: &'a CreateTableRequest,
        ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
            Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
        }
        fn create_index<'a>(
            &'a self,
            _r: &'a CreateIndexRequest,
        ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
            Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
        }
        fn drop_index<'a>(
            &'a self,
            _r: &'a DropIndexRequest,
        ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
            Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
        }
        fn add_constraint<'a>(
            &'a self,
            _r: &'a AddConstraintRequest,
        ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
            Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
        }
        fn drop_constraint<'a>(
            &'a self,
            _r: &'a DropConstraintRequest,
        ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
            Box::pin(async { Ok(SchemaChangeResult { sql: String::new() }) })
        }
        fn get_table_indexes<'a>(
            &'a self,
            _ns: &'a str,
            _t: &'a str,
            _c: Option<&'a CancellationToken>,
        ) -> BoxFuture<'a, Result<Vec<IndexInfo>, AppError>> {
            Box::pin(async { Ok(Vec::new()) })
        }
        fn get_table_constraints<'a>(
            &'a self,
            _ns: &'a str,
            _t: &'a str,
            _c: Option<&'a CancellationToken>,
        ) -> BoxFuture<'a, Result<Vec<ConstraintInfo>, AppError>> {
            Box::pin(async { Ok(Vec::new()) })
        }
        fn get_view_definition<'a>(
            &'a self,
            _ns: &'a str,
            _v: &'a str,
        ) -> BoxFuture<'a, Result<String, AppError>> {
            Box::pin(async { Ok(String::new()) })
        }
        fn get_view_columns<'a>(
            &'a self,
            _ns: &'a str,
            _v: &'a str,
        ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
            Box::pin(async { Ok(Vec::new()) })
        }
        fn list_schema_columns<'a>(
            &'a self,
            _ns: &'a str,
        ) -> BoxFuture<'a, Result<HashMap<String, Vec<ColumnInfo>>, AppError>> {
            Box::pin(async { Ok(HashMap::new()) })
        }
        fn get_function_source<'a>(
            &'a self,
            _ns: &'a str,
            _f: &'a str,
        ) -> BoxFuture<'a, Result<String, AppError>> {
            Box::pin(async { Ok(String::new()) })
        }
        fn stream_table_rows<'a>(
            &'a self,
            _ns: &'a str,
            _t: &'a str,
            _bs: u32,
            _cols: &'a [String],
            sender: mpsc::Sender<Vec<Vec<JsonValue>>>,
            _c: Option<&'a CancellationToken>,
        ) -> BoxFuture<'a, Result<u64, AppError>> {
            let batches = self.batches.clone();
            Box::pin(async move {
                let snapshot: Vec<Vec<Vec<JsonValue>>> = batches.lock().unwrap().clone();
                let mut total: u64 = 0;
                for batch in snapshot {
                    total += batch.len() as u64;
                    if sender.send(batch).await.is_err() {
                        break;
                    }
                }
                Ok(total)
            })
        }
    }

    let stub = StreamingStub {
        batches: Arc::new(std::sync::Mutex::new(vec![
            vec![vec![json!(1), json!("alice")], vec![json!(2), json!("bob")]],
            vec![vec![JsonValue::Null, json!("carol")]],
        ])),
    };

    let state = AppState::new();
    {
        let mut active = state.active_connections.lock().await;
        active.insert("rdb-conn".into(), ActiveAdapter::Rdb(Box::new(stub)));
    }

    let dir = TempDir::new().unwrap();
    let path = dir.path().join("inserts.sql");
    let summary = super::run_schema_dump(
        &state,
        "rdb-conn",
        &path,
        "",
        "",
        &[dump_table("public", "users", vec!["id", "name"])],
        &dump_opts(ExportInclude::Dml, 2),
        None,
    )
    .await
    .unwrap();
    assert_eq!(summary.rows_written, 3);

    let body = std::fs::read_to_string(&path).unwrap();
    let insert_count = body.matches("INSERT INTO").count();
    assert_eq!(insert_count, 3);
    assert!(body.contains(r#"INSERT INTO "public"."users" ("id", "name") VALUES (1, 'alice');"#));
    assert!(body.contains(r#"VALUES (NULL, 'carol');"#));
    assert!(body.contains("Data: \"public\".\"users\""));
}

// [AC-192-05] ExportInclude serde lowercase wire — frontend `"ddl"`
// 등이 정확히 enum variant 로 매칭.
#[test]
fn test_export_include_serde_lowercase() {
    assert_eq!(
        serde_json::to_string(&ExportInclude::Ddl).unwrap(),
        "\"ddl\""
    );
    assert_eq!(
        serde_json::to_string(&ExportInclude::Dml).unwrap(),
        "\"dml\""
    );
    assert_eq!(
        serde_json::to_string(&ExportInclude::Both).unwrap(),
        "\"both\""
    );
    let parsed: ExportInclude = serde_json::from_str("\"both\"").unwrap();
    assert_eq!(parsed, ExportInclude::Both);
}
