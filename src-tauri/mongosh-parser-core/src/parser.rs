//! Recursive-descent parser for the sprint-401 mongosh grammar slice.
//! Mirrors `src/lib/mongo/mongoshAst/parser.ts` (sprint-384) one-for-one.
//!
//! The parser is split into three layers:
//!   - `parse_program` — admin-command vs collection-command discrimination.
//!   - `parse_value` — object / array / literal / BSON-call.
//!   - `parse_arg_list` — shared between collection-method args and chain
//!     methods (`.sort({...}).limit(N)`).
//!
//! On any deviation we return a `MongoshStatement::Error` variant — never a
//! Rust panic. `errorKind` distinguishes UI-surfaceable categories so the
//! toolbar can render targeted messages.

use crate::ast::{AdminCommandName, MongoshErrorKind, MongoshStatement};
use crate::lexer::{describe_token, lex, top_level_semicolons, Spanned, Token};
use serde_json::{Map, Number, Value as JsonValue};

const BSON_LITERAL_NAMES: &[&str] = &[
    "ObjectId",
    "ISODate",
    "UUID",
    "NumberLong",
    "NumberDecimal",
    "BinData",
    "Decimal128",
];

// `(name, placeholderKey)` — exactly the same 5-entry table as the TS
// `BSON_PLACEHOLDER_KEY` constant.
const BSON_PLACEHOLDER_KEYS: &[(&str, &str)] = &[
    ("ObjectId", "$oid"),
    ("ISODate", "$date"),
    ("NumberLong", "$numberLong"),
    ("Decimal128", "$numberDecimal"),
    ("UUID", "$uuid"),
];

fn bson_placeholder(name: &str) -> Option<&'static str> {
    BSON_PLACEHOLDER_KEYS
        .iter()
        .find_map(|(n, key)| if *n == name { Some(*key) } else { None })
}

fn bson_coerce_to_string(name: &str) -> bool {
    matches!(name, "NumberLong" | "Decimal128")
}

const VARIABLE_DECL_KEYWORDS: &[&str] = &["var", "let", "const"];
const FUNCTION_KEYWORDS: &[&str] = &["function", "class"];
const CONTROL_FLOW_KEYWORDS: &[&str] = &["for", "while", "if", "return", "switch"];
const SHELL_HELPER_KEYWORDS: &[&str] = &["use", "show"];

/// Public entry — parse one mongosh statement.
pub fn parse(input: &str) -> MongoshStatement {
    // Head-keyword sniff *before* tokenization. `let x = 1` would otherwise
    // hit `=` (not a recognized punct token) and bubble up as a generic
    // lex error, swallowing the more useful errorKind. We strip leading
    // comments / whitespace and inspect the first identifier.
    if let Some(sniff_err) = sniff_head_keyword(input) {
        return sniff_err;
    }

    let tokens = match lex(input) {
        Ok(t) => t,
        Err(e) => {
            return MongoshStatement::Error {
                error_kind: e.error_kind,
                message: e.message,
            };
        }
    };

    if tokens.is_empty() {
        return err(MongoshErrorKind::UnsupportedSyntax, "expression is empty");
    }

    // Top-level `;` — multi-statement detection.
    let semicolons = top_level_semicolons(&tokens);
    let mut tokens = tokens;
    if !semicolons.is_empty() {
        let last_semi = *semicolons.last().expect("non-empty");
        let after_last = tokens.len() - last_semi - 1;
        if semicolons.len() > 1 || after_last > 0 {
            // Variable / function declaration takes precedence so the message
            // points at the actual issue.
            if let Some(head) = tokens.first() {
                if let Token::Ident(name) = &head.token {
                    if VARIABLE_DECL_KEYWORDS.contains(&name.as_str()) {
                        return variable_declaration_error(name);
                    }
                    if name == "function" {
                        return function_declaration_error();
                    }
                }
            }
            return err(
                MongoshErrorKind::MultipleStatements,
                "multiple statements separated by `;` are not supported \
                 — submit one mongosh expression at a time",
            );
        }
        // Lone trailing `;` — drop it.
        tokens.pop();
    }

    let mut stream = Stream::new(&tokens);
    parse_program(&mut stream)
}

struct Stream<'a> {
    tokens: &'a [Spanned],
    cursor: usize,
}

