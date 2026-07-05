import { describe, expect, it } from "vitest";
import {
  ORACLE_SQL_SAFETY_BOUNDARY,
  analyzeOracleStatement,
  decideOracleSafeModeAction,
} from "./oracleSafety";

describe("oracleSafety", () => {
  it("documents a static parser/Safe Mode boundary without runtime promotion", () => {
    expect(ORACLE_SQL_SAFETY_BOUNDARY.runtime).toBe(
      "static-parser-safe-mode-only",
    );
    expect(ORACLE_SQL_SAFETY_BOUNDARY.supported.select).toContain(
      "SELECT, including SELECT ... FROM DUAL and no-FROM projections",
    );
    expect(ORACLE_SQL_SAFETY_BOUNDARY.supported.ddl).toContain(
      "Oracle CREATE TABLE scalar types NUMBER, VARCHAR2, CLOB, and BLOB",
    );
    expect(ORACLE_SQL_SAFETY_BOUNDARY.unsupported.plsql).toContain(
      "CREATE PACKAGE/PACKAGE BODY/PROCEDURE/FUNCTION/TRIGGER/TYPE BODY",
    );
  });

  it("classifies supported Oracle SELECT slices as info", () => {
    const analysis = analyzeOracleStatement("SELECT * FROM dual");

    expect(analysis).toMatchObject({
      dialect: "oracle",
      support: "supported",
      slice: "select",
      kind: "select",
      severity: "info",
      boundaryReason: null,
    });
  });

  it("classifies supported Oracle DML slices", () => {
    expect(
      analyzeOracleStatement(
        "INSERT INTO audit_log (id, message) VALUES (1, 'created')",
      ),
    ).toMatchObject({
      support: "supported",
      slice: "dml",
      kind: "dml-insert",
      severity: "info",
    });

    expect(
      analyzeOracleStatement(
        "UPDATE accounts SET status = 'closed' WHERE id = 1",
      ),
    ).toMatchObject({
      support: "supported",
      slice: "dml",
      kind: "dml-update",
      severity: "warn",
    });

    expect(analyzeOracleStatement("DELETE FROM accounts")).toMatchObject({
      support: "supported",
      slice: "dml",
      kind: "dml-delete",
      severity: "danger",
      reasons: ["DELETE without WHERE clause"],
    });
  });

  it("classifies supported Oracle DDL slices", () => {
    expect(
      analyzeOracleStatement(
        "CREATE TABLE accounts (id NUMBER(10), name VARCHAR2(80), notes CLOB)",
      ),
    ).toMatchObject({
      support: "supported",
      slice: "ddl",
      kind: "ddl-create",
      severity: "info",
    });

    expect(
      analyzeOracleStatement("ALTER TABLE accounts ADD COLUMN archived NUMBER"),
    ).toMatchObject({
      support: "supported",
      slice: "ddl",
      kind: "ddl-alter-add",
      severity: "warn",
    });

    expect(
      analyzeOracleStatement("ALTER TABLE accounts DROP COLUMN legacy_code"),
    ).toMatchObject({
      support: "supported",
      slice: "ddl",
      kind: "ddl-alter-drop",
      severity: "danger",
      reasons: ["ALTER TABLE DROP COLUMN"],
    });
  });

  it("blocks Oracle CREATE variants outside the bounded DDL slice", () => {
    for (const sql of [
      "CREATE SEQUENCE account_seq START WITH 1",
      "CREATE SYNONYM account_alias FOR accounts",
      "CREATE MATERIALIZED VIEW account_mv AS SELECT * FROM accounts",
    ]) {
      const analysis = analyzeOracleStatement(sql);

      expect(analysis).toMatchObject({
        support: "unsupported",
        slice: "ddl",
        kind: "ddl-create",
        severity: "danger",
        boundaryReason:
          "Oracle CREATE statement is outside the bounded DDL slice",
      });
      expect(
        decideOracleSafeModeAction("off", "development", analysis),
      ).toEqual({
        action: "block",
        reason: "Oracle CREATE statement is outside the bounded DDL slice",
      });
    }
  });

  it("marks PL/SQL package and block paths unsupported", () => {
    const packageAnalysis = analyzeOracleStatement(
      "CREATE OR REPLACE PACKAGE app_pkg AS END app_pkg;",
    );

    expect(packageAnalysis).toMatchObject({
      support: "unsupported",
      slice: "plsql",
      kind: "routine-call",
      severity: "danger",
    });
    expect(
      decideOracleSafeModeAction("off", "development", packageAnalysis),
    ).toMatchObject({
      action: "block",
      reason:
        "Oracle PL/SQL package/routine DDL is outside the static safety boundary",
    });

    expect(analyzeOracleStatement("DECLARE BEGIN NULL; END;")).toMatchObject({
      support: "unsupported",
      slice: "plsql",
      kind: "routine-call",
      severity: "danger",
    });
  });

  it("marks Oracle admin paths unsupported", () => {
    const adminAnalysis = analyzeOracleStatement(
      "ALTER SYSTEM SET processes = 300",
    );

    expect(adminAnalysis).toMatchObject({
      support: "unsupported",
      slice: "admin",
      kind: "ddl-other",
      severity: "danger",
    });
    expect(
      decideOracleSafeModeAction("warn", "production", adminAnalysis),
    ).toMatchObject({
      action: "block",
      reason:
        "Oracle ALTER admin statement is outside the static safety boundary",
    });

    expect(
      analyzeOracleStatement("CREATE USER app IDENTIFIED BY secret"),
    ).toMatchObject({
      support: "unsupported",
      slice: "admin",
      kind: "ddl-other",
      severity: "danger",
    });

    for (const sql of [
      "ALTER SESSION SET CURRENT_SCHEMA = HR",
      "ALTER USER app ACCOUNT LOCK",
      "CREATE TABLESPACE app_data DATAFILE 'app.dbf' SIZE 10M",
      "PURGE DBA_RECYCLEBIN",
    ]) {
      expect(analyzeOracleStatement(sql)).toMatchObject({
        support: "unsupported",
        slice: "admin",
        severity: "danger",
      });
    }

    // AUDIT / NOAUDIT stay admin/danger — only GRANT/REVOKE move to warn.
    expect(analyzeOracleStatement("AUDIT SELECT ON app.orders")).toMatchObject({
      support: "unsupported",
      slice: "admin",
      severity: "danger",
    });
  });

  // Issue #1120 (2026-07-02) — GRANT/REVOKE parity: danger/block →
  // warn/supported across all dialects. `danger` stays reserved for
  // irreversible data destruction; a privilege change is warn-tier.
  it("[AC-1120-oracle] GRANT/REVOKE are warn-tier permission changes (parity with generic SQL)", () => {
    for (const sql of ["GRANT DBA TO app", "REVOKE SELECT ON t FROM app"]) {
      expect(analyzeOracleStatement(sql)).toMatchObject({
        support: "supported",
        kind: "permission-change",
        severity: "warn",
      });
    }
    // Parity: warn-tier permission change never gates in production warn mode.
    const grant = analyzeOracleStatement("GRANT DBA TO app");
    expect(decideOracleSafeModeAction("warn", "production", grant)).toEqual({
      action: "allow",
    });
  });

  // Issue #1351 — parity lock with the backend Safe Mode gate. Before the
  // fix, the Tauri backend classified all of these as `Info` (the shared
  // dialect-agnostic `sql_parser_core::safety`), so a direct IPC `invoke` on
  // an Oracle connection ran them unconfirmed even in strict + production —
  // the frontend was the only defense despite `sqlSafety.ts` declaring the
  // backend gate the final one. The backend now mirrors this exact danger set
  // in `src-tauri/sql-parser-core/src/oracle.rs::is_oracle_danger`. This test
  // is the frontend side of that mirror: a change to the Oracle danger set
  // here must be reflected in the Rust classifier (and its unit tests), or the
  // two drift and the fail-open hole reopens.
  it("[#1351] pins the Oracle PL/SQL & admin danger set the backend gate mirrors", () => {
    const dangerSet = [
      // PL/SQL blocks & routine execution.
      "BEGIN EXECUTE IMMEDIATE 'DROP TABLE payroll'; END;",
      "DECLARE v NUMBER; BEGIN NULL; END;",
      "EXEC payroll_pkg.wipe()",
      "EXECUTE my_proc",
      "CALL my_proc()",
      "CREATE OR REPLACE PACKAGE app_pkg AS END app_pkg;",
      "CREATE OR REPLACE PROCEDURE p AS BEGIN NULL; END;",
      "CREATE FUNCTION f RETURN NUMBER AS BEGIN RETURN 1; END;",
      "CREATE OR REPLACE TRIGGER trg BEFORE INSERT ON t BEGIN NULL; END;",
      // Admin DDL.
      "ALTER SYSTEM SET processes = 300",
      "ALTER SESSION SET CURRENT_SCHEMA = HR",
      "ALTER USER app ACCOUNT LOCK",
      "CREATE USER app IDENTIFIED BY secret",
      "DROP USER hr CASCADE",
      "CREATE TABLESPACE app_data DATAFILE 'app.dbf' SIZE 10M",
      "AUDIT SELECT ON app.orders",
      "PURGE DBA_RECYCLEBIN",
      // Bounded-CREATE slice (non table/index/view).
      "CREATE SEQUENCE account_seq START WITH 1",
      "CREATE MATERIALIZED VIEW account_mv AS SELECT * FROM accounts",
    ];
    for (const sql of dangerSet) {
      expect(analyzeOracleStatement(sql).severity, sql).toBe("danger");
    }

    // False-positive guards — supported Oracle SQL must NOT be danger, so the
    // backend mirror does not over-gate legitimate reads / DML / DDL.
    const notDanger = [
      "SELECT * FROM dual",
      "SELECT 'BEGIN' AS note FROM dual",
      "UPDATE accounts SET status = 'closed' WHERE id = 1",
      "INSERT INTO audit_log (id) VALUES (1)",
      "CREATE TABLE accounts (id NUMBER(10))",
      "CREATE OR REPLACE VIEW v AS SELECT * FROM accounts",
      "GRANT DBA TO app",
      "REVOKE SELECT ON t FROM app",
    ];
    for (const sql of notDanger) {
      expect(analyzeOracleStatement(sql).severity, sql).not.toBe("danger");
    }
  });

  it("feeds supported destructive Oracle DDL into the current confirmation matrix", () => {
    const analysis = analyzeOracleStatement("DROP TABLE accounts");
    const decision = decideOracleSafeModeAction("warn", "production", analysis);

    expect(analysis.support).toBe("supported");
    expect(decision).toEqual({
      action: "confirm",
      reason: "DROP TABLE",
    });
  });
});
