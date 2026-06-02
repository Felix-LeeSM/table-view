// Sprint 307: mongosh expression parser foundation for Phase 28 Slice A1.
// The parser turns `db.<coll>.<method>(<args>).<chain>` strings into a
// discriminated-union result so later sub-slices (A2 backend dispatch, A3
// editor surface, A4 snippet menu, A5 read dispatch, A6 write dispatch) can
// route mongosh expressions without invoking a JS evaluator. Tests cover the
// AC matrix from `docs/sprints/sprint-307/contract.md`: 13 happy-path methods,
// 6 BSON literal reifications, and 13 refusal kinds. (2026-05-14)
import { describe, it, expect } from "vitest";
import {
  MONGOSH_METHOD_WHITELIST,
  parseMongoshExpression,
  type ParsedMongoshCall,
  type ParsedMongoshError,
} from "./mongoshParser";
import { MONGOSH_DB_METHODS } from "./mongoAutocomplete";

function expectSuccess(
  result: ParsedMongoshCall | ParsedMongoshError,
): asserts result is ParsedMongoshCall {
  if (result.kind !== "success") {
    throw new Error(
      `expected success, got error ${result.kind}: ${result.message}`,
    );
  }
}

function expectError(
  result: ParsedMongoshCall | ParsedMongoshError,
): asserts result is ParsedMongoshError {
  if (result.kind !== "error") {
    throw new Error(`expected error, got success: ${JSON.stringify(result)}`);
  }
}

describe("MONGOSH_METHOD_WHITELIST", () => {
  it("exposes the executable mongosh methods as the dispatch source of truth", () => {
    expect(MONGOSH_METHOD_WHITELIST).toEqual([
      "find",
      "findOne",
      "aggregate",
      "countDocuments",
      "estimatedDocumentCount",
      "distinct",
      "insertOne",
      "insertMany",
      "updateOne",
      "updateMany",
      "replaceOne",
      "deleteOne",
      "deleteMany",
      "createIndex",
      "dropIndex",
      "bulkWrite",
    ]);
  });

  it("covers every db.<collection> autocomplete method", () => {
    const executable = new Set<string>(MONGOSH_METHOD_WHITELIST);
    const autocompleteOnly = MONGOSH_DB_METHODS.map((m) => m.label).filter(
      (label) => !executable.has(label),
    );

    expect(autocompleteOnly).toEqual([]);
  });
});

