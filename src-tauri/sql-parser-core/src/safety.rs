//! Issue #1112 — native Safe Mode severity classifier.
//!
//! Shared source-of-truth for destructive-statement classification. The
//! Tauri backend's Safe Mode gate (`src-tauri/src/commands/safe_mode.rs`)
//! calls [`classify`] / [`is_danger`] natively; the same crate compiles to
//! WASM for the frontend parser. Reusing `parse` here keeps the backend
//! danger set structurally aligned with the frontend classifier
//! (`src/lib/sql/sqlSafety.ts`) — both project the SAME `parse` AST.
//!
//! Scope: the Safe Mode decision matrix only gates the `Danger` tier
//! (`decideSafeModeAction` passes `Info` / `Warn` straight through). This
//! classifier therefore only needs to identify `Danger` precisely; `Info`
//! and `Warn` are collapsed best-effort — callers branch on [`is_danger`].
//!
//! Danger set (mirrors the frontend static danger set):
//!   - `DROP` (TABLE / DATABASE / SCHEMA / INDEX / VIEW / TRIGGER)
//!   - `TRUNCATE`
//!   - `ALTER TABLE … DROP COLUMN | DROP CONSTRAINT | DROP INDEX`
//!   - `DELETE` without a `WHERE` clause
//!   - `UPDATE` without a `WHERE` clause
//!   - `REPLACE …` (MySQL/MariaDB destructive upsert — issue #1115)
//!   - `RESTORE …` (SQL Server — may overwrite a database)
//!
//! Documented divergence from the frontend: the frontend's *dynamic*
//! WARN→danger escalation (dry-run showing 100+ affected rows) is a runtime
//! UX escalation, NOT part of `decideSafeModeAction`, and cannot be
//! reproduced from a static string — so a bounded `UPDATE … WHERE` /
//! `DELETE … WHERE` stays `Warn` (allow) here, exactly as the frontend's
//! *static* `analyzeStatement` classifies it.

use crate::ast::{AlterAction, DeleteStatement, ExplainInner, ParseResult, UpdateStatement, WithInner};
use crate::parser::parse;

/// Safe Mode severity tier. `Ord` so a multi-statement batch can take the
/// worst (max) tier — `Danger > Warn > Info`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Severity {
    Info,
    Warn,
    Danger,
}

/// Classify a SQL string for Safe Mode. A joined batch is split
/// (literal/comment-aware, mirroring the frontend `splitSqlStatements`)
/// and the worst tier wins, so a trailing `DROP` can never hide behind a
/// leading `SELECT` (issue #1118 defense, backend side).
pub fn classify(sql: &str) -> Severity {
    split_statements(sql)
        .iter()
        .map(|stmt| classify_single(stmt))
        .max()
        .unwrap_or(Severity::Info)
}

/// Convenience — the only distinction the Safe Mode gate needs.
pub fn is_danger(sql: &str) -> bool {
    classify(sql) == Severity::Danger
}

fn classify_single(stmt: &str) -> Severity {
    match parse(stmt) {
        // `parse` covers DROP / TRUNCATE / ALTER / UPDATE / DELETE etc. in
        // grammar; the `error` variant (unsupported / syntax) falls through
        // to the keyword scan so REPLACE / RESTORE and dialect DROP variants
        // the AST rejects are still gated.
        ParseResult::Error(_) => classify_by_keyword(stmt),
        parsed => severity_from_ast(&parsed),
    }
}

