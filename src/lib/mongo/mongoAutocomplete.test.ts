import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { json as jsonLanguage } from "@codemirror/lang-json";
import {
  MONGO_ACCUMULATORS,
  MONGO_ADMIN_COMMANDS,
  MONGO_AGGREGATE_STAGES,
  MONGO_ALL_OPERATORS,
  MONGO_EXPRESSION_OPERATORS,
  MONGO_PROJECTION_OPERATORS,
  MONGO_QUERY_OPERATORS,
  MONGO_TYPE_TAGS,
  MONGO_UPDATE_OPERATORS,
  MONGOSH_DB_METHODS,
  MONGOSH_DB_LEVEL_METHODS,
  createMongoAdminCommandSource,
  createMongoCompletionSource,
  createMongoOperatorHighlight,
  createMongoshDbSource,
  classifyMongoCompletionPosition,
  type MongoQueryMode,
} from "./mongoAutocomplete";
import { MONGOSH_METHOD_WHITELIST } from "./mongoshParser";

/**
 * Build an EditorState with the JSON language loaded and invoke the source
 * at a specific position. Mirrors how CodeMirror calls the source at
 * runtime, letting tests assert the raw candidate set without spinning up
 * a DOM.
 */
function runSource(
  doc: string,
  pos: number,
  queryMode: MongoQueryMode,
  fieldNames?: readonly string[],
) {
  const state = EditorState.create({
    doc,
    extensions: [jsonLanguage()],
  });
  const context = new CompletionContext(state, pos, /* explicit */ true);
  const source = createMongoCompletionSource({ queryMode, fieldNames });
  return source(context);
}

function labels(result: ReturnType<typeof runSource>): string[] {
  if (!result || result instanceof Promise) return [];
  return result.options.map((o) => o.label);
}