impl<'a> Stream<'a> {
    fn new(tokens: &'a [Spanned]) -> Self {
        Self { tokens, cursor: 0 }
    }

    fn peek(&self) -> Option<&Spanned> {
        self.tokens.get(self.cursor)
    }

    fn next(&mut self) -> Option<&Spanned> {
        let t = self.tokens.get(self.cursor);
        if t.is_some() {
            self.cursor += 1;
        }
        t
    }

    fn at_end(&self) -> bool {
        self.cursor >= self.tokens.len()
    }

    fn consume_punct(&mut self, c: char) -> bool {
        match self.peek().map(|s| &s.token) {
            Some(Token::Punct(p)) if *p == c => {
                self.cursor += 1;
                true
            }
            _ => false,
        }
    }
}

fn parse_program(stream: &mut Stream<'_>) -> MongoshStatement {
    let head = match stream.peek() {
        Some(h) => h.clone(),
        None => return err(MongoshErrorKind::UnsupportedSyntax, "expression is empty"),
    };

    if let Token::Ident(name) = &head.token {
        if VARIABLE_DECL_KEYWORDS.contains(&name.as_str()) {
            return variable_declaration_error(name);
        }
        if FUNCTION_KEYWORDS.contains(&name.as_str()) {
            return function_declaration_error();
        }
        if CONTROL_FLOW_KEYWORDS.contains(&name.as_str()) {
            return err(
                MongoshErrorKind::UnsupportedSyntax,
                &format!("{} control flow is not supported in the query tab", name),
            );
        }
        if SHELL_HELPER_KEYWORDS.contains(&name.as_str()) {
            return err(
                MongoshErrorKind::UnsupportedSyntax,
                "shell helpers (`use`, `show`) are not supported \
                 — type a `db....` expression",
            );
        }
    }

    let head_is_db = matches!(&head.token, Token::Ident(n) if n == "db");
    if !head_is_db {
        return err(
            MongoshErrorKind::NonDbStatement,
            "expression must begin with `db.<...>` \
             — bare expressions / literals are not run from the query tab",
        );
    }
    stream.next(); // consume `db`

    if !stream.consume_punct('.') {
        return err(
            MongoshErrorKind::UnsupportedSyntax,
            "expected `.` after `db`",
        );
    }

    let first_tok = match stream.next() {
        Some(t) => t.clone(),
        None => {
            return err(
                MongoshErrorKind::UnsupportedSyntax,
                "expected an identifier after `db.` (collection name or `runCommand` / `adminCommand`)",
            );
        }
    };
    let first_name = match &first_tok.token {
        Token::Ident(n) => n.clone(),
        _ => {
            return err(
                MongoshErrorKind::UnsupportedSyntax,
                "expected an identifier after `db.` (collection name or `runCommand` / `adminCommand`)",
            );
        }
    };

    if first_name == "runCommand" || first_name == "adminCommand" {
        let command_name = if first_name == "runCommand" {
            AdminCommandName::RunCommand
        } else {
            AdminCommandName::AdminCommand
        };
        return parse_admin_command(stream, &first_name, command_name);
    }

    parse_collection_command(stream, &first_name)
}

fn parse_admin_command(
    stream: &mut Stream<'_>,
    command_str: &str,
    command_name: AdminCommandName,
) -> MongoshStatement {
    if !stream.consume_punct('(') {
        return err(
            MongoshErrorKind::UnsupportedSyntax,
            &format!("expected `(` after `{}`", command_str),
        );
    }
    if stream.consume_punct(')') {
        return err(
            MongoshErrorKind::UnsupportedSyntax,
            &format!(
                "{}() requires a body object — got an empty argument list",
                command_str
            ),
        );
    }
    // First arg MUST be an object literal.
    match stream.peek().map(|s| &s.token) {
        Some(Token::Punct('{')) => {}
        _ => {
            return err(
                MongoshErrorKind::UnsupportedSyntax,
                &format!(
                    "{}(...) body must be an object literal like `{{ping: 1}}`",
                    command_str
                ),
            );
        }
    }
    let body = match parse_value(stream) {
        Ok(v) => v,
        Err(e) => return e,
    };
    if !body.is_object() {
        return err(
            MongoshErrorKind::UnsupportedSyntax,
            &format!("{}(...) body must be an object literal", command_str),
        );
    }
    // Tolerate trailing comma.
    stream.consume_punct(',');
    if !stream.consume_punct(')') {
        return err(
            MongoshErrorKind::UnsupportedSyntax,
            &format!("{}(...) accepts exactly one body argument", command_str),
        );
    }
    if !stream.at_end() {
        return err(
            MongoshErrorKind::UnsupportedSyntax,
            "unexpected trailing input after admin command",
        );
    }
    MongoshStatement::AdminCommand { command_name, body }
}

