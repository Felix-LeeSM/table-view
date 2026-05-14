// Sprint 307: pure mongosh expression parser for Phase 28 Slice A1.
//
// Translates strings of the form `db.<collection>.<method>(<args>).<chain>`
// into a discriminated-union result that downstream Tauri-command dispatchers
// can route safely. The module never reaches for any runtime JS evaluator
// primitive — every BSON literal and JSON-like value is parsed by
// a hand-written tokenizer / recursive-descent walker, then reified into a
// canonical-extjson-compatible shape that matches the backend wire format
// (`src-tauri/src/db/mongodb/queries.rs::flatten_cell`).
//
// Strategy decision is recorded in ADR
// `memory/decisions/0029-mongosh-parser-strategy/memory.md`.

/**
 * Frozen list of mongosh methods this editor will dispatch. Order is the
 * canonical insertion order used by the snippet menu (Sprint A4). Every
 * consumer (parser, dispatch table, snippet menu, type predicate) must read
 * from this single tuple — duplicating the names elsewhere risks drift.
 */
export const MONGOSH_METHOD_WHITELIST = [
  "find",
  "findOne",
  "aggregate",
  "countDocuments",
  "estimatedDocumentCount",
  "distinct",
  "insertOne",
  "insertMany",
  "updateOne",
  "updateMany",
  "deleteOne",
  "deleteMany",
  "bulkWrite",
] as const;

/** Method names accepted by the parser. */
export type MongoshMethod = (typeof MONGOSH_METHOD_WHITELIST)[number];

/** Subset of methods that produce a cursor and therefore accept chaining. */
const CURSOR_METHODS: ReadonlySet<MongoshMethod> = new Set<MongoshMethod>([
  "find",
  "aggregate",
]);

/** Allowed cursor-chain method names following `find`/`aggregate`. */
const CURSOR_CHAIN_METHODS: ReadonlySet<string> = new Set([
  "sort",
  "limit",
  "skip",
  "toArray",
]);

/** Refusal taxonomy — every error returned by the parser carries one. */
export type MongoshErrorKind =
  | "unsupported-syntax"
  | "unsupported-method"
  | "bson-literal"
  | "multiple-statements"
  | "missing-db-prefix"
  | "invalid-cursor-chain";

/** Cursor-chain step parsed from `.method(args)`. */
export interface CursorChainStep {
  readonly name: string;
  readonly args: readonly unknown[];
}

/** Successful parse result — `kind` is the discriminant. */
export interface ParsedMongoshCall {
  readonly kind: "success";
  readonly collection: string;
  readonly method: MongoshMethod;
  readonly args: readonly unknown[];
  readonly cursorChain: readonly CursorChainStep[];
}

/** Failure result — `kind` is the discriminant, `errorKind` the taxonomy. */
export interface ParsedMongoshError {
  readonly kind: "error";
  readonly errorKind: MongoshErrorKind;
  readonly message: string;
  readonly at?: { readonly line: number; readonly column: number };
}

/**
 * Parse a mongosh expression. Pure; never throws on user input.
 *
 * Programmer-error inputs (e.g. non-string `input`) are caller-facing bugs;
 * we still degrade gracefully by returning an `unsupported-syntax` error
 * rather than panicking, so a stray runtime type confusion in a consumer
 * doesn't crash the editor.
 */
