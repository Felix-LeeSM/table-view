//! Recursive-descent parser for the sprint-385 grammar slice.
//!
//! Grammar (EBNF-ish):
//!   stmt        = "SELECT" columns "FROM" identifier [ "WHERE" predicate ]
//!   columns     = "*" | identifier { "," identifier }
//!   predicate   = identifier op literal
//!   op          = "=" | "<>" | "!=" | "<" | ">" | "<=" | ">="
//!   literal     = integer | string
//!
//! On any deviation the parser returns a `ParseError` variant — never a
//! Rust panic. The `kind` field distinguishes:
//!
//! - `EmptyInput` — caller passed `""` or whitespace-only.
//! - `UnsupportedStatement` — first keyword is one we recognize (INSERT /
//!   UPDATE / DELETE / …) but is out of scope for sprint-385.
//! - `SyntaxError` — everything else (wrong order, missing FROM, missing
//!   table, extra trailing tokens, …).
//! - `LexError` — surfaced verbatim from `lexer::lex`.

use crate::ast::{
    BinaryOp, Columns, Literal, ParseError, ParseErrorKind, ParseResult, SelectStatement,
    WhereClause,
};
use crate::lexer::{lex, Spanned, Token};

/// Entry point. Lex + parse + verify "no trailing tokens" in one shot.
/// Always returns `ParseResult` (never `Err`) — errors are a tagged
/// variant of the union so the WASM/IPC bridge can serialize uniformly.
pub fn parse(input: &str) -> ParseResult {
    if input.trim().is_empty() {
        return ParseResult::Error(ParseError {
            error_kind: ParseErrorKind::EmptyInput,
            message: "input is empty".to_string(),
            at: None,
        });
    }

    // Pre-scan: if the first non-whitespace word is a known SQL verb
    // other than SELECT, short-circuit with `UnsupportedStatement`
    // BEFORE handing the input to the lexer. This matters because the
    // lexer chokes on punctuation we don't support (`(`, `)`), so e.g.
    // `INSERT INTO users VALUES (1)` would otherwise surface as
    // `LexError` instead of the more informative `UnsupportedStatement`.
    if let Some((verb, at)) = first_word(input) {
        let upper = verb.to_ascii_uppercase();
        if upper != "SELECT" && is_known_sql_verb(&upper) {
            return ParseResult::Error(ParseError {
                error_kind: ParseErrorKind::UnsupportedStatement,
                message: format!(
                    "sprint-385 only supports SELECT; got '{}' (other DML/DDL is sprint-386+)",
                    verb
                ),
                at: Some(at),
            });
        }
    }

    let tokens = match lex(input) {
        Ok(t) => t,
        Err(e) => return ParseResult::Error(e),
    };

    if tokens.is_empty() {
        // `lex` may strip everything (e.g. just a `;`). Treat as empty
        // input — same surface as `parse_sql("")`.
        return ParseResult::Error(ParseError {
            error_kind: ParseErrorKind::EmptyInput,
            message: "no tokens after stripping whitespace/semicolons".to_string(),
            at: None,
        });
    }

    let mut p = Parser::new(&tokens);
    match p.parse_statement() {
        Ok(stmt) => {
            // Reject extra trailing tokens — sprint-385 is strictly
            // one statement per call. Tighter error than letting the
            // caller silently lose the tail.
            if p.cursor < tokens.len() {
                let at = tokens[p.cursor].at;
                return ParseResult::Error(ParseError {
                    error_kind: ParseErrorKind::SyntaxError,
                    message: "unexpected trailing tokens after SELECT statement".to_string(),
                    at: Some(at),
                });
            }
            ParseResult::Select(stmt)
        }
        Err(e) => ParseResult::Error(e),
    }
}

struct Parser<'a> {
    tokens: &'a [Spanned],
    cursor: usize,
}

impl<'a> Parser<'a> {
    fn new(tokens: &'a [Spanned]) -> Self {
        Self { tokens, cursor: 0 }
    }

    fn peek(&self) -> Option<&Spanned> {
        self.tokens.get(self.cursor)
    }

    fn advance(&mut self) -> Option<&Spanned> {
        let t = self.tokens.get(self.cursor);
        if t.is_some() {
            self.cursor += 1;
        }
        t
    }

