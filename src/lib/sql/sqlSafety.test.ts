// AC-185-01 — sqlSafety analyzer baseline and fallback-severity contract.
// Split from the former giant sqlSafety scenario suite for issue #752.
import { describe, it, expect } from "vitest";
import { analyzeStatement, isDangerous, isInfoStatement } from "./sqlSafety";

describe("sqlSafety.analyzeStatement — fallback and severity contracts", () => {
  it("[AC-185-01a] DELETE without WHERE → danger", () => {
    const a = analyzeStatement("DELETE FROM users");
    expect(a.kind).toBe("dml-delete");
    expect(a.severity).toBe("danger");
    expect(a.reasons).toEqual(["DELETE without WHERE clause"]);
    expect(isDangerous(a)).toBe(true);
  });

  it("[AC-185-01b] DELETE with WHERE → warn (Sprint 254: bounded write)", () => {
    const a = analyzeStatement("DELETE FROM users WHERE id = 1");
    expect(a.kind).toBe("dml-delete");
    expect(a.severity).toBe("warn");
    expect(a.reasons).toEqual([]);
    expect(isDangerous(a)).toBe(false);
  });

  it("[AC-185-01c] UPDATE without WHERE → danger", () => {
    const a = analyzeStatement("UPDATE users SET active = false");
    expect(a.kind).toBe("dml-update");
    expect(a.severity).toBe("danger");
    expect(a.reasons).toEqual(["UPDATE without WHERE clause"]);
  });

  it("[AC-185-01d] UPDATE with WHERE → warn (Sprint 254: bounded write)", () => {
    const a = analyzeStatement("UPDATE users SET active = false WHERE id = 1");
    expect(a.kind).toBe("dml-update");
    expect(a.severity).toBe("warn");
  });

  it("[#1455 P3-4] Oracle q'…' hiding a fake WHERE → danger", () => {
    // The `WHERE` lives inside an Oracle alternate-quote literal (raw `'`
    // allowed), so the UPDATE/DELETE is actually unbounded.
    for (const sql of [
      "UPDATE accounts SET note = q'{don't WHERE it}'",
      "UPDATE accounts SET note = q'[a'b WHERE c]'",
      "DELETE FROM accounts WHERE_x = q'<a'b WHERE c>'",
    ]) {
      expect(analyzeStatement(sql, { dialect: "oracle" }).severity).toBe(
        "danger",
      );
    }
    // A real trailing WHERE outside the q-quote still bounds the write.
    expect(
      analyzeStatement("UPDATE accounts SET note = q'{don't}' WHERE id = 1", {
        dialect: "oracle",
      }).severity,
    ).toBe("warn");
    // Gating: non-Oracle dialects must NOT treat `q'…'` as an alternate quote.
    expect(
      analyzeStatement("UPDATE accounts SET note = q'{don't WHERE it}'")
        .severity,
    ).not.toBe("danger");
  });

  it("[#1455 P3-4] ANSI U&'…' hiding a fake WHERE → danger", () => {
    expect(
      analyzeStatement("UPDATE accounts SET note = U&'stop WHERE it'").severity,
    ).toBe("danger");
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

  it("[AC-185-01h] INSERT INTO → dml-insert / info (Sprint 403)", () => {
    const a = analyzeStatement("INSERT INTO users (id, name) VALUES (1, 'a')");
    expect(a.kind).toBe("dml-insert");
    expect(a.severity).toBe("info");
  });

  it("[AC-439-X01] CALL fallback → routine-call / warn", () => {
    const a = analyzeStatement("CALL refresh_user_stats()");
    expect(a.kind).toBe("routine-call");
    expect(a.severity).toBe("warn");
    expect(a.reasons).toEqual(["CALL — stored routine execution"]);
    expect(isDangerous(a)).toBe(false);
  });

  it("[AC-448-X01] CALL user-variable fallback stays routine-call / warn", () => {
    const a = analyzeStatement("CALL refresh_user_stats(@user_id)");
    expect(a.kind).toBe("routine-call");
    expect(a.severity).toBe("warn");
    expect(a.reasons).toEqual(["CALL — stored routine execution"]);
    expect(isDangerous(a)).toBe(false);
  });

  it("[AC-185-01i] SELECT → info (Sprint 254: read tier)", () => {
    const a = analyzeStatement("SELECT * FROM users");
    expect(a.kind).toBe("select");
    expect(a.severity).toBe("info");
  });

  it("[AC-185-01j] case-insensitive (delete from t) → danger", () => {
    const a = analyzeStatement("delete from users");
    expect(a.kind).toBe("dml-delete");
    expect(a.severity).toBe("danger");
  });

  it("[AC-185-01k] strips line comments before analysis", () => {
    const a = analyzeStatement(
      "-- this comment hides nothing\nDELETE FROM users -- inline\n",
    );
    expect(a.kind).toBe("dml-delete");
    expect(a.severity).toBe("danger");

    const b = analyzeStatement(
      "/* block comment */ DELETE FROM users WHERE id = 1",
    );
    expect(b.kind).toBe("dml-delete");
    // Sprint 254 — bounded DELETE WHERE is now WARN (was safe).
    expect(b.severity).toBe("warn");
  });

  it("[AC-185-01l] subquery WHERE counted as outer WHERE present (warn)", () => {
    const a = analyzeStatement(
      "DELETE FROM t WHERE id IN (SELECT id FROM u WHERE flag = 1)",
    );
    expect(a.kind).toBe("dml-delete");
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

  it("ALTER additive / CREATE → sprint-394 classifications (was ddl-other / warn before sprint-394)", () => {
    // Sprint-394 — ALTER ADD COLUMN is now `ddl-alter-add` / warn with
    // a pinned reason (D2). CREATE INDEX is `ddl-create` / info / no
    // reasons. The pre-sprint-394 baseline classified both as
    // `ddl-other` / warn / no reasons.
    const a = analyzeStatement("ALTER TABLE users ADD COLUMN x int");
    expect(a.kind).toBe("ddl-alter-add");
    expect(a.severity).toBe("warn");
    expect(a.reasons).toEqual(["ALTER TABLE — ADD COLUMN (schema 변경)"]);
    const b = analyzeStatement("CREATE INDEX idx_x ON users (x)");
    expect(b.kind).toBe("ddl-create");
    expect(b.severity).toBe("info");
    expect(b.reasons).toEqual([]);
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

  it("[AC-187-01e] ALTER TABLE … ADD COLUMN is ddl-alter-add / warn / pinned reason (Sprint 394)", () => {
    // Sprint 187: classified as `ddl-other` / warn / [].
    // Sprint 394 (D2): kind moves to `ddl-alter-add`, severity stays
    // `warn`, and the reasons list now carries the pinned D2 string.
    const a = analyzeStatement("ALTER TABLE users ADD COLUMN nickname text");
    expect(a.kind).toBe("ddl-alter-add");
    expect(a.severity).toBe("warn");
    expect(a.reasons).toEqual(["ALTER TABLE — ADD COLUMN (schema 변경)"]);
    expect(isDangerous(a)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Sprint 254 (2026-05-09) — 3-tier classifier corpus. ADR 0023 grill Q2-(a)
  // "3-tier severity 채택" 의 정식 분류:
  //   - INFO: SELECT / WITH …SELECT (no DML CTE) / EXPLAIN / SHOW / DESCRIBE / DESC.
  //   - WARN: UPDATE WHERE / DELETE WHERE / ALTER additive.
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

    it("[AC-254-01d] SHOW TABLES → config-read / info (sprint-395 update)", () => {
      // Pre-sprint-395: kind="info" (legacy regex bucket).
      // Sprint-395 (X06 / D4): SHOW classifies as `config-read` with
      // severity:"info" — separate metadata-read kind from EXPLAIN/DESC.
      // `isInfoStatement` continues to return true (severity-based).
      const a = analyzeStatement("SHOW TABLES");
      expect(a.kind).toBe("config-read");
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
    it("[AC-403-01] INSERT INTO → dml-insert / info", () => {
      const a = analyzeStatement("INSERT INTO users (id) VALUES (1)");
      expect(a.kind).toBe("dml-insert");
      expect(a.severity).toBe("info");
    });

    it("[AC-254-02b] UPDATE … WHERE → warn (bounded)", () => {
      const a = analyzeStatement("UPDATE users SET name = 'a' WHERE id = 1");
      expect(a.kind).toBe("dml-update");
      expect(a.severity).toBe("warn");
    });

    it("[AC-254-02c] DELETE … WHERE → warn (bounded)", () => {
      const a = analyzeStatement("DELETE FROM users WHERE id = 1");
      expect(a.kind).toBe("dml-delete");
      expect(a.severity).toBe("warn");
    });

    it("[AC-254-02d] CREATE TABLE → ddl-create / info (sprint-394 update)", () => {
      // Pre-sprint-394: classified as `ddl-other` / warn. Sprint-394
      // moves CREATE TABLE / INDEX / VIEW to `ddl-create` / info per
      // the contract — these are non-destructive constructions and do
      // not require a warn dialog.
      const a = analyzeStatement("CREATE TABLE foo (id int)");
      expect(a.kind).toBe("ddl-create");
      expect(a.severity).toBe("info");
    });

    it("[AC-254-02e] ALTER TABLE … ADD COLUMN (additive) → ddl-alter-add / warn (sprint-394 update)", () => {
      // Sprint-394 kind change — kept under the same `warn` tier (the
      // schema-changing nature of ADD COLUMN warrants the warn dialog).
      const a = analyzeStatement("ALTER TABLE users ADD COLUMN nickname text");
      expect(a.kind).toBe("ddl-alter-add");
      expect(a.severity).toBe("warn");
    });

    it("[AC-254-02f] CREATE INDEX → ddl-create / info (sprint-394 update)", () => {
      const a = analyzeStatement("CREATE INDEX idx_x ON users (x)");
      expect(a.kind).toBe("ddl-create");
      expect(a.severity).toBe("info");
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

    it("[AC-254-03f] GRANT → permission-change / warn (sprint-395 update)", () => {
      // Pre-sprint-395: ddl-other / danger.
      // Sprint-395 (X01 / D5): permission-change / warn / pinned reason.
      const a = analyzeStatement("GRANT SELECT ON users TO bob");
      expect(a.kind).toBe("permission-change");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual(["GRANT — 권한 변경"]);
    });

    it("[AC-254-03g] REVOKE → permission-change / warn (sprint-395 update)", () => {
      // Pre-sprint-395: ddl-other / danger.
      // Sprint-395 (X02 / D5): permission-change / warn / pinned reason.
      const a = analyzeStatement("REVOKE SELECT ON users FROM bob");
      expect(a.kind).toBe("permission-change");
      expect(a.severity).toBe("warn");
      expect(a.reasons).toEqual(["REVOKE — 권한 변경"]);
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

    it("[AC-403-01b] WITH x AS (INSERT …) SELECT * → info (DML CTE wrapped)", () => {
      const a = analyzeStatement(
        "WITH x AS (INSERT INTO users (id) VALUES (1) RETURNING id) SELECT * FROM x",
      );
      expect(a.severity).toBe("info");
    });

    it("[AC-254-04e] WITH x AS (SELECT 1) SELECT * — pure read CTE → info (regression)", () => {
      const a = analyzeStatement("WITH x AS (SELECT 1 AS n) SELECT n FROM x");
      expect(a.severity).toBe("info");
    });
  });

  // -------------------------------------------------------------------------
  // Issue #1350 (2026-07-05) — multi-CTE classifier gap. `analyzeDmlCte` used
  // to inspect ONLY the first CTE body, so a destructive body in the 2nd+ CTE
  // (`WITH a AS (SELECT 1), b AS (DELETE FROM t) SELECT …`) was classified as a
  // benign read and ran without a confirm dialog in strict+production. The fix
  // scans EVERY `AS ( … )` body and merges the worst severity. Must stay in
  // parity with the backend `classify_dml_cte` (safety.rs `multi_cte_parity`).
  // -------------------------------------------------------------------------
  describe("Issue #1350 — multi-CTE destructive body detection", () => {
    it("[AC-1350-01] 2nd CTE DELETE without WHERE → danger", () => {
      expect(
        analyzeStatement(
          "WITH a AS (SELECT 1), b AS (DELETE FROM users) SELECT * FROM b",
        ).severity,
      ).toBe("danger");
    });

    it("[AC-1350-02] 2nd CTE UPDATE without WHERE → danger", () => {
      expect(
        analyzeStatement(
          "WITH a AS (SELECT 1), b AS (UPDATE users SET active = false) SELECT * FROM b",
        ).severity,
      ).toBe("danger");
    });

    it("[AC-1350-03] middle CTE (of 3) destructive → danger", () => {
      expect(
        analyzeStatement(
          "WITH a AS (SELECT 1), b AS (DELETE FROM users), c AS (SELECT 2) SELECT * FROM c",
        ).severity,
      ).toBe("danger");
    });

    it("[AC-1350-04] 2nd CTE TRUNCATE → danger", () => {
      expect(
        analyzeStatement(
          "WITH a AS (SELECT 1), b AS (TRUNCATE users) SELECT * FROM a",
        ).severity,
      ).toBe("danger");
    });

    it("[AC-1350-05] nested subquery parens in read CTE, destructive 2nd → danger", () => {
      expect(
        analyzeStatement(
          "WITH a AS (SELECT (SELECT 1)), b AS (DELETE FROM users) SELECT * FROM b",
        ).severity,
      ).toBe("danger");
    });

    it("[AC-1350-06] bounded DELETE WHERE with nested subquery → warn (not over-escalated)", () => {
      expect(
        analyzeStatement(
          "WITH a AS (SELECT 1), b AS (DELETE FROM users WHERE id IN (SELECT id FROM stale)) SELECT * FROM b",
        ).severity,
      ).toBe("warn");
    });

    it("[AC-1350-07] 'DELETE' text inside a string literal → info (no false positive)", () => {
      expect(
        analyzeStatement(
          "WITH a AS (SELECT 'DELETE FROM users' AS note), b AS (SELECT 2) SELECT * FROM a",
        ).severity,
      ).toBe("info");
    });

    it("[AC-1350-08] 2nd CTE INSERT → info (not escalated)", () => {
      expect(
        analyzeStatement(
          "WITH a AS (SELECT 1), b AS (INSERT INTO users (id) VALUES (1) RETURNING id) SELECT * FROM a",
        ).severity,
      ).toBe("info");
    });

    // Review #1374 — literal-blind paren scan bypass. A `(` / `)` inside a
    // string literal, quoted identifier, or dollar-quote skewed the balanced-
    // paren depth, so the destructive CTE was swallowed / early-closed and read
    // as info. The scan must skip literal bodies.
    it("[AC-1350-09] read CTE with '(' in string literal, destructive 2nd → danger", () => {
      expect(
        analyzeStatement(
          "WITH a AS (SELECT '(' ), b AS (DELETE FROM users) SELECT * FROM b",
        ).severity,
      ).toBe("danger");
    });

    it("[AC-1350-10] read CTE with '(' in dollar-quote, destructive 2nd → danger", () => {
      expect(
        analyzeStatement(
          "WITH a AS (SELECT $$($$), b AS (DELETE FROM users) SELECT * FROM b",
        ).severity,
      ).toBe("danger");
    });

    it("[AC-1350-11] read CTE with '(' in quoted identifier, destructive 2nd → danger", () => {
      expect(
        analyzeStatement(
          'WITH a AS (SELECT 1 AS "x("), b AS (DELETE FROM users) SELECT * FROM b',
        ).severity,
      ).toBe("danger");
    });

    it("[AC-1350-12] destructive body with '(' in string, UPDATE no WHERE → danger", () => {
      expect(
        analyzeStatement(
          "WITH a AS (SELECT 1), b AS (UPDATE users SET note = '(') SELECT * FROM b",
        ).severity,
      ).toBe("danger");
    });

    it("[AC-1350-13] read CTE with ')' in string literal, destructive 2nd → danger", () => {
      expect(
        analyzeStatement(
          "WITH a AS (SELECT ')' ), b AS (DELETE FROM users) SELECT * FROM b",
        ).severity,
      ).toBe("danger");
    });

    it("[AC-1350-14] read CTE with ')' in dollar-quote, destructive 2nd → danger", () => {
      expect(
        analyzeStatement(
          "WITH a AS (SELECT $$)$$), b AS (DELETE FROM users) SELECT * FROM b",
        ).severity,
      ).toBe("danger");
    });
  });

  // -------------------------------------------------------------------------
  // Issue #1115 (2026-07-03) — MySQL/MariaDB `REPLACE INTO` is a destructive
  // upsert (DELETE conflicting row, then INSERT). It was absent from both the
  // gate regex alternation and the per-keyword branches, so it fell through
  // to the `{ kind: "other", severity: "info" }` fail-open default and ran
  // with no dialog in any mode. Per the 2026-07-02 user decision ("구문 that
  // can silently lose existing data is always confirm"), REPLACE classifies
  // as `danger`. The Rust `sql-parser-core` returns `unsupported-statement`
  // for REPLACE (sql-parser-core/src/lib.rs:158), so the AST path cannot
  // classify it — the regex branch is the source of truth here.
  // -------------------------------------------------------------------------
  describe("Issue #1115 — REPLACE INTO destructive upsert → danger", () => {
    it("[AC-1115-01] REPLACE INTO … VALUES → danger", () => {
      const a = analyzeStatement(
        "REPLACE INTO users (id, name) VALUES (1, 'a')",
      );
      expect(a.kind).toBe("dml-replace");
      expect(a.severity).toBe("danger");
      expect(isDangerous(a)).toBe(true);
    });

    it("[AC-1115-02] REPLACE INTO … SET (MySQL dialect) → danger", () => {
      const a = analyzeStatement("REPLACE INTO users SET id = 1, name = 'a'");
      expect(a.severity).toBe("danger");
    });

    it("[AC-1115-03] REPLACE INTO … SELECT → danger", () => {
      const a = analyzeStatement("REPLACE INTO archive SELECT * FROM users");
      expect(a.severity).toBe("danger");
    });

    it("[AC-1115-04] REPLACE … SET without INTO (INTO is optional in MySQL) → danger", () => {
      const a = analyzeStatement("REPLACE users SET id = 1");
      expect(a.severity).toBe("danger");
    });

    // ── false-positive guards ────────────────────────────────────────────
    it("[AC-1115-05] CREATE OR REPLACE VIEW → still ddl-create / info (REPLACE not first keyword)", () => {
      const a = analyzeStatement("CREATE OR REPLACE VIEW v AS SELECT a FROM t");
      expect(a.kind).toBe("ddl-create");
      expect(a.severity).toBe("info");
    });

    it("[AC-1115-06] SELECT REPLACE(col,…) function call → still select / info", () => {
      const a = analyzeStatement("SELECT REPLACE(name, 'a', 'b') FROM users");
      expect(a.kind).toBe("select");
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

    it("[AC-403-06] INSERT → INFO (no WARN dialog candidate)", () => {
      expect(
        isInfoStatement(analyzeStatement("INSERT INTO users (id) VALUES (1)")),
      ).toBe(true);
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

    it("[AC-255-01l] CREATE TABLE → INFO (sprint-394 — ddl-create / info)", () => {
      // Pre-sprint-394: NOT INFO (WARN candidate via `ddl-other`).
      // Sprint-394 (per contract): CREATE TABLE is non-destructive
      // construction → `ddl-create` / info. The safe-mode UI may now
      // skip its warn dialog for plain CREATE TABLE.
      expect(
        isInfoStatement(analyzeStatement("CREATE TABLE foo (id int)")),
      ).toBe(true);
    });

    it("[AC-255-01m] ALTER TABLE … ADD COLUMN (additive) → NOT INFO (ddl-alter-add / warn)", () => {
      // Sprint-394 keeps ALTER ADD as warn (the schema-modifying nature
      // warrants the warn dialog). The `kind` is `ddl-alter-add`; the
      // severity tier is unchanged.
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
