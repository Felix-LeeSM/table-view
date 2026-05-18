// Sprint 382 (2026-05-17) — mongosh AST parser MVP unit tests.
//
// 작성 이유: sprint-381 의 정규식 기반 statement classifier 를 typed AST 로
// promote. 본 파일은 AST 모듈 자체 (tokenizer + recursive-descent parser)
// 를 covers; `runCommandParser.test.ts` 는 sprint-381 contract 가 본 AST
// 위에서 동일하게 유지됨을 회귀-lock 한다.

import { describe, it, expect } from "vitest";
import {
  parseMongoshStatement,
  type MongoshStatementResult,
  type MongoshAdminCommand,
  type MongoshCollectionCommand,
  type MongoshParseError,
} from "./mongoshAst";

function expectAdmin(
  result: MongoshStatementResult,
): asserts result is MongoshAdminCommand {
  if (result.kind !== "admin-command") {
    throw new Error(
      `expected admin-command, got ${result.kind}: ${JSON.stringify(result)}`,
    );
  }
}

function expectCollection(
  result: MongoshStatementResult,
): asserts result is MongoshCollectionCommand {
  if (result.kind !== "collection-command") {
    throw new Error(
      `expected collection-command, got ${result.kind}: ${JSON.stringify(result)}`,
    );
  }
}

function expectError(
  result: MongoshStatementResult,
): asserts result is MongoshParseError {
  if (result.kind !== "error") {
    throw new Error(
      `expected error, got ${result.kind}: ${JSON.stringify(result)}`,
    );
  }
}

describe("parseMongoshStatement — admin commands (AC-382-T1/T2)", () => {
  it("AC-382-T1 — parses db.runCommand({ping: 1}) into admin-command", () => {
    const result = parseMongoshStatement("db.runCommand({ping: 1})");
    expectAdmin(result);
    expect(result.commandName).toBe("runCommand");
    expect(result.body).toEqual({ ping: 1 });
  });

  it("AC-382-T2 — parses db.adminCommand({serverStatus: 1}) into admin-command", () => {
    const result = parseMongoshStatement("db.adminCommand({serverStatus: 1})");
    expectAdmin(result);
    expect(result.commandName).toBe("adminCommand");
    expect(result.body).toEqual({ serverStatus: 1 });
  });

  it("tolerates leading whitespace and trailing semicolon around admin command", () => {
    const result = parseMongoshStatement("   \n  db.runCommand({ping: 1}) ;\n");
    expectAdmin(result);
    expect(result.commandName).toBe("runCommand");
  });

  it("tolerates a trailing comma inside the admin command body", () => {
    const result = parseMongoshStatement("db.runCommand({ping: 1,})");
    expectAdmin(result);
    expect(result.body).toEqual({ ping: 1 });
  });
});

describe("parseMongoshStatement — collection commands (AC-382-T3/T4)", () => {
  it("AC-382-T3 — parses db.users.find({}) into collection-command", () => {
    const result = parseMongoshStatement("db.users.find({})");
    expectCollection(result);
    expect(result.collection).toBe("users");
    expect(result.method).toBe("find");
    expect(result.args).toEqual([{}]);
  });

  it("AC-382-T4 — parses db.users.find({}, {limit: 10}) with 2 args", () => {
    const result = parseMongoshStatement("db.users.find({}, {limit: 10})");
    expectCollection(result);
    expect(result.args.length).toBe(2);
    expect(result.args).toEqual([{}, { limit: 10 }]);
  });

  it("parses db.users.estimatedDocumentCount() with no args", () => {
    const result = parseMongoshStatement("db.users.estimatedDocumentCount()");
    expectCollection(result);
    expect(result.collection).toBe("users");
    expect(result.method).toBe("estimatedDocumentCount");
    expect(result.args).toEqual([]);
  });
});

describe("parseMongoshStatement — object literals (AC-382-T5/T6)", () => {
  it("AC-382-T5 — mixes identifier keys and quoted keys", () => {
    const result = parseMongoshStatement(
      'db.runCommand({a: 1, "b.c": 2, $sum: 3})',
    );
    expectAdmin(result);
    expect(result.body).toEqual({ a: 1, "b.c": 2, $sum: 3 });
  });

  it("AC-382-T6 — parses nested object literal", () => {
    const result = parseMongoshStatement(
      "db.runCommand({outer: {inner: 1, also: {deep: true}}})",
    );
    expectAdmin(result);
    expect(result.body).toEqual({
      outer: { inner: 1, also: { deep: true } },
    });
  });

  it("parses object with array, boolean, null, and string values", () => {
    const result = parseMongoshStatement(
      'db.runCommand({arr: [1, 2, 3], flag: true, missing: null, name: "ok"})',
    );
    expectAdmin(result);
    expect(result.body).toEqual({
      arr: [1, 2, 3],
      flag: true,
      missing: null,
      name: "ok",
    });
  });
});

describe("parseMongoshStatement — string literals (AC-382-T7)", () => {
  it("AC-382-T7 — parses double-quoted strings", () => {
    const result = parseMongoshStatement('db.runCommand({name: "alice"})');
    expectAdmin(result);
    expect(result.body).toEqual({ name: "alice" });
  });

  it("AC-382-T7 — parses single-quoted strings identically", () => {
    const result = parseMongoshStatement("db.runCommand({name: 'alice'})");
    expectAdmin(result);
    expect(result.body).toEqual({ name: "alice" });
  });
});