    fn parse_statement(&mut self) -> Result<SelectStatement, ParseError> {
        // First-token check. If it's not SELECT but is a different
        // recognizable SQL verb (INSERT / UPDATE / DELETE / CREATE /
        // DROP / ALTER / TRUNCATE / …), label it `UnsupportedStatement`
        // so callers can distinguish "we know this SQL but don't
        // implement it" from "syntactically broken".
        let first = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected SELECT, got end of input"))?;

        match &first.token {
            Token::Select => {
                self.advance();
            }
            Token::Ident(name) => {
                let kind = if is_known_sql_verb(name) {
                    ParseErrorKind::UnsupportedStatement
                } else {
                    ParseErrorKind::SyntaxError
                };
                return Err(ParseError {
                    error_kind: kind,
                    message: format!(
                        "sprint-385 only supports SELECT; got '{}' (other DML/DDL is sprint-386+)",
                        name
                    ),
                    at: Some(first.at),
                });
            }
            _ => {
                return Err(syntax_err(
                    Some(first.at),
                    "expected SELECT at start of statement",
                ));
            }
        }

        let columns = self.parse_columns()?;

        // FROM
        let from_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected FROM after column list"))?;
        if from_tok.token != Token::From {
            return Err(syntax_err(
                Some(from_tok.at),
                "expected FROM keyword after column list",
            ));
        }
        self.advance();

        // table name
        let table_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected table name after FROM"))?;
        let table = match &table_tok.token {
            Token::Ident(name) => name.clone(),
            _ => {
                return Err(syntax_err(
                    Some(table_tok.at),
                    "expected table identifier after FROM",
                ));
            }
        };
        self.advance();

        // Optional WHERE.
        let where_clause = if matches!(self.peek().map(|t| &t.token), Some(Token::Where)) {
            self.advance();
            Some(self.parse_where()?)
        } else {
            None
        };

        Ok(SelectStatement {
            columns,
            table,
            where_clause,
        })
    }

    fn parse_columns(&mut self) -> Result<Columns, ParseError> {
        let first = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected column list after SELECT"))?;
        if first.token == Token::Star {
            self.advance();
            return Ok(Columns::Star);
        }

        let mut names: Vec<String> = Vec::new();
        loop {
            let tok = self
                .peek()
                .ok_or_else(|| syntax_err(None, "expected column identifier"))?;
            match &tok.token {
                Token::Ident(name) => {
                    names.push(name.clone());
                    self.advance();
                }
                _ => {
                    return Err(syntax_err(Some(tok.at), "expected column identifier"));
                }
            }
            // Trailing comma → another column. Anything else → end of list.
            if matches!(self.peek().map(|t| &t.token), Some(Token::Comma)) {
                self.advance();
            } else {
                break;
            }
        }
        Ok(Columns::Named { names })
    }

    fn parse_where(&mut self) -> Result<WhereClause, ParseError> {
        // identifier
        let col_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected column identifier after WHERE"))?;
        let column = match &col_tok.token {
            Token::Ident(name) => name.clone(),
            _ => {
                return Err(syntax_err(
                    Some(col_tok.at),
                    "expected column identifier after WHERE",
                ));
            }
        };
        self.advance();

        // op
        let op_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected comparison operator after column"))?;
        let op = match op_tok.token {
            Token::Eq => BinaryOp::Eq,
            Token::NotEq => BinaryOp::NotEq,
            Token::BangEq => BinaryOp::BangEq,
            Token::Lt => BinaryOp::Lt,
            Token::Gt => BinaryOp::Gt,
            Token::LtEq => BinaryOp::LtEq,
            Token::GtEq => BinaryOp::GtEq,
            _ => {
                return Err(syntax_err(
                    Some(op_tok.at),
                    "expected one of =, <>, !=, <, >, <=, >=",
                ));
            }
        };
        self.advance();

        // literal
        let lit_tok = self
            .peek()
            .ok_or_else(|| syntax_err(None, "expected literal after comparison operator"))?;
        let literal = match &lit_tok.token {
            Token::Integer(v) => Literal::Integer { value: *v },
            Token::String(s) => Literal::String { value: s.clone() },
            _ => {
                return Err(syntax_err(
                    Some(lit_tok.at),
                    "expected integer or string literal",
                ));
            }
        };
        self.advance();

        Ok(WhereClause {
            column,
            op,
            literal,
        })
    }
}

/// Cheap pre-lex scan: returns the first ASCII-alphanumeric/underscore
/// run together with its starting byte offset, or `None` if the input
/// has no such word. Only used to detect "non-SELECT verb at top of
/// statement" before the lexer (which may choke on later punctuation)
/// gets a chance.
fn first_word(input: &str) -> Option<(String, usize)> {
    let bytes = input.as_bytes();
    let mut i = 0usize;
    while i < bytes.len()
        && (bytes[i] == b' ' || bytes[i] == b'\t' || bytes[i] == b'\n' || bytes[i] == b'\r')
    {
        i += 1;
    }
    let start = i;
    while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
        i += 1;
    }
    if i == start {
        None
    } else {
        std::str::from_utf8(&bytes[start..i])
            .ok()
            .map(|s| (s.to_string(), start))
    }
}

fn syntax_err(at: Option<usize>, msg: &str) -> ParseError {
    ParseError {
        error_kind: ParseErrorKind::SyntaxError,
        message: msg.to_string(),
        at,
    }
}

