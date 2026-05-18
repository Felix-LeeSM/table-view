// Sprint 382 (2026-05-17) — mongosh statement AST parser MVP.
// Sprint 383 (2026-05-17) — extended grammar: BSON literals, block comments
// (already lexed by sprint-382; behavior locked here), interpolation-free
// template literals, differentiated rejection error kinds, refactored
// helpers (`err` single helper, `parseArgList` extraction).
//
// 작성 이유: sprint-381 의 정규식 기반 `classifyMongoStatement` /
// `extractAdminCommandBody` 는 statement 분류 + body 추출을 두 번의 정규식
// 패스로 처리한다. 본 모듈은 그 두 분석을 하나의 *typed AST* 위에서
// 통합한다. sprint-383 은 sprint-382 가 deferred 한 BSON literal /
// template literal / 블록 코멘트 nested 비지원 / 분화된 error kind 를
// 채운다.
//
// **Scope (sprint-383 contract)**:
//   1. `db.runCommand({...})` / `db.adminCommand({...})` admin command
//   2. `db.<collection>.<method>(<args>, ...)` collection command (trailing
//      cursor-chain `.sort().limit()` 는 lexically 수용; dispatcher 는 첫
//      method 만 honor — Phase 28 method whitelist 가 상위에서 gate)
//   3. object literal (identifier / quoted key, nested object / array,
//      string / number / boolean / null 값)
//   4. line comment `// ...` + block comment `/* ... */` strip (nested
//      block comment 는 mongosh 와 동일하게 first `*/` 에서 닫힘 — `c */`
//      잔여물은 garbage)
//   5. single statement only — `;` 로 구분된 두 번째 statement 는 거부
//   6. BSON literal value-position call expression 5종:
//      - `ObjectId("<hex>")` / `ObjectId()` → `{$oid: string | null}`
//      - `ISODate("<iso>")` / `ISODate()` → `{$date: string | null}`
//      - `NumberLong("<n>")` / `NumberLong(n)` → `{$numberLong: string}`
//      - `Decimal128("<d>")` / `Decimal128(d)` → `{$numberDecimal: string}`
//      - `UUID("<uuid>")` → `{$uuid: string}`
//      각 literal 은 최대 1 개 인자만 받으며, 인자는 string 또는 number
//      literal 만 수용 (객체/배열/nested call 거부). 본 placeholder 는
//      mongosh extended-JSON 컨벤션이라 backend `run_mongo_command` 가
//      그대로 BSON 으로 deserialize 한다.
//   7. 보간 없는 템플릿 리터럴 `` `text` `` → 일반 string. `${` 발견 시 거부.
//
// **Out of scope (sprint-384+)**: 변수 참조, regex literal, 보간 있는
// 템플릿 리터럴, `$function` server-side JS, top-level BSON literal,
// nested 블록 코멘트.
//
// 본 모듈은 **순수 TS** 다 — React / DOM / Tauri IPC import 없음.
// Phase 28 의 `mongoshParser.ts` (method-whitelist 동반 parser) 는 그대로
// 유지되며, 본 AST 는 *statement classifier* 의 책임만 promote 한다.

// ---------------------------------------------------------------------------
// Public API — result types
// ---------------------------------------------------------------------------

export type MongoshErrorKind =
  | "unsupported-syntax"
  | "bson-literal"
  | "multiple-statements"
  | "variable-declaration"
  | "function-declaration"
  | "non-db-statement";

export interface MongoshAdminCommand {
  readonly kind: "admin-command";
  /** `runCommand` 또는 `adminCommand`. caller 가 dispatch 분기에 사용. */
  readonly commandName: "runCommand" | "adminCommand";
  /** 본문 (`{<command>: <arg>, ...options}`). JSON-compatible. */
  readonly body: Record<string, unknown>;
}

export interface MongoshCollectionCommand {
  readonly kind: "collection-command";
  readonly collection: string;
  readonly method: string;
  readonly args: readonly unknown[];
}

export interface MongoshParseError {
  readonly kind: "error";
  readonly errorKind: MongoshErrorKind;
  readonly message: string;
}

export type MongoshStatementResult =
  | MongoshAdminCommand
  | MongoshCollectionCommand
  | MongoshParseError;

