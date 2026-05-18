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
    use sql_parser_core::{
        Columns, CompareOp, InsertValue, ParseErrorKind, SelectExpr, SqlLiteral,
    };

    #[test]
    fn select_round_trips_via_command() {
        // Sprint-393a — `SelectStatement` no longer has a top-level
        // `table` field; the FROM list is the source of truth. Single-
        // table sprint-385-style inputs produce a one-item FROM list
        // with the table identifier.
        let r = parse_sql_backend("SELECT * FROM users".to_string()).expect("ok");
        match r {
            ParseResult::Select(s) => {
                assert_eq!(s.columns, Columns::Star);
                assert_eq!(s.from.len(), 1);
                assert_eq!(s.from[0].table, "users");
                assert!(s.where_clause.is_none());
            }
            other => panic!("expected Select, got: {:?}", other),
        }
    }

    #[test]
    fn select_with_where_round_trips_via_command() {
        let r =
            parse_sql_backend("SELECT id FROM users WHERE name = 'felix'".to_string()).expect("ok");
        match r {
            ParseResult::Select(s) => {
                let w = s.where_clause.expect("where present");
                match w {
                    SelectExpr::Comparison { left, op, value } => {
                        assert_eq!(left.column, "name");
                        assert_eq!(op, CompareOp::Eq);
                        assert!(matches!(
                            value,
                            InsertValue::Literal {
                                value: SqlLiteral::String { value }
                            } if value == "felix"
                        ));
                    }
                    other => panic!("expected Comparison, got {:?}", other),
                }
            }
            other => panic!("expected Select, got: {:?}", other),
        }
    }

    #[test]
    fn ac_393a_select_with_join_round_trips_via_command() {
        // Sprint-393a — `SELECT a FROM x JOIN y ON x.id = y.x_id` now
        // flows through the Tauri command unchanged. The FROM list has
        // two items; the second carries an `InnerJoin { On(...) }`.
        let r =
            parse_sql_backend("SELECT a FROM x JOIN y ON x.id = y.x_id".to_string()).expect("ok");
        match r {
            ParseResult::Select(s) => {
                assert_eq!(s.from.len(), 2);
                assert_eq!(s.from[1].table, "y");
            }
            other => panic!("expected Select, got: {:?}", other),
        }
    }

    #[test]
    fn invalid_sql_returns_error_variant_not_err() {
        // The Result<_, String> arm is reserved for future infra failure;
        // every parse failure goes through the `Ok(Error(...))` path so the
        // frontend can pattern-match on a single union shape. MERGE is
        // permanently out of scope (sprint-392 contract: "MERGE / REPLACE /
        // INSERT IGNORE / ON DUPLICATE KEY UPDATE" excluded).
        let r = parse_sql_backend("MERGE INTO x USING y ON x.id = y.id".to_string()).expect("ok");
        match r {
            ParseResult::Error(e) => {
                assert_eq!(e.error_kind, ParseErrorKind::UnsupportedStatement);
            }
            other => panic!("expected Error variant, got: {:?}", other),
        }
    }
}