describe("parseMongoshStatement — comment stripping (AC-382-T8)", () => {
  it("AC-382-T8 — strips a leading line comment before the statement", () => {
    const result = parseMongoshStatement(
      "// pick recent users\ndb.runCommand({ping: 1})",
    );
    expectAdmin(result);
    expect(result.body).toEqual({ ping: 1 });
  });

  it("AC-382-T8 — strips inline line comments inside the body", () => {
    const result = parseMongoshStatement(
      "db.runCommand({\n// inline\nping: 1\n})",
    );
    expectAdmin(result);
    expect(result.body).toEqual({ ping: 1 });
  });

  it("strips a leading block comment before the statement (bonus)", () => {
    const result = parseMongoshStatement(
      "/* block */ db.runCommand({ping: 1})",
    );
    expectAdmin(result);
    expect(result.body).toEqual({ ping: 1 });
  });
});

describe("parseMongoshStatement — multi-statement rejection (AC-382-T9)", () => {
  it("AC-382-T9 — rejects two statements separated by `;`", () => {
    const result = parseMongoshStatement("db.users.find({}); db.users.drop()");
    expectError(result);
    expect(result.errorKind).toBe("multiple-statements");
  });

  it("AC-382-T9 — rejects admin + collection chain via `;`", () => {
    const result = parseMongoshStatement(
      "db.runCommand({ping: 1}); db.users.find({})",
    );
    expectError(result);
    expect(result.errorKind).toBe("multiple-statements");
  });

  it("tolerates a lone trailing semicolon (no second statement)", () => {
    const result = parseMongoshStatement("db.users.find({});");
    expectCollection(result);
    expect(result.method).toBe("find");
  });
});

describe("parseMongoshStatement — BSON literal rejection (AC-382-T10)", () => {
  it("AC-382-T10 — rejects ObjectId(...) inside the body", () => {
    const result = parseMongoshStatement(
      'db.runCommand({find: "users", filter: {_id: ObjectId("65abcdef0123456789abcdef")}})',
    );
    expectError(result);
    expect(result.errorKind).toBe("bson-literal");
  });

  it("AC-382-T10 — rejects ISODate(...) inside the body", () => {
    const result = parseMongoshStatement(
      'db.runCommand({find: "events", filter: {when: ISODate("2026-05-17T00:00:00Z")}})',
    );
    expectError(result);
    expect(result.errorKind).toBe("bson-literal");
  });

  it("AC-382-T10 — rejects NumberLong(...) inside the body", () => {
    const result = parseMongoshStatement(
      'db.runCommand({find: "metrics", filter: {n: NumberLong("42")}})',
    );
    expectError(result);
    expect(result.errorKind).toBe("bson-literal");
  });
});

describe("parseMongoshStatement — empty / unknown (AC-382-T11)", () => {
  it("AC-382-T11 — empty input returns an error with `unsupported-syntax`", () => {
    const result = parseMongoshStatement("");
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("AC-382-T11 — whitespace-only input returns an error", () => {
    const result = parseMongoshStatement("   \n\t  ");
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("non-mongo SQL returns an error (no `db.` prefix)", () => {
    const result = parseMongoshStatement("SELECT 1");
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });
});

describe("parseMongoshStatement — unsupported syntax (AC-382-T12)", () => {
  it("AC-382-T12 — rejects arrow function `=>`", () => {
    const result = parseMongoshStatement(
      "db.users.find({}).forEach(d => d.name)",
    );
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("AC-382-T12 — rejects template literal", () => {
    const result = parseMongoshStatement("db.runCommand({name: `alice`})");
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("rejects an unterminated string literal", () => {
    const result = parseMongoshStatement('db.runCommand({name: "alice');
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("rejects an unterminated object", () => {
    const result = parseMongoshStatement("db.runCommand({ping: 1");
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("rejects bare identifier in value position (variable reference)", () => {
    const result = parseMongoshStatement("db.runCommand({ping: someVar})");
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("rejects let/const/var declarations", () => {
    const result = parseMongoshStatement("let x = 1; db.users.find({})");
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("admin command must receive an object literal body (not a string)", () => {
    const result = parseMongoshStatement('db.runCommand("ping")');
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("admin command must receive exactly one object argument", () => {
    const result = parseMongoshStatement("db.runCommand({ping: 1}, {})");
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });
});

describe("parseMongoshStatement — numeric literals", () => {
  it("parses negative integers, floats, and exponent notation", () => {
    const result = parseMongoshStatement(
      "db.runCommand({a: -3, b: 1.5, c: 2e3, d: -4E-2})",
    );
    expectAdmin(result);
    expect(result.body).toEqual({ a: -3, b: 1.5, c: 2000, d: -0.04 });
  });
});

describe("parseMongoshStatement — invariants", () => {
  it("never throws on garbage input", () => {
    expect(() => parseMongoshStatement("@@@!!!")).not.toThrow();
    expect(() => parseMongoshStatement("db.")).not.toThrow();
    expect(() => parseMongoshStatement("db.users")).not.toThrow();
  });

  it("never throws on a non-string runtime input", () => {
    const result = parseMongoshStatement(123 as unknown as string);
    expectError(result);
  });
});