export function parseMongoshExpression(
  input: string,
): ParsedMongoshCall | ParsedMongoshError {
  if (typeof input !== "string") {
    return makeError("unsupported-syntax", "expected a string expression");
  }

  const trimmed = stripLeadingComments(input).trim();
  if (trimmed.length === 0) {
    return makeError("unsupported-syntax", "expression is empty");
  }

  // Shell helpers (`use admin`, `show dbs`, `show collections`) — these are
  // bare-word commands the mongosh REPL accepts but our editor refuses.
  if (/^(use|show)\b/.test(trimmed)) {
    return makeError(
      "unsupported-syntax",
      "shell helpers (`use`, `show`) are not supported — the editor only " +
        "accepts db.<collection>.<method>(...) expressions",
    );
  }

  // Reject control-flow / declarations at the head of the expression. We
  // detect them as keyword tokens followed by a non-identifier character so
  // collections literally named `var`/`for`/`if` are not affected (mongosh
  // disallows those names anyway).
  const controlFlow =
    /^(var|let|const|for|while|if|function|class|return|switch)\b/.exec(
      trimmed,
    );
  if (controlFlow) {
    return makeError(
      "unsupported-syntax",
      `${controlFlow[1]} declarations / control flow are not supported — ` +
        "wrap the variable inline as a BSON literal instead",
    );
  }

  // Tokenize the entire input once so multi-statement detection and
  // recursive-descent walking share the same token stream.
  const tokens = tokenize(trimmed);
  if (tokens.kind === "error") {
    return tokens.error;
  }
  const stream = new TokenStream(tokens.tokens);

  // Multi-statement guard: a top-level `;` with content on both sides is
  // forbidden. We do this on the tokens (not raw text) so semicolons inside
  // string literals don't false-positive.
  if (stream.hasTopLevelSemicolon()) {
    return makeError(
      "multiple-statements",
      "multiple statements separated by `;` are not supported — submit one " +
        "mongosh expression at a time",
    );
  }

  // The expression must begin with the literal identifier `db`. Anything
  // else (e.g. `users.find({})`, `coll.find({})`) is missing-db-prefix.
  const head = stream.peek();
  if (!head || head.kind !== "ident") {
    return makeError(
      "unsupported-syntax",
      "expression must begin with `db.<collection>.<method>(...)`",
    );
  }
  if (head.value !== "db") {
    return makeError(
      "missing-db-prefix",
      "expression must begin with `db.` — bare collection access is not " +
        "supported",
    );
  }
  stream.next();

  // After `db`, the only allowed next tokens are `.<ident>(<args>)` chains.
  // The first chain element must be the collection name; the second must
  // be the method. `getSiblingDB(...)` is explicitly refused.
  if (!stream.consume({ kind: "punct", value: "." })) {
    return makeError("unsupported-syntax", "expected `.` after `db`");
  }
  const collectionTok = stream.next();
  if (!collectionTok || collectionTok.kind !== "ident") {
    return makeError(
      "unsupported-syntax",
      "expected a collection name after `db.`",
    );
  }
  if (collectionTok.value === "getSiblingDB") {
    return makeError(
      "unsupported-syntax",
      "`db.getSiblingDB(...)` cross-database navigation is not supported",
    );
  }

  // `db.<coll>.<method>(...)` — require the method dot + identifier + (.
  if (!stream.consume({ kind: "punct", value: "." })) {
    return makeError(
      "unsupported-syntax",
      "expected `.` after the collection name",
    );
  }
  const methodTok = stream.next();
  if (!methodTok || methodTok.kind !== "ident") {
    return makeError(
      "unsupported-syntax",
      "expected a method name after the collection",
    );
  }
  if (!isMongoshMethod(methodTok.value)) {
    return makeError(
      "unsupported-method",
      `method \`${methodTok.value}\` is not in the supported whitelist ` +
        `(${MONGOSH_METHOD_WHITELIST.join(", ")})`,
    );
  }
  const method: MongoshMethod = methodTok.value;

  // Parse the call's argument list.
  const argsResult = parseCallArgs(stream);
  if (argsResult.kind === "error") return argsResult.error;

  // Cursor-chain — only valid for `find` / `aggregate`. If we see one on a
  // non-cursor method we report `invalid-cursor-chain`. We still parse the
  // chain when valid so the dispatcher can read sort/limit/skip later.
  const chainResult = parseCursorChain(stream, method);
  if (chainResult.kind === "error") return chainResult.error;

  // Trailing semicolons (`db.users.find({});`) are tolerated for shell-style
  // hygiene; multi-statement detection above already guards against multiple
  // expressions, so a lone `;` here is just a no-op.
  stream.consume({ kind: "punct", value: ";" });

  // Stream must be fully consumed; trailing garbage is a refusal.
  if (!stream.atEnd()) {
    const stray = stream.peek();
    return makeError(
      "unsupported-syntax",
      stray
        ? `unexpected trailing token \`${describeToken(stray)}\``
        : "unexpected trailing input after expression",
    );
  }

  return {
    kind: "success",
    collection: collectionTok.value,
    method,
    args: argsResult.value,
    cursorChain: chainResult.value,
  };
}

// ---------------------------------------------------------------------------
// Internal: token stream + parser helpers
// ---------------------------------------------------------------------------

type Token =
  | { kind: "ident"; value: string; pos: number }
  | { kind: "string"; value: string; pos: number }
  | { kind: "number"; value: number; pos: number }
  | { kind: "punct"; value: string; pos: number };

