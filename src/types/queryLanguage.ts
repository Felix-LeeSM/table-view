import type { QueryLanguageId } from "./dataSource";

export type QueryLanguageLifecycle = "active" | "deferred";
export type QueryLanguageOwner = "unassigned";
export type QueryLanguageFallbackPolicy = {
  readonly kind: "unassigned";
};

export interface QueryLanguageMetadata {
  readonly id: QueryLanguageId;
  readonly lifecycle: QueryLanguageLifecycle;
  readonly parserOwner: QueryLanguageOwner;
  readonly completionOwner: QueryLanguageOwner;
  readonly fallbackPolicy: QueryLanguageFallbackPolicy;
  readonly safetyAnalyzer: QueryLanguageOwner;
  readonly supportedSyntaxDocs: string;
}

export function getActiveQueryLanguages(): readonly QueryLanguageId[] {
  return [];
}

export function getQueryLanguageMetadata(
  id: QueryLanguageId,
): QueryLanguageMetadata {
  return {
    id,
    lifecycle: "deferred",
    parserOwner: "unassigned",
    completionOwner: "unassigned",
    fallbackPolicy: {
      kind: "unassigned",
    },
    safetyAnalyzer: "unassigned",
    supportedSyntaxDocs: "",
  };
}
