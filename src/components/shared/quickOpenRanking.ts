/**
 * Quick Open (Cmd+P) scoring.
 *
 * RED baseline: today this only reproduces the pre-#1216 behavior — a plain
 * substring AND filter with no ranking, no fuzzy, no `.` scoping. The GREEN
 * commit replaces the bodies with the tiered scorer the specs demand.
 */

/** Pre-lowercased searchable fields for one Quick Open entry. */
export interface RankableFields {
  nameLower: string;
  schemaLower: string;
  connLower: string;
}

/**
 * Optional ranking signals. Reserved for #1218 (recency / pin weighting) —
 * unused today; the parameter only fixes the signature so weights can be
 * injected later without touching call sites.
 */
export type QuickOpenSignals = Record<string, unknown>;

export function scoreItem(
  fields: RankableFields,
  query: string,
  signals?: QuickOpenSignals,
): number {
  void signals; // #1218 hook — not consumed yet
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const haystack = `${fields.connLower} ${fields.schemaLower} ${fields.nameLower}`;
  return q.split(/\s+/).every((tok) => haystack.includes(tok)) ? 1 : 0;
}

export function rankQuickOpen<T extends RankableFields>(
  items: T[],
  query: string,
  signals?: QuickOpenSignals,
): T[] {
  if (!query.trim()) return items;
  return items.filter((item) => scoreItem(item, query, signals) > 0);
}
