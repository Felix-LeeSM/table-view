use crate::ast::{ParseError, ParseErrorKind};
use crate::lexer::Token;

/// Sprint-395 helper — best-effort textual form of a token for use as an
/// option name. Returns the user-written form for identifiers (preserving
/// case). `None` for tokens that have no meaningful text form (punctuation,
/// literals). Sprint-395's lexer leaves option-name words (`analyze`,
/// `verbose`, `format`, etc.) as `Token::Ident`, so the Ident arm covers
/// everything we need.
pub(super) fn token_word(tok: &Token) -> Option<&str> {
    match tok {
        Token::Ident(s) => Some(s.as_str()),
        _ => None,
    }
}

/// Cheap pre-lex scan: returns the first ASCII-alphanumeric/underscore
/// run together with its starting byte offset, or `None` if the input
/// has no such word. Only used to detect "non-SELECT verb at top of
/// statement" before the lexer (which may choke on later punctuation)
/// gets a chance.
pub(super) fn first_word(input: &str) -> Option<(String, usize)> {
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

pub(super) fn syntax_err(at: Option<usize>, msg: &str) -> ParseError {
    ParseError {
        error_kind: ParseErrorKind::SyntaxError,
        message: msg.to_string(),
        at,
    }
}

pub(super) fn is_known_sql_verb(name: &str) -> bool {
    matches!(
        name.to_ascii_uppercase().as_str(),
        "SELECT"
            | "INSERT"
            | "CALL"
            | "DO"
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
            | "SHOW"
            | "SET"
            | "COPY"
            | "COMMENT"
    )
}

/// Sprint-392 — the set of verbs whose grammar this crate actually
/// implements. Anything in `is_known_sql_verb` but not in here is an
/// `UnsupportedStatement`. Sprint-393b adds `WITH` (CTE wrap). Sprint-394
/// adds `CREATE` (TABLE / INDEX / VIEW) — `CREATE FUNCTION` /
/// `CREATE TRIGGER` etc. surface as `SyntaxError` from the dispatcher.
/// Sprint-395 adds GRANT / REVOKE / EXPLAIN / SHOW / SET / COPY / COMMENT.
/// Sprint-484 adds the narrow PostgreSQL MERGE first slice.
/// Sprint-485 keeps PostgreSQL DO blocks known-but-unsupported.
pub(super) fn is_supported_sql_verb(name: &str) -> bool {
    matches!(
        name.to_ascii_uppercase().as_str(),
        "SELECT"
            | "CALL"
            | "DROP"
            | "TRUNCATE"
            | "ALTER"
            | "INSERT"
            | "MERGE"
            | "UPDATE"
            | "DELETE"
            | "WITH"
            | "CREATE"
            | "GRANT"
            | "REVOKE"
            | "EXPLAIN"
            | "SHOW"
            | "SET"
            | "COPY"
            | "COMMENT"
    )
}

pub(super) fn unsupported_message(verb: &str) -> String {
    // Plain concat — `format!` is also fine since the panic infra
    // already brings in `fmt`. We keep this minimal but readable.
    let mut s = String::from("unsupported verb '");
    s.push_str(verb);
    s.push('\'');
    s
}