describe("mongoAutocomplete constants", () => {
  it("collection method completions stay aligned with the parser whitelist", () => {
    const labels = MONGOSH_DB_METHODS.map((method) => method.label);
    expect(labels).toEqual([...MONGOSH_METHOD_WHITELIST]);
  });

  it("MONGO_QUERY_OPERATORS covers official query predicate groups", () => {
    expect(MONGO_QUERY_OPERATORS).toContain("$eq");
    expect(MONGO_QUERY_OPERATORS).toContain("$and");
    expect(MONGO_QUERY_OPERATORS).toContain("$exists");
    expect(MONGO_QUERY_OPERATORS).toContain("$jsonSchema");
    expect(MONGO_QUERY_OPERATORS).toContain("$geoWithin");
    expect(MONGO_QUERY_OPERATORS).toContain("$bitsAnySet");
    expect(MONGO_QUERY_OPERATORS).toContain("$elemMatch");
    expect(MONGO_QUERY_OPERATORS.length).toBeGreaterThanOrEqual(31);
  });

  it("MONGO_AGGREGATE_STAGES covers modern pipeline stages", () => {
    expect(MONGO_AGGREGATE_STAGES).toContain("$match");
    expect(MONGO_AGGREGATE_STAGES).toContain("$project");
    expect(MONGO_AGGREGATE_STAGES).toContain("$group");
    expect(MONGO_AGGREGATE_STAGES).toContain("$setWindowFields");
    expect(MONGO_AGGREGATE_STAGES).toContain("$vectorSearch");
    expect(MONGO_AGGREGATE_STAGES).toContain("$searchMeta");
    expect(MONGO_AGGREGATE_STAGES).toContain("$out");
    expect(MONGO_AGGREGATE_STAGES).toContain("$merge");
    expect(MONGO_AGGREGATE_STAGES.length).toBeGreaterThanOrEqual(45);
  });

  it("MONGO_ACCUMULATORS covers modern accumulator/window operators", () => {
    expect(MONGO_ACCUMULATORS).toContain("$sum");
    expect(MONGO_ACCUMULATORS).toContain("$first");
    expect(MONGO_ACCUMULATORS).toContain("$topN");
    expect(MONGO_ACCUMULATORS).toContain("$bottomN");
    expect(MONGO_ACCUMULATORS).toContain("$percentile");
    expect(MONGO_ACCUMULATORS.length).toBeGreaterThanOrEqual(28);
  });

  it("MONGO_TYPE_TAGS enumerates BSON extended-JSON tags", () => {
    expect(MONGO_TYPE_TAGS).toContain("$oid");
    expect(MONGO_TYPE_TAGS).toContain("$date");
    expect(MONGO_TYPE_TAGS).toContain("$numberLong");
    expect(MONGO_TYPE_TAGS).toContain("$numberDouble");
    expect(MONGO_TYPE_TAGS).toContain("$numberInt");
    expect(MONGO_TYPE_TAGS).toContain("$numberDecimal");
    expect(MONGO_TYPE_TAGS).toContain("$binary");
    expect(MONGO_TYPE_TAGS).toContain("$regularExpression");
    expect(MONGO_TYPE_TAGS).toContain("$timestamp");
    expect(MONGO_TYPE_TAGS).toContain("$minKey");
    expect(MONGO_TYPE_TAGS).toContain("$maxKey");
    expect(MONGO_TYPE_TAGS).toContain("$symbol");
    expect(MONGO_TYPE_TAGS).toContain("$code");
    expect(MONGO_TYPE_TAGS).toContain("$uuid");
    expect(MONGO_TYPE_TAGS.length).toBeGreaterThanOrEqual(14);
  });

  it("covers projection, update, and expression operator groups", () => {
    expect(MONGO_PROJECTION_OPERATORS).toContain("$meta");
    expect(MONGO_UPDATE_OPERATORS).toContain("$setOnInsert");
    expect(MONGO_UPDATE_OPERATORS).toContain("$[]");
    expect(MONGO_EXPRESSION_OPERATORS).toContain("$dateTrunc");
    expect(MONGO_EXPRESSION_OPERATORS).toContain("$toObjectId");
    expect(MONGO_EXPRESSION_OPERATORS).toContain("$regexFindAll");
  });

  it("MONGO_ALL_OPERATORS is the union of every operator list", () => {
    const expected = new Set([
      ...MONGO_QUERY_OPERATORS,
      ...MONGO_PROJECTION_OPERATORS,
      ...MONGO_UPDATE_OPERATORS,
      ...MONGO_AGGREGATE_STAGES,
      ...MONGO_ACCUMULATORS,
      ...MONGO_EXPRESSION_OPERATORS,
      ...MONGO_TYPE_TAGS,
    ]);
    const actual = new Set(MONGO_ALL_OPERATORS);
    expect(actual).toEqual(expected);
  });
});

describe("classifyMongoCompletionPosition", () => {
  function classify(doc: string) {
    const state = EditorState.create({
      doc,
      extensions: [jsonLanguage()],
    });
    return classifyMongoCompletionPosition(
      new CompletionContext(state, doc.length, true),
    );
  }

  it("routes aggregate top-level object keys to stage candidates", () => {
    expect(classify('[{"')).toBe("stage-key");
  });

  it("routes nested filter keys separately from values", () => {
    expect(classify('{"')).toBe("accumulator-or-filter-key");
    expect(classify('{"age": ')).toBe("value");
  });
});

describe("createMongoCompletionSource — find mode", () => {
  // AC-01: `{ "$` triggers inside a find filter body → query operators.
  it("surfaces every filter operator at a find key position", () => {
    // doc: `{"$` with cursor at end (pos 3). `$` is the 3rd char.
    const doc = '{"$';
    const result = runSource(doc, doc.length, "find");
    const got = new Set(labels(result));
    for (const op of MONGO_QUERY_OPERATORS) {
      expect(got.has(op)).toBe(true);
    }
    // Should not mix in aggregate stages at a find key position.
    expect(got.has("$match")).toBe(false);
    expect(got.has("$group")).toBe(false);
  });

  it("does not surface candidates in plain strings", () => {
    const doc = '"hello world';
    const result = runSource(doc, doc.length, "find");
    // No $ or quoted-key match yet — cursor is inside a plain value
    // string. Explicit context still returns null.
    expect(result).toBeNull();
  });
});

