import type { QueryResult } from "./query";

export type FileAnalyticsSourceKind = "csv" | "parquet" | "json" | "ndjson";

export interface FileAnalyticsSource {
  id: string;
  alias: string;
  fileName: string;
  kind: FileAnalyticsSourceKind;
  sizeBytes: number;
}

export interface FileAnalyticsPreview {
  source: FileAnalyticsSource;
  result: QueryResult;
  executedSql: string;
}

export interface FileAnalyticsQueryResponse {
  source: FileAnalyticsSource;
  result: QueryResult;
  executedSql: string;
}
