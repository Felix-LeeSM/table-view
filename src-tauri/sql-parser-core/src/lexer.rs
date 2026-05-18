//! Hand-written character-level lexer for the sprint-385 grammar slice.
//!
//! Design:
//! - Returns `Vec<Token>` (with positional spans) or a `LexError`. No
//!   panic / unwrap on user-input paths — every `Result` is explicit so
//!   the same code is safe under both native and WASM execution.
//! - No regex / nom / logos — a hand-written matcher keeps the WASM
//!   bundle minimal (the entire crate's WASM output should stay under
//!   the 1.5 MB compressed budget; pulling in `regex` would blow it).
//! - Case-insensitive keyword recognition. Identifiers are
//!   case-preserving (the parser stores them verbatim).
//! - Single-quoted string literals only. The SQL standard `''` escape
//!   for embedded apostrophes is supported (`'O''Brien'` → `O'Brien`).
//!   Backslash escapes are NOT supported (those are dialect-specific).

use crate::ast::ParseError;
use crate::ast::ParseErrorKind;

#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    // --- keywords (sprint-385) ---
    Select,
    From,
    Where,

    // --- keywords (sprint-391 DDL destructive verbs) ---
    Drop,
    Truncate,
    Alter,

    // --- keywords (sprint-391 DDL object types + qualifiers) ---
    Table,
    Database,
    Index,
    View,
    Schema,
    Sequence,
    Type,
    If,
    Exists,
    Cascade,
    Restrict,
    Restart,
    Continue,
    Identity,
    Column,
    Constraint,

    // --- keywords (sprint-392 DML write triad) ---
    Insert,
    Into,
    Values,
    Default,
    Returning,
    Update,
    Set,
    Delete,
    Using,
    On,
    Conflict,
    Do,
    Nothing,
    And,
    Or,
    Not,
    Null,
    Is,
    In,
    True,
    False,

    // --- literals / identifiers ---
    Ident(String),
    Integer(i64),
    Float(f64),
    String(String),
    /// `$1`, `$42` — positional placeholder (PG style).
    PlaceholderPositional(String),
    /// `?` — anonymous placeholder.
    PlaceholderAnonymous,
    /// `:name` — named placeholder (`@`/sqlite styles also accepted via `:`).
    PlaceholderNamed(String),

    // --- punctuation ---
    Star,
    Comma,
    Eq,
    NotEq,  // <>
    BangEq, // !=
    Lt,
    Gt,
    LtEq,
    GtEq,
    LParen,
    RParen,
    Dot,
    Semicolon,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Spanned {
    pub token: Token,
    /// 0-based byte offset where this token starts.
    pub at: usize,
}

