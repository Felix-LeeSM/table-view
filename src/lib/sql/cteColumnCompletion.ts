import { syntaxTree } from "@codemirror/language";
import type {
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import type { SQLNamespace } from "@codemirror/lang-sql";
import { tokenizeSql, type SqlToken } from "@lib/sql/sqlTokenize";

/**
 * Sprint 295 (2026-05-14) — Slice B — CTE / derived subquery column source.
 *
 * Why this source exists
 * ----------------------
 * Sprint 292 (Level-1 single-table) + Sprint 294 (Level-2 alias-aware JOIN)
 * resolve `<alias>.<column>` candidates only when the alias binds to a
 * **real** base table in the namespace. They miss two patterns external
 * IDEs (DataGrip / TablePlus) handle out of the box:
 *
 *   1. **CTE**: `WITH t AS (SELECT id, name FROM users) SELECT t.<cursor>`
 *      — `t` is a virtual table whose virtual columns are the projection
 *      list of the inner SELECT.
 *   2. **Derived subquery**: `SELECT sub.<cursor> FROM (SELECT id, total
 *      FROM orders) sub` — `sub` is a virtual table whose columns are the
 *      inner SELECT's projection list.
 *
 * Sprint 294's `parseFromContext` walks tokens with a flat scanner and
 * never descends into the inner SELECT inside parentheses, so the inner
 * projection list is invisible to it. This source closes that gap with a
 * paren-depth-aware mini-parser.
 *
 * Mini-parser overview
 * --------------------
 * The parser does ONE pass over the buffer's tokens (whitespace/comments
 * filtered out) and tracks a single integer `depth`. It emits a map of
 * `virtualAlias → columnNames[]` covering both CTE and derived subquery
 * patterns.
 *
 *   1. **paren depth**: `(` increments, `)` decrements. Top-level
 *      statements live at depth 0; inner SELECTs at depth ≥ 1.
 *   2. **CTE extraction**: at depth 0 when we hit the `WITH` keyword, we
 *      enter a loop that repeats for each comma-separated CTE binding:
 *      `<name> [(col, ...)] AS ( <inner-select> )`. The inner SELECT is
 *      captured by finding the matching `)` via depth tracking. If the
 *      CTE declares an explicit column list, we use it directly;
 *      otherwise we extract columns from the inner SELECT's projection
 *      list.
 *   3. **Derived subquery extraction**: at any depth, when we see a
 *      `FROM` or `JOIN` keyword followed by `(`, we capture the inner
 *      SELECT to its matching `)` (depth-aware), then read the optional
 *      `[AS] <alias>` that follows, binding the alias to the inner
 *      SELECT's projection list. This works recursively because we keep
 *      scanning the outer stream after registering the alias — any
 *      nested derived subqueries discovered while scanning the outer
 *      run end up registered too, but for the **outer** alias we only
 *      look at the outermost SELECT's projection (correct behaviour for
 *      `(SELECT id FROM (SELECT id FROM users) inner) outer` — outer's
 *      virtual column is `id`).
 *   4. **Projection extraction**: given an inner SELECT span (the tokens
 *      after the `SELECT` keyword and before the matching `FROM` keyword
 *      at the same relative depth), split into comma-separated items at
 *      the projection-relative depth=0, then resolve each item:
 *        - `col AS alias`  → `alias`
 *        - `tbl.col`        → `col`
 *        - `col`            → `col`
 *        - `*`              → ignored (Slice D handles SELECT * fallback)
 *
 * Guards
 * ------
 *   - `getSchema()` undefined / array (legacy flat list) → `null`.
 *   - cursor inside String / Number / LineComment / BlockComment → `null`
 *     (sprint-292 / 294 pattern).
 *   - cursor not at `<alias>.<partial>` → `null`.
 *   - alias resolved but not in the virtual table map → `null`. (This
 *     lets sprint-294's alias source handle real base-table aliases.)
 *
 * Out of scope (Slice D)
 * ----------------------
 *   - `SELECT *` inside the CTE → fallback to inner FROM base table.
 *   - `WITH RECURSIVE` explicit column list nuances.
 *   - CTE referencing another CTE (chaining beyond a single step).
 *   - CTE / base table name conflict resolution (CTE wins) — verified
 *     in Slice E.
 *
 * Wiring is done in Slice C (`SqlQueryEditor.tsx`); until then this
 * source is exercised via the unit test below and the level-3 baseline
 * test's `callAll` helper.
 */
export function cteColumnCompletionSource(
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

    // sprint-292 / 294 guard — never surface column candidates inside
    // value surfaces (strings / numbers / comments).
    if (
      node.name === "String" ||
      node.name === "Number" ||
      node.name === "LineComment" ||
      node.name === "BlockComment"
    ) {
      return null;
    }

    // ── cursor must be at `<alias>.<partial>` ──────────────────────────
    const aliasMatch = matchAliasDotPrefix(state.doc.sliceString(0, pos));
    if (!aliasMatch) return null;
    const { aliasName, partialFrom } = aliasMatch;

    // ── build the virtual table map over the whole buffer ──────────────
    // Pass the namespace through so the mini-parser can resolve
    // `SELECT *` projections to the inner FROM's base table columns
    // (Slice D — D1 SELECT * fallback, D4 schema-qualified inner table,
    // D7 CTE chaining single-level).
    const virtualTables = extractVirtualTables(state.doc.toString(), schema);
    const columns = lookupVirtualColumns(virtualTables, aliasName);
    if (!columns || columns.length === 0) return null;

    return {
      from: partialFrom,
      options: columns.map((name) => ({ label: name, type: "property" })),
      validFor: /^\w*$/,
    };
  };
}