/**
 * Parse a single mongosh statement and classify it into admin-command /
 * collection-command / error.
 *
 * Pure; never throws on user input. Non-string `input` returns an error
 * rather than panicking so a runtime type confusion in a consumer doesn't
 * crash the editor.
 */
export function parseMongoshStatement(input: string): MongoshStatementResult {
  if (typeof input !== "string") {
    return err("unsupported-syntax", "expected a string expression");
  }

  // Sprint 383 — head-keyword sniff *before* tokenisation. `let x = 1` would
  // otherwise hit `=` (not a recognised punct token) and bubble up as a
  // generic `unsupported-syntax` error, swallowing the more useful kind.
  // We strip leading comments / whitespace and inspect the first identifier.
  const headSniff = sniffHeadKeyword(input);
  if (headSniff) return headSniff;

  const tokenResult = tokenize(input);
  if (tokenResult.kind === "error") return tokenResult.error;
  const tokens = tokenResult.tokens;

  if (tokens.length === 0) {
    return err("unsupported-syntax", "expression is empty");
  }

  // Top-level semicolon — split into statements. A trailing `;` with nothing
  // after is fine (single statement). Anything else → multi-statement reject.
  const semicolons = topLevelSemicolons(tokens);
  if (semicolons.length > 0) {
    const lastSemi = semicolons[semicolons.length - 1]!;
    const afterLastSemi = tokens.slice(lastSemi + 1);
    // If there are tokens after any non-final `;` OR after the final `;`,
    // this is multi-statement.
    if (semicolons.length > 1 || afterLastSemi.length > 0) {
      // Special-case: head token is `let`/`const`/`var` → variable-declaration
      // takes precedence so the message can point at the actual issue.
      const head = tokens[0];
      if (
        head &&
        head.kind === "ident" &&
        VARIABLE_DECL_KEYWORDS.has(head.value)
      ) {
        return variableDeclarationError(head.value);
      }
      if (head && head.kind === "ident" && head.value === "function") {
        return functionDeclarationError();
      }
      return err(
        "multiple-statements",
        "multiple statements separated by `;` are not supported — submit one mongosh expression at a time",
      );
    }
    // Lone trailing `;` — drop it and continue.
    tokens.pop();
  }

  const stream = new TokenStream(tokens);
  return parseProgram(stream);
}

// ---------------------------------------------------------------------------
// Internal — token shape
// ---------------------------------------------------------------------------

type Token =
  | { kind: "ident"; value: string; pos: number }
  | { kind: "string"; value: string; pos: number }
  | { kind: "number"; value: number; pos: number }
  | { kind: "punct"; value: string; pos: number };

interface TokenizeOk {
  readonly kind: "ok";
  readonly tokens: Token[];
}
interface TokenizeErr {
  readonly kind: "error";
  readonly error: MongoshParseError;
}

const PUNCT_CHARS = new Set(["{", "}", "[", "]", "(", ")", ",", ":", ";", "."]);

// ---------------------------------------------------------------------------
// Internal — tokenizer
// ---------------------------------------------------------------------------

function tokenize(src: string): TokenizeOk | TokenizeErr {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }

    // Line comment `// ... \n`
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    // Block comment `/* ... */` — nested NOT supported (mongosh parity):
    // the lexer closes at the first `*/`, leaving any trailing `c */` as
    // garbage that the parser will then choke on.
    if (ch === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      if (i >= src.length) {
        return tokErr("unterminated /* ... */ comment");
      }
      i += 2;
      continue;
    }

    // Arrow function `=>` — explicit reject
    if (ch === "=" && src[i + 1] === ">") {
      return tokErr(
        "arrow functions (`=>`) are not supported — callbacks are outside scope",
      );
    }

    // Template literal — interpolation-free is treated as a plain string
    // (sprint-383). `${` inside the template rejects.
    if (ch === "`") {
      const result = readTemplate(src, i);
      if (result.kind === "error")
        return { kind: "error", error: result.error };
      tokens.push({ kind: "string", value: result.value, pos: i });
      i = result.next;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const result = readString(src, i, ch);
      if (result.kind === "error")
        return { kind: "error", error: result.error };
      tokens.push({ kind: "string", value: result.value, pos: i });
      i = result.next;
      continue;
    }

    // Number literal — leading `-` only if followed by a digit
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

    // Identifier (incl. `$`-prefixed)
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_$]/.test(src[j]!)) j++;
      tokens.push({ kind: "ident", value: src.slice(i, j), pos: i });
      i = j;
      continue;
    }

    if (PUNCT_CHARS.has(ch)) {
      tokens.push({ kind: "punct", value: ch, pos: i });
      i++;
      continue;
    }

    return tokErr(`unexpected character \`${ch}\` at offset ${i}`);
  }

  return { kind: "ok", tokens };
}

