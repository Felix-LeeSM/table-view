import {
  snippetCompletion,
  type Completion,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import type {
  SearchCatalogSummary,
  SearchIndexMapping,
  SearchMappingField,
  SearchProductKind,
} from "@/types/search";

export interface SearchDslCompletionSourceOptions {
  readonly catalog?: SearchCatalogSummary | null;
  readonly mapping?: SearchIndexMapping | null;
  readonly target?: SearchProductKind;
}

type SearchCompletionPosition =
  | "target-value"
  | "field-value"
  | "field-key"
  | "query-clause"
  | "aggregation-kind"
  | "body-key";

const SEARCH_QUERY_SNIPPETS = [
  {
    label: "match_all",
    type: "keyword",
    detail: "query clause",
    snippet: 'match_all": {}',
    info: "Supported by the bounded Search DSL validator.",
  },
  {
    label: "term",
    type: "keyword",
    detail: "query clause",
    snippet: 'term": { "${field}": "${value}" }',
    info: "Exact-value query against one field.",
  },
  {
    label: "terms",
    type: "keyword",
    detail: "query clause",
    snippet: 'terms": { "${field}": [${value}] }',
    info: "Exact-value query against a bounded scalar array.",
  },
  {
    label: "match",
    type: "keyword",
    detail: "query clause",
    snippet: 'match": { "${field}": "${query}" }',
    info: "Text match query against one field.",
  },
  {
    label: "range",
    type: "keyword",
    detail: "query clause",
    snippet: 'range": { "${field}": { "gte": ${value} } }',
    info: "Range query with supported gt/gte/lt/lte bounds.",
  },
  {
    label: "exists",
    type: "keyword",
    detail: "query clause",
    snippet: 'exists": { "field": "${field}" }',
    info: "Field-existence query.",
  },
  {
    label: "bool",
    type: "keyword",
    detail: "query clause",
    snippet: 'bool": { "filter": [{ "${clause}": {} }] }',
    info: "Bool query with supported must/filter/should/must_not clauses.",
  },
] as const;

const SEARCH_AGGREGATION_SNIPPETS = [
  {
    label: "terms",
    type: "function",
    detail: "aggregation",
    snippet: 'terms": { "field": "${field}", "size": 10 }',
    info: "Terms aggregation with a bounded size option.",
  },
  {
    label: "value_count",
    type: "function",
    detail: "aggregation",
    snippet: 'value_count": { "field": "${field}" }',
    info: "Value-count aggregation over one field.",
  },
] as const;

const SEARCH_BODY_SNIPPETS = [
  {
    label: "query",
    type: "property",
    detail: "request body",
    snippet: 'query": { "match_all": {} }',
    info: "Search query clause.",
  },
  {
    label: "aggs",
    type: "property",
    detail: "request body",
    snippet: 'aggs": { "${name}": { "terms": { "field": "${field}" } } }',
    info: "Supported terms/value_count aggregation container.",
  },
  {
    label: "from",
    type: "property",
    detail: "pagination",
    snippet: 'from": 0',
    info: "Unsigned offset accepted by the bounded validator.",
  },
  {
    label: "size",
    type: "property",
    detail: "pagination",
    snippet: 'size": 10',
    info: "Unsigned result size accepted by the bounded validator.",
  },
  {
    label: "track_total_hits",
    type: "property",
    detail: "hit count",
    snippet: 'track_total_hits": true',
    info: "Boolean or unsigned hit-count request.",
  },
  {
    label: "sort",
    type: "property",
    detail: "sort",
    snippet: 'sort": [{ "${field}": "desc" }]',
    info: "Supported bounded field sort request.",
  },
  {
    label: "_source",
    type: "property",
    detail: "source filter",
    snippet: '_source": ["${field}"]',
    info: "Supported boolean or field-list source filter.",
  },
] as const;

export function createSearchDslCompletionSource(
  options: SearchDslCompletionSourceOptions = {},
): CompletionSource {
  const target = options.target ?? "elasticsearch";
  return (context) => {
    if (target !== "elasticsearch") return null;

    const quoted = context.matchBefore(/"[A-Za-z0-9_@.$*-]*/);
    if (!quoted) return null;
    const prefix = quoted.text.slice(1);
    if (!context.explicit && prefix.length === 0) return null;

    const beforeQuote = context.state.sliceDoc(0, quoted.from);
    const position = classifySearchCompletionPosition(beforeQuote);
    if (!position) return null;

    const from = quoted.from + 1;
    const optionsForPosition = completionsForPosition(position, options).filter(
      (candidate) => candidate.label.startsWith(prefix),
    );
    if (optionsForPosition.length === 0) return null;

    return {
      from,
      options: optionsForPosition,
      validFor: /^[A-Za-z0-9_@.$*-]*$/,
    } satisfies CompletionResult;
  };
}

export function readSearchDslTarget(
  queryText: string,
  catalog?: SearchCatalogSummary | null,
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(queryText);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || typeof parsed.index !== "string") return null;
  const target = parsed.index.trim();
  if (!target) return null;
  const alias = catalog?.aliases.find((item) => item.name === target);
  if (alias) return alias.index;
  const index = catalog?.indexes.find((item) => item.name === target);
  if (index) return index.name;
  const dataStream = catalog?.dataStreams.find((item) => item.name === target);
  if (dataStream) return dataStream.name;
  return target;
}

function classifySearchCompletionPosition(
  beforeQuote: string,
): SearchCompletionPosition | null {
  const tail = beforeQuote.slice(-500);
  if (/"index"\s*:\s*$/.test(tail)) return "target-value";
  if (/"field"\s*:\s*$/.test(tail)) return "field-value";
  if (/"(?:term|terms|match|range)"\s*:\s*\{\s*$/.test(tail)) {
    return "field-key";
  }
  if (
    /"(?:aggs|aggregations)"\s*:\s*\{[\s\S]*"[^"]+"\s*:\s*\{\s*$/.test(tail)
  ) {
    return "aggregation-kind";
  }
  if (/"query"\s*:\s*\{\s*$/.test(tail)) return "query-clause";
  if (/"body"\s*:\s*\{[\s\S]*$/.test(tail)) return "body-key";
  return null;
}

function completionsForPosition(
  position: SearchCompletionPosition,
  options: SearchDslCompletionSourceOptions,
): Completion[] {
  switch (position) {
    case "target-value":
      return targetCompletions(options.catalog);
    case "field-value":
      return fieldCompletions(options.mapping, "value");
    case "field-key":
      return fieldCompletions(options.mapping, "key");
    case "query-clause":
      return SEARCH_QUERY_SNIPPETS.map(toSnippetCompletion);
    case "aggregation-kind":
      return SEARCH_AGGREGATION_SNIPPETS.map(toSnippetCompletion);
    case "body-key":
      return SEARCH_BODY_SNIPPETS.map(toSnippetCompletion);
  }
}

function targetCompletions(
  catalog?: SearchCatalogSummary | null,
): Completion[] {
  if (!catalog) return [];
  return [
    ...catalog.indexes.map((item) => ({
      label: item.name,
      apply: `${item.name}"`,
      type: "constant",
      detail: item.open ? "index" : "closed index",
      info: `Elasticsearch index${item.aliases.length > 0 ? `; aliases: ${item.aliases.join(", ")}` : ""}`,
      boost: 30,
    })),
    ...catalog.aliases.map((item) => ({
      label: item.name,
      apply: `${item.name}"`,
      type: "constant",
      detail: `alias -> ${item.index}`,
      info: item.writeIndex ? "Write alias" : "Read alias",
      boost: 20,
    })),
    ...catalog.dataStreams.map((item) => ({
      label: item.name,
      apply: `${item.name}"`,
      type: "constant",
      detail: "data stream",
      info: `${item.backingIndices.length} backing index${item.backingIndices.length === 1 ? "" : "es"}`,
      boost: 10,
    })),
  ];
}

function fieldCompletions(
  mapping: SearchIndexMapping | null | undefined,
  mode: "key" | "value",
): Completion[] {
  if (!mapping) return [];
  return mapping.fields.map((field) => fieldCompletion(field, mode));
}

function fieldCompletion(
  field: SearchMappingField,
  mode: "key" | "value",
): Completion {
  const info = [
    field.searchable ? "searchable" : "not searchable",
    field.aggregatable ? "aggregatable" : "not aggregatable",
    field.analyzer ? `analyzer: ${field.analyzer}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  if (mode === "key") {
    return snippetCompletion(`${field.path}": \${value}`, {
      label: field.path,
      type: "property",
      detail: field.fieldType,
      info,
      boost: field.aggregatable ? 25 : 15,
    });
  }
  return {
    label: field.path,
    apply: `${field.path}"`,
    type: "variable",
    detail: field.fieldType,
    info,
    boost: field.aggregatable ? 25 : 15,
  };
}

function toSnippetCompletion(spec: {
  readonly label: string;
  readonly snippet: string;
  readonly type: string;
  readonly detail: string;
  readonly info: string;
}): Completion {
  return snippetCompletion(spec.snippet, {
    label: spec.label,
    type: spec.type,
    detail: spec.detail,
    info: spec.info,
    boost: spec.label === "_source" || spec.label === "sort" ? 20 : 10,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