interface AliasDotMatch {
  aliasName: string;
  partialFrom: number;
}

/**
 * Inspect the doc text up to the cursor and decide whether the cursor is
 * at an `<alias>.<partial>` position. Mirrors the textual-scan approach
 * sprint-294 uses (more robust than syntax-tree shape during mid-typing).
 */
function matchAliasDotPrefix(prefixText: string): AliasDotMatch | null {
  let i = prefixText.length;
  const isIdentChar = (c: string) => /[A-Za-z0-9_]/.test(c);
  while (i > 0 && isIdentChar(prefixText[i - 1]!)) i--;
  const partialFrom = i;

  if (i === 0 || prefixText[i - 1] !== ".") return null;
  i--; // consume dot

  if (i === 0) return null;
  const aliasEnd = i;
  const last = prefixText[i - 1]!;
  if (last === '"' || last === "`") {
    const quote = last;
    i--;
    const closeAt = i;
    while (i > 0 && prefixText[i - 1] !== quote) i--;
    if (i === 0) return null;
    const innerStart = i;
    i--;
    const aliasName = prefixText.slice(innerStart, closeAt);
    if (!aliasName) return null;
    return { aliasName, partialFrom };
  }
  while (i > 0 && isIdentChar(prefixText[i - 1]!)) i--;
  const aliasStart = i;
  const aliasName = prefixText.slice(aliasStart, aliasEnd);
  if (!aliasName || !/^[A-Za-z_]/.test(aliasName)) return null;
  return { aliasName, partialFrom };
}

/**
 * Look up an alias name in the virtual table map, falling back to
 * lowercased form for case-insensitive matching (SQL identifiers are
 * case-insensitive unless quoted).
 */