fn parse_collection_command(stream: &mut Stream<'_>, collection: &str) -> MongoshStatement {
    if !stream.consume_punct('.') {
        return err(
            MongoshErrorKind::UnsupportedSyntax,
            "expected `.` after the collection name",
        );
    }
    let method_tok = match stream.next() {
        Some(t) => t.clone(),
        None => {
            return err(
                MongoshErrorKind::UnsupportedSyntax,
                "expected a method name after the collection",
            );
        }
    };
    let method = match &method_tok.token {
        Token::Ident(n) => n.clone(),
        _ => {
            return err(
                MongoshErrorKind::UnsupportedSyntax,
                "expected a method name after the collection",
            );
        }
    };
    let args = match parse_arg_list(stream, &method) {
        Ok(a) => a,
        Err(e) => return e,
    };
    // Chain methods: parsed but their args are discarded (TS parity —
    // the Phase 28 dispatcher honors only the first method on a
    // collection; chain semantics go through the server-side aggregate
    // pipeline).
    while stream.consume_punct('.') {
        let chain_tok = match stream.next() {
            Some(t) => t.clone(),
            None => {
                return err(
                    MongoshErrorKind::UnsupportedSyntax,
                    "expected a chain method name after `.`",
                );
            }
        };
        let chain_name = match &chain_tok.token {
            Token::Ident(n) => n.clone(),
            _ => {
                return err(
                    MongoshErrorKind::UnsupportedSyntax,
                    "expected a chain method name after `.`",
                );
            }
        };
        if let Err(e) = parse_arg_list(stream, &chain_name) {
            return e;
        }
    }
    if !stream.at_end() {
        return err(
            MongoshErrorKind::UnsupportedSyntax,
            "unexpected trailing input after collection command",
        );
    }
    MongoshStatement::CollectionCommand {
        collection: collection.to_string(),
        method,
        args,
    }
}

// ---------------------------------------------------------------------------
// argList — shared between main args and chain args.
// ---------------------------------------------------------------------------

fn parse_arg_list(
    stream: &mut Stream<'_>,
    method_name: &str,
) -> Result<Vec<JsonValue>, MongoshStatement> {
    if !stream.consume_punct('(') {
        return Err(err(
            MongoshErrorKind::UnsupportedSyntax,
            &format!("expected `(` after method `{}`", method_name),
        ));
    }
    let mut args: Vec<JsonValue> = Vec::new();
    if stream.consume_punct(')') {
        return Ok(args);
    }
    loop {
        let v = parse_value(stream)?;
        args.push(v);
        if stream.consume_punct(',') {
            // Tolerate trailing comma before `)`.
            if stream.consume_punct(')') {
                return Ok(args);
            }
            continue;
        }
        if stream.consume_punct(')') {
            return Ok(args);
        }
        let stray = stream.peek().map(|s| describe_token(&s.token));
        return Err(err(
            MongoshErrorKind::UnsupportedSyntax,
            &match stray {
                Some(s) => format!("expected `,` or `)` in argument list, got `{}`", s),
                None => "unterminated argument list".to_string(),
            },
        ));
    }
}

// ---------------------------------------------------------------------------
// Value parser — object / array / scalar / BSON literal.
// ---------------------------------------------------------------------------

fn parse_value(stream: &mut Stream<'_>) -> Result<JsonValue, MongoshStatement> {
    let head = match stream.peek() {
        Some(s) => s.clone(),
        None => {
            return Err(err(
                MongoshErrorKind::UnsupportedSyntax,
                "unexpected end of input",
            ));
        }
    };
    match &head.token {
        Token::Punct('{') => parse_object(stream),
        Token::Punct('[') => parse_array(stream),
        Token::StringLit(s) => {
            let v = JsonValue::String(s.clone());
            stream.next();
            Ok(v)
        }
        Token::NumberLit(n) => {
            stream.next();
            number_to_json(*n)
        }
        Token::Ident(name) => parse_ident_value(stream, name.clone()),
        Token::Punct(p) => Err(err(
            MongoshErrorKind::UnsupportedSyntax,
            &format!("unexpected token `{}` in value position", p),
        )),
    }
}

