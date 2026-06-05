import { CompletionContext } from "@codemirror/autocomplete";
import type { CompletionResult } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import type {
  SearchCatalogSummary,
  SearchIndexMapping,
  SearchProductKind,
} from "@/types/search";
import {
  createSearchDslCompletionSource,
  readSearchDslTarget,
} from "./searchDslCompletion";

const catalog = {
  identity: {
    product: "elasticsearch",
    clusterName: "elastic-dev",
    version: { number: "8.12.2", distribution: "elasticsearch" },
    capabilities: {
      search: true,
      aggregations: true,
      aliases: true,
      mappings: true,
      legacyIndexTemplates: true,
      composableIndexTemplates: true,
      deleteByQuery: true,
    },
    productDelta: {
      product: "elasticsearch",
      supportsElasticLicenseApi: true,
      supportsOpensearchPluginsApi: false,
      defaultTemplateEndpoint: "composableIndexTemplate",
    },
  },
  indexes: [
    {
      name: "logs-elastic-2026.05.24",
      health: "green",
      open: true,
      aliases: ["logs-elastic"],
    },
  ],
  aliases: [
    {
      name: "logs-elastic",
      index: "logs-elastic-2026.05.24",
      writeIndex: true,
    },
  ],
  dataStreams: [
    {
      name: "logs-elastic-default",
      backingIndices: [".ds-logs-elastic-default-2026.05.24-000001"],
      health: "green",
      hidden: false,
    },
  ],
} as const satisfies SearchCatalogSummary;

const mapping = {
  index: "logs-elastic-2026.05.24",
  fields: [
    {
      path: "@timestamp",
      fieldType: "date",
      searchable: true,
      aggregatable: true,
    },
    {
      path: "message",
      fieldType: "text",
      searchable: true,
      aggregatable: false,
      analyzer: "standard",
    },
    {
      path: "status.keyword",
      fieldType: "keyword",
      searchable: true,
      aggregatable: true,
    },
  ],
  raw: {},
} as const satisfies SearchIndexMapping;

const opensearchCatalog = {
  identity: {
    product: "opensearch",
    clusterName: "open-dev",
    version: { number: "2.13.0", distribution: "opensearch" },
    capabilities: {
      search: true,
      aggregations: true,
      aliases: true,
      mappings: true,
      legacyIndexTemplates: true,
      composableIndexTemplates: true,
      deleteByQuery: true,
    },
    productDelta: {
      product: "opensearch",
      supportsElasticLicenseApi: false,
      supportsOpensearchPluginsApi: true,
      defaultTemplateEndpoint: "composableIndexTemplate",
    },
  },
  indexes: [
    {
      name: "logs-opensearch-2026.05.24",
      health: "green",
      open: true,
      aliases: ["logs-opensearch"],
    },
  ],
  aliases: [
    {
      name: "logs-opensearch",
      index: "logs-opensearch-2026.05.24",
      writeIndex: true,
    },
  ],
  dataStreams: [
    {
      name: "logs-opensearch-default",
      backingIndices: [".ds-logs-opensearch-default-2026.05.24-000001"],
      health: "green",
      hidden: false,
    },
  ],
} as const satisfies SearchCatalogSummary;

const opensearchMapping = {
  index: "logs-opensearch-2026.05.24",
  fields: [
    {
      path: "@timestamp",
      fieldType: "date",
      searchable: true,
      aggregatable: true,
    },
    {
      path: "trace.id",
      fieldType: "keyword",
      searchable: true,
      aggregatable: true,
    },
    {
      path: "message",
      fieldType: "text",
      searchable: true,
      aggregatable: false,
      analyzer: "standard",
    },
  ],
  raw: {},
} as const satisfies SearchIndexMapping;

function runSource(
  doc: string,
  target: SearchProductKind = "elasticsearch",
  catalogContext: SearchCatalogSummary = catalog,
  mappingContext: SearchIndexMapping = mapping,
): CompletionResult | null {
  const state = EditorState.create({ doc });
  const source = createSearchDslCompletionSource({
    catalog: catalogContext,
    mapping: mappingContext,
    target,
  });
  const result = source(new CompletionContext(state, doc.length, true));
  if (result instanceof Promise) {
    throw new Error("Search DSL completion source must be synchronous");
  }
  return result;
}

