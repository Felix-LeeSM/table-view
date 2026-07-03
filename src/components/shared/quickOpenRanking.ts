/**
 * Quick Open (Cmd+P) scoring — deterministic tier ranking + subsequence fuzzy.
 *
 * Matching is token-based (whitespace-separated, AND across tokens). A token
 * containing "." is schema-qualified: the part before the dot is scoped to the
 * schema field, the part after to the name field. Every token must match or the
 * item is dropped; the item's score is the sum of its per-token scores.
 *
 * Tier ladder (best → worst), applied per field:
 *   exact > prefix > word-boundary (after _ / - / space / .) > substring
 * Field priority: name > schema > connection. A solid match in a
 * higher-priority field always outranks any solid match in a lower one — so the
 * fields live in non-overlapping score bands. Fuzzy (subsequence) is the last
 * resort: it only applies when no field has a solid match, and every fuzzy
 * score sits below every solid score. Equal scores break alphabetically.
 */

/** Pre-lowercased searchable fields for one Quick Open entry. */
export interface RankableFields {
  nameLower: string;
  schemaLower: string;
  connLower: string;
  /**
   * Whether the item's DBMS exposes a real schema layer. `with-schema` (PG)
   * and `no-schema` (MySQL, where the grouping is the database) are both
   * `true`; `flat` (SQLite/DuckDB) is `false`. Drives whether a `.`-token is
   * schema-qualified or degrades to a plain full-string match. Defaults to
   * `true` when omitted so schema-scoping stays the norm.
   */
  hasSchema?: boolean;
}

/**
 * Optional ranking signals. Reserved for #1218 (recency / pin weighting) —
 * unused today; the parameter only fixes the signature so weights can be
 * injected later without touching call sites.
 */
export type QuickOpenSignals = Record<string, unknown>;

// Solid tiers (higher = better).
const EXACT = 5;
const PREFIX = 4;
const BOUNDARY = 3;
const SUBSTRING = 2;

// Field bands keep name matches above schema above connection, with room for
// the +2..+5 tier on top without any band overlapping the next.
const NAME_BAND = 300;
const SCHEMA_BAND = 200;
const CONN_BAND = 100;

// Fuzzy sits below every solid match (< CONN_BAND + SUBSTRING), still ordered
// name > schema > connection.
const FUZZY_NAME = 30;
const FUZZY_SCHEMA = 20;
const FUZZY_CONN = 10;

// Subsequence fuzzy below this length is pure noise (a 1-char subsequence is
// just a substring), so we gate it out and let the solid tiers handle it.
const MIN_FUZZY_LEN = 2;

const BOUNDARY_CHARS = new Set(["_", "-", " ", "."]);

/** Solid tier for `q` against `field`, or 0 when there is no substring match. */
function solidTier(q: string, field: string): number {
  if (field === q) return EXACT;
  if (field.startsWith(q)) return PREFIX;
  const idx = field.indexOf(q);
  if (idx > 0) {
    return BOUNDARY_CHARS.has(field[idx - 1]!) ? BOUNDARY : SUBSTRING;
  }
  return 0;
}

/** Whether `q` is a subsequence of `field` (fuzzy match). */
function isSubsequence(q: string, field: string): boolean {
  let i = 0;
  for (let j = 0; j < field.length && i < q.length; j++) {
    if (field[j] === q[i]) i++;
  }
  return i === q.length;
}

/** Score a plain token: name > schema > connection, solid tiers then fuzzy. */
function scorePlainToken(q: string, fields: RankableFields): number {
  const nt = solidTier(q, fields.nameLower);
  if (nt) return NAME_BAND + nt;
  const st = solidTier(q, fields.schemaLower);
  if (st) return SCHEMA_BAND + st;
  const ct = solidTier(q, fields.connLower);
  if (ct) return CONN_BAND + ct;
  if (q.length >= MIN_FUZZY_LEN) {
    if (isSubsequence(q, fields.nameLower)) return FUZZY_NAME;
    if (isSubsequence(q, fields.schemaLower)) return FUZZY_SCHEMA;
    if (isSubsequence(q, fields.connLower)) return FUZZY_CONN;
  }
  return 0;
}

/** Tier (solid or fuzzy) for a `.`-token part against one field, else 0. */
function partTier(part: string, field: string): number {
  const solid = solidTier(part, field);
  if (solid) return solid;
  if (part.length >= MIN_FUZZY_LEN && isSubsequence(part, field)) return 1;
  return 0;
}

/** Score a schema-qualified token: `schemaPart` on schema, `namePart` on name. */
function scoreDotToken(
  schemaPart: string,
  namePart: string,
  fields: RankableFields,
): number {
  // An empty schema part ("`.tbl`") leaves the schema unconstrained.
  if (schemaPart && !partTier(schemaPart, fields.schemaLower)) return 0;
  // An empty name part ("`sales.`") matches every name in the schema.
  const nt = namePart ? partTier(namePart, fields.nameLower) : SUBSTRING;
  if (!nt) return 0;
  // Name tier dominates; schema already gated the candidate.
  return NAME_BAND + nt;
}

/**
 * Score one item against a query. 0 means "no match" (item excluded).
 * `signals` is reserved for #1218 and currently ignored.
 */
export function scoreItem(
  fields: RankableFields,
  query: string,
  signals?: QuickOpenSignals,
): number {
  void signals; // #1218 hook — not consumed yet
  const q = query.trim().toLowerCase();
  if (!q) return 0;

  let total = 0;
  for (const token of q.split(/\s+/)) {
    if (!token) continue;
    const dot = token.indexOf(".");
    // A `.` only scopes to the schema on shapes that have one. On a flat shape
    // (`hasSchema === false`) the token degrades to a plain literal match so a
    // `.` query is a graceful no-op rather than an error.
    const schemaScoped = dot >= 0 && fields.hasSchema !== false;
    const tokenScore = schemaScoped
      ? scoreDotToken(token.slice(0, dot), token.slice(dot + 1), fields)
      : scorePlainToken(token, fields);
    if (tokenScore === 0) return 0; // AND: any failed token drops the item
    total += tokenScore;
  }
  return total;
}

/**
 * Rank `items` against `query`: drop non-matches, sort by descending score,
 * break ties alphabetically (name, then schema, then connection). An empty
 * query returns the inventory unchanged (original order).
 */
export function rankQuickOpen<T extends RankableFields>(
  items: T[],
  query: string,
  signals?: QuickOpenSignals,
): T[] {
  if (!query.trim()) return items;
  return items
    .map((item) => ({ item, score: scoreItem(item, query, signals) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (
        a.item.nameLower.localeCompare(b.item.nameLower) ||
        a.item.schemaLower.localeCompare(b.item.schemaLower) ||
        a.item.connLower.localeCompare(b.item.connLower)
      );
    })
    .map((entry) => entry.item);
}