fn severity_from_ast(ast: &ParseResult) -> Severity {
    match ast {
        ParseResult::Drop(_) | ParseResult::Truncate(_) => Severity::Danger,
        ParseResult::AlterTable(alter) => match alter.action {
            AlterAction::DropColumn { .. }
            | AlterAction::DropConstraint { .. }
            | AlterAction::DropIndex { .. } => Severity::Danger,
            _ => Severity::Warn,
        },
        ParseResult::Update(update) => update_severity(update),
        ParseResult::Delete(delete) => delete_severity(delete),
        ParseResult::With(with) => match with.inner_statement.as_ref() {
            WithInner::Update(update) => update_severity(update),
            WithInner::Delete(delete) => delete_severity(delete),
            WithInner::Select(_) | WithInner::Insert(_) => Severity::Info,
        },
        // EXPLAIN inherits the inner statement's tier (decision D1). This
        // matters for `EXPLAIN ANALYZE`, which actually executes the wrapped
        // statement — a bare `EXPLAIN` never mutates but the classifier must
        // not under-classify the ANALYZE form.
        ParseResult::Explain(explain) => match explain.inner_statement.as_ref() {
            ExplainInner::Update(update) => update_severity(update),
            ExplainInner::Delete(delete) => delete_severity(delete),
            ExplainInner::With(with) => match with.inner_statement.as_ref() {
                WithInner::Update(update) => update_severity(update),
                WithInner::Delete(delete) => delete_severity(delete),
                WithInner::Select(_) | WithInner::Insert(_) => Severity::Info,
            },
            ExplainInner::Select(_) | ExplainInner::Insert(_) | ExplainInner::Merge(_) => {
                Severity::Info
            }
        },
        ParseResult::Grant(_)
        | ParseResult::Revoke(_)
        | ParseResult::Copy(_)
        | ParseResult::Call(_)
        | ParseResult::Merge(_) => Severity::Warn,
        // Select / Insert / CreateTable / CreateIndex / CreateView / Show /
        // SetStmt / Comment → Info (read / additive construction / metadata).
        // `Error` never reaches here (handled by `classify_single`).
        _ => Severity::Info,
    }
}

fn update_severity(update: &UpdateStatement) -> Severity {
    if update.where_clause.is_none() {
        Severity::Danger
    } else {
        Severity::Warn
    }
}

fn delete_severity(delete: &DeleteStatement) -> Severity {
    if delete.where_clause.is_none() {
        Severity::Danger
    } else {
        Severity::Warn
    }
}

/// Keyword-level fallback for statements `parse` rejects as
/// `unsupported-statement` / `syntax-error`. Only the danger keywords the
/// frontend regex fallback recognises are checked; anything else is
/// `Info` (fail-open — unrecognised statements are not gated, issue #1112
/// decision 5).
fn classify_by_keyword(stmt: &str) -> Severity {
    let normalized = strip_comments_collapse(stmt);
    let upper = normalized.to_uppercase();
    let upper = upper.trim_start();

    // REPLACE … (MySQL/MariaDB destructive upsert, issue #1115). `REPLACE`
    // as the leading keyword only — `CREATE OR REPLACE …` and
    // `SELECT REPLACE(col, …)` do not start with it.
    if starts_with_keyword(upper, "REPLACE") {
        return Severity::Danger;
    }
    if starts_with_keyword(upper, "RESTORE") {
        return Severity::Danger;
    }
    if starts_with_keyword(upper, "TRUNCATE") {
        return Severity::Danger;
    }
    if starts_with_keyword(upper, "DROP") {
        // Mirror the frontend regex danger objects; other DROP objects
        // (FUNCTION / ROLE / …) are not in the frontend danger set, but a
        // bare `DROP` fallback is still destructive by intent, so gate any
        // leading DROP the AST could not parse.
        return Severity::Danger;
    }
    if starts_with_keyword(upper, "DELETE") && !has_where(upper) {
        return Severity::Danger;
    }
    if starts_with_keyword(upper, "UPDATE") && !has_where(upper) {
        return Severity::Danger;
    }
    if starts_with_keyword(upper, "ALTER") && upper.contains("ALTER TABLE") {
        // `ALTER TABLE … DROP COLUMN | DROP CONSTRAINT` — structure + data
        // loss. Bare `DROP INDEX` inside ALTER is also captured by the
        // `DROP` substring check below.
        if upper.contains("DROP COLUMN")
            || upper.contains("DROP CONSTRAINT")
            || upper.contains("DROP INDEX")
        {
            return Severity::Danger;
        }
    }
    Severity::Info
}

/// True when `keyword` is the leading token of `upper` (already
/// upper-cased + left-trimmed). Guards against `REPLACED` / `DROPLET`
/// style false positives by requiring a word boundary after the keyword.
fn starts_with_keyword(upper: &str, keyword: &str) -> bool {
    if let Some(rest) = upper.strip_prefix(keyword) {
        rest.is_empty()
            || rest
                .chars()
                .next()
                .map(|c| !c.is_alphanumeric() && c != '_')
                .unwrap_or(true)
    } else {
        false
    }
}

