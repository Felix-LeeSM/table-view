// AC-185-01 — sqlSafety analyzer 단위 테스트. 12 cases per Sprint 185 contract.
// date 2026-05-01.
import { describe, it, expect } from "vitest";
import { analyzeStatement, isDangerous } from "./sqlSafety";

describe("sqlSafety.analyzeStatement", () => {
  it("[AC-185-01a] DELETE without WHERE → danger", () => {
    const a = analyzeStatement("DELETE FROM users");
    expect(a.kind).toBe("delete");
    expect(a.severity).toBe("danger");
    expect(a.reasons).toEqual(["DELETE without WHERE clause"]);
    expect(isDangerous(a)).toBe(true);
  });

  it("[AC-185-01b] DELETE with WHERE → safe", () => {
    const a = analyzeStatement("DELETE FROM users WHERE id = 1");
    expect(a.kind).toBe("delete");
    expect(a.severity).toBe("safe");
    expect(a.reasons).toEqual([]);
    expect(isDangerous(a)).toBe(false);
  });

  it("[AC-185-01c] UPDATE without WHERE → danger", () => {
    const a = analyzeStatement("UPDATE users SET active = false");
    expect(a.kind).toBe("update");
    expect(a.severity).toBe("danger");
    expect(a.reasons).toEqual(["UPDATE without WHERE clause"]);
  });

  it("[AC-185-01d] UPDATE with WHERE → safe", () => {
    const a = analyzeStatement("UPDATE users SET active = false WHERE id = 1");
    expect(a.kind).toBe("update");
    expect(a.severity).toBe("safe");
  });

  it("[AC-185-01e] DROP TABLE → danger", () => {
    const a = analyzeStatement("DROP TABLE users");
    expect(a.kind).toBe("ddl-drop");
    expect(a.severity).toBe("danger");
    expect(a.reasons).toEqual(["DROP TABLE"]);
  });

  it("[AC-185-01f] DROP DATABASE → danger", () => {
    const a = analyzeStatement("DROP DATABASE app");
    expect(a.kind).toBe("ddl-drop");
    expect(a.severity).toBe("danger");
    expect(a.reasons).toEqual(["DROP DATABASE"]);
  });

  it("[AC-185-01g] TRUNCATE → danger", () => {
    const a = analyzeStatement("TRUNCATE TABLE events");
    expect(a.kind).toBe("ddl-truncate");
    expect(a.severity).toBe("danger");
    expect(a.reasons).toEqual(["TRUNCATE"]);
  });

  it("[AC-185-01h] INSERT INTO → safe", () => {
    const a = analyzeStatement("INSERT INTO users (id, name) VALUES (1, 'a')");
    expect(a.kind).toBe("insert");
    expect(a.severity).toBe("safe");
  });

  it("[AC-185-01i] SELECT → safe", () => {
    const a = analyzeStatement("SELECT * FROM users");
    expect(a.kind).toBe("select");
    expect(a.severity).toBe("safe");
  });

  it("[AC-185-01j] case-insensitive (delete from t) → danger", () => {
    const a = analyzeStatement("delete from users");
    expect(a.kind).toBe("delete");
    expect(a.severity).toBe("danger");
  });

  it("[AC-185-01k] strips line comments before analysis", () => {
    const a = analyzeStatement(
      "-- this comment hides nothing\nDELETE FROM users -- inline\n",
    );
    expect(a.kind).toBe("delete");
    expect(a.severity).toBe("danger");

    const b = analyzeStatement(
      "/* block comment */ DELETE FROM users WHERE id = 1",
    );
    expect(b.kind).toBe("delete");
    expect(b.severity).toBe("safe");
  });

  it("[AC-185-01l] subquery WHERE counted as outer WHERE present", () => {
    const a = analyzeStatement(
      "DELETE FROM t WHERE id IN (SELECT id FROM u WHERE flag = 1)",
    );
    expect(a.kind).toBe("delete");
    expect(a.severity).toBe("safe");
  });

  it("empty SQL → other / safe (graceful)", () => {
    const a = analyzeStatement("");
    expect(a.kind).toBe("other");
    expect(a.severity).toBe("safe");
  });

  it("ALTER / CREATE → ddl-other / safe", () => {
    const a = analyzeStatement("ALTER TABLE users ADD COLUMN x int");
    expect(a.kind).toBe("ddl-other");
    expect(a.severity).toBe("safe");
    const b = analyzeStatement("CREATE INDEX idx_x ON users (x)");
    expect(b.kind).toBe("ddl-other");
    expect(b.severity).toBe("safe");
  });
});