interface TokenizeOk {
  readonly kind: "ok";
  readonly tokens: readonly Token[];
}
interface TokenizeErr {
  readonly kind: "error";
  readonly error: ParsedMongoshError;
}

const PUNCT_CHARS = new Set(["{", "}", "[", "]", "(", ")", ",", ":", ";", "."]);

/**
 * Hand-written tokenizer that recognises identifiers (including `$`-prefixed
 * operator keys), numeric literals, string literals (single/double quoted),
 * punctuation, and skips whitespace + JS-style comments.
 *
 * Arrow-function bodies inside callback arguments are NOT tokenized further:
 * we surface `=>` as an `unsupported-syntax` refusal because every method
 * that accepts callbacks (`forEach`, `map`) is itself outside our whitelist,
 * so a callback's presence indicates a refused method.
 */
function tokenize(src: string): TokenizeOk | TokenizeErr {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;

    // Whitespace
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }

    // `//` line comment, `/* */` block comment.
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      if (i >= src.length) {
        return {
          kind: "error",
          error: makeError(
            "unsupported-syntax",
            "unterminated /* ... */ comment",
          ),
        };
      }
      i += 2;
      continue;
    }

    // Arrow function — disallowed (only appears in callback contexts which
    // are themselves refused). We surface a specific message.
    if (ch === "=" && src[i + 1] === ">") {
      return {
        kind: "error",
        error: makeError(
          "unsupported-syntax",
          "arrow functions (`=>`) are not supported — callback methods are " +
            "outside the supported whitelist",
        ),
      };
    }

    // String literal
    if (ch === '"' || ch === "'") {
      const result = readString(src, i, ch);
      if (result.kind === "error")
        return { kind: "error", error: result.error };
      tokens.push({ kind: "string", value: result.value, pos: i });
      i = result.next;
      continue;
    }

    // Number literal: -?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?
    if (ch === "-" && /[0-9]/.test(src[i + 1] ?? "")) {
      const result = readNumber(src, i);
      tokens.push({ kind: "number", value: result.value, pos: i });
      i = result.next;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      const result = readNumber(src, i);
      tokens.push({ kind: "number", value: result.value, pos: i });
      i = result.next;
      continue;
    }

    // Identifier (incl. `$`-prefixed operators). First char must be
    // letter / underscore / `$`; subsequent chars may include digits.
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_$]/.test(src[j]!)) j++;
      tokens.push({ kind: "ident", value: src.slice(i, j), pos: i });
      i = j;
      continue;
    }

    // Punctuation
    if (PUNCT_CHARS.has(ch)) {
      tokens.push({ kind: "punct", value: ch, pos: i });
      i++;
      continue;
    }

    return {
      kind: "error",
      error: makeError(
        "unsupported-syntax",
        `unexpected character \`${ch}\` at offset ${i}`,
      ),
    };
  }

  return { kind: "ok", tokens };
}

function readString(
  src: string,
  start: number,
  quote: string,
):
  | { kind: "ok"; value: string; next: number }
  | { kind: "error"; error: ParsedMongoshError } {
  let i = start + 1;
  let value = "";
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "\\") {
      const next = src[i + 1];
      if (next === undefined) {
        return {
          kind: "error",
          error: makeError("unsupported-syntax", "unterminated string escape"),
        };
      }
      if (next === "u") {
        const hex = src.slice(i + 2, i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          return {
            kind: "error",
            error: makeError(
              "unsupported-syntax",
              "invalid \\u escape in string",
            ),
          };
        }
        value += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        continue;
      }
      // JSON-style backslash escapes — handled by a small lookup table so the
      // branching stays shallow and the test suite can cover the table with a
      // single string-literal scenario.
      const ESC: Record<string, string> = {
        n: "\n",
        r: "\r",
        t: "\t",
        b: "\b",
        f: "\f",
        "\\": "\\",
        "'": "'",
        '"': '"',
        "/": "/",
      };
      value += ESC[next] ?? next;
      i += 2;
      continue;
    }
    if (ch === quote) {
      return { kind: "ok", value, next: i + 1 };
    }
    value += ch;
    i++;
  }
  return {
    kind: "error",
    error: makeError("unsupported-syntax", "unterminated string literal"),
  };
}

