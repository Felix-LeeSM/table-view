// Sprint 384 (2026-05-17) — mongosh AST tokenizer + token-stream helpers.
//
// 작성 이유: sprint-383 의 1033 LOC `mongoshAst.ts` 가 max-lines soft cap
// (500) 을 두 배 초과했다. lexer (이 파일) / parser (`parser.ts`) /
// argList (`argList.ts`) 3개 + public re-export (`index.ts`) 4-파일로
// split — behavior 변경 0. 본 파일은 tokenizer + `Token` shape + `TokenStream`
// 만 export 한다. error 헬퍼 (`err`, `tokErr`, `describeToken`) 와
// public 결과 타입은 lexer / parser 양쪽에서 공유되므로 여기 둔다.

// ---------------------------------------------------------------------------
// Public API — result types (shared by parser; surfaced via index.ts)
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

// ---------------------------------------------------------------------------
// Internal — token shape
// ---------------------------------------------------------------------------

export type Token =
  | { kind: "ident"; value: string; pos: number }
  | { kind: "string"; value: string; pos: number }
  | { kind: "number"; value: number; pos: number }
  | { kind: "punct"; value: string; pos: number };

export interface TokenizeOk {
  readonly kind: "ok";
  readonly tokens: Token[];
}
export interface TokenizeErr {
  readonly kind: "error";
  readonly error: MongoshParseError;
}

const PUNCT_CHARS = new Set(["{", "}", "[", "]", "(", ")", ",", ":", ";", "."]);

// ---------------------------------------------------------------------------
// Internal — tokenizer
// ---------------------------------------------------------------------------

export function tokenize(src: string): TokenizeOk | TokenizeErr {
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

export class TokenStream {
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

export function topLevelSemicolons(tokens: readonly Token[]): number[] {
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
// Internal — small helpers shared by lexer + parser
// ---------------------------------------------------------------------------

export function describeToken(tok: Token): string {
  if (tok.kind === "string") return `"${tok.value}"`;
  return String(tok.value);
}

// Sprint 383 (sprint-382 review note 1) — single error helper. The previous
// `errMake`/`errRaw` pair was a no-op duplicate that obscured intent.
export function err(
  errorKind: MongoshErrorKind,
  message: string,
): MongoshParseError {
  return { kind: "error", errorKind, message };
}

export function tokErr(message: string): TokenizeErr {
  return { kind: "error", error: err("unsupported-syntax", message) };
}
