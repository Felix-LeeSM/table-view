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
import { describe, it, expect } from "vitest";
import { analyzeStatement, isDangerous, isInfoStatement } from "./sqlSafety";

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
});
