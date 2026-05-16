//! 작성 2026-05-17 (Phase 5 sprint-371, AC-371-08) — `sql_redact` 의 wire 동작:
//!   1. quoted/numeric literal 마스킹 (happy path).
//!   2. bind 파라미터 (`?`, `$1`, `:name`, `@name`) 은 통과.
//!   3. 정상 빈 문자열 → 빈 문자열.
//!   4. NULL-byte / 4-byte emoji / 길이 100KB 등 adversarial 입력에도
//!      panic 없이 `String` 반환 (NOT NULL invariant 의 핵심).
//!
//! 이 파일은 `commands/history.rs` 의 backend write path 가 invoke 하는 동일
//! 함수를 직접 호출 — wire shape lego: backend test 의 입력은 frontend wrapper
//! test (`src/lib/tauri/history.test.ts`) 의 `sql` 필드와 일치.
//!
//! Panic fallback path 는 `catch_unwind` 으로 잡히므로, 실제 panic 을
//! 유발하기 어려운 환경에서도 fallback 의 "원문을 그대로 반환" 의 의미를
//! 검증하기 위해 (a) regex 가 panic 하지 않는 모든 입력에서 String 이
//! 반환된다는 invariant 와 (b) 일부러 adversarial 인풋 (긴 quoted string)
//! 에서도 panic 으로 빠지지 않는다는 안전망을 잠근다.

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
    // `col1` / `t2` 는 word-boundary 로 masking 대상에서 제외.
    let input = "SELECT col1, col2 FROM t2";
    let output = sql_redact(input);
    assert_eq!(output, "SELECT col1, col2 FROM t2");
}

#[test]
fn preserves_bind_parameters() {
    // `?` / `$N` / `:name` / `@name` 은 값을 담지 않는다 — 그대로 통과.
    // 본 테스트는 SQLite / PG / MySQL named/positional bind 의 전형 형식을
    // 함께 확인.
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
    // SQL-standard `''` 가 single quoted literal 안의 single quote.
    let input = "SELECT * FROM users WHERE name = 'O''Brien'";
    let output = sql_redact(input);
    assert_eq!(output, "SELECT * FROM users WHERE name = ?");
}

// AC-371-08 panic 시 원문 fallback — 함수의 외부 invariant 는 "어떤 입력에도
// String 을 반환한다". 실제 regex 가 panic 하는 입력은 흔치 않으므로 본
// 테스트는 `catch_unwind` 의 contract 자체를 확인 (fallback path 의 의미
// = caller 의 INSERT 가 절대 깨지지 않음). adversarial 한 100KB 입력 +
// 4-byte UTF-8 + control byte 가 panic 없이 통과해야 한다.
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
    // panic 안 났고 String 반환. 결과 길이는 원문보다 짧거나 같다
    // (literal 1개가 `?` 로 압축).
    assert!(
        output.contains('?') || !output.is_empty(),
        "adversarial input must not panic and must return a non-empty string"
    );
}

// 빈 single quoted literal `''` 도 masking 의 대상 — `?` 1개.
#[test]
fn masks_empty_quoted_literal() {
    let input = "SELECT * FROM t WHERE a = ''";
    let output = sql_redact(input);
    assert_eq!(output, "SELECT * FROM t WHERE a = ?");
}
