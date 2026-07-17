//! SQL Server (T-SQL) identifier/string/value quoting for schema-dump DML
//! (`export_schema_dump`, issue #1642 — #1077 Stage 1). Sibling of the PG/ANSI
//! `dump_writers.rs` and the MySQL `mysql_dump.rs`, exactly as those headers
//! predicted ("future … dump dialects will get sibling files").
//!
//! The PG path emits ANSI double-quoted identifiers and a `::jsonb` cast; MySQL
//! emits backticks. SQL Server quotes identifiers with `[brackets]` (doubling an
//! embedded `]`) and, unlike MySQL, treats a backslash as an ordinary character
//! — only the single quote is doubled inside a string literal. There is no
//! `BOOLEAN`/`TRUE`/`FALSE` in T-SQL, so a JSON bool serialises to the `BIT`
//! literals `1`/`0`. Kept `pub(super)` — only the parent dump dispatcher and its
//! tests reach them.

use serde_json::Value as JsonValue;

/// Bracket-quote a T-SQL identifier, doubling any embedded `]`.
pub(super) fn quote_mssql_identifier(name: &str) -> String {
    format!("[{}]", name.replace(']', "]]"))
}

/// `[schema].[table]` — SQL Server's namespace is the schema (typically `dbo`).
pub(super) fn qualified_mssql_table(schema: &str, table: &str) -> String {
    format!(
        "{}.{}",
        quote_mssql_identifier(schema),
        quote_mssql_identifier(table)
    )
}

/// Single-quoted T-SQL string literal. T-SQL is not backslash-aware, so only the
/// single quote is doubled; a literal backslash passes through unchanged.
/// Newlines/tabs are legal inside a T-SQL string literal and pass through.
pub(super) fn quote_mssql_string(s: &str) -> String {
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

/// Serialize a `row_to_json`-style value to a T-SQL INSERT literal. Mirrors
/// `pg_value_to_sql_literal` but (a) uses the bracket/backslash-neutral string
/// escape, (b) emits `1`/`0` for booleans because T-SQL has no `TRUE`/`FALSE`
/// literal, and (c) emits a plain quoted JSON string for Array/Object — SQL
/// Server stores JSON in `nvarchar`, so neither the PG `::jsonb` cast nor a
/// MySQL-style implicit JSON column cast applies.
pub(super) fn mssql_value_to_sql_literal(value: &JsonValue) -> String {
    match value {
        JsonValue::Null => "NULL".to_string(),
        JsonValue::Bool(true) => "1".to_string(),
        JsonValue::Bool(false) => "0".to_string(),
        JsonValue::Number(n) => n.to_string(),
        JsonValue::String(s) => quote_mssql_string(s),
        JsonValue::Array(_) | JsonValue::Object(_) => {
            let serialized = serde_json::to_string(value).unwrap_or_else(|_| "null".into());
            quote_mssql_string(&serialized)
        }
    }
}