function readNumber(
  src: string,
  start: number,
): { value: number; next: number } {
  let j = start;
  if (src[j] === "-") j++;
  while (j < src.length && /[0-9]/.test(src[j]!)) j++;
  if (src[j] === ".") {
    j++;
    while (j < src.length && /[0-9]/.test(src[j]!)) j++;
  }
  if (src[j] === "e" || src[j] === "E") {
    j++;
    if (src[j] === "+" || src[j] === "-") j++;
    while (j < src.length && /[0-9]/.test(src[j]!)) j++;
  }
  return { value: Number(src.slice(start, j)), next: j };
}

class TokenStream {
  private readonly tokens: readonly Token[];
  private idx = 0;
  constructor(tokens: readonly Token[]) {
    this.tokens = tokens;
  }
  peek(): Token | undefined {
    return this.tokens[this.idx];
  }
  next(): Token | undefined {
    return this.tokens[this.idx++];
  }
  atEnd(): boolean {
    return this.idx >= this.tokens.length;
  }
  /**
   * Consume a token matching `match`; return true on success and advance,
   * false otherwise without advancing.
   */
  consume(match: { kind: Token["kind"]; value: string }): boolean {
    const tok = this.peek();
    if (!tok || tok.kind !== match.kind) return false;
    if (tok.kind === "punct" && tok.value !== match.value) return false;
    if (tok.kind === "ident" && tok.value !== match.value) return false;
    this.idx++;
    return true;
  }
  /**
   * Returns true when a `;` exists at top-level depth (outside any nested
   * brackets) AND there is non-whitespace content after it. A trailing `;`
   * is tolerated for shell-style hygiene.
   */
  hasTopLevelSemicolon(): boolean {
    let depth = 0;
    for (let i = 0; i < this.tokens.length; i++) {
      const tok = this.tokens[i]!;
      if (tok.kind === "punct") {
        if (tok.value === "(" || tok.value === "[" || tok.value === "{") {
          depth++;
        } else if (
          tok.value === ")" ||
          tok.value === "]" ||
          tok.value === "}"
        ) {
          depth--;
        } else if (tok.value === ";" && depth === 0) {
          // Trailing semicolon with nothing after is fine.
          if (i < this.tokens.length - 1) return true;
        }
      }
    }
    return false;
  }
}

function describeToken(tok: Token): string {
  if (tok.kind === "string") return `"${tok.value}"`;
  return String(tok.value);
}

function isMongoshMethod(name: string): name is MongoshMethod {
  return (MONGOSH_METHOD_WHITELIST as readonly string[]).includes(name);
}

function stripLeadingComments(src: string): string {
  // Strip leading whitespace + line/block comments so a bare `// comment`
  // before the expression doesn't falsify the `db.` head check.
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      if (i < src.length) i += 2;
      continue;
    }
    break;
  }
  return src.slice(i);
}

function makeError(
  errorKind: MongoshErrorKind,
  message: string,
): ParsedMongoshError {
  return { kind: "error", errorKind, message };
}

// ---------------------------------------------------------------------------
// Internal: argument-list + cursor-chain walkers
// ---------------------------------------------------------------------------

type ParseValueResult =
  | { kind: "ok"; value: unknown }
  | { kind: "error"; error: ParsedMongoshError };

type ParseArgsResult =
  | { kind: "ok"; value: readonly unknown[] }
  | { kind: "error"; error: ParsedMongoshError };

type ParseChainResult =
  | { kind: "ok"; value: readonly CursorChainStep[] }
  | { kind: "error"; error: ParsedMongoshError };

function parseCallArgs(stream: TokenStream): ParseArgsResult {
  if (!stream.consume({ kind: "punct", value: "(" })) {
    return {
      kind: "error",
      error: makeError("unsupported-syntax", "expected `(` to begin arguments"),
    };
  }
  const args: unknown[] = [];
  // Empty arg list `()`.
  if (stream.consume({ kind: "punct", value: ")" })) {
    return { kind: "ok", value: args };
  }
  while (true) {
    const value = parseValue(stream);
    if (value.kind === "error") return value;
    args.push(value.value);
    if (stream.consume({ kind: "punct", value: "," })) continue;
    if (stream.consume({ kind: "punct", value: ")" })) break;
    const stray = stream.peek();
    return {
      kind: "error",
      error: makeError(
        "unsupported-syntax",
        stray
          ? `expected \`,\` or \`)\` in argument list, got \`${describeToken(stray)}\``
          : "unterminated argument list",
      ),
    };
  }
  return { kind: "ok", value: args };
}

