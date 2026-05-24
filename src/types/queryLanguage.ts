import type { QueryLanguageId } from "./dataSource";

export type QueryLanguageLifecycle = "active" | "deferred";
export type QueryLanguageOwner =
  | "rust-wasm-language-core"
  | "typescript-runtime-adapter"
  | "profile-safety-policy"
  | "future-language-core-contract";
export type QueryLanguageFallbackPolicy =
  | {
      readonly kind: "compatibility-mirror";
      readonly sourceOfTruth: QueryLanguageOwner;
      readonly mirrorOwner: QueryLanguageOwner;
    }
  | {
      readonly kind: "none";
      readonly reason: string;
    }
  | {
      readonly kind: "not-implemented";
      readonly reason: string;
    };

export interface QueryLanguageMetadata {
  readonly id: QueryLanguageId;
  readonly label: string;
  readonly lifecycle: QueryLanguageLifecycle;
  readonly parserOwner: QueryLanguageOwner;
  readonly completionOwner: QueryLanguageOwner;
  readonly fallbackPolicy: QueryLanguageFallbackPolicy;
  readonly safetyAnalyzer: QueryLanguageOwner;
  readonly supportedSyntaxDocs: string;
}

const QUERY_LANGUAGE_SUPPORT_DOCS = "docs/query-language-support.md";

export const QUERY_LANGUAGE_REGISTRY = Object.freeze({
  sql: {
    id: "sql",
    label: "SQL",
    lifecycle: "active",
    parserOwner: "rust-wasm-language-core",
    completionOwner: "rust-wasm-language-core",
    fallbackPolicy: {
      kind: "compatibility-mirror",
      sourceOfTruth: "rust-wasm-language-core",
      mirrorOwner: "typescript-runtime-adapter",
    },
    safetyAnalyzer: "rust-wasm-language-core",
    supportedSyntaxDocs: QUERY_LANGUAGE_SUPPORT_DOCS,
  },
  mongosh: {
    id: "mongosh",
    label: "mongosh/MQL",
    lifecycle: "active",
    parserOwner: "rust-wasm-language-core",
    completionOwner: "rust-wasm-language-core",
    fallbackPolicy: {
      kind: "compatibility-mirror",
      sourceOfTruth: "rust-wasm-language-core",
      mirrorOwner: "typescript-runtime-adapter",
    },
    safetyAnalyzer: "rust-wasm-language-core",
    supportedSyntaxDocs: QUERY_LANGUAGE_SUPPORT_DOCS,
  },
  "redis-command": {
    id: "redis-command",
    label: "Redis command",
    lifecycle: "active",
    parserOwner: "future-language-core-contract",
    completionOwner: "future-language-core-contract",
    fallbackPolicy: {
      kind: "not-implemented",
      reason: "Redis command query execution is not active yet.",
    },
    safetyAnalyzer: "profile-safety-policy",
    supportedSyntaxDocs: QUERY_LANGUAGE_SUPPORT_DOCS,
  },
  "search-dsl": {
    id: "search-dsl",
    label: "Search DSL",
    lifecycle: "active",
    parserOwner: "future-language-core-contract",
    completionOwner: "future-language-core-contract",
    fallbackPolicy: {
      kind: "not-implemented",
      reason: "Search query execution is not active yet.",
    },
    safetyAnalyzer: "profile-safety-policy",
    supportedSyntaxDocs: QUERY_LANGUAGE_SUPPORT_DOCS,
  },
  cql: {
    id: "cql",
    label: "CQL",
    lifecycle: "deferred",
    parserOwner: "future-language-core-contract",
    completionOwner: "future-language-core-contract",
    fallbackPolicy: {
      kind: "not-implemented",
      reason: "Cassandra/Scylla profiles are not active.",
    },
    safetyAnalyzer: "profile-safety-policy",
    supportedSyntaxDocs: QUERY_LANGUAGE_SUPPORT_DOCS,
  },
  partiql: {
    id: "partiql",
    label: "PartiQL",
    lifecycle: "deferred",
    parserOwner: "future-language-core-contract",
    completionOwner: "future-language-core-contract",
    fallbackPolicy: {
      kind: "not-implemented",
      reason: "DynamoDB profiles are not active.",
    },
    safetyAnalyzer: "profile-safety-policy",
    supportedSyntaxDocs: QUERY_LANGUAGE_SUPPORT_DOCS,
  },
  cypher: {
    id: "cypher",
    label: "Cypher",
    lifecycle: "deferred",
    parserOwner: "future-language-core-contract",
    completionOwner: "future-language-core-contract",
    fallbackPolicy: {
      kind: "not-implemented",
      reason: "Graph profiles are not active.",
    },
    safetyAnalyzer: "profile-safety-policy",
    supportedSyntaxDocs: QUERY_LANGUAGE_SUPPORT_DOCS,
  },
  gql: {
    id: "gql",
    label: "GraphQL",
    lifecycle: "deferred",
    parserOwner: "future-language-core-contract",
    completionOwner: "future-language-core-contract",
    fallbackPolicy: {
      kind: "not-implemented",
      reason: "GraphQL profiles are not active.",
    },
    safetyAnalyzer: "profile-safety-policy",
    supportedSyntaxDocs: QUERY_LANGUAGE_SUPPORT_DOCS,
  },
  gremlin: {
    id: "gremlin",
    label: "Gremlin",
    lifecycle: "deferred",
    parserOwner: "future-language-core-contract",
    completionOwner: "future-language-core-contract",
    fallbackPolicy: {
      kind: "not-implemented",
      reason: "Graph profiles are not active.",
    },
    safetyAnalyzer: "profile-safety-policy",
    supportedSyntaxDocs: QUERY_LANGUAGE_SUPPORT_DOCS,
  },
  "vector-query": {
    id: "vector-query",
    label: "Vector query",
    lifecycle: "deferred",
    parserOwner: "future-language-core-contract",
    completionOwner: "future-language-core-contract",
    fallbackPolicy: {
      kind: "not-implemented",
      reason: "Vector profiles are not active.",
    },
    safetyAnalyzer: "profile-safety-policy",
    supportedSyntaxDocs: QUERY_LANGUAGE_SUPPORT_DOCS,
  },
  "stream-command": {
    id: "stream-command",
    label: "Stream command",
    lifecycle: "deferred",
    parserOwner: "future-language-core-contract",
    completionOwner: "future-language-core-contract",
    fallbackPolicy: {
      kind: "not-implemented",
      reason: "Stream profiles are not active.",
    },
    safetyAnalyzer: "profile-safety-policy",
    supportedSyntaxDocs: QUERY_LANGUAGE_SUPPORT_DOCS,
  },
}) satisfies Readonly<Record<QueryLanguageId, QueryLanguageMetadata>>;

export function getActiveQueryLanguages(): readonly QueryLanguageId[] {
  return Object.values(QUERY_LANGUAGE_REGISTRY)
    .filter((metadata) => metadata.lifecycle === "active")
    .map((metadata) => metadata.id);
}

export function getQueryLanguageMetadata(
  id: QueryLanguageId,
): QueryLanguageMetadata {
  return QUERY_LANGUAGE_REGISTRY[id];
}
