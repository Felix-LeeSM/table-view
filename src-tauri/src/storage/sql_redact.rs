//! Sprint 371 (Phase 5 F.5) — SQL literal masking for `query_history.sql_redacted`.
//!
//! Strategy doc F.5 (line 535–562) — every `query_history` row carries two
//! columns: `sql` (user-readable, returned only from `get_history_detail`) and
//! `sql_redacted` (literal-masked, returned in `list_history`). The contract
//! invariant is `sql_redacted NOT NULL` — even when the redact pass panics
//! (a pathological regex backtrack on an adversarial input, etc.) we fall
//! back to the original string so the column never breaks.
//!
//! Masked input classes:
//!   1. Single-quoted string literals — `'foo'` → `?`.  Embedded
//!      `''` (SQL-standard quote escape) is consumed as part of the literal.
//!   2. Double-quoted string literals — `"foo"` → `?`. Note: SQLite uses
//!      double quotes for identifiers, but the masking is intentionally
//!      aggressive — a history view doesn't need identifier fidelity.
//!   3. Numeric literals — integer (`42`) / float (`3.14`) / negative
//!      (`-7`) / scientific (`1.2e9`). Numbers attached to identifiers
//!      (e.g. `col1`) are preserved (word-boundary anchor).
//!
//! Bind parameters (`?`, `?1`, `$1`, `:name`, `@name`) pass through unchanged
//! — they already carry no literal value.
//!
//! Implementation: a single `Regex` (`OR` between literal classes) compiled
//! lazily at first use via `OnceLock`. The replacement is wrapped in
//! `catch_unwind` so a panic in `regex::Regex::replace_all` (or any future
//! addition) degrades to the original string instead of poisoning the
//! caller's `INSERT`.

use regex::Regex;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::OnceLock;

/// Lazy regex initializer. Pattern is statically known; compile failure
/// would be a programming bug — we `expect()` and the test
/// `tests/sql_redact.rs::compiles` catches a regression at the unit tier.
fn redact_regex() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        // Order matters only for clarity — the regex engine picks the
        // longest leftmost match, so a numeric inside a string literal
        // is consumed by the string-literal alternative.
        //
        // Pieces:
        //   - `'(?:''|[^'])*'`   → single-quoted literal, with `''` escape.
        //   - `"(?:""|[^"])*"`   → double-quoted literal, with `""` escape.
        //   - `(?:^|[^\w$:@])(-?\d+(?:\.\d+)?(?:[eE]-?\d+)?)` → number
        //     literal with optional sign / decimal / exponent. The leading
        //     non-word-or-bind char class (or BOL) keeps `col1` / `t2`
        //     identifiers intact AND lets a leading `-` be consumed
        //     (which a plain `\b` would refuse — `\b` requires a word/
        //     non-word boundary and `-` itself is non-word, so `\b-` would
        //     anchor at a space-preceded `-` only if the next char is
        //     word, which is fine, but then `\b` on the trailing side
        //     would *also* try to match before `-` and lose the literal).
        //     `$`, `:`, `@` are added to the negated class so the bind
        //     parameter forms `$1` / `:1` / `@1` keep the digit intact.
        //     We *do* mask `?1` (positional bind) because frontend never
        //     emits that form and SQLite's standard placeholder is plain `?`.
        Regex::new(
            r#"'(?:''|[^'])*'|"(?:""|[^"])*"|(?:^|[^\w$:@])(?P<num>-?\d+(?:\.\d+)?(?:[eE]-?\d+)?)\b"#,
        )
        .expect("sql_redact regex must compile")
    })
}

/// Mask quoted / numeric literals in `sql` with `?`. Always returns a
/// `String` — on any panic from the underlying regex engine the original
/// `sql` is returned verbatim so the `NOT NULL sql_redacted` column has a
/// non-null value to bind. The fallback path is exercised by the
/// `panic_fallback_returns_original` test.
pub fn sql_redact(sql: &str) -> String {
    // `AssertUnwindSafe` is required because the captured `&str` and the
    // resulting `String` are not statically `UnwindSafe`. The closure does
    // not mutate any caller state, so the assertion is sound.
    let result = catch_unwind(AssertUnwindSafe(|| {
        // We use a closure replacement to preserve the non-word leading
        // character that the numeric-literal alternative consumes (so the
        // surrounding whitespace / punctuation is kept intact). For
        // string-literal alternatives the whole match is the literal —
        // no `num` capture group present, so we substitute `?`.
        let re = redact_regex();
        re.replace_all(sql, |caps: &regex::Captures<'_>| {
            if let Some(num) = caps.name("num") {
                // Group 0 (the whole match) always exists here, so this is the
                // match's own start; `map_or` avoids an unwrap while keeping the
                // real-case offset unchanged.
                let match_start = caps.get(0).map_or(num.start(), |m| m.start());
                let leading = &caps[0][..num.start() - match_start];
                format!("{leading}?")
            } else {
                "?".to_string()
            }
        })
        .into_owned()
    }));
    match result {
        Ok(redacted) => redacted,
        Err(_) => sql.to_string(),
    }
}