function parseCursorChain(
  stream: TokenStream,
  method: MongoshMethod,
): ParseChainResult {
  const steps: CursorChainStep[] = [];
  while (stream.consume({ kind: "punct", value: "." })) {
    const nameTok = stream.next();
    if (!nameTok || nameTok.kind !== "ident") {
      return {
        kind: "error",
        error: makeError(
          "unsupported-syntax",
          "expected a chain method name after `.`",
        ),
      };
    }
    // `forEach` / `map` callbacks are explicitly refused even when chained
    // off a valid cursor — they're outside the dispatch surface.
    if (nameTok.value === "forEach" || nameTok.value === "map") {
      return {
        kind: "error",
        error: makeError(
          "unsupported-syntax",
          `callback method \`${nameTok.value}\` is not supported — use ` +
            "`.toArray()` and iterate in the renderer",
        ),
      };
    }
    if (!CURSOR_CHAIN_METHODS.has(nameTok.value)) {
      return {
        kind: "error",
        error: makeError(
          "invalid-cursor-chain",
          `\`.${nameTok.value}\` is not a recognised cursor chain method`,
        ),
      };
    }
    if (!CURSOR_METHODS.has(method)) {
      return {
        kind: "error",
        error: makeError(
          "invalid-cursor-chain",
          `cursor chain \`.${nameTok.value}\` is only valid after ` +
            "`find` / `aggregate` — not after " +
            `\`${method}\``,
        ),
      };
    }
    const args = parseCallArgs(stream);
    if (args.kind === "error") return args;
    steps.push({ name: nameTok.value, args: args.value });
  }
  return { kind: "ok", value: steps };
}

/**
 * Recursive-descent value parser. Supports:
 *  - object literals `{ key: value, ... }` (keys may be identifiers or
 *    quoted strings; `$`-prefixed identifier keys allowed)
 *  - array literals `[v, v, ...]`
 *  - string literals
 *  - number literals
 *  - booleans `true` / `false`
 *  - `null`
 *  - BSON literal calls (`ObjectId(...)`, `ISODate(...)`, `UUID(...)`,
 *    `NumberLong(...)`, `NumberDecimal(...)`, `BinData(...)`).
 *
 * Any other identifier in a value position (variable reference, callback
 * parameter, etc.) is refused as `unsupported-syntax`.
 */
function parseValue(stream: TokenStream): ParseValueResult {
  const tok = stream.peek();
  if (!tok) {
    return {
      kind: "error",
      error: makeError("unsupported-syntax", "unexpected end of input"),
    };
  }
  if (tok.kind === "punct" && tok.value === "{") {
    return parseObject(stream);
  }
  if (tok.kind === "punct" && tok.value === "[") {
    return parseArray(stream);
  }
  if (tok.kind === "string") {
    stream.next();
    return { kind: "ok", value: tok.value };
  }
  if (tok.kind === "number") {
    stream.next();
    return { kind: "ok", value: tok.value };
  }
  if (tok.kind === "ident") {
    if (tok.value === "true") {
      stream.next();
      return { kind: "ok", value: true };
    }
    if (tok.value === "false") {
      stream.next();
      return { kind: "ok", value: false };
    }
    if (tok.value === "null") {
      stream.next();
      return { kind: "ok", value: null };
    }
    if (tok.value === "undefined") {
      stream.next();
      return { kind: "ok", value: undefined };
    }
    if (BSON_LITERAL_NAMES.has(tok.value)) {
      return parseBsonLiteral(stream);
    }
    return {
      kind: "error",
      error: makeError(
        "unsupported-syntax",
        `bare identifier \`${tok.value}\` is not supported in an argument ` +
          "position — variables / callbacks aren't allowed",
      ),
    };
  }
  return {
    kind: "error",
    error: makeError(
      "unsupported-syntax",
      `unexpected token \`${describeToken(tok)}\` in value position`,
    ),
  };
}

