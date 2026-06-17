import { describe, expect, it } from "vitest";
import { __testing as oracleTesting, oracleEnvConn } from "./oracle.js";

describe("oracle fixture connection boundary", () => {
  it("uses the local XE service-name path by default", () => {
    const conn = oracleEnvConn({});

    expect(conn).toEqual({
      host: "localhost",
      port: 1521,
      user: "testuser",
      password: "testpass",
      serviceName: oracleTesting.DEFAULT_ORACLE_SERVICE_NAME,
    });
    expect(oracleTesting.connectString(conn)).toBe("localhost:1521/XEPDB1");
  });

  it("accepts a simple ORACLE_SERVICE token", () => {
    const conn = oracleEnvConn({
      ORACLE_HOST: "127.0.0.1",
      ORACLE_PORT: "1522",
      ORACLE_USER: "fixture_user",
      ORACLE_PASSWORD: "fixture_pass",
      ORACLE_SERVICE: "FREEPDB1.example",
    });

    expect(oracleTesting.connectString(conn)).toBe(
      "127.0.0.1:1522/FREEPDB1.example",
    );
  });

  it("rejects SID, TNS, wallet, and advanced-auth fixture env", () => {
    expect(() =>
      oracleEnvConn({
        ORACLE_SID: "XE",
        TNS_ADMIN: "/tmp/tns",
        ORACLE_WALLET_LOCATION: "/tmp/wallet",
        ORACLE_AUTH_MODE: "external",
      }),
    ).toThrow(/service-name connections only/);
  });

  it("rejects TNS descriptors or connect strings in ORACLE_SERVICE", () => {
    for (const serviceName of [
      "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)))",
      "localhost:1521/XEPDB1",
      "XE/APP",
    ]) {
      expect(() => oracleEnvConn({ ORACLE_SERVICE: serviceName })).toThrow(
        /service name must be a simple service-name token/,
      );
    }
  });
});

describe("oracle fixture DDL", () => {
  it("uses CLOB for text columns above Oracle's default VARCHAR2 limit", () => {
    const ddl = oracleTesting.buildCreateTable("support_tickets", "tickets", {
      id: { type: "uuid", primary: true },
      body: { type: "text", max_length: 5000, nullable: true },
    });

    expect(ddl).toContain("body CLOB");
    expect(ddl).not.toContain("VARCHAR2(5000)");
  });

  it("renders timestamp values with an explicit Oracle timestamp parser", () => {
    const value = oracleTesting.literalForColumn(
      { type: "timestamp" },
      "2026-06-17T06:15:30.123Z",
    );

    expect(value).toBe(
      `TO_TIMESTAMP_TZ('2026-06-17T06:15:30.123+00:00', 'YYYY-MM-DD"T"HH24:MI:SS.FFTZH:TZM')`,
    );
  });

  it("does not render non-nullable empty strings as Oracle NULL", () => {
    expect(oracleTesting.literalForColumn({ type: "text" }, "")).toBe("' '");
    expect(
      oracleTesting.literalForColumn({ type: "text", nullable: true }, ""),
    ).toBe("''");
  });
});
