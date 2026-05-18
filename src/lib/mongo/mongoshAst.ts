// Sprint 382 (2026-05-17) — mongosh statement AST parser MVP.
//
// 작성 이유: sprint-381 의 정규식 기반 `classifyMongoStatement` /
// `extractAdminCommandBody` 는 statement 분류 + body 추출을 두 번의 정규식
// 패스로 처리한다. 본 모듈은 그 두 분석을 하나의 *typed AST* 위에서
// 통합한다.
//
// **Scope (sprint-382 contract)**:
//   1. `db.runCommand({...})` / `db.adminCommand({...})` admin command
//   2. `db.<collection>.<method>(<args>, ...)` collection command
//   3. object literal (identifier / quoted key, nested object / array,
//      string / number / boolean / null 값)
//   4. line comment `// ...` + block comment `/* ... */` strip
//   5. single statement only — `;` 로 구분된 두 번째 statement 는 거부
//
// **Out of scope (sprint-383)**: BSON literal (ObjectId/ISODate/...)
// → `bson-literal` 오류로 반환. 템플릿 리터럴, 화살표 함수, 변수 참조,
// 함수 / 클래스 선언, regex literal 도 동일하게 거부.
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
  | "multiple-statements";

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
    // Block comment `/* ... */`
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

    // Template literal — explicit reject (sprint-382 out-of-scope)
    if (ch === "`") {
      return tokErr(
        "template literals (`...`) are not supported — use single or double quoted strings",
      );
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
        return { kind: "error", error: errRaw("unterminated string escape") };
      }
      if (next === "u") {
        const hex = src.slice(i + 2, i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          return {
            kind: "error",
            error: errRaw("invalid \\u escape in string"),
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
  return { kind: "error", error: errRaw("unterminated string literal") };
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

const CONTROL_FLOW_KEYWORDS = new Set([
  "var",
  "let",
  "const",
  "for",
  "while",
  "if",
  "function",
  "class",
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

function parseProgram(stream: TokenStream): MongoshStatementResult {
  const head = stream.peek();
  if (!head) {
    return err("unsupported-syntax", "expression is empty");
  }

  // Reject control-flow / declaration keywords at the head.
  if (head.kind === "ident" && CONTROL_FLOW_KEYWORDS.has(head.value)) {
    return err(
      "unsupported-syntax",
      `${head.value} declarations / control flow are not supported`,
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
    return err(
      "unsupported-syntax",
      "expression must begin with `db.<...>` — bare expressions are not supported",
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
  if (!stream.consumePunct("(")) {
    return err(
      "unsupported-syntax",
      `expected \`(\` after method \`${methodTok.value}\``,
    );
  }
  const args: unknown[] = [];
  if (!stream.consumePunct(")")) {
    while (true) {
      const value = parseValue(stream);
      if (value.kind === "error") return value.error;
      args.push(value.value);
      if (stream.consumePunct(",")) continue;
      if (stream.consumePunct(")")) break;
      const stray = stream.peek();
      return err(
        "unsupported-syntax",
        stray
          ? `expected \`,\` or \`)\` in argument list, got \`${describeToken(stray)}\``
          : "unterminated argument list",
      );
    }
  }
  // Allow trailing cursor-chain (e.g., `.sort({...}).limit(10)`) — we parse
  // through but do not store; sprint-382 only classifies. Phase 28's
  // `mongoshParser.parseMongoshExpression` is the canonical parser for full
  // cursor-chain semantics.
  while (stream.consumePunct(".")) {
    const chainTok = stream.next();
    if (!chainTok || chainTok.kind !== "ident") {
      return err(
        "unsupported-syntax",
        "expected a chain method name after `.`",
      );
    }
    if (!stream.consumePunct("(")) {
      return err(
        "unsupported-syntax",
        `expected \`(\` after chain method \`${chainTok.value}\``,
      );
    }
    if (!stream.consumePunct(")")) {
      while (true) {
        const value = parseValue(stream);
        if (value.kind === "error") return value.error;
        if (stream.consumePunct(",")) continue;
        if (stream.consumePunct(")")) break;
        const stray = stream.peek();
        return err(
          "unsupported-syntax",
          stray
            ? `expected \`,\` or \`)\` in chain argument list, got \`${describeToken(stray)}\``
            : "unterminated chain argument list",
        );
      }
    }
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

// ---------------------------------------------------------------------------
// Internal — value parser
// ---------------------------------------------------------------------------

type ParseValueResult =
  | { kind: "ok"; value: unknown }
  | { kind: "error"; error: MongoshParseError };

function parseValue(stream: TokenStream): ParseValueResult {
  const tok = stream.peek();
  if (!tok) {
    return { kind: "error", error: errRaw("unexpected end of input") };
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
    if (BSON_LITERAL_NAMES.has(tok.value)) {
      return {
        kind: "error",
        error: errMake(
          "bson-literal",
          `BSON literal \`${tok.value}(...)\` is not yet supported (sprint-383)`,
        ),
      };
    }
    return {
      kind: "error",
      error: errRaw(
        `bare identifier \`${tok.value}\` is not supported in value position — variables aren't allowed`,
      ),
    };
  }
  return {
    kind: "error",
    error: errRaw(
      `unexpected token \`${describeToken(tok)}\` in value position`,
    ),
  };
}

function parseObject(stream: TokenStream): ParseValueResult {
  if (!stream.consumePunct("{")) {
    return { kind: "error", error: errRaw("expected `{`") };
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
        error: errRaw("expected object key, got end of input"),
      };
    }
    let key: string;
    if (keyTok.kind === "string" || keyTok.kind === "ident") {
      key = keyTok.value;
    } else {
      return {
        kind: "error",
        error: errRaw(`expected object key, got \`${describeToken(keyTok)}\``),
      };
    }
    if (!stream.consumePunct(":")) {
      return {
        kind: "error",
        error: errRaw(
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
      error: errRaw(
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
    return { kind: "error", error: errRaw("expected `[`") };
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
      error: errRaw(
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

function err(errorKind: MongoshErrorKind, message: string): MongoshParseError {
  return { kind: "error", errorKind, message };
}

function errMake(
  errorKind: MongoshErrorKind,
  message: string,
): MongoshParseError {
  return { kind: "error", errorKind, message };
}

function errRaw(message: string): MongoshParseError {
  return { kind: "error", errorKind: "unsupported-syntax", message };
}

function tokErr(message: string): TokenizeErr {
  return { kind: "error", error: errRaw(message) };
}