function parseObject(stream: TokenStream): ParseValueResult {
  if (!stream.consume({ kind: "punct", value: "{" })) {
    return {
      kind: "error",
      error: makeError("unsupported-syntax", "expected `{`"),
    };
  }
  const obj: Record<string, unknown> = {};
  if (stream.consume({ kind: "punct", value: "}" })) {
    return { kind: "ok", value: obj };
  }
  while (true) {
    const keyTok = stream.next();
    if (!keyTok) {
      return {
        kind: "error",
        error: makeError(
          "unsupported-syntax",
          "expected object key, got end of input",
        ),
      };
    }
    let key: string;
    if (keyTok.kind === "string") {
      key = keyTok.value;
    } else if (keyTok.kind === "ident") {
      key = keyTok.value;
    } else {
      return {
        kind: "error",
        error: makeError(
          "unsupported-syntax",
          `expected object key, got \`${describeToken(keyTok)}\``,
        ),
      };
    }
    // Shorthand `{i}` for `{i: i}` is JS syntax we deliberately don't accept;
    // it would require resolving the bare identifier `i`. Surface a friendly
    // error if the next token isn't `:`.
    if (!stream.consume({ kind: "punct", value: ":" })) {
      return {
        kind: "error",
        error: makeError(
          "unsupported-syntax",
          `expected \`:\` after key \`${key}\` — shorthand keys aren't supported`,
        ),
      };
    }
    const value = parseValue(stream);
    if (value.kind === "error") return value;
    obj[key] = value.value;
    if (stream.consume({ kind: "punct", value: "," })) continue;
    if (stream.consume({ kind: "punct", value: "}" })) break;
    const stray = stream.peek();
    return {
      kind: "error",
      error: makeError(
        "unsupported-syntax",
        stray
          ? `expected \`,\` or \`}\` in object, got \`${describeToken(stray)}\``
          : "unterminated object literal",
      ),
    };
  }
  return { kind: "ok", value: obj };
}

function parseArray(stream: TokenStream): ParseValueResult {
  if (!stream.consume({ kind: "punct", value: "[" })) {
    return {
      kind: "error",
      error: makeError("unsupported-syntax", "expected `[`"),
    };
  }
  const arr: unknown[] = [];
  if (stream.consume({ kind: "punct", value: "]" })) {
    return { kind: "ok", value: arr };
  }
  while (true) {
    const value = parseValue(stream);
    if (value.kind === "error") return value;
    arr.push(value.value);
    if (stream.consume({ kind: "punct", value: "," })) continue;
    if (stream.consume({ kind: "punct", value: "]" })) break;
    const stray = stream.peek();
    return {
      kind: "error",
      error: makeError(
        "unsupported-syntax",
        stray
          ? `expected \`,\` or \`]\` in array, got \`${describeToken(stray)}\``
          : "unterminated array literal",
      ),
    };
  }
  return { kind: "ok", value: arr };
}

// ---------------------------------------------------------------------------
// Internal: BSON literal reifiers (canonical-extjson-compatible output)
// ---------------------------------------------------------------------------

const BSON_LITERAL_NAMES: ReadonlySet<string> = new Set([
  "ObjectId",
  "ISODate",
  "UUID",
  "NumberLong",
  "NumberDecimal",
  "BinData",
]);

function parseBsonLiteral(stream: TokenStream): ParseValueResult {
  const nameTok = stream.next();
  if (!nameTok || nameTok.kind !== "ident") {
    return {
      kind: "error",
      error: makeError("bson-literal", "expected BSON literal name"),
    };
  }
  // Each literal pulls a fixed shape of args off the stream.
  const args = parseCallArgs(stream);
  if (args.kind === "error") return args;
  switch (nameTok.value) {
    case "ObjectId":
      return reifyObjectId(args.value);
    case "ISODate":
      return reifyIsoDate(args.value);
    case "UUID":
      return reifyUuid(args.value);
    case "NumberLong":
      return reifyNumberLong(args.value);
    case "NumberDecimal":
      return reifyNumberDecimal(args.value);
    case "BinData":
      return reifyBinData(args.value);
    default:
      return {
        kind: "error",
        error: makeError(
          "bson-literal",
          `unknown BSON literal \`${nameTok.value}\``,
        ),
      };
  }
}

function reifyObjectId(args: readonly unknown[]): ParseValueResult {
  if (args.length !== 1 || typeof args[0] !== "string") {
    return {
      kind: "error",
      error: makeError(
        "bson-literal",
        "ObjectId(...) expects exactly one string argument",
      ),
    };
  }
  const hex = args[0];
  if (!/^[0-9a-fA-F]{24}$/.test(hex)) {
    return {
      kind: "error",
      error: makeError(
        "bson-literal",
        `ObjectId("${hex}") is not a 24-character hex string`,
      ),
    };
  }
  return { kind: "ok", value: { $oid: hex } };
}

