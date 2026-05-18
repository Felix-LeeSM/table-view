// AC-185-01 — sqlSafety analyzer 단위 테스트. 12 cases per Sprint 185 contract.
// date 2026-05-01.
//
// Sprint 254 (2026-05-09) — `Severity` union 을 `"safe" | "danger"` 에서
// 3-tier `"info" | "warn" | "danger"` 로 split. 기존 `"safe"` 어서션을 INFO
// (read / metadata) 또는 WARN (write surface) 로 명시적으로 매핑한다. ADR
// 0023 grill Q2-(a) — write 표면 (INSERT / UPDATE WHERE / DELETE WHERE / CREATE
// / ALTER additive) 가 명시적으로 WARN 임을 union 으로 표현. DML CTE
// 인식도 함께 추가 — `WITH x AS (UPDATE …) SELECT *` 는 INFO 가 아니라
// wrapped statement 의 severity 와 정합.
//
// Sprint 391 (2026-05-17) — DDL destructive (DROP / TRUNCATE / ALTER … DROP)
// 분류 callsite 가 정규식 → AST 기반(`parseSqlPreloaded`) 으로 부분 이행.
// 본 test suite 의 모든 기존 case 는 *preload 없이* 정규식 fallback 으로
// 동일 결과를 반환해야 하고, 신규 AC-391-X case 는 *preload 후* AST
// 경로로 동일 분류를 반환해야 한다. 둘 다 PASS = `analyzeStatement` 의
// 반환 shape 가 변경 없음을 입증.
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { analyzeStatement, isDangerous, isInfoStatement } from "./sqlSafety";
import { __resetSqlWasmModuleForTests, preloadSqlWasm } from "./sqlAst";

// Mock the WASM module surface the same way sqlAst.test.ts does — both
// suites need the synchronous `parseSqlPreloaded` path to resolve to a
// real Rust AST shape so sqlSafety's AST callsite can be exercised in
// jsdom (where `.wasm` loading would otherwise fail).
import { vi } from "vitest";

