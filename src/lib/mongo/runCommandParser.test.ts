// Sprint 381 (2026-05-17) — naive statement-kind classifier tests.
//
// 작성 이유: db-contract α 의 chip 미선택 Run gating 은 `classifyMongoStatement`
// 정확도에 직접 의존한다. AST 가 아닌 정규식 기반 (sprint-382 가 AST 로
// promote 예정) 이므로 happy/edge/refusal 시나리오 별로 lock 한다.

import { describe, it, expect } from "vitest";
import {
  classifyMongoStatement,
  extractAdminCommandBody,
  statementAllowsMissingDatabase,
} from "./runCommandParser";

describe("classifyMongoStatement (sprint-381, 2026-05-17)", () => {
  it("classifies `db.runCommand({ping: 1})` as admin-command", () => {
    expect(classifyMongoStatement("db.runCommand({ping: 1})")).toBe(
      "admin-command",
    );
  });

  it("classifies `db.adminCommand({serverStatus: 1})` as admin-command", () => {
    expect(classifyMongoStatement("db.adminCommand({serverStatus: 1})")).toBe(
      "admin-command",
    );
  });

  it("tolerates leading whitespace before admin command", () => {
    expect(classifyMongoStatement("   \n  db.runCommand({ping: 1})")).toBe(
      "admin-command",
    );
  });

  it("classifies `db.users.find({})` as collection-command", () => {
    expect(classifyMongoStatement("db.users.find({})")).toBe(
      "collection-command",
    );
  });

  it("classifies an empty input as unknown", () => {
    expect(classifyMongoStatement("")).toBe("unknown");
    expect(classifyMongoStatement("   \n\t")).toBe("unknown");
  });

  it("classifies a non-mongo SQL statement as unknown", () => {
    expect(classifyMongoStatement("SELECT 1")).toBe("unknown");
  });
});

describe("extractAdminCommandBody (sprint-381, 2026-05-17)", () => {
  it("parses `{ping: 1}` from `db.runCommand({ping: 1})`", () => {
    expect(extractAdminCommandBody("db.runCommand({ping: 1})")).toEqual({
      ping: 1,
    });
  });

  it("parses `{serverStatus: 1}` from `db.adminCommand({serverStatus: 1})`", () => {
    expect(
      extractAdminCommandBody("db.adminCommand({serverStatus: 1})"),
    ).toEqual({ serverStatus: 1 });
  });

  it("returns null for invalid JSON body", () => {
    expect(extractAdminCommandBody("db.runCommand(garbage)")).toBeNull();
  });

  it("returns null for non-admin-command input", () => {
    expect(extractAdminCommandBody("db.users.find({})")).toBeNull();
  });
});

describe("statementAllowsMissingDatabase (sprint-381, 2026-05-17)", () => {
  it("returns true for admin-command", () => {
    expect(statementAllowsMissingDatabase("admin-command")).toBe(true);
  });

  it("returns false for collection-command", () => {
    expect(statementAllowsMissingDatabase("collection-command")).toBe(false);
  });

  it("returns false for unknown", () => {
    expect(statementAllowsMissingDatabase("unknown")).toBe(false);
  });
});