function lookupVirtualColumns(
  virtualTables: Map<string, string[]>,
  aliasName: string,
): string[] | undefined {
  const direct = virtualTables.get(aliasName);
  if (direct) return direct;
  const lower = aliasName.toLowerCase();
  for (const [key, value] of virtualTables) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

/**
 * Walk the buffer's tokens with a single paren-depth counter and emit a
 * map of `alias → projection column names` covering both CTE and derived
 * subquery patterns. See the module header for the full algorithm.
 *
 * Slice D (sprint-295, 2026-05-14) — the optional `schema` parameter is
 * the namespace passed by the completion source. It is consulted when
 * the inner SELECT projects `*` (SELECT * fallback → inner FROM's base
 * table columns), and the dotted-identifier coalescing reused from
 * sprint-294 makes schema-qualified inner tables (`public.users`)
 * resolve correctly. CTE chaining (single level: `b AS (SELECT * FROM
 * a)` inherits a's columns) is handled by consulting the partially-built
 * `out` map for already-registered CTE aliases.
 */
export function extractVirtualTables(
  sql: string,
  schema?: SQLNamespace,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!sql) return out;
  const all = tokenizeSql(sql);
  // Build an index that maps each meaningful-token position to the
  // surrounding paren depth as the scanner walks left-to-right. We keep
  // the original `all` (with whitespace/comment) only for stripping
  // identifier quotes; otherwise we operate on the meaningful token
  // stream.
  const tokens = all.filter(
    (t) => t.kind !== "whitespace" && t.kind !== "comment",
  );

  // Compute the paren depth BEFORE each token.
  const depthBefore: number[] = new Array(tokens.length).fill(0);
  {
    let d = 0;
    for (let i = 0; i < tokens.length; i++) {
      depthBefore[i] = d;
      const t = tokens[i]!;
      if (t.kind === "punct" && t.text === "(") d++;
      else if (t.kind === "punct" && t.text === ")") d = Math.max(0, d - 1);
    }
  }

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const upper = tok.kind === "keyword" ? tok.text.toUpperCase() : "";

    // ── CTE extraction: top-level `WITH` keyword ─────────────────────
    if (depthBefore[i] === 0 && tok.kind === "keyword" && upper === "WITH") {
      i = extractCtes(tokens, i + 1, depthBefore, out, schema);
      continue;
    }

    // ── Derived subquery: FROM / JOIN at any depth, followed by `(` ─
    if (tok.kind === "keyword" && (upper === "FROM" || upper === "JOIN")) {
      // Skip JOIN qualifiers like LEFT/RIGHT/INNER/OUTER/CROSS — they
      // appear BEFORE the JOIN keyword, not after, so no extra handling
      // is needed: when we see the actual JOIN keyword, the next
      // meaningful token is the table or `(`.
      const next = tokens[i + 1];
      if (next && next.kind === "punct" && next.text === "(") {
        // Find matching `)` for this `(`.
        const openIdx = i + 1;
        const closeIdx = findMatchingParen(tokens, openIdx);
        if (closeIdx === -1) continue;
        const columns = extractProjectionColumns(
          tokens,
          openIdx + 1,
          closeIdx - 1,
          schema,
          out,
        );
        // After the `)` look for `[AS] <alias>`.
        let k = closeIdx + 1;
        const maybeAs = tokens[k];
        if (
          maybeAs &&
          maybeAs.kind === "keyword" &&
          maybeAs.text.toUpperCase() === "AS"
        ) {
          k++;
        }
        const aliasTok = tokens[k];
        if (aliasTok && isAliasToken(aliasTok)) {
          const aliasName = stripIdentifierQuotes(aliasTok.text);
          if (aliasName && columns.length > 0) {
            out.set(aliasName, columns);
          }
        }
        // Continue scanning AFTER the alias slot so nested derived
        // subqueries inside the inner SELECT also get processed by the
        // outer for-loop (the next iteration's `i++` lands beyond the
        // alias but inside the run that already-iterated tokens did
        // not consume — depthBefore tracks them already, and the FROM
        // keyword inside the inner SELECT will trigger this branch
        // again on its own). We do NOT jump `i` past the close paren
        // here because we want the outer loop to keep visiting tokens
        // inside the inner select (for nested derived registration).
      }
    }
  }

  return out;
}

/**
 * Extract CTE bindings starting at `start` (the token after `WITH`).
 * Consumes: `[RECURSIVE] <name> [(col, ...)] AS ( ... )  [, <name2> ...]*`.
 * Returns the index of the last consumed token (so the caller's loop
 * resumes from `i + 1`).
 *
 * Slice D (sprint-295) — `schema` is threaded through so each CTE's
 * inner SELECT can resolve `*` to base-table columns. The partially
 * built `out` map is also passed so a later CTE that does
 * `SELECT * FROM <earlier-cte>` inherits its columns (single-level
 * chaining).
 */
