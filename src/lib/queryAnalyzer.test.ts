import { describe, it, expect } from "vitest";
import {
  parseSingleTableSelect,
  analyzeResultEditability,
} from "./queryAnalyzer";
import type { ColumnInfo } from "../types/schema";
import type { QueryColumn } from "../types/query";

function col(
  name: string,
  data_type: string,
  is_primary_key = false,
): ColumnInfo {
  return {
    name,
    data_type,
    nullable: !is_primary_key,
    default_value: null,
    is_primary_key,
    is_foreign_key: false,
    fk_reference: null,
    comment: null,
  };
}

function qcol(name: string, data_type = "text"): QueryColumn {
  return { name, data_type };
}

describe("parseSingleTableSelect", () => {
  it("parses a bare SELECT * FROM table", () => {
    expect(parseSingleTableSelect("SELECT * FROM users")).toEqual({
      schema: null,
      table: "users",
    });
  });

  it("parses schema-qualified table", () => {
    expect(parseSingleTableSelect("SELECT id FROM public.users")).toEqual({
      schema: "public",
      table: "users",
    });
  });

  it("handles double-quoted identifiers", () => {
    expect(
      parseSingleTableSelect('SELECT * FROM "MySchema"."Order Items"'),
    ).toEqual({ schema: "MySchema", table: "Order Items" });
  });

  it("ignores trailing semicolons", () => {
    expect(parseSingleTableSelect("SELECT * FROM users;")).toEqual({
      schema: null,
      table: "users",
    });
  });

  it("strips leading line and block comments", () => {
    expect(
      parseSingleTableSelect("-- header\n/* note */ SELECT * FROM users"),
    ).toEqual({ schema: null, table: "users" });
  });

  it("accepts WHERE / ORDER BY / LIMIT clauses", () => {
    expect(
      parseSingleTableSelect(
        "SELECT id, name FROM public.users WHERE id > 0 ORDER BY id LIMIT 100",
      ),
    ).toEqual({ schema: "public", table: "users" });
  });

  it("returns null for JOIN", () => {
    expect(
      parseSingleTableSelect(
        "SELECT * FROM users u JOIN orders o ON u.id = o.uid",
      ),
    ).toBeNull();
  });

  it("returns null for comma-separated multi-source", () => {
    expect(parseSingleTableSelect("SELECT * FROM users, orders")).toBeNull();
  });

  it("returns null for subquery in FROM", () => {
    expect(parseSingleTableSelect("SELECT * FROM (SELECT 1) sub")).toBeNull();
  });

  it("returns null for CTE / WITH", () => {
    expect(
      parseSingleTableSelect("WITH cte AS (SELECT 1) SELECT * FROM cte"),
    ).toBeNull();
  });

  it("returns null for UNION", () => {
    expect(
      parseSingleTableSelect(
        "SELECT * FROM users UNION SELECT * FROM customers",
      ),
    ).toBeNull();
  });

  it("returns null for non-SELECT", () => {
    expect(parseSingleTableSelect("INSERT INTO users VALUES (1)")).toBeNull();
    expect(parseSingleTableSelect("UPDATE users SET x = 1")).toBeNull();
    expect(parseSingleTableSelect("DELETE FROM users")).toBeNull();
  });

  it("returns null for empty / whitespace-only / comment-only input", () => {
    expect(parseSingleTableSelect("")).toBeNull();
    expect(parseSingleTableSelect("   \n\t  ")).toBeNull();
    expect(parseSingleTableSelect("-- just a comment")).toBeNull();
  });

  it("ignores subqueries appearing in the column list", () => {
    // (SELECT 1) is in the projection, not the FROM — still single-table.
    expect(
      parseSingleTableSelect("SELECT (SELECT 1) AS one, id FROM users"),
    ).toEqual({ schema: null, table: "users" });
  });

  it("returns null for CROSS JOIN / NATURAL JOIN", () => {
    expect(
      parseSingleTableSelect("SELECT * FROM users CROSS JOIN orders"),
    ).toBeNull();
    expect(
      parseSingleTableSelect("SELECT * FROM users NATURAL JOIN orders"),
    ).toBeNull();
  });
});

describe("analyzeResultEditability", () => {
  const TABLE_COLS = [col("id", "integer", true), col("name", "text")];

  it("returns editable when SELECT, PK present, and result includes PK", () => {
    const result = analyzeResultEditability(
      "SELECT id, name FROM public.users",
      [qcol("id"), qcol("name")],
      TABLE_COLS,
    );
    expect(result.editable).toBe(true);
    if (result.editable) {
      expect(result.schema).toBe("public");
      expect(result.table).toBe("users");
      expect(result.pkColumns).toEqual(["id"]);
    }
  });

  it("falls back to default schema when query has none", () => {
    const result = analyzeResultEditability(
      "SELECT id, name FROM users",
      [qcol("id"), qcol("name")],
      TABLE_COLS,
    );
    expect(result.editable).toBe(true);
    if (result.editable) {
      expect(result.schema).toBe("public");
    }
  });

  it("rejects non-single-table SELECT with a clear reason", () => {
    const result = analyzeResultEditability(
      "SELECT * FROM users JOIN orders ON users.id = orders.uid",
      [qcol("id")],
      TABLE_COLS,
    );
    expect(result.editable).toBe(false);
    if (!result.editable) {
      expect(result.reason).toMatch(/single-table/i);
    }
  });

  it("rejects when table has no primary key", () => {
    const noPk = [col("a", "text"), col("b", "text")];
    const result = analyzeResultEditability(
      "SELECT * FROM things",
      [qcol("a"), qcol("b")],
      noPk,
    );
    expect(result.editable).toBe(false);
    if (!result.editable) {
      expect(result.reason).toMatch(/no primary key/i);
    }
  });

  it("rejects when result is missing PK columns", () => {
    const result = analyzeResultEditability(
      "SELECT name FROM users", // id missing
      [qcol("name")],
      TABLE_COLS,
    );
    expect(result.editable).toBe(false);
    if (!result.editable) {
      expect(result.reason).toMatch(/missing primary-key/i);
      expect(result.reason).toMatch(/id/);
    }
  });

  it("returns 'loading' state when tableColumns is null", () => {
    const result = analyzeResultEditability(
      "SELECT * FROM users",
      [qcol("id"), qcol("name")],
      null,
    );
    expect(result.editable).toBe(false);
    if (!result.editable) {
      expect(result.reason).toMatch(/loading/i);
    }
  });
});
