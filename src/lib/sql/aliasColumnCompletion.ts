import { syntaxTree } from "@codemirror/language";
import type {
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import type { SQLNamespace } from "@codemirror/lang-sql";
import { parseFromContext } from "@lib/completion/shared";

/**
 * Sprint 294 (2026-05-14) — Slice B — alias-aware column completion for
 * the **mid-typing flow**.
 *
 * Why this source exists
 * ----------------------
 * `@codemirror/lang-sql`'s built-in `schemaCompletionSource` resolves
 * `<alias>.<column>` candidates only when the cursor's Statement already
 * contains the `FROM <table> <alias>` introducer. In the natural user
 * typing flow — `SELECT u.` typed *before* the matching `FROM users u` —
 * the alias map is empty, so the completion popup is empty.
 *
 * DataGrip / TablePlus solve this by scanning the whole buffer for any
 * `FROM <table> [AS] <alias>` (or `JOIN <table> [AS] <alias>`) pattern
 * and binding `<alias>` to `<table>`. This source does the same:
 *
 *   1. Walk the syntax tree at the cursor and bail on String / Number /
 *      LineComment / BlockComment surfaces (sprint-292 guard pattern —
 *      `updateColumnCompletionSource`).
 *   2. Check the cursor is sitting at `<alias>.<partial>` (the token to
 *      the left must be `.`, and the token before that must be an
 *      Identifier). If not, return `null`.
 *   3. Try to resolve `<alias>` first inside the cursor's Statement (so
 *      identical alias names defined in two statements bind to the
 *      *current* Statement's table). If found, use that.
 *   4. Otherwise, fall back to `parseFromContext` over the whole buffer
 *      — anywhere-scan. This is the path that lights up the mid-typing
 *      flow (FROM clause not yet entered in the current statement).
 *   5. Resolve the table's columns from the provided `SQLNamespace`
 *      (the same shape `useSqlAutocomplete` produces). Return `null` if
 *      the namespace is undefined or an array (legacy flat list).
 *
 * Conflict policy
 * ---------------
 * If the same alias name appears in two different statements, the
 * cursor's Statement wins. This matches lang-sql's behaviour for
 * fully-formed statements and is the least surprising default. See
 * `slice-B-execution-brief.md` (Assumptions / Risks).
 *
 * Out of scope (later slices / sprints)
 * -------------------------------------
 *   - 3+ JOIN, schema-qualified target, explicit `AS`, duplicate alias
 *     edge — Slice D.
 *   - Duplicate-candidate dedup with the built-in source — Slice E.
 *   - CTE / derived subquery — sprint-295.
 *
 * Wiring is done in Slice C (`SqlQueryEditor.tsx`); until then this
 * source is exercised only by its unit test.
 */
export function aliasColumnCompletionSource(
  getSchema: () => SQLNamespace | undefined,
): (context: CompletionContext) => CompletionResult | null {
  return (context) => {
    const schema = getSchema();
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
      return null;
    }

    const { state, pos } = context;
    const tree = syntaxTree(state);
    const node = tree.resolveInner(pos, -1);

    // Sprint 292 guard — never surface column candidates inside value
    // surfaces (strings, numbers, comments). Replicated verbatim.
    if (
      node.name === "String" ||
      node.name === "Number" ||
      node.name === "LineComment" ||
      node.name === "BlockComment"
    ) {
      return null;
    }

    // ── cursor must be at `<alias>.<partial>` ──────────────────────────
    // Look at the doc text immediately preceding the cursor:
    //   1. Optional partial identifier characters (`[A-Za-z0-9_]*`) —
    //      these will be the user's typed prefix we replace.
    //   2. A literal `.`.
    //   3. An identifier (possibly quoted with `"` or `` ` ``) — that's
    //      the alias.
    // If any step fails, this isn't an alias-dot position; return null.
    const aliasMatch = matchAliasDotPrefix(state.doc.sliceString(0, pos));
    if (!aliasMatch) return null;
    const { aliasName, partialFrom } = aliasMatch;

    // ── resolve alias → table ──────────────────────────────────────────
    // Prefer the alias map of the cursor's Statement so cross-statement
    // homonyms bind to the current statement. Fall back to anywhere-scan
    // (the mid-typing path) when the local statement doesn't know the
    // alias yet.
    const stmtRange = enclosingStatementRange(tree, pos);
    let tableName: string | undefined;
    if (stmtRange) {
      const stmtSql = state.doc.sliceString(stmtRange.from, stmtRange.to);
      const localAliases = parseFromContext(stmtSql).aliases;
      tableName = lookupAlias(localAliases, aliasName);
    }
    if (!tableName) {
      const bufferSql = state.doc.toString();
      const bufferAliases = parseFromContext(bufferSql).aliases;
      tableName = lookupAlias(bufferAliases, aliasName);
    }
    if (!tableName) return null;

    // ── resolve columns ────────────────────────────────────────────────
    const columns = resolveColumns(schema, tableName);
    if (columns.length === 0) return null;

    return {
      from: partialFrom,
      options: columns.map((name) => ({ label: name, type: "property" })),
      validFor: /^\w*$/,
    };
  };
}

