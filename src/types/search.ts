export type SearchProductKind = "elasticsearch" | "opensearch";

export interface SearchProductDelta {
  product: SearchProductKind;
  supportsElasticLicenseApi: boolean;
  supportsOpensearchPluginsApi: boolean;
  defaultTemplateEndpoint: "legacyIndexTemplate" | "composableIndexTemplate";
}

export interface SearchClusterIdentity {
  product: SearchProductKind;
  clusterName: string;
  clusterUuid?: string;
  version: {
    number: string;
    distribution?: string;
    lucene?: string;
    buildFlavor?: string;
  };
  capabilities: {
    search: boolean;
    aggregations: boolean;
    aliases: boolean;
    mappings: boolean;
    legacyIndexTemplates: boolean;
    composableIndexTemplates: boolean;
    deleteByQuery: boolean;
  };
  productDelta: SearchProductDelta;
}

export interface SearchIndexInfo {
  name: string;
  uuid?: string;
  health: "green" | "yellow" | "red" | "unknown";
  open: boolean;
  docsCount?: number;
  storeSizeBytes?: number;
  aliases: string[];
  primaryShards?: number;
  replicaShards?: number;
}

export interface SearchDataStreamInfo {
  name: string;
  backingIndices: string[];
  health: "green" | "yellow" | "red" | "unknown";
  docsCount?: number;
  storeSizeBytes?: number;
  primaryShards?: number;
  replicaShards?: number;
  hidden: boolean;
}

export interface SearchAliasInfo {
  name: string;
  index: string;
  filter?: unknown;
  routing?: string;
  writeIndex: boolean;
}

export interface SearchCatalogSummary {
  identity: SearchClusterIdentity;
  indexes: SearchIndexInfo[];
  aliases: SearchAliasInfo[];
  dataStreams: SearchDataStreamInfo[];
}

export interface SearchMappingField {
  path: string;
  fieldType: string;
  searchable: boolean;
  aggregatable: boolean;
  analyzer?: string;
}

export interface SearchIndexMapping {
  index: string;
  fields: SearchMappingField[];
  raw: unknown;
}

export interface SearchIndexTemplateInfo {
  name: string;
  endpoint: "legacyIndexTemplate" | "composableIndexTemplate";
  indexPatterns: string[];
  priority?: number;
  raw: unknown;
}

export interface SearchAnalyzerInfo {
  name: string;
  analyzerType: string;
  tokenizer?: string;
  filters: string[];
}

export interface SearchIndexSettings {
  index: string;
  raw: unknown;
  analyzers: SearchAnalyzerInfo[];
}

export interface SearchFieldStatsInfo {
  path: string;
  fieldType: string;
  searchable: boolean;
  aggregatable: boolean;
  docsCount?: number;
  sampleValues: unknown[];
}

export interface SearchFieldStatsEnvelope {
  index: string;
  fields: SearchFieldStatsInfo[];
}

export interface SearchQueryRequest {
  index: string;
  body: unknown;
  from?: number;
  size?: number;
  trackTotalHits?: boolean;
}

export interface SearchHitEnvelope {
  index: string;
  id: string;
  score?: number;
  source: unknown;
  fields?: unknown;
  highlight?: unknown;
  explanation?: unknown;
  sort: unknown[];
}

export interface SearchTermsBucket {
  key: string;
  docCount: number;
}

export type SearchAggregationEnvelope =
  | SearchTermsAggregationEnvelope
  | SearchValueCountAggregationEnvelope
  | SearchRawAggregationEnvelope;

export interface SearchTermsAggregationEnvelope {
  kind: "terms";
  name: string;
  buckets: SearchTermsBucket[];
}

export interface SearchValueCountAggregationEnvelope {
  kind: "value_count";
  name: string;
  value: number;
}

export interface SearchRawAggregationEnvelope {
  kind: "raw";
  name: string;
  aggregationType?: string;
  raw: unknown;
}

export interface SearchShardFailure {
  shard?: number;
  index?: string;
  node?: string;
  reason: unknown;
}

export interface SearchShardSummary {
  total: number;
  successful: number;
  skipped: number;
  failed: number;
  failures: SearchShardFailure[];
}

export interface SearchResultEnvelope {
  tookMs: number;
  timedOut: boolean;
  total: {
    value: number;
    relation: "eq" | "gte";
  };
  hits: SearchHitEnvelope[];
  aggregations: SearchAggregationEnvelope[];
  shards?: SearchShardSummary;
  explain?: unknown;
  profile?: unknown;
}
