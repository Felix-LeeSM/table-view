//! MySQL/MariaDB-specific identifier/string/value quoting for schema-dump
//! DML (`export_schema_dump`, issue #1641 — #1077 Stage 1). Sibling of the
//! PG/ANSI `dump_writers.rs`, split out exactly as that file's header
//! predicted ("future MySQL/SQLite dump dialects will get sibling files").
//!
//! The PG path emits ANSI double-quoted identifiers and a `::jsonb` cast; a
//! default-`sql_mode` MySQL/MariaDB server rejects both. These helpers emit
//! backtick identifiers and backslash-aware MySQL string literals so a
//! DDL+DML dump restores into MySQL/MariaDB. Kept `pub(super)` — only the
//! parent dump dispatcher and its tests reach them.

use serde_json::Value as JsonValue;

use crate::models::ColumnCategory;

/// Backtick-quote a MySQL identifier, doubling any embedded backtick.
pub(super) fn quote_mysql_identifier(name: &str) -> String {
    let mut out = String::with_capacity(name.len() + 2);
    out.push('`');
    for ch in name.chars() {
        if ch == '`' {
            out.push('`');
        }
        out.push(ch);
    }
    out.push('`');
    out
}

/// `` `schema`.`table` `` — MySQL's "schema" is the database name, so the
/// frontend-supplied schema is the database identifier here.
pub(super) fn qualified_mysql_table(schema: &str, table: &str) -> String {
    format!(
        "{}.{}",
        quote_mysql_identifier(schema),
        quote_mysql_identifier(table)
    )
}

/// Single-quoted MySQL string literal. Under the default `sql_mode` backslash
/// is an escape character, so a literal backslash MUST be doubled (otherwise
/// the following byte is reinterpreted on restore) and the single quote
/// doubled. Newlines/tabs are legal inside a MySQL string literal and pass
/// through unescaped.
///
/// ponytail: escapes `\` and `'` only. `cell_to_json` never yields a NUL or
/// control byte through this path (BLOB → `0x` hex string, text columns have
/// no NUL), so `\0`/`\Z` escaping is intentionally omitted; add it if a
/// binary-in-text value ever reaches this writer.
pub(super) fn quote_mysql_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('\'');
    for ch in s.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '\'' => out.push_str("''"),
            _ => out.push(ch),
        }
    }
    out.push('\'');
    out
}

/// Serialize a `row_to_json`-style value to a MySQL INSERT literal. Mirrors
/// `pg_value_to_sql_literal` but (a) uses the backslash-aware string escape
/// and (b) emits a plain quoted JSON string for Array/Object — MySQL casts a
/// string literal into a JSON column implicitly, so the PG `::jsonb` suffix
/// (which MySQL cannot parse) is dropped.
pub(super) fn mysql_value_to_sql_literal(value: &JsonValue, category: ColumnCategory) -> String {
    // Issue #1677 — a Binary-category cell arrives as a `"0x<hex>"` string from
    // `cell_to_json`. Emit an unquoted MySQL binary literal `X'<hex>'` so a
    // varbinary/BLOB restore stores the raw bytes; the quoted `'0x…'` string arm
    // below would store the ASCII bytes of the hex text (silent corruption).
    // `X'…'` (not bare `0x…`) also expresses the empty blob as `X''`, which `0x`
    // alone cannot. Type-driven — a text column whose value merely starts with
    // `0x` keeps the quoted-string path.
    if category == ColumnCategory::Binary {
        if let JsonValue::String(s) = value {
            let hex = s
                .strip_prefix("0x")
                .or_else(|| s.strip_prefix("0X"))
                .unwrap_or(s);
            return format!("X'{hex}'");
        }
    }
    match value {
        JsonValue::Null => "NULL".to_string(),
        JsonValue::Bool(true) => "TRUE".to_string(),
        JsonValue::Bool(false) => "FALSE".to_string(),
        JsonValue::Number(n) => n.to_string(),
        JsonValue::String(s) => quote_mysql_string(s),
        JsonValue::Array(_) | JsonValue::Object(_) => {
            let serialized = serde_json::to_string(value).unwrap_or_else(|_| "null".into());
            quote_mysql_string(&serialized)
        }
    }
}
