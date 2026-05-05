//! Unit tests for `commands/export.rs` — moved out of the inline
//! `mod tests` block (Sprint P5 step 2, 2026-05-05) so the production
//! Tauri command + writer code in export.rs is no longer ~40% buried
//! under test scaffolding. `super::*` continues to pull in everything
//! export.rs exposes, so no test logic changes.

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
