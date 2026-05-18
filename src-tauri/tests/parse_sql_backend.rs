//! Sprint 385 — backend SQL parser IPC integration test.
//!
//! The unit-level coverage lives next to the command
//! (`src/commands/sql_parser.rs`'s `#[cfg(test)] mod tests`). This
//! integration test pins the *crate-boundary* contract: a downstream
//! caller importing the symbol via the public `table_view_lib` re-export
//! receives the same `ParseResult` tagged union it would get from the
//! WASM facade, and round-trips through `serde_json` cleanly.

use table_view_lib::commands::sql_parser::parse_sql_backend;

#[test]
fn parse_sql_backend_round_trips_select_statement() {
    let result = parse_sql_backend("SELECT id FROM users WHERE name = 'felix'".to_string())
        .expect("Ok variant — Err arm is reserved for future infra failures");

    let json = serde_json::to_value(&result).expect("serialize");
    assert_eq!(json["kind"], "select");
    assert_eq!(json["table"], "users");
    assert_eq!(json["columns"]["kind"], "named");
    assert_eq!(json["columns"]["names"][0], "id");
    assert_eq!(json["where"]["column"], "name");
    assert_eq!(json["where"]["op"], "=");
    assert_eq!(json["where"]["literal"]["kind"], "string");
    assert_eq!(json["where"]["literal"]["value"], "felix");
}

#[test]
fn parse_sql_backend_returns_error_variant_for_unsupported_statement() {
    // Sprint-392 — DELETE/UPDATE/INSERT are now supported. Use CREATE
    // (sprint-394) for the unsupported-statement assertion.
    let result =
        parse_sql_backend("CREATE TABLE t (id int)".to_string()).expect("Ok variant always");
    let json = serde_json::to_value(&result).expect("serialize");
    assert_eq!(json["kind"], "error");
    assert_eq!(json["error_kind"], "unsupported-statement");
}

#[test]
fn parse_sql_backend_round_trips_delete_statement() {
    let result =
        parse_sql_backend("DELETE FROM users WHERE id = 1".to_string()).expect("Ok variant always");
    let json = serde_json::to_value(&result).expect("serialize");
    assert_eq!(json["kind"], "delete");
    assert_eq!(json["table"], "users");
    assert_eq!(json["where_clause"]["kind"], "comparison");
}
