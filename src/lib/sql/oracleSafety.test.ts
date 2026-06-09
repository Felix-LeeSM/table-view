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

    expect(analyzeOracleStatement("GRANT DBA TO app")).toMatchObject({
      support: "unsupported",
      slice: "admin",
      kind: "permission-change",
      severity: "danger",
    });
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
