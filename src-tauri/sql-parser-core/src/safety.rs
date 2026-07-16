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

use crate::ast::{
    AlterAction, DeleteStatement, ExplainInner, ParseResult, UpdateStatement, WithInner,
};
use crate::parser::parse;

/// Safe Mode severity tier. `Ord` so a multi-statement batch can take the
/// worst (max) tier — `Danger > Warn > Info`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Severity {
    Info,
    Warn,
    Danger,
}

/// PR #1473 — comment/literal scanning rules the keyword fallback needs vary
/// by dialect, so the stripper is dialect-gated instead of one-size-fits-all:
///
/// - **block-comment nesting**: only PostgreSQL nests `/* /* */ */`. Every
///   other dialect (MySQL/MariaDB/SQLite/Oracle/MSSQL) ends the comment at the
///   FIRST `*/`, so depth-counting there fails *open*: `/* /* */ DROP TABLE t`
///   would be consumed whole → `""` → `Info`, while the real server executes
///   the trailing DROP (the #1473 review F1 regression).
/// - **`#` line comments**: MySQL/MariaDB only (issue #1450).
/// - **backslash string escapes**: MySQL/MariaDB treat `\'` as an escaped
///   quote inside a literal; standard-SQL dialects treat `\` as a plain
///   character. A backslash-unaware scan ends a MySQL literal early and can
///   mis-read quoted text (e.g. a `WHERE`) as real syntax (review N1).
///
/// `Other` is the conservative default for an unknown/unresolved dialect:
/// first-close block comments, no `#`, no backslash escapes — the fail-closed
/// combination (it restores the pre-#1473 main behavior).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SqlDialect {
    /// Unknown or any dialect without special rules — conservative scanning.
    #[default]
    Other,
    /// MySQL / MariaDB — `#` line comments + backslash string escapes;
    /// block comments do NOT nest.
    MysqlFamily,
    /// PostgreSQL — nested block comments; no `#`, no backslash escapes in
    /// standard (non-`E''`) strings.
    Postgres,
    /// Oracle — recognizes the alternate quoting mechanism `q'X…X'` (issue
    /// #1455 P3-4). Same comment/block/backslash rules as `Other`; only the
    /// q-quote lexer differs.
    Oracle,
}

impl SqlDialect {
    fn hash_line_comments(self) -> bool {
        matches!(self, Self::MysqlFamily)
    }
    fn backslash_escapes(self) -> bool {
        matches!(self, Self::MysqlFamily)
    }
    fn nested_block_comments(self) -> bool {
        matches!(self, Self::Postgres)
    }
    /// #1455 P3-4 — Oracle alternate quoting `q'[…]'` / `q'{…}'` / `q'(…)'` /
    /// `q'<…>'` / `q'!…!'`. Only Oracle uses it, so recognizing it elsewhere
    /// would mis-lex a bare `q` identifier followed by a string.
    fn oracle_quotes(self) -> bool {
        matches!(self, Self::Oracle)
    }
}

/// Classify a SQL string for Safe Mode. A joined batch is split
/// (literal/comment-aware, mirroring the frontend `splitSqlStatements`)
/// and the worst tier wins, so a trailing `DROP` can never hide behind a
/// leading `SELECT` (issue #1118 defense, backend side).
pub fn classify(sql: &str) -> Severity {
    classify_with_dialect(sql, SqlDialect::Other)
}

/// Issue #1450 / PR #1473 — dialect-aware classify. The dialect gates `#`
/// line-comment stripping, backslash literal escapes (MySQL/MariaDB), and
/// block-comment nesting (PostgreSQL). Callers that cannot resolve a dialect
/// pass [`SqlDialect::Other`] (fail-closed first-close scanning).
pub fn classify_with_dialect(sql: &str, dialect: SqlDialect) -> Severity {
    split_statements(sql)
        .iter()
        .map(|stmt| classify_single(stmt, dialect))
        .max()
        .unwrap_or(Severity::Info)
}

/// Convenience — the only distinction the Safe Mode gate needs.
pub fn is_danger(sql: &str) -> bool {
    classify(sql) == Severity::Danger
}

