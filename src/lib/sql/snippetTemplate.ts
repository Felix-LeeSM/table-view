/**
 * SQL snippet placeholder substitution (#1528).
 *
 * Syntax: `{{name}}` — mirrors the app-wide i18next interpolation marker so
 * the token is familiar and never clashes with SQL (`$1` params, `$$`
 * dollar-quoting) or shell (`${}`). Names are `[A-Za-z0-9_]`; inner
 * whitespace is tolerated (`{{ name }}`).
 *
 * Deliberately NOT a template engine: no nesting, conditionals, filters, or
 * defaults. Just find-and-replace of flat placeholders.
 */
const PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** Unique placeholder names in `body`, in first-seen order. */
export function extractPlaceholders(body: string): string[] {
  const seen = new Set<string>();
  for (const m of body.matchAll(PLACEHOLDER_RE)) {
    const name = m[1];
    if (name !== undefined) seen.add(name);
  }
  return [...seen];
}

/**
 * Replace every provided placeholder with its value. A placeholder with no
 * entry in `values` is left intact (so the user sees what still needs
 * filling); an entry set to `""` substitutes an empty string. Uses a replacer
 * *function* — not a replacement string — so a value containing `$&`/`$1`/`$$`
 * is inserted literally instead of being re-interpreted by
 * `String.prototype.replace`.
 */
export function substitutePlaceholders(
  body: string,
  values: Record<string, string>,
): string {
  return body.replace(
    PLACEHOLDER_RE,
    (match, name: string) => values[name] ?? match,
  );
}