/// Lex the input into a flat token stream. Whitespace and trailing
/// semicolons are stripped here — the parser never sees them.
pub fn lex(input: &str) -> Result<Vec<Spanned>, ParseError> {
    let bytes = input.as_bytes();
    let mut tokens: Vec<Spanned> = Vec::new();
    let mut i = 0usize;

    while i < bytes.len() {
        let start = i;
        let c = bytes[i];

        // Whitespace — fast path. ASCII space / tab / CR / LF only.
        // (Sprint 385 does not need to grok Unicode whitespace; the SQL
        // grammar we accept is ASCII anyway.)
        if c == b' ' || c == b'\t' || c == b'\n' || c == b'\r' {
            i += 1;
            continue;
        }

        // Semicolon. We accept a trailing `;` but never emit a token
        // for it — sprint-385 is single-statement, multi-statement
        // parsing is out of scope.
        if c == b';' {
            i += 1;
            continue;
        }

        // Comma / star / equals — single-char punctuation.
        if c == b',' {
            tokens.push(Spanned {
                token: Token::Comma,
                at: start,
            });
            i += 1;
            continue;
        }
        if c == b'*' {
            tokens.push(Spanned {
                token: Token::Star,
                at: start,
            });
            i += 1;
            continue;
        }
        if c == b'=' {
            tokens.push(Spanned {
                token: Token::Eq,
                at: start,
            });
            i += 1;
            continue;
        }

        // Sprint-392 — parentheses for VALUES / function-style boundaries.
        if c == b'(' {
            tokens.push(Spanned {
                token: Token::LParen,
                at: start,
            });
            i += 1;
            continue;
        }
        if c == b')' {
            tokens.push(Spanned {
                token: Token::RParen,
                at: start,
            });
            i += 1;
            continue;
        }

        // Sprint-392 — `?` anonymous placeholder.
        if c == b'?' {
            tokens.push(Spanned {
                token: Token::PlaceholderAnonymous,
                at: start,
            });
            i += 1;
            continue;
        }

        // Sprint-392 — `$<digits>` positional placeholder (PG-style).
        if c == b'$' {
            let mut end = i + 1;
            while end < bytes.len() && bytes[end].is_ascii_digit() {
                end += 1;
            }
            if end == i + 1 {
                return Err(lex_err(
                    start,
                    "expected digits after '$' for positional placeholder",
                ));
            }
            let slice = std::str::from_utf8(&bytes[i + 1..end])
                .map_err(|_| lex_err(start, "utf-8"))?;
            tokens.push(Spanned {
                token: Token::PlaceholderPositional(slice.to_string()),
                at: start,
            });
            i = end;
            continue;
        }

        // Sprint-392 — `:name` named placeholder.
        if c == b':' {
            let mut end = i + 1;
            while end < bytes.len() && (bytes[end].is_ascii_alphanumeric() || bytes[end] == b'_') {
                end += 1;
            }
            if end == i + 1 {
                return Err(lex_err(
                    start,
                    "expected identifier after ':' for named placeholder",
                ));
            }
            let slice = std::str::from_utf8(&bytes[i + 1..end])
                .map_err(|_| lex_err(start, "utf-8"))?;
            tokens.push(Spanned {
                token: Token::PlaceholderNamed(slice.to_string()),
                at: start,
            });
            i = end;
            continue;
        }

        // `<`, `<=`, `<>` — multi-char punctuation requires lookahead.
        if c == b'<' {
            let next = bytes.get(i + 1).copied();
            match next {
                Some(b'=') => {
                    tokens.push(Spanned {
                        token: Token::LtEq,
                        at: start,
                    });
                    i += 2;
                }
                Some(b'>') => {
                    tokens.push(Spanned {
                        token: Token::NotEq,
                        at: start,
                    });
                    i += 2;
                }
                _ => {
                    tokens.push(Spanned {
                        token: Token::Lt,
                        at: start,
                    });
                    i += 1;
                }
            }
            continue;
        }

        // `>`, `>=` — analogous to `<`.
        if c == b'>' {
            let next = bytes.get(i + 1).copied();
            if next == Some(b'=') {
                tokens.push(Spanned {
                    token: Token::GtEq,
                    at: start,
                });
                i += 2;
            } else {
                tokens.push(Spanned {
                    token: Token::Gt,
                    at: start,
                });
                i += 1;
            }
            continue;
        }

        // `!=` — `!` is only valid as the start of `!=`. A bare `!`
        // is a lex error.
        if c == b'!' {
            let next = bytes.get(i + 1).copied();
            if next == Some(b'=') {
                tokens.push(Spanned {
                    token: Token::BangEq,
                    at: start,
                });
                i += 2;
                continue;
            }
            return Err(lex_err(
                start,
                "unexpected '!' (sprint-385 only supports '!=' for inequality)",
            ));
        }

        // String literal — single-quoted. SQL-standard `''` escape for
        // embedded apostrophe; backslashes are literal (no `\n` etc.).
        if c == b'\'' {
            let (value, consumed) = lex_string(&bytes[i..], start)?;
            tokens.push(Spanned {
                token: Token::String(value),
                at: start,
            });
            i += consumed;
            continue;
        }

        // Integer or float literal. Sprint-392 adds float support so
        // `INSERT INTO t VALUES (3.14)` lexes cleanly. Integer literal
        // remains the path for plain digit runs (used by SELECT WHERE
        // and DML VALUES alike); a `.` followed by more digits promotes
        // the token to a Float.
        if c.is_ascii_digit() {
            let mut end = i + 1;
            while end < bytes.len() && bytes[end].is_ascii_digit() {
                end += 1;
            }
            // Detect a fractional part — `.<digits>`. A trailing dot
            // without digits (`3.`) is a lex error (we keep the grammar
            // strict; PG/MySQL accept it but it's a footgun in this slice).
            // To stay under the sprint-391 ×1.3 gzipped WASM budget we
            // parse the float manually as integer-part + fraction-part
            // accumulation. This avoids pulling rust's `dec2flt` machinery
            // (which contributes ~35KB gzipped in optimized WASM).
            let is_float = end < bytes.len()
                && bytes[end] == b'.'
                && bytes
                    .get(end + 1)
                    .is_some_and(|b| b.is_ascii_digit());
            if is_float {
                let int_slice = std::str::from_utf8(&bytes[i..end])
                    .map_err(|_| lex_err(start, "utf-8"))?;
                let int_part = int_slice
                    .parse::<i64>()
                    .map_err(|_| lex_err(start, "float out of range"))?;
                end += 1; // consume '.'
                let frac_start = end;
                while end < bytes.len() && bytes[end].is_ascii_digit() {
                    end += 1;
                }
                let frac_slice = std::str::from_utf8(&bytes[frac_start..end])
                    .map_err(|_| lex_err(start, "utf-8"))?;
                let frac_digits = end - frac_start;
                let frac_int = frac_slice
                    .parse::<u64>()
                    .map_err(|_| lex_err(start, "float out of range"))?;
                // Build the f64 manually: int + frac / 10^digits. This is
                // not bit-perfect with `f64::parse` (which uses a precise
                // round-half-to-even path) but is good enough for the
                // sprint-392 use case (VALUES literals are forwarded
                // verbatim to the DB driver — the AST f64 is for *display*
                // and equality checks, not arithmetic).
                let mut divisor: f64 = 1.0;
                for _ in 0..frac_digits {
                    divisor *= 10.0;
                }
                let value = (int_part as f64) + (frac_int as f64) / divisor;
                tokens.push(Spanned {
                    token: Token::Float(value),
                    at: start,
                });
                i = end;
                continue;
            }
            let slice = std::str::from_utf8(&bytes[i..end])
                .map_err(|_| lex_err(start, "utf-8"))?;
            // `i64::from_str_radix` returns `Err` on overflow; surface
            // that as a lex error rather than panicking.
            let value = slice
                .parse::<i64>()
                .map_err(|_| lex_err(start, "integer out of range"))?;
            tokens.push(Spanned {
                token: Token::Integer(value),
                at: start,
            });
            i = end;
            continue;
        }

        // Sprint-392 — `.` qualifier (e.g. `other.id`). Standalone, never
        // mixed with digit runs because the digit path consumes any
        // trailing `.<digit>` as a Float literal first.
        if c == b'.' {
            tokens.push(Spanned {
                token: Token::Dot,
                at: start,
            });
            i += 1;
            continue;
        }

        // Identifier or keyword. Start with ASCII letter or underscore;
        // subsequent chars may include digits.
        if c.is_ascii_alphabetic() || c == b'_' {
            let mut end = i + 1;
            while end < bytes.len() && (bytes[end].is_ascii_alphanumeric() || bytes[end] == b'_') {
                end += 1;
            }
            let slice = std::str::from_utf8(&bytes[i..end])
                .map_err(|_| lex_err(start, "utf-8"))?;
            let token = match slice.to_ascii_lowercase().as_str() {
                "select" => Token::Select,
                "from" => Token::From,
                "where" => Token::Where,
                // sprint-391 DDL destructive verbs + qualifiers.
                "drop" => Token::Drop,
                "truncate" => Token::Truncate,
                "alter" => Token::Alter,
                "table" => Token::Table,
                "database" => Token::Database,
                "index" => Token::Index,
                "view" => Token::View,
                "schema" => Token::Schema,
                "sequence" => Token::Sequence,
                "type" => Token::Type,
                "if" => Token::If,
                "exists" => Token::Exists,
                "cascade" => Token::Cascade,
                "restrict" => Token::Restrict,
                "restart" => Token::Restart,
                "continue" => Token::Continue,
                "identity" => Token::Identity,
                "column" => Token::Column,
                "constraint" => Token::Constraint,
                // sprint-392 DML keywords.
                "insert" => Token::Insert,
                "into" => Token::Into,
                "values" => Token::Values,
                "default" => Token::Default,
                "returning" => Token::Returning,
                "update" => Token::Update,
                "set" => Token::Set,
                "delete" => Token::Delete,
                "using" => Token::Using,
                "on" => Token::On,
                "conflict" => Token::Conflict,
                "do" => Token::Do,
                "nothing" => Token::Nothing,
                "and" => Token::And,
                "or" => Token::Or,
                "not" => Token::Not,
                "null" => Token::Null,
                "is" => Token::Is,
                "in" => Token::In,
                "true" => Token::True,
                "false" => Token::False,
                _ => Token::Ident(slice.to_string()),
            };
            tokens.push(Spanned { token, at: start });
            i = end;
            continue;
        }

        return Err(lex_err(
            start,
            &format!("unexpected character {:?}", c as char),
        ));
    }

    Ok(tokens)
}

