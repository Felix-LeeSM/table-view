import { syntaxTree } from "@codemirror/language";
import type {
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import type { SQLNamespace } from "@codemirror/lang-sql";

/**
 * Auxiliary completion source for `UPDATE` / `INSERT INTO` / `DELETE FROM`
 * statements.
 *
 * `@codemirror/lang-sql`'s built-in `schemaCompletionSource` resolves the
 * target table for column suggestions only after the parser has seen the
 * `FROM` keyword inside a Statement (see `getAliases` upstream). That
 * means `UPDATE users SET <cursor>` and `INSERT INTO users (<cursor>)`
 * never see column candidates — a regression the user reported on
 * 2026-05-11.
 *
 * Sprint 292 (2026-05-14) — `DELETE FROM users WHERE <cursor>` 도 같은
 * 한계. built-in 이 DELETE 컨텍스트의 target table 을 alias 맵에 등록하지
 * 않아 WHERE 절 컬럼이 노출되지 않는다. 이 source 가 DELETE 도 처리하도록
 * 확장.
 *
 * This source augments the default by walking the syntax tree to the
 * enclosing Statement, identifying the verb (`update` or `insert`), and
 * extracting the target table identifier directly. Columns are then
 * pulled from the provided `SQLNamespace` (the same one fed to
 * `sql({ schema })`), so this source stays in sync with whatever
 * `useSqlAutocomplete` produces.
 *
 * The source is intentionally conservative:
 *   - Returns `null` outside `UPDATE` / `INSERT INTO`.
 *   - Returns `null` when the cursor is inside the target table
 *     identifier itself (you want table suggestions, not column ones).
 *   - Returns `null` inside strings / numbers / comments (value
 *     positions).
 *   - For `INSERT INTO`, returns `null` outside the column-list
 *     `Parens` that immediately follows the table identifier (the
 *     `VALUES` parens carry values, not columns).
 */
export function updateColumnCompletionSource(
  getSchema: () => SQLNamespace | undefined,
): (context: CompletionContext) => CompletionResult | null {
  return (context) => {
    const schema = getSchema();
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
      return null;
    }

    const { state, pos, explicit } = context;
    const tree = syntaxTree(state);
    const node = tree.resolveInner(pos, -1);

    // Skip non-identifier surfaces where a column suggestion would be
    // wrong (string literals, numbers, comments).
    if (
      node.name === "String" ||
      node.name === "Number" ||
      node.name === "LineComment" ||
      node.name === "BlockComment"
    ) {
      return null;
    }

    // Resolve the enclosing Statement node. `resolveInner` lands on
    // `Script` when the cursor sits in trailing whitespace past the
    // last token (lang-sql does NOT extend `Statement.to` through
    // whitespace), so we have to scan the Script's direct children to
    // locate the Statement covering the cursor.
    let stmt = node;
    if (stmt.name === "Script") {
      let child: typeof stmt | null = stmt.firstChild;
      let last: typeof stmt | null = null;
      while (child) {
        if (child.name === "Statement" && child.from <= pos) {
          last = child;
        }
        if (child.from > pos) break;
        child = child.nextSibling;
      }
      if (!last) return null;
      stmt = last;
    } else {
      while (stmt && stmt.name !== "Statement") {
        const parent: typeof stmt | null = stmt.parent;
        if (!parent) return null;
        stmt = parent;
      }
      if (!stmt || stmt.name !== "Statement") return null;
    }

    // First child should be a Keyword — must be UPDATE, INSERT, DELETE, or
    // SELECT. SELECT is handled via a separate FROM-locating helper because
    // the target identifier is not the syntactic neighbour of the verb.
    let scan = stmt.firstChild;
    while (scan && scan.name === "LineComment") scan = scan.nextSibling;
    if (!scan || scan.name !== "Keyword") return null;
    const firstKw = state.doc.sliceString(scan.from, scan.to).toLowerCase();
    if (
      firstKw !== "update" &&
      firstKw !== "insert" &&
      firstKw !== "delete" &&
      firstKw !== "select"
    ) {
      return null;
    }

    // For SELECT, scan forward to the FROM keyword (lang-sql does not
    // auto-register the FROM table as an alias when the source is invoked
    // out of band, so we resolve the single-table FROM ourselves; multi-
    // table JOIN alias resolution is sprint-294 territory).
    if (firstKw === "select") {
      scan = scan.nextSibling;
      while (scan) {
        if (scan.name === "Keyword") {
          const kw = state.doc.sliceString(scan.from, scan.to).toLowerCase();
          if (kw === "from") {
            scan = scan.nextSibling;
            break;
          }
        }
        scan = scan.nextSibling;
      }
      if (!scan) return null;
    } else if (firstKw === "insert" || firstKw === "delete") {
      // For INSERT / DELETE, advance past the obligatory INTO / FROM keyword.
      const expected = firstKw === "insert" ? "into" : "from";
      scan = scan.nextSibling;
      while (scan && scan.name === "LineComment") scan = scan.nextSibling;
      if (!scan || scan.name !== "Keyword") return null;
      const kw = state.doc.sliceString(scan.from, scan.to).toLowerCase();
      if (kw !== expected) return null;
      scan = scan.nextSibling;
    } else {
      scan = scan.nextSibling;
    }

    // Locate the target table identifier (next Identifier-shape node).
    let targetNode: typeof scan = null;
    while (scan) {
      if (
        scan.name === "Identifier" ||
        scan.name === "QuotedIdentifier" ||
        scan.name === "CompositeIdentifier"
      ) {
        targetNode = scan;
        break;
      }
      scan = scan.nextSibling;
    }
    if (!targetNode) return null;

    // Cursor must be past the target table — don't shadow table-name
    // completion while the user is still typing the table itself.
    if (pos <= targetNode.to) return null;

    const rawName = state.doc.sliceString(targetNode.from, targetNode.to);
    const lookupCandidates = [rawName, stripQuotes(rawName)];

    // For INSERT, only fire when the cursor is inside the first Parens
    // following the table identifier (the column list). The Parens that
    // follows `VALUES` carries values, not columns.
    if (firstKw === "insert") {
      const insideColumnList = isInsideInsertColumnParens(
        node,
        targetNode.to,
        state,
      );
      if (!insideColumnList) return null;
    }

    // Resolve column namespace.
    const columns = resolveColumns(schema, lookupCandidates);
    if (columns.length === 0) return null;

    // Without an explicit trigger we still want to surface suggestions
    // mid-identifier, but not in completely empty whitespace (that
    // would spam the popup on every keystroke between fields).
    const inIdent =
      node.name === "Identifier" || node.name === "QuotedIdentifier";
    if (!explicit && !inIdent) return null;

    const from = inIdent ? node.from : pos;
    return {
      from,
      options: columns.map((name) => ({ label: name, type: "property" })),
      validFor: /^\w*$/,
    };
  };
}

