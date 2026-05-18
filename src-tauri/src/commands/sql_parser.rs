//! Sprint 385 — backend SQL parser IPC.
//!
//! Wraps the `sql-parser-core` crate's `parse_sql` entry point in a Tauri
//! command so the frontend can also reach the same AST via the IPC
//! channel (useful when a feature wants to parse SQL on a long-running
//! background path where pulling the WASM module into the renderer would
//! be wasteful, or for parity checks during the future grammar widening
//! in sprint-386+).
//!
//! Contract:
//! - The command NEVER returns `Err`. Parse failures are surfaced as the
//!   `ParseResult::Error(ParseError)` variant of the returned union so
//!   the frontend's narrowing matches the WASM path one-for-one.
//! - The `Result<_, String>` signature exists only for Tauri's
//!   `#[tauri::command]` ergonomics; today the `Err(...)` arm is
//!   unreachable. Keeping the wrapper anyway lets a future grammar that
//!   needs to surface infrastructure failures (e.g. a per-dialect parser
//!   selector that fails to load a dialect module) add `Err` returns
//!   without changing the IPC signature.

use sql_parser_core::{parse_sql, ParseResult};

/// Parse one SQL statement (sprint-385 grammar slice — see
/// `sql-parser-core` crate docs) and return the AST as a tagged union.
#[tauri::command]
pub fn parse_sql_backend(sql: String) -> Result<ParseResult, String> {
    Ok(parse_sql(&sql))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sql_parser_core::{Columns, Literal, ParseErrorKind, SelectStatement, WhereClause};

    #[test]
    fn select_round_trips_via_command() {
        let r = parse_sql_backend("SELECT * FROM users".to_string()).expect("ok");
        match r {
            ParseResult::Select(SelectStatement {
                columns,
                table,
                where_clause,
            }) => {
                assert_eq!(columns, Columns::Star);
                assert_eq!(table, "users");
                assert!(where_clause.is_none());
            }
            ParseResult::Error(e) => panic!("expected Select, got error: {:?}", e),
        }
    }

    #[test]
    fn select_with_where_round_trips_via_command() {
        let r =
            parse_sql_backend("SELECT id FROM users WHERE name = 'felix'".to_string()).expect("ok");
        match r {
            ParseResult::Select(s) => {
                let w = s.where_clause.expect("where present");
                assert_eq!(
                    w,
                    WhereClause {
                        column: "name".to_string(),
                        op: sql_parser_core::BinaryOp::Eq,
                        literal: Literal::String {
                            value: "felix".to_string()
                        },
                    }
                );
            }
            ParseResult::Error(e) => panic!("expected Select, got: {:?}", e),
        }
    }

    #[test]
    fn invalid_sql_returns_error_variant_not_err() {
        // The Result<_, String> arm is reserved for future infra failure;
        // today every parse failure (including INSERT, malformed syntax,
        // empty input) goes through the `Ok(Error(...))` path so the
        // frontend can pattern-match on a single union shape.
        let r = parse_sql_backend("INSERT INTO x VALUES (1)".to_string()).expect("ok");
        match r {
            ParseResult::Error(e) => {
                assert_eq!(e.error_kind, ParseErrorKind::UnsupportedStatement);
            }
            ParseResult::Select(_) => panic!("expected Error variant"),
        }
    }
}