// ---------------------------------------------------------------------
// Issue #1451 / PR #1470 — credential-value masking for the
// `query_history.sql` column. `sql_redact` masks *every* literal (list
// view); this pass masks *only* the secret value in a credential clause so
// the detail view keeps its structure but never stores a plaintext
// password.
//
// A single context-blind regex is structurally unable to do this (PR #1470
// review): it masked the username in `SET PASSWORD FOR 'app'@'%' = 'x'`
// while leaving the password plaintext, and it mangled ordinary literals
// (`SELECT 'my password' || 'x'`, JSON documents) because it could not
// tell an identifier from text *inside* a string. The rewrite is a small
// lossless scanner + token walk: string/comment context is decided first,
// then only value tokens in a credential clause are replaced.
//
// `sql-parser-core`'s lexer is deliberately NOT reused here: it is strict
// (LexError on backticks, dollar-quotes, comments, `@'%'` user specs, …)
// while redaction must never fail on any dialect input.
//
// Covered clause shapes (case-insensitive, comments/whitespace between
// tokens allowed):
//   - `PASSWORD 'x'` / `PASSWORD = 'x'` / `PASSWORD = N'x'` / `PASSWORD "x"`
//     / `PASSWORD $$x$$` / `PASSWORD $tag$x$tag$` — PG / MSSQL / MySQL,
//     including any identifier containing `password`/`pwd`/`secret`
//     assigned a quoted literal (`password_hash = 'x'`, MSSQL
//     `SCOPED CREDENTIAL ... SECRET = 'x'`; `IDENTITY = 'x'` survives).
//   - colon assignment `pwd: "x"` / `"password": "x"` — mongo shell / ES
//     raw text stored in history via the mongo error path.
//   - `SET PASSWORD FOR <user> = 'x'` — masks the value after `=`, the
//     user spec (`'app'@'%'`) survives.
//   - `PASSWORD('x')` / `OLD_PASSWORD('x')` — literal arguments masked.
//   - `IDENTIFIED [WITH <plugin>] BY|AS [PASSWORD|VALUES] <value>
//     [REPLACE <value>]` — MySQL/Oracle family, quoted value or Oracle
//     bareword; the REPLACE literal is the current password.
//   - inside string literals only: connection-string `password=secret` and
//     URI userinfo `://user:secret@` (dblink / FDW / COPY targets).
//
// Ordinary string literals are never treated as clause keywords — a JSON
// document or `SELECT 'my password'` passes through byte-identical.
//
// Residuals (documented, not blocking):
//   - backslash-quote escapes (`'pw\''`) are not treated as escapes — only
//     the SQL-standard `''` (dialect-dependent; MySQL-only syntax).
//   - quoted values inside connection strings (`password='a b'`) are not
//     masked; the common unquoted form is.

/// Token kinds produced by [`tokenize`]. Comments/whitespace are trivia —
/// skipped during the walk but preserved in the output (replacements are
/// span-based).
#[derive(Clone, Copy, PartialEq, Eq)]
enum TokKind {
    /// Bareword: ASCII alnum/`_` start, alnum/`_`/`#` continuation.
    Word,
    /// `'...'` with `''` escape, optional 1-letter prefix (`N'..'`, `E'..'`).
    SingleStr,
    /// `"..."` with `""` escape — PG identifier or MySQL string.
    DoubleStr,
    /// `` `...` `` MySQL identifier (`` `` `` escape).
    Backtick,
    /// `[...]` MSSQL identifier (`]]` escape).
    Bracket,
    /// `$tag$...$tag$` PG dollar-quote (named tags paired exactly).
    DollarStr,
    /// Any other single byte (punctuation, operators).
    Other,
}

struct Tok {
    kind: TokKind,
    start: usize,
    end: usize,
}

