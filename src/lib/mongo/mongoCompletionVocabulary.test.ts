import { describe, expect, it } from "vitest";
import {
  getMongoshCompletionVocabulary,
  type MongoshCompletionVocabulary,
} from "./mongoshAst/index";
import {
  getMongoCompletionVocabulary,
  MONGO_ACCUMULATORS,
  MONGO_AGGREGATE_STAGES,
  MONGO_ALL_OPERATORS,
  MONGO_EXPRESSION_OPERATORS,
  MONGO_PROJECTION_OPERATORS,
  MONGO_QUERY_OPERATORS,
  MONGO_TYPE_TAGS,
  MONGO_UPDATE_OPERATORS,
} from "./mongoCompletionVocabulary";
import {
  MONGO_ADMIN_COMMANDS,
  MONGOSH_DB_LEVEL_METHODS,
  MONGOSH_DB_METHODS,
} from "./mongoShellCompletionVocabulary";
import { MONGOSH_METHOD_WHITELIST } from "./mongoshMethods";

function loadedRustVocabulary(): MongoshCompletionVocabulary {
  const vocabulary = getMongoshCompletionVocabulary();
  if (vocabulary === null) {
    throw new Error("mongosh WASM vocabulary was not loaded by test setup");
  }
  return vocabulary;
}

function expectContainsAll(
  values: readonly string[],
  expected: readonly string[],
): void {
  for (const value of expected) {
    expect(values).toContain(value);
  }
}

describe("MongoDB completion vocabulary", () => {
  it("keeps the TypeScript fallback mirror aligned with Rust/WASM", () => {
    const rustVocabulary = loadedRustVocabulary();

    expect(rustVocabulary.queryOperators).toEqual(MONGO_QUERY_OPERATORS);
    expect(rustVocabulary.projectionOperators).toEqual(
      MONGO_PROJECTION_OPERATORS,
    );
    expect(rustVocabulary.updateOperators).toEqual(MONGO_UPDATE_OPERATORS);
    expect(rustVocabulary.aggregateStages).toEqual(MONGO_AGGREGATE_STAGES);
    expect(rustVocabulary.accumulators).toEqual(MONGO_ACCUMULATORS);
    expect(rustVocabulary.expressionOperators).toEqual(
      MONGO_EXPRESSION_OPERATORS,
    );
    expect(rustVocabulary.typeTags).toEqual(MONGO_TYPE_TAGS);
    expect(rustVocabulary.allOperators).toEqual(MONGO_ALL_OPERATORS);
    expect(rustVocabulary.mongoshCollectionMethods).toEqual(
      MONGOSH_DB_METHODS.map((method) => method.label),
    );
    expect(rustVocabulary.mongoshCollectionMethods).toEqual(
      MONGOSH_METHOD_WHITELIST,
    );
    expect(rustVocabulary.mongoshDbMethods).toEqual(
      MONGOSH_DB_LEVEL_METHODS.map((method) => method.label),
    );
    expect(rustVocabulary.mongoAdminCommands).toEqual(
      MONGO_ADMIN_COMMANDS.map((command) => command.label),
    );
    expect(getMongoCompletionVocabulary()).toEqual(rustVocabulary);
  });

  it("covers official-reference sentinel operators, methods, and commands", () => {
    const vocabulary = getMongoCompletionVocabulary();

    expectContainsAll(vocabulary.queryOperators, [
      "$jsonSchema",
      "$bitsAllSet",
      "$geoWithin",
      "$expr",
    ]);
    expectContainsAll(vocabulary.projectionOperators, ["$meta", "$slice"]);
    expectContainsAll(vocabulary.updateOperators, [
      "$setOnInsert",
      "$[]",
      "$[<identifier>]",
    ]);
    expectContainsAll(vocabulary.aggregateStages, [
      "$vectorSearch",
      "$setWindowFields",
      "$queryStats",
      "$searchMeta",
    ]);
    expectContainsAll(vocabulary.accumulators, [
      "$topN",
      "$median",
      "$percentile",
    ]);
    expectContainsAll(vocabulary.expressionOperators, [
      "$dateTrunc",
      "$toObjectId",
      "$regexFindAll",
      "$setField",
    ]);
    expectContainsAll(vocabulary.typeTags, ["$uuid"]);
    expectContainsAll(vocabulary.mongoshCollectionMethods, ["find"]);
    expectContainsAll(vocabulary.mongoshDbMethods, ["runCommand"]);
    expectContainsAll(vocabulary.mongoAdminCommands, ["serverStatus", "hello"]);
  });
});