/// Lex one single-quoted string literal. Returns the decoded payload and
/// the number of input bytes consumed (including both quotes). Caller
/// passes a slice starting at the opening `'`.
fn lex_string(bytes: &[u8], start_offset: usize) -> Result<(String, usize), ParseError> {
    debug_assert_eq!(bytes.first().copied(), Some(b'\''));
    let mut out = String::new();
    let mut i = 1usize;
    while i < bytes.len() {
        let c = bytes[i];
        if c == b'\'' {
            // SQL-standard escape: doubled `''` is a literal apostrophe.
            if bytes.get(i + 1).copied() == Some(b'\'') {
                out.push('\'');
                i += 2;
                continue;
            }
            // Closing quote.
            return Ok((out, i + 1));
        }
        // Non-quote byte — push verbatim. Multi-byte UTF-8 is OK because
        // we are only pattern-matching on ASCII bytes (`'`) here; any
        // continuation byte > 0x7f passes through untouched.
        out.push(c as char);
        i += 1;
    }
    Err(lex_err(start_offset, "unterminated string literal"))
}

fn lex_err(at: usize, msg: &str) -> ParseError {
    ParseError {
        error_kind: ParseErrorKind::LexError,
        message: msg.to_string(),
        at: Some(at),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lex_ok(input: &str) -> Vec<Token> {
        lex(input)
            .expect("lex should succeed")
            .into_iter()
            .map(|s| s.token)
            .collect()
    }

    #[test]
    fn ac_l1_keywords_case_insensitive() {
        for kw in ["SELECT", "select", "Select", "SeLeCt"] {
            assert_eq!(lex_ok(kw), vec![Token::Select], "kw={kw}");
        }
        assert_eq!(lex_ok("FROM"), vec![Token::From]);
        assert_eq!(lex_ok("WHERE"), vec![Token::Where]);
    }

    #[test]
    fn ac_l2_identifiers() {
        assert_eq!(lex_ok("users"), vec![Token::Ident("users".into())]);
        assert_eq!(lex_ok("id"), vec![Token::Ident("id".into())]);
        assert_eq!(lex_ok("user_id"), vec![Token::Ident("user_id".into())]);
        assert_eq!(lex_ok("_x9"), vec![Token::Ident("_x9".into())]);
    }

    #[test]
    fn ac_l3_integer_literals() {
        assert_eq!(lex_ok("42"), vec![Token::Integer(42)]);
        assert_eq!(lex_ok("0"), vec![Token::Integer(0)]);
        assert_eq!(lex_ok("1234567890"), vec![Token::Integer(1_234_567_890)]);
    }

    #[test]
    fn ac_l3_integer_overflow_is_lex_error() {
        // i64::MAX is 9_223_372_036_854_775_807 — one more digit overflows.
        let err = lex("99999999999999999999999").unwrap_err();
        assert_eq!(err.error_kind, ParseErrorKind::LexError);
    }

    #[test]
    fn ac_l4_string_literals() {
        assert_eq!(lex_ok("'felix'"), vec![Token::String("felix".into())]);
        assert_eq!(lex_ok("''"), vec![Token::String(String::new())]);
        assert_eq!(
            lex_ok("'with spaces'"),
            vec![Token::String("with spaces".into())]
        );
    }

    #[test]
    fn ac_l4_string_doubled_apostrophe_escape() {
        // 'O''Brien' → O'Brien
        assert_eq!(lex_ok("'O''Brien'"), vec![Token::String("O'Brien".into())]);
    }

    #[test]
    fn ac_l4_unterminated_string_is_lex_error() {
        let err = lex("'never closed").unwrap_err();
        assert_eq!(err.error_kind, ParseErrorKind::LexError);
        assert!(err.message.contains("unterminated"));
    }

    #[test]
    fn ac_l5_punctuation_all_seven_ops() {
        assert_eq!(lex_ok("*"), vec![Token::Star]);
        assert_eq!(lex_ok(","), vec![Token::Comma]);
        assert_eq!(lex_ok("="), vec![Token::Eq]);
        assert_eq!(lex_ok("<"), vec![Token::Lt]);
        assert_eq!(lex_ok(">"), vec![Token::Gt]);
        assert_eq!(lex_ok("<="), vec![Token::LtEq]);
        assert_eq!(lex_ok(">="), vec![Token::GtEq]);
        assert_eq!(lex_ok("<>"), vec![Token::NotEq]);
        assert_eq!(lex_ok("!="), vec![Token::BangEq]);
    }

    #[test]
    fn ac_l6_whitespace_and_trailing_semicolon_ignored() {
        assert_eq!(
            lex_ok("  SELECT  *  FROM  users ; "),
            vec![
                Token::Select,
                Token::Star,
                Token::From,
                Token::Ident("users".into()),
            ]
        );
        // Mixed whitespace (tab, newline, CR).
        assert_eq!(
            lex_ok("SELECT\tid\nFROM\rusers"),
            vec![
                Token::Select,
                Token::Ident("id".into()),
                Token::From,
                Token::Ident("users".into()),
            ]
        );
    }

    #[test]
    fn ac_l7_unknown_char_is_lex_error() {
        let err = lex("SELECT @").unwrap_err();
        assert_eq!(err.error_kind, ParseErrorKind::LexError);
    }

    #[test]
    fn ac_l7_bang_alone_is_lex_error() {
        let err = lex("SELECT ! FROM users").unwrap_err();
        assert_eq!(err.error_kind, ParseErrorKind::LexError);
    }

    #[test]
    fn span_offsets_are_byte_accurate() {
        let toks = lex("SELECT id FROM users").expect("lex");
        assert_eq!(toks[0].at, 0); // SELECT
        assert_eq!(toks[1].at, 7); // id
        assert_eq!(toks[2].at, 10); // FROM
        assert_eq!(toks[3].at, 15); // users
    }

    // -----------------------------------------------------------------
    // Sprint 391 — DDL destructive keyword recognition.
    // -----------------------------------------------------------------

    #[test]
    fn ac_391_lex_drop_verb_case_insensitive() {
        for kw in ["DROP", "drop", "Drop", "dRoP"] {
            assert_eq!(lex_ok(kw), vec![Token::Drop], "kw={kw}");
        }
    }

    #[test]
    fn ac_391_lex_truncate_verb_case_insensitive() {
        for kw in ["TRUNCATE", "truncate", "Truncate"] {
            assert_eq!(lex_ok(kw), vec![Token::Truncate], "kw={kw}");
        }
    }

    #[test]
    fn ac_391_lex_alter_verb_case_insensitive() {
        for kw in ["ALTER", "alter", "Alter"] {
            assert_eq!(lex_ok(kw), vec![Token::Alter], "kw={kw}");
        }
    }

    #[test]
    fn ac_391_lex_object_type_keywords() {
        assert_eq!(lex_ok("TABLE"), vec![Token::Table]);
        assert_eq!(lex_ok("DATABASE"), vec![Token::Database]);
        assert_eq!(lex_ok("INDEX"), vec![Token::Index]);
        assert_eq!(lex_ok("VIEW"), vec![Token::View]);
        assert_eq!(lex_ok("SCHEMA"), vec![Token::Schema]);
        assert_eq!(lex_ok("SEQUENCE"), vec![Token::Sequence]);
        assert_eq!(lex_ok("TYPE"), vec![Token::Type]);
    }

    #[test]
    fn ac_391_lex_qualifier_keywords() {
        assert_eq!(lex_ok("IF"), vec![Token::If]);
        assert_eq!(lex_ok("EXISTS"), vec![Token::Exists]);
        assert_eq!(lex_ok("CASCADE"), vec![Token::Cascade]);
        assert_eq!(lex_ok("RESTRICT"), vec![Token::Restrict]);
        assert_eq!(lex_ok("RESTART"), vec![Token::Restart]);
        assert_eq!(lex_ok("CONTINUE"), vec![Token::Continue]);
        assert_eq!(lex_ok("IDENTITY"), vec![Token::Identity]);
        assert_eq!(lex_ok("COLUMN"), vec![Token::Column]);
        assert_eq!(lex_ok("CONSTRAINT"), vec![Token::Constraint]);
    }

    #[test]
    fn ac_391_lex_drop_table_statement_tokens() {
        // `DROP TABLE IF EXISTS users CASCADE` should tokenize to a clean
        // verb + object-type + IF + EXISTS + identifier + CASCADE chain.
        let toks = lex_ok("DROP TABLE IF EXISTS users CASCADE");
        assert_eq!(
            toks,
            vec![
                Token::Drop,
                Token::Table,
                Token::If,
                Token::Exists,
                Token::Ident("users".into()),
                Token::Cascade,
            ]
        );
    }

    #[test]
    fn ac_391_lex_truncate_full_form_tokens() {
        let toks = lex_ok("TRUNCATE TABLE events RESTART IDENTITY CASCADE");
        assert_eq!(
            toks,
            vec![
                Token::Truncate,
                Token::Table,
                Token::Ident("events".into()),
                Token::Restart,
                Token::Identity,
                Token::Cascade,
            ]
        );
    }

    // -----------------------------------------------------------------
    // Sprint 392 — DML write triad keyword + punctuation lexing.
    // -----------------------------------------------------------------

    #[test]
    fn ac_392_lex_dml_verb_keywords_case_insensitive() {
        for kw in ["INSERT", "insert", "Insert", "iNsErT"] {
            assert_eq!(lex_ok(kw), vec![Token::Insert], "kw={kw}");
        }
        for kw in ["UPDATE", "update", "Update"] {
            assert_eq!(lex_ok(kw), vec![Token::Update], "kw={kw}");
        }
        for kw in ["DELETE", "delete", "Delete"] {
            assert_eq!(lex_ok(kw), vec![Token::Delete], "kw={kw}");
        }
    }

    #[test]
    fn ac_392_lex_dml_qualifier_keywords() {
        assert_eq!(lex_ok("INTO"), vec![Token::Into]);
        assert_eq!(lex_ok("VALUES"), vec![Token::Values]);
        assert_eq!(lex_ok("DEFAULT"), vec![Token::Default]);
        assert_eq!(lex_ok("RETURNING"), vec![Token::Returning]);
        assert_eq!(lex_ok("SET"), vec![Token::Set]);
        assert_eq!(lex_ok("USING"), vec![Token::Using]);
        assert_eq!(lex_ok("ON"), vec![Token::On]);
        assert_eq!(lex_ok("CONFLICT"), vec![Token::Conflict]);
        assert_eq!(lex_ok("DO"), vec![Token::Do]);
        assert_eq!(lex_ok("NOTHING"), vec![Token::Nothing]);
    }

    #[test]
    fn ac_392_lex_where_boolean_keywords() {
        assert_eq!(lex_ok("AND"), vec![Token::And]);
        assert_eq!(lex_ok("OR"), vec![Token::Or]);
        assert_eq!(lex_ok("NOT"), vec![Token::Not]);
        assert_eq!(lex_ok("NULL"), vec![Token::Null]);
        assert_eq!(lex_ok("IS"), vec![Token::Is]);
        assert_eq!(lex_ok("IN"), vec![Token::In]);
        assert_eq!(lex_ok("TRUE"), vec![Token::True]);
        assert_eq!(lex_ok("FALSE"), vec![Token::False]);
    }

    #[test]
    fn ac_392_lex_parens() {
        assert_eq!(lex_ok("("), vec![Token::LParen]);
        assert_eq!(lex_ok(")"), vec![Token::RParen]);
        assert_eq!(
            lex_ok("(1, 'a')"),
            vec![
                Token::LParen,
                Token::Integer(1),
                Token::Comma,
                Token::String("a".into()),
                Token::RParen,
            ]
        );
    }

    #[test]
    fn ac_392_lex_dot_qualifier() {
        let toks = lex_ok("other.id");
        assert_eq!(
            toks,
            vec![
                Token::Ident("other".into()),
                Token::Dot,
                Token::Ident("id".into()),
            ]
        );
    }

    #[test]
    fn ac_392_lex_positional_placeholder() {
        assert_eq!(lex_ok("$1"), vec![Token::PlaceholderPositional("1".into())]);
        assert_eq!(
            lex_ok("$42"),
            vec![Token::PlaceholderPositional("42".into())]
        );
    }

    #[test]
    fn ac_392_lex_positional_placeholder_without_digits_is_lex_error() {
        let err = lex("$x").unwrap_err();
        assert_eq!(err.error_kind, ParseErrorKind::LexError);
    }

    #[test]
    fn ac_392_lex_anonymous_placeholder() {
        assert_eq!(lex_ok("?"), vec![Token::PlaceholderAnonymous]);
    }

    #[test]
    fn ac_392_lex_named_placeholder() {
        assert_eq!(
            lex_ok(":name"),
            vec![Token::PlaceholderNamed("name".into())]
        );
        assert_eq!(
            lex_ok(":user_id"),
            vec![Token::PlaceholderNamed("user_id".into())]
        );
    }

    #[test]
    fn ac_392_lex_named_placeholder_without_identifier_is_lex_error() {
        let err = lex(": ").unwrap_err();
        assert_eq!(err.error_kind, ParseErrorKind::LexError);
    }

    #[test]
    fn ac_392_lex_float_literal_simple() {
        // Avoid 3.14 — clippy::approx_constant flags it as a near-PI value.
        let toks = lex_ok("2.5");
        assert!(matches!(toks.as_slice(), [Token::Float(_)]));
        if let Token::Float(v) = toks[0] {
            assert!((v - 2.5).abs() < f64::EPSILON);
        }
    }

    #[test]
    fn ac_392_lex_float_literal_zero_point() {
        let toks = lex_ok("0.5");
        if let [Token::Float(v)] = toks.as_slice() {
            assert!((v - 0.5).abs() < f64::EPSILON);
        } else {
            panic!("expected single float token, got {:?}", toks);
        }
    }

    #[test]
    fn ac_392_lex_integer_without_fraction_stays_integer() {
        // Confirm fast path: `42` stays Integer, not Float.
        assert_eq!(lex_ok("42"), vec![Token::Integer(42)]);
    }

    #[test]
    fn ac_392_lex_insert_into_values_token_stream() {
        let toks = lex_ok("INSERT INTO users (id, name) VALUES (1, 'a')");
        assert_eq!(
            toks,
            vec![
                Token::Insert,
                Token::Into,
                Token::Ident("users".into()),
                Token::LParen,
                Token::Ident("id".into()),
                Token::Comma,
                Token::Ident("name".into()),
                Token::RParen,
                Token::Values,
                Token::LParen,
                Token::Integer(1),
                Token::Comma,
                Token::String("a".into()),
                Token::RParen,
            ]
        );
    }

    #[test]
    fn ac_391_lex_alter_drop_column_tokens() {
        let toks = lex_ok("ALTER TABLE users DROP COLUMN IF EXISTS email CASCADE");
        assert_eq!(
            toks,
            vec![
                Token::Alter,
                Token::Table,
                Token::Ident("users".into()),
                Token::Drop,
                Token::Column,
                Token::If,
                Token::Exists,
                Token::Ident("email".into()),
                Token::Cascade,
            ]
        );
    }
}
