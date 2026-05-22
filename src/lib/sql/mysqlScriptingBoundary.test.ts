import { describe, expect, it } from "vitest";
import { findMysqlScriptingBoundaryViolation } from "./mysqlScriptingBoundary";

describe("mysql scripting boundary", () => {
  it("rejects DELIMITER for MySQL-family connections", () => {
    const violation = findMysqlScriptingBoundaryViolation(
      ["DELIMITER //\nCREATE PROCEDURE p() BEGIN SELECT 1; END //"],
      "mysql",
    );

    expect(violation).toMatchObject({
      feature: "DELIMITER",
      statementIndex: 0,
      message: expect.stringContaining("DELIMITER"),
    });
  });

  it("rejects LOAD DATA after leading comments for MariaDB", () => {
    const violation = findMysqlScriptingBoundaryViolation(
      [
        "SELECT 1",
        "/* import */\nLOAD /* local */ DATA INFILE '/tmp/users.csv' INTO TABLE users",
      ],
      "mariadb",
    );

    expect(violation).toMatchObject({
      feature: "LOAD DATA",
      statementIndex: 1,
      message: expect.stringContaining("LOAD DATA"),
    });
  });

  it("rejects LOAD DATA in a leading MySQL executable comment", () => {
    const violation = findMysqlScriptingBoundaryViolation(
      ["/*!40101 LOAD DATA INFILE '/tmp/users.csv' INTO TABLE users */"],
      "mysql",
    );

    expect(violation).toMatchObject({
      feature: "LOAD DATA",
      statementIndex: 0,
      message: expect.stringContaining("LOAD DATA"),
    });
  });

  it("rejects LOAD DATA in a leading MariaDB executable comment", () => {
    const violation = findMysqlScriptingBoundaryViolation(
      ["/*M!100100 LOAD DATA INFILE '/tmp/users.csv' INTO TABLE users */"],
      "mariadb",
    );

    expect(violation).toMatchObject({
      feature: "LOAD DATA",
      statementIndex: 0,
      message: expect.stringContaining("LOAD DATA"),
    });
  });

  it("skips leading hash comments before unsupported statements", () => {
    const violation = findMysqlScriptingBoundaryViolation(
      ["# import\nLOAD DATA INFILE '/tmp/users.csv' INTO TABLE users"],
      "mysql",
    );

    expect(violation).toMatchObject({
      feature: "LOAD DATA",
      statementIndex: 0,
      message: expect.stringContaining("LOAD DATA"),
    });
  });

  it("does not treat comments, string literals, or other dialects as MySQL scripting", () => {
    expect(
      findMysqlScriptingBoundaryViolation(
        [
          "-- LOAD DATA INFILE '/tmp/users.csv'",
          "SELECT 'DELIMITER //'",
          "SELECT 1",
        ],
        "mysql",
      ),
    ).toBeNull();

    expect(
      findMysqlScriptingBoundaryViolation(
        ["LOAD DATA INFILE '/tmp/users.csv' INTO TABLE users"],
        "postgresql",
      ),
    ).toBeNull();
  });
});
