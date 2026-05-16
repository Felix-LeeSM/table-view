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
                let leading = &caps[0][..num.start() - caps.get(0).unwrap().start()];
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

#[cfg(test)]
mod tests {
    //! 작성 2026-05-17 (Phase 5 sprint-371) — module-local smoke for the
    //! redact regex. Cargo integration scenarios (panic fallback + exotic
    //! literal shapes) live in `tests/sql_redact.rs` and use this module
    //! via `table_view_lib::storage::sql_redact::sql_redact`.

    use super::sql_redact;

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
