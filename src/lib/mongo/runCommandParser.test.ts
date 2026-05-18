// Sprint 381 (2026-05-17) — statement-kind classifier tests.
// Sprint 382 (2026-05-17) — promoted to AST-backed classifier; all
// sprint-381 cases preserved verbatim + AC-382-R additions for behavior
// that the AST now handles correctly (comments anywhere, nested body,
// multi-statement reject).
//
// 작성 이유: db-contract α 의 chip 미선택 Run gating 은 `classifyMongoStatement`
// 정확도에 직접 의존한다. 본 파일은 sprint-381 baseline 13 case + sprint-382
// 의 AST promotion 이 신규로 lock 하는 시나리오를 함께 검증한다.

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

describe("sprint-382 AST promotion — new behavior locked by the AST", () => {
  it("AC-382-R3 — extractAdminCommandBody handles nested object body", () => {
    expect(
      extractAdminCommandBody(
        "db.runCommand({outer: {inner: 1, also: {deep: true}}})",
      ),
    ).toEqual({ outer: { inner: 1, also: { deep: true } } });
  });

  it("AC-382-R4 — classifyMongoStatement strips a leading line comment", () => {
    expect(
      classifyMongoStatement("// pick recent\ndb.runCommand({ping: 1})"),
    ).toBe("admin-command");
  });

  it("AC-382-R4 — extractAdminCommandBody works after a leading comment", () => {
    expect(
      extractAdminCommandBody("// pick recent\ndb.runCommand({ping: 1})"),
    ).toEqual({ ping: 1 });
  });

  it("AC-382-R5 — classifyMongoStatement rejects multi-statement input as unknown", () => {
    expect(classifyMongoStatement("db.users.find({}); db.users.drop()")).toBe(
      "unknown",
    );
  });

  it("AC-382-R5 — admin command followed by `;` collection command is unknown", () => {
    expect(
      classifyMongoStatement("db.runCommand({ping: 1}); db.users.find({})"),
    ).toBe("unknown");
  });

  it("classifyMongoStatement still treats lone trailing `;` as admin-command", () => {
    expect(classifyMongoStatement("db.runCommand({ping: 1});")).toBe(
      "admin-command",
    );
  });

  it("extractAdminCommandBody returns null when a BSON literal is present", () => {
    expect(
      extractAdminCommandBody(
        'db.runCommand({find: "users", filter: {_id: ObjectId("65abcdef0123456789abcdef")}})',
      ),
    ).toBeNull();
  });

  it("extractAdminCommandBody handles a body with array + boolean + null values", () => {
    expect(
      extractAdminCommandBody(
        'db.runCommand({find: "users", filter: {tags: ["a", "b"], active: true, deleted: null}})',
      ),
    ).toEqual({
      find: "users",
      filter: { tags: ["a", "b"], active: true, deleted: null },
    });
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
