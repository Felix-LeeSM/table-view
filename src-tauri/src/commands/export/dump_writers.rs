//! PG-specific identifier/string/value quoting helpers used by the
//! schema-dump (`export_schema_dump`) Tauri command. Hoisted out of
//! `commands/export/mod.rs`.
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

/// Serialize a PG `row_to_json` result into an INSERT VALUES literal.
/// Since row_to_json expresses every native PG type as JSON (`bytea` →
/// `"\\xDEAD"`
/// hex string, `timestamp` → ISO 8601 string, `uuid` → hex string,
/// `array` → JSON array, `jsonb` → JSON), this fn branches on only these
/// Json variants:
///   - Null     → `NULL`
///   - Bool     → `TRUE`/`FALSE`
///   - Number   → `42` / `2.5` (verbatim formatting)
///   - String   → `'…'` (single-quote escaped)
///   - Array/Object → `'…'::jsonb` (PG's jsonb implicit cast)
///
/// bytea/timestamp/uuid arrive as the String variant and are handled as
/// ordinary strings. On restore PG implicitly casts them according to the
/// column type — text/varchar go in as-is, the `\x...` form is cast for
/// bytea, and an ISO 8601 string is cast for timestamp.
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
