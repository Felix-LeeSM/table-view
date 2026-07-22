//! Oracle identifier/string/value quoting for schema-dump DML
//! (`export_schema_dump`, issue #1674 — #1077 Stage 1). Sibling of the PG/ANSI
//! `dump_writers.rs`, the MySQL `mysql_dump.rs`, and the SQL Server
//! `mssql_dump.rs`, exactly as those headers predicted ("future … dump dialects
//! will get sibling files").
//!
//! RED #1674 — stub bodies. GREEN implements the real Oracle dialect and
//! un-ignores the writer unit tests.

use serde_json::Value as JsonValue;

use crate::models::ColumnCategory;

pub(super) fn quote_oracle_identifier(_name: &str) -> String {
    String::new()
}

pub(super) fn qualified_oracle_table(_schema: &str, _table: &str) -> String {
    String::new()
}

pub(super) fn quote_oracle_string(_s: &str) -> String {
    String::new()
}

pub(super) fn oracle_value_to_sql_literal(value: &JsonValue, _category: ColumnCategory) -> String {
    // RED #1674 — stub routes strings through `quote_oracle_string` (also a
    // stub) so the module compiles; GREEN implements the full dialect.
    match value {
        JsonValue::String(s) => quote_oracle_string(s),
        _ => String::new(),
    }
}
