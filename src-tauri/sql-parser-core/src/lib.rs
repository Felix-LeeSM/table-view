//! sql-parser-core — pure-Rust SQL parser foundation (sprint-385).
//!
//! This crate compiles to two targets from one source tree:
//!
//! 1. **Native rlib** for the Tauri backend (`src-tauri/src/commands/sql_parser.rs`
//!    consumes `parse(...) -> ParseResult` directly).
//! 2. **`wasm32-unknown-unknown` cdylib** built by `wasm-pack` and lazy-
//!    loaded from the frontend (`src/lib/sql/sqlAst.ts`).
//!
//! Sprint 385 only ships the **foundation** — the dual-target pipeline,
//! the AST, and a single-statement SELECT grammar slice. Grammar
//! widening (INSERT / UPDATE / DELETE / JOIN / AND-OR / …) is sprint-386+.
//!
//! No Tauri / tokio / io / regex deps — that is the load-bearing invariant
//! that lets the same code reach the browser via WASM.

#![deny(unsafe_code)]
// Sprint 385 — the native rlib path never needs to panic, but we keep
// `unwrap_or_default` etc. explicit. `unwrap` is forbidden on user-input
// paths but allowed in `#[cfg(test)]`. Clippy already enforces the
// distinction; the lint-level here just documents intent.

pub mod ast;
pub mod completion;
pub mod lexer;
pub mod parser;

pub use ast::{
    AlterAction, AlterTableStatement, CallStatement, CascadeBehavior, CaseWhen, ColumnRef, Columns,
    CommentStatement, CommentTarget, CommentText, CompareOp, CopyDirection, CopySource,
    CopyStatement, CopyTarget, CteDefinition, DeleteStatement, DropObjectType, DropStatement,
    ExplainInner, ExplainOption, ExplainStatement, FrameBound, FrameUnit, FromItem, FromSource,
    GrantObject, GrantStatement, InsertSource, InsertStatement, InsertValue, JoinDescriptor,
    JoinPredicate, LikeCase, LimitClause, NullsPlacement, OnConflict, OnDuplicateKeyUpdate,
    OnDuplicateKeyUpdateAssignment, OnDuplicateKeyUpdateValue, OrderDirection, OrderingItem,
    OverClause, ParseError, ParseErrorKind, ParseResult, PrivilegeTag, ProcedureRef,
    RevokeStatement, RoleRef, SelectExpr, SelectListItem, SelectStatement, SetOperationEntry,
    SetOperator, SetScope, SetStatement, SetValue, ShowStatement, ShowTarget, SqlLiteral,
    TruncateStatement, UpdateAssignment, UpdateStatement, WhereExpr, WindowArgument, WindowFrame,
    WithInner, WithStatement,
};
pub use completion::{
    complete_sql, complete_sql_compact, CompletionCursorOffsets, CompletionItem,
    CompletionReplaceRange, CompletionResultMetadata, SqlCompletionCatalogColumn,
    SqlCompletionCatalogFunction, SqlCompletionCatalogObject, SqlCompletionCatalogSnapshot,
    SqlCompletionCoreResult, SqlCompletionRequest, SqlCompletionVocabulary,
};
pub use parser::parse;

/// Public entry — convenience wrapper around `parser::parse` so callers
/// don't need to traverse the module hierarchy. Native callers (the
/// `parse_sql_backend` Tauri command) and the WASM wrapper below both
/// go through here.
pub fn parse_sql(sql: &str) -> ParseResult {
    parser::parse(sql)
}

/// WASM bridge. Gated behind the `wasm` feature so the native build
/// doesn't pull `wasm-bindgen` into its dep graph. `wasm-pack build`
/// passes `--features wasm` (the pnpm script does this).
///
/// The function name `parseSql` (camelCase) is what JS sees because
/// `wasm-bindgen` automatically rewrites the symbol; explicit
/// `js_name = parseSql` lock would also work. We let the default
/// rewrite stand for one less attribute.
#[cfg(feature = "wasm")]
mod wasm_bridge {
    use serde::Serialize;
    use wasm_bindgen::prelude::*;