function extractCtes(
  tokens: SqlToken[],
  start: number,
  depthBefore: number[],
  out: Map<string, string[]>,
  schema?: SQLNamespace,
): number {
  let i = start;
  // Optional `RECURSIVE` keyword.
  const maybeRec = tokens[i];
  if (
    maybeRec &&
    maybeRec.kind === "keyword" &&
    maybeRec.text.toUpperCase() === "RECURSIVE"
  ) {
    i++;
  }

  while (i < tokens.length) {
    const nameTok = tokens[i];
    if (!nameTok || nameTok.kind !== "identifier") {
      return i > 0 ? i - 1 : 0;
    }
    const cteName = stripIdentifierQuotes(nameTok.text);
    i++;

    // Optional explicit column list `(col, col, ...)`.
    let explicitCols: string[] | null = null;
    const maybeOpen = tokens[i];
    if (maybeOpen && maybeOpen.kind === "punct" && maybeOpen.text === "(") {
      const openIdx = i;
      const closeIdx = findMatchingParen(tokens, openIdx);
      // To distinguish the explicit column list from the body parens, we
      // peek the next meaningful token after `)`: if it is the `AS`
      // keyword, then this paren run was the column list (because the
      // body parens always come AFTER `AS`).
      if (closeIdx !== -1) {
        const afterClose = tokens[closeIdx + 1];
        if (
          afterClose &&
          afterClose.kind === "keyword" &&
          afterClose.text.toUpperCase() === "AS"
        ) {
          explicitCols = extractIdentifierList(
            tokens,
            openIdx + 1,
            closeIdx - 1,
          );
          i = closeIdx + 1;
        }
      }
    }

    // Expect `AS` keyword.
    const asTok = tokens[i];
    if (
      !asTok ||
      asTok.kind !== "keyword" ||
      asTok.text.toUpperCase() !== "AS"
    ) {
      // Malformed — stop processing this WITH run.
      return i;
    }
    i++;

    // Expect `(`.
    const bodyOpen = tokens[i];
    if (!bodyOpen || bodyOpen.kind !== "punct" || bodyOpen.text !== "(") {
      return i;
    }
    const bodyOpenIdx = i;
    const bodyCloseIdx = findMatchingParen(tokens, bodyOpenIdx);
    if (bodyCloseIdx === -1) {
      return i;
    }

    // Resolve columns: explicit > inner projection.
    // Slice D (sprint-295) — when the inner projection is `SELECT *`,
    // the projection extractor consults the namespace + earlier CTEs
    // (via the partially-built `out` map) to fall back to the inner
    // FROM's base-table columns or inherit from an earlier CTE.
    let cols: string[];
    if (explicitCols && explicitCols.length > 0) {
      cols = explicitCols;
    } else {
      cols = extractProjectionColumns(
        tokens,
        bodyOpenIdx + 1,
        bodyCloseIdx - 1,
        schema,
        out,
      );
    }
    if (cteName && cols.length > 0) {
      out.set(cteName, cols);
    }

    // Advance past the body `)`.
    i = bodyCloseIdx + 1;

    // Continue if comma; otherwise this WITH run is done.
    const sep = tokens[i];
    if (sep && sep.kind === "punct" && sep.text === ",") {
      // Only honour the comma if we're still at the same top-level
      // depth as the CTE name was (depthBefore tracks BEFORE the
      // token, so a comma at depth 0 means we're back outside the
      // body parens).
      if (depthBefore[i] === 0) {
        i++;
        continue;
      }
    }
    return i - 1;
  }

  return i - 1;
}

/**
 * Find the index of the `)` that matches the `(` at `openIdx`. Returns
 * `-1` when no match exists (unbalanced).
 */