describe("parseMongoshExpression — happy path methods (AC-02)", () => {
  it("parses db.users.find({age: {$gt: 30}})", () => {
    const result = parseMongoshExpression("db.users.find({age: {$gt: 30}})");
    expectSuccess(result);
    expect(result.collection).toBe("users");
    expect(result.method).toBe("find");
    expect(result.args).toEqual([{ age: { $gt: 30 } }]);
    expect(result.cursorChain).toEqual([]);
  });

  it("parses db.users.find({}).sort({name: 1}).limit(10).skip(20).toArray()", () => {
    const result = parseMongoshExpression(
      "db.users.find({}).sort({name: 1}).limit(10).skip(20).toArray()",
    );
    expectSuccess(result);
    expect(result.collection).toBe("users");
    expect(result.method).toBe("find");
    expect(result.args).toEqual([{}]);
    expect(result.cursorChain).toEqual([
      { name: "sort", args: [{ name: 1 }] },
      { name: "limit", args: [10] },
      { name: "skip", args: [20] },
      { name: "toArray", args: [] },
    ]);
  });

  it("parses db.events.aggregate([{$match: {x: 1}}, {$group: {_id: $dept, n: {$sum: 1}}}])", () => {
    const result = parseMongoshExpression(
      'db.events.aggregate([{$match: {x: 1}}, {$group: {_id: "$dept", n: {$sum: 1}}}])',
    );
    expectSuccess(result);
    expect(result.collection).toBe("events");
    expect(result.method).toBe("aggregate");
    expect(result.args).toEqual([
      [{ $match: { x: 1 } }, { $group: { _id: "$dept", n: { $sum: 1 } } }],
    ]);
    expect(result.cursorChain).toEqual([]);
  });

  it("parses db.users.findOne({_id: ObjectId(...)}) reifying the BSON literal", () => {
    const result = parseMongoshExpression(
      'db.users.findOne({_id: ObjectId("65abcdef0123456789abcdef")})',
    );
    expectSuccess(result);
    expect(result.collection).toBe("users");
    expect(result.method).toBe("findOne");
    expect(result.args).toEqual([
      { _id: { $oid: "65abcdef0123456789abcdef" } },
    ]);
  });

  it("parses db.users.countDocuments({active: true})", () => {
    const result = parseMongoshExpression(
      "db.users.countDocuments({active: true})",
    );
    expectSuccess(result);
    expect(result.method).toBe("countDocuments");
    expect(result.args).toEqual([{ active: true }]);
  });

  it("parses db.users.estimatedDocumentCount()", () => {
    const result = parseMongoshExpression("db.users.estimatedDocumentCount()");
    expectSuccess(result);
    expect(result.method).toBe("estimatedDocumentCount");
    expect(result.args).toEqual([]);
  });

  it('parses db.users.distinct("country", {active: true})', () => {
    const result = parseMongoshExpression(
      'db.users.distinct("country", {active: true})',
    );
    expectSuccess(result);
    expect(result.method).toBe("distinct");
    expect(result.args).toEqual(["country", { active: true }]);
  });

  it('parses db.users.insertOne({name: "alice"})', () => {
    const result = parseMongoshExpression(
      'db.users.insertOne({name: "alice"})',
    );
    expectSuccess(result);
    expect(result.method).toBe("insertOne");
    expect(result.args).toEqual([{ name: "alice" }]);
  });

  it("parses db.users.insertMany([{a: 1}, {b: 2}])", () => {
    const result = parseMongoshExpression(
      "db.users.insertMany([{a: 1}, {b: 2}])",
    );
    expectSuccess(result);
    expect(result.method).toBe("insertMany");
    expect(result.args).toEqual([[{ a: 1 }, { b: 2 }]]);
  });

  it('parses db.users.updateOne({_id: "x"}, {$set: {y: 1}})', () => {
    const result = parseMongoshExpression(
      'db.users.updateOne({_id: "x"}, {$set: {y: 1}})',
    );
    expectSuccess(result);
    expect(result.method).toBe("updateOne");
    expect(result.args).toEqual([{ _id: "x" }, { $set: { y: 1 } }]);
  });

  it("parses db.users.updateMany({active: true}, {$inc: {n: 1}})", () => {
    const result = parseMongoshExpression(
      "db.users.updateMany({active: true}, {$inc: {n: 1}})",
    );
    expectSuccess(result);
    expect(result.method).toBe("updateMany");
    expect(result.args).toEqual([{ active: true }, { $inc: { n: 1 } }]);
  });

  it("parses db.users.replaceOne({email}, replacement, {upsert})", () => {
    const result = parseMongoshExpression(
      'db.users.replaceOne({email: "a@example.com"}, {email: "a@example.com", active: true}, {upsert: true})',
    );
    expectSuccess(result);
    expect(result.method).toBe("replaceOne");
    expect(result.args).toEqual([
      { email: "a@example.com" },
      { email: "a@example.com", active: true },
      { upsert: true },
    ]);
  });

  it('parses db.users.deleteOne({_id: "x"})', () => {
    const result = parseMongoshExpression('db.users.deleteOne({_id: "x"})');
    expectSuccess(result);
    expect(result.method).toBe("deleteOne");
    expect(result.args).toEqual([{ _id: "x" }]);
  });

  it("parses db.users.deleteMany({old: true})", () => {
    const result = parseMongoshExpression("db.users.deleteMany({old: true})");
    expectSuccess(result);
    expect(result.method).toBe("deleteMany");
    expect(result.args).toEqual([{ old: true }]);
  });

  it("parses db.users.createIndex({email: 1}, {unique: true})", () => {
    const result = parseMongoshExpression(
      'db.users.createIndex({email: 1}, {name: "email_1", unique: true})',
    );
    expectSuccess(result);
    expect(result.method).toBe("createIndex");
    expect(result.args).toEqual([
      { email: 1 },
      { name: "email_1", unique: true },
    ]);
  });

  it('parses db.users.dropIndex("email_1")', () => {
    const result = parseMongoshExpression('db.users.dropIndex("email_1")');
    expectSuccess(result);
    expect(result.method).toBe("dropIndex");
    expect(result.args).toEqual(["email_1"]);
  });

  it("parses db.users.bulkWrite([...]) with insertOne + updateOne sub-ops", () => {
    const result = parseMongoshExpression(
      "db.users.bulkWrite([" +
        "{insertOne: {document: {a: 1}}}, " +
        "{updateOne: {filter: {a: 1}, update: {$set: {b: 2}}}}" +
        "])",
    );
    expectSuccess(result);
    expect(result.method).toBe("bulkWrite");
    expect(result.args).toEqual([
      [
        { insertOne: { document: { a: 1 } } },
        { updateOne: { filter: { a: 1 }, update: { $set: { b: 2 } } } },
      ],
    ]);
  });
});

