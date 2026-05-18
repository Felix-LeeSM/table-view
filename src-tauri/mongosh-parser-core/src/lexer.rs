//! Hand-written character-level lexer for the sprint-401 mongosh grammar
//! slice. Mirrors `src/lib/mongo/mongoshAst/lexer.ts` (sprint-384) one-for-
//! one — same tokens, same comment / template / string rules, same head-
//! keyword sniff. Behavior parity is verified by `mongoshAst.test.ts` on
//! the frontend side.
//!
//! Design:
//! - No regex / nom / logos — hand-rolled keeps the WASM bundle minimal.
//! - Returns `Vec<Token>` or a `LexError` (a `MongoshStatement::Error`
//!   variant). Never panics on user-input paths.
//! - Identifier semantics are the JS-ish union of `[A-Za-z_$][A-Za-z0-9_$]*`
//!   — `$`-prefixed idents are valid (mongosh uses `$sum`, `$set`, ...).

use crate::ast::MongoshErrorKind;

#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    Ident(String),
    StringLit(String),
    NumberLit(f64),
    /// Single-char punctuation: `{` `}` `[` `]` `(` `)` `,` `:` `;` `.`
    Punct(char),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Spanned {
    pub token: Token,
    /// 0-based byte offset where this token starts.
    pub at: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LexError {
    pub error_kind: MongoshErrorKind,
    pub message: String,
}

const PUNCT_CHARS: &[char] = &['{', '}', '[', ']', '(', ')', ',', ':', ';', '.'];

/// Lex the input into a flat token stream. Whitespace and comments are
/// stripped; the parser never sees them.
pub fn lex(input: &str) -> Result<Vec<Spanned>, LexError> {
    // Operate on `chars` so multi-byte UTF-8 in string literals (`"héllo"`)
    // passes through cleanly. The vast majority of token boundaries are
    // single ASCII chars so the conversion cost is negligible.
    let chars: Vec<char> = input.chars().collect();
    let mut tokens: Vec<Spanned> = Vec::new();
    let mut i = 0usize;

    // Pre-compute char→byte offsets so spans match the original `&str`. The
    // TS side reports byte offsets too; matching keeps error messages
    // grep-able across the boundary.
    let byte_offsets = char_byte_offsets(input, chars.len());

    while i < chars.len() {
        let ch = chars[i];
        let at = byte_offsets[i];

        // Whitespace.
        if matches!(ch, ' ' | '\t' | '\n' | '\r') {
            i += 1;
            continue;
        }

        // Line comment `// ... \n`.
        if ch == '/' && chars.get(i + 1) == Some(&'/') {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }

        // Block comment `/* ... */` — non-nested (mongosh parity: the first
        // `*/` closes; any trailing junk surfaces as a parse error later).
        if ch == '/' && chars.get(i + 1) == Some(&'*') {
            i += 2;
            while i < chars.len() && !(chars[i] == '*' && chars.get(i + 1) == Some(&'/')) {
                i += 1;
            }
            if i >= chars.len() {
                return Err(lex_err("unterminated /* ... */ comment"));
            }
            i += 2;
            continue;
        }

        // Arrow function `=>` — explicit reject (sprint-382 invariant).
        if ch == '=' && chars.get(i + 1) == Some(&'>') {
            return Err(lex_err(
                "arrow functions (`=>`) are not supported \
                 — callbacks are outside scope",
            ));
        }

        // Template literal `` `...` `` — interpolation-free → string.
        if ch == '`' {
            let (value, consumed) = read_template(&chars, i)?;
            tokens.push(Spanned {
                token: Token::StringLit(value),
                at,
            });
            i += consumed;
            continue;
        }

        // Single- or double-quoted string.
        if ch == '"' || ch == '\'' {
            let (value, consumed) = read_string(&chars, i, ch)?;
            tokens.push(Spanned {
                token: Token::StringLit(value),
                at,
            });
            i += consumed;
            continue;
        }

        // Number literal — leading `-` only if followed by a digit, matches
        // TS lexer's branch.
        if ch == '-'
            && chars
                .get(i + 1)
                .map(|c| c.is_ascii_digit())
                .unwrap_or(false)
        {
            let (value, consumed) = read_number(&chars, i)?;
            tokens.push(Spanned {
                token: Token::NumberLit(value),
                at,
            });
            i += consumed;
            continue;
        }
        if ch.is_ascii_digit() {
            let (value, consumed) = read_number(&chars, i)?;
            tokens.push(Spanned {
                token: Token::NumberLit(value),
                at,
            });
            i += consumed;
            continue;
        }

        // Identifier (incl. `$`-prefixed).
        if is_ident_start(ch) {
            let mut j = i + 1;
            while j < chars.len() && is_ident_continue(chars[j]) {
                j += 1;
            }
            let name: String = chars[i..j].iter().collect();
            tokens.push(Spanned {
                token: Token::Ident(name),
                at,
            });
            i = j;
            continue;
        }

        if PUNCT_CHARS.contains(&ch) {
            tokens.push(Spanned {
                token: Token::Punct(ch),
                at,
            });
            i += 1;
            continue;
        }

        return Err(lex_err(&format!(
            "unexpected character `{}` at offset {}",
            ch, at
        )));
    }

    Ok(tokens)
}

fn read_string(chars: &[char], start: usize, quote: char) -> Result<(String, usize), LexError> {
    let mut i = start + 1;
    let mut out = String::new();
    while i < chars.len() {
        let ch = chars[i];
        if ch == '\\' {
            let next = match chars.get(i + 1) {
                Some(c) => *c,
                None => return Err(lex_err("unterminated string escape")),
            };
            if next == 'u' {
                // \uXXXX — exactly 4 hex digits.
                if i + 5 >= chars.len() {
                    return Err(lex_err("invalid \\u escape in string"));
                }
                let hex: String = chars[i + 2..i + 6].iter().collect();
                if !hex.chars().all(|c| c.is_ascii_hexdigit()) || hex.len() != 4 {
                    return Err(lex_err("invalid \\u escape in string"));
                }
                let code = u32::from_str_radix(&hex, 16)
                    .map_err(|_| lex_err("invalid \\u escape in string"))?;
                if let Some(c) = char::from_u32(code) {
                    out.push(c);
                } else {
                    // TS `String.fromCharCode` accepts surrogates; we accept
                    // by emitting `\u{FFFD}` (replacement) for unpaired
                    // surrogates so the lexer never errors on input the TS
                    // side would have accepted.
                    out.push('\u{FFFD}');
                }
                i += 6;
                continue;
            }
            let mapped = match next {
                'n' => '\n',
                'r' => '\r',
                't' => '\t',
                'b' => '\u{0008}',
                'f' => '\u{000C}',
                '\\' => '\\',
                '\'' => '\'',
                '"' => '"',
                '/' => '/',
                other => other,
            };
            out.push(mapped);
            i += 2;
            continue;
        }
        if ch == quote {
            return Ok((out, i + 1 - start));
        }
        out.push(ch);
        i += 1;
    }
    Err(lex_err("unterminated string literal"))
}

fn read_template(chars: &[char], start: usize) -> Result<(String, usize), LexError> {
    let mut i = start + 1;
    let mut out = String::new();
    while i < chars.len() {
        let ch = chars[i];
        if ch == '\\' {
            let next = match chars.get(i + 1) {
                Some(c) => *c,
                None => return Err(lex_err("unterminated template literal escape")),
            };
            let mapped = match next {
                'n' => '\n',
                'r' => '\r',
                't' => '\t',
                '\\' => '\\',
                '`' => '`',
                '$' => '$',
                other => other,
            };
            out.push(mapped);
            i += 2;
            continue;
        }
        if ch == '$' && chars.get(i + 1) == Some(&'{') {
            return Err(lex_err(
                "template literal interpolation (`${...}`) is not supported \
                 — use string concatenation downstream",
            ));
        }
        if ch == '`' {
            return Ok((out, i + 1 - start));
        }
        out.push(ch);
        i += 1;
    }
    Err(lex_err("unterminated template literal"))
}

fn read_number(chars: &[char], start: usize) -> Result<(f64, usize), LexError> {
    let mut j = start;
    if chars[j] == '-' {
        j += 1;
    }
    while j < chars.len() && chars[j].is_ascii_digit() {
        j += 1;
    }
    if chars.get(j) == Some(&'.') {
        j += 1;
        while j < chars.len() && chars[j].is_ascii_digit() {
            j += 1;
        }
    }
    if let Some(&e) = chars.get(j) {
        if e == 'e' || e == 'E' {
            j += 1;
            if let Some(&sign) = chars.get(j) {
                if sign == '+' || sign == '-' {
                    j += 1;
                }
            }
            while j < chars.len() && chars[j].is_ascii_digit() {
                j += 1;
            }
        }
    }
    let slice: String = chars[start..j].iter().collect();
    let value = slice
        .parse::<f64>()
        .map_err(|_| lex_err("internal: invalid numeric literal"))?;
    Ok((value, j - start))
}

fn is_ident_start(ch: char) -> bool {
    ch.is_ascii_alphabetic() || ch == '_' || ch == '$'
}

fn is_ident_continue(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_' || ch == '$'
}

fn char_byte_offsets(input: &str, n_chars: usize) -> Vec<usize> {
    // Map char-index → byte-offset so we can report TS-comparable spans.
    // Allocates `n_chars + 1` to allow a one-past-end probe.
    let mut offsets = Vec::with_capacity(n_chars + 1);
    for (b, _) in input.char_indices() {
        offsets.push(b);
    }
    offsets.push(input.len());
    offsets
}

fn lex_err(msg: &str) -> LexError {
    LexError {
        error_kind: MongoshErrorKind::UnsupportedSyntax,
        message: msg.to_string(),
    }
}

// ---------------------------------------------------------------------------
// Top-level semicolon scan + identifier-only sniff helpers used by parser.
// ---------------------------------------------------------------------------

/// Returns the *indices* (into the token vector) of every top-level `;` —
/// those that appear at brace/bracket/paren depth 0. The parser uses this
/// to decide whether the input is a single statement or a multi-statement
/// chain.
pub fn top_level_semicolons(tokens: &[Spanned]) -> Vec<usize> {
    let mut out = Vec::new();
    let mut depth: i32 = 0;
    for (i, sp) in tokens.iter().enumerate() {
        match &sp.token {
            Token::Punct('(') | Token::Punct('[') | Token::Punct('{') => depth += 1,
            Token::Punct(')') | Token::Punct(']') | Token::Punct('}') => depth -= 1,
            Token::Punct(';') if depth == 0 => out.push(i),
            _ => {}
        }
    }
    out
}

/// Stringify a token for inclusion in user-visible error messages — matches
/// the TS `describeToken` helper.
pub fn describe_token(tok: &Token) -> String {
    match tok {
        Token::StringLit(s) => format!("\"{}\"", s),
        Token::NumberLit(n) => format_number_for_message(*n),
        Token::Ident(s) => s.clone(),
        Token::Punct(c) => c.to_string(),
    }
}

fn format_number_for_message(n: f64) -> String {
    // Match JS's `String(n)` behavior for integer-valued floats: emit `1`
    // not `1.0`. Anything else falls back to Rust's default.
    if n.is_finite() && n.fract() == 0.0 && n.abs() < 1e16 {
        format!("{}", n as i64)
    } else {
        format!("{}", n)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lex_tokens(input: &str) -> Vec<Token> {
        lex(input)
            .expect("lex")
            .into_iter()
            .map(|s| s.token)
            .collect()
    }

    #[test]
    fn ac_l1_idents_strings_numbers_puncts() {
        assert_eq!(lex_tokens("db"), vec![Token::Ident("db".into())]);
        assert_eq!(
            lex_tokens("\"hello\""),
            vec![Token::StringLit("hello".into())]
        );
        assert_eq!(lex_tokens("'x'"), vec![Token::StringLit("x".into())]);
        assert_eq!(lex_tokens("42"), vec![Token::NumberLit(42.0)]);
        assert_eq!(lex_tokens("-3"), vec![Token::NumberLit(-3.0)]);
        assert_eq!(lex_tokens("1.5"), vec![Token::NumberLit(1.5)]);
        assert_eq!(lex_tokens("2e3"), vec![Token::NumberLit(2000.0)]);
        assert_eq!(lex_tokens("("), vec![Token::Punct('(')]);
    }

    #[test]
    fn ac_l2_line_comment_stripped() {
        let toks = lex_tokens("// hi\ndb");
        assert_eq!(toks, vec![Token::Ident("db".into())]);
    }

    #[test]
    fn ac_l3_block_comment_stripped() {
        let toks = lex_tokens("/* hi */db");
        assert_eq!(toks, vec![Token::Ident("db".into())]);
    }

    #[test]
    fn ac_l3_block_comment_unterminated_errors() {
        let err = lex("/* never closed").unwrap_err();
        assert_eq!(err.error_kind, MongoshErrorKind::UnsupportedSyntax);
        assert!(err.message.contains("unterminated"));
    }

    #[test]
    fn ac_l4_template_interpolation_free_is_string() {
        assert_eq!(
            lex_tokens("`hello`"),
            vec![Token::StringLit("hello".into())]
        );
    }

    #[test]
    fn ac_l5_template_interpolation_rejected() {
        let err = lex("`hello ${x}`").unwrap_err();
        assert!(err.message.contains("interpolation"));
    }

    #[test]
    fn ac_l6_arrow_rejected() {
        let err = lex("d => d.name").unwrap_err();
        assert!(err.message.contains("arrow"));
    }

    #[test]
    fn ac_l7_unterminated_string_errors() {
        let err = lex("\"never closed").unwrap_err();
        assert!(err.message.contains("unterminated"));
    }

    #[test]
    fn dollar_idents_ok() {
        assert_eq!(lex_tokens("$sum"), vec![Token::Ident("$sum".into())]);
    }

    #[test]
    fn unicode_escape_in_string() {
        assert_eq!(
            lex_tokens("\"\\u0041B\""),
            vec![Token::StringLit("AB".into())]
        );
    }

    #[test]
    fn top_level_semicolons_finds_correct_indices() {
        let tokens = lex("a; b").unwrap();
        let semis = top_level_semicolons(&tokens);
        assert_eq!(semis, vec![1]);
    }

    #[test]
    fn nested_semicolons_ignored() {
        let tokens = lex("[1;2]").unwrap();
        let semis = top_level_semicolons(&tokens);
        assert!(semis.is_empty());
    }
}