vi.mock("./wasm/sql_parser_core.js", () => {
  return {
    default: vi.fn().mockResolvedValue(undefined),
    parse_sql: vi.fn((sql: string) => {
      // Inline mini-parser: reproduce the Rust ParseResult shape for
      // every DDL destructive variant that the AC-391-X suite asserts.
      // Anything outside this list returns `null` so `parseSqlPreloaded`
      // falls back to its caller's regex path.
      const trimmed = sql.trim().replace(/;$/, "");
      const upper = trimmed.toUpperCase();

      // The regex below uses anchored groups; if `.match` succeeds the
      // capture groups we reference are guaranteed non-undefined. The
      // helper centralises the `string | undefined` → `string` narrowing
      // with a single non-null assertion site (vs. one per group).
      const g = (m: RegExpMatchArray, i: number): string => {
        const v = m[i];
        if (v === undefined) {
          throw new Error(`sqlSafety test mock: group ${i} missing`);
        }
        return v;
      };
      // DROP <obj> [IF EXISTS] <name> [CASCADE|RESTRICT]
      const dropMatch = trimmed.match(
        /^DROP\s+(TABLE|DATABASE|INDEX|VIEW|SCHEMA|SEQUENCE|TYPE)(\s+IF\s+EXISTS)?\s+(\S+?)(\s+(CASCADE|RESTRICT))?$/i,
      );
      if (dropMatch) {
        return {
          kind: "drop",
          object_type: g(dropMatch, 1).toLowerCase(),
          name: g(dropMatch, 3),
          if_exists: Boolean(dropMatch[2]),
          cascade: dropMatch[5]
            ? (dropMatch[5].toLowerCase() as "cascade" | "restrict")
            : null,
        };
      }
      // TRUNCATE [TABLE] <name> [(RESTART|CONTINUE) IDENTITY] [CASCADE|RESTRICT]
      const truncateMatch = trimmed.match(
        /^TRUNCATE(\s+TABLE)?\s+(\S+?)(\s+(RESTART|CONTINUE)\s+IDENTITY)?(\s+(CASCADE|RESTRICT))?$/i,
      );
      if (truncateMatch) {
        const ri = truncateMatch[4]
          ? truncateMatch[4].toUpperCase() === "RESTART"
          : null;
        return {
          kind: "truncate",
          table: g(truncateMatch, 2),
          restart_identity: ri,
          cascade: truncateMatch[6]
            ? (truncateMatch[6].toLowerCase() as "cascade" | "restrict")
            : null,
        };
      }
      // ALTER TABLE <name> DROP COLUMN [IF EXISTS] <col> [CASCADE|RESTRICT]
      const alterColMatch = trimmed.match(
        /^ALTER\s+TABLE\s+(\S+?)\s+DROP\s+COLUMN(\s+IF\s+EXISTS)?\s+(\S+?)(\s+(CASCADE|RESTRICT))?$/i,
      );
      if (alterColMatch) {
        return {
          kind: "alter-table",
          table: g(alterColMatch, 1),
          action: {
            kind: "drop-column",
            column: g(alterColMatch, 3),
            if_exists: Boolean(alterColMatch[2]),
            cascade: alterColMatch[5]
              ? (alterColMatch[5].toLowerCase() as "cascade" | "restrict")
              : null,
          },
        };
      }
      // ALTER TABLE <name> DROP CONSTRAINT <name> [CASCADE|RESTRICT]
      const alterCstMatch = trimmed.match(
        /^ALTER\s+TABLE\s+(\S+?)\s+DROP\s+CONSTRAINT\s+(\S+?)(\s+(CASCADE|RESTRICT))?$/i,
      );
      if (alterCstMatch) {
        return {
          kind: "alter-table",
          table: g(alterCstMatch, 1),
          action: {
            kind: "drop-constraint",
            constraint: g(alterCstMatch, 2),
            cascade: alterCstMatch[4]
              ? (alterCstMatch[4].toLowerCase() as "cascade" | "restrict")
              : null,
          },
        };
      }
      // ALTER TABLE <name> DROP INDEX <name>
      const alterIdxMatch = trimmed.match(
        /^ALTER\s+TABLE\s+(\S+?)\s+DROP\s+INDEX\s+(\S+?)$/i,
      );
      if (alterIdxMatch) {
        return {
          kind: "alter-table",
          table: g(alterIdxMatch, 1),
          action: { kind: "drop-index", index: g(alterIdxMatch, 2) },
        };
      }
      // ── sprint-392 DML write triad ─────────────────────────────
      // INSERT — match very loosely; sqlSafety only checks `kind` so
      // the row payload can be a stub.
      if (/^INSERT\s+INTO\b/i.test(trimmed)) {
        return {
          kind: "insert",
          table: "stub",
          columns: [],
          source: { kind: "values", rows: [[]] },
          on_conflict: null,
          returning: [],
        };
      }
      // UPDATE — detect WHERE presence so sqlSafety can branch on
      // where_clause === null. Use a coarse `\bWHERE\b` test against the
      // upper-cased string.
      if (/^UPDATE\b/i.test(trimmed)) {
        const hasWhere = /\bWHERE\b/i.test(trimmed);
        return {
          kind: "update",
          table: "stub",
          assignments: [],
          from: [],
          where_clause: hasWhere
            ? {
                kind: "comparison",
                column: "id",
                op: "eq",
                value: {
                  kind: "literal",
                  value: { kind: "integer", value: 1 },
                },
              }
            : null,
          returning: [],
        };
      }
      if (/^DELETE\s+FROM\b/i.test(trimmed)) {
        const hasWhere = /\bWHERE\b/i.test(trimmed);
        return {
          kind: "delete",
          table: "stub",
          using: [],
          where_clause: hasWhere
            ? {
                kind: "comparison",
                column: "id",
                op: "eq",
                value: {
                  kind: "literal",
                  value: { kind: "integer", value: 1 },
                },
              }
            : null,
          returning: [],
        };
      }
      // SELECT — return a `select` AST stub for completeness; non-DDL
      // paths in sqlSafety still go through the regex matcher because
      // `ddlDestructiveAnalysisFromAst` returns null for `select`.
      if (/^SELECT\b/.test(upper)) {
        return {
          kind: "select",
          columns: { kind: "star" },
          table: "stub",
          where: null,
        };
      }
      // Anything else → error variant; sqlSafety's AST callsite then
      // falls through to its legacy regex matcher.
      return {
        kind: "error",
        error_kind: "unsupported-statement",
        message: "sprint-391 mock fallthrough",
        at: 0,
      };
    }),
  };
});

