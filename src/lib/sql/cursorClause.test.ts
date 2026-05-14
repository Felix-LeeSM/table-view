import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { sql as sqlLanguage, StandardSQL } from "@codemirror/lang-sql";
import { detectCursorClause } from "./cursorClause";

// Sprint 304 (2026-05-14) — column = table dup 해소를 위한 cursor clause
// 분별기 회귀 가드. 사용자 보고: column 이 두 번씩 나열 (t / □ 아이콘).
// 원인은 lang-sql 의 schemaCompletionSource 가 모든 컨텍스트에서 ns
// top-level (table) 을 emit 하는 데 있다. 분별기가 column-only 자리를
// 정확히 검출해야 wrapper 가 table emit 을 안전하게 제거할 수 있다.

function makeState(doc: string) {
  return EditorState.create({
    doc,
    extensions: [sqlLanguage({ dialect: StandardSQL })],
  });
}

describe("detectCursorClause", () => {
  it("WHERE 직후 — column-only", () => {
    const doc = "SELECT * FROM users WHERE ";
    expect(detectCursorClause(makeState(doc), doc.length)).toBe("column-only");
  });

  it("SET 직후 (UPDATE) — column-only", () => {
    const doc = "UPDATE users SET ";
    expect(detectCursorClause(makeState(doc), doc.length)).toBe("column-only");
  });

  it("SELECT 직후 (projection) — column-only", () => {
    const doc = "SELECT  FROM users";
    // cursor right after SELECT (position 7 = after "SELECT ").
    expect(detectCursorClause(makeState(doc), 7)).toBe("column-only");
  });

  it("ORDER BY 직후 — column-only", () => {
    const doc = "SELECT * FROM users ORDER BY ";
    expect(detectCursorClause(makeState(doc), doc.length)).toBe("column-only");
  });

  it("GROUP BY 직후 — column-only", () => {
    const doc = "SELECT count(*) FROM users GROUP BY ";
    expect(detectCursorClause(makeState(doc), doc.length)).toBe("column-only");
  });

  it("HAVING 직후 — column-only", () => {
    const doc = "SELECT count(*) FROM users GROUP BY status HAVING ";
    expect(detectCursorClause(makeState(doc), doc.length)).toBe("column-only");
  });

  it("ON 직후 (JOIN ON) — column-only", () => {
    const doc = "SELECT * FROM users u JOIN orders o ON ";
    expect(detectCursorClause(makeState(doc), doc.length)).toBe("column-only");
  });

  it("RETURNING 직후 — column-only", () => {
    const doc = "INSERT INTO users (name) VALUES ('a') RETURNING ";
    expect(detectCursorClause(makeState(doc), doc.length)).toBe("column-only");
  });

  it("FROM 직후 — table-allowed", () => {
    const doc = "SELECT * FROM ";
    expect(detectCursorClause(makeState(doc), doc.length)).toBe(
      "table-allowed",
    );
  });

  it("JOIN 직후 — table-allowed", () => {
    const doc = "SELECT * FROM users JOIN ";
    expect(detectCursorClause(makeState(doc), doc.length)).toBe(
      "table-allowed",
    );
  });

  it("INSERT INTO 직후 — table-allowed", () => {
    const doc = "INSERT INTO ";
    expect(detectCursorClause(makeState(doc), doc.length)).toBe(
      "table-allowed",
    );
  });

  it("UPDATE 직후 — table-allowed", () => {
    const doc = "UPDATE ";
    expect(detectCursorClause(makeState(doc), doc.length)).toBe(
      "table-allowed",
    );
  });

  it("DELETE FROM 직후 — table-allowed", () => {
    const doc = "DELETE FROM ";
    expect(detectCursorClause(makeState(doc), doc.length)).toBe(
      "table-allowed",
    );
  });

  it("statement 진입 직전 (빈 doc) — table-allowed (safe fallback)", () => {
    expect(detectCursorClause(makeState(""), 0)).toBe("table-allowed");
  });
});
