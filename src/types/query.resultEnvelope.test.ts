import { describe, expect, it } from "vitest";
import type { ResultEnvelopeKind } from "./dataSource";
import type { DocumentQueryResult } from "./document";
import * as queryTypes from "./query";
import type { QueryResult } from "./query";

type CompatibilityResult =
  | { ok: true; queryResult: QueryResult }
  | {
      ok: false;
      error: {
        kind: string;
        envelopeKind?: ResultEnvelopeKind;
        message: string;
      };
    };

type QueryResultEnvelopeApi = typeof queryTypes & {
  createTabularResultEnvelope?: (result: QueryResult) => {
    kind: ResultEnvelopeKind;
    queryResult: QueryResult;
  };
  createDocumentResultEnvelope?: (result: DocumentQueryResult) => {
    kind: ResultEnvelopeKind;
  };
  toCompatibleQueryResult?: (envelope: unknown) => CompatibilityResult;
};

const subject = queryTypes as QueryResultEnvelopeApi;

const tabularResult: QueryResult = {
  columns: [{ name: "id", dataType: "integer", category: "int" }],
  rows: [[1]],
  totalCount: 1,
  executionTimeMs: 12,
  queryType: "select",
};

const documentResult: DocumentQueryResult = {
  columns: [
    { name: "_id", dataType: "ObjectId", category: "text" },
    { name: "name", dataType: "String", category: "text" },
  ],
  rows: [["507f1f77bcf86cd799439011", "Alice"]],
  rawDocuments: [{ _id: "507f1f77bcf86cd799439011", name: "Alice" }],
  totalCount: 1,
  executionTimeMs: 8,
};

function requireCreateTabularResultEnvelope(
  api: QueryResultEnvelopeApi,
): NonNullable<QueryResultEnvelopeApi["createTabularResultEnvelope"]> {
  expect(api.createTabularResultEnvelope).toBeTypeOf("function");
  if (typeof api.createTabularResultEnvelope !== "function") {
    throw new Error("createTabularResultEnvelope is missing");
  }
  return api.createTabularResultEnvelope;
}

function requireCreateDocumentResultEnvelope(
  api: QueryResultEnvelopeApi,
): NonNullable<QueryResultEnvelopeApi["createDocumentResultEnvelope"]> {
  expect(api.createDocumentResultEnvelope).toBeTypeOf("function");
  if (typeof api.createDocumentResultEnvelope !== "function") {
    throw new Error("createDocumentResultEnvelope is missing");
  }
  return api.createDocumentResultEnvelope;
}

function requireToCompatibleQueryResult(
  api: QueryResultEnvelopeApi,
): NonNullable<QueryResultEnvelopeApi["toCompatibleQueryResult"]> {
  expect(api.toCompatibleQueryResult).toBeTypeOf("function");
  if (typeof api.toCompatibleQueryResult !== "function") {
    throw new Error("toCompatibleQueryResult is missing");
  }
  return api.toCompatibleQueryResult;
}

describe("result envelope compatibility layer", () => {
  it("wraps current RDBMS QueryResult output as a tabular envelope without changing renderer shape", () => {
    const createTabularResultEnvelope =
      requireCreateTabularResultEnvelope(subject);
    const toCompatibleQueryResult = requireToCompatibleQueryResult(subject);

    const envelope = createTabularResultEnvelope(tabularResult);
    const converted = toCompatibleQueryResult(envelope);

    expect(envelope.kind).toBe("tabular");
    expect(converted).toEqual({ ok: true, queryResult: tabularResult });
  });

  it("projects MongoDB document results back to the existing QueryResult grid shape", () => {
    const createDocumentResultEnvelope =
      requireCreateDocumentResultEnvelope(subject);
    const toCompatibleQueryResult = requireToCompatibleQueryResult(subject);

    const envelope = createDocumentResultEnvelope(documentResult);
    const converted = toCompatibleQueryResult(envelope);

    expect(envelope.kind).toBe("document");
    expect(converted).toEqual({
      ok: true,
      queryResult: {
        columns: documentResult.columns,
        rows: documentResult.rows,
        totalCount: documentResult.totalCount,
        executionTimeMs: documentResult.executionTimeMs,
        queryType: "select",
      },
    });
  });

  it("returns a typed failure instead of forcing future envelope kinds through QueryResultGrid", () => {
    const toCompatibleQueryResult = requireToCompatibleQueryResult(subject);

    const converted = toCompatibleQueryResult({
      kind: "metrics",
      payload: { scanned: 42 },
    });

    expect(converted).toEqual({
      ok: false,
      error: {
        kind: "unsupported-envelope-kind",
        envelopeKind: "metrics",
        message:
          "Result envelope kind 'metrics' does not have a QueryResult compatibility projection.",
      },
    });
  });
});