describe("createMongoCompletionSource — aggregate mode", () => {
  // AC-02: `[{ "$` at stage key position returns stage candidates.
  it("surfaces every aggregate stage at a stage-key position", () => {
    const doc = '[{"$';
    const result = runSource(doc, doc.length, "aggregate");
    const got = new Set(labels(result));
    for (const stage of MONGO_AGGREGATE_STAGES) {
      expect(got.has(stage)).toBe(true);
    }
  });

  // AC-03: inside a stage body (`[{ "$match": { "$` ) accumulators show up
  // alongside the filter-operator set (so users can write `$match`'s body).
  it("surfaces accumulators inside a nested stage body", () => {
    const doc = '[{"$match":{"$';
    const result = runSource(doc, doc.length, "aggregate");
    const got = new Set(labels(result));
    for (const acc of MONGO_ACCUMULATORS) {
      expect(got.has(acc)).toBe(true);
    }
    // Find operators also make sense here (e.g. `$match` uses them).
    for (const op of MONGO_QUERY_OPERATORS) {
      expect(got.has(op)).toBe(true);
    }
  });

  it("surfaces expression and update operators in unified mongosh nested bodies", () => {
    const doc = '[{"$project":{"total":{"$';
    const result = runSource(doc, doc.length, "aggregate");
    const got = new Set(labels(result));

    expect(got.has("$dateTrunc")).toBe(true);
    expect(got.has("$toObjectId")).toBe(true);
    expect(got.has("$setOnInsert")).toBe(true);
    expect(got.has("$[]")).toBe(true);
  });

  it("aggregate stage set differs from find operator set", () => {
    const doc = '[{"$';
    const stageResult = runSource(doc, doc.length, "aggregate");
    const findResult = runSource('{"$', 3, "find");
    const stageSet = new Set(labels(stageResult));
    const findSet = new Set(labels(findResult));
    // Aggregate-only stages should be missing from find.
    expect(stageSet.has("$match")).toBe(true);
    expect(findSet.has("$match")).toBe(false);
  });
});

describe("createMongoCompletionSource — BSON type tags", () => {
  // AC-04: value-position `$` trigger → BSON type tags.
  it("surfaces BSON type tags at a value position (after `:`)", () => {
    // doc: `{"_id": {"$` — cursor just after the inner `$`. The outer
    // object has a property whose value is an object literal; the inner
    // `$` sits in that object's key position but *inside* a value slot
    // relative to the outer filter. Our classifier treats the inner `$`
    // as a nested-key position, so BSON tags land through the "unknown
    // fallback" branch only when the immediately-preceding char is `:`.
    //
    // To force the value-position branch we trigger right after `:` with
    // no opening object yet, which is the shape `{ "_id": $` would take
    // if the user typed `$` before opening the inner object.
    const doc = '{"_id": $';
    const result = runSource(doc, doc.length, "find");
    const got = new Set(labels(result));
    for (const tag of MONGO_TYPE_TAGS) {
      expect(got.has(tag)).toBe(true);
    }
  });
});

describe("createMongoCompletionSource — field names", () => {
  // AC-05: key-position quoted-fragment → field name candidates.
  it("offers cached field names at a find key position", () => {
    // Cursor inside a quoted key fragment in an object key slot.
    const doc = '{"';
    const result = runSource(doc, doc.length, "find", [
      "_id",
      "email",
      "status",
    ]);
    const got = new Set(labels(result));
    expect(got.has('"_id"')).toBe(true);
    expect(got.has('"email"')).toBe(true);
    expect(got.has('"status"')).toBe(true);
  });

  it("offers cached field names in createIndex key positions", () => {
    const doc = 'db.users.createIndex({"';
    const result = runSource(doc, doc.length, "aggregate", [
      "_id",
      "email",
      "createdAt",
    ]);
    const got = new Set(labels(result));
    expect(got.has('"_id"')).toBe(true);
    expect(got.has('"email"')).toBe(true);
    expect(got.has('"createdAt"')).toBe(true);
  });

  it("does not throw when fieldNames is empty or undefined", () => {
    // Empty array.
    expect(() => runSource('{"', 2, "find", [])).not.toThrow();
    // Undefined.
    expect(() => runSource('{"', 2, "find", undefined)).not.toThrow();
    // Both return null candidates (no field names to offer).
    expect(runSource('{"', 2, "find", [])).toBeNull();
    expect(runSource('{"', 2, "find", undefined)).toBeNull();
  });

  it("suppresses field-name candidates at value positions", () => {
    // `"active": "` — cursor is inside a string VALUE, not a key. The
    // hook must not pull up field-name candidates here, or users writing
    // string values would see noise.
    const doc = '{"active": "';
    const result = runSource(doc, doc.length, "find", ["email", "status"]);
    expect(result).toBeNull();
  });
});

