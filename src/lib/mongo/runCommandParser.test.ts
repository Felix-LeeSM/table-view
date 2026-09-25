// 2026-05-17 — statement-kind classifier tests. When the classifier moved to
// the AST, all cases from the regex-based version were preserved verbatim,
// plus AC-382-R additions for behavior that the AST now handles correctly
// (comments anywhere, nested body, multi-statement reject).
//
// Reason: db-contract α's Run gating with no chip selected depends directly
// on `classifyMongoStatement` accuracy. This file verifies the baseline
// cases from the regex-based version together with the scenarios the AST
// promotion newly locks.

import { describe, expect, it } from "vitest";
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

  // 2026-05-17 — BSON literals are now normalised to extended-JSON
  // placeholders so the body parses successfully.
  it("AC-383-B-R — extractAdminCommandBody normalises BSON literals to extended-JSON placeholders", () => {
    expect(
      extractAdminCommandBody(
        'db.runCommand({find: "users", filter: {_id: ObjectId("65abcdef0123456789abcdef")}})',
      ),
    ).toEqual({
      find: "users",
      filter: { _id: { $oid: "65abcdef0123456789abcdef" } },
    });
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
