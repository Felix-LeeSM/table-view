import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { json as jsonLanguage } from "@codemirror/lang-json";
import {
  MONGO_ACCUMULATORS,
  MONGO_AGGREGATE_STAGES,
  MONGO_ALL_OPERATORS,
  MONGO_QUERY_OPERATORS,
  MONGO_TYPE_TAGS,
  createMongoCompletionSource,
  createMongoOperatorHighlight,
  type MongoQueryMode,
} from "./mongoAutocomplete";

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
  it("MONGO_QUERY_OPERATORS enumerates the 18 filter operators", () => {
    expect(MONGO_QUERY_OPERATORS).toContain("$eq");
    expect(MONGO_QUERY_OPERATORS).toContain("$ne");
    expect(MONGO_QUERY_OPERATORS).toContain("$gt");
    expect(MONGO_QUERY_OPERATORS).toContain("$gte");
    expect(MONGO_QUERY_OPERATORS).toContain("$lt");
    expect(MONGO_QUERY_OPERATORS).toContain("$lte");
    expect(MONGO_QUERY_OPERATORS).toContain("$in");
    expect(MONGO_QUERY_OPERATORS).toContain("$nin");
    expect(MONGO_QUERY_OPERATORS).toContain("$and");
    expect(MONGO_QUERY_OPERATORS).toContain("$or");
    expect(MONGO_QUERY_OPERATORS).toContain("$nor");
    expect(MONGO_QUERY_OPERATORS).toContain("$not");
    expect(MONGO_QUERY_OPERATORS).toContain("$exists");
    expect(MONGO_QUERY_OPERATORS).toContain("$type");
    expect(MONGO_QUERY_OPERATORS).toContain("$regex");
    expect(MONGO_QUERY_OPERATORS).toContain("$elemMatch");
    expect(MONGO_QUERY_OPERATORS).toContain("$size");
    expect(MONGO_QUERY_OPERATORS).toContain("$all");
    expect(MONGO_QUERY_OPERATORS.length).toBe(18);
  });

  it("MONGO_AGGREGATE_STAGES enumerates the core pipeline stages", () => {
    expect(MONGO_AGGREGATE_STAGES).toContain("$match");
    expect(MONGO_AGGREGATE_STAGES).toContain("$project");
    expect(MONGO_AGGREGATE_STAGES).toContain("$group");
    expect(MONGO_AGGREGATE_STAGES).toContain("$sort");
    expect(MONGO_AGGREGATE_STAGES).toContain("$limit");
    expect(MONGO_AGGREGATE_STAGES).toContain("$skip");
    expect(MONGO_AGGREGATE_STAGES).toContain("$unwind");
    expect(MONGO_AGGREGATE_STAGES).toContain("$lookup");
    expect(MONGO_AGGREGATE_STAGES).toContain("$count");
    expect(MONGO_AGGREGATE_STAGES).toContain("$addFields");
    expect(MONGO_AGGREGATE_STAGES).toContain("$replaceRoot");
    expect(MONGO_AGGREGATE_STAGES).toContain("$facet");
    expect(MONGO_AGGREGATE_STAGES).toContain("$out");
    expect(MONGO_AGGREGATE_STAGES).toContain("$merge");
    expect(MONGO_AGGREGATE_STAGES.length).toBe(14);
  });

  it("MONGO_ACCUMULATORS enumerates the standard group accumulators", () => {
    expect(MONGO_ACCUMULATORS).toContain("$sum");
    expect(MONGO_ACCUMULATORS).toContain("$avg");
    expect(MONGO_ACCUMULATORS).toContain("$min");
    expect(MONGO_ACCUMULATORS).toContain("$max");
    expect(MONGO_ACCUMULATORS).toContain("$push");
    expect(MONGO_ACCUMULATORS).toContain("$addToSet");
    expect(MONGO_ACCUMULATORS).toContain("$first");
    expect(MONGO_ACCUMULATORS).toContain("$last");
    expect(MONGO_ACCUMULATORS).toContain("$count");
    expect(MONGO_ACCUMULATORS.length).toBe(9);
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
    expect(MONGO_TYPE_TAGS.length).toBe(13);
  });

  it("MONGO_ALL_OPERATORS is the union of every operator list", () => {
    const expected = new Set([
      ...MONGO_QUERY_OPERATORS,
      ...MONGO_AGGREGATE_STAGES,
      ...MONGO_ACCUMULATORS,
      ...MONGO_TYPE_TAGS,
    ]);
    const actual = new Set(MONGO_ALL_OPERATORS);
    expect(actual).toEqual(expected);
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
