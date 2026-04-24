import { MONGO_ALL_OPERATORS } from "@lib/mongoAutocomplete";

export type MongoTokenKind =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "punct"
  | "whitespace"
  | "operator"
  | "identifier";

export interface MongoToken {
  kind: MongoTokenKind;
  text: string;
}

/**
 * Operator lookup set. Sprint 83 surfaces the canonical list via
 * `MONGO_ALL_OPERATORS`; we mirror it into a `Set` here so every token
 * classification is O(1). Sprint 85 consumes the exact same list to keep
 * the editor decoration and the history preview visually consistent.
 */
const OPERATOR_SET: ReadonlySet<string> = new Set<string>(MONGO_ALL_OPERATORS);

/**
 * Tokenize a JSON-ish MongoDB source string into a flat list of tokens
 * suitable for inline preview rendering. The tokenizer is deliberately
 * lenient — it recognises JSON structural tokens (strings, numbers,
 * booleans, null, punctuation), flags `$`-prefixed string literals whose
 * content appears in `MONGO_ALL_OPERATORS` as `"operator"`, and folds
 * everything else into `"identifier"` / `"whitespace"` / `"punct"`.
 *
 * The function is **non-throwing**: malformed JSON (unterminated strings,
 * truncated bodies, unexpected symbols) produces a best-effort partial
 * token stream and the remainder is consumed as raw identifier text so
 * callers can render history entries without wrapping the call in a
 * try/catch.
 */
export function tokenizeMongo(src: string): MongoToken[] {
  const tokens: MongoToken[] = [];
  let i = 0;
  const len = src.length;

  while (i < len) {
    const ch = src[i]!;

    // Whitespace — collapse runs into a single token so downstream
    // rendering preserves existing line breaks without creating a span per
    // character.
    if (/\s/.test(ch)) {
      let j = i;
      while (j < len && /\s/.test(src[j]!)) j++;
      tokens.push({ kind: "whitespace", text: src.slice(i, j) });
      i = j;
      continue;
    }

    // JSON string literal (including quoted property names). Handles
    // `\"` escapes. Unterminated strings consume to end-of-input so the
    // render path still emits a (malformed) span rather than throwing.
    if (ch === '"') {
      let j = i + 1;
      while (j < len) {
        const cur = src[j]!;
        if (cur === "\\" && j + 1 < len) {
          j += 2;
          continue;
        }
        if (cur === '"') {
          j++;
          break;
        }
        j++;
      }
      const text = src.slice(i, j);
      const inner = stripJsonQuotes(text);
      // Operator tagging — only fully quoted `"$name"` literals whose
      // inner text matches the operator vocabulary earn the `operator`
      // kind. Unterminated strings (no trailing quote) and plain JSON
      // strings fall back to the generic `string` kind.
      const fullyQuoted = text.length >= 2 && text.endsWith('"');
      const kind: MongoTokenKind =
        fullyQuoted && inner.startsWith("$") && OPERATOR_SET.has(inner)
          ? "operator"
          : "string";
      tokens.push({ kind, text });
      i = j;
      continue;
    }

    // Numeric literal — JSON numbers including optional sign, decimal
    // point, and exponent. Tolerant: we also accept a leading `+` and
    // stop at the first character that doesn't fit a number so malformed
    // tails degrade gracefully.
    if (ch === "-" || ch === "+" || (ch >= "0" && ch <= "9")) {
      const start = i;
      let j = i;
      if (src[j] === "-" || src[j] === "+") j++;
      let sawDigit = false;
      while (j < len && src[j]! >= "0" && src[j]! <= "9") {
        sawDigit = true;
        j++;
      }
      if (src[j] === ".") {
        j++;
        while (j < len && src[j]! >= "0" && src[j]! <= "9") {
          sawDigit = true;
          j++;
        }
      }
      if (src[j] === "e" || src[j] === "E") {
        j++;
        if (src[j] === "-" || src[j] === "+") j++;
        while (j < len && src[j]! >= "0" && src[j]! <= "9") {
          sawDigit = true;
          j++;
        }
      }
      if (sawDigit) {
        tokens.push({ kind: "number", text: src.slice(start, j) });
        i = j;
        continue;
      }
      // Bare sign without digits → treat as punctuation so the rest of
      // the stream can still be tokenised.
      tokens.push({ kind: "punct", text: ch });
      i++;
      continue;
    }

    // Keyword literals (`true`, `false`, `null`) — only when preceded by
    // a non-identifier boundary so we don't gobble `truely`-style mid-word
    // matches. JSON doesn't allow bare identifiers, but be permissive.
    if (ch === "t" && src.slice(i, i + 4) === "true") {
      const next = src[i + 4];
      if (!next || !/[A-Za-z0-9_]/.test(next)) {
        tokens.push({ kind: "boolean", text: "true" });
        i += 4;
        continue;
      }
    }
    if (ch === "f" && src.slice(i, i + 5) === "false") {
      const next = src[i + 5];
      if (!next || !/[A-Za-z0-9_]/.test(next)) {
        tokens.push({ kind: "boolean", text: "false" });
        i += 5;
        continue;
      }
    }
    if (ch === "n" && src.slice(i, i + 4) === "null") {
      const next = src[i + 4];
      if (!next || !/[A-Za-z0-9_]/.test(next)) {
        tokens.push({ kind: "null", text: "null" });
        i += 4;
        continue;
      }
    }

    // JSON structural punctuation.
    if (
      ch === "{" ||
      ch === "}" ||
      ch === "[" ||
      ch === "]" ||
      ch === ":" ||
      ch === ","
    ) {
      tokens.push({ kind: "punct", text: ch });
      i++;
      continue;
    }

    // Fallback: consume a run of identifier-ish characters into a single
    // `identifier` token so malformed input degrades gracefully without
    // exploding the token count.
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < len && /[A-Za-z0-9_$.]/.test(src[j]!)) j++;
      tokens.push({ kind: "identifier", text: src.slice(i, j) });
      i = j;
      continue;
    }

    // Anything else — a single-character punct fallback keeps the tokenizer
    // total over `string`.
    tokens.push({ kind: "punct", text: ch });
    i++;
  }

  return tokens;
}

function stripJsonQuotes(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1);
  }
  if (raw.length >= 1 && raw.startsWith('"')) {
    return raw.slice(1);
  }
  return raw;
}