fn is_known_sql_verb(name: &str) -> bool {
    matches!(
        name.to_ascii_uppercase().as_str(),
        "INSERT"
            | "UPDATE"
            | "DELETE"
            | "CREATE"
            | "DROP"
            | "ALTER"
            | "TRUNCATE"
            | "GRANT"
            | "REVOKE"
            | "EXPLAIN"
            | "WITH"
            | "MERGE"
            | "REPLACE"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok_select(input: &str) -> SelectStatement {
        match parse(input) {
            ParseResult::Select(s) => s,
            ParseResult::Error(e) => panic!("expected Select, got error: {:?}", e),
        }
    }

    fn err(input: &str) -> ParseError {
        match parse(input) {
            ParseResult::Select(s) => panic!("expected error, got Select: {:?}", s),
            ParseResult::Error(e) => e,
        }
    }

    #[test]
    fn ac_p1_select_star_from_users() {
        let s = ok_select("SELECT * FROM users");
        assert_eq!(s.columns, Columns::Star);
        assert_eq!(s.table, "users");
        assert!(s.where_clause.is_none());
    }

    #[test]
    fn ac_p2_select_named_columns() {
        let s = ok_select("SELECT id, name FROM users");
        assert_eq!(
            s.columns,
            Columns::Named {
                names: vec!["id".into(), "name".into()]
            }
        );
        assert_eq!(s.table, "users");
    }

    #[test]
    fn ac_p2_single_named_column() {
        let s = ok_select("SELECT id FROM users");
        assert_eq!(
            s.columns,
            Columns::Named {
                names: vec!["id".into()]
            }
        );
    }

    #[test]
    fn ac_p3_where_integer_literal() {
        let s = ok_select("SELECT id FROM users WHERE id = 42");
        let w = s.where_clause.expect("WHERE");
        assert_eq!(w.column, "id");
        assert_eq!(w.op, BinaryOp::Eq);
        assert_eq!(w.literal, Literal::Integer { value: 42 });
    }

    #[test]
    fn ac_p4_where_string_literal() {
        let s = ok_select("SELECT id FROM users WHERE name = 'felix'");
        let w = s.where_clause.expect("WHERE");
        assert_eq!(w.column, "name");
        assert_eq!(w.op, BinaryOp::Eq);
        assert_eq!(
            w.literal,
            Literal::String {
                value: "felix".into()
            }
        );
    }

    #[test]
    fn ac_p5_all_seven_ops() {
        let ops = [
            ("=", BinaryOp::Eq),
            ("<>", BinaryOp::NotEq),
            ("!=", BinaryOp::BangEq),
            ("<", BinaryOp::Lt),
            (">", BinaryOp::Gt),
            ("<=", BinaryOp::LtEq),
            (">=", BinaryOp::GtEq),
        ];
        for (sym, expected) in ops {
            let sql = format!("SELECT id FROM users WHERE id {} 1", sym);
            let s = ok_select(&sql);
            let w = s.where_clause.expect("WHERE");
            assert_eq!(w.op, expected, "op={sym}");
        }
    }

    #[test]
    fn ac_p6_missing_from_is_syntax_error() {
        let e = err("SELECT * users");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
        assert!(e.message.to_lowercase().contains("from"));
    }

    #[test]
    fn ac_p7_missing_table_after_from_is_syntax_error() {
        let e = err("SELECT * FROM");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn ac_p8_insert_is_unsupported_statement() {
        let e = err("INSERT INTO users VALUES (1)");
        assert_eq!(e.error_kind, ParseErrorKind::UnsupportedStatement);
    }

    #[test]
    fn ac_p8_update_is_unsupported_statement() {
        let e = err("UPDATE users SET name = 'x'");
        assert_eq!(e.error_kind, ParseErrorKind::UnsupportedStatement);
    }

    #[test]
    fn ac_p8_delete_is_unsupported_statement() {
        let e = err("DELETE FROM users");
        assert_eq!(e.error_kind, ParseErrorKind::UnsupportedStatement);
    }

    #[test]
    fn ac_p9_empty_input_is_empty_input_kind() {
        assert_eq!(err("").error_kind, ParseErrorKind::EmptyInput);
        assert_eq!(err("   ").error_kind, ParseErrorKind::EmptyInput);
        assert_eq!(err(";").error_kind, ParseErrorKind::EmptyInput);
    }

    #[test]
    fn ac_p10_trailing_semicolon_accepted() {
        let s = ok_select("SELECT * FROM users;");
        assert_eq!(s.columns, Columns::Star);
        assert_eq!(s.table, "users");
    }

    #[test]
    fn extra_trailing_tokens_rejected() {
        let e = err("SELECT * FROM users garbage");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
        assert!(e.message.to_lowercase().contains("trailing"));
    }

    #[test]
    fn unknown_first_keyword_is_syntax_error_not_unsupported() {
        // `FOO BAR` is not a known SQL verb — it's syntactically broken.
        let e = err("FOO BAR");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }

    #[test]
    fn where_requires_literal_not_identifier() {
        // `WHERE a = b` is parser-time SyntaxError — sprint-385 does not
        // support column-to-column comparison.
        let e = err("SELECT * FROM t WHERE a = b");
        assert_eq!(e.error_kind, ParseErrorKind::SyntaxError);
    }
}