function stripQuotes(name: string): string {
  if (name.length < 2) return name;
  const first = name[0];
  const last = name[name.length - 1];
  if ((first === '"' || first === "`") && first === last) {
    return name.slice(1, -1);
  }
  return name;
}

/**
 * True when `node` is a descendant of a `Parens` whose previous Statement
 * sibling is the target table identifier — i.e. the column-list parens
 * in `INSERT INTO users (col1, col2) VALUES (...)`.
 */
function isInsideInsertColumnParens(
  node: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>,
  targetTableEnd: number,
  state: CompletionContext["state"],
): boolean {
  let cur: typeof node | null = node;
  while (cur) {
    if (cur.name === "Parens" && cur.parent?.name === "Statement") {
      // Walk this Parens' previous siblings looking for a `VALUES`
      // Keyword. If we encounter it before the target table, this is
      // the values parens.
      let prev = cur.prevSibling;
      while (prev) {
        if (prev.name === "Keyword") {
          const kw = state.doc.sliceString(prev.from, prev.to).toLowerCase();
          if (kw === "values") return false;
        }
        prev = prev.prevSibling;
      }
      // We didn't see VALUES — and the Parens starts after the target
      // table identifier ends — so this is the column list.
      return cur.from >= targetTableEnd;
    }
    cur = cur.parent ?? null;
  }
  return false;
}

function resolveColumns(
  schema: SQLNamespace,
  lookupCandidates: readonly string[],
): string[] {
  if (typeof schema !== "object" || Array.isArray(schema)) return [];
  const map = schema as Record<string, SQLNamespace>;
  for (const candidate of lookupCandidates) {
    if (!candidate) continue;
    const entry = map[candidate];
    if (!entry) continue;
    const cols = columnsFromEntry(entry);
    if (cols.length > 0) return cols;
  }
  return [];
}

function columnsFromEntry(entry: SQLNamespace): string[] {
  if (Array.isArray(entry)) {
    // Array form is a flat list of completions, not a children map —
    // not what we want for column lookup.
    return [];
  }
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