function reifyIsoDate(args: readonly unknown[]): ParseValueResult {
  if (args.length !== 1 || typeof args[0] !== "string") {
    return {
      kind: "error",
      error: makeError(
        "bson-literal",
        "ISODate(...) expects exactly one ISO-8601 string argument",
      ),
    };
  }
  const iso = args[0];
  // Sanity-check the string is parseable as a Date — reject NaN.
  if (Number.isNaN(Date.parse(iso))) {
    return {
      kind: "error",
      error: makeError(
        "bson-literal",
        `ISODate("${iso}") is not a valid ISO-8601 timestamp`,
      ),
    };
  }
  return { kind: "ok", value: { $date: iso } };
}

function reifyUuid(args: readonly unknown[]): ParseValueResult {
  if (args.length !== 1 || typeof args[0] !== "string") {
    return {
      kind: "error",
      error: makeError(
        "bson-literal",
        "UUID(...) expects exactly one string argument",
      ),
    };
  }
  const raw = args[0];
  const hex = raw.replace(/-/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
    return {
      kind: "error",
      error: makeError(
        "bson-literal",
        `UUID("${raw}") is not a valid 16-byte hex UUID`,
      ),
    };
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return {
    kind: "ok",
    value: { $binary: { base64: bytesToBase64(bytes), subType: "04" } },
  };
}

function reifyNumberLong(args: readonly unknown[]): ParseValueResult {
  if (args.length !== 1 || typeof args[0] !== "string") {
    return {
      kind: "error",
      error: makeError(
        "bson-literal",
        "NumberLong(...) expects exactly one string argument",
      ),
    };
  }
  const text = args[0];
  if (!/^-?[0-9]+$/.test(text)) {
    return {
      kind: "error",
      error: makeError(
        "bson-literal",
        `NumberLong("${text}") is not an integer literal`,
      ),
    };
  }
  // 64-bit signed range guard. BigInt comparison avoids precision loss.
  const value = BigInt(text);
  const MAX = BigInt("9223372036854775807");
  const MIN = BigInt("-9223372036854775808");
  if (value > MAX || value < MIN) {
    return {
      kind: "error",
      error: makeError(
        "bson-literal",
        `NumberLong("${text}") is out of 64-bit signed range`,
      ),
    };
  }
  return { kind: "ok", value: { $numberLong: text } };
}

function reifyNumberDecimal(args: readonly unknown[]): ParseValueResult {
  if (args.length !== 1 || typeof args[0] !== "string") {
    return {
      kind: "error",
      error: makeError(
        "bson-literal",
        "NumberDecimal(...) expects exactly one string argument",
      ),
    };
  }
  const text = args[0];
  if (!/^-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(text)) {
    return {
      kind: "error",
      error: makeError(
        "bson-literal",
        `NumberDecimal("${text}") is not a valid decimal literal`,
      ),
    };
  }
  return { kind: "ok", value: { $numberDecimal: text } };
}

function reifyBinData(args: readonly unknown[]): ParseValueResult {
  if (
    args.length !== 2 ||
    typeof args[0] !== "number" ||
    typeof args[1] !== "string"
  ) {
    return {
      kind: "error",
      error: makeError(
        "bson-literal",
        "BinData(...) expects (subType: number, base64: string)",
      ),
    };
  }
  const subTypeInt = args[0];
  if (!Number.isInteger(subTypeInt) || subTypeInt < 0 || subTypeInt > 255) {
    return {
      kind: "error",
      error: makeError(
        "bson-literal",
        `BinData(${subTypeInt}, ...) subType must be an integer 0..255`,
      ),
    };
  }
  const base64 = args[1];
  if (!/^[A-Za-z0-9+/]*=*$/.test(base64)) {
    return {
      kind: "error",
      error: makeError(
        "bson-literal",
        "BinData(..., ...) base64 payload is malformed",
      ),
    };
  }
  // Canonical-extjson uses two-hex-char subType padding.
  const subTypeHex = subTypeInt.toString(16).padStart(2, "0");
  return {
    kind: "ok",
    value: { $binary: { base64, subType: subTypeHex } },
  };
}

/**
 * Convert a `Uint8Array` to a base64 string using `btoa`. We round-trip
 * through `String.fromCharCode` because `btoa` operates on byte-strings.
 * Available in both browser and jsdom (vitest) test environments.
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
