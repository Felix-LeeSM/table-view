import { describe, expect, it } from "vitest";
import type { DocumentQueryResult } from "./document";
import { getDataSourceProfile } from "./dataSource";
import { RUNTIME_RDBMS_DATABASE_TYPES } from "./rdbmsDataSources";
import {
  createDocumentResultEnvelope,
  createSearchHitsResultEnvelope,
  createTabularResultEnvelope,
  requireCompatibleQueryResult,
  toCompatibleQueryResult,
  type OpaqueResultEnvelope,
  type QueryResult,
} from "./query";
import type { SearchResultEnvelope } from "./search";

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

const searchResult: SearchResultEnvelope = {
  tookMs: 3,
  timedOut: false,
  total: { value: 1, relation: "eq" },
  hits: [
    {
      index: "logs-2026.05.24",
      id: "doc-1",
      score: 1,
      source: { message: "fixture log", status: "ok" },
      sort: [],
    },
  ],
  aggregations: [
    {
      name: "by_status",
      kind: "terms",
      buckets: [{ key: "ok", docCount: 1 }],
    },
  ],
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
        resultUnit: "document",
        // Issue #1231 — the document conversion now carries the truncation flag.
        truncated: false,
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

  it("throws a visible error when callers require a grid projection for unsupported envelopes", () => {
    const envelope: OpaqueResultEnvelope = {
      kind: "metrics",
      payload: { scanned: 42 },
    };

    expect(() => requireCompatibleQueryResult(envelope)).toThrow(
      "Result envelope kind 'metrics' does not have a QueryResult compatibility projection.",
    );
  });

  it("keeps Search DSL hits on a typed renderer path instead of projecting to QueryResultGrid", () => {
    const envelope = createSearchHitsResultEnvelope(searchResult);

    expect(envelope.kind).toBe("searchHits");
    expect(envelope.searchResult.hits[0]?.source).toEqual(
      searchResult.hits[0]?.source,
    );
    expect(toCompatibleQueryResult(envelope)).toEqual({
      ok: false,
      error: {
        kind: "unsupported-envelope-kind",
        envelopeKind: "searchHits",
        message:
          "Search hit envelopes require the search result renderer and cannot be projected into QueryResultGrid.",
      },
    });
  });

  it("keeps current source profile result kinds compatible with the legacy renderer boundary", () => {
    for (const dbType of RUNTIME_RDBMS_DATABASE_TYPES) {
      const profile = getDataSourceProfile(dbType);

      expect(profile.resultKinds).toEqual(["tabular"]);
      expect(
        toCompatibleQueryResult(createTabularResultEnvelope(tabularResult)),
      ).toEqual({
        ok: true,
        queryResult: tabularResult,
      });
    }

    const mongo = getDataSourceProfile("mongodb");
    expect(mongo.resultKinds).toEqual(["document", "tabular"]);
    expect(
      toCompatibleQueryResult(createDocumentResultEnvelope(documentResult)).ok,
    ).toBe(true);
    expect(
      toCompatibleQueryResult(createTabularResultEnvelope(tabularResult)),
    ).toEqual({
      ok: true,
      queryResult: tabularResult,
    });
  });

  it("keeps Redis typed result kinds out of QueryResultGrid compatibility projection", () => {
    const redis = getDataSourceProfile("redis");
    expect(redis.resultKinds).toEqual(["keyValue", "streamRecords", "tabular"]);

    for (const kind of ["keyValue", "streamRecords"] as const) {
      const envelope: OpaqueResultEnvelope = {
        kind,
        payload: { sample: true },
      };

      expect(toCompatibleQueryResult(envelope)).toEqual({
        ok: false,
        error: {
          kind: "unsupported-envelope-kind",
          envelopeKind: kind,
          message: `Result envelope kind '${kind}' does not have a QueryResult compatibility projection.`,
        },
      });
    }

    for (const dbType of ["elasticsearch", "opensearch"] as const) {
      const profile = getDataSourceProfile(dbType);

      expect(profile.resultKinds).toEqual(["searchHits"]);
      expect(
        toCompatibleQueryResult(createSearchHitsResultEnvelope(searchResult)),
      ).toEqual({
        ok: false,
        error: {
          kind: "unsupported-envelope-kind",
          envelopeKind: "searchHits",
          message:
            "Search hit envelopes require the search result renderer and cannot be projected into QueryResultGrid.",
        },
      });
    }
  });
});
