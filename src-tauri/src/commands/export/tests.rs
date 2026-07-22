//! Unit tests for `commands/export/*` — moved out of the inline
//! `mod tests` block (Sprint P5 step 1, commit a60074d). Sprint 213
//! (P5 step 2b) then split format-specific writers into the
//! `grid_writers` sibling module, so this file imports the writer
//! helpers explicitly. No test logic changed.

use super::dump_writers::quote_pg_string;
use super::grid_writers::{
    json_to_cell_string, json_to_sql_literal, quote_sql_identifier, quote_sql_string,
};
use super::mssql_dump::{
    mssql_value_to_sql_literal, qualified_mssql_table, quote_mssql_identifier, quote_mssql_string,
};
use super::mysql_dump::{
    mysql_value_to_sql_literal, qualified_mysql_table, quote_mysql_identifier, quote_mysql_string,
};
use super::oracle_dump::{
    oracle_value_to_sql_literal, qualified_oracle_table, quote_oracle_identifier,
    quote_oracle_string,
};
use super::*;
use crate::models::ColumnCategory;
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

// ── Issue #1638: tabular JSON export (table/query context) ───────────
//
// 작성 이유 (2026-07-17): #1077 Stage 1 은 table/query 결과의 JSON export 를
// 약속하지만 기존 JSON writer 는 Mongo collection 전용 (row.first() = 문서
// 전체). preflight 도 collection 만 허용했다. 아래는 tabular array-of-objects
// writer 계약 — headers 를 key 로 하는 object 배열, header 순서 보존,
// NULL/중첩 JSON cell/wire-string(#1082) 직렬화. writer 분기 GREEN 전에는
// preflight reject 로 RED.

fn tabular_json_string(headers: &[&str], rows: &[Vec<JsonValue>], ctx: &ExportContext) -> String {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("out.json");
    let hv: Vec<String> = headers.iter().map(|s| s.to_string()).collect();
    write_export(ExportFormat::Json, &path, &hv, rows, ctx, None).unwrap();
    read_to_string(&path)
}

// [AC-1638-01] table context JSON = array of objects keyed by headers,
// framed identically to the collection writer (`[`/`]\n`, 2-space indent).
#[test]
fn test_tabular_json_table_ctx_array_of_objects() {
    let body = tabular_json_string(
        &["id", "name"],
        &[vec![json!(1), json!("alice")], vec![json!(2), json!("bob")]],
        &table_ctx(),
    );
    assert_eq!(
        body,
        "[\n  {\n    \"id\": 1,\n    \"name\": \"alice\"\n  }\n,\n  {\n    \"id\": 2,\n    \"name\": \"bob\"\n  }\n]\n"
    );
}

// [AC-1638-01] header order is preserved verbatim, not alphabetized —
// `zeta` before `alpha` proves the writer does not lean on a sorted map.
#[test]
fn test_tabular_json_preserves_header_order_not_alphabetical() {
    let body = tabular_json_string(
        &["zeta", "alpha"],
        &[vec![json!(1), json!(2)]],
        &table_ctx(),
    );
    let zi = body.find("zeta").unwrap();
    let ai = body.find("alpha").unwrap();
    assert!(zi < ai, "header order must be preserved: {body}");
}

// [AC-1638-05] NULL → json null, nested JSON cell preserved, BigInt/Decimal
// wire string (#1082) stays a JSON string (never coerced to a bare number).
// Uses Query { source_table: None } — JSON must be allowed there too.
#[test]
fn test_tabular_json_null_nested_and_wire_string() {
    let body = tabular_json_string(
        &["big", "meta", "maybe"],
        &[vec![
            json!("123456789012345678901234567890"),
            json!({"k": [1, 2]}),
            JsonValue::Null,
        ]],
        &ExportContext::Query { source_table: None },
    );
    assert!(
        body.contains("\"big\": \"123456789012345678901234567890\""),
        "wire string must stay quoted: {body}"
    );
    assert!(body.contains("\"maybe\": null"), "null cell: {body}");
    assert!(body.contains("\"meta\": {"), "nested object cell: {body}");
    assert!(body.contains("\"k\": ["), "nested array preserved: {body}");
}

// [AC-1638-01] regression guard: adding the tabular branch must NOT change
// the existing Mongo collection JSON output. Byte-exact fixture pins the
// collection path (row.first() = document, relax_extended_json passthrough).
#[test]
fn test_collection_json_output_byte_exact_regression() {
    let body = tabular_json_string(
        &["_doc"],
        &[
            vec![json!({"_id": {"$oid": "5099803df3f4948bd2f98391"}, "n": 1})],
            vec![json!({"_id": {"$oid": "5099803df3f4948bd2f98392"}, "n": 2})],
        ],
        &ExportContext::Collection {
            name: "users".into(),
        },
    );
    assert_eq!(
        body,
        "[\n  {\n    \"_id\": {\n      \"$oid\": \"5099803df3f4948bd2f98391\"\n    },\n    \"n\": 1\n  }\n,\n  {\n    \"_id\": {\n      \"$oid\": \"5099803df3f4948bd2f98392\"\n    },\n    \"n\": 2\n  }\n]\n"
    );
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
    assert_eq!(
        pg_value_to_sql_literal(&JsonValue::Null, ColumnCategory::Unknown),
        "NULL"
    );
}

