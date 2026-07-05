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
//!   - data-modifying CTE — `WITH x AS (DELETE/UPDATE … no WHERE) SELECT …`
//!     in ANY CTE position (issue #1350; mirrors the frontend `analyzeDmlCte`;
//!     the parser rejects the CTE body so this rides the keyword fallback)
//!
//! `DROP FUNCTION` / `PROCEDURE` / `ROLE` / `EXTENSION` / `MATERIALIZED VIEW`
//! are intentionally NOT danger — the frontend classifies them as
//! `ddl-other` (warn, no confirm dialog), so gating them would permanently
//! reject legitimate DDL.
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

    // Data-modifying CTE (mirror frontend `analyzeDmlCte`). The parser rejects
    // a WITH whose CTE body is UPDATE/DELETE/INSERT (CTE bodies are SELECT-only
    // in-grammar), so a `WITH x AS (DELETE FROM t) SELECT …` reaches this
    // fallback. The wrapped statement's tier decides — a WHERE-less DELETE /
    // UPDATE inside a CTE is danger even though the outer form is a SELECT.
    if starts_with_keyword(upper, "WITH") {
        if let Some(severity) = classify_dml_cte(upper) {
            return severity;
        }
    }
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
        return drop_keyword_severity(upper);
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

/// Severity of a leading `DROP` the AST could not parse. Mirrors the frontend
/// split: `DROP TABLE|DATABASE|SCHEMA|INDEX|VIEW|TRIGGER` is danger
/// (`sqlSafety.ts:656`); every other object (`FUNCTION` / `PROCEDURE` / `ROLE`
/// / `EXTENSION` / `MATERIALIZED VIEW` / …) is `ddl-other` warn
/// (`sqlSafety.ts:759`), which the Safe Mode matrix never gates — hard-gating
/// them would permanently reject legitimate DDL (issue #1112 review B2).
fn drop_keyword_severity(upper: &str) -> Severity {
    let after = upper.strip_prefix("DROP").unwrap_or(upper).trim_start();
    match first_word(after).as_str() {
        "TABLE" | "DATABASE" | "SCHEMA" | "INDEX" | "VIEW" | "TRIGGER" => Severity::Danger,
        _ => Severity::Warn,
    }
}

/// Classify a `WITH …` statement by scanning EVERY CTE body — a native port of
/// the frontend `analyzeDmlCte` (`sqlSafety.ts`). Issue #1350: the first-CTE-
/// only scan let a destructive body in the 2nd+ CTE (`WITH a AS (SELECT 1), b
/// AS (DELETE FROM t) SELECT …`) read as a benign SELECT. Each `AS ( … )` body
/// is re-classified with the full `classify_single` (mirroring the frontend's
/// recursive `analyzeStatement`) and the worst tier wins. Returns `None` when
/// no `AS (` body is present (the caller then treats the WITH as a read).
/// After each body the scan resumes past its closing paren, so nested `AS (`
/// subqueries and `'DELETE …'` string literals never register as body openers.
fn classify_dml_cte(upper: &str) -> Option<Severity> {
    let mut worst: Option<Severity> = None;
    let mut from = 0;
    while let Some(open) = find_cte_body_open_paren(upper, from) {
        let body = match balanced_paren_slice(upper, open) {
            Some(b) => b,
            None => break,
        };
        // Strip the enclosing parens; `body` is `(…)`, both ASCII.
        let inner = body[1..body.len() - 1].trim();
        let sev = classify_single(inner);
        worst = Some(worst.map_or(sev, |w| w.max(sev)));
        from = open + body.len();
    }
    worst
}

/// Byte index of the `(` that opens the next `AS ( … )` CTE body at or after
/// `from`. Mirrors the frontend regex `\bAS\s*\(` anchor — the CTE's optional
/// column list `(a, b)` sits before `AS`, so `AS (` is the body opener.
fn find_cte_body_open_paren(upper: &str, from: usize) -> Option<usize> {
    let bytes = upper.as_bytes();
    let mut i = from;
    while i + 2 <= bytes.len() {
        let is_as_word = &bytes[i..i + 2] == b"AS"
            && (i == 0 || !is_word_byte(bytes[i - 1]))
            && (i + 2 >= bytes.len() || !is_word_byte(bytes[i + 2]));
        if is_as_word {
            let mut j = i + 2;
            while j < bytes.len() && bytes[j].is_ascii_whitespace() {
                j += 1;
            }
            if bytes.get(j) == Some(&b'(') {
                return Some(j);
            }
        }
        i += 1;
    }
    None
}

