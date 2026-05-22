import { describe, expect, it } from "vitest";
import type { DocumentQueryResult } from "./document";
import {
  createDocumentResultEnvelope,
  createTabularResultEnvelope,
  toCompatibleQueryResult,
  type OpaqueResultEnvelope,
  type QueryResult,
} from "./query";

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

describe("result envelope compatibility layer", () => {
  it("wraps current RDBMS QueryResult output as a tabular envelope without changing renderer shape", () => {
    const envelope = createTabularResultEnvelope(tabularResult);
    const converted = toCompatibleQueryResult(envelope);

    expect(envelope.kind).toBe("tabular");
    expect(converted).toEqual({ ok: true, queryResult: tabularResult });
    expect(converted.ok && converted.queryResult).toBe(tabularResult);
  });

  it("projects MongoDB document results back to the existing QueryResult grid shape", () => {
    const envelope = createDocumentResultEnvelope(documentResult);
    const converted = toCompatibleQueryResult(envelope);

    expect(envelope.kind).toBe("document");
    expect(envelope.documentResult.rawDocuments).toEqual(
      documentResult.rawDocuments,
    );
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
    expect(converted.ok && "rawDocuments" in converted.queryResult).toBe(false);
  });

  it("returns a typed failure instead of forcing future envelope kinds through QueryResultGrid", () => {
    const envelope: OpaqueResultEnvelope = {
      kind: "metrics",
      payload: { scanned: 42 },
    };

    expect(toCompatibleQueryResult(envelope)).toEqual({
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