// [AC-192-05] pg_value_to_sql_literal: Bool → TRUE/FALSE (PG keyword).
#[test]
fn test_pg_value_to_sql_literal_bool_uppercase() {
    assert_eq!(
        pg_value_to_sql_literal(&json!(true), ColumnCategory::Bool),
        "TRUE"
    );
    assert_eq!(
        pg_value_to_sql_literal(&json!(false), ColumnCategory::Bool),
        "FALSE"
    );
}

// [AC-192-05] Number passes through unquoted (preserves int / float).
#[test]
fn test_pg_value_to_sql_literal_number_unquoted() {
    assert_eq!(
        pg_value_to_sql_literal(&json!(42), ColumnCategory::Int),
        "42"
    );
    assert_eq!(
        pg_value_to_sql_literal(&json!(-7), ColumnCategory::Int),
        "-7"
    );
    assert_eq!(
        pg_value_to_sql_literal(&json!(2.5), ColumnCategory::Float),
        "2.5"
    );
}

// [AC-192-05] String → quoted + escaped. row_to_json 으로 들어온
// bytea hex (`\\x...`), uuid, timestamp ISO 8601 모두 String variant
// 라 같은 path — restore 시 PG 가 column type 에 따라 implicit cast.
#[test]
fn test_pg_value_to_sql_literal_string_escapes_quote() {
    assert_eq!(
        pg_value_to_sql_literal(&json!("hello"), ColumnCategory::Text),
        "'hello'"
    );
    assert_eq!(
        pg_value_to_sql_literal(&json!("O'Reilly"), ColumnCategory::Text),
        "'O''Reilly'"
    );
    // bytea round-trip: row_to_json 의 `"\\x6162"` → literal `'\x6162'`.
    // serde_json 의 `"\\x6162"` 직렬화는 backslash 1개 + x. INSERT
    // 시점에 PG 가 bytea column type 이면 implicit cast 된다. #1677: PG
    // keeps the quoted `'\x…'` form even for a Binary category — its bytea
    // input parser casts it back to the exact bytes (unlike MySQL/MSSQL).
    assert_eq!(
        pg_value_to_sql_literal(&json!("\\x6162"), ColumnCategory::Binary),
        "'\\x6162'"
    );
}

// [AC-192-05] Array / Object → '...'::jsonb. PG 의 implicit cast 가
// text → jsonb 로 가능하지만 명시 cast 가 restore 견고함을 보장.
#[test]
fn test_pg_value_to_sql_literal_object_casts_jsonb() {
    let lit = pg_value_to_sql_literal(&json!({"k": "v"}), ColumnCategory::Object);
    assert!(lit.ends_with("::jsonb"), "lit: {}", lit);
    assert!(lit.contains("'{\"k\":\"v\"}'"), "lit: {}", lit);
}

#[test]
fn test_pg_value_to_sql_literal_array_casts_jsonb() {
    let lit = pg_value_to_sql_literal(&json!([1, 2, "a"]), ColumnCategory::Object);
    assert!(lit.ends_with("::jsonb"), "lit: {}", lit);
    assert!(lit.contains("'[1,2,\"a\"]'"), "lit: {}", lit);
}

// ── MySQL dump writer (Sprint #1641 / #1077 Stage 1) ──────────────────
//
// Reason (2026-07-17): `export_schema_dump` hardcoded PG quoting, so MySQL
// dumps went out as ANSI double-quote identifiers + `::jsonb` casts that a
// default-sql_mode MySQL rejects (not vendor-restorable). These lock the
// backtick-identifier + backslash-aware string-escape contract of the new
// `mysql_dump` sibling. Pure functions isolated; the real cursor round-trip
// lives in `tests/mysql_integration.rs`.

