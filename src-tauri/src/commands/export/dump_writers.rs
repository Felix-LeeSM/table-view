//! PG-specific identifier/string/value quoting helpers used by the
//! schema-dump (`export_schema_dump`) Tauri command. Hoisted out of
//! `commands/export/mod.rs` (Sprint 213, P5 step 2b).
//!
//! These mirror the generic `quote_sql_*` helpers in `grid_writers.rs`
//! but live in their own module because the dump output is PG-only —
//! future MySQL/SQLite dump dialects will get sibling files
//! (`mysql_dump.rs`, etc.) without colliding here. Kept private to the
//! parent module via `pub(super)`.

use serde_json::Value as JsonValue;

use crate::models::ColumnCategory;

pub(super) fn quote_pg_identifier(name: &str) -> String {
    let mut out = String::with_capacity(name.len() + 2);
    out.push('"');
    for ch in name.chars() {
        if ch == '"' {
            out.push('"');
        }
        out.push(ch);
    }
    out.push('"');
    out
}

pub(super) fn qualified_pg_table(schema: &str, table: &str) -> String {
    format!(
        "{}.{}",
        quote_pg_identifier(schema),
        quote_pg_identifier(table)
    )
}

pub(super) fn quote_pg_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('\'');
    for ch in s.chars() {
        if ch == '\'' {
            out.push('\'');
        }
        out.push(ch);
    }
    out.push('\'');
    out
}

/// PG row_to_json 결과를 INSERT VALUES literal 로 직렬화. row_to_json 이
/// 모든 native PG 타입을 JSON 으로 표현해 주므로 (`bytea` → `"\\xDEAD"`
/// hex string, `timestamp` → ISO 8601 string, `uuid` → hex string,
/// `array` → JSON array, `jsonb` → JSON), 본 함수는 Json 5 가지 variant
/// 만 분기:
///   - Null     → `NULL`
///   - Bool     → `TRUE`/`FALSE`
///   - Number   → `42` / `2.5` (서식 그대로)
///   - String   → `'…'` (single-quote 이스케이프)
///   - Array/Object → `'…'::jsonb` (PG 의 jsonb implicit cast)
///
/// bytea/timestamp/uuid 는 String variant 로 들어와 일반 string 처리됨.
/// restore 시 column type 에 따라 PG 가 implicit cast — text/varchar 는
/// 그대로 들어가고, bytea 는 `\x...` 형식이 cast 되며, timestamp 은 ISO
/// 8601 string 이 cast 된다.
///
/// Issue #1677 — `_category` is accepted for signature parity with the MySQL /
/// MSSQL sibling writers (the dump dispatch stores one `fn` pointer type). PG
/// needs no binary branch: `cell_to_json` renders bytea as a quoted `'\x…'`
/// string that PG's bytea input parser casts back to the exact bytes on
/// restore, so the round-trip is already byte-faithful.
pub(super) fn pg_value_to_sql_literal(value: &JsonValue, _category: ColumnCategory) -> String {
    match value {
        JsonValue::Null => "NULL".to_string(),
        JsonValue::Bool(true) => "TRUE".to_string(),
        JsonValue::Bool(false) => "FALSE".to_string(),
        JsonValue::Number(n) => n.to_string(),
        JsonValue::String(s) => quote_pg_string(s),
        JsonValue::Array(_) | JsonValue::Object(_) => {
            let serialized = serde_json::to_string(value).unwrap_or_else(|_| "null".into());
            format!("{}::jsonb", quote_pg_string(&serialized))
        }
    }
}
