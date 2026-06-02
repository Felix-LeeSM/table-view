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
}

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
  },
  "redis-command": {
    id: "redis-command",
    label: "Redis command",
    lifecycle: "active",
    parserOwner: "future-language-core-contract",
    completionOwner: "typescript-runtime-adapter",
    fallbackPolicy: {
      kind: "none",
      reason:
        "Redis command runtime and TypeScript completion use a bounded allowlist; full language-core parsing remains future work.",
    },
    safetyAnalyzer: "profile-safety-policy",
  },
  "search-dsl": {
    id: "search-dsl",
    label: "Search DSL",
    lifecycle: "deferred",
    parserOwner: "future-language-core-contract",
    completionOwner: "future-language-core-contract",
    fallbackPolicy: {
      kind: "not-implemented",
      reason:
        "Search DSL is fixture-backed only until live HTTP execution lands.",
    },
    safetyAnalyzer: "profile-safety-policy",
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