fn parse_ident_value(stream: &mut Stream<'_>, name: String) -> Result<JsonValue, MongoshStatement> {
    match name.as_str() {
        "true" => {
            stream.next();
            Ok(JsonValue::Bool(true))
        }
        "false" => {
            stream.next();
            Ok(JsonValue::Bool(false))
        }
        "null" => {
            stream.next();
            Ok(JsonValue::Null)
        }
        n if BSON_LITERAL_NAMES.contains(&n) => parse_bson_literal(stream, n.to_string()),
        _ => Err(err(
            MongoshErrorKind::UnsupportedSyntax,
            &format!(
                "bare identifier `{}` is not supported in value position \
                 — variables aren't allowed",
                name
            ),
        )),
    }
}

fn parse_bson_literal(
    stream: &mut Stream<'_>,
    name: String,
) -> Result<JsonValue, MongoshStatement> {
    let placeholder = match bson_placeholder(&name) {
        Some(k) => k,
        None => {
            // Legacy unsupported BSON helper (e.g. BinData). Match TS
            // semantics: consume the ident then return a `bson-literal` err.
            stream.next();
            return Err(err(
                MongoshErrorKind::BsonLiteral,
                &format!("BSON literal `{}(...)` is not supported", name),
            ));
        }
    };
    stream.next(); // consume name
    if !stream.consume_punct('(') {
        return Err(err(
            MongoshErrorKind::UnsupportedSyntax,
            &format!("expected `(` after BSON literal `{}`", name),
        ));
    }
    // Empty arg → placeholder with null value.
    if stream.consume_punct(')') {
        let mut map = Map::new();
        map.insert(placeholder.to_string(), JsonValue::Null);
        return Ok(JsonValue::Object(map));
    }
    let arg = match stream.peek() {
        Some(s) => s.clone(),
        None => {
            return Err(err(
                MongoshErrorKind::UnsupportedSyntax,
                &format!("unterminated `{}(...)`", name),
            ));
        }
    };
    // Exactly one primitive arg accepted.
    let raw: ScalarArg = match &arg.token {
        Token::StringLit(s) => {
            stream.next();
            ScalarArg::Str(s.clone())
        }
        Token::NumberLit(n) => {
            stream.next();
            ScalarArg::Num(*n)
        }
        other => {
            return Err(err(
                MongoshErrorKind::UnsupportedSyntax,
                &format!(
                    "`{}(...)` accepts a single string or number literal — got `{}`",
                    name,
                    describe_token(other)
                ),
            ));
        }
    };
    // Tolerate trailing comma.
    stream.consume_punct(',');
    if !stream.consume_punct(')') {
        return Err(err(
            MongoshErrorKind::UnsupportedSyntax,
            &format!("`{}(...)` accepts exactly one argument", name),
        ));
    }
    // NumberLong / Decimal128 store as a string per extended-JSON
    // convention; ObjectId / ISODate / UUID preserve input shape.
    let value = if bson_coerce_to_string(&name) {
        match raw {
            ScalarArg::Str(s) => JsonValue::String(s),
            ScalarArg::Num(n) => JsonValue::String(format_number_for_extjson(n)),
        }
    } else {
        match raw {
            ScalarArg::Str(s) => JsonValue::String(s),
            ScalarArg::Num(n) => number_to_json(n)?,
        }
    };
    let mut map = Map::new();
    map.insert(placeholder.to_string(), value);
    Ok(JsonValue::Object(map))
}

enum ScalarArg {
    Str(String),
    Num(f64),
}