describe("parseMongoshExpression — BSON literal reification (AC-03)", () => {
  it('reifies ObjectId("65abcdef0123456789abcdef") to { $oid }', () => {
    const result = parseMongoshExpression(
      'db.users.findOne({_id: ObjectId("65abcdef0123456789abcdef")})',
    );
    expectSuccess(result);
    expect(result.args[0]).toEqual({
      _id: { $oid: "65abcdef0123456789abcdef" },
    });
  });

  it('reifies ISODate("2026-05-14T00:00:00.000Z") to { $date }', () => {
    const result = parseMongoshExpression(
      'db.events.find({when: ISODate("2026-05-14T00:00:00.000Z")})',
    );
    expectSuccess(result);
    expect(result.args[0]).toEqual({
      when: { $date: "2026-05-14T00:00:00.000Z" },
    });
  });

  it('reifies UUID("550e8400-e29b-41d4-a716-446655440000") to { $uuid }', () => {
    const result = parseMongoshExpression(
      'db.users.find({uuid: UUID("550e8400-e29b-41d4-a716-446655440000")})',
    );
    expectSuccess(result);
    expect(result.args[0]).toEqual({
      uuid: { $uuid: "550e8400-e29b-41d4-a716-446655440000" },
    });
  });

  it('reifies NumberLong("9223372036854775807") to { $numberLong }', () => {
    const result = parseMongoshExpression(
      'db.metrics.insertOne({n: NumberLong("9223372036854775807")})',
    );
    expectSuccess(result);
    expect(result.args[0]).toEqual({
      n: { $numberLong: "9223372036854775807" },
    });
  });

  it('reifies NumberDecimal("123.456789012345678901234567890") to { $numberDecimal }', () => {
    const result = parseMongoshExpression(
      'db.prices.insertOne({amt: NumberDecimal("123.456789012345678901234567890")})',
    );
    expectSuccess(result);
    expect(result.args[0]).toEqual({
      amt: { $numberDecimal: "123.456789012345678901234567890" },
    });
  });

  it('reifies BinData(0, "AQID") to { $binary: { base64, subType "00" } }', () => {
    const result = parseMongoshExpression(
      'db.blobs.insertOne({data: BinData(0, "AQID")})',
    );
    expectSuccess(result);
    expect(result.args[0]).toEqual({
      data: { $binary: { base64: "AQID", subType: "00" } },
    });
  });
});