describe("createMongoOperatorHighlight", () => {
  // AC-06 primary evidence: the extension is a valid CodeMirror Extension
  // we can load into an EditorState without throwing. Full DOM-class
  // assertion lives in QueryEditor.test.tsx which has a live editor.
  it("produces a CodeMirror extension that loads alongside JSON", () => {
    const ext = createMongoOperatorHighlight();
    expect(ext).toBeDefined();
    const state = EditorState.create({
      doc: '{"$match": 1}',
      extensions: [jsonLanguage(), ext],
    });
    // The extension is a ViewPlugin — EditorState stores its field values
    // lazily, so the best assertion available here is "state construction
    // succeeded".
    expect(state.doc.toString()).toBe('{"$match": 1}');
  });
});

// Sprint 381 (2026-05-17) — admin command dict + completion sources.
//
// 작성 이유: db-contract α 가 `db.runCommand({...})` / `db.adminCommand({...})`
// 을 자동완성에 노출해야 하므로, MONGO_ADMIN_COMMANDS dict 의 핵심
// 엔트리 + 두 source (db-level helpers + admin command literal) 가
// 발동되는 위치를 lock 한다. AST 가 아닌 정규식 기반이라 trigger 패턴
// 정확도 회귀 가드가 중요.

describe("mongoAutocomplete — sprint-381 admin command catalog", () => {
  it("MONGOSH_DB_LEVEL_METHODS includes runCommand + adminCommand", () => {
    const labels = MONGOSH_DB_LEVEL_METHODS.map((m) => m.label);
    expect(labels).toContain("runCommand");
    expect(labels).toContain("adminCommand");
    expect(labels).toContain("getProfilingStatus");
    expect(labels).toContain("setProfilingLevel");
  });

  it("MONGO_ADMIN_COMMANDS includes the canonical diagnostic set", () => {
    const labels = MONGO_ADMIN_COMMANDS.map((c) => c.label);
    expect(labels).toContain("ping");
    expect(labels).toContain("serverStatus");
    expect(labels).toContain("dbStats");
    expect(labels).toContain("collStats");
    expect(labels).toContain("currentOp");
    expect(labels).toContain("listDatabases");
    expect(labels).toContain("buildInfo");
    expect(labels).toContain("hostInfo");
    expect(MONGO_ADMIN_COMMANDS.length).toBeGreaterThanOrEqual(15);
  });

  it("each MONGO_ADMIN_COMMANDS entry carries an apply body shaped like `<key>: …`", () => {
    for (const cand of MONGO_ADMIN_COMMANDS) {
      // The apply value must contain a `:` so the rendered completion is
      // a valid `key: value` BSON literal that the user can chain inside
      // `{...}`. The literal *key* can differ from the user-facing label
      // (e.g. `setProfilingLevel` label → `profile: 1` apply) — that's
      // intentional, mongosh's helper-to-runCommand mapping.
      expect(cand.apply).toMatch(/^[A-Za-z_$][A-Za-z0-9_$]*\s*:/);
    }
  });
});

