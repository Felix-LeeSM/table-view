import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

/**
 * Classify which clause of a SQL Statement the cursor sits in (2026-05-14),
 * because lang-sql emits table candidates even where only columns belong
 * (`WHERE` / `SET` / `INSERT (|)` / SELECT projection). For the background,
 * see `wrappedSchemaCompletionSource` in
 * `src/lib/sql/schemaCompletionWrapper.ts`.
 *
 * Based on the cursor position, this classifier returns:
 *   - `column-only` — only column candidates make sense here. lang-sql's
 *     table emit should be removed.
 *   - `table-allowed` — right after `FROM` / `JOIN` / `UPDATE` /
 *     `INSERT INTO` / `DELETE FROM`, or right before a statement starts.
 *     Table candidates are expected.
 *
 * Algorithm — the proper approach would extract the exact clause node from
 * the syntax tree, but lang-sql's SQL parser does not expose sub-clause
 * nodes. Instead, scan for *the last SQL keyword before the cursor* and
 * decide whether the cursor sits right after `from` / `join` / `into` /
 * `update`. The update / alias / cte sources already use the same pattern,
 * so this approach stays consistent with them.
 */
export type CursorClause = "column-only" | "table-allowed";

const COLUMN_ONLY_AFTER = new Set([
  // After SET — UPDATE … SET col = …
  "set",
  // After WHERE — the row filter of any statement
  "where",
  // After BY — GROUP BY / ORDER BY
  "by",
  // After HAVING — aggregate filter
  "having",
  // After ON — JOIN ON col = col
  "on",
  // After USING — JOIN USING (col)
  "using",
  // After SELECT — projection list (not a table alias position)
  "select",
  // After RETURNING — INSERT/UPDATE/DELETE RETURNING col list
  "returning",
]);

const TABLE_ALLOWED_AFTER = new Set([
  // After FROM, JOIN, UPDATE, INTO — the next token must be a table
  "from",
  "join",
  "update",
  "into",
]);

/**
 * Determine whether the cursor sits in a column-only context or one where
 * table candidates are legitimate. Returns `"table-allowed"` as the safe
 * fallback when the heuristic cannot decide — keeps lang-sql's table emit
 * intact in unfamiliar shapes (over-suppression would hide real table
 * suggestions).
 */
export function detectCursorClause(
  state: EditorState,
  pos: number,
): CursorClause {
  const stmt = enclosingStatement(state, pos);
  if (!stmt) return "table-allowed";

  // Walk the statement's text up to the cursor, collecting tokens. Use the
  // syntax tree's iterator so we only see actual `Keyword` / `Identifier`
  // / `Punctuation` nodes (strings / comments excluded).
  let lastSignificant: string | null = null;
  const tree = syntaxTree(state);
  const cursor = tree.cursor();
  cursor.moveTo(stmt.from);
  while (cursor.from < pos && cursor.next()) {
    if (cursor.from >= pos) break;
    if (cursor.name === "Keyword") {
      const text = state.doc.sliceString(cursor.from, cursor.to).toLowerCase();
      lastSignificant = text;
    }
  }
  // Fallback — for tokens the keyword scan misses (e.g. `RETURNING`
  // tokenized as an Identifier in some dialects), also check the last
  // alphabetic word of the statement text. If *either* the last keyword or
  // the textual scan result matches a known set, follow that decision.
  const stmtText = state.doc.sliceString(stmt.from, pos);
  const lastWordMatch = stmtText.match(/([A-Za-z_][A-Za-z_0-9]*)\s*$/);
  const lastWord = lastWordMatch?.[1]?.toLowerCase() ?? null;

  const decide = (token: string | null): CursorClause | null => {
    if (!token) return null;
    if (TABLE_ALLOWED_AFTER.has(token)) return "table-allowed";
    if (COLUMN_ONLY_AFTER.has(token)) return "column-only";
    return null;
  };

  return decide(lastSignificant) ?? decide(lastWord) ?? "table-allowed";
}

function enclosingStatement(
  state: EditorState,
  pos: number,
): { from: number; to: number } | null {
  const tree = syntaxTree(state);
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