function readString(
  src: string,
  start: number,
  quote: string,
):
  | { kind: "ok"; value: string; next: number }
  | { kind: "error"; error: MongoshParseError } {
  let i = start + 1;
  let value = "";
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "\\") {
      const next = src[i + 1];
      if (next === undefined) {
        return {
          kind: "error",
          error: err("unsupported-syntax", "unterminated string escape"),
        };
      }
      if (next === "u") {
        const hex = src.slice(i + 2, i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          return {
            kind: "error",
            error: err("unsupported-syntax", "invalid \\u escape in string"),
          };
        }
        value += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        continue;
      }
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
    error: err("unsupported-syntax", "unterminated string literal"),
  };
}

function readTemplate(
  src: string,
  start: number,
):
  | { kind: "ok"; value: string; next: number }
  | { kind: "error"; error: MongoshParseError } {
  let i = start + 1;
  let value = "";
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "\\") {
      // Allow common escapes; unknown escapes pass through.
      const next = src[i + 1];
      if (next === undefined) {
        return {
          kind: "error",
          error: err(
            "unsupported-syntax",
            "unterminated template literal escape",
          ),
        };
      }
      const ESC: Record<string, string> = {
        n: "\n",
        r: "\r",
        t: "\t",
        "\\": "\\",
        "`": "`",
        $: "$",
      };
      value += ESC[next] ?? next;
      i += 2;
      continue;
    }
    if (ch === "$" && src[i + 1] === "{") {
      return {
        kind: "error",
        error: err(
          "unsupported-syntax",
          "template literal interpolation (`${...}`) is not supported — use string concatenation downstream",
        ),
      };
    }
    if (ch === "`") {
      return { kind: "ok", value, next: i + 1 };
    }
    value += ch;
    i++;
  }
  return {
    kind: "error",
    error: err("unsupported-syntax", "unterminated template literal"),
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

// ---------------------------------------------------------------------------
// Internal — token-stream + helpers
// ---------------------------------------------------------------------------

class TokenStream {
  private readonly tokens: readonly Token[];
  private idx = 0;
  constructor(tokens: readonly Token[]) {
    this.tokens = tokens;
  }
  peek(): Token | undefined {
    return this.tokens[this.idx];
  }
  peekAt(offset: number): Token | undefined {
    return this.tokens[this.idx + offset];
  }
  next(): Token | undefined {
    return this.tokens[this.idx++];
  }
  atEnd(): boolean {
    return this.idx >= this.tokens.length;
  }
  consumePunct(value: string): boolean {
    const tok = this.peek();
    if (!tok || tok.kind !== "punct" || tok.value !== value) return false;
    this.idx++;
    return true;
  }
  consumeIdent(value: string): boolean {
    const tok = this.peek();
    if (!tok || tok.kind !== "ident" || tok.value !== value) return false;
    this.idx++;
    return true;
  }
}

function topLevelSemicolons(tokens: readonly Token[]): number[] {
  const indices: number[] = [];
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (tok.kind !== "punct") continue;
    if (tok.value === "(" || tok.value === "[" || tok.value === "{") {
      depth++;
    } else if (tok.value === ")" || tok.value === "]" || tok.value === "}") {
      depth--;
    } else if (tok.value === ";" && depth === 0) {
      indices.push(i);
    }
  }
  return indices;
}

// ---------------------------------------------------------------------------
// Internal — statement parser
// ---------------------------------------------------------------------------

