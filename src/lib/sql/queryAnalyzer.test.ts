import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  parseSingleTableSelect,
  analyzeResultEditability,
  analyzeMultiTableEditability,
  resolveDefaultSchema,
} from "./queryAnalyzer";
import { preloadSqlWasm, __resetSqlWasmModuleForTests } from "./sqlAst";
import type { ColumnInfo } from "@/types/schema";
import type { QueryColumn } from "@/types/query";

// Issue #1297 — the editability gate now consumes the real sql-parser-core
// WASM AST (via `parseSqlPreloaded`). Load the checked-in `.wasm` bytes so
// these tests exercise the actual parser (including the new SELECT-list
// alias capture).
vi.mock("./wasm/sql_parser_core.js", async () =>
  (await import("./realSqlWasmTestMock")).realSqlWasmModuleMock(),
);

function col(
  name: string,
  dataType: string,
  is_primary_key = false,
): ColumnInfo {
  return {
    name,
    data_type: dataType,
    nullable: !is_primary_key,
    default_value: null,
    is_primary_key,
    is_foreign_key: false,
    fk_reference: null,
    comment: null,
  };
}

function qcol(name: string, dataType = "text"): QueryColumn {
  return { name, dataType, category: "unknown" };
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

  // Issue #1234/#1236 — parseSingleTableSelect runs the local comment-stripper
  // (queryAnalyzer.ts `stripComments`, built on `tokenizeSql`) before FROM_RE.
  // Now that tokenizeSql is dollar-quote aware, a `--` *inside* a $tag$…$tag$
  // literal is body text, not a line comment. Previously tokenizeSql tagged it
  // a comment, stripComments dropped the rest of the line (including the FROM
  // clause), and this single-table select fell to a false read-only verdict
  // (returned null). Verified RED: fails on base production, passes after fix.
  it("keeps a dollar-quoted select-list literal intact (inner -- is not a comment)", () => {
    expect(
      parseSingleTableSelect(
        "SELECT $tok$-- not a comment$tok$ AS label FROM accounts",
      ),
    ).toEqual({ schema: null, table: "accounts" });
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

  // Purpose: comment-aware editability — a JOIN/UNION that lives inside a
  // SQL comment must NOT disqualify a single-table SELECT. The pre-fix
  // analyser only stripped LEADING comments, so a trailing/inline `-- JOIN`
  // or `/* UNION */` matched the raw JOIN/UNION regex and flipped the result
  // to read-only. User report (2026-07-03), issue #1226.
  describe("comment-processed keywords (#1226)", () => {
    // Reason: issue #1226 symptom #2 — a trailing line comment naming JOIN
    // must be ignored, keeping the query editable (2026-07-03).
    it("treats a trailing -- line comment with JOIN as single-table", () => {
      expect(
        parseSingleTableSelect("SELECT * FROM users -- JOIN orders o\n"),
      ).toEqual({ schema: null, table: "users" });
    });

    // Reason: issue #1226 — a standalone comment line naming JOIN after the
    // FROM clause is still a comment, not a real join (2026-07-03).
    it("treats a following comment line with JOIN as single-table", () => {
      expect(
        parseSingleTableSelect(
          "SELECT id FROM public.users\n-- JOIN orders o ON u.id = o.uid",
        ),
      ).toEqual({ schema: "public", table: "users" });
    });

    // Reason: issue #1226 — block comments naming JOIN must be ignored, and
    // stripping one must not fuse the neighbouring identifiers (2026-07-03).
    it("treats a /* JOIN */ block comment as single-table", () => {
      expect(
        parseSingleTableSelect("SELECT * FROM users /* JOIN orders */"),
      ).toEqual({ schema: null, table: "users" });
      expect(
        parseSingleTableSelect("SELECT * FROM users/**/WHERE id > 0"),
      ).toEqual({ schema: null, table: "users" });
    });

    // Reason: issue #1226 — a commented-out UNION must not disqualify the
    // query (the set-operation check ran on the comment-inclusive text too)
    // (2026-07-03).
    it("treats a commented-out UNION as single-table", () => {
      expect(
        parseSingleTableSelect(
          "SELECT * FROM users\n-- UNION SELECT * FROM admins",
        ),
      ).toEqual({ schema: null, table: "users" });
    });

    // Reason: issue #1226 — a real block-comment-separated JOIN (comments act
    // as whitespace in SQL) must STILL be read-only; comment removal must not
    // fuse `users`+`JOIN` into an unmatched `usersJOIN` (2026-07-03).
    it("still returns null for a real JOIN separated only by a block comment", () => {
      expect(
        parseSingleTableSelect("SELECT * FROM users/**/JOIN orders o ON 1=1"),
      ).toBeNull();
    });

    // Reason: issue #1226 safety — comment stripping must be literal-aware.
    // A naive regex strip would treat the `--` inside the string literal as a
    // comment start and delete the trailing `UNION SELECT ...`, flipping a
    // genuinely multi-source query to falsely-editable (data-integrity risk)
    // (2026-07-03).
    it("keeps a UNION read-only even when a string literal contains --", () => {
      expect(
        parseSingleTableSelect(
          "SELECT * FROM users WHERE note = '-- ' UNION SELECT * FROM admins",
        ),
      ).toBeNull();
    });

    // Reason: issue #1226 — a JOIN token inside a WHERE string literal is not
    // a join; baseline confirms it stays editable and the fix preserves it
    // (the literal sits past the WHERE boundary) (2026-07-03).
    it("treats a WHERE string literal containing JOIN as single-table", () => {
      expect(
        parseSingleTableSelect("SELECT * FROM users WHERE note = 'JOIN'"),
      ).toEqual({ schema: null, table: "users" });
    });
  });
});

describe("analyzeResultEditability", () => {
  beforeAll(async () => {
    __resetSqlWasmModuleForTests();
    await preloadSqlWasm();
  });
  afterAll(() => __resetSqlWasmModuleForTests());

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

// Purpose: default-schema resolution for editable single-table SELECTs must
// follow each DBMS convention, not assume PostgreSQL "public" — issue #1066.
describe("resolveDefaultSchema", () => {
  // Reason: bug #1066 — mssql defaulted to "public" so `SELECT * FROM mytable`
  // never matched the cached "dbo" columns, breaking edit judgment (2026-07-03).
  it("maps mssql to dbo", () => {
    expect(resolveDefaultSchema("mssql", "master", "sa")).toBe("dbo");
  });

  // Reason: bug #1066 — Oracle's default schema is the connecting user, stored
  // upper-case in the catalog (2026-07-03).
  it("maps oracle to the upper-cased connecting user", () => {
    expect(resolveDefaultSchema("oracle", "FREEPDB1", "system")).toBe("SYSTEM");
  });

  // Reason: bug #1066 — MySQL/MariaDB have no schema layer; schema == database,
  // so an unqualified table lives in the active database (2026-07-03).
  it("maps mysql and mariadb to the active database", () => {
    expect(resolveDefaultSchema("mysql", "shop", "root")).toBe("shop");
    expect(resolveDefaultSchema("mariadb", "shop", "root")).toBe("shop");
  });

  // Reason: pre-#1066 behavior for pg/sqlite/duckdb must be preserved (2026-07-03).
  it("keeps postgresql on public and sqlite/duckdb on main", () => {
    expect(resolveDefaultSchema("postgresql", "postgres", "postgres")).toBe(
      "public",
    );
    expect(resolveDefaultSchema("sqlite", "", "")).toBe("main");
    expect(resolveDefaultSchema("duckdb", "", "")).toBe("main");
  });
});

// Purpose: end-to-end regression — an unqualified single-table SELECT on
// mssql/oracle must resolve to the DBMS default schema in the edit plan, so the
// result grid matches cached PK metadata instead of a phantom "public" table.
// Issue #1066 (bug, area:frontend, P1).
describe("analyzeResultEditability — per-DBMS default schema (#1066)", () => {
  beforeAll(async () => {
    __resetSqlWasmModuleForTests();
    await preloadSqlWasm();
  });
  afterAll(() => __resetSqlWasmModuleForTests());

  const TABLE_COLS = [col("id", "integer", true), col("name", "text")];

  // Reason: bug #1066 — before the fix this returned schema "public",
  // producing a wrong editability match on SQL Server (2026-07-03).
  it("resolves an unqualified mssql table to dbo", () => {
    const result = analyzeResultEditability(
      "SELECT id, name FROM mytable",
      [qcol("id"), qcol("name")],
      TABLE_COLS,
      resolveDefaultSchema("mssql", "master", "sa"),
    );
    expect(result.editable).toBe(true);
    if (result.editable) {
      expect(result.schema).toBe("dbo");
    }
  });

  // Reason: bug #1066 — Oracle default schema = connecting user (2026-07-03).
  it("resolves an unqualified oracle table to the connecting user", () => {
    const result = analyzeResultEditability(
      "SELECT id, name FROM mytable",
      [qcol("id"), qcol("name")],
      TABLE_COLS,
      resolveDefaultSchema("oracle", "FREEPDB1", "system"),
    );
    expect(result.editable).toBe(true);
    if (result.editable) {
      expect(result.schema).toBe("SYSTEM");
    }
  });
});

// Purpose: issue #1297 — the editability gate now consumes the sql-parser-core
// AST. A PK carried only under a column alias (`id AS user_id`) must become
// editable, with `resultToColumnName` holding the SOURCE column names (so the
// raw-edit builder's WHERE / UPDATE SET target the real columns unchanged).
// Aggregations / GROUP BY / set-ops / expression projections / parse failures
// stay read-only (fallback never opens editing).
describe("analyzeResultEditability — AST alias mapping (#1297)", () => {
  beforeAll(async () => {
    __resetSqlWasmModuleForTests();
    await preloadSqlWasm();
  });
  afterAll(() => __resetSqlWasmModuleForTests());

  const TABLE_COLS = [col("id", "integer", true), col("name", "text")];

  it("treats an aliased PK column as editable and maps result names to source names", () => {
    const result = analyzeResultEditability(
      "SELECT id AS user_id, name FROM users",
      [qcol("user_id"), qcol("name")],
      TABLE_COLS,
    );
    expect(result.editable).toBe(true);
    if (result.editable) {
      expect(result.table).toBe("users");
      expect(result.pkColumns).toEqual(["id"]);
      // Source column names, aligned to result column order — this is what
      // the builder uses for both value lookup (by position) and WHERE/SET
      // identifiers.
      expect(result.resultToColumnName).toEqual(["id", "name"]);
    }
  });

  it("keeps a schema-qualified aliased single-table SELECT editable", () => {
    const result = analyzeResultEditability(
      "SELECT id AS pk FROM app.users",
      [qcol("pk")],
      [col("id", "integer", true)],
    );
    expect(result.editable).toBe(true);
    if (result.editable) {
      expect(result.schema).toBe("app");
      expect(result.table).toBe("users");
      expect(result.resultToColumnName).toEqual(["id"]);
    }
  });

  it("stays read-only for an expression projection", () => {
    const result = analyzeResultEditability(
      "SELECT id, upper(name) AS n FROM users",
      [qcol("id"), qcol("n")],
      TABLE_COLS,
    );
    expect(result.editable).toBe(false);
  });

  it("stays read-only for a GROUP BY aggregation", () => {
    const result = analyzeResultEditability(
      "SELECT id FROM users GROUP BY id",
      [qcol("id")],
      TABLE_COLS,
    );
    expect(result.editable).toBe(false);
  });

  it("stays read-only for a set operation", () => {
    const result = analyzeResultEditability(
      "SELECT id FROM users UNION SELECT id FROM admins",
      [qcol("id")],
      TABLE_COLS,
    );
    expect(result.editable).toBe(false);
  });

  it("stays read-only for a derived table in FROM", () => {
    const result = analyzeResultEditability(
      "SELECT id FROM (SELECT id FROM users) sub",
      [qcol("id")],
      TABLE_COLS,
    );
    expect(result.editable).toBe(false);
  });

  it("falls back to read-only on a parse failure (never opens editing)", () => {
    const result = analyzeResultEditability(
      "SELECT id FROM users WHERE",
      [qcol("id")],
      TABLE_COLS,
    );
    expect(result.editable).toBe(false);
  });

  it("still allows a plain single-table SELECT (no regression)", () => {
    const result = analyzeResultEditability(
      "SELECT id, name FROM public.users",
      [qcol("id"), qcol("name")],
      TABLE_COLS,
    );
    expect(result.editable).toBe(true);
    if (result.editable) {
      expect(result.resultToColumnName).toEqual(["id", "name"]);
    }
  });
});

// Purpose: issue #1297 requirement #4 — when the WASM AST is not available
// (cold start / load failure) the gate must fall back to read-only, never to
// editable. This describe deliberately evicts the module first.
describe("analyzeResultEditability — WASM unavailable fallback (#1297)", () => {
  beforeAll(() => __resetSqlWasmModuleForTests());
  afterAll(() => __resetSqlWasmModuleForTests());

  it("is read-only until the AST parser has loaded", () => {
    const result = analyzeResultEditability(
      "SELECT id FROM users",
      [qcol("id")],
      [col("id", "integer", true)],
    );
    expect(result.editable).toBe(false);
  });
});

describe("analyzeMultiTableEditability (#1299)", () => {
  beforeAll(async () => {
    __resetSqlWasmModuleForTests();
    await preloadSqlWasm();
  });
  afterAll(() => __resetSqlWasmModuleForTests());

  // Schema lookup: (schema, table) -> ResolverColumn[] | null.
  const lookup = (_schema: string | null, table: string) => {
    if (table === "users")
      return [
        { name: "id", is_primary_key: true },
        { name: "name", is_primary_key: false },
      ];
    if (table === "orders")
      return [
        { name: "id", is_primary_key: true },
        { name: "user_id", is_primary_key: false },
        { name: "total", is_primary_key: false },
      ];
    return null;
  };

  it("makes a JOIN result editable with per-column instance attribution", () => {
    const sql =
      "SELECT u.id, u.name, o.id, o.total FROM users u JOIN orders o ON o.user_id = u.id";
    const cols = [qcol("id"), qcol("name"), qcol("id"), qcol("total")];
    const r = analyzeMultiTableEditability(sql, cols, lookup, "public");
    expect(r.editable).toBe(true);
    if (!r.editable) return;
    expect(r.plan.instances).toHaveLength(2);
    expect(r.plan.columns[0]).toMatchObject({
      instance: 0,
      sourceColumn: "id",
      editable: true,
    });
    expect(r.plan.columns[3]).toMatchObject({
      instance: 1,
      sourceColumn: "total",
      editable: true,
    });
    // users PK is at result index 0, orders PK at result index 2.
    expect(r.plan.instances[0]).toMatchObject({
      table: "users",
      pkPositions: { id: 0 },
    });
    expect(r.plan.instances[1]).toMatchObject({
      table: "orders",
      pkPositions: { id: 2 },
    });
  });

  it("keeps an aliased-PK JOIN editable (alias-aware resolver)", () => {
    const sql =
      "SELECT u.id AS uid, o.id AS oid, o.total AS amt FROM users u JOIN orders o ON o.user_id = u.id";
    const cols = [qcol("uid"), qcol("oid"), qcol("amt")];
    const r = analyzeMultiTableEditability(sql, cols, lookup, "public");
    expect(r.editable).toBe(true);
    if (!r.editable) return;
    expect(r.plan.columns[0]).toMatchObject({
      instance: 0,
      sourceColumn: "id",
      editable: true,
    });
    // orders.total editable because orders.id (aliased `oid`) carries its PK.
    expect(r.plan.columns[2]).toMatchObject({
      instance: 1,
      sourceColumn: "total",
      editable: true,
    });
  });

  it("marks a column read-only when its instance PK is absent from the result", () => {
    // orders.id is NOT projected → orders columns cannot be identified.
    const sql =
      "SELECT u.id, u.name, o.total FROM users u JOIN orders o ON o.user_id = u.id";
    const cols = [qcol("id"), qcol("name"), qcol("total")];
    const r = analyzeMultiTableEditability(sql, cols, lookup, "public");
    expect(r.editable).toBe(true);
    if (!r.editable) return;
    expect(r.plan.columns[0]).toMatchObject({ editable: true }); // users editable
    const ordersCol = r.plan.columns[2]!;
    expect(ordersCol.editable).toBe(false);
    expect(ordersCol.readonlyReason).toBeTruthy();
  });

  it("downgrades the whole result to read-only on a name self-verification mismatch", () => {
    // Result's second column name (`nickname`) differs from the projected
    // `name` → resolver poisons the positional model → read-only.
    const sql =
      "SELECT u.id, u.name FROM users u JOIN orders o ON o.user_id = u.id";
    const cols = [qcol("id"), qcol("nickname")];
    const r = analyzeMultiTableEditability(sql, cols, lookup, "public");
    expect(r.editable).toBe(false);
  });
});