function labels(result: CompletionResult | null): string[] {
  return result?.options.map((option) => option.label) ?? [];
}

describe("search DSL completion", () => {
  it("suggests indexes, aliases, and data streams from the live catalog context", () => {
    expect(labels(runSource('{ "index": "logs'))).toEqual([
      "logs-elastic-2026.05.24",
      "logs-elastic",
      "logs-elastic-default",
    ]);
  });

  it("suggests mapping fields for field values and single-field query keys", () => {
    expect(
      labels(runSource('{ "body": { "query": { "exists": { "field": "status')),
    ).toEqual(["status.keyword"]);
    expect(labels(runSource('{ "body": { "query": { "term": { "mess'))).toEqual(
      ["message"],
    );
  });

  it("surfaces mapping field types on field suggestions", () => {
    const result = runSource(
      '{ "body": { "query": { "exists": { "field": "status',
    );
    expect(result?.options[0]).toMatchObject({
      label: "status.keyword",
      detail: "keyword",
    });
  });

  it("surfaces bounded query, aggregation, sort, and source snippets", () => {
    expect(labels(runSource('{ "body": { "query": { "ma'))).toContain("match");
    expect(
      labels(runSource('{ "body": { "aggs": { "by_status": { "te')),
    ).toContain("terms");
    expect(labels(runSource('{ "body": { "so'))).toContain("sort");
    expect(labels(runSource('{ "body": { "_s'))).toContain("_source");
  });

  it("suggests OpenSearch indexes, aliases, data streams, fields, and field types from OpenSearch catalog context", () => {
    expect(
      labels(
        runSource(
          '{ "index": "logs',
          "opensearch",
          opensearchCatalog,
          opensearchMapping,
        ),
      ),
    ).toEqual([
      "logs-opensearch-2026.05.24",
      "logs-opensearch",
      "logs-opensearch-default",
    ]);

    const result = runSource(
      '{ "body": { "query": { "exists": { "field": "trace',
      "opensearch",
      opensearchCatalog,
      opensearchMapping,
    );
    expect(result?.options[0]).toMatchObject({
      label: "trace.id",
      detail: "keyword",
    });
    expect(
      labels(
        runSource(
          '{ "body": { "sort": [{ "tr',
          "opensearch",
          opensearchCatalog,
          opensearchMapping,
        ),
      ),
    ).toEqual(["trace.id"]);
    expect(
      labels(
        runSource(
          '{ "body": { "_source": ["mess',
          "opensearch",
          opensearchCatalog,
          opensearchMapping,
        ),
      ),
    ).toEqual(["message"]);
  });

  it("uses shared bounded query, aggregation, sort, and source snippets for OpenSearch", () => {
    expect(
      labels(
        runSource(
          '{ "body": { "query": { "ma',
          "opensearch",
          opensearchCatalog,
          opensearchMapping,
        ),
      ),
    ).toContain("match");
    expect(
      labels(
        runSource(
          '{ "body": { "aggs": { "by_trace": { "te',
          "opensearch",
          opensearchCatalog,
          opensearchMapping,
        ),
      ),
    ).toContain("terms");
    expect(
      labels(
        runSource(
          '{ "body": { "so',
          "opensearch",
          opensearchCatalog,
          opensearchMapping,
        ),
      ),
    ).toContain("sort");
    expect(
      labels(
        runSource(
          '{ "body": { "_s',
          "opensearch",
          opensearchCatalog,
          opensearchMapping,
        ),
      ),
    ).toContain("_source");
  });

  it("keeps Elasticsearch and OpenSearch catalog identities separated", () => {
    expect(labels(runSource('{ "index": "logs', "opensearch"))).toEqual([]);
    expect(
      labels(
        runSource(
          '{ "index": "logs',
          "elasticsearch",
          opensearchCatalog,
          opensearchMapping,
        ),
      ),
    ).toEqual([]);
  });

  it("reads the active Search index target from the JSON request", () => {
    expect(
      readSearchDslTarget(
        JSON.stringify({
          index: "logs-elastic",
          body: { query: { match_all: {} } },
        }),
        catalog,
      ),
    ).toBe("logs-elastic-2026.05.24");
  });
});