/// Word-boundary `WHERE` presence (mirrors the frontend `\bWHERE\b`).
fn has_where(upper: &str) -> bool {
    let bytes = upper.as_bytes();
    let needle = b"WHERE";
    let mut i = 0;
    while i + needle.len() <= bytes.len() {
        if &bytes[i..i + needle.len()] == needle {
            let before_ok = i == 0 || !is_word_byte(bytes[i - 1]);
            let after_idx = i + needle.len();
            let after_ok = after_idx >= bytes.len() || !is_word_byte(bytes[after_idx]);
            if before_ok && after_ok {
                return true;
            }
        }
        i += 1;
    }
    false
}

fn is_word_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

/// Collapse comments to spaces so keyword detection ignores commented-out
/// tokens (mirrors the frontend `stripComments`).
fn strip_comments_collapse(sql: &str) -> String {
    let bytes = sql.as_bytes();
    let mut out = String::with_capacity(sql.len());
    let mut i = 0;
    while i < bytes.len() {
        // Line comment.
        if bytes[i] == b'-' && i + 1 < bytes.len() && bytes[i + 1] == b'-' {
            i += 2;
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
            out.push(' ');
            continue;
        }
        // Block comment.
        if bytes[i] == b'/' && i + 1 < bytes.len() && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            i += 2;
            out.push(' ');
            continue;
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

/// Literal/comment-aware statement splitter — a byte-faithful port of the
/// frontend `splitSqlStatements` (`src/lib/sql/sqlUtils.ts`). Only the
/// semicolon-boundary behavior matters for classification (each fragment is
/// classified independently and the worst tier wins).
fn split_statements(sql: &str) -> Vec<String> {
    let s: Vec<char> = sql.chars().collect();
    let len = s.len();
    let mut statements: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut i = 0;
    while i < len {
        let ch = s[i];
        // Single-quoted string literal (`''` escapes).
        if ch == '\'' {
            current.push(ch);
            i += 1;
            while i < len {
                let inner = s[i];
                current.push(inner);
                if inner == '\'' {
                    if i + 1 < len && s[i + 1] == '\'' {
                        i += 1;
                        current.push(s[i]);
                        i += 1;
                    } else {
                        i += 1;
                        break;
                    }
                } else {
                    i += 1;
                }
            }
            continue;
        }
        // Double-quoted identifier.
        if ch == '"' {
            current.push(ch);
            i += 1;
            while i < len {
                let inner = s[i];
                current.push(inner);
                if inner == '"' {
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }
        // Backtick identifier (`` escapes).
        if ch == '`' {
            current.push(ch);
            i += 1;
            while i < len {
                let inner = s[i];
                current.push(inner);
                if inner == '`' {
                    if i + 1 < len && s[i + 1] == '`' {
                        i += 1;
                        current.push(s[i]);
                        i += 1;
                    } else {
                        i += 1;
                        break;
                    }
                } else {
                    i += 1;
                }
            }
            continue;
        }
        // Bracket identifier (`]]` escapes).
        if ch == '[' {
            current.push(ch);
            i += 1;
            while i < len {
                let inner = s[i];
                current.push(inner);
                if inner == ']' {
                    if i + 1 < len && s[i + 1] == ']' {
                        i += 1;
                        current.push(s[i]);
                        i += 1;
                    } else {
                        i += 1;
                        break;
                    }
                } else {
                    i += 1;
                }
            }
            continue;
        }
        // Line comment.
        if ch == '-' && i + 1 < len && s[i + 1] == '-' {
            current.push(ch);
            i += 1;
            current.push(s[i]);
            i += 1;
            while i < len && s[i] != '\n' {
                current.push(s[i]);
                i += 1;
            }
            continue;
        }
        // Block comment.
        if ch == '/' && i + 1 < len && s[i + 1] == '*' {
            current.push(ch);
            i += 1;
            current.push(s[i]);
            i += 1;
            while i < len {
                let inner = s[i];
                current.push(inner);
                if inner == '*' && i + 1 < len && s[i + 1] == '/' {
                    i += 1;
                    current.push(s[i]);
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }
        // Semicolon — statement separator.
        if ch == ';' {
            let trimmed = current.trim();
            if !trimmed.is_empty() {
                statements.push(trimmed.to_string());
            }
            current.clear();
            i += 1;
            continue;
        }
        current.push(ch);
        i += 1;
    }
    let trimmed = current.trim();
    if !trimmed.is_empty() {
        statements.push(trimmed.to_string());
    }
    statements
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn danger_via_ast_drop_truncate() {
        assert_eq!(classify("DROP TABLE users"), Severity::Danger);
        assert_eq!(classify("DROP TABLE IF EXISTS users CASCADE"), Severity::Danger);
        assert_eq!(classify("TRUNCATE TABLE events"), Severity::Danger);
        assert!(is_danger("DROP SCHEMA public CASCADE"));
    }

    #[test]
    fn danger_via_ast_alter_drop_variants() {
        assert_eq!(
            classify("ALTER TABLE users DROP COLUMN email"),
            Severity::Danger
        );
        assert_eq!(
            classify("ALTER TABLE orders DROP CONSTRAINT fk_user"),
            Severity::Danger
        );
        assert_eq!(
            classify("ALTER TABLE users DROP INDEX idx_email"),
            Severity::Danger
        );
    }

    #[test]
    fn warn_via_ast_alter_additive() {
        assert_eq!(
            classify("ALTER TABLE users ADD COLUMN age integer"),
            Severity::Warn
        );
        assert_eq!(
            classify("ALTER TABLE users RENAME TO people"),
            Severity::Warn
        );
    }

    #[test]
    fn update_delete_where_gates_only_when_unbounded() {
        assert_eq!(classify("DELETE FROM users"), Severity::Danger);
        assert_eq!(classify("UPDATE users SET active = false"), Severity::Danger);
        // Bounded write — WARN (allow at the decision layer, mirrors the
        // frontend static classification; dry-run escalation is UI-only).
        assert_eq!(
            classify("DELETE FROM users WHERE id = 1"),
            Severity::Warn
        );
        assert_eq!(
            classify("UPDATE users SET active = false WHERE id = 1"),
            Severity::Warn
        );
    }

    #[test]
    fn reads_and_additive_are_not_danger() {
        assert_eq!(classify("SELECT * FROM users"), Severity::Info);
        assert_eq!(classify("INSERT INTO users VALUES (1)"), Severity::Info);
        assert_eq!(
            classify("CREATE TABLE t (id int)"),
            Severity::Info
        );
        assert!(!is_danger("SELECT 1"));
    }

    #[test]
    fn replace_and_restore_via_keyword_fallback() {
        // `parse` returns unsupported-statement for REPLACE — the keyword
        // fallback is the sole classifier (parity with frontend #1115).
        assert_eq!(classify("REPLACE INTO users VALUES (1)"), Severity::Danger);
        assert_eq!(
            classify("REPLACE INTO users SET id = 1"),
            Severity::Danger
        );
        assert_eq!(
            classify("RESTORE DATABASE shop FROM DISK = 'x.bak'"),
            Severity::Danger
        );
    }

    #[test]
    fn create_or_replace_is_not_danger() {
        // Leading keyword is CREATE, not REPLACE — must not false-positive.
        assert!(!is_danger("CREATE OR REPLACE VIEW v AS SELECT 1"));
    }

    #[test]
    fn multi_statement_takes_worst_tier() {
        // A trailing DROP must not hide behind a leading SELECT.
        assert_eq!(
            classify("SELECT 1; DROP TABLE users"),
            Severity::Danger
        );
        // Semicolon inside a string literal is not a separator.
        assert_eq!(
            classify("SELECT ';DROP TABLE users' AS note"),
            Severity::Info
        );
        // Semicolon inside a line comment is not a separator.
        assert_eq!(
            classify("SELECT 1 -- ; DROP TABLE users\n"),
            Severity::Info
        );
    }

    #[test]
    fn commented_out_danger_keyword_is_ignored() {
        assert_eq!(
            classify("/* DROP TABLE users */ SELECT 1"),
            Severity::Info
        );
    }

    #[test]
    fn explain_analyze_inherits_inner_danger() {
        assert_eq!(
            classify("EXPLAIN ANALYZE DELETE FROM users"),
            Severity::Danger
        );
        assert_eq!(
            classify("EXPLAIN DELETE FROM users WHERE id = 1"),
            Severity::Warn
        );
    }

    #[test]
    fn empty_and_whitespace_are_info() {
        assert_eq!(classify(""), Severity::Info);
        assert_eq!(classify("   \n  "), Severity::Info);
    }
}