/// Lossless, infallible scanner. Unterminated literals extend to the end of
/// input (fail-closed: their content is invisible to the clause matcher and
/// still gets the in-literal pass). Token spans always fall on char
/// boundaries: quote/comment scans only stop on ASCII bytes (UTF-8
/// continuation bytes never collide with ASCII), and the catch-all consumes
/// whole UTF-8 sequences — so span slicing never panics into the fail-open
/// `catch_unwind` path (2nd review B4).
fn tokenize(sql: &str) -> Vec<Tok> {
    let b = sql.as_bytes();
    let n = b.len();
    let mut toks = Vec::new();
    let mut i = 0usize;
    while i < n {
        let c = b[i];
        let start = i;
        if c.is_ascii_whitespace() {
            i += 1;
            continue;
        }
        // Line comments: `--` and MySQL `#` (only at token start — `#`
        // *inside* a word stays word continuation for Oracle `col#` names).
        if (c == b'-' && b.get(i + 1) == Some(&b'-')) || c == b'#' {
            while i < n && b[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        // Block comment, PG-style nesting. Unterminated → trivia to end.
        if c == b'/' && b.get(i + 1) == Some(&b'*') {
            let mut depth = 1usize;
            i += 2;
            while i < n && depth > 0 {
                if b[i] == b'/' && b.get(i + 1) == Some(&b'*') {
                    depth += 1;
                    i += 2;
                } else if b[i] == b'*' && b.get(i + 1) == Some(&b'/') {
                    depth -= 1;
                    i += 2;
                } else {
                    i += 1;
                }
            }
            continue;
        }
        // Single-quoted literal, optional 1-letter string prefix (N'..').
        if c == b'\'' || (c.is_ascii_alphabetic() && b.get(i + 1) == Some(&b'\'')) {
            i += if c == b'\'' { 1 } else { 2 };
            while i < n {
                if b[i] == b'\'' {
                    if b.get(i + 1) == Some(&b'\'') {
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            toks.push(Tok {
                kind: TokKind::SingleStr,
                start,
                end: i,
            });
            continue;
        }
        // Double-quoted / backtick / bracket — same doubled-escape scan.
        if c == b'"' || c == b'`' {
            let (close, kind) = if c == b'"' {
                (b'"', TokKind::DoubleStr)
            } else {
                (b'`', TokKind::Backtick)
            };
            i += 1;
            while i < n {
                if b[i] == close {
                    if b.get(i + 1) == Some(&close) {
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            toks.push(Tok {
                kind,
                start,
                end: i,
            });
            continue;
        }
        if c == b'[' {
            i += 1;
            while i < n {
                if b[i] == b']' {
                    if b.get(i + 1) == Some(&b']') {
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            toks.push(Tok {
                kind: TokKind::Bracket,
                start,
                end: i,
            });
            continue;
        }
        // Dollar-quote: `$$` or `$tag$` (tag = [A-Za-z_][A-Za-z0-9_]*,
        // PG-strict so `$1` placeholders stay punctuation + word).
        if c == b'$' {
            let mut j = i + 1;
            if j < n && (b[j].is_ascii_alphabetic() || b[j] == b'_') {
                j += 1;
                while j < n && (b[j].is_ascii_alphanumeric() || b[j] == b'_') {
                    j += 1;
                }
            }
            if j < n && b[j] == b'$' {
                let tag = &sql[i..=j];
                let body_start = j + 1;
                let end = sql[body_start..]
                    .find(tag)
                    .map_or(n, |p| body_start + p + tag.len());
                toks.push(Tok {
                    kind: TokKind::DollarStr,
                    start,
                    end,
                });
                i = end;
                continue;
            }
            toks.push(Tok {
                kind: TokKind::Other,
                start,
                end: i + 1,
            });
            i += 1;
            continue;
        }
        // Bareword. `$` is excluded from continuation so `PASSWORD$$x$$`
        // still splits into keyword + dollar-quote.
        if c.is_ascii_alphanumeric() || c == b'_' {
            i += 1;
            while i < n && (b[i].is_ascii_alphanumeric() || b[i] == b'_' || b[i] == b'#') {
                i += 1;
            }
            toks.push(Tok {
                kind: TokKind::Word,
                start,
                end: i,
            });
            continue;
        }
        // Punctuation / any other byte. Non-ASCII: consume the full UTF-8
        // sequence (continuation bytes are 0b10xxxxxx) so every token
        // boundary stays a char boundary — a byte-wise `i + 1` here ended a
        // token mid-char, later slicing panicked, and `catch_unwind`
        // fail-opened to the plaintext original (2nd review B4).
        i += 1;
        while i < n && (b[i] & 0xC0) == 0x80 {
            i += 1;
        }
        toks.push(Tok {
            kind: TokKind::Other,
            start,
            end: i,
        });
    }
    toks
}

fn tok_text<'a>(sql: &'a str, t: &Tok) -> &'a str {
    // Defense in depth for B4: `tokenize` keeps every span on a char
    // boundary, but a mid-char span must degrade to "no match" — never
    // panic into the fail-open `catch_unwind` path.
    sql.get(t.start..t.end).unwrap_or("")
}

fn is_word(sql: &str, t: &Tok, w: &str) -> bool {
    t.kind == TokKind::Word && tok_text(sql, t).eq_ignore_ascii_case(w)
}

fn is_char(sql: &str, t: &Tok, c: char) -> bool {
    t.kind == TokKind::Other && tok_text(sql, t).as_bytes() == [c as u8]
}

/// A token that can carry a secret *value*: quoted string or dollar-quote.
fn is_value(t: &Tok) -> bool {
    matches!(
        t.kind,
        TokKind::SingleStr | TokKind::DoubleStr | TokKind::DollarStr
    )
}

/// Subject token of a credential assignment: a bareword or quoted
/// *identifier* whose text contains `password`/`pwd`/`secret` (the latter
/// covers MSSQL `CREATE DATABASE SCOPED CREDENTIAL ... SECRET = '...'` —
/// 2nd review B1; `IDENTITY = '...'` is not a subject and survives).
/// Single-quoted / dollar-quoted tokens are values, never subjects — that
/// asymmetry is what keeps `SELECT 'my password'` and JSON literals
/// untouched.
fn is_pw_subject(sql: &str, t: &Tok) -> bool {
    if !matches!(
        t.kind,
        TokKind::Word | TokKind::DoubleStr | TokKind::Backtick | TokKind::Bracket
    ) {
        return false;
    }
    let lower = tok_text(sql, t).to_ascii_lowercase();
    lower.contains("password") || lower.contains("pwd") || lower.contains("secret")
}

/// Fixed sentinel — deterministic, zero entropy, quote-balanced.
const SENTINEL: &str = "'***'";

/// Connection-string `password=value` / `pwd=value` inside a string
/// literal. The value stops at separators or any quote so the literal's own
/// escape structure is never crossed.
fn conn_string_regex() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(r#"(?i)\b(?:password|pwd)\s*=\s*([^;&\s'"]+)"#)
            .expect("conn-string redact regex must compile")
    })
}

/// Key=value credential in a *plain-text* driver message (review #1490 B2).
/// Unlike [`conn_string_regex`] — which runs inside SQL string literals and
/// must never cross the literal's own quotes — a driver message has no
/// escape structure, so a single-/double-quoted value (libpq conninfo
/// `password='x y'`, spaces allowed inside the quotes) is masked whole,
/// quotes included. Unquoted values keep the same separator-stop behavior.
fn conn_string_message_regex() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(r#"(?i)\b(?:password|pwd)\s*=\s*('[^']*'|"[^"]*"|[^;&\s'"]+)"#)
            .expect("conn-string message redact regex must compile")
    })
}

/// URI userinfo `://user:secret@` inside a string literal. The user part is
/// `*` (may be empty) — Redis URLs commonly carry a password with no user
/// (`redis://:secret@host`, issue #1453).
fn uri_userinfo_regex() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(r#"://[^/?#\s:@']*:([^@\s/']+)@"#)
            .expect("uri userinfo redact regex must compile")
    })
}

/// Walk the token stream and collect `(start, end, replacement)` spans for
/// every credential value. Never touches subjects, user specs, or ordinary
/// literals.
fn credential_replacements(sql: &str, toks: &[Tok]) -> Vec<(usize, usize, &'static str)> {
    let mut repl: Vec<(usize, usize, &'static str)> = Vec::new();
    let mut i = 0usize;
    while i < toks.len() {
        // IDENTIFIED [WITH <plugin>] BY|AS [PASSWORD|VALUES] <value|bareword>
        if is_word(sql, &toks[i], "identified") {
            let mut j = i + 1;
            if j < toks.len() && is_word(sql, &toks[j], "with") {
                j += 2; // skip the plugin token (bareword or quoted)
            }
            if j < toks.len() && (is_word(sql, &toks[j], "by") || is_word(sql, &toks[j], "as")) {
                let mut k = j + 1;
                // `BY PASSWORD 'hash'` / `BY VALUES 'hash'` sub-keyword —
                // only when a value follows; otherwise that word *is* the
                // Oracle bareword secret.
                if k + 1 < toks.len()
                    && (is_word(sql, &toks[k], "password") || is_word(sql, &toks[k], "values"))
                    && (is_value(&toks[k + 1]) || toks[k + 1].kind == TokKind::Word)
                {
                    k += 1;
                }
                if k < toks.len() && (is_value(&toks[k]) || toks[k].kind == TokKind::Word) {
                    repl.push((toks[k].start, toks[k].end, SENTINEL));
                    let mut next = k + 1;
                    // MySQL `IDENTIFIED BY 'new' REPLACE 'current'` — the
                    // REPLACE literal is the *current* password (2nd
                    // review B3), mask it too.
                    if next + 1 < toks.len()
                        && is_word(sql, &toks[next], "replace")
                        && is_value(&toks[next + 1])
                    {
                        repl.push((toks[next + 1].start, toks[next + 1].end, SENTINEL));
                        next += 2;
                    }
                    i = next;
                    continue;
                }
            }
            i += 1;
            continue;
        }
        if is_pw_subject(sql, &toks[i]) {
            let exact_password = is_word(sql, &toks[i], "password");
            if let Some(t1) = toks.get(i + 1) {
                // `password = 'x'` / `password_hash = "x"` — and the colon
                // form `pwd: "x"` / `"password": "x"` (mongo shell / ES raw
                // text stored via the mongo error path, 2nd review B2).
                if is_char(sql, t1, '=') || is_char(sql, t1, ':') {
                    if let Some(t2) = toks.get(i + 2) {
                        if is_value(t2) {
                            repl.push((t2.start, t2.end, SENTINEL));
                            i += 3;
                            continue;
                        }
                    }
                } else if toks[i].kind == TokKind::Word && is_value(t1) {
                    // Keyword-value form: `PASSWORD 'x'` (PG/MySQL/MSSQL,
                    // FDW `OPTIONS (password 'x')`).
                    repl.push((t1.start, t1.end, SENTINEL));
                    i += 2;
                    continue;
                } else if toks[i].kind == TokKind::Word && is_char(sql, t1, '(') {
                    // Function form: `PASSWORD('x')` / `OLD_PASSWORD('x')`.
                    // Mask literal arguments up to the matching paren.
                    // ponytail: 64-token bound — credential calls carry 1-2 args.
                    let mut depth = 1usize;
                    let mut m = i + 2;
                    while m < toks.len() && depth > 0 && m - i < 64 {
                        if is_char(sql, &toks[m], '(') {
                            depth += 1;
                        } else if is_char(sql, &toks[m], ')') {
                            depth -= 1;
                        } else if is_value(&toks[m]) {
                            repl.push((toks[m].start, toks[m].end, SENTINEL));
                        }
                        m += 1;
                    }
                    i = m;
                    continue;
                } else if exact_password && is_word(sql, t1, "for") {
                    // MySQL `SET PASSWORD FOR <user> = 'x'` — mask only the
                    // value after `=`; the user spec (`'app'@'%'`) survives.
                    // ponytail: 16-token bound — user specs are 1-3 tokens.
                    let mut m = i + 2;
                    let mut advanced = None;
                    while m < toks.len() && m - i < 16 && !is_char(sql, &toks[m], ';') {
                        if is_char(sql, &toks[m], '=') {
                            if let Some(v) = toks.get(m + 1) {
                                if is_value(v) {
                                    repl.push((v.start, v.end, SENTINEL));
                                    advanced = Some(m + 2);
                                }
                            }
                            break;
                        }
                        m += 1;
                    }
                    if let Some(next) = advanced {
                        i = next;
                        continue;
                    }
                }
            }
        }
        i += 1;
    }
    // In-literal pass: secrets that live *inside* a string literal
    // (connection strings, URIs). Whole-token masks above start at the
    // opening quote, strictly before any in-literal match, so the overlap
    // guard in `redact_credentials` drops the redundant inner span.
    for t in toks {
        if !is_value(t) {
            continue;
        }
        let s = tok_text(sql, t);
        for caps in conn_string_regex().captures_iter(s) {
            if let Some(g) = caps.get(1) {
                repl.push((t.start + g.start(), t.start + g.end(), "***"));
            }
        }
        for caps in uri_userinfo_regex().captures_iter(s) {
            if let Some(g) = caps.get(1) {
                repl.push((t.start + g.start(), t.start + g.end(), "***"));
            }
        }
    }
    repl
}

/// Issue #1453 — mask credential values in a *plain-text* connection error
/// message (driver output, not SQL): key=value `password=...` / `pwd=...`
/// (quoted or unquoted — [`conn_string_message_regex`]) and URI userinfo
/// `://user:secret@`. Host / port / database / user survive so the error
/// stays actionable. Callers route through
/// [`crate::error::AppError::connection_redacted`].
pub fn redact_connection_message(message: &str) -> String {
    let mut spans: Vec<(usize, usize)> = Vec::new();
    for re in [conn_string_message_regex(), uri_userinfo_regex()] {
        for caps in re.captures_iter(message) {
            if let Some(g) = caps.get(1) {
                spans.push((g.start(), g.end()));
            }
        }
    }
    spans.sort_unstable();
    let mut out = String::with_capacity(message.len());
    let mut pos = 0usize;
    for (s, e) in spans {
        if s < pos {
            continue; // overlap guard — parity with redact_credentials
        }
        out.push_str(&message[pos..s]);
        out.push_str("***");
        pos = e;
    }
    out.push_str(&message[pos..]);
    out
}

/// Mask the credential value in every credential clause of `sql`,
/// preserving the surrounding keyword/structure and all non-credential
/// literals. See the module notes above for covered shapes and residuals.
/// Returns the original string unchanged on panic (parity with
/// [`sql_redact`] — the `NOT NULL` column always gets a value).
pub fn redact_credentials(sql: &str) -> String {
    let result = catch_unwind(AssertUnwindSafe(|| {
        let toks = tokenize(sql);
        let mut repl = credential_replacements(sql, &toks);
        repl.sort_by_key(|r| (r.0, r.1));
        let mut out = String::with_capacity(sql.len());
        let mut pos = 0usize;
        for (s, e, r) in repl {
            if s < pos {
                continue; // overlap guard — first (outermost) span wins
            }
            out.push_str(&sql[pos..s]);
            out.push_str(r);
            pos = e;
        }
        out.push_str(&sql[pos..]);
        out
    }));
    result.unwrap_or_else(|_| sql.to_string())
}

#[cfg(test)]
mod tests {
    //! 작성 2026-05-17 (Phase 5 sprint-371) — module-local smoke for the
    //! redact regex. Cargo integration scenarios (panic fallback + exotic
    //! literal shapes) live in `tests/sql_redact.rs` and use this module
    //! via `table_view_lib::storage::sql_redact::sql_redact`.

    use super::{redact_connection_message, redact_credentials, sql_redact};

    // Reason: issue #1453 — connection errors are plain text (not SQL);
    // `redact_connection_message` must mask URI userinfo / key=value
    // credentials while preserving host/port/user (2026-07-10).
    #[test]
    fn connection_message_credentials_masked() {
        let cases = [
            (
                "could not connect to postgres://app:S3cretPw1@db:5432/x",
                "could not connect to postgres://app:***@db:5432/x",
            ),
            // Empty-user URI — the common Redis shape.
            (
                "IO error: redis://:S3cretPw1@redis.local:6379/0",
                "IO error: redis://:***@redis.local:6379/0",
            ),
            // ADO / libpq key=value pairs; value stops at separators.
            (
                "cannot open host=h Password=S3cretPw1;user=u pwd=Oth3r",
                "cannot open host=h Password=***;user=u pwd=***",
            ),
            // Non-secret error copy survives byte-identical.
            (
                "Connection refused (os error 61) at localhost:5432",
                "Connection refused (os error 61) at localhost:5432",
            ),
        ];
        for (input, expected) in cases {
            assert_eq!(redact_connection_message(input), expected, "for `{input}`");
        }
    }

    // Reason: review #1490 B2 — libpq conninfo quotes its values
    // (`password='x'` / `pwd="x"`, spaces allowed inside the quotes); the
    // pre-fix value class stopped at the leading quote and leaked the
    // secret whole (2026-07-11).
    #[test]
    fn connection_message_quoted_credentials_masked() {
        let cases = [
            (
                "FATAL: host=h password='S3cretPw1' user=u",
                "FATAL: host=h password=*** user=u",
            ),
            (
                r#"cannot open: pwd="S3cretPw1";host=h"#,
                "cannot open: pwd=***;host=h",
            ),
            // Spaces inside the quotes must not split the secret.
            (
                "FATAL: password='S3cret Pw1' user=u",
                "FATAL: password=*** user=u",
            ),
        ];
        for (input, expected) in cases {
            let out = redact_connection_message(input);
            assert_eq!(out, expected, "for `{input}`");
            assert!(!out.contains("S3cret"), "secret leaked in `{out}`");
        }
    }

    #[test]
    fn credentials_masked_across_dialects() {
        // (input, must-not-contain)
        let cases = [
            ("ALTER USER app WITH PASSWORD 'pw@1ZZ'", "pw@1ZZ"),
            ("ALTER LOGIN app WITH PASSWORD = 'pw@2ZZ'", "pw@2ZZ"),
            ("ALTER LOGIN app WITH PASSWORD = N'pw@3ZZ'", "pw@3ZZ"),
            ("CREATE USER app@'%' IDENTIFIED BY 'pw@4ZZ'", "pw@4ZZ"),
            ("ALTER USER app IDENTIFIED BY pw5ZZ", "pw5ZZ"),
            ("SET PASSWORD FOR app = 'pw@6ZZ'", "pw@6ZZ"),
            (
                "UPDATE users SET password_hash = 'pw@7ZZ' WHERE id = 1",
                "pw@7ZZ",
            ),
            // MySQL 8 — plugin auth clause between IDENTIFIED and BY.
            (
                "CREATE USER app@'%' IDENTIFIED WITH caching_sha2_password BY 'pw@8ZZ'",
                "pw@8ZZ",
            ),
            // MySQL — plugin + pre-hashed value (WITH plugin AS 'hash').
            (
                "CREATE USER app@'%' IDENTIFIED WITH mysql_native_password AS 'pw@9ZZ'",
                "pw@9ZZ",
            ),
            // Double-quoted value (MySQL default string).
            ("ALTER USER app IDENTIFIED BY \"pw@aZZ\"", "pw@aZZ"),
            ("ALTER LOGIN app WITH PASSWORD \"pw@bZZ\"", "pw@bZZ"),
            // PostgreSQL dollar-quoted value (empty tag).
            ("ALTER ROLE app PASSWORD $$pwcZZ$$", "pwcZZ"),
            // C-comment injected between keyword and value.
            ("ALTER USER app WITH PASSWORD/**/'pw@dZZ'", "pw@dZZ"),
        ];
        for (sql, secret) in cases {
            let out = redact_credentials(sql);
            assert!(!out.contains(secret), "leaked secret for `{sql}`: {out}");
            assert!(out.contains("'***'"), "no sentinel for `{sql}`: {out}");
        }
    }

    #[test]
    fn credential_masking_preserves_structure() {
        assert_eq!(
            redact_credentials("ALTER USER app WITH PASSWORD 'pw@1ZZ'"),
            "ALTER USER app WITH PASSWORD '***'"
        );
        assert_eq!(
            redact_credentials("UPDATE users SET password_hash = 'pw@7ZZ' WHERE id = 1"),
            "UPDATE users SET password_hash = '***' WHERE id = 1"
        );
        assert_eq!(
            redact_credentials("ALTER USER app IDENTIFIED BY VALUES 'pw@8ZZ'"),
            "ALTER USER app IDENTIFIED BY VALUES '***'"
        );
    }

    // ---------------------------------------------------------------
    // PR #1470 review findings — RED cases fixed by the token-walk
    // rewrite. Finding 1: false negative (username masked, password
    // left plaintext). Finding 2: false positive (ordinary literals
    // mangled, quote balance destroyed).
    // ---------------------------------------------------------------

    #[test]
    fn set_password_for_masks_value_not_username() {
        // Finding 1a — the old regex masked the username `'app'` and left
        // `'secretA'` plaintext.
        assert_eq!(
            redact_credentials("SET PASSWORD FOR 'app'@'%' = 'secretA'"),
            "SET PASSWORD FOR 'app'@'%' = '***'"
        );
    }

    #[test]
    fn password_function_argument_is_masked() {
        // Finding 1b — functional form `PASSWORD('x')` was not matched.
        assert_eq!(
            redact_credentials("SET PASSWORD FOR 'app'@'%' = PASSWORD('secretB')"),
            "SET PASSWORD FOR 'app'@'%' = PASSWORD('***')"
        );
        assert_eq!(
            redact_credentials("SELECT PASSWORD('secretC')"),
            "SELECT PASSWORD('***')"
        );
    }

    #[test]
    fn ordinary_string_literal_containing_password_word_is_untouched() {
        // Finding 2a — the old regex produced `SELECT 'my password'***'x'`.
        let sql = "SELECT 'my password' || 'x'";
        assert_eq!(redact_credentials(sql), sql);
    }

    #[test]
    fn json_literal_is_untouched() {
        // Finding 2b — the old regex broke the quote balance inside the
        // JSON literal and left `s3cret` next to the sentinel. A string
        // literal is data, not a credential clause — leave it intact.
        let sql = r#"INSERT INTO docs(body) VALUES ('{"password":"s3cret"}')"#;
        assert_eq!(redact_credentials(sql), sql);
    }

    #[test]
    fn connection_string_password_value_masked_inside_literal() {
        // k=v connection strings do carry a secret — mask the value only,
        // preserving the literal's quotes and the other pairs.
        assert_eq!(
            redact_credentials("SELECT dblink_connect('host=h user=u password=sctD dbname=d')"),
            "SELECT dblink_connect('host=h user=u password=*** dbname=d')"
        );
    }

    #[test]
    fn uri_userinfo_password_masked_inside_literal() {
        assert_eq!(
            redact_credentials("SELECT dblink_connect('postgres://app:sctE@db:5432/x')"),
            "SELECT dblink_connect('postgres://app:***@db:5432/x')"
        );
    }

    #[test]
    fn named_tag_dollar_quoted_password_masked() {
        // The regex impl documented this as an unfixable residual (no
        // backreference); the scanner pairs named tags directly.
        assert_eq!(
            redact_credentials("ALTER ROLE app PASSWORD $tag$pwEZZ$tag$"),
            "ALTER ROLE app PASSWORD '***'"
        );
    }

    // ---------------------------------------------------------------
    // PR #1470 second review — blocking findings B1–B4. Inputs are the
    // reviewer's own reproduction cases.
    // ---------------------------------------------------------------

    #[test]
    fn mssql_scoped_credential_secret_masked_identity_untouched() {
        // B1 — `SECRET = '...'` is a credential value; `IDENTITY = '...'`
        // is not and must survive (over-masking was a 1st-review defect).
        assert_eq!(
            redact_credentials(
                "CREATE DATABASE SCOPED CREDENTIAL c WITH IDENTITY='u', SECRET='topsecretS2'"
            ),
            "CREATE DATABASE SCOPED CREDENTIAL c WITH IDENTITY='u', SECRET='***'"
        );
    }

    #[test]
    fn colon_assignment_password_masked() {
        // B2 — mongo shell / ES raw text reaches history via the mongo
        // error path; colon assignment must mask like `=` does.
        assert_eq!(
            redact_credentials(r#"db.createUser({user: "u", pwd: "secretS3", roles: []})"#),
            r#"db.createUser({user: "u", pwd: '***', roles: []})"#
        );
        assert_eq!(
            redact_credentials(r#"{"password":"esSecretX2"}"#),
            r#"{"password":'***'}"#
        );
    }

    #[test]
    fn identified_by_replace_masks_current_password() {
        // B3 — the REPLACE literal is the *current* password.
        assert_eq!(
            redact_credentials("ALTER USER u IDENTIFIED BY 'newC6' REPLACE 'oldC6'"),
            "ALTER USER u IDENTIFIED BY '***' REPLACE '***'"
        );
    }

    #[test]
    fn non_ascii_input_does_not_fail_open() {
        // B4 — 'и' is 2 bytes in UTF-8; the byte-wise catch-all used to
        // emit a token ending mid-char, later slicing panicked, and
        // catch_unwind fail-opened to the plaintext original.
        assert_eq!(
            redact_credentials("SET PASSWORD FOR имя = 's3cret'"),
            "SET PASSWORD FOR имя = '***'"
        );
    }

    #[test]
    fn non_credential_statements_are_untouched() {
        // Column named `password` in a read → no value → no change.
        let read = "SELECT id, password FROM users WHERE id = 1";
        assert_eq!(redact_credentials(read), read);
        // MySQL `PASSWORD EXPIRE` has no value literal → must survive.
        let expire = "ALTER USER app PASSWORD EXPIRE";
        assert_eq!(redact_credentials(expire), expire);
        // Ordinary predicate literal is not a credential → left for sql_redact.
        let ordinary = "SELECT * FROM t WHERE age = 18";
        assert_eq!(redact_credentials(ordinary), ordinary);
    }

    #[test]
    fn masks_single_quoted_literal() {
        let out = sql_redact("SELECT * FROM users WHERE email = 'a@b.com'");
        assert_eq!(out, "SELECT * FROM users WHERE email = ?");
    }

    #[test]
    fn masks_numeric_literal() {
        let out = sql_redact("SELECT * FROM users WHERE age > 18");
        assert_eq!(out, "SELECT * FROM users WHERE age > ?");
    }

    #[test]
    fn preserves_identifier_with_trailing_digit() {
        // `col1` must not be masked — \b anchor prevents partial match.
        let out = sql_redact("SELECT col1, col2 FROM t1");
        assert_eq!(out, "SELECT col1, col2 FROM t1");
    }

    #[test]
    fn empty_input_round_trips() {
        assert_eq!(sql_redact(""), "");
    }

    #[test]
    fn masks_multiple_literals_in_one_pass() {
        let out = sql_redact("INSERT INTO t(a,b) VALUES ('x', 42)");
        assert_eq!(out, "INSERT INTO t(a,b) VALUES (?, ?)");
    }
}