const VARIABLE_DECL_KEYWORDS = new Set(["var", "let", "const"]);

const FUNCTION_KEYWORDS = new Set(["function", "class"]);

const CONTROL_FLOW_KEYWORDS = new Set([
  "for",
  "while",
  "if",
  "return",
  "switch",
]);

const SHELL_HELPER_KEYWORDS = new Set(["use", "show"]);

const BSON_LITERAL_NAMES: ReadonlySet<string> = new Set([
  "ObjectId",
  "ISODate",
  "UUID",
  "NumberLong",
  "NumberDecimal",
  "BinData",
  "Decimal128",
]);

// BSON literals supported by sprint-383 — mapped to extended-JSON placeholder
// shapes. Backend `run_mongo_command` accepts these unchanged.
const BSON_PLACEHOLDER_KEY: Record<string, string> = {
  ObjectId: "$oid",
  ISODate: "$date",
  NumberLong: "$numberLong",
  Decimal128: "$numberDecimal",
  UUID: "$uuid",
};

// For BSON literals that store numeric/string values as a string (extended
// JSON convention: $numberLong / $numberDecimal carry a string).
const BSON_COERCE_TO_STRING: ReadonlySet<string> = new Set([
  "NumberLong",
  "Decimal128",
]);

function parseProgram(stream: TokenStream): MongoshStatementResult {
  const head = stream.peek();
  if (!head) {
    return err("unsupported-syntax", "expression is empty");
  }

  // Sprint 383 — differentiated rejection. Variable / function declarations
  // and bare non-db expressions get their own errorKind for the toolbar UI.
  if (head.kind === "ident" && VARIABLE_DECL_KEYWORDS.has(head.value)) {
    return variableDeclarationError(head.value);
  }
  if (head.kind === "ident" && FUNCTION_KEYWORDS.has(head.value)) {
    return functionDeclarationError();
  }
  // Other control-flow keywords still error with the legacy kind.
  if (head.kind === "ident" && CONTROL_FLOW_KEYWORDS.has(head.value)) {
    return err(
      "unsupported-syntax",
      `${head.value} control flow is not supported in the query tab`,
    );
  }
  // Reject `use admin` / `show dbs` shell helpers.
  if (head.kind === "ident" && SHELL_HELPER_KEYWORDS.has(head.value)) {
    return err(
      "unsupported-syntax",
      "shell helpers (`use`, `show`) are not supported — type a `db....` expression",
    );
  }

  if (head.kind !== "ident" || head.value !== "db") {
    // Sprint 383 — bare expressions (`1 + 1`, `"hello"`, `ObjectId(...)` at
    // top level) get the `non-db-statement` errorKind so callers can surface
    // a tailored message.
    return err(
      "non-db-statement",
      "expression must begin with `db.<...>` — bare expressions / literals are not run from the query tab",
    );
  }
  stream.next(); // consume `db`

  if (!stream.consumePunct(".")) {
    return err("unsupported-syntax", "expected `.` after `db`");
  }

  const firstTok = stream.next();
  if (!firstTok || firstTok.kind !== "ident") {
    return err(
      "unsupported-syntax",
      "expected an identifier after `db.` (collection name or `runCommand` / `adminCommand`)",
    );
  }

  // Admin command path: `db.runCommand(...)` / `db.adminCommand(...)`.
  if (firstTok.value === "runCommand" || firstTok.value === "adminCommand") {
    return parseAdminCommand(stream, firstTok.value);
  }

  // Collection command path: `db.<coll>.<method>(...)`.
  return parseCollectionCommand(stream, firstTok.value);
}