/// Slice from the `(` at `open` through its matching `)` (inclusive). Simple
/// depth counter, mirroring the frontend `extractBalanced`. `(` / `)` are
/// ASCII and UTF-8 self-synchronising, so byte indexing stays on boundaries.
fn balanced_paren_slice(upper: &str, open: usize) -> Option<String> {
    let bytes = upper.as_bytes();
    if bytes.get(open) != Some(&b'(') {
        return None;
    }
    let mut depth = 0i32;
    let mut i = open;
    while i < bytes.len() {
        match bytes[i] {
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(upper[open..=i].to_string());
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

/// Leading identifier word (`[A-Za-z0-9_]+`) of a trimmed string, upper-cased
/// input assumed. Empty when the string does not start with a word char.
fn first_word(s: &str) -> String {
    s.chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
        .collect()
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

    // ----------------------------------------------------------------------
    // Parity mirror — these cases are ported verbatim from the frontend
    // classifier test suite (`src/lib/sql/sqlSafety.test.ts`). They lock the
    // backend danger set to the frontend so a change on one side that drifts
    // the other trips a test. If the frontend cases move, mirror them here.
    // ----------------------------------------------------------------------

    #[test]
    fn data_modifying_cte_parity() {
        // Mirror sqlSafety.test.ts AC-254-04a..e / AC-403-01b. A WITH whose
        // first CTE body modifies data inherits that statement's tier — the
        // parser rejects the CTE (SELECT-only bodies), so this rides the
        // keyword fallback. WHERE-less DELETE/UPDATE inside a CTE is danger.
        // AC-254-04a — UPDATE WHERE → warn (bounded).
        assert_eq!(
            classify(
                "WITH x AS (UPDATE users SET active = false WHERE id = 1 RETURNING id) SELECT * FROM x"
            ),
            Severity::Warn
        );
        // AC-254-04b — DELETE WHERE → warn (bounded).
        assert_eq!(
            classify("WITH x AS (DELETE FROM users WHERE id = 1 RETURNING id) SELECT * FROM x"),
            Severity::Warn
        );
        // AC-254-04c — DELETE without WHERE → danger (B1 security hole).
        assert_eq!(
            classify("WITH x AS (DELETE FROM users RETURNING id) SELECT * FROM x"),
            Severity::Danger
        );
        // UPDATE without WHERE inside a CTE → danger.
        assert!(is_danger(
            "WITH x AS (UPDATE users SET active = false RETURNING id) SELECT * FROM x"
        ));
        // AC-403-01b — INSERT CTE → info.
        assert_eq!(
            classify("WITH x AS (INSERT INTO users (id) VALUES (1) RETURNING id) SELECT * FROM x"),
            Severity::Info
        );
        // AC-254-04e — pure read CTE → info (regression).
        assert_eq!(
            classify("WITH x AS (SELECT 1 AS n) SELECT n FROM x"),
            Severity::Info
        );
        // RECURSIVE + column-list forms still detect the modifying body.
        assert!(is_danger(
            "WITH RECURSIVE x (id) AS (DELETE FROM users RETURNING id) SELECT * FROM x"
        ));
    }

    #[test]
    fn multi_cte_parity() {
        // Mirror sqlSafety.test.ts AC-1350-01..08. Issue #1350: a destructive
        // body in the 2nd+ CTE must not hide behind a leading read CTE. The
        // classifier scans every `AS ( … )` body and merges the worst tier.
        // AC-1350-01 — 2nd CTE DELETE without WHERE → danger.
        assert_eq!(
            classify("WITH a AS (SELECT 1), b AS (DELETE FROM users) SELECT * FROM b"),
            Severity::Danger
        );
        // AC-1350-02 — 2nd CTE UPDATE without WHERE → danger.
        assert_eq!(
            classify("WITH a AS (SELECT 1), b AS (UPDATE users SET active = false) SELECT * FROM b"),
            Severity::Danger
        );
        // AC-1350-03 — middle CTE (of 3) destructive → danger.
        assert_eq!(
            classify(
                "WITH a AS (SELECT 1), b AS (DELETE FROM users), c AS (SELECT 2) SELECT * FROM c"
            ),
            Severity::Danger
        );
        // AC-1350-04 — 2nd CTE TRUNCATE → danger.
        assert_eq!(
            classify("WITH a AS (SELECT 1), b AS (TRUNCATE users) SELECT * FROM a"),
            Severity::Danger
        );
        // AC-1350-05 — nested subquery parens in read CTE, destructive 2nd → danger.
        assert_eq!(
            classify("WITH a AS (SELECT (SELECT 1)), b AS (DELETE FROM users) SELECT * FROM b"),
            Severity::Danger
        );
        // AC-1350-06 — bounded DELETE WHERE with nested subquery → warn (not over-escalated).
        assert_eq!(
            classify(
                "WITH a AS (SELECT 1), b AS (DELETE FROM users WHERE id IN (SELECT id FROM stale)) SELECT * FROM b"
            ),
            Severity::Warn
        );
        // AC-1350-07 — 'DELETE' text inside a string literal → info (no false positive).
        assert_eq!(
            classify(
                "WITH a AS (SELECT 'DELETE FROM users' AS note), b AS (SELECT 2) SELECT * FROM a"
            ),
            Severity::Info
        );
        // AC-1350-08 — 2nd CTE INSERT → info (not escalated).
        assert_eq!(
            classify(
                "WITH a AS (SELECT 1), b AS (INSERT INTO users (id) VALUES (1) RETURNING id) SELECT * FROM a"
            ),
            Severity::Info
        );
    }

    #[test]
    fn multi_cte_literal_paren_parity() {
        // Mirror sqlSafety.test.ts AC-1350-09..14 (review #1374). A `(` / `)`
        // inside a string literal, quoted identifier, or dollar-quote must not
        // skew the balanced-paren depth, or the destructive CTE is swallowed /
        // early-closed and reads as info. AC-1350-09 — '(' in string literal.
        assert_eq!(
            classify("WITH a AS (SELECT '(' ), b AS (DELETE FROM users) SELECT * FROM b"),
            Severity::Danger
        );
        // AC-1350-10 — '(' in dollar-quote.
        assert_eq!(
            classify("WITH a AS (SELECT $$($$), b AS (DELETE FROM users) SELECT * FROM b"),
            Severity::Danger
        );
        // AC-1350-11 — '(' in quoted identifier.
        assert_eq!(
            classify("WITH a AS (SELECT 1 AS \"x(\"), b AS (DELETE FROM users) SELECT * FROM b"),
            Severity::Danger
        );
        // AC-1350-12 — '(' in string on the destructive body, UPDATE no WHERE.
        assert_eq!(
            classify("WITH a AS (SELECT 1), b AS (UPDATE users SET note = '(') SELECT * FROM b"),
            Severity::Danger
        );
        // AC-1350-13 — ')' in string literal.
        assert_eq!(
            classify("WITH a AS (SELECT ')' ), b AS (DELETE FROM users) SELECT * FROM b"),
            Severity::Danger
        );
        // AC-1350-14 — ')' in dollar-quote.
        assert_eq!(
            classify("WITH a AS (SELECT $$)$$), b AS (DELETE FROM users) SELECT * FROM b"),
            Severity::Danger
        );
    }

    #[test]
    fn drop_object_parity_danger_vs_warn() {
        // Mirror sqlSafety.ts:656 (danger objects) vs :759 (`ddl-other`
        // warn). B2: only these object kinds are danger.
        for danger in [
            "DROP TABLE users",
            "DROP DATABASE app",
            "DROP SCHEMA s",
            "DROP INDEX i",
            "DROP VIEW v",
            "DROP TRIGGER t ON users",
        ] {
            assert_eq!(classify(danger), Severity::Danger, "{danger}");
        }
        // DROP FUNCTION / PROCEDURE / ROLE / EXTENSION / MATERIALIZED VIEW are
        // `ddl-other` warn on the frontend (no confirm dialog) — gating them
        // hard-rejects legitimate DDL (B2 regression).
        for allowed in [
            "DROP FUNCTION f()",
            "DROP PROCEDURE p",
            "DROP ROLE r",
            "DROP EXTENSION postgis",
            "DROP MATERIALIZED VIEW mv",
        ] {
            assert!(!is_danger(allowed), "{allowed} must not be gated");
        }
    }
}
