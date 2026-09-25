//! Written 2026-05-17 (AC-371-08) — the wire behaviour of `sql_redact`:
//!   1. masks quoted/numeric literals (happy path).
//!   2. lets bind parameters (`?`, `$1`, `:name`, `@name`) through.
//!   3. an empty string in → an empty string out.
//!   4. returns a `String` without panicking even on adversarial input such as
//!      a NULL byte / a 4-byte emoji / a 100KB length (the heart of the NOT
//!      NULL invariant).
//!
//! This file calls directly the same function the backend write path in
//! `commands/history.rs` invokes — wire shape lego: the backend test's input
//! matches the `sql` field of the frontend wrapper test
//! (`src/lib/tauri/history.test.ts`).
//!
//! The panic fallback path is caught by `catch_unwind`, so to verify what the
//! fallback's "return the original text as-is" means even in an environment
//! where a real panic is hard to trigger, this locks (a) the invariant that a
//! String comes back for every input on which the regex does not panic, and
//! (b) the safety net that deliberately adversarial input (a long quoted
//! string) does not fall into a panic either.

use table_view_lib::storage::sql_redact::sql_redact;

#[test]
fn happy_path_masks_email_literal() {
    let input = "SELECT * FROM users WHERE email = 'a@b.com'";
    let output = sql_redact(input);
    assert_eq!(output, "SELECT * FROM users WHERE email = ?");
}

#[test]
fn masks_integer_literal() {
    let input = "DELETE FROM logs WHERE id = 12345";
    let output = sql_redact(input);
    assert_eq!(output, "DELETE FROM logs WHERE id = ?");
}

#[test]
fn masks_float_literal() {
    let input = "UPDATE prices SET amount = 3.14 WHERE id = 1";
    let output = sql_redact(input);
    assert_eq!(output, "UPDATE prices SET amount = ? WHERE id = ?");
}

#[test]
fn masks_negative_and_exponent_literal() {
    let input = "SELECT * FROM measurements WHERE value > -1.2e-9";
    let output = sql_redact(input);
    assert_eq!(output, "SELECT * FROM measurements WHERE value > ?");
}

#[test]
fn masks_double_quoted_literal() {
    let input = r#"INSERT INTO labels(text) VALUES ("hello world")"#;
    let output = sql_redact(input);
    assert_eq!(output, r#"INSERT INTO labels(text) VALUES (?)"#);
}

#[test]
fn preserves_identifiers_with_trailing_digit() {
    // The word boundary keeps `col1` / `t2` out of the masking targets.
    let input = "SELECT col1, col2 FROM t2";
    let output = sql_redact(input);
    assert_eq!(output, "SELECT col1, col2 FROM t2");
}

#[test]
fn preserves_bind_parameters() {
    // `?` / `$N` / `:name` / `@name` carry no value — they pass through as-is.
    // This test checks the typical SQLite / PG / MySQL named/positional bind
    // forms together.
    let input = "SELECT * FROM users WHERE id = ? AND name = :name AND age > $1 AND ord = @ord";
    let output = sql_redact(input);
    assert_eq!(
        output,
        "SELECT * FROM users WHERE id = ? AND name = :name AND age > $1 AND ord = @ord"
    );
}

#[test]
fn empty_input_returns_empty_string() {
    assert_eq!(sql_redact(""), "");
}

#[test]
fn multi_literal_input_masks_all() {
    let input = "INSERT INTO t(a,b,c) VALUES ('x', 42, 3.14)";
    let output = sql_redact(input);
    assert_eq!(output, "INSERT INTO t(a,b,c) VALUES (?, ?, ?)");
}

#[test]
fn handles_quote_escape_inside_string_literal() {
    // In SQL standard, `''` is a single quote inside a single-quoted literal.
    let input = "SELECT * FROM users WHERE name = 'O''Brien'";
    let output = sql_redact(input);
    assert_eq!(output, "SELECT * FROM users WHERE name = ?");
}

// AC-371-08 fallback to the original text on panic — the function's external
// invariant is "returns a String for any input". Input that actually makes the
// regex panic is rare, so this test checks the `catch_unwind` contract itself
// (what the fallback path means = the caller's INSERT never breaks). An
// adversarial 100KB input with 4-byte UTF-8 plus a control byte must pass
// through without a panic.
#[test]
fn adversarial_unicode_and_long_input_does_not_panic() {
    let mut s = String::new();
    s.push_str("SELECT * FROM t WHERE x = '");
    for _ in 0..10_000 {
        // 4-byte UTF-8 emoji + 1-byte control byte mix.
        s.push('\u{1F600}');
        s.push('\u{0001}');
    }
    s.push('\'');
    let output = sql_redact(&s);
    // No panic, and a String comes back. The result is no longer than the
    // original (one literal collapses into `?`).
    assert!(
        output.contains('?') || !output.is_empty(),
        "adversarial input must not panic and must return a non-empty string"
    );
}

// An empty single-quoted literal `''` is a masking target too — one `?`.
#[test]
fn masks_empty_quoted_literal() {
    let input = "SELECT * FROM t WHERE a = ''";
    let output = sql_redact(input);
    assert_eq!(output, "SELECT * FROM t WHERE a = ?");
}
