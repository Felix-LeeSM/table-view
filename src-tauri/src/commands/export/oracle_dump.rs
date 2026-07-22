//! Oracle identifier/string/value quoting for schema-dump DML
//! (`export_schema_dump`, issue #1674 — #1077 Stage 1). Sibling of the PG/ANSI
//! `dump_writers.rs`, the MySQL `mysql_dump.rs`, and the SQL Server
//! `mssql_dump.rs`, exactly as those headers predicted ("future … dump dialects
//! will get sibling files").
//!
//! Oracle quotes identifiers with ANSI double quotes (doubling an embedded `"`),
//! like the PG writer, but its INSERT value dialect differs: Oracle has no
//! `TRUE`/`FALSE` literal (there is no BOOLEAN *column* type before 23c), so a
//! JSON bool serialises to the NUMBER literals `1`/`0`; and Oracle has no `0x`
//! or `X'…'` binary literal, so a binary cell becomes a `HEXTORAW('…')` call.
//! Like T-SQL — and unlike MySQL — Oracle is not backslash-aware, so only the
//! single quote is doubled inside a string literal. There is no `::jsonb` cast.
//! Kept `pub(super)` — only the parent dump dispatcher and its tests reach them.

use serde_json::Value as JsonValue;

use crate::models::ColumnCategory;

/// ANSI double-quote an Oracle identifier, doubling any embedded `"`.
pub(super) fn quote_oracle_identifier(name: &str) -> String {
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

/// `"schema"."table"` — Oracle's namespace is the schema (the owning user).
pub(super) fn qualified_oracle_table(schema: &str, table: &str) -> String {
    format!(
        "{}.{}",
        quote_oracle_identifier(schema),
        quote_oracle_identifier(table)
    )
}

/// Single-quoted Oracle string literal. Oracle, like T-SQL, is not
/// backslash-aware, so only the single quote is doubled; a literal backslash
/// passes through unchanged. Newlines/tabs are legal inside the literal and pass
/// through. The database charset is AL32UTF8, so non-ASCII rides a plain literal.
pub(super) fn quote_oracle_string(s: &str) -> String {
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

/// Serialize a `row_to_json`-style value to an Oracle INSERT literal. Mirrors
/// `pg_value_to_sql_literal` but (a) emits `1`/`0` for booleans (Oracle has no
/// `TRUE`/`FALSE` value literal), (b) wraps a binary cell in `HEXTORAW('…')`
/// (Oracle has no `0x`/`X'…'` literal), and (c) emits a plain quoted JSON string
/// for Array/Object — Oracle implicitly coerces a string literal into a JSON
/// column, so neither the PG `::jsonb` cast nor a MySQL-style cast applies.
pub(super) fn oracle_value_to_sql_literal(value: &JsonValue, category: ColumnCategory) -> String {
    // Issue #1674 — a Binary-category cell arrives as a `"0x<hex>"` string from
    // `cell_to_json`. Oracle has no `0x` or `X'…'` literal syntax, so emit a
    // `HEXTORAW('<hex>')` call whose result is the raw bytes; the quoted string
    // arm below would store the ASCII of the hex text (silent corruption).
    // Type-driven — a text column whose value merely starts with `0x` keeps the
    // quoted-string path.
    if category == ColumnCategory::Binary {
        if let JsonValue::String(s) = value {
            let hex = s
                .strip_prefix("0x")
                .or_else(|| s.strip_prefix("0X"))
                .unwrap_or(s);
            return format!("hextoraw('{hex}')");
        }
    }
    match value {
        JsonValue::Null => "NULL".to_string(),
        JsonValue::Bool(true) => "1".to_string(),
        JsonValue::Bool(false) => "0".to_string(),
        JsonValue::Number(n) => n.to_string(),
        JsonValue::String(s) => quote_oracle_string(s),
        JsonValue::Array(_) | JsonValue::Object(_) => {
            let serialized = serde_json::to_string(value).unwrap_or_else(|_| "null".into());
            quote_oracle_string(&serialized)
        }
    }
}