function parseAdminCommand(
  stream: TokenStream,
  commandName: "runCommand" | "adminCommand",
): MongoshStatementResult {
  if (!stream.consumePunct("(")) {
    return err("unsupported-syntax", `expected \`(\` after \`${commandName}\``);
  }
  // Empty arg list is a syntax error for runCommand.
  if (stream.consumePunct(")")) {
    return err(
      "unsupported-syntax",
      `${commandName}() requires a body object — got an empty argument list`,
    );
  }
  // The first (and only) arg MUST be an object literal.
  const head = stream.peek();
  if (!head || head.kind !== "punct" || head.value !== "{") {
    return err(
      "unsupported-syntax",
      `${commandName}(...) body must be an object literal like \`{ping: 1}\``,
    );
  }
  const bodyResult = parseValue(stream);
  if (bodyResult.kind === "error") return bodyResult.error;
  const body = bodyResult.value;
  if (!isPlainObject(body)) {
    return err(
      "unsupported-syntax",
      `${commandName}(...) body must be an object literal`,
    );
  }
  // Tolerate a trailing comma before `)`.
  stream.consumePunct(",");
  if (!stream.consumePunct(")")) {
    // If there's more content, it's an extra argument — admin commands take
    // exactly one body. (mongosh's real runCommand accepts opts as a second
    // arg, but sprint-381 invariant treats `db.runCommand` as single-body.)
    return err(
      "unsupported-syntax",
      `${commandName}(...) accepts exactly one body argument`,
    );
  }
  if (!stream.atEnd()) {
    return err(
      "unsupported-syntax",
      "unexpected trailing input after admin command",
    );
  }
  return { kind: "admin-command", commandName, body };
}

function parseCollectionCommand(
  stream: TokenStream,
  collection: string,
): MongoshStatementResult {
  if (!stream.consumePunct(".")) {
    return err("unsupported-syntax", "expected `.` after the collection name");
  }
  const methodTok = stream.next();
  if (!methodTok || methodTok.kind !== "ident") {
    return err(
      "unsupported-syntax",
      "expected a method name after the collection",
    );
  }
  const argsResult = parseArgList(stream, methodTok.value);
  if (argsResult.kind === "error") return argsResult.error;
  const args = argsResult.value;
  // Sprint 383 (sprint-382 review note 3) — trailing cursor-chain methods
  // (`.sort({...}).limit(10)`) are accepted lexically but their args are
  // discarded. The Phase 28 method-whitelist gate runs upstream, and the
  // dispatcher honors only the first method on a collection. Chain
  // semantics are routed through `aggregateDocuments` / `findDocuments`
  // server-side, not flattened in the client.
  while (stream.consumePunct(".")) {
    const chainTok = stream.next();
    if (!chainTok || chainTok.kind !== "ident") {
      return err(
        "unsupported-syntax",
        "expected a chain method name after `.`",
      );
    }
    const chainResult = parseArgList(stream, chainTok.value);
    if (chainResult.kind === "error") return chainResult.error;
  }
  if (!stream.atEnd()) {
    return err(
      "unsupported-syntax",
      "unexpected trailing input after collection command",
    );
  }
  return {
    kind: "collection-command",
    collection,
    method: methodTok.value,
    args,
  };
}

// Sprint 383 (sprint-382 review note 2) — shared arg-list parser used by both
// the main collection-method call and any trailing cursor-chain calls. Both
// paths accept the same `(arg1, arg2, ...)` shape with a tolerant trailing
// comma; centralising it removes ~30 LOC of duplication.
function parseArgList(
  stream: TokenStream,
  methodName: string,
):
  | { kind: "ok"; value: unknown[] }
  | { kind: "error"; error: MongoshParseError } {
  if (!stream.consumePunct("(")) {
    return {
      kind: "error",
      error: err(
        "unsupported-syntax",
        `expected \`(\` after method \`${methodName}\``,
      ),
    };
  }
  const args: unknown[] = [];
  if (stream.consumePunct(")")) {
    return { kind: "ok", value: args };
  }
  while (true) {
    const value = parseValue(stream);
    if (value.kind === "error") return { kind: "error", error: value.error };
    args.push(value.value);
    if (stream.consumePunct(",")) {
      // Tolerate trailing comma before `)`.
      if (stream.consumePunct(")")) return { kind: "ok", value: args };
      continue;
    }
    if (stream.consumePunct(")")) return { kind: "ok", value: args };
    const stray = stream.peek();
    return {
      kind: "error",
      error: err(
        "unsupported-syntax",
        stray
          ? `expected \`,\` or \`)\` in argument list, got \`${describeToken(stray)}\``
          : "unterminated argument list",
      ),
    };
  }
}

// ---------------------------------------------------------------------------
// Internal — value parser
// ---------------------------------------------------------------------------