describe("parseMongoshExpression — refusal kinds (AC-04)", () => {
  it("var x = 1; db.users.find(x) → unsupported-syntax", () => {
    const result = parseMongoshExpression("var x = 1; db.users.find(x)");
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("for-loop wrapping db.users.insertOne → unsupported-syntax", () => {
    const result = parseMongoshExpression(
      "for (let i = 0; i < 10; i++) db.users.insertOne({i})",
    );
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("if-statement wrapping db.users.find → unsupported-syntax", () => {
    const result = parseMongoshExpression("if (true) db.users.find({})");
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("forEach callback method → unsupported-syntax", () => {
    const result = parseMongoshExpression(
      "db.users.find({}).forEach(d => print(d))",
    );
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("map callback method → unsupported-syntax", () => {
    const result = parseMongoshExpression("db.users.find({}).map(d => d.name)");
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("shell helper `use admin` → unsupported-syntax", () => {
    const result = parseMongoshExpression("use admin");
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("shell helper `show dbs` → unsupported-syntax", () => {
    const result = parseMongoshExpression("show dbs");
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("getSiblingDB cross-db navigation → unsupported-syntax", () => {
    const result = parseMongoshExpression(
      'db.getSiblingDB("other").users.find({})',
    );
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("unknown method db.users.deleteAll → unsupported-method", () => {
    const result = parseMongoshExpression("db.users.deleteAll({})");
    expectError(result);
    expect(result.errorKind).toBe("unsupported-method");
  });

  it("malformed ObjectId hex → bson-literal", () => {
    const result = parseMongoshExpression(
      'db.users.find({_id: ObjectId("not-hex")})',
    );
    expectError(result);
    expect(result.errorKind).toBe("bson-literal");
  });

  it("NumberLong out-of-range → bson-literal", () => {
    const result = parseMongoshExpression(
      'db.metrics.insertOne({n: NumberLong("99999999999999999999")})',
    );
    expectError(result);
    expect(result.errorKind).toBe("bson-literal");
  });

  it("multiple statements separated by ; → multiple-statements", () => {
    const result = parseMongoshExpression(
      "db.users.find({}); db.users.find({})",
    );
    expectError(result);
    expect(result.errorKind).toBe("multiple-statements");
  });

  it("missing db. prefix → missing-db-prefix", () => {
    const result = parseMongoshExpression("users.find({})");
    expectError(result);
    expect(result.errorKind).toBe("missing-db-prefix");
  });

  it("cursor chain after insertOne → invalid-cursor-chain", () => {
    const result = parseMongoshExpression("db.users.insertOne({}).limit(5)");
    expectError(result);
    expect(result.errorKind).toBe("invalid-cursor-chain");
  });

  it("transaction shell helpers → unsupported-method with friendly standalone message", () => {
    for (const input of [
      "db.getMongo().startSession()",
      "session.startTransaction()",
      "session.withTransaction(() => db.users.insertOne({}))",
      "session.commitTransaction()",
      "session.abortTransaction()",
    ]) {
      const result = parseMongoshExpression(input);
      expectError(result);
      expect(result.errorKind).toBe("unsupported-method");
      expect(result.message).toMatch(/Transactions are not supported/i);
      expect(result.message).toMatch(/standalone MongoDB servers/i);
    }
  });
});

describe("parseMongoshExpression — invariants", () => {
  it("never throws on garbage input — empty string returns error", () => {
    const result = parseMongoshExpression("");
    expectError(result);
    expect(result.errorKind).toBeDefined();
  });

  it("never throws on garbage input — random punctuation returns error", () => {
    const result = parseMongoshExpression("@@@!!!&&&");
    expectError(result);
  });

  it("never throws on garbage input — unmatched braces return error", () => {
    const result = parseMongoshExpression("db.users.find({");
    expectError(result);
  });

  it("never throws on a non-string runtime input", () => {
    const result = parseMongoshExpression(123 as unknown as string);
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("returns success kind discriminator on valid input", () => {
    const result = parseMongoshExpression("db.users.find({})");
    expect(result.kind).toBe("success");
  });
});

describe("parseMongoshExpression — lexer / value coverage", () => {
  it("strips leading // line comments before the expression", () => {
    const result = parseMongoshExpression(
      "// pick recent users\ndb.users.find({recent: true})",
    );
    expectSuccess(result);
    expect(result.method).toBe("find");
  });

  it("strips leading /* block */ comments before the expression", () => {
    const result = parseMongoshExpression(
      "/* recent users */ db.users.find({recent: true})",
    );
    expectSuccess(result);
    expect(result.method).toBe("find");
  });

  it("strips inline // line comments inside arguments", () => {
    const result = parseMongoshExpression(
      "db.users.find({\n// inline comment\nactive: true\n})",
    );
    expectSuccess(result);
    expect(result.args).toEqual([{ active: true }]);
  });

  it("strips inline /* block */ comments inside arguments", () => {
    const result = parseMongoshExpression(
      "db.users.find({/* note */ active: true})",
    );
    expectSuccess(result);
    expect(result.args).toEqual([{ active: true }]);
  });

  it("rejects an unterminated /* block comment as unsupported-syntax", () => {
    const result = parseMongoshExpression("db.users.find({/* never closes ");
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("rejects an unterminated string literal as unsupported-syntax", () => {
    const result = parseMongoshExpression('db.users.find({name: "alice');
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("parses single-quoted strings identically to double-quoted strings", () => {
    const result = parseMongoshExpression("db.users.find({name: 'alice'})");
    expectSuccess(result);
    expect(result.args).toEqual([{ name: "alice" }]);
  });

  it("handles backslash escapes inside string literals", () => {
    const result = parseMongoshExpression(
      'db.users.find({tag: "line\\nbreak\\ttab\\\\back\\"quote"})',
    );
    expectSuccess(result);
    expect(result.args).toEqual([{ tag: 'line\nbreak\ttab\\back"quote' }]);
  });

  it("rejects an invalid \\u escape sequence", () => {
    const result = parseMongoshExpression('db.users.find({tag: "\\uZZZZ"})');
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("decodes a valid \\u escape sequence to the corresponding character", () => {
    const result = parseMongoshExpression('db.users.find({tag: "A\\u0042C"})');
    expectSuccess(result);
    expect(result.args).toEqual([{ tag: "ABC" }]);
  });

  it("parses negative integers and floats with exponent notation", () => {
    const result = parseMongoshExpression(
      "db.metrics.find({delta: -3.5, scaled: 1.2e3, negExp: 4E-2})",
    );
    expectSuccess(result);
    expect(result.args).toEqual([{ delta: -3.5, scaled: 1200, negExp: 0.04 }]);
  });

  it("parses booleans and null inside arguments", () => {
    const result = parseMongoshExpression(
      "db.users.find({active: true, banned: false, deletedAt: null})",
    );
    expectSuccess(result);
    expect(result.args).toEqual([
      { active: true, banned: false, deletedAt: null },
    ]);
  });

  it("parses string-quoted object keys (JSON style)", () => {
    const result = parseMongoshExpression(
      'db.users.find({"user.name": "alice"})',
    );
    expectSuccess(result);
    expect(result.args).toEqual([{ "user.name": "alice" }]);
  });

  it("parses nested arrays inside object values", () => {
    const result = parseMongoshExpression(
      "db.users.find({tags: [[1,2],[3,4]]})",
    );
    expectSuccess(result);
    expect(result.args).toEqual([
      {
        tags: [
          [1, 2],
          [3, 4],
        ],
      },
    ]);
  });

  it("tolerates a trailing semicolon after a single expression", () => {
    const result = parseMongoshExpression("db.users.find({});");
    expectSuccess(result);
    expect(result.method).toBe("find");
  });

  it("rejects bare-identifier shorthand object keys (`{i}`)", () => {
    const result = parseMongoshExpression("db.users.insertOne({i})");
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("rejects mismatched argument-list closing punctuation", () => {
    const result = parseMongoshExpression("db.users.find({} ]");
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("rejects trailing tokens after a closed expression", () => {
    const result = parseMongoshExpression("db.users.find({}) garbage");
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("rejects a missing `.` between db and the collection name", () => {
    const result = parseMongoshExpression("db users.find({})");
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("rejects a missing `.` between collection and the method name", () => {
    const result = parseMongoshExpression("db.users find({})");
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("rejects a collection token that isn't an identifier", () => {
    const result = parseMongoshExpression("db.123.find({})");
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("rejects a method token that isn't an identifier", () => {
    const result = parseMongoshExpression("db.users.456({})");
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("rejects a cursor chain step whose name is not an identifier", () => {
    const result = parseMongoshExpression("db.users.find({}).123(1)");
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("rejects an unknown cursor chain method as invalid-cursor-chain", () => {
    const result = parseMongoshExpression("db.users.find({}).unknownChain(1)");
    expectError(result);
    expect(result.errorKind).toBe("invalid-cursor-chain");
  });

  it("rejects a value token in an unexpected slot (stray `:`)", () => {
    const result = parseMongoshExpression("db.users.find(:1)");
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("rejects an unterminated argument list", () => {
    const result = parseMongoshExpression("db.users.find({}, ");
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("rejects a non-identifier object key (a number)", () => {
    const result = parseMongoshExpression("db.users.find({1: 2})");
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("rejects an unterminated object literal mid-pair", () => {
    const result = parseMongoshExpression("db.users.find({a: 1");
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("rejects an unterminated array literal", () => {
    const result = parseMongoshExpression(
      "db.events.aggregate([{$match: {}}, ",
    );
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("rejects `undefined` as a bare identifier value", () => {
    const result = parseMongoshExpression("db.users.find({trace: undefined})");
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });
});

describe("parseMongoshExpression — BSON literal edge cases", () => {
  it("rejects ObjectId with a non-string argument as bson-literal", () => {
    const result = parseMongoshExpression("db.users.find({_id: ObjectId(42)})");
    expectError(result);
    expect(result.errorKind).toBe("bson-literal");
  });

  it("rejects ObjectId with too few arguments as bson-literal", () => {
    const result = parseMongoshExpression("db.users.find({_id: ObjectId()})");
    expectError(result);
    expect(result.errorKind).toBe("bson-literal");
  });

  it("rejects ISODate with a non-string argument", () => {
    const result = parseMongoshExpression(
      "db.events.find({when: ISODate(1700000000)})",
    );
    expectError(result);
    expect(result.errorKind).toBe("bson-literal");
  });

  it("rejects ISODate with an unparseable timestamp", () => {
    const result = parseMongoshExpression(
      'db.events.find({when: ISODate("not-a-date")})',
    );
    expectError(result);
    expect(result.errorKind).toBe("bson-literal");
  });

  it("rejects UUID with a malformed hex payload", () => {
    const result = parseMongoshExpression(
      'db.users.find({uuid: UUID("not-a-uuid")})',
    );
    expectError(result);
    expect(result.errorKind).toBe("bson-literal");
  });

  it("rejects UUID with a non-string argument", () => {
    const result = parseMongoshExpression("db.users.find({uuid: UUID(42)})");
    expectError(result);
    expect(result.errorKind).toBe("bson-literal");
  });

  it("accepts NumberLong with a numeric argument via the shared WASM parser", () => {
    const result = parseMongoshExpression(
      "db.metrics.insertOne({n: NumberLong(123)})",
    );
    expectSuccess(result);
    expect(result.args[0]).toEqual({
      n: { $numberLong: "123" },
    });
  });

  it("rejects NumberLong with a non-integer literal", () => {
    const result = parseMongoshExpression(
      'db.metrics.insertOne({n: NumberLong("1.5")})',
    );
    expectError(result);
    expect(result.errorKind).toBe("bson-literal");
  });

  it("accepts the most-negative 64-bit NumberLong", () => {
    const result = parseMongoshExpression(
      'db.metrics.insertOne({n: NumberLong("-9223372036854775808")})',
    );
    expectSuccess(result);
    expect(result.args[0]).toEqual({
      n: { $numberLong: "-9223372036854775808" },
    });
  });

  it("rejects NumberLong below the 64-bit signed minimum", () => {
    const result = parseMongoshExpression(
      'db.metrics.insertOne({n: NumberLong("-99999999999999999999")})',
    );
    expectError(result);
    expect(result.errorKind).toBe("bson-literal");
  });

  it("rejects NumberDecimal with a malformed numeric literal", () => {
    const result = parseMongoshExpression(
      'db.prices.insertOne({amt: NumberDecimal("12.34.56")})',
    );
    expectError(result);
    expect(result.errorKind).toBe("bson-literal");
  });

  it("accepts NumberDecimal with a numeric argument via the shared WASM parser", () => {
    const result = parseMongoshExpression(
      "db.prices.insertOne({amt: NumberDecimal(1)})",
    );
    expectSuccess(result);
    expect(result.args[0]).toEqual({
      amt: { $numberDecimal: "1" },
    });
  });

  it("rejects BinData with a wrong argument count", () => {
    const result = parseMongoshExpression(
      'db.blobs.insertOne({data: BinData("AQID")})',
    );
    expectError(result);
    expect(result.errorKind).toBe("bson-literal");
  });

  it("rejects BinData with a non-integer subtype", () => {
    const result = parseMongoshExpression(
      'db.blobs.insertOne({data: BinData(1.5, "AQID")})',
    );
    expectError(result);
    expect(result.errorKind).toBe("bson-literal");
  });

  it("rejects BinData with a subtype out of 0..255 range", () => {
    const result = parseMongoshExpression(
      'db.blobs.insertOne({data: BinData(300, "AQID")})',
    );
    expectError(result);
    expect(result.errorKind).toBe("bson-literal");
  });

  it("rejects BinData with a malformed base64 payload", () => {
    const result = parseMongoshExpression(
      'db.blobs.insertOne({data: BinData(0, "*not*base64*")})',
    );
    expectError(result);
    expect(result.errorKind).toBe("bson-literal");
  });

  it("zero-pads the BinData subtype to two hex characters", () => {
    const result = parseMongoshExpression(
      'db.blobs.insertOne({data: BinData(15, "AQID")})',
    );
    expectSuccess(result);
    expect(result.args[0]).toEqual({
      data: { $binary: { base64: "AQID", subType: "0f" } },
    });
  });
});

describe("parseMongoshExpression — cursor chain semantics", () => {
  it("parses sort on aggregate cursor", () => {
    const result = parseMongoshExpression(
      "db.events.aggregate([{$match: {x: 1}}]).sort({when: -1})",
    );
    expectSuccess(result);
    expect(result.cursorChain).toEqual([
      { name: "sort", args: [{ when: -1 }] },
    ]);
  });

  it("refuses a callback method (`forEach`) chained after find", () => {
    const result = parseMongoshExpression("db.users.find({}).forEach(d => d)");
    expectError(result);
    expect(result.errorKind).toBe("unsupported-syntax");
  });

  it("refuses .skip after countDocuments as invalid-cursor-chain", () => {
    const result = parseMongoshExpression(
      "db.users.countDocuments({}).skip(2)",
    );
    expectError(result);
    expect(result.errorKind).toBe("invalid-cursor-chain");
  });
});
