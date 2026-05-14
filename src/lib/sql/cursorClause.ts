import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

/**
 * Sprint 304 (2026-05-14) — cursor 가 SQL Statement 안에서 어떤 clause 에
 * 있는지 분별. lang-sql 의 `schemaCompletionSource` 는 ns top-level (=
 * table) 을 *모든 컨텍스트* 에서 emit 한다. 컬럼만 와야 하는 자리
 * (`WHERE` / `SET` / `INSERT (|)` / SELECT projection) 에서도 table 후보가
 * 노출되어, 우리 column source 와 같은 라벨이 `type: "type"` (`t` 아이콘)
 * + `type: "property"` (`□` 아이콘) 으로 *두 번* popup 에 뜬다 (2026-05-14
 * 사용자 보고: "column 이 두 번씩 나열되고 아이콘이 다름").
 *
 * 이 분별기는 cursor 위치를 기준으로:
 *   - `column-only` — 컬럼 후보만 의미 있는 자리. lang-sql 의 table emit
 *     은 제거되어야.
 *   - `table-allowed` — `FROM` / `JOIN` / `UPDATE` / `INSERT INTO` /
 *     `DELETE FROM` 직후, 또는 statement 진입 직전. table 후보 정상.
 *
 * 알고리즘 — 정공법은 syntax tree 의 정확한 clause 노드를 추출하는
 * 것이지만 lang-sql 의 SQL parser 는 sub-clause 노드를 별도로 노출하지
 * 않는다. 대신 *cursor 직전의 마지막 SQL keyword* 를 스캔해 cursor 가
 * `from` / `join` / `into` / `update` 직후인지로 판별. 이 접근은 sprint-
 * 292 / 294 / 295 의 update / alias / cte source 가 이미 사용 중인 동일
 * 패턴이라 일관성이 있다.
 */
export type CursorClause = "column-only" | "table-allowed";

const COLUMN_ONLY_AFTER = new Set([
  // SET 다음 — UPDATE … SET col = …
  "set",
  // WHERE 다음 — 모든 statement 의 row 필터
  "where",
  // BY 다음 — GROUP BY / ORDER BY
  "by",
  // HAVING 다음 — 집계 필터
  "having",
  // ON 다음 — JOIN ON col = col
  "on",
  // USING 다음 — JOIN USING (col)
  "using",
  // SELECT 다음 — projection list (table 별칭 자리 아님)
  "select",
  // RETURNING 다음 — INSERT/UPDATE/DELETE RETURNING col list
  "returning",
]);

const TABLE_ALLOWED_AFTER = new Set([
  // FROM, JOIN, UPDATE, INTO 다음 — 다음 토큰이 table 이어야 함
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
  // Fallback — keyword scan 이 잡지 못한 토큰 (예: `RETURNING` 이 일부
  // dialect 에서 Identifier 로 토큰화되는 경우) 을 위해 statement 텍스트의
  // 마지막 alphabetic word 도 검사. 마지막 keyword 와 textual scan 결과
  // 둘 중 *하나라도* known set 에 매치하면 그 결정에 따른다.
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
