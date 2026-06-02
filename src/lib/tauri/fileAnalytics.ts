import { invoke } from "@tauri-apps/api/core";
import type {
  FileAnalyticsPreview,
  FileAnalyticsQueryResponse,
  FileAnalyticsSource,
  FileAnalyticsSourceMetadata,
} from "@/types/fileAnalytics";
import { normalizeQueryResult } from "@lib/wireCamelCase";

import { wrapNumericCells } from "./numericWrap";

type FileAnalyticsResponseWire = Omit<FileAnalyticsPreview, "result"> & {
  result: unknown;
};

function normalizeFileAnalyticsResponse<T extends FileAnalyticsResponseWire>(
  response: T,
): Omit<T, "result"> & { result: FileAnalyticsPreview["result"] } {
  return {
    ...response,
    result: wrapNumericCells(normalizeQueryResult(response.result)),
  };
}

export async function registerFileAnalyticsSource(
  connectionId: string,
  path: string,
): Promise<FileAnalyticsSource> {
  return invoke<FileAnalyticsSource>("duckdb_register_file_analytics_source", {
    connectionId,
    path,
  });
}

export async function previewFileAnalyticsSource(
  connectionId: string,
  sourceId: string,
  limit: number | null = null,
): Promise<FileAnalyticsPreview> {
  const response = await invoke<FileAnalyticsResponseWire>(
    "duckdb_preview_file_analytics_source",
    {
      connectionId,
      sourceId,
      limit,
    },
  );
  return normalizeFileAnalyticsResponse(response);
}

export async function listFileAnalyticsSourceMetadata(
  connectionId: string,
): Promise<FileAnalyticsSourceMetadata[]> {
  return invoke<FileAnalyticsSourceMetadata[]>(
    "duckdb_list_file_analytics_source_metadata",
    { connectionId },
  );
}

export async function clearFileAnalyticsSources(
  connectionId: string,
): Promise<void> {
  await invoke("duckdb_clear_file_analytics_sources", { connectionId });
}

export async function executeFileAnalyticsQuery(
  connectionId: string,
  sourceId: string,
  sql: string,
): Promise<FileAnalyticsQueryResponse> {
  const response = await invoke<FileAnalyticsResponseWire>(
    "duckdb_execute_file_analytics_query",
    {
      connectionId,
      sourceId,
      sql,
    },
  );
  return normalizeFileAnalyticsResponse(response);
}