fn parse_object(stream: &mut Stream<'_>) -> Result<JsonValue, MongoshStatement> {
    if !stream.consume_punct('{') {
        return Err(err(MongoshErrorKind::UnsupportedSyntax, "expected `{`"));
    }
    let mut map: Map<String, JsonValue> = Map::new();
    if stream.consume_punct('}') {
        return Ok(JsonValue::Object(map));
    }
    loop {
        // Tolerate trailing `,` before `}`.
        if stream.consume_punct('}') {
            return Ok(JsonValue::Object(map));
        }
        let key_tok = match stream.next() {
            Some(t) => t.clone(),
            None => {
                return Err(err(
                    MongoshErrorKind::UnsupportedSyntax,
                    "expected object key, got end of input",
                ));
            }
        };
        let key = match &key_tok.token {
            Token::StringLit(s) => s.clone(),
            Token::Ident(s) => s.clone(),
            other => {
                return Err(err(
                    MongoshErrorKind::UnsupportedSyntax,
                    &format!("expected object key, got `{}`", describe_token(other)),
                ));
            }
        };
        if !stream.consume_punct(':') {
            return Err(err(
                MongoshErrorKind::UnsupportedSyntax,
                &format!(
                    "expected `:` after key `{}` — shorthand keys aren't supported",
                    key
                ),
            ));
        }
        let value = parse_value(stream)?;
        map.insert(key, value);
        if stream.consume_punct(',') {
            continue;
        }
        if stream.consume_punct('}') {
            return Ok(JsonValue::Object(map));
        }
        let stray = stream.peek().map(|s| describe_token(&s.token));
        return Err(err(
            MongoshErrorKind::UnsupportedSyntax,
            &match stray {
                Some(s) => format!("expected `,` or `}}` in object, got `{}`", s),
                None => "unterminated object literal".to_string(),
            },
        ));
    }
}

