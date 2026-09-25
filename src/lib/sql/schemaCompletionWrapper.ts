import type {
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete";
import {
  type SQLDialect,
  type SQLNamespace,
  schemaCompletionSource,
} from "@codemirror/lang-sql";
import { detectCursorClause } from "./cursorClause";

/**
 * `schemaCompletionSource` wrapper (2026-05-14).
 *
 * lang-sql's `schemaCompletionSource` emits the top-level keys of
 * `SQLNamespace` (= table / view) as `type: "type"` (`t` icon) in *every
 * cursor context*. Our `updateColumnCompletionSource` /
 * `aliasColumnCompletionSource` / `cteColumnCompletionSource` emit columns
 * at the same position as `type: "property"` (`□` icon). CodeMirror's
 * autocomplete does not dedup across sources, so the same label showed up
 * twice in the popup (table + column). 2026-05-14 user report: each column
 * was listed twice, with a different icon on the left.
 *
 * This wrapper *post-processes* lang-sql's schemaCompletion result:
 *   - When the cursor is at a `column-only` position (`WHERE` / `SET` /
 *     `SELECT` projection / `ORDER BY` / `GROUP BY` / `HAVING` / `ON`, …),
 *     drop the `type === "type"` options (= table candidates).
 *     `type === "property"` (column / alias emit) passes through.
 *   - When the cursor is at a `table-allowed` position (right after
 *     `FROM` / `JOIN` / `INSERT INTO` / `UPDATE`), pass the result through
 *     unchanged.
 *
 * Usage: call `sql({ dialect, upperCaseKeywords })` *without* the schema
 * argument to turn off lang-sql's automatic schemaCompletion wiring, and
 * register this wrapper separately with
 * `dialect.language.data.of({ autocomplete })`. That way lang-sql's alias
 * map (the `<table> <alias>` mapping of a statement that already has a
 * FROM clause) is preserved through the wrapper too — given only ns and
 * dialect, `schemaCompletionSource` still does the alias handling
 * internally.
 */
export function wrappedSchemaCompletionSource(
  getSchema: () => SQLNamespace | undefined,
  dialect: SQLDialect,
): CompletionSource {
  // schemaCompletionSource captures the schema when it builds the source.
  // Our ns becomes a new object on a dialect / schema reconfigure, so the
  // source instance has to be recreated at the same point: build a new
  // wrapper whenever the namespace changes. Under that contract, capturing
  // the source instance inside the closure is correct.
  let innerSource: CompletionSource | null = null;
  const ensureInner = (): CompletionSource | null => {
    const schema = getSchema();
    if (!schema) return null;
    if (!innerSource) {
      innerSource = schemaCompletionSource({ schema, dialect });
    }
    return innerSource;
  };

  const applyFilter = (
    result: CompletionResult | null,
    context: CompletionContext,
  ): CompletionResult | null => {
    if (!result) return null;
    const clause = detectCursorClause(context.state, context.pos);
    if (clause === "table-allowed") return result;
    // column-only — drop table candidates (`type === "type"`).
    const filtered = result.options.filter((opt) => opt.type !== "type");
    if (filtered.length === result.options.length) return result;
    return { ...result, options: filtered };
  };

  return (
    context: CompletionContext,
  ): CompletionResult | Promise<CompletionResult | null> | null => {
    const inner = ensureInner();
    if (!inner) return null;
    const result = inner(context);
    if (result && typeof (result as Promise<unknown>).then === "function") {
      return (result as Promise<CompletionResult | null>).then((r) =>
        applyFilter(r, context),
      );
    }
    return applyFilter(result as CompletionResult | null, context);
  };
}