describe("sqlSafety.analyzeStatement", () => {
  it("[AC-185-01a] DELETE without WHERE → danger", () => {
    const a = analyzeStatement("DELETE FROM users");
    expect(a.kind).toBe("delete");
    expect(a.severity).toBe("danger");
    expect(a.reasons).toEqual(["DELETE without WHERE clause"]);
    expect(isDangerous(a)).toBe(true);
  });

  it("[AC-185-01b] DELETE with WHERE → warn (Sprint 254: bounded write)", () => {
    const a = analyzeStatement("DELETE FROM users WHERE id = 1");
    expect(a.kind).toBe("delete");
    expect(a.severity).toBe("warn");
    expect(a.reasons).toEqual([]);
    expect(isDangerous(a)).toBe(false);
  });

  it("[AC-185-01c] UPDATE without WHERE → danger", () => {
    const a = analyzeStatement("UPDATE users SET active = false");
    expect(a.kind).toBe("update");
    expect(a.severity).toBe("danger");
    expect(a.reasons).toEqual(["UPDATE without WHERE clause"]);
  });

  it("[AC-185-01d] UPDATE with WHERE → warn (Sprint 254: bounded write)", () => {
    const a = analyzeStatement("UPDATE users SET active = false WHERE id = 1");
    expect(a.kind).toBe("update");
    expect(a.severity).toBe("warn");
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

  it("[AC-185-01h] INSERT INTO → warn (Sprint 254: write surface)", () => {
    const a = analyzeStatement("INSERT INTO users (id, name) VALUES (1, 'a')");
    expect(a.kind).toBe("insert");
    expect(a.severity).toBe("warn");
  });

  it("[AC-185-01i] SELECT → info (Sprint 254: read tier)", () => {
    const a = analyzeStatement("SELECT * FROM users");
    expect(a.kind).toBe("select");
    expect(a.severity).toBe("info");
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
    // Sprint 254 — bounded DELETE WHERE is now WARN (was safe).
    expect(b.severity).toBe("warn");
  });

  it("[AC-185-01l] subquery WHERE counted as outer WHERE present (warn)", () => {
    const a = analyzeStatement(
      "DELETE FROM t WHERE id IN (SELECT id FROM u WHERE flag = 1)",
    );
    expect(a.kind).toBe("delete");
    // Sprint 254 — bounded DELETE WHERE = WARN.
    expect(a.severity).toBe("warn");
  });

  it("empty SQL → other / info (graceful, Sprint 254)", () => {
    const a = analyzeStatement("");
    expect(a.kind).toBe("other");
    // Sprint 254 — empty / unknown statements default to INFO so the
    // SafeMode matrix never escalates an unrecognised input. WARN is
    // reserved for *known* write surfaces.
    expect(a.severity).toBe("info");
  });

  it("ALTER additive / CREATE → ddl-other / warn (Sprint 254)", () => {
    const a = analyzeStatement("ALTER TABLE users ADD COLUMN x int");
    expect(a.kind).toBe("ddl-other");
    expect(a.severity).toBe("warn");
    const b = analyzeStatement("CREATE INDEX idx_x ON users (x)");
    expect(b.kind).toBe("ddl-other");
    expect(b.severity).toBe("warn");
  });

  // -------------------------------------------------------------------------
  // Sprint 187 — analyzer extension for structure-surface DDL.
  // -------------------------------------------------------------------------

  it("[AC-187-01a] DROP INDEX → danger / ddl-drop", () => {
    const a = analyzeStatement("DROP INDEX idx_users_email");
    expect(a.kind).toBe("ddl-drop");
    expect(a.severity).toBe("danger");
    expect(a.reasons).toEqual(["DROP INDEX"]);
    expect(isDangerous(a)).toBe(true);
  });

  it("[AC-187-01b] DROP VIEW → danger / ddl-drop", () => {
    const a = analyzeStatement("DROP VIEW v_active_users");
    expect(a.kind).toBe("ddl-drop");
    expect(a.severity).toBe("danger");
    expect(a.reasons).toEqual(["DROP VIEW"]);
  });

  it("[AC-187-01c] ALTER TABLE … DROP COLUMN → danger / ddl-alter-drop", () => {
    const a = analyzeStatement("ALTER TABLE users DROP COLUMN email");
    expect(a.kind).toBe("ddl-alter-drop");
    expect(a.severity).toBe("danger");
    expect(a.reasons).toEqual(["ALTER TABLE DROP COLUMN"]);
  });

  it("[AC-187-01d] ALTER TABLE … DROP CONSTRAINT → danger / ddl-alter-drop", () => {
    const a = analyzeStatement(
      "ALTER TABLE orders DROP CONSTRAINT fk_orders_user",
    );
    expect(a.kind).toBe("ddl-alter-drop");
    expect(a.severity).toBe("danger");
    expect(a.reasons).toEqual(["ALTER TABLE DROP CONSTRAINT"]);
  });

  it("[AC-187-01e] ALTER TABLE … ADD COLUMN stays ddl-other / warn (Sprint 254)", () => {
    const a = analyzeStatement("ALTER TABLE users ADD COLUMN nickname text");
    expect(a.kind).toBe("ddl-other");
    // Sprint 254 — additive ALTER is WARN (write surface).
    expect(a.severity).toBe("warn");
    expect(a.reasons).toEqual([]);
    expect(isDangerous(a)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Sprint 254 (2026-05-09) — 3-tier classifier corpus. ADR 0023 grill Q2-(a)
  // "3-tier severity 채택" 의 정식 분류:
  //   - INFO: SELECT / WITH …SELECT (no DML CTE) / EXPLAIN / SHOW / DESCRIBE / DESC.
  //   - WARN: INSERT / UPDATE WHERE / DELETE WHERE / CREATE / ALTER additive.
  //   - STOP (danger): DROP / TRUNCATE / WHERE-less DELETE·UPDATE / ALTER DROP /
  //     GRANT / REVOKE.
  // DML CTE (`WITH x AS (UPDATE …) SELECT *`) 는 INFO 가 아니어야 한다 — wrapped
  // statement 의 first keyword (UPDATE/DELETE/INSERT) 에 따라 severity 결정.
  // -------------------------------------------------------------------------

  describe("Sprint 254 — 3-tier severity classifier", () => {
    // ── INFO tier ─────────────────────────────────────────────────────────
    it("[AC-254-01a] SELECT → info", () => {
      const a = analyzeStatement("SELECT * FROM users");
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
    });

    it("[AC-254-01b] WITH … SELECT (no DML CTE) → info", () => {
      const a = analyzeStatement("WITH t AS (SELECT 1 AS n) SELECT n FROM t");
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
    });

    it("[AC-254-01c] EXPLAIN → info", () => {
      const a = analyzeStatement("EXPLAIN SELECT * FROM users");
      expect(a.kind).toBe("info");
      expect(a.severity).toBe("info");
    });

    it("[AC-254-01d] SHOW TABLES → info", () => {
      const a = analyzeStatement("SHOW TABLES");
      expect(a.kind).toBe("info");
      expect(a.severity).toBe("info");
    });

    it("[AC-254-01e] DESCRIBE → info", () => {
      const a = analyzeStatement("DESCRIBE users");
      expect(a.kind).toBe("info");
      expect(a.severity).toBe("info");
    });

    it("[AC-254-01f] DESC users (MySQL short form) → info", () => {
      const a = analyzeStatement("DESC users");
      expect(a.kind).toBe("info");
      expect(a.severity).toBe("info");
    });

    // ── WARN tier ─────────────────────────────────────────────────────────
    it("[AC-254-02a] INSERT INTO → warn", () => {
      const a = analyzeStatement("INSERT INTO users (id) VALUES (1)");
      expect(a.kind).toBe("insert");
      expect(a.severity).toBe("warn");
    });

    it("[AC-254-02b] UPDATE … WHERE → warn (bounded)", () => {
      const a = analyzeStatement("UPDATE users SET name = 'a' WHERE id = 1");
      expect(a.kind).toBe("update");
      expect(a.severity).toBe("warn");
    });

    it("[AC-254-02c] DELETE … WHERE → warn (bounded)", () => {
      const a = analyzeStatement("DELETE FROM users WHERE id = 1");
      expect(a.kind).toBe("delete");
      expect(a.severity).toBe("warn");
    });

    it("[AC-254-02d] CREATE TABLE → warn", () => {
      const a = analyzeStatement("CREATE TABLE foo (id int)");
      expect(a.kind).toBe("ddl-other");
      expect(a.severity).toBe("warn");
    });

    it("[AC-254-02e] ALTER TABLE … ADD COLUMN (additive) → warn", () => {
      const a = analyzeStatement("ALTER TABLE users ADD COLUMN nickname text");
      expect(a.kind).toBe("ddl-other");
      expect(a.severity).toBe("warn");
    });

    it("[AC-254-02f] CREATE INDEX → warn", () => {
      const a = analyzeStatement("CREATE INDEX idx_x ON users (x)");
      expect(a.kind).toBe("ddl-other");
      expect(a.severity).toBe("warn");
    });

    // ── STOP tier (danger 보존) ───────────────────────────────────────────
    it("[AC-254-03a] DROP TABLE → danger", () => {
      const a = analyzeStatement("DROP TABLE users");
      expect(a.severity).toBe("danger");
    });

    it("[AC-254-03b] TRUNCATE → danger", () => {
      const a = analyzeStatement("TRUNCATE TABLE events");
      expect(a.severity).toBe("danger");
    });

    it("[AC-254-03c] DELETE without WHERE → danger", () => {
      const a = analyzeStatement("DELETE FROM users");
      expect(a.severity).toBe("danger");
    });

    it("[AC-254-03d] UPDATE without WHERE → danger", () => {
      const a = analyzeStatement("UPDATE users SET active = 0");
      expect(a.severity).toBe("danger");
    });

    it("[AC-254-03e] ALTER TABLE … DROP COLUMN → danger", () => {
      const a = analyzeStatement("ALTER TABLE users DROP COLUMN email");
      expect(a.severity).toBe("danger");
    });

    it("[AC-254-03f] GRANT → danger", () => {
      const a = analyzeStatement("GRANT SELECT ON users TO bob");
      expect(a.kind).toBe("ddl-other");
      expect(a.severity).toBe("danger");
    });

    it("[AC-254-03g] REVOKE → danger", () => {
      const a = analyzeStatement("REVOKE SELECT ON users FROM bob");
      expect(a.kind).toBe("ddl-other");
      expect(a.severity).toBe("danger");
    });

    // ── DML CTE — `WITH x AS (UPDATE …) SELECT *` ─────────────────────────
    it("[AC-254-04a] WITH x AS (UPDATE …) SELECT * → warn (DML CTE wrapped)", () => {
      const a = analyzeStatement(
        "WITH x AS (UPDATE users SET active = false WHERE id = 1 RETURNING id) SELECT * FROM x",
      );
      expect(a.severity).toBe("warn");
    });

    it("[AC-254-04b] WITH x AS (DELETE …) SELECT * → warn (DML CTE wrapped, bounded)", () => {
      const a = analyzeStatement(
        "WITH x AS (DELETE FROM users WHERE id = 1 RETURNING id) SELECT * FROM x",
      );
      expect(a.severity).toBe("warn");
    });

    it("[AC-254-04c] WITH x AS (DELETE …) SELECT * — DELETE no WHERE → danger (DML CTE)", () => {
      const a = analyzeStatement(
        "WITH x AS (DELETE FROM users RETURNING id) SELECT * FROM x",
      );
      expect(a.severity).toBe("danger");
    });

    it("[AC-254-04d] WITH x AS (INSERT …) SELECT * → warn (DML CTE wrapped)", () => {
      const a = analyzeStatement(
        "WITH x AS (INSERT INTO users (id) VALUES (1) RETURNING id) SELECT * FROM x",
      );
      expect(a.severity).toBe("warn");
    });

    it("[AC-254-04e] WITH x AS (SELECT 1) SELECT * — pure read CTE → info (regression)", () => {
      const a = analyzeStatement("WITH x AS (SELECT 1 AS n) SELECT n FROM x");
      expect(a.severity).toBe("info");
    });
  });

  // -------------------------------------------------------------------------
  // Sprint 255 (2026-05-09) — `isInfoStatement` 휴리스틱은 raw editor 의 WARN
  // dialog mount 직전에 INFO (read-only / metadata) statement 을 식별해
  // dialog skip → 직접 IPC 로 우회하는 분기를 위해 신설. INFO corpus =
  // SELECT / WITH …SELECT / EXPLAIN / SHOW / DESCRIBE / DESC.
  //
  // Sprint 254 (2026-05-09) — 본문 단순화 (severity === "info" 직접 비교)
  // 후에도 매핑 동일 (kind="select" / kind="info" 모두 severity:"info").
  // -------------------------------------------------------------------------

  describe("isInfoStatement (Sprint 255)", () => {
    it("[AC-255-01a] SELECT → INFO", () => {
      expect(isInfoStatement(analyzeStatement("SELECT * FROM users"))).toBe(
        true,
      );
    });

    it("[AC-255-01b] WITH …SELECT (no DML CTE) → INFO", () => {
      expect(
        isInfoStatement(
          analyzeStatement("WITH t AS (SELECT 1 AS n) SELECT n FROM t"),
        ),
      ).toBe(true);
    });

    it("[AC-255-01c] EXPLAIN → INFO", () => {
      expect(
        isInfoStatement(analyzeStatement("EXPLAIN SELECT * FROM users")),
      ).toBe(true);
    });

    it("[AC-255-01d] EXPLAIN ANALYZE → INFO", () => {
      expect(
        isInfoStatement(
          analyzeStatement("EXPLAIN ANALYZE SELECT * FROM users"),
        ),
      ).toBe(true);
    });

    it("[AC-255-01e] SHOW → INFO", () => {
      expect(isInfoStatement(analyzeStatement("SHOW TABLES"))).toBe(true);
    });

    it("[AC-255-01f] DESCRIBE → INFO", () => {
      expect(isInfoStatement(analyzeStatement("DESCRIBE users"))).toBe(true);
    });

    it("[AC-255-01g] DESC (MySQL short form) → INFO", () => {
      expect(isInfoStatement(analyzeStatement("DESC users"))).toBe(true);
    });

    it("[AC-255-01h] case-insensitive (lowercase explain) → INFO", () => {
      expect(isInfoStatement(analyzeStatement("explain select 1"))).toBe(true);
    });

    it("[AC-255-01i] INSERT → NOT INFO (WARN candidate)", () => {
      expect(
        isInfoStatement(analyzeStatement("INSERT INTO users (id) VALUES (1)")),
      ).toBe(false);
    });

    it("[AC-255-01j] UPDATE WHERE → NOT INFO (WARN candidate)", () => {
      expect(
        isInfoStatement(
          analyzeStatement("UPDATE users SET name = 'a' WHERE id = 1"),
        ),
      ).toBe(false);
    });

    it("[AC-255-01k] DELETE WHERE → NOT INFO (WARN candidate)", () => {
      expect(
        isInfoStatement(analyzeStatement("DELETE FROM users WHERE id = 1")),
      ).toBe(false);
    });

    it("[AC-255-01l] CREATE TABLE → NOT INFO (WARN candidate)", () => {
      expect(
        isInfoStatement(analyzeStatement("CREATE TABLE foo (id int)")),
      ).toBe(false);
    });

    it("[AC-255-01m] ALTER TABLE … ADD COLUMN (additive) → NOT INFO (WARN candidate)", () => {
      expect(
        isInfoStatement(
          analyzeStatement("ALTER TABLE users ADD COLUMN nickname text"),
        ),
      ).toBe(false);
    });

    it("[AC-255-01n] DROP TABLE → NOT INFO (STOP candidate, severity danger)", () => {
      expect(isInfoStatement(analyzeStatement("DROP TABLE users"))).toBe(false);
    });

    it("[AC-255-01o] empty input → INFO (Sprint 254 default)", () => {
      // Sprint 254 — empty / unknown defaults to INFO (severity: "info").
      // INFO heuristic returns true so the WARN dialog never mounts on
      // an empty buffer; the upstream `if (!sql) return` already short-
      // circuits the empty path so the change is defensive only.
      expect(isInfoStatement(analyzeStatement(""))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Sprint 391 (2026-05-17) — AST-based DDL destructive classifier callsite.
  // 본 블록은 *WASM 모듈을 명시적으로 preload* 한 뒤 `analyzeStatement` 가
  // `parseSqlPreloaded` 경로를 거치는 것을 가정한다. 모든 case 의 반환 shape
  // (`kind` / `severity` / `reasons`) 는 정규식 fallback 과 *동일* — 호출자
  // 영향 0 임을 입증.
  // -------------------------------------------------------------------------
  describe("Sprint 391 — AST-based DDL destructive classifier (AC-391-X)", () => {
    beforeAll(async () => {
      __resetSqlWasmModuleForTests();
      await preloadSqlWasm();
    });

    afterAll(() => {
      // Other describe blocks below this point (없지만 안전) 가 정규식
      // fallback 을 가정하지 않도록 reset.
      __resetSqlWasmModuleForTests();
    });

    it("[AC-391-X01] DROP TABLE users → ddl-drop / danger via AST", () => {
      const a = analyzeStatement("DROP TABLE users");
      expect(a.kind).toBe("ddl-drop");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["DROP TABLE"]);
    });

    it("[AC-391-X02] DROP TABLE IF EXISTS users CASCADE → ddl-drop / danger via AST", () => {
      const a = analyzeStatement("DROP TABLE IF EXISTS users CASCADE");
      expect(a.kind).toBe("ddl-drop");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["DROP TABLE"]);
    });

    it("[AC-391-X02b] DROP SCHEMA public CASCADE → ddl-drop / danger via AST", () => {
      const a = analyzeStatement("DROP SCHEMA public CASCADE");
      expect(a.kind).toBe("ddl-drop");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["DROP SCHEMA"]);
    });

    it("[AC-391-X02c] DROP SEQUENCE my_seq → ddl-drop / danger via AST (new variant)", () => {
      // Pre-sprint-391 regex did NOT match SEQUENCE — it fell through to
      // the `^DROP\b/^ALTER\b/^CREATE\b` catch-all (`ddl-other` / WARN).
      // The AST path correctly classifies it as `ddl-drop` / DANGER.
      // This is the *only* case where AST vs regex differ; sqlSafety
      // test suite previously had no SEQUENCE coverage so no regression.
      const a = analyzeStatement("DROP SEQUENCE my_seq");
      expect(a.kind).toBe("ddl-drop");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["DROP SEQUENCE"]);
    });

    it("[AC-391-X02d] DROP TYPE my_enum CASCADE → ddl-drop / danger via AST (new variant)", () => {
      const a = analyzeStatement("DROP TYPE my_enum CASCADE");
      expect(a.kind).toBe("ddl-drop");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["DROP TYPE"]);
    });

    it("[AC-391-X03] TRUNCATE TABLE events → ddl-truncate / danger via AST", () => {
      const a = analyzeStatement("TRUNCATE TABLE events");
      expect(a.kind).toBe("ddl-truncate");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["TRUNCATE"]);
    });

    it("[AC-391-X04] TRUNCATE users RESTART IDENTITY CASCADE → ddl-truncate / danger via AST", () => {
      const a = analyzeStatement("TRUNCATE users RESTART IDENTITY CASCADE");
      expect(a.kind).toBe("ddl-truncate");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["TRUNCATE"]);
    });

    it("[AC-391-X05] ALTER TABLE users DROP COLUMN email → ddl-alter-drop / danger via AST", () => {
      const a = analyzeStatement("ALTER TABLE users DROP COLUMN email");
      expect(a.kind).toBe("ddl-alter-drop");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["ALTER TABLE DROP COLUMN"]);
    });

    it("[AC-391-X06] ALTER TABLE users DROP CONSTRAINT pk CASCADE → ddl-alter-drop / danger via AST", () => {
      const a = analyzeStatement(
        "ALTER TABLE users DROP CONSTRAINT pk CASCADE",
      );
      expect(a.kind).toBe("ddl-alter-drop");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["ALTER TABLE DROP CONSTRAINT"]);
    });

    it("[AC-391-X06b] ALTER TABLE users DROP INDEX idx → ddl-alter-drop / danger via AST (MySQL-style)", () => {
      // Pre-sprint-391 regex matched COLUMN/CONSTRAINT only — `DROP INDEX`
      // on ALTER TABLE fell through to `ddl-other` / WARN. AST correctly
      // classifies it as `ddl-alter-drop` / DANGER. Existing sqlSafety
      // tests do not cover this so no regression.
      const a = analyzeStatement("ALTER TABLE users DROP INDEX idx");
      expect(a.kind).toBe("ddl-alter-drop");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["ALTER TABLE DROP INDEX"]);
    });

    it("[AC-391-X07] SELECT regression — AST path returns null, regex path handles SELECT", () => {
      // With WASM preloaded the AST returns kind:'select'; sqlSafety's
      // `ddlDestructiveAnalysisFromAst` returns null for `select`, so
      // the regex matcher classifies it as INFO. Same result either way.
      const a = analyzeStatement("SELECT * FROM users");
      expect(a.kind).toBe("select");
      expect(a.severity).toBe("info");
    });

    it("[AC-391-X07b] DELETE regression — DML still routes through regex (AST scope is DDL only)", () => {
      // Sprint-391 AST does NOT cover DML. The DELETE branch fires
      // before the DDL preload-AST branch, so this case is unaffected.
      const a = analyzeStatement("DELETE FROM users");
      expect(a.kind).toBe("delete");
      expect(a.severity).toBe("danger");
    });

    it("[AC-391-X08] AST callsite preserves the `StatementAnalysis` shape contract (kind / severity / reasons keys)", () => {
      const a = analyzeStatement("DROP TABLE users CASCADE");
      // Shape is exactly the same as the regex-era output — caller
      // narrowing (`a.kind === "ddl-drop"`) continues to work.
      expect(Object.keys(a).sort()).toEqual(["kind", "reasons", "severity"]);
      expect(typeof a.kind).toBe("string");
      expect(typeof a.severity).toBe("string");
      expect(Array.isArray(a.reasons)).toBe(true);
      expect(isDangerous(a)).toBe(true);
      expect(isInfoStatement(a)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Sprint 392 (2026-05-18) — AST-based DML write triad classifier callsite.
  // Mirrors the sprint-391 block: preload the WASM module so
  // `parseSqlPreloaded` resolves to a real AST shape (the mock above
  // implements an inline mini-parser), then assert every DML case routes
  // through the AST without changing the return shape contract.
  // -------------------------------------------------------------------------
  describe("Sprint 392 — AST-based DML write triad classifier (AC-392-X)", () => {
    beforeAll(async () => {
      __resetSqlWasmModuleForTests();
      await preloadSqlWasm();
    });

    afterAll(() => {
      __resetSqlWasmModuleForTests();
    });

    it("[AC-392-X01] INSERT INTO users VALUES (1) → insert / warn via AST", () => {
      const a = analyzeStatement("INSERT INTO users VALUES (1)");
      expect(a.kind).toBe("insert");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-392-X02] UPDATE WHERE → update / warn via AST", () => {
      const a = analyzeStatement("UPDATE users SET name = 'a' WHERE id = 1");
      expect(a.kind).toBe("update");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-392-X03] UPDATE without WHERE → update / danger + reason via AST", () => {
      const a = analyzeStatement("UPDATE users SET name = 'a'");
      expect(a.kind).toBe("update");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["UPDATE without WHERE clause"]);
    });

    it("[AC-392-X04] DELETE WHERE → delete / warn via AST", () => {
      const a = analyzeStatement("DELETE FROM users WHERE id = 1");
      expect(a.kind).toBe("delete");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual([]);
    });

    it("[AC-392-X05] DELETE without WHERE → delete / danger + reason via AST", () => {
      const a = analyzeStatement("DELETE FROM users");
      expect(a.kind).toBe("delete");
      expect(a.severity).toBe("danger");
      expect(a.reasons).toEqual(["DELETE without WHERE clause"]);
    });

    it("[AC-392-X06] INSERT … ON CONFLICT DO UPDATE → insert / warn via AST (UPSERT)", () => {
      // ON CONFLICT DO UPDATE classifies under `insert` / warn — caller
      // does not have a separate "upsert" path; the destructive surface
      // (UPDATE SET) is bounded by the conflict key.
      const a = analyzeStatement(
        "INSERT INTO users (id) VALUES (1) ON CONFLICT DO UPDATE SET name = 'a'",
      );
      expect(a.kind).toBe("insert");
      expect(a.severity).toBe("warn");
    });

    it("[AC-392-X07] existing sqlSafety test suite — INSERT/UPDATE/DELETE return shapes unchanged", () => {
      // Spot-check identical to AC-185-01h/01a/01b/01c/01d but executed
      // with the WASM module preloaded so the AST path is the one that
      // produces the result. If the AST path diverges from the regex
      // output, this case fails before the larger regression suite does.
      const insert = analyzeStatement(
        "INSERT INTO users (id, name) VALUES (1, 'a')",
      );
      expect(insert.kind).toBe("insert");
      expect(insert.severity).toBe("warn");

      const updateWhere = analyzeStatement(
        "UPDATE users SET active = false WHERE id = 1",
      );
      expect(updateWhere.kind).toBe("update");
      expect(updateWhere.severity).toBe("warn");

      const deleteNoWhere = analyzeStatement("DELETE FROM users");
      expect(deleteNoWhere.kind).toBe("delete");
      expect(deleteNoWhere.severity).toBe("danger");
    });

    it("[AC-392-X08] AST callsite preserves the `StatementAnalysis` shape contract for DML", () => {
      const a = analyzeStatement("UPDATE users SET name = 'a' WHERE id = 1");
      expect(Object.keys(a).sort()).toEqual(["kind", "reasons", "severity"]);
      expect(typeof a.kind).toBe("string");
      expect(typeof a.severity).toBe("string");
      expect(Array.isArray(a.reasons)).toBe(true);
      // `warn` severity → not dangerous, not info.
      expect(isDangerous(a)).toBe(false);
      expect(isInfoStatement(a)).toBe(false);
    });
  });
});