fn parse_array(stream: &mut Stream<'_>) -> Result<JsonValue, MongoshStatement> {
    if !stream.consume_punct('[') {
        return Err(err(MongoshErrorKind::UnsupportedSyntax, "expected `[`"));
    }
    let mut arr: Vec<JsonValue> = Vec::new();
    if stream.consume_punct(']') {
        return Ok(JsonValue::Array(arr));
    }
    loop {
        if stream.consume_punct(']') {
            return Ok(JsonValue::Array(arr));
        }
        let v = parse_value(stream)?;
        arr.push(v);
        if stream.consume_punct(',') {
            continue;
        }
        if stream.consume_punct(']') {
            return Ok(JsonValue::Array(arr));
        }
        let stray = stream.peek().map(|s| describe_token(&s.token));
        return Err(err(
            MongoshErrorKind::UnsupportedSyntax,
            &match stray {
                Some(s) => format!("expected `,` or `]` in array, got `{}`", s),
                None => "unterminated array literal".to_string(),
            },
        ));
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn number_to_json(n: f64) -> Result<JsonValue, MongoshStatement> {
    // serde_json::Number does not accept NaN/Inf; mongosh lexer never
    // emits them but we surface a parse error rather than panicking.
    if !n.is_finite() {
        return Err(err(
            MongoshErrorKind::UnsupportedSyntax,
            "non-finite numeric literal",
        ));
    }
    if n.fract() == 0.0 && n.abs() < (i64::MAX as f64) {
        // Prefer integer representation so JSON round-trips match the TS
        // side (which emits `42` not `42.0`).
        let as_i64 = n as i64;
        return Ok(JsonValue::Number(Number::from(as_i64)));
    }
    let num = Number::from_f64(n).ok_or_else(|| {
        err(
            MongoshErrorKind::UnsupportedSyntax,
            "internal: number cannot be represented in JSON",
        )
    })?;
    Ok(JsonValue::Number(num))
}

fn format_number_for_extjson(n: f64) -> String {
    // Match JS String(n): integers print without trailing `.0`. Decimal128(3.14)
    // → "3.14", NumberLong(123) → "123".
    if n.is_finite() && n.fract() == 0.0 && n.abs() < (i64::MAX as f64) {
        format!("{}", n as i64)
    } else {
        // f64 default formatting in Rust is similar to JS Number.toString
        // for most cases. The TS implementation uses `String(rawValue)`
        // which is JS `Number.prototype.toString` — equivalent for the
        // values mongosh emits in practice.
        format!("{}", n)
    }
}

fn sniff_head_keyword(src: &str) -> Option<MongoshStatement> {
    let bytes = src.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        let ch = bytes[i];
        if matches!(ch, b' ' | b'\t' | b'\n' | b'\r') {
            i += 1;
            continue;
        }
        if ch == b'/' && bytes.get(i + 1) == Some(&b'/') {
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        if ch == b'/' && bytes.get(i + 1) == Some(&b'*') {
            i += 2;
            while i < bytes.len() && !(bytes[i] == b'*' && bytes.get(i + 1) == Some(&b'/')) {
                i += 1;
            }
            if i >= bytes.len() {
                return None; // tokenizer will surface the error.
            }
            i += 2;
            continue;
        }
        break;
    }
    if i >= bytes.len() {
        return None;
    }
    let head_ch = bytes[i];
    // Bare-expression heuristic.
    if head_ch.is_ascii_digit()
        || head_ch == b'"'
        || head_ch == b'\''
        || head_ch == b'`'
        || (head_ch == b'-'
            && bytes
                .get(i + 1)
                .map(|c| c.is_ascii_digit())
                .unwrap_or(false))
    {
        return Some(err(
            MongoshErrorKind::NonDbStatement,
            "expression must begin with `db.<...>` \
             — bare expressions / literals are not run from the query tab",
        ));
    }
    if !(head_ch.is_ascii_alphabetic() || head_ch == b'_' || head_ch == b'$') {
        return None;
    }
    let start = i;
    let mut j = i + 1;
    while j < bytes.len()
        && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'_' || bytes[j] == b'$')
    {
        j += 1;
    }
    let ident = std::str::from_utf8(&bytes[start..j]).ok()?;
    // Word boundary check: `letMeIn` should NOT match `let`.
    if let Some(&after) = bytes.get(j) {
        if after.is_ascii_alphanumeric() || after == b'_' || after == b'$' {
            return None;
        }
    }
    if VARIABLE_DECL_KEYWORDS.contains(&ident) {
        return Some(variable_declaration_error(ident));
    }
    if FUNCTION_KEYWORDS.contains(&ident) {
        return Some(function_declaration_error());
    }
    None
}

fn variable_declaration_error(keyword: &str) -> MongoshStatement {
    err(
        MongoshErrorKind::VariableDeclaration,
        &format!(
            "`{}` declarations are not supported in the query tab \
             — only db.* statements run here.",
            keyword
        ),
    )
}

fn function_declaration_error() -> MongoshStatement {
    err(
        MongoshErrorKind::FunctionDeclaration,
        "Function declarations are not supported in the query tab.",
    )
}

fn err(error_kind: MongoshErrorKind, message: &str) -> MongoshStatement {
    MongoshStatement::Error {
        error_kind,
        message: message.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn expect_admin(s: MongoshStatement) -> (AdminCommandName, JsonValue) {
        match s {
            MongoshStatement::AdminCommand { command_name, body } => (command_name, body),
            other => panic!("expected admin-command, got {:?}", other),
        }
    }

    fn expect_collection(s: MongoshStatement) -> (String, String, Vec<JsonValue>) {
        match s {
            MongoshStatement::CollectionCommand {
                collection,
                method,
                args,
            } => (collection, method, args),
            other => panic!("expected collection-command, got {:?}", other),
        }
    }

    fn expect_error(s: MongoshStatement) -> (MongoshErrorKind, String) {
        match s {
            MongoshStatement::Error {
                error_kind,
                message,
            } => (error_kind, message),
            other => panic!("expected error, got {:?}", other),
        }
    }

    // ---- admin command ---------------------------------------------------

    #[test]
    fn ac_p1_run_command_ping() {
        let s = parse("db.runCommand({ping: 1})");
        let (name, body) = expect_admin(s);
        assert!(matches!(name, AdminCommandName::RunCommand));
        assert_eq!(body, serde_json::json!({"ping": 1}));
    }

    #[test]
    fn ac_p2_admin_command_server_status() {
        let s = parse("db.adminCommand({serverStatus: 1})");
        let (name, _) = expect_admin(s);
        assert!(matches!(name, AdminCommandName::AdminCommand));
    }

    #[test]
    fn ac_p3_collection_find_empty() {
        let s = parse("db.users.find({})");
        let (coll, method, args) = expect_collection(s);
        assert_eq!(coll, "users");
        assert_eq!(method, "find");
        assert_eq!(args, vec![serde_json::json!({})]);
    }

    #[test]
    fn ac_p4_collection_find_two_args() {
        let s = parse("db.users.find({}, {limit: 10})");
        let (_, _, args) = expect_collection(s);
        assert_eq!(args.len(), 2);
        assert_eq!(args[0], serde_json::json!({}));
        assert_eq!(args[1], serde_json::json!({"limit": 10}));
    }

    #[test]
    fn ac_p5_mixed_keys() {
        let s = parse(r#"db.runCommand({a: 1, "b.c": 2, $sum: 3})"#);
        let (_, body) = expect_admin(s);
        assert_eq!(body, serde_json::json!({"a": 1, "b.c": 2, "$sum": 3}));
    }

    #[test]
    fn ac_p6_nested_object() {
        let s = parse("db.runCommand({outer: {inner: 1, also: {deep: true}}})");
        let (_, body) = expect_admin(s);
        assert_eq!(
            body,
            serde_json::json!({
                "outer": {"inner": 1, "also": {"deep": true}}
            })
        );
    }

    #[test]
    fn ac_p7_object_with_array_bool_null_string() {
        let s = parse(r#"db.runCommand({arr: [1, 2, 3], flag: true, missing: null, name: "ok"})"#);
        let (_, body) = expect_admin(s);
        assert_eq!(
            body,
            serde_json::json!({
                "arr": [1, 2, 3],
                "flag": true,
                "missing": null,
                "name": "ok"
            })
        );
    }

    // ---- BSON literals ---------------------------------------------------

    #[test]
    fn ac_p7_bson_object_id() {
        let s = parse(r#"db.runCommand({_id: ObjectId("507f1f77bcf86cd799439011")})"#);
        let (_, body) = expect_admin(s);
        assert_eq!(
            body,
            serde_json::json!({"_id": {"$oid": "507f1f77bcf86cd799439011"}})
        );
    }

    #[test]
    fn bson_object_id_empty_args() {
        let s = parse("db.runCommand({_id: ObjectId()})");
        let (_, body) = expect_admin(s);
        assert_eq!(body, serde_json::json!({"_id": {"$oid": null}}));
    }

    #[test]
    fn bson_iso_date() {
        let s = parse(r#"db.runCommand({when: ISODate("2026-05-18T12:00:00Z")})"#);
        let (_, body) = expect_admin(s);
        assert_eq!(
            body,
            serde_json::json!({"when": {"$date": "2026-05-18T12:00:00Z"}})
        );
    }

    #[test]
    fn ac_p8_number_long_number_arg_coerces_to_string() {
        let s = parse("db.runCommand({n: NumberLong(123)})");
        let (_, body) = expect_admin(s);
        assert_eq!(body, serde_json::json!({"n": {"$numberLong": "123"}}));
    }

    #[test]
    fn bson_decimal128_float_arg() {
        let s = parse("db.runCommand({d: Decimal128(3.14)})");
        let (_, body) = expect_admin(s);
        assert_eq!(body, serde_json::json!({"d": {"$numberDecimal": "3.14"}}));
    }

    #[test]
    fn bson_uuid() {
        let s = parse(r#"db.runCommand({u: UUID("550e8400-e29b-41d4-a716-446655440000")})"#);
        let (_, body) = expect_admin(s);
        assert_eq!(
            body,
            serde_json::json!({"u": {"$uuid": "550e8400-e29b-41d4-a716-446655440000"}})
        );
    }

    #[test]
    fn ac_p14_bson_with_non_primitive_arg_rejects() {
        let s = parse(r#"db.runCommand({_id: ObjectId({$oid: "x"})})"#);
        let (kind, _) = expect_error(s);
        assert!(matches!(kind, MongoshErrorKind::UnsupportedSyntax));
    }

    #[test]
    fn bson_with_too_many_args_rejects() {
        let s = parse(r#"db.runCommand({_id: ObjectId("a", "b")})"#);
        let (kind, _) = expect_error(s);
        assert!(matches!(kind, MongoshErrorKind::UnsupportedSyntax));
    }

    #[test]
    fn bson_bindata_unsupported() {
        let s = parse(r#"db.runCommand({d: BinData(0, "x")})"#);
        let (kind, _) = expect_error(s);
        assert!(matches!(kind, MongoshErrorKind::BsonLiteral));
    }

    #[test]
    fn top_level_object_id_is_non_db_statement() {
        let s = parse(r#"ObjectId("507f1f77bcf86cd799439011")"#);
        let (kind, _) = expect_error(s);
        assert!(matches!(kind, MongoshErrorKind::NonDbStatement));
    }

    // ---- differentiated rejection ----------------------------------------

    #[test]
    fn ac_p9_let_is_variable_declaration() {
        let (kind, _) = expect_error(parse("let x = 1"));
        assert!(matches!(kind, MongoshErrorKind::VariableDeclaration));
    }

    #[test]
    fn ac_p9_const_is_variable_declaration() {
        let (kind, _) = expect_error(parse("const x = 1"));
        assert!(matches!(kind, MongoshErrorKind::VariableDeclaration));
    }

    #[test]
    fn ac_p9_var_is_variable_declaration() {
        let (kind, _) = expect_error(parse("var x = 1"));
        assert!(matches!(kind, MongoshErrorKind::VariableDeclaration));
    }

    #[test]
    fn ac_p10_function_is_function_declaration() {
        let (kind, _) = expect_error(parse("function foo() {}"));
        assert!(matches!(kind, MongoshErrorKind::FunctionDeclaration));
    }

    #[test]
    fn ac_p11_bare_arithmetic_is_non_db_statement() {
        let (kind, _) = expect_error(parse("1 + 1"));
        assert!(matches!(kind, MongoshErrorKind::NonDbStatement));
    }

    #[test]
    fn ac_p11_bare_string_is_non_db_statement() {
        let (kind, _) = expect_error(parse("\"hello\""));
        assert!(matches!(kind, MongoshErrorKind::NonDbStatement));
    }

    #[test]
    fn ac_p12_multi_statement_rejected() {
        let (kind, _) = expect_error(parse("db.users.find({}); db.users.drop()"));
        assert!(matches!(kind, MongoshErrorKind::MultipleStatements));
    }

    #[test]
    fn ac_p13_empty_input() {
        let (kind, _) = expect_error(parse(""));
        assert!(matches!(kind, MongoshErrorKind::UnsupportedSyntax));
    }

    #[test]
    fn whitespace_only_is_unsupported_syntax() {
        let (kind, _) = expect_error(parse("   \n\t  "));
        assert!(matches!(kind, MongoshErrorKind::UnsupportedSyntax));
    }

    #[test]
    fn lone_trailing_semicolon_tolerated() {
        let s = parse("db.users.find({});");
        let (_, method, _) = expect_collection(s);
        assert_eq!(method, "find");
    }

    // ---- comments / templates --------------------------------------------

    #[test]
    fn line_comment_before_statement() {
        let s = parse("// pick recent\ndb.runCommand({ping: 1})");
        let (_, body) = expect_admin(s);
        assert_eq!(body, serde_json::json!({"ping": 1}));
    }

    #[test]
    fn block_comment_inline() {
        let s = parse("db.runCommand(/* inline */{ping: 1})");
        let (_, body) = expect_admin(s);
        assert_eq!(body, serde_json::json!({"ping": 1}));
    }

    #[test]
    fn template_literal_as_string() {
        let s = parse("db.runCommand({name: `alice`})");
        let (_, body) = expect_admin(s);
        assert_eq!(body, serde_json::json!({"name": "alice"}));
    }

    #[test]
    fn template_interpolation_rejected() {
        let (kind, _) = expect_error(parse("db.runCommand({name: `hello ${x}`})"));
        assert!(matches!(kind, MongoshErrorKind::UnsupportedSyntax));
    }

    // ---- misc ------------------------------------------------------------

    #[test]
    fn numeric_negatives_and_floats() {
        let s = parse("db.runCommand({a: -3, b: 1.5, c: 2e3, d: -4E-2})");
        let (_, body) = expect_admin(s);
        // Note: 2e3 is integer-valued, others are floats.
        assert_eq!(
            body,
            serde_json::json!({
                "a": -3,
                "b": 1.5,
                "c": 2000,
                "d": -0.04
            })
        );
    }

    #[test]
    fn admin_command_with_string_body_rejected() {
        let (kind, _) = expect_error(parse(r#"db.runCommand("ping")"#));
        assert!(matches!(kind, MongoshErrorKind::UnsupportedSyntax));
    }

    #[test]
    fn admin_command_with_two_args_rejected() {
        let (kind, _) = expect_error(parse("db.runCommand({ping: 1}, {})"));
        assert!(matches!(kind, MongoshErrorKind::UnsupportedSyntax));
    }

    #[test]
    fn shell_use_rejected() {
        let (_, msg) = expect_error(parse("use admin"));
        assert!(msg.to_lowercase().contains("shell"));
    }

    #[test]
    fn never_panics_on_garbage() {
        // Just check no panic — match output type only.
        let _ = parse("@@@!!!");
        let _ = parse("db.");
        let _ = parse("db.users");
    }
}