/// Dialect-aware [`is_danger`] (issue #1450). The enforce path resolves the
/// connection dialect ([`SqlDialect`]) once and passes it through.
pub fn is_danger_with_dialect(sql: &str, dialect: SqlDialect) -> bool {
    classify_with_dialect(sql, dialect) == Severity::Danger
}

fn classify_single(stmt: &str, dialect: SqlDialect) -> Severity {
    match parse(stmt) {
        // `parse` covers DROP / TRUNCATE / ALTER / UPDATE / DELETE etc. in
        // grammar; the `error` variant (unsupported / syntax) falls through
        // to the keyword scan so REPLACE / RESTORE and dialect DROP variants
        // the AST rejects are still gated.
        ParseResult::Error(_) => classify_by_keyword(stmt, dialect),
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
fn classify_by_keyword(stmt: &str, dialect: SqlDialect) -> Severity {
    let normalized = strip_comments_collapse_opts(stmt, dialect);
    let upper = normalized.to_uppercase();
    let upper = upper.trim_start();

    // Data-modifying CTE (mirror frontend `analyzeDmlCte`). The parser rejects
    // a WITH whose CTE body is UPDATE/DELETE/INSERT (CTE bodies are SELECT-only
    // in-grammar), so a `WITH x AS (DELETE FROM t) SELECT …` reaches this
    // fallback. The wrapped statement's tier decides — a WHERE-less DELETE /
    // UPDATE inside a CTE is danger even though the outer form is a SELECT.
    if starts_with_keyword(upper, "WITH") {
        if let Some(severity) = classify_dml_cte(upper, dialect) {
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
    if starts_with_keyword(upper, "DELETE") && !has_where(upper, dialect) {
        return Severity::Danger;
    }
    if starts_with_keyword(upper, "UPDATE") && !has_where(upper, dialect) {
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
fn classify_dml_cte(upper: &str, dialect: SqlDialect) -> Option<Severity> {
    let mut worst: Option<Severity> = None;
    let mut from = 0;
    while let Some(open) = find_cte_body_open_paren(upper, from) {
        let body = match balanced_paren_slice(upper, open, dialect) {
            Some(b) => b,
            None => break,
        };
        // Strip the enclosing parens; `body` is `(…)`, both ASCII.
        let inner = body[1..body.len() - 1].trim();
        let sev = classify_single(inner, dialect);
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

/// Slice from the `(` at `open` through its matching `)` (inclusive). Mirrors
/// the frontend `extractBalanced`. `(` / `)` are ASCII and UTF-8 self-
/// synchronising, so byte indexing stays on boundaries.
///
/// Review #1374 — literal-aware: a `(` / `)` inside a string literal, quoted
/// identifier, or dollar-quote must NOT move the depth, or a payload like
/// `(SELECT '(')` skews the count and swallows the following CTE. The skip
/// rules mirror the frontend `skipQuotedLiteral` / `scanDollarQuoteEnd`.
fn balanced_paren_slice(upper: &str, open: usize, dialect: SqlDialect) -> Option<String> {
    let bytes = upper.as_bytes();
    if bytes.get(open) != Some(&b'(') {
        return None;
    }
    let mut depth = 0i32;
    let mut i = open;
    while i < bytes.len() {
        let c = bytes[i];
        if c == b'\'' || c == b'"' || c == b'`' {
            i = skip_quoted_literal(
                bytes,
                i,
                c,
                dialect.backslash_escapes(),
                dialect.oracle_quotes(),
            );
            continue;
        }
        if c == b'$' {
            if let Some(end) = scan_dollar_quote_end(bytes, i) {
                i = end;
                continue;
            }
        }
        match c {
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

/// Byte index just past the quoted literal opened at `start` (`q` ∈ `'` `"`
/// `` ` ``). `'` and `` ` `` treat a doubled quote as an escape; `"` does not
/// (mirrors the frontend `skipQuotedLiteral` / `splitSqlStatements`).
/// Unterminated → EOF.
///
/// Review #1473 N1 — `backslash_escapes` (MySQL/MariaDB): `\<any>` inside a
/// `'` / `"` literal is an escape sequence, so `'a\' WHERE …'` stays ONE
/// literal instead of ending at the escaped quote (a backslash-unaware scan
/// exposed the quoted `WHERE` and degraded an unbounded UPDATE to Warn).
/// Backtick identifiers never use backslash escapes (doubling only).
fn skip_quoted_literal(
    bytes: &[u8],
    start: usize,
    q: u8,
    backslash_escapes: bool,
    oracle_quotes: bool,
) -> usize {
    // #1455 P3-4 — Oracle alternate quoting `q'X…X'`: the `'` here is preceded
    // by a `q`/`Q` at a word boundary, and the char after the `'` is the
    // opening delimiter. Its content is fully literal (a raw `'` inside does
    // NOT close it), so a plain single-quote scan terminates early and leaks
    // the tail (`q'{don't WHERE}'` exposed a fake `WHERE`, downgrading a
    // WHERE-less UPDATE from Danger to Info).
    if oracle_quotes && q == b'\'' && start >= 1 {
        let prev = bytes[start - 1];
        let word_boundary_before = start < 2 || !is_word_byte(bytes[start - 2]);
        if (prev == b'q' || prev == b'Q') && word_boundary_before {
            if let Some(end) = skip_oracle_q_quote(bytes, start) {
                return end;
            }
        }
    }
    let escapes_by_doubling = q == b'\'' || q == b'`';
    let backslash = backslash_escapes && q != b'`';
    let mut i = start + 1;
    while i < bytes.len() {
        if backslash && bytes[i] == b'\\' {
            i += 2;
            continue;
        }
        if bytes[i] == q {
            if escapes_by_doubling && bytes.get(i + 1) == Some(&q) {
                i += 2;
                continue;
            }
            return i + 1;
        }
        i += 1;
    }
    i.min(bytes.len())
}

/// #1455 P3-4 — byte index just past an Oracle `q'X…X'` literal opened at the
/// `'` (`start`). The char at `start + 1` is the opening delimiter; the closer
/// is its mirror (`[`→`]`, `{`→`}`, `(`→`)`, `<`→`>`) or the same char for any
/// other delimiter. Returns `None` when the char after `'` cannot be a valid
/// q-quote delimiter (whitespace or another quote) so the caller falls back to
/// a normal single-quote scan. Unterminated → EOF.
fn skip_oracle_q_quote(bytes: &[u8], start: usize) -> Option<usize> {
    let open = *bytes.get(start + 1)?;
    // Oracle forbids whitespace and the quote itself as the delimiter.
    if open.is_ascii_whitespace() || open == b'\'' || open == b'"' {
        return None;
    }
    let close = match open {
        b'[' => b']',
        b'{' => b'}',
        b'(' => b')',
        b'<' => b'>',
        other => other,
    };
    let mut i = start + 2;
    while i < bytes.len() {
        if bytes[i] == close && bytes.get(i + 1) == Some(&b'\'') {
            return Some(i + 2);
        }
        i += 1;
    }
    Some(bytes.len())
}

/// Byte index just past a PostgreSQL dollar-quote (`$$…$$` / `$tag$…$tag$`)
/// opened at `start`, or `None` when `start` is not a dollar-quote opener (a
/// positional param `$1` / lone `$`). Unterminated → EOF. Mirrors the frontend
/// `scanDollarQuoteEnd` (sqlTokenize.ts): the tag follows unquoted-identifier
/// rules and dollar-quotes do not nest.
fn scan_dollar_quote_end(bytes: &[u8], start: usize) -> Option<usize> {
    if bytes.get(start) != Some(&b'$') {
        return None;
    }
    let mut j = start + 1;
    if bytes
        .get(j)
        .is_some_and(|c| c.is_ascii_alphabetic() || *c == b'_')
    {
        j += 1;
        while bytes
            .get(j)
            .is_some_and(|c| c.is_ascii_alphanumeric() || *c == b'_')
        {
            j += 1;
        }
    }
    if bytes.get(j) != Some(&b'$') {
        return None;
    }
    let delim = &bytes[start..=j];
    let mut k = j + 1;
    while k + delim.len() <= bytes.len() {
        if &bytes[k..k + delim.len()] == delim {
            return Some(k + delim.len());
        }
        k += 1;
    }
    Some(bytes.len())
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

/// Word-boundary `WHERE` presence that skips string literals, quoted
/// identifiers, and dollar-quotes (issue #1450). The old scan matched a `WHERE`
/// inside a string literal (`SET note = 'ask WHERE money'`), so an unbounded
/// UPDATE/DELETE was mis-read as bounded and degraded to `Warn`. Skip rules
/// mirror the frontend `hasOuterWhere` and the shared `skip_quoted_literal` /
/// `scan_dollar_quote_end` helpers.
fn has_where(upper: &str, dialect: SqlDialect) -> bool {
    let bytes = upper.as_bytes();
    let needle = b"WHERE";
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i];
        if c == b'\'' || c == b'"' || c == b'`' {
            i = skip_quoted_literal(
                bytes,
                i,
                c,
                dialect.backslash_escapes(),
                dialect.oracle_quotes(),
            );
            continue;
        }
        if c == b'$' {
            if let Some(end) = scan_dollar_quote_end(bytes, i) {
                i = end;
                continue;
            }
        }
        if i + needle.len() <= bytes.len() && &bytes[i..i + needle.len()] == needle {
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
/// tokens (mirrors the frontend `stripComments`). `pub(crate)` so the
/// dialect classifiers (e.g. `oracle`) share the exact comment stripping.
/// Uses [`SqlDialect::Other`] — first-close block comments (correct for
/// Oracle), no `#`, no backslash escapes.
pub(crate) fn strip_comments_collapse(sql: &str) -> String {
    strip_comments_collapse_opts(sql, SqlDialect::Other)
}

/// Issue #1450 / PR #1473 — literal-aware, dialect-gated comment stripper.
/// String literals / quoted identifiers / dollar-quotes are copied verbatim so
/// a `/*` or `#` inside a literal is never mistaken for a comment. The
/// dialect gates the three scanning rules ([`SqlDialect`] docs):
///
/// - Block comments depth-count ONLY for PostgreSQL (the one dialect that
///   nests). Everywhere else the FIRST `*/` closes the comment — exactly what
///   MySQL/MariaDB/SQLite/Oracle servers do. Review #1473 F1: depth-counting
///   a non-nesting dialect fails *open* on an unbalanced open
///   (`/* /* */ DROP TABLE t` was consumed whole → `""` → `Info`, while the
///   real server ends the comment at the first `*/` and executes the DROP).
/// - `#` starts a line comment only for MySQL/MariaDB (issue #1450).
/// - Backslash literal escapes only for MySQL/MariaDB (review N1).
///
/// Mirrors the frontend `stripComments`.
fn strip_comments_collapse_opts(sql: &str, dialect: SqlDialect) -> String {
    let bytes = sql.as_bytes();
    let mut out = String::with_capacity(sql.len());
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i];
        // String literal / quoted identifier — copy verbatim (skip contents).
        if c == b'\'' || c == b'"' || c == b'`' {
            let end = skip_quoted_literal(
                bytes,
                i,
                c,
                dialect.backslash_escapes(),
                dialect.oracle_quotes(),
            );
            out.push_str(&sql[i..end]);
            i = end;
            continue;
        }
        // PostgreSQL dollar-quote — copy verbatim.
        if c == b'$' {
            if let Some(end) = scan_dollar_quote_end(bytes, i) {
                out.push_str(&sql[i..end]);
                i = end;
                continue;
            }
        }
        // Line comment: `--` (all dialects) or `#` (MySQL only) → one space.
        if (c == b'-' && bytes.get(i + 1) == Some(&b'-'))
            || (dialect.hash_line_comments() && c == b'#')
        {
            i += if c == b'#' { 1 } else { 2 };
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
            out.push(' ');
            continue;
        }
        // Block comment `/* … */`. Depth-counted for PostgreSQL (nesting);
        // first `*/` closes it for every other dialect (fail-closed default).
        if c == b'/' && bytes.get(i + 1) == Some(&b'*') {
            let nested = dialect.nested_block_comments();
            let mut depth = 1u32;
            i += 2;
            while i < bytes.len() && depth > 0 {
                if nested && bytes[i] == b'/' && bytes.get(i + 1) == Some(&b'*') {
                    depth += 1;
                    i += 2;
                } else if bytes[i] == b'*' && bytes.get(i + 1) == Some(&b'/') {
                    depth -= 1;
                    i += 2;
                } else {
                    i += 1;
                }
            }
            out.push(' ');
            continue;
        }
        out.push(c as char);
        i += 1;
    }
    out
}

/// Literal/comment-aware statement splitter — a byte-faithful port of the
/// frontend `splitSqlStatements` (`src/lib/sql/sqlUtils.ts`). Only the
/// semicolon-boundary behavior matters for classification (each fragment is
/// classified independently and the worst tier wins). `pub(crate)` so the
/// dialect classifiers (e.g. `oracle`) split on the same literal/comment
/// boundaries — a trailing admin DDL can't hide behind a leading SELECT.
pub(crate) fn split_statements(sql: &str) -> Vec<String> {
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
        assert_eq!(
            classify("DROP TABLE IF EXISTS users CASCADE"),
            Severity::Danger
        );
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
        assert_eq!(
            classify("UPDATE users SET active = false"),
            Severity::Danger
        );
        // Bounded write — WARN (allow at the decision layer, mirrors the
        // frontend static classification; dry-run escalation is UI-only).
        assert_eq!(classify("DELETE FROM users WHERE id = 1"), Severity::Warn);
        assert_eq!(
            classify("UPDATE users SET active = false WHERE id = 1"),
            Severity::Warn
        );
    }

    #[test]
    fn reads_and_additive_are_not_danger() {
        assert_eq!(classify("SELECT * FROM users"), Severity::Info);
        assert_eq!(classify("INSERT INTO users VALUES (1)"), Severity::Info);
        assert_eq!(classify("CREATE TABLE t (id int)"), Severity::Info);
        assert!(!is_danger("SELECT 1"));
    }

    #[test]
    fn replace_and_restore_via_keyword_fallback() {
        // `parse` returns unsupported-statement for REPLACE — the keyword
        // fallback is the sole classifier (parity with frontend #1115).
        assert_eq!(classify("REPLACE INTO users VALUES (1)"), Severity::Danger);
        assert_eq!(classify("REPLACE INTO users SET id = 1"), Severity::Danger);
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
        assert_eq!(classify("SELECT 1; DROP TABLE users"), Severity::Danger);
        // Semicolon inside a string literal is not a separator.
        assert_eq!(
            classify("SELECT ';DROP TABLE users' AS note"),
            Severity::Info
        );
        // Semicolon inside a line comment is not a separator.
        assert_eq!(classify("SELECT 1 -- ; DROP TABLE users\n"), Severity::Info);
    }

    #[test]
    fn commented_out_danger_keyword_is_ignored() {
        assert_eq!(classify("/* DROP TABLE users */ SELECT 1"), Severity::Info);
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

    #[test]
    fn issue_1450_nested_block_comment_does_not_hide_danger_on_postgres() {
        // PostgreSQL nests block comments; the stripper depth-counts there so
        // the trailing DROP is not leaked behind a stray close marker.
        assert_eq!(
            classify_with_dialect(
                "/* outer /* inner */ still-outer */ DROP TABLE users",
                SqlDialect::Postgres
            ),
            Severity::Danger
        );
        assert_eq!(
            classify_with_dialect(
                "/* a /* b /* c */ d */ e */ TRUNCATE users",
                SqlDialect::Postgres
            ),
            Severity::Danger
        );
        // A comment marker inside a string literal is NOT a comment (no
        // false-positive strip of a read).
        assert_eq!(
            classify("SELECT '/* not a comment */' AS note"),
            Severity::Info
        );
    }

    #[test]
    fn pr_1473_unbalanced_open_comment_fails_closed_on_non_nesting_dialects() {
        // Review #1473 F1 (RED→GREEN): MySQL/MariaDB/SQLite/Oracle end a block
        // comment at the FIRST `*/`, so the real server executes the trailing
        // DROP. The depth-counting stripper consumed the whole input as one
        // comment → "" → Info → the Safe Mode gate never fired (fail-open).
        assert_eq!(
            classify_with_dialect("/* /* */ DROP TABLE t", SqlDialect::MysqlFamily),
            Severity::Danger
        );
        // Unknown dialect defaults to first-close — fail-closed (pre-#1473
        // main behavior restored).
        assert_eq!(
            classify_with_dialect("/* /* */ DROP TABLE t", SqlDialect::Other),
            Severity::Danger
        );
        assert_eq!(classify("/* /* */ DROP TABLE t"), Severity::Danger);
        // PostgreSQL keeps nesting semantics: `/* /*` is an unterminated
        // comment the server rejects — nothing executes, Info is safe.
        assert_eq!(
            classify_with_dialect("/* /* */ DROP TABLE t", SqlDialect::Postgres),
            Severity::Info
        );
    }

    #[test]
    fn pr_1473_backslash_escape_bounds_mysql_literals() {
        // Review #1473 N1 (RED→GREEN): on MySQL `\'` stays inside the literal,
        // so the WHERE is quoted text and the UPDATE is unbounded (danger).
        // The backslash-unaware scan ended the literal at the escaped quote,
        // saw the quoted WHERE as real syntax, and degraded to Warn.
        assert_eq!(
            classify_with_dialect(
                "UPDATE accounts SET note='a\\' WHERE id=1'",
                SqlDialect::MysqlFamily
            ),
            Severity::Danger
        );
        // Standard-SQL dialects treat `\` as a plain character — the literal
        // ends at the second quote, the trailing WHERE bounds the update, and
        // the statement must NOT be gated (the keyword fallback only promises
        // Danger precision; Warn/Info collapse best-effort).
        assert_ne!(
            classify_with_dialect(
                "UPDATE accounts SET note='a\\' WHERE id=1'",
                SqlDialect::Other
            ),
            Severity::Danger
        );
        // Backtick identifiers never take backslash escapes, even on MySQL —
        // the real WHERE after the identifier still bounds the update.
        assert_ne!(
            classify_with_dialect("UPDATE `t\\` SET a=1 WHERE id=1", SqlDialect::MysqlFamily),
            Severity::Danger
        );
    }

    #[test]
    fn issue_1450_hash_line_comment_is_mysql_only() {
        // MySQL connection: `#` leads a line comment, so the real statement
        // after it is classified.
        assert!(is_danger_with_dialect(
            "#x\nDROP TABLE users",
            SqlDialect::MysqlFamily
        ));
        assert!(is_danger_with_dialect(
            "# note \nDELETE FROM users",
            SqlDialect::MysqlFamily
        ));
        // `#` inside a string literal stays literal even for MySQL.
        assert!(!is_danger_with_dialect(
            "SELECT 'a # b' AS note",
            SqlDialect::MysqlFamily
        ));
        // A commented-out DROP is not executed → the real statement is a read.
        assert!(!is_danger_with_dialect(
            "#DROP TABLE users\nSELECT 1",
            SqlDialect::MysqlFamily
        ));
        // Non-MySQL: `#` is an operator, not a comment — the malformed input
        // stays fail-open (dialect-conditional, mirrors the frontend).
        assert!(!is_danger("#x\nDROP TABLE users"));
    }

    #[test]
    fn issue_1450_where_inside_literal_is_not_a_bounding_clause() {
        // The `WHERE` lives inside a string literal, so the UPDATE is unbounded.
        assert_eq!(
            classify("UPDATE accounts SET balance=balance+1, note='ask WHERE money'"),
            Severity::Danger
        );
        // Doubled-quote escape inside the literal must not end the literal early.
        assert_eq!(
            classify("UPDATE accounts SET note='it''s ok WHERE now'"),
            Severity::Danger
        );
        // A real trailing WHERE still bounds the write (not over-escalated).
        assert_eq!(
            classify("UPDATE users SET note='reset WHERE flag' WHERE id = 1"),
            Severity::Warn
        );
    }

    #[test]
    fn issue_1455_oracle_q_quote_hides_fake_where() {
        // #1455 P3-4 — an Oracle `q'{…}'` literal that contains a raw `'` and a
        // fake `WHERE` used to leak the tail (`don't WHERE}'`), so a WHERE-less
        // UPDATE/DELETE read as bounded (Info/Warn). With the q-quote lexer the
        // whole literal is skipped → the write is correctly Danger.
        for sql in [
            "UPDATE accounts SET note = q'{don't WHERE it}'",
            "UPDATE accounts SET note = q'[a'b WHERE c]'",
            "UPDATE accounts SET note = q'<a'b WHERE c>'",
        ] {
            assert_eq!(
                classify_with_dialect(sql, SqlDialect::Oracle),
                Severity::Danger,
                "{sql}"
            );
        }
        // A real bounding WHERE outside the q-quote must NOT be gated — the
        // q-quote skip does not swallow the trailing real WHERE. (Keyword
        // fallback under-classifies a parse-failing bounded UPDATE to Info,
        // which is non-danger and passes the Safe Mode gate — the security
        // property that matters is "not Danger".)
        assert_ne!(
            classify_with_dialect(
                "UPDATE accounts SET note = q'{don't}' WHERE id = 1",
                SqlDialect::Oracle
            ),
            Severity::Danger
        );
        // Non-Oracle dialects must NOT treat `q'…'` as an alternate quote — a
        // bare `q` identifier followed by a string stays a normal literal.
        // (Here the leaked `WHERE` reads as bounding, exactly as before #1455;
        // this locks the gating so PG/MySQL classification is untouched.)
        assert_eq!(
            classify_with_dialect(
                "UPDATE accounts SET note = q'{don't WHERE it}'",
                SqlDialect::Other
            ),
            Severity::Info
        );
    }

    // ----------------------------------------------------------------------
    // Parity mirror (issue #1352) — the FE<->BE parity cases used to live here
    // as a hand-copied block ("Parity mirror", ported verbatim from
    // `src/lib/sql/sqlSafety.test.ts`). Manual copy-paste was the only safety
    // net, so drift like the #1350 multi-CTE hole passed green. They now come
    // from the SHARED `tests/fixtures/classifier-parity.json`, which the
    // frontend `sqlSafety.parity-fixture.test.ts` consumes too — a classifier
    // change on either side that drifts the other trips a test on that side.
    // ----------------------------------------------------------------------

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ParityCase {
        name: String,
        sql: String,
        expected_severity: String,
        // Issue #1450 / PR #1473 — optional per-case dialect. MySQL/MariaDB
        // enable `#` line comments + backslash escapes; PostgreSQL enables
        // nested block comments; an absent field classifies with the
        // conservative `SqlDialect::Other` scanning rules.
        #[serde(default)]
        dialect: Option<String>,
    }

    #[derive(serde::Deserialize)]
    struct ParityFixture {
        cases: Vec<ParityCase>,
    }

    fn severity_from_fixture(tier: &str) -> Severity {
        match tier {
            "info" => Severity::Info,
            "warn" => Severity::Warn,
            "danger" => Severity::Danger,
            other => panic!("unknown expectedSeverity `{other}` in classifier-parity.json"),
        }
    }

    #[test]
    fn classifier_parity_fixture() {
        const RAW: &str = include_str!("../../../tests/fixtures/classifier-parity.json");
        let fixture: ParityFixture =
            serde_json::from_str(RAW).expect("classifier-parity.json must be valid JSON");
        assert!(
            !fixture.cases.is_empty(),
            "classifier-parity.json has no cases (silently emptied?)"
        );
        for case in &fixture.cases {
            let expected = severity_from_fixture(&case.expected_severity);
            // Mirror of the frontend `Dialect` string → scanning-rule mapping
            // (`sqlSafety.ts` stripComments): MySQL/MariaDB → `#` comments +
            // backslash escapes; PostgreSQL → nested block comments; anything
            // else (or an absent field) → conservative `Other`.
            let dialect = match case.dialect.as_deref() {
                Some("mysql") | Some("mariadb") => SqlDialect::MysqlFamily,
                Some("postgresql") => SqlDialect::Postgres,
                Some("oracle") => SqlDialect::Oracle,
                _ => SqlDialect::Other,
            };
            assert_eq!(
                classify_with_dialect(&case.sql, dialect),
                expected,
                "parity case `{}` (dialect {:?}): {}",
                case.name,
                case.dialect,
                case.sql
            );
        }
    }
}