describe("createMongoshDbSource — sprint-381 db-level helper exposure", () => {
  function runDbSource(
    doc: string,
    pos: number,
    opts: Parameters<typeof createMongoshDbSource>[0] = {},
  ) {
    const state = EditorState.create({
      doc,
      extensions: [jsonLanguage()],
    });
    const context = new CompletionContext(state, pos, /* explicit */ true);
    const source = createMongoshDbSource(opts);
    return source(context);
  }

  it("surfaces `runCommand` when the user types `db.r`", () => {
    const doc = "db.r";
    const result = runDbSource(doc, doc.length, { collectionNames: [] });
    expect(result).not.toBeNull();
    if (!result || result instanceof Promise) return;
    const labels = result.options.map((o) => o.label);
    expect(labels).toContain("runCommand");
    expect(labels).toContain("adminCommand");
  });

  it("surfaces collection names alongside the db-level helpers", () => {
    const doc = "db.";
    const result = runDbSource(doc, doc.length, {
      collectionNames: ["users", "orders"],
    });
    expect(result).not.toBeNull();
    if (!result || result instanceof Promise) return;
    const labels = result.options.map((o) => o.label);
    // db-level methods come first; collections follow.
    expect(labels).toContain("runCommand");
    expect(labels).toContain("users");
    expect(labels).toContain("orders");
  });

  it("surfaces active collection index names in dropIndex argument position", () => {
    const doc = 'db.users.dropIndex("em';
    const result = runDbSource(doc, doc.length, {
      activeCollectionName: "users",
      indexNames: ["_id_", "email_1", "status_createdAt_1"],
    });
    expect(result).not.toBeNull();
    if (!result || result instanceof Promise) return;
    const labels = result.options.map((o) => o.label);
    expect(labels).toContain("email_1");
    expect(labels).toContain("status_createdAt_1");
    expect(labels).not.toContain("_id_");
  });

  it("does not reuse active index names for a different collection expression", () => {
    const doc = 'db.orders.dropIndex("';
    const result = runDbSource(doc, doc.length, {
      activeCollectionName: "users",
      indexNames: ["email_1"],
    });
    expect(result).toBeNull();
  });

  it("does not suggest unsupported shell helpers as supported completions", () => {
    const doc = "db.";
    const result = runDbSource(doc, doc.length, { collectionNames: [] });
    expect(result).not.toBeNull();
    if (!result || result instanceof Promise) return;
    const labels = result.options.map((o) => o.label);
    expect(labels).not.toContain("getSiblingDB");
    expect(labels).not.toContain("watch");
    expect(labels).not.toContain("eval");
    expect(labels).not.toContain("auth");
    expect(labels).not.toContain("logout");
  });
});

describe("createMongoAdminCommandSource — sprint-381 admin command literal", () => {
  function runAdminSource(doc: string, pos: number) {
    const state = EditorState.create({
      doc,
      extensions: [jsonLanguage()],
    });
    const context = new CompletionContext(state, pos, /* explicit */ true);
    const source = createMongoAdminCommandSource();
    return source(context);
  }

  it("surfaces admin command literals after `db.runCommand({`", () => {
    const doc = "db.runCommand({";
    const result = runAdminSource(doc, doc.length);
    expect(result).not.toBeNull();
    if (!result || result instanceof Promise) return;
    const labels = result.options.map((o) => o.label);
    expect(labels).toContain("serverStatus");
    expect(labels).toContain("dbStats");
    expect(labels).toContain("ping");
  });

  it("surfaces admin command literals after `db.adminCommand({se`", () => {
    const doc = "db.adminCommand({se";
    const result = runAdminSource(doc, doc.length);
    expect(result).not.toBeNull();
    if (!result || result instanceof Promise) return;
    const labels = result.options.map((o) => o.label);
    // CodeMirror filters by the prefix; we only assert the candidate set
    // is unrestricted at the *source* level (`serverStatus` is a member).
    expect(labels).toContain("serverStatus");
  });

  it("returns null inside an unrelated JSON body", () => {
    const doc = "db.users.find({";
    const result = runAdminSource(doc, doc.length);
    expect(result).toBeNull();
  });
});