type ParseValueResult =
  | { kind: "ok"; value: unknown }
  | { kind: "error"; error: MongoshParseError };

function parseValue(stream: TokenStream): ParseValueResult {
  const tok = stream.peek();
  if (!tok) {
    return {
      kind: "error",
      error: err("unsupported-syntax", "unexpected end of input"),
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
    // Sprint 383 — BSON literal as a *value* (call expression with a single
    // string/number arg). Five literals supported; others (BinData,
    // NumberDecimal alias) keep the legacy `bson-literal` rejection.
    if (BSON_LITERAL_NAMES.has(tok.value)) {
      return parseBsonLiteral(stream, tok.value);
    }
    return {
      kind: "error",
      error: err(
        "unsupported-syntax",
        `bare identifier \`${tok.value}\` is not supported in value position — variables aren't allowed`,
      ),
    };
  }
  return {
    kind: "error",
    error: err(
      "unsupported-syntax",
      `unexpected token \`${describeToken(tok)}\` in value position`,
    ),
  };
}

function parseBsonLiteral(stream: TokenStream, name: string): ParseValueResult {
  const placeholderKey = BSON_PLACEHOLDER_KEY[name];
  if (placeholderKey === undefined) {
    // Legacy unsupported BSON helper (e.g. BinData) — keep the explicit
    // `bson-literal` kind so callers can still surface a targeted message.
    stream.next();
    return {
      kind: "error",
      error: err(
        "bson-literal",
        `BSON literal \`${name}(...)\` is not supported`,
      ),
    };
  }
  // Consume the identifier; require a `(`.
  stream.next();
  if (!stream.consumePunct("(")) {
    return {
      kind: "error",
      error: err(
        "unsupported-syntax",
        `expected \`(\` after BSON literal \`${name}\``,
      ),
    };
  }
  // Empty arg → placeholder with null value (ObjectId() / ISODate()).
  if (stream.consumePunct(")")) {
    return {
      kind: "ok",
      value: { [placeholderKey]: null } as Record<string, unknown>,
    };
  }
  // Read exactly one primitive arg.
  const arg = stream.peek();
  if (!arg) {
    return {
      kind: "error",
      error: err("unsupported-syntax", `unterminated \`${name}(...)\``),
    };
  }
  let rawValue: string | number;
  if (arg.kind === "string") {
    rawValue = arg.value;
    stream.next();
  } else if (arg.kind === "number") {
    rawValue = arg.value;
    stream.next();
  } else {
    return {
      kind: "error",
      error: err(
        "unsupported-syntax",
        `\`${name}(...)\` accepts a single string or number literal — got \`${describeToken(arg)}\``,
      ),
    };
  }
  // Tolerate trailing comma.
  stream.consumePunct(",");
  if (!stream.consumePunct(")")) {
    // Either ≥2 args or extra junk → reject.
    return {
      kind: "error",
      error: err(
        "unsupported-syntax",
        `\`${name}(...)\` accepts exactly one argument`,
      ),
    };
  }
  // Normalise: NumberLong / Decimal128 store the value as a string per
  // extended-JSON convention; ObjectId / ISODate / UUID preserve the input.
  let normalised: string | number;
  if (BSON_COERCE_TO_STRING.has(name)) {
    normalised = typeof rawValue === "number" ? String(rawValue) : rawValue;
  } else {
    normalised = rawValue;
  }
  return {
    kind: "ok",
    value: { [placeholderKey]: normalised } as Record<string, unknown>,
  };
}

function parseObject(stream: TokenStream): ParseValueResult {
  if (!stream.consumePunct("{")) {
    return { kind: "error", error: err("unsupported-syntax", "expected `{`") };
  }
  const obj: Record<string, unknown> = {};
  if (stream.consumePunct("}")) {
    return { kind: "ok", value: obj };
  }
  while (true) {
    // Tolerate a trailing comma before `}` (mongosh accepts).
    if (stream.consumePunct("}")) {
      return { kind: "ok", value: obj };
    }
    const keyTok = stream.next();
    if (!keyTok) {
      return {
        kind: "error",
        error: err(
          "unsupported-syntax",
          "expected object key, got end of input",
        ),
      };
    }
    let key: string;
    if (keyTok.kind === "string" || keyTok.kind === "ident") {
      key = keyTok.value;
    } else {
      return {
        kind: "error",
        error: err(
          "unsupported-syntax",
          `expected object key, got \`${describeToken(keyTok)}\``,
        ),
      };
    }
    if (!stream.consumePunct(":")) {
      return {
        kind: "error",
        error: err(
          "unsupported-syntax",
          `expected \`:\` after key \`${key}\` — shorthand keys aren't supported`,
        ),
      };
    }
    const value = parseValue(stream);
    if (value.kind === "error") return value;
    obj[key] = value.value;
    if (stream.consumePunct(",")) continue;
    if (stream.consumePunct("}")) break;
    const stray = stream.peek();
    return {
      kind: "error",
      error: err(
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
  if (!stream.consumePunct("[")) {
    return { kind: "error", error: err("unsupported-syntax", "expected `[`") };
  }
  const arr: unknown[] = [];
  if (stream.consumePunct("]")) {
    return { kind: "ok", value: arr };
  }
  while (true) {
    if (stream.consumePunct("]")) {
      return { kind: "ok", value: arr };
    }
    const value = parseValue(stream);
    if (value.kind === "error") return value;
    arr.push(value.value);
    if (stream.consumePunct(",")) continue;
    if (stream.consumePunct("]")) break;
    const stray = stream.peek();
    return {
      kind: "error",
      error: err(
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
// Internal — small helpers
// ---------------------------------------------------------------------------

function describeToken(tok: Token): string {
  if (tok.kind === "string") return `"${tok.value}"`;
  return String(tok.value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Sprint 383 (sprint-382 review note 1) — single error helper. The previous
// `errMake`/`errRaw` pair was a no-op duplicate that obscured intent.
function err(errorKind: MongoshErrorKind, message: string): MongoshParseError {
  return { kind: "error", errorKind, message };
}

// Sprint 383 — strip leading whitespace + comments and inspect the first
// identifier. Returns a parse error if the head is a variable / function
// declaration; otherwise `null` so the main tokenizer/parser runs.
function sniffHeadKeyword(src: string): MongoshParseError | null {
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
      if (i >= src.length) return null; // tokenizer will surface the error.
      i += 2;
      continue;
    }
    break;
  }
  if (i >= src.length) return null;
  const headCh = src[i]!;
  // Bare-expression heuristic: a number, string, or boolean literal at the
  // top level is a `non-db-statement` (1 + 1, "hello", true). The tokenizer
  // would otherwise reject the `+` operator with a generic message.
  if (
    /[0-9]/.test(headCh) ||
    headCh === '"' ||
    headCh === "'" ||
    headCh === "`" ||
    (headCh === "-" && /[0-9]/.test(src[i + 1] ?? ""))
  ) {
    return err(
      "non-db-statement",
      "expression must begin with `db.<...>` — bare expressions / literals are not run from the query tab",
    );
  }
  // Identifier head — check for declaration keywords.
  if (!/[A-Za-z_$]/.test(headCh)) return null;
  let j = i + 1;
  while (j < src.length && /[A-Za-z0-9_$]/.test(src[j]!)) j++;
  const ident = src.slice(i, j);
  // Require a word boundary so `letMeIn` does NOT match `let`.
  const after = src[j];
  if (after !== undefined && /[A-Za-z0-9_$]/.test(after)) return null;
  if (VARIABLE_DECL_KEYWORDS.has(ident)) {
    return variableDeclarationError(ident);
  }
  if (FUNCTION_KEYWORDS.has(ident)) {
    return functionDeclarationError();
  }
  return null;
}

function variableDeclarationError(keyword: string): MongoshParseError {
  return err(
    "variable-declaration",
    `\`${keyword}\` declarations are not supported in the query tab — only db.* statements run here.`,
  );
}

function functionDeclarationError(): MongoshParseError {
  return err(
    "function-declaration",
    "Function declarations are not supported in the query tab.",
  );
}

function tokErr(message: string): TokenizeErr {
  return { kind: "error", error: err("unsupported-syntax", message) };
}