/**
 * Returns the `{ from, to }` range of the Statement covering `pos`, or
 * `null` when the cursor sits in trailing whitespace past the last
 * Statement (lang-sql does not extend `Statement.to` through trailing
 * whitespace, so we walk the Script's direct children).
 */
function enclosingStatementRange(
  tree: ReturnType<typeof syntaxTree>,
  pos: number,
): { from: number; to: number } | null {
  const node = tree.resolveInner(pos, -1);
  if (node.name === "Script") {
    let child: typeof node | null = node.firstChild;
    let last: { from: number; to: number } | null = null;
    while (child) {
      if (child.name === "Statement" && child.from <= pos) {
        last = { from: child.from, to: child.to };
      }
      if (child.from > pos) break;
      child = child.nextSibling;
    }
    return last;
  }
  let cur: typeof node | null = node;
  while (cur && cur.name !== "Statement") {
    cur = cur.parent;
  }
  if (cur && cur.name === "Statement") {
    return { from: cur.from, to: cur.to };
  }
  return null;
}

interface AliasDotMatch {
  /** alias text as it appears in the buffer (unquoted, but case preserved). */
  aliasName: string;
  /** start offset of the user's partial identifier (after the dot). */
  partialFrom: number;
}

/**
 * Inspect the buffer text up to the cursor and decide whether the cursor
 * is at an `<alias>.<partial>` position. Returns null when the shape
 * doesn't match.
 *
 * Why a textual scan instead of a syntax-tree walk: the cursor's node
 * shape during mid-typing (`SELECT u.|`) varies by lang-sql parser state
 * — sometimes `CompositeIdentifier`, sometimes `Identifier`, sometimes
 * just trailing whitespace under `Script`. A short, deterministic
 * suffix scan is more robust and stays within the same `state.doc`
 * surface the user sees.
 */
function matchAliasDotPrefix(prefixText: string): AliasDotMatch | null {
  let i = prefixText.length;

  // Walk back over the optional partial identifier characters.
  const isIdentChar = (c: string) => /[A-Za-z0-9_]/.test(c);
  while (i > 0 && isIdentChar(prefixText[i - 1]!)) i--;
  const partialFrom = i;

  // Now expect a literal dot.
  if (i === 0 || prefixText[i - 1] !== ".") return null;
  i--; // consume the dot.

  // Now expect an identifier (alias). Support quoted forms `"foo"` / `` `foo` ``.
  if (i === 0) return null;
  const aliasEnd = i;
  const last = prefixText[i - 1]!;
  if (last === '"' || last === "`") {
    const quote = last;
    i--; // consume the closing quote.
    const closeAt = i;
    while (i > 0 && prefixText[i - 1] !== quote) i--;
    if (i === 0) return null; // unbalanced quote.
    const innerStart = i;
    i--; // consume the opening quote.
    const aliasName = prefixText.slice(innerStart, closeAt);
    if (!aliasName) return null;
    return { aliasName, partialFrom };
  }
  // Unquoted alias — walk back over identifier chars.
  while (i > 0 && isIdentChar(prefixText[i - 1]!)) i--;
  const aliasStart = i;
  const aliasName = prefixText.slice(aliasStart, aliasEnd);
  if (!aliasName || !/^[A-Za-z_]/.test(aliasName)) return null;
  return { aliasName, partialFrom };
}

/**
 * Look up an alias name in the parser's alias map, falling back to the
 * lowercased form for case-insensitive matching (SQL identifiers are
 * case-insensitive unless quoted).
 */
function lookupAlias(
  aliases: Record<string, string>,
  aliasName: string,
): string | undefined {
  if (aliases[aliasName]) return aliases[aliasName];
  const lower = aliasName.toLowerCase();
  for (const key of Object.keys(aliases)) {
    if (key.toLowerCase() === lower) return aliases[key];
  }
  return undefined;
}

function resolveColumns(schema: SQLNamespace, tableName: string): string[] {
  if (typeof schema !== "object" || Array.isArray(schema)) return [];
  const map = schema as Record<string, SQLNamespace>;
  const candidates = [tableName, tableName.toLowerCase()];
  for (const candidate of candidates) {
    const entry = map[candidate];
    if (!entry) continue;
    const cols = columnsFromEntry(entry);
    if (cols.length > 0) return cols;
  }
  return [];
}

function columnsFromEntry(entry: SQLNamespace): string[] {
  if (Array.isArray(entry)) return [];
  if (typeof entry !== "object") return [];
  const obj = entry as Record<string, unknown>;
  if ("self" in obj && "children" in obj) {
    const children = obj.children;
    if (children && typeof children === "object" && !Array.isArray(children)) {
      return Object.keys(children as Record<string, unknown>);
    }
    return [];
  }
  return Object.keys(obj);
}