    /// Lazily called by `src/lib/sql/sqlAst.ts`. Returns a `JsValue`
    /// representing the `ParseResult` tagged union. Errors are *not*
    /// JS exceptions — they are an `Error` variant of the union so
    /// callers can pattern-match without try/catch.
    #[wasm_bindgen]
    pub fn parse_sql(sql: &str) -> JsValue {
        let result = super::parse_sql(sql);
        // `json_compatible()` preserves the TS wire contract where
        // absent optional fields are explicit `null`, not `undefined`.
        let serializer = serde_wasm_bindgen::Serializer::json_compatible();
        result.serialize(&serializer).unwrap_or(JsValue::NULL)
    }

    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen]
    pub fn complete_sql(
        text: &str,
        cursor_utf16: usize,
        cursor_utf8: usize,
        dialect: &str,
        shell: &str,
        catalog_revision: &str,
        keywords: &str,
        vocabulary_functions: &str,
        objects: &str,
        columns: &str,
        catalog_functions: &str,
    ) -> JsValue {
        let result = super::complete_sql_compact(
            text,
            cursor_utf16,
            cursor_utf8,
            dialect,
            shell,
            catalog_revision,
            keywords,
            vocabulary_functions,
            objects,
            columns,
            catalog_functions,
        );
        serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smoke_select_round_trips() {
        let result = parse_sql("SELECT id FROM users WHERE name = 'felix'");
        let json = serde_json::to_string(&result).expect("serialize");
        let back: ParseResult = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(result, back);
    }

    #[test]
    fn smoke_select_star_serialization_shape() {
        let result = parse_sql("SELECT * FROM users");
        let json = serde_json::to_value(&result).expect("serialize");
        assert_eq!(json["kind"], "select");
        // Sprint-393a — `table` is no longer a top-level slot; the FROM
        // list is the source of truth. The first item's `table` field
        // holds what used to live on the SelectStatement root.
        assert_eq!(json["from"][0]["table"], "users");
        assert_eq!(json["from"][0]["schema"], serde_json::Value::Null);
        assert_eq!(json["from"][0]["alias"], serde_json::Value::Null);
        assert_eq!(json["from"][0]["join"]["kind"], "comma");
        assert_eq!(json["columns"]["kind"], "star");
    }

    #[test]
    fn smoke_error_serialization_shape() {
        // Sprint-394 — CREATE/INSERT/UPDATE/DELETE/ALTER/WITH are now
        // supported. Sprint-395 — GRANT/REVOKE/EXPLAIN/SHOW/SET/COPY/COMMENT
        // are now supported. Pick a verb still in `is_known_sql_verb` but
        // not in `is_supported_sql_verb` (MERGE).
        let result = parse_sql("MERGE INTO users USING source ON foo = bar");
        let json = serde_json::to_value(&result).expect("serialize");
        assert_eq!(json["kind"], "error");
        assert_eq!(json["error_kind"], "unsupported-statement");
    }

    // -----------------------------------------------------------------
    // Sprint 391 — DDL destructive serialization (AC-391-S).
    // -----------------------------------------------------------------

    #[test]
    fn ac_391_s01_drop_variant_serializes_with_kind_drop() {
        let result = parse_sql("DROP TABLE IF EXISTS users CASCADE");
        let json = serde_json::to_value(&result).expect("serialize");
        assert_eq!(json["kind"], "drop");
        assert_eq!(json["object_type"], "table");
        assert_eq!(json["name"], "users");
        assert_eq!(json["if_exists"], true);
        assert_eq!(json["cascade"], "cascade");
    }

    #[test]
    fn ac_391_s02_truncate_variant_serializes_with_kind_truncate() {
        let result = parse_sql("TRUNCATE TABLE events RESTART IDENTITY CASCADE");
        let json = serde_json::to_value(&result).expect("serialize");
        assert_eq!(json["kind"], "truncate");
        assert_eq!(json["table"], "events");
        assert_eq!(json["restart_identity"], true);
        assert_eq!(json["cascade"], "cascade");
    }

    #[test]
    fn ac_391_s03_alter_table_drop_column_serializes_nested_action() {
        let result = parse_sql("ALTER TABLE users DROP COLUMN email CASCADE");
        let json = serde_json::to_value(&result).expect("serialize");
        assert_eq!(json["kind"], "alter-table");
        assert_eq!(json["table"], "users");
        assert_eq!(json["action"]["kind"], "drop-column");
        assert_eq!(json["action"]["column"], "email");
        assert_eq!(json["action"]["if_exists"], false);
        assert_eq!(json["action"]["cascade"], "cascade");
    }

    #[test]
    fn ac_391_s03b_alter_table_drop_constraint_serializes() {
        let result = parse_sql("ALTER TABLE orders DROP CONSTRAINT fk_user");
        let json = serde_json::to_value(&result).expect("serialize");
        assert_eq!(json["kind"], "alter-table");
        assert_eq!(json["action"]["kind"], "drop-constraint");
        assert_eq!(json["action"]["constraint"], "fk_user");
    }

    #[test]
    fn ac_391_s03c_alter_table_drop_index_serializes() {
        let result = parse_sql("ALTER TABLE users DROP INDEX idx_email");
        let json = serde_json::to_value(&result).expect("serialize");
        assert_eq!(json["kind"], "alter-table");
        assert_eq!(json["action"]["kind"], "drop-index");
        assert_eq!(json["action"]["index"], "idx_email");
    }

    #[test]
    fn ac_391_s04_drop_round_trips_through_serde_json() {
        let result = parse_sql("DROP SCHEMA public CASCADE");
        let json = serde_json::to_string(&result).expect("serialize");
        let back: ParseResult = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(result, back);
    }

    #[test]
    fn ac_391_s04_truncate_round_trips_through_serde_json() {
        let result = parse_sql("TRUNCATE users CONTINUE IDENTITY RESTRICT");
        let json = serde_json::to_string(&result).expect("serialize");
        let back: ParseResult = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(result, back);
    }

    #[test]
    fn ac_391_s04_alter_round_trips_through_serde_json() {
        let result = parse_sql("ALTER TABLE users DROP COLUMN IF EXISTS email CASCADE");
        let json = serde_json::to_string(&result).expect("serialize");
        let back: ParseResult = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(result, back);
    }

    #[test]
    fn ac_391_s_drop_no_options_serializes_with_nulls() {
        let result = parse_sql("DROP TABLE users");
        let json = serde_json::to_value(&result).expect("serialize");
        assert_eq!(json["if_exists"], false);
        // `Option::None` → serde_json `Null`.
        assert!(json["cascade"].is_null());
    }
}