// [AC-1641-02] Identifier: backtick-quoted, embedded backtick doubled.
#[test]
fn test_quote_mysql_identifier_doubles_embedded_backtick() {
    assert_eq!(quote_mysql_identifier("plain"), "`plain`");
    assert_eq!(quote_mysql_identifier("weird`col"), "`weird``col`");
    // Backtick dialect leaves an embedded double-quote untouched (unlike PG).
    assert_eq!(quote_mysql_identifier(r#"a"b"#), "`a\"b`");
}

// [AC-1641-02] qualified table builds `schema`.`table` (schema == database).
#[test]
fn test_qualified_mysql_table_builds_backtick_dot_form() {
    assert_eq!(qualified_mysql_table("test", "users"), "`test`.`users`");
    assert_eq!(qualified_mysql_table("we`ird", "t`b"), "`we``ird`.`t``b`");
}

// [AC-1641-02] String literal: single-quote doubled AND backslash doubled —
// the critical divergence from PG (default sql_mode treats `\` as an escape).
#[test]
fn test_quote_mysql_string_escapes_backslash_and_quote() {
    assert_eq!(quote_mysql_string("O'Reilly"), "'O''Reilly'");
    assert_eq!(quote_mysql_string(""), "''");
    // Lone backslash must be doubled or MySQL eats the closing quote.
    assert_eq!(quote_mysql_string(r"a\b"), r"'a\\b'");
    // Backslash + quote together: each escaped independently.
    assert_eq!(quote_mysql_string(r"c:\'x"), r"'c:\\''x'");
    // Newlines/tabs are legal inside a MySQL literal — passed through.
    assert_eq!(quote_mysql_string("a\nb"), "'a\nb'");
}

// [AC-1641-02] Value literals mirror PG scalars but Array/Object drops the
// PG `::jsonb` cast (MySQL casts a string literal into a JSON column).
#[test]
fn test_mysql_value_to_sql_literal_scalars() {
    assert_eq!(
        mysql_value_to_sql_literal(&JsonValue::Null, ColumnCategory::Unknown),
        "NULL"
    );
    assert_eq!(
        mysql_value_to_sql_literal(&json!(true), ColumnCategory::Bool),
        "TRUE"
    );
    assert_eq!(
        mysql_value_to_sql_literal(&json!(false), ColumnCategory::Bool),
        "FALSE"
    );
    assert_eq!(
        mysql_value_to_sql_literal(&json!(42), ColumnCategory::Int),
        "42"
    );
    assert_eq!(
        mysql_value_to_sql_literal(&json!(-7), ColumnCategory::Int),
        "-7"
    );
    assert_eq!(
        mysql_value_to_sql_literal(&json!(2.5), ColumnCategory::Float),
        "2.5"
    );
    assert_eq!(
        mysql_value_to_sql_literal(&json!("O'Reilly"), ColumnCategory::Text),
        "'O''Reilly'"
    );
    // BIGINT/DECIMAL arrive as precision-preserving JSON strings — quoted,
    // MySQL casts them back into the numeric column on restore.
    assert_eq!(
        mysql_value_to_sql_literal(&json!("9223372036854775807"), ColumnCategory::Int),
        "'9223372036854775807'"
    );
}

#[test]
fn test_mysql_value_to_sql_literal_json_has_no_jsonb_cast() {
    let obj = mysql_value_to_sql_literal(&json!({"k": "v"}), ColumnCategory::Object);
    assert_eq!(obj, "'{\"k\":\"v\"}'");
    assert!(!obj.contains("::jsonb"), "lit: {}", obj);
    let arr = mysql_value_to_sql_literal(&json!([1, 2, "a"]), ColumnCategory::Object);
    assert_eq!(arr, "'[1,2,\"a\"]'");
    // JSON containing a backslash escape must survive the MySQL escape layer.
    let esc = mysql_value_to_sql_literal(&json!({"p": "c:\\x"}), ColumnCategory::Object);
    assert_eq!(esc, r#"'{"p":"c:\\\\x"}'"#);
}

// Issue #1677 — a Binary-category cell (`cell_to_json` renders it as a
// `"0x<hex>"` string) MUST become an unquoted MySQL binary literal `X'<hex>'`,
// not a quoted `'0x<hex>'` string. Quoting stores the ASCII bytes of the hex
// text, silently corrupting varbinary/BLOB on restore.
#[test]
fn test_mysql_binary_category_emits_unquoted_binary_literal_1677() {
    assert_eq!(
        mysql_value_to_sql_literal(&json!("0x0aff"), ColumnCategory::Binary),
        "X'0aff'"
    );
    // Empty blob: `cell_to_json` yields `"0x"`. `0x` alone is not a valid MySQL
    // literal, so the writer must fall back to `X''` (a valid empty binary).
    assert_eq!(
        mysql_value_to_sql_literal(&json!("0x"), ColumnCategory::Binary),
        "X''"
    );
    // A NULL binary cell stays NULL (never a bogus `X'…'`).
    assert_eq!(
        mysql_value_to_sql_literal(&JsonValue::Null, ColumnCategory::Binary),
        "NULL"
    );
    // False-positive guard: a TEXT column whose value merely starts with `0x`
    // is NOT binary — it stays a quoted string. Type-driven, not a heuristic.
    assert_eq!(
        mysql_value_to_sql_literal(&json!("0xNotBinary"), ColumnCategory::Text),
        "'0xNotBinary'"
    );
}

// Issue #1642 — the T-SQL `mssql_dump` writer sibling. Same contract as the
// pure-function mysql tests above: bracket-quoted identifiers, backslash-neutral
// T-SQL string escaping, bool → BIT `1`/`0`, and no jsonb/backtick leak. The
// live cursor round-trip lives in `tests/mssql_integration.rs`.

// [AC-1642-02] Identifier: bracket-quoted, embedded `]` doubled.
#[test]
fn test_quote_mssql_identifier_doubles_embedded_bracket() {
    assert_eq!(quote_mssql_identifier("plain"), "[plain]");
    assert_eq!(quote_mssql_identifier("odd]col"), "[odd]]col]");
    // Bracket dialect leaves an embedded double-quote / backtick untouched.
    assert_eq!(quote_mssql_identifier(r#"a"b"#), r#"[a"b]"#);
    assert_eq!(quote_mssql_identifier("a`b"), "[a`b]");
}

// [AC-1642-02] Qualified: `[schema].[table]`, both bracket-escaped.
#[test]
fn test_qualified_mssql_table_builds_bracket_dot_form() {
    assert_eq!(qualified_mssql_table("dbo", "users"), "[dbo].[users]");
    assert_eq!(qualified_mssql_table("od]d", "t]b"), "[od]]d].[t]]b]");
}

// [AC-1642-02] String: `N'...'` (Unicode-safe) with only the single quote
// doubled; backslash is a literal (unlike MySQL, which would double it).
#[test]
fn test_quote_mssql_string_uses_n_prefix_doubles_quote_keeps_backslash() {
    assert_eq!(quote_mssql_string("O'Reilly"), "N'O''Reilly'");
    assert_eq!(quote_mssql_string(""), "N''");
    assert_eq!(quote_mssql_string(r"a\b"), r"N'a\b'");
    assert_eq!(quote_mssql_string(r"c:\'x"), r"N'c:\''x'");
    assert_eq!(quote_mssql_string("a\nb"), "N'a\nb'");
    // #1642 B1 — non-ASCII must ride an `N'...'` literal so a restore into an
    // nvarchar column does not code-page-fold Korean/Japanese/emoji to `?`.
    assert_eq!(quote_mssql_string("안녕"), "N'안녕'");
    assert_eq!(quote_mssql_string("café☕"), "N'café☕'");
    assert_eq!(quote_mssql_string("O'네일"), "N'O''네일'");
}

// [AC-1642-02] Scalars: bool → BIT `1`/`0` (T-SQL has no TRUE/FALSE).
#[test]
fn test_mssql_value_to_sql_literal_scalars() {
    assert_eq!(
        mssql_value_to_sql_literal(&JsonValue::Null, ColumnCategory::Unknown),
        "NULL"
    );
    assert_eq!(
        mssql_value_to_sql_literal(&json!(true), ColumnCategory::Bool),
        "1"
    );
    assert_eq!(
        mssql_value_to_sql_literal(&json!(false), ColumnCategory::Bool),
        "0"
    );
    assert_eq!(
        mssql_value_to_sql_literal(&json!(42), ColumnCategory::Int),
        "42"
    );
    assert_eq!(
        mssql_value_to_sql_literal(&json!(-7), ColumnCategory::Int),
        "-7"
    );
    assert_eq!(
        mssql_value_to_sql_literal(&json!(2.5), ColumnCategory::Float),
        "2.5"
    );
    assert_eq!(
        mssql_value_to_sql_literal(&json!("O'Reilly"), ColumnCategory::Text),
        "N'O''Reilly'"
    );
    assert_eq!(
        mssql_value_to_sql_literal(&json!("안녕"), ColumnCategory::Text),
        "N'안녕'"
    );
}

// [AC-1642-02] Array / Object → plain quoted JSON string, no PG `::jsonb` cast
// and no MySQL backslash doubling (SQL Server stores JSON in nvarchar).
#[test]
fn test_mssql_value_to_sql_literal_json_has_no_cast_or_backslash_escape() {
    let obj = mssql_value_to_sql_literal(&json!({"k": "v"}), ColumnCategory::Object);
    assert_eq!(obj, "N'{\"k\":\"v\"}'");
    assert!(!obj.contains("::jsonb"), "lit: {}", obj);
    let arr = mssql_value_to_sql_literal(&json!([1, 2, "a"]), ColumnCategory::Object);
    assert_eq!(arr, "N'[1,2,\"a\"]'");
    // A backslash inside the JSON stays single (T-SQL literal), where MySQL
    // would double it.
    let esc = mssql_value_to_sql_literal(&json!({"p": "c:\\x"}), ColumnCategory::Object);
    assert_eq!(esc, r#"N'{"p":"c:\\x"}'"#);
}

// Issue #1677 — a Binary-category cell (`"0x<hex>"` from `cell_to_json`) MUST
// become an unquoted T-SQL varbinary literal `0x<hex>`, not a quoted `N'0x…'`
// string, which would restore the hex TEXT rather than the raw bytes.
#[test]
fn test_mssql_binary_category_emits_unquoted_binary_literal_1677() {
    assert_eq!(
        mssql_value_to_sql_literal(&json!("0x0aff"), ColumnCategory::Binary),
        "0x0aff"
    );
    // Empty blob: `0x` alone is a valid empty binary literal in T-SQL, so it is
    // emitted verbatim (no `N'…'` wrapper).
    assert_eq!(
        mssql_value_to_sql_literal(&json!("0x"), ColumnCategory::Binary),
        "0x"
    );
    // A NULL binary cell stays NULL.
    assert_eq!(
        mssql_value_to_sql_literal(&JsonValue::Null, ColumnCategory::Binary),
        "NULL"
    );
    // False-positive guard: nvarchar text starting with `0x` stays a quoted
    // `N'…'` literal. Type-driven, never a value heuristic.
    assert_eq!(
        mssql_value_to_sql_literal(&json!("0xNotBinary"), ColumnCategory::Text),
        "N'0xNotBinary'"
    );
}

// Issue #1674 — the Oracle `oracle_dump` writer sibling. Same contract as the
// pure-function pg/mysql/mssql tests above: ANSI double-quote identifiers,
// single-quote string escape (backslash-neutral, like T-SQL), bool → `1`/`0`
// NUMBER (Oracle has no pre-23c BOOLEAN column type), `hextoraw('…')` binary
// literals, and no `::jsonb` cast. The live cursor round-trip lives in
// `tests/oracle_integration.rs`.
//
// RED #1674: these fail against the stub writer; GREEN un-ignores them.

// [AC-1674-02] Identifier: ANSI double-quoted, embedded `"` doubled.
#[test]
#[ignore = "RED #1674 — GREEN implements oracle_dump + un-ignores"]
fn test_quote_oracle_identifier_doubles_embedded_quote() {
    assert_eq!(quote_oracle_identifier("plain"), "\"plain\"");
    assert_eq!(quote_oracle_identifier(r#"od"col"#), r#""od""col""#);
    // Double-quote dialect leaves an embedded backtick / bracket untouched.
    assert_eq!(quote_oracle_identifier("a`b"), "\"a`b\"");
    assert_eq!(quote_oracle_identifier("a]b"), "\"a]b\"");
}

// [AC-1674-02] Qualified: `"schema"."table"`, both double-quote-escaped.
#[test]
#[ignore = "RED #1674 — GREEN implements oracle_dump + un-ignores"]
fn test_qualified_oracle_table_builds_double_quote_dot_form() {
    assert_eq!(qualified_oracle_table("HR", "USERS"), "\"HR\".\"USERS\"");
    assert_eq!(
        qualified_oracle_table(r#"o"d"#, r#"t"b"#),
        r#""o""d"."t""b""#
    );
}

// [AC-1674-02] String: single-quoted with only the single quote doubled;
// backslash is a literal (Oracle, like T-SQL, is not backslash-aware).
#[test]
#[ignore = "RED #1674 — GREEN implements oracle_dump + un-ignores"]
fn test_quote_oracle_string_doubles_quote_keeps_backslash() {
    assert_eq!(quote_oracle_string("O'Reilly"), "'O''Reilly'");
    assert_eq!(quote_oracle_string(""), "''");
    assert_eq!(quote_oracle_string(r"a\b"), r"'a\b'");
    assert_eq!(quote_oracle_string(r"c:\'x"), r"'c:\''x'");
    assert_eq!(quote_oracle_string("a\nb"), "'a\nb'");
    // AL32UTF8 database charset — non-ASCII rides a plain literal.
    assert_eq!(quote_oracle_string("안녕"), "'안녕'");
    assert_eq!(quote_oracle_string("café☕"), "'café☕'");
}

// [AC-1674-02] Scalars: bool → `1`/`0` NUMBER (no pre-23c BOOLEAN column type).
#[test]
#[ignore = "RED #1674 — GREEN implements oracle_dump + un-ignores"]
fn test_oracle_value_to_sql_literal_scalars() {
    assert_eq!(
        oracle_value_to_sql_literal(&JsonValue::Null, ColumnCategory::Unknown),
        "NULL"
    );
    assert_eq!(
        oracle_value_to_sql_literal(&json!(true), ColumnCategory::Bool),
        "1"
    );
    assert_eq!(
        oracle_value_to_sql_literal(&json!(false), ColumnCategory::Bool),
        "0"
    );
    assert_eq!(
        oracle_value_to_sql_literal(&json!(42), ColumnCategory::Int),
        "42"
    );
    assert_eq!(
        oracle_value_to_sql_literal(&json!(-7), ColumnCategory::Int),
        "-7"
    );
    assert_eq!(
        oracle_value_to_sql_literal(&json!(2.5), ColumnCategory::Float),
        "2.5"
    );
    assert_eq!(
        oracle_value_to_sql_literal(&json!("O'Reilly"), ColumnCategory::Text),
        "'O''Reilly'"
    );
    assert_eq!(
        oracle_value_to_sql_literal(&json!("안녕"), ColumnCategory::Text),
        "'안녕'"
    );
}

// [AC-1674-02] Array / Object → plain quoted JSON string, no PG `::jsonb` cast
// (Oracle implicitly coerces a string literal into a JSON column).
#[test]
#[ignore = "RED #1674 — GREEN implements oracle_dump + un-ignores"]
fn test_oracle_value_to_sql_literal_json_has_no_cast() {
    let obj = oracle_value_to_sql_literal(&json!({"k": "v"}), ColumnCategory::Object);
    assert_eq!(obj, "'{\"k\":\"v\"}'");
    assert!(!obj.contains("::jsonb"), "lit: {}", obj);
    let arr = oracle_value_to_sql_literal(&json!([1, 2, "a"]), ColumnCategory::Object);
    assert_eq!(arr, "'[1,2,\"a\"]'");
    // A backslash inside the JSON stays single (Oracle literal).
    let esc = oracle_value_to_sql_literal(&json!({"p": "c:\\x"}), ColumnCategory::Object);
    assert_eq!(esc, r#"'{"p":"c:\\x"}'"#);
}

// Issue #1674 — a Binary-category cell (`"0x<hex>"` from `cell_to_json`) MUST
// become a `HEXTORAW('<hex>')` binary literal, not a quoted `'0x…'` string that
// would restore the hex TEXT rather than the raw bytes. Oracle has no `0x`/`X''`
// literal syntax, so the `HEXTORAW` function is the vendor form.
#[test]
#[ignore = "RED #1674 — GREEN implements oracle_dump + un-ignores"]
fn test_oracle_binary_category_emits_hextoraw_literal() {
    assert_eq!(
        oracle_value_to_sql_literal(&json!("0x0aff"), ColumnCategory::Binary),
        "hextoraw('0aff')"
    );
    // Empty blob: `cell_to_json` yields `"0x"` → `HEXTORAW('')`.
    assert_eq!(
        oracle_value_to_sql_literal(&json!("0x"), ColumnCategory::Binary),
        "hextoraw('')"
    );
    // A NULL binary cell stays NULL (never a bogus `HEXTORAW`).
    assert_eq!(
        oracle_value_to_sql_literal(&JsonValue::Null, ColumnCategory::Binary),
        "NULL"
    );
    // False-positive guard: a TEXT column whose value merely starts with `0x`
    // is NOT binary — it stays a quoted string. Type-driven, not a heuristic.
    assert_eq!(
        oracle_value_to_sql_literal(&json!("0xNotBinary"), ColumnCategory::Text),
        "'0xNotBinary'"
    );
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
use crate::models::DatabaseType;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

fn dump_table(schema: &str, table: &str, cols: Vec<&str>) -> ExportDumpTable {
    ExportDumpTable {
        schema: schema.into(),
        table: table.into(),
        column_names: cols.into_iter().map(|s| s.into()).collect(),
        // #1677 — these dispatch tests exercise non-binary rows; an empty
        // categories vec makes every cell read back as `Unknown` (the existing
        // quoted path), matching pre-#1677 output.
        column_categories: Vec::new(),
    }
}

fn dump_opts(include: ExportInclude, batch_size: u32) -> ExportSchemaDumpOptions {
    // Default dialect (Postgresql) — every existing dump test asserts the PG
    // ANSI output, so this keeps them the byte-identical PG regression guard.
    dump_opts_dialect(include, batch_size, DatabaseType::Postgresql)
}

fn dump_opts_dialect(
    include: ExportInclude,
    batch_size: u32,
    dialect: DatabaseType,
) -> ExportSchemaDumpOptions {
    ExportSchemaDumpOptions {
        include,
        batch_size,
        dialect,
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
            std::sync::Arc::new(ActiveAdapter::Document(Box::new(
                StubDocumentAdapter::default(),
            ))),
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
            std::sync::Arc::new(ActiveAdapter::Rdb(Box::new(StubRdbAdapter::default()))),
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
            std::sync::Arc::new(ActiveAdapter::Rdb(Box::new(StubRdbAdapter::default()))),
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
                    truncated: false,
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
        active.insert(
            "rdb-conn".into(),
            std::sync::Arc::new(ActiveAdapter::Rdb(Box::new(stub))),
        );
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

    // [AC-1641-02] Same streamed rows, `dialect = mysql` → backtick
    // identifiers instead of ANSI double quotes. Pre-dispatch this asserted
    // the still-PG output (RED); the fn-pointer dialect dispatch turns it
    // GREEN. The default-Postgresql run above stays the byte-identical PG
    // regression guard.
    let mysql_path = dir.path().join("inserts_mysql.sql");
    let mysql_summary = super::run_schema_dump(
        &state,
        "rdb-conn",
        &mysql_path,
        "",
        "",
        &[dump_table("public", "users", vec!["id", "name"])],
        &dump_opts_dialect(ExportInclude::Dml, 2, DatabaseType::Mysql),
        None,
    )
    .await
    .unwrap();
    assert_eq!(mysql_summary.rows_written, 3);
    let mysql_body = std::fs::read_to_string(&mysql_path).unwrap();
    assert!(
        mysql_body.contains("INSERT INTO `public`.`users` (`id`, `name`) VALUES (1, 'alice');"),
        "mysql body: {mysql_body}"
    );
    assert!(mysql_body.contains("VALUES (NULL, 'carol');"));
    assert!(mysql_body.contains("Data: `public`.`users`"));
    // No ANSI double-quoted identifier must leak into the MySQL dump.
    assert!(
        !mysql_body.contains(r#""public"."users""#),
        "mysql body leaked ANSI identifier: {mysql_body}"
    );

    // [AC-1642-02] Same streamed rows, `dialect = mssql` → `[bracket]`
    // identifiers. RED before the fn-pointer dispatch grew an mssql arm; GREEN
    // after. The default-Postgresql run above stays the byte-identical PG guard.
    let mssql_path = dir.path().join("inserts_mssql.sql");
    let mssql_summary = super::run_schema_dump(
        &state,
        "rdb-conn",
        &mssql_path,
        "",
        "",
        &[dump_table("dbo", "users", vec!["id", "name"])],
        &dump_opts_dialect(ExportInclude::Dml, 2, DatabaseType::Mssql),
        None,
    )
    .await
    .unwrap();
    assert_eq!(mssql_summary.rows_written, 3);
    let mssql_body = std::fs::read_to_string(&mssql_path).unwrap();
    assert!(
        mssql_body.contains("INSERT INTO [dbo].[users] ([id], [name]) VALUES (1, N'alice');"),
        "mssql body: {mssql_body}"
    );
    assert!(mssql_body.contains("VALUES (NULL, N'carol');"));
    assert!(mssql_body.contains("Data: [dbo].[users]"));
    // Neither ANSI double quotes nor MySQL backticks may leak into the T-SQL dump.
    assert!(
        !mssql_body.contains(r#""dbo"."users""#) && !mssql_body.contains("`dbo`.`users`"),
        "mssql body leaked non-bracket identifier: {mssql_body}"
    );
}

// ── _inner dispatchers (Sprint 237 P5, 2026-05-08) ─────────────────
// 작성 이유: export_grid_rows / export_schema_dump / write_text_file_export
// 이 `tauri::State<'_, AppState>` 받는 wrapper 라 0% 였던 본체를 _inner
// 로 추출. cancel-token register/release contract + spawn_blocking
// happy path 만 격리해 테스트.

#[tokio::test]
async fn export_grid_rows_inner_csv_round_trip_releases_token() {
    let state = AppState::new();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("grid.csv");
    let summary = super::export_grid_rows_inner(
        &state,
        ExportFormat::Csv,
        path.clone(),
        vec!["id".into(), "name".into()],
        vec![vec![json!(1), json!("alice")]],
        table_ctx(),
        Some("export-csv"),
    )
    .await
    .unwrap();
    assert_eq!(summary.rows_written, 1);
    assert!(path.exists());
    // token must be cleaned up regardless of success/failure
    assert!(!state.query_tokens.lock().await.contains_key("export-csv"));
}

#[tokio::test]
async fn export_grid_rows_inner_json_with_table_ctx_writes_tabular_array() {
    // Issue #1638 — JSON + Table ctx used to be rejected (collection-only);
    // it now writes the tabular array-of-objects shape end-to-end through
    // the command _inner (register token → spawn_blocking → release).
    let state = AppState::new();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("grid.json");
    let summary = super::export_grid_rows_inner(
        &state,
        ExportFormat::Json,
        path.clone(),
        vec!["id".into(), "name".into()],
        vec![vec![json!(1), json!("alice")]],
        table_ctx(),
        Some("export-json-table"),
    )
    .await
    .unwrap();
    assert_eq!(summary.rows_written, 1);
    let body = read_to_string(&path);
    assert_eq!(
        body,
        "[\n  {\n    \"id\": 1,\n    \"name\": \"alice\"\n  }\n]\n"
    );
    // token released regardless of success (register/release contract).
    assert!(!state
        .query_tokens
        .lock()
        .await
        .contains_key("export-json-table"));
}

#[tokio::test]
async fn export_grid_rows_inner_no_export_id_skips_token_registration() {
    // export_id 가 None 이면 query_tokens 에 어떤 항목도 등록되지
    // 않아야 한다. 다른 export 가 동시에 돌고 있을 때 충돌 회피.
    let state = AppState::new();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("noid.csv");
    super::export_grid_rows_inner(
        &state,
        ExportFormat::Csv,
        path,
        vec!["id".into()],
        vec![vec![json!(1)]],
        table_ctx(),
        None,
    )
    .await
    .unwrap();
    assert!(state.query_tokens.lock().await.is_empty());
}

#[tokio::test]
async fn export_schema_dump_inner_releases_token_on_round_trip() {
    let state = AppState::new();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("dump.sql");
    let opts = dump_opts(ExportInclude::Ddl, 100);
    super::export_schema_dump_inner(
        &state,
        "no-such-conn",
        path,
        "-- header",
        "",
        &[],
        &opts,
        Some("dump-1"),
    )
    .await
    .unwrap();
    assert!(!state.query_tokens.lock().await.contains_key("dump-1"));
}

#[tokio::test]
async fn export_schema_dump_inner_validation_err_cleans_partial_file_and_releases_token() {
    let state = AppState::new();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("zero.sql");
    // batch_size = 0 → Validation 에러
    let opts = dump_opts(ExportInclude::Both, 0);
    let res = super::export_schema_dump_inner(
        &state,
        "conn",
        path.clone(),
        "",
        "",
        &[dump_table("public", "t", vec!["id"])],
        &opts,
        Some("dump-zero"),
    )
    .await;
    assert!(matches!(res, Err(AppError::Validation(_))));
    // wrapper 의 partial-file cleanup 확인 — file::create 전에 reject 되므로
    // 파일이 생성되지 않았다.
    assert!(!path.exists());
    // 토큰은 등록 후 삭제됐어야 — release 분기 커버.
    assert!(!state.query_tokens.lock().await.contains_key("dump-zero"));
}

#[tokio::test]
async fn write_text_file_export_inner_writes_content_and_returns_byte_count() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("txt.sql");
    let content = "-- migration\nCREATE TABLE t();\n".to_string();
    let summary = super::write_text_file_export_inner(path.clone(), content.clone())
        .await
        .unwrap();
    assert_eq!(summary.rows_written, 0);
    assert_eq!(summary.bytes_written as usize, content.len());
    let body = std::fs::read_to_string(&path).unwrap();
    assert_eq!(body, content);
}

#[tokio::test]
async fn write_text_file_export_inner_invalid_path_cleans_up_and_propagates_io_err() {
    // 디렉토리가 없는 경로 → write_text_file 가 Io 에러. wrapper 의
    // best-effort cleanup branch 가 호출되지만 파일은 애초에 생성되지
    // 않았으므로 remove_file 가 silently 실패. 결과는 그대로 반환.
    let res =
        super::write_text_file_export_inner("/nonexistent/dir/out.sql".into(), "x".into()).await;
    assert!(res.is_err());
}

// ── Issue #1094 regression: atomic write + path guard ────────────────
//
// 작성 이유 (2026-07-03): export 가 `File::create(target)` 로 기존 파일을
// 즉시 truncate 하고 실패/취소 시 그 경로를 remove_file → 원본 파괴. 아울러
// 렌더러 지정 target_path 에 경로 검증이 없어 XSS 시 내부 state DB overwrite
// 가능. temp+rename atomic write + is_absolute/reject_internal_app_data_path
// 가드로 fix. 아래 3 test 는 fix 전 RED.

use serial_test::serial;

// [#1094] 기존 파일 위로 export 하다 취소되면 원본이 truncate 되지 않고
// 그대로 남아야 한다 (atomic 교체). temp 잔여물도 남지 않는다.
#[test]
fn write_export_cancel_preserves_existing_file() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("report.csv");
    std::fs::write(&path, b"ORIGINAL IMPORTANT DATA").unwrap();

    let token = CancellationToken::new();
    token.cancel();
    let err = write_export(
        ExportFormat::Csv,
        &path,
        &["i".into()],
        &[vec![json!(1)]],
        &table_ctx(),
        Some(&token),
    )
    .unwrap_err();
    assert!(err.to_string().contains("cancelled"), "err: {err}");

    // 원본 무손상.
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        "ORIGINAL IMPORTANT DATA"
    );
    // temp 잔여물 없음 — dir 에는 report.csv 하나만.
    let leftovers: Vec<String> = std::fs::read_dir(dir.path())
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n != "report.csv")
        .collect();
    assert!(leftovers.is_empty(), "temp leftovers: {leftovers:?}");
}

// [#1094] target_path 가 상대경로 / 내부 app state DB 면 Validation 거부.
#[test]
#[serial]
fn write_export_rejects_relative_and_internal_state_paths() {
    let dir = TempDir::new().unwrap();
    std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());

    // 상대경로 거부.
    let rel = std::path::Path::new("relative.csv");
    let err = write_export(
        ExportFormat::Csv,
        rel,
        &["i".into()],
        &[vec![json!(1)]],
        &table_ctx(),
        None,
    )
    .unwrap_err();
    assert!(matches!(err, AppError::Validation(_)), "err: {err}");

    // 내부 state DB 경로 거부.
    let state_db = crate::storage::local::db_path().unwrap();
    let err = write_export(
        ExportFormat::Csv,
        &state_db,
        &["i".into()],
        &[vec![json!(1)]],
        &table_ctx(),
        None,
    )
    .unwrap_err();
    assert!(matches!(err, AppError::Validation(_)), "err: {err}");
    assert!(
        !state_db.exists(),
        "guard must reject before creating state.db"
    );

    std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
}

// [#1449] wave 27 보안 2차 P1-1. export target 가드가 `state.db` exact-match 만
// 막아 인접 credential 파일을 덮어쓸 수 있었다 (`.key` 교체 = 마스터키 탈취
// 동등, `connections.json` = 암호화 password blob). 가드를 app_data_dir 전체
// confine (`reject_internal_app_data_path`) 으로 넓혀 fix. fix 전 아래 reject
// assertion 은 RED — 네 경로 모두 export 가 통과했다.
#[test]
#[serial]
fn write_export_rejects_internal_app_data_paths() {
    let dir = TempDir::new().unwrap();
    std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());

    for name in [".key", "connections.json", "state.db.bak", "state.db-wal"] {
        let target = dir.path().join(name);
        let err = write_export(
            ExportFormat::Csv,
            &target,
            &["i".into()],
            &[vec![json!(1)]],
            &table_ctx(),
            None,
        )
        .unwrap_err();
        assert!(
            matches!(err, AppError::Validation(_)),
            "{name} must be rejected, got: {err:?}"
        );
        assert!(!target.exists(), "{name} must not be written");
    }

    // 정상 회귀: app_data_dir 밖의 target 은 계속 허용돼야 한다 (confine 은
    // 내부 디렉토리 차단이지 외부 차단이 아님).
    let outside = TempDir::new().unwrap();
    let ok_target = outside.path().join("report.csv");
    write_export(
        ExportFormat::Csv,
        &ok_target,
        &["i".into()],
        &[vec![json!(1)]],
        &table_ctx(),
        None,
    )
    .unwrap();
    assert!(ok_target.exists(), "external target must still be written");

    std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
}

// [#1094] schema dump 실패 시에도 기존 target 은 무손상 (async atomic path).
#[tokio::test]
async fn run_schema_dump_failure_preserves_existing_target() {
    let state = AppState::new();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("dump.sql");
    std::fs::write(&path, b"ORIGINAL DUMP").unwrap();

    // Dml + 존재하지 않는 connection → Database err (file create 이후 지점).
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
    assert!(res.is_err());

    // 원본 무손상 + temp 잔여물 없음.
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "ORIGINAL DUMP");
    let leftovers: Vec<String> = std::fs::read_dir(dir.path())
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n != "dump.sql")
        .collect();
    assert!(leftovers.is_empty(), "temp leftovers: {leftovers:?}");
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

// [AC-1641-01] dialect wires through `ExportSchemaDumpOptions`. A payload
// without the field defaults to Postgresql (old frontend / byte-identical PG
// guard); `"mysql"`/`"mariadb"` deserialize to the MySQL-family variants that
// steer the backtick INSERT writer.
// 2026-07-17.
#[test]
fn test_export_schema_dump_options_dialect_default_and_parse() {
    let without: ExportSchemaDumpOptions =
        serde_json::from_str(r#"{"include":"dml","batchSize":10}"#).unwrap();
    assert!(matches!(without.dialect, DatabaseType::Postgresql));

    let mysql: ExportSchemaDumpOptions =
        serde_json::from_str(r#"{"include":"both","batchSize":50,"dialect":"mysql"}"#).unwrap();
    assert!(matches!(mysql.dialect, DatabaseType::Mysql));

    let maria: ExportSchemaDumpOptions =
        serde_json::from_str(r#"{"include":"both","batchSize":50,"dialect":"mariadb"}"#).unwrap();
    assert!(matches!(maria.dialect, DatabaseType::Mariadb));

    // #1642 — `"mssql"` steers the T-SQL `[bracket]` INSERT writer.
    let mssql: ExportSchemaDumpOptions =
        serde_json::from_str(r#"{"include":"dml","batchSize":50,"dialect":"mssql"}"#).unwrap();
    assert!(matches!(mssql.dialect, DatabaseType::Mssql));
}