function findMatchingParen(tokens: SqlToken[], openIdx: number): number {
  if (
    !tokens[openIdx] ||
    tokens[openIdx]!.kind !== "punct" ||
    tokens[openIdx]!.text !== "("
  ) {
    return -1;
  }
  let depth = 1;
  for (let i = openIdx + 1; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind === "punct" && t.text === "(") depth++;
    else if (t.kind === "punct" && t.text === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Given a token range that represents the body of an inner SELECT (so it
 * starts with the `SELECT` keyword and contains at least one `FROM` at
 * the same relative depth), extract the projection column names.
 *
 * Algorithm:
 *   1. Skip leading whitespace-equivalents (we operate on filtered
 *      tokens so there is none).
 *   2. Expect `SELECT` keyword at the start of the range. If missing,
 *      return [].
 *   3. Walk forward until we find a `FROM` keyword at the relative
 *      depth where SELECT was seen (i.e. depth-from-range-start = 0).
 *      Record the projection slice `[startProj, beforeFrom)`.
 *   4. Split the projection by commas at depth 0.
 *   5. For each item: extract the column name (alias if `AS` present,
 *      else last identifier).
 *
 * Slice D (sprint-295, 2026-05-14) — when the projection is the single
 * `*` token (SELECT *), look at the inner FROM clause's base table and
 * return that table's columns from the namespace. Schema-qualified
 * inner tables (`public.users`) are coalesced into a dotted name and
 * the **last** segment (rightmost) is used for namespace lookup, which
 * matches sprint-294's dotted-identifier coalescing pattern. If the
 * inner FROM names an already-registered CTE alias, inherit that
 * alias's columns (CTE chaining, single level).
 */
function extractProjectionColumns(
  tokens: SqlToken[],
  rangeStart: number,
  rangeEnd: number,
  schema?: SQLNamespace,
  knownVirtual?: Map<string, string[]>,
): string[] {
  // rangeEnd is inclusive.
  if (rangeStart > rangeEnd) return [];

  // Find the SELECT keyword at relative depth 0.
  let i = rangeStart;
  let depth = 0;
  let selectIdx = -1;
  while (i <= rangeEnd) {
    const t = tokens[i]!;
    if (t.kind === "punct" && t.text === "(") depth++;
    else if (t.kind === "punct" && t.text === ")") depth--;
    else if (
      depth === 0 &&
      t.kind === "keyword" &&
      t.text.toUpperCase() === "SELECT"
    ) {
      selectIdx = i;
      break;
    }
    i++;
  }
  if (selectIdx === -1) return [];

  // Walk forward looking for FROM at relative depth 0 (relative to
  // SELECT). Skip optional `DISTINCT` / `ALL` immediately after SELECT.
  let projStart = selectIdx + 1;
  const maybeDistinct = tokens[projStart];
  if (
    maybeDistinct &&
    maybeDistinct.kind === "keyword" &&
    (maybeDistinct.text.toUpperCase() === "DISTINCT" ||
      maybeDistinct.text.toUpperCase() === "ALL")
  ) {
    projStart++;
  }

  let projEnd = -1;
  let fromIdx = -1;
  depth = 0;
  for (let j = projStart; j <= rangeEnd; j++) {
    const t = tokens[j]!;
    if (t.kind === "punct" && t.text === "(") depth++;
    else if (t.kind === "punct" && t.text === ")") depth--;
    else if (
      depth === 0 &&
      t.kind === "keyword" &&
      t.text.toUpperCase() === "FROM"
    ) {
      projEnd = j - 1;
      fromIdx = j;
      break;
    }
  }
  // No FROM (e.g. `SELECT 1`) — treat the whole tail as projection.
  if (projEnd === -1) projEnd = rangeEnd;
  if (projStart > projEnd) return [];

  // ── Slice D D1: SELECT * fallback ─────────────────────────────────
  // If the projection is exactly the single `*` token, look up the
  // inner FROM's base table in the namespace (or in the known-virtual
  // map for single-step CTE chaining).
  if (
    projStart === projEnd &&
    tokens[projStart]!.kind === "punct" &&
    tokens[projStart]!.text === "*"
  ) {
    if (fromIdx === -1) return [];
    const baseName = readBaseTableAfterFrom(tokens, fromIdx + 1, rangeEnd);
    if (!baseName) return [];
    // CTE chaining (Slice D D7) — earlier CTE wins over namespace
    // lookup so `b AS (SELECT * FROM a)` inherits a's projection
    // even if a's name shadows a real base table (Slice D D6).
    if (knownVirtual) {
      const inherited = lookupVirtualColumns(knownVirtual, baseName);
      if (inherited && inherited.length > 0) return inherited;
    }
    if (schema) {
      return resolveBaseTableColumns(schema, baseName);
    }
    return [];
  }

  // Split projection by commas at depth 0.
  const items: Array<{ from: number; to: number }> = [];
  let itemStart = projStart;
  depth = 0;
  for (let j = projStart; j <= projEnd; j++) {
    const t = tokens[j]!;
    if (t.kind === "punct" && t.text === "(") depth++;
    else if (t.kind === "punct" && t.text === ")") depth--;
    else if (depth === 0 && t.kind === "punct" && t.text === ",") {
      items.push({ from: itemStart, to: j - 1 });
      itemStart = j + 1;
    }
  }
  if (itemStart <= projEnd) {
    items.push({ from: itemStart, to: projEnd });
  }

  const columns: string[] = [];
  for (const { from, to } of items) {
    const name = projectionItemName(tokens, from, to);
    if (name) columns.push(name);
  }
  return columns;
}

/**
 * Slice D (sprint-295, 2026-05-14) — read the base table name after a
 * `FROM` keyword inside an inner SELECT. Handles schema-qualified names
 * like `public.users` (returns the last segment so namespace lookup hits
 * the table key) and quoted identifiers. Returns `null` if no
 * identifier follows (e.g. `FROM (subquery)` — that case is handled by
 * the outer scanner registering the subquery alias separately).
 */
function readBaseTableAfterFrom(
  tokens: SqlToken[],
  start: number,
  rangeEnd: number,
): string | null {
  if (start > rangeEnd) return null;
  const first = tokens[start];
  if (!first || first.kind !== "identifier") return null;
  // Sprint 294's dotted-identifier coalescing — `tenant.schema.tbl`.
  let last = start;
  while (
    last + 2 <= rangeEnd &&
    tokens[last + 1]?.kind === "punct" &&
    tokens[last + 1]?.text === "." &&
    tokens[last + 2]?.kind === "identifier"
  ) {
    last += 2;
  }
  // Take the rightmost segment for lookup (sprint-294 pattern — the
  // namespace key is the bare table name; the schema/db segments are
  // discarded for lookup purposes).
  return stripIdentifierQuotes(tokens[last]!.text);
}

/**
 * Slice D (sprint-295, 2026-05-14) — given a `SQLNamespace` and a base
 * table name, return that table's column names. The namespace shape is
 * recursive (`Record<string, SQLNamespace | …>`); the convention used
 * elsewhere in this codebase is `{ tableName: { col1: {}, col2: {} } }`.
 * We do a case-insensitive lookup matching the rest of the source's
 * behaviour (`lookupVirtualColumns`).
 */
function resolveBaseTableColumns(
  schema: SQLNamespace,
  tableName: string,
): string[] {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return [];
  }
  const entries = Object.entries(schema as Record<string, unknown>);
  const lower = tableName.toLowerCase();
  let match: unknown = undefined;
  for (const [key, value] of entries) {
    if (key === tableName || key.toLowerCase() === lower) {
      match = value;
      break;
    }
  }
  if (!match) return [];
  // The matched value may be a `{ self, children }` shape (lang-sql's
  // verbose form) or a plain record (`{ col: {} }`). For our usage the
  // plain record is the dominant shape — sprint-292/294 tests and
  // production wire-up both use it.
  if (typeof match === "object" && match !== null && !Array.isArray(match)) {
    // Lang-sql verbose form: `{ self: { label, type }, children: [...] }`.
    const verbose = match as { self?: unknown; children?: unknown };
    if (Array.isArray(verbose.children)) {
      const cols: string[] = [];
      for (const child of verbose.children) {
        if (
          typeof child === "object" &&
          child !== null &&
          "label" in child &&
          typeof (child as { label: unknown }).label === "string"
        ) {
          cols.push((child as { label: string }).label);
        }
      }
      if (cols.length > 0) return cols;
    }
    return Object.keys(match as Record<string, unknown>);
  }
  if (Array.isArray(match)) {
    // Flat-list form: `[{ label, type }, ...]`.
    const cols: string[] = [];
    for (const entry of match) {
      if (
        typeof entry === "object" &&
        entry !== null &&
        "label" in entry &&
        typeof (entry as { label: unknown }).label === "string"
      ) {
        cols.push((entry as { label: string }).label);
      }
    }
    return cols;
  }
  return [];
}

/**
 * Resolve the emitted column name for one projection item:
 *   - `<expr> AS <alias>`  → `<alias>`
 *   - `<tbl>.<col>`         → `<col>`
 *   - `<col>`                → `<col>`
 *   - `*`                    → ignored (slice D)
 */
function projectionItemName(
  tokens: SqlToken[],
  from: number,
  to: number,
): string | null {
  if (from > to) return null;

  // Look for `AS <alias>` at relative depth 0.
  let depth = 0;
  for (let i = from; i <= to; i++) {
    const t = tokens[i]!;
    if (t.kind === "punct" && t.text === "(") depth++;
    else if (t.kind === "punct" && t.text === ")") depth--;
    else if (
      depth === 0 &&
      t.kind === "keyword" &&
      t.text.toUpperCase() === "AS"
    ) {
      const next = tokens[i + 1];
      if (next && next.kind === "identifier") {
        return stripIdentifierQuotes(next.text);
      }
      return null;
    }
  }

  // No `AS`. Take the last identifier in the item (handles `tbl.col`
  // → `col` because the tokeniser splits the dot into a `punct`).
  for (let i = to; i >= from; i--) {
    const t = tokens[i]!;
    if (t.kind === "identifier") {
      return stripIdentifierQuotes(t.text);
    }
    // `*` is a punct — ignored for slice B (slice D handles SELECT *
    // base-table fallback).
  }
  return null;
}

/**
 * Read a comma-separated identifier list (the CTE's optional explicit
 * column list `(col1, col2, ...)`).
 */
function extractIdentifierList(
  tokens: SqlToken[],
  from: number,
  to: number,
): string[] {
  const cols: string[] = [];
  for (let i = from; i <= to; i++) {
    const t = tokens[i];
    if (!t) continue;
    if (t.kind === "identifier") {
      cols.push(stripIdentifierQuotes(t.text));
    }
  }
  return cols;
}

/**
 * SQL keywords that may legally appear at the position immediately after
 * `FROM (subquery)` / `JOIN (subquery)` as part of the surrounding clause
 * — not as an alias. Anything NOT in this set is treated as a potential
 * alias, which lets us recognise reserved-word-looking aliases like
 * `outer` / `inner` / `union` used in test/legacy schemas.
 */
const ALIAS_BOUNDARY_KEYWORDS = new Set<string>([
  "ON",
  "USING",
  "WHERE",
  "GROUP",
  "ORDER",
  "LIMIT",
  "OFFSET",
  "HAVING",
  "UNION",
  "INTERSECT",
  "EXCEPT",
  "JOIN",
  "LEFT",
  "RIGHT",
  "FULL",
  "CROSS",
  "INNER",
  "NATURAL",
  "AS",
  "WINDOW",
  "FETCH",
  "FOR",
  "RETURNING",
  "WITH",
  "SELECT",
  "FROM",
]);

function isAliasToken(t: SqlToken): boolean {
  if (t.kind === "identifier") return true;
  if (t.kind === "keyword") {
    return !ALIAS_BOUNDARY_KEYWORDS.has(t.text.toUpperCase());
  }
  return false;
}

function stripIdentifierQuotes(raw: string): string {
  if (raw.length >= 2) {
    const first = raw[0];
    const last = raw[raw.length - 1];
    if (
      (first === '"' && last === '"') ||
      (first === "`" && last === "`") ||
      (first === "[" && last === "]")
    ) {
      return raw.slice(1, -1);
    }
  }
  return raw;
}
