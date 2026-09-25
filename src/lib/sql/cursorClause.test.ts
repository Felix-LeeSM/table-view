import { StandardSQL, sql as sqlLanguage } from "@codemirror/lang-sql";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { detectCursorClause } from "./cursorClause";

// Regression guard for the cursor clause classifier behind the fix for
// column labels duplicated as table candidates (2026-05-14). For the
// background, see `wrappedSchemaCompletionSource` in
// `src/lib/sql/schemaCompletionWrapper.ts`. The classifier must detect
// column-only positions precisely so the wrapper can safely remove the
// table emit.

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
