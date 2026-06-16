import { executeSearchQuery } from "@lib/tauri";
import { getTauriErrorMessage } from "@lib/tauri/error";
import type { QueryState } from "@/types/query";
import type { SearchQueryRequest, SearchResultEnvelope } from "@/types/search";
import type { QueryTab } from "@stores/workspaceStore";
import { isRecord } from "./queryHelpers";

type SearchTabContext = Pick<QueryTab, "id" | "connectionId" | "searchTarget">;

interface SearchLifecycleActions {
  updateQueryState: (tabId: string, state: QueryState) => void;
  completeSearchQuery: (
    tabId: string,
    queryId: string,
    result: SearchResultEnvelope,
  ) => void;
  cancelRunningQuery: (tabId: string, queryId: string, message: string) => void;
  failQuery: (tabId: string, queryId: string, errorMessage: string) => void;
}

export interface ExecuteSearchDslQueryRequest extends SearchLifecycleActions {
  tab: SearchTabContext;
  sql: string;
}

export function parseSearchDslRequest(
  sql: string,
  searchTarget?: QueryTab["searchTarget"],
): SearchQueryRequest {
  const parsed: unknown = JSON.parse(sql);
  if (!isRecord(parsed)) {
    throw new Error("Search DSL request must be a JSON object.");
  }
  const hasEnvelopeBody = isRecord(parsed.body);
  const index =
    searchTarget?.name ??
    (typeof parsed.index === "string" ? parsed.index : undefined);
  const body = hasEnvelopeBody
    ? parsed.body
    : searchTarget
      ? parsed
      : parsed.body;
  if (typeof index !== "string" || index.trim().length === 0) {
    throw new Error(
      "Search DSL request requires a selected Search index or alias target.",
    );
  }
  if (!isRecord(body)) {
    throw new Error("Search DSL request requires an object body.");
  }
  return {
    index,
    body,
    from: hasEnvelopeBody ? numberField(parsed.from) : undefined,
    size: hasEnvelopeBody ? numberField(parsed.size) : undefined,
    trackTotalHits:
      hasEnvelopeBody && typeof parsed.trackTotalHits === "boolean"
        ? parsed.trackTotalHits
        : undefined,
  };
}

export async function executeSearchDslQuery({
  tab,
  sql,
  updateQueryState,
  completeSearchQuery,
  failQuery,
  cancelRunningQuery,
}: ExecuteSearchDslQueryRequest): Promise<void> {
  let request: SearchQueryRequest;
  try {
    request = parseSearchDslRequest(sql, tab.searchTarget);
  } catch (err) {
    updateQueryState(tab.id, {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const queryId = `${tab.id}-${Date.now()}`;
  updateQueryState(tab.id, { status: "running", queryId });
  try {
    const result = await executeSearchQuery(tab.connectionId, request, queryId);
    completeSearchQuery(tab.id, queryId, result);
  } catch (err) {
    const message = getTauriErrorMessage(err);
    if (isSearchCancellationMessage(message)) {
      cancelRunningQuery(tab.id, queryId, "Search query cancelled");
      return;
    }
    failQuery(tab.id, queryId, message);
  }
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function isSearchCancellationMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.startsWith("cancel:") ||
    normalized.includes("query cancelled") ||
    normalized.includes("query canceled") ||
    normalized.includes("operation cancelled") ||
    normalized.includes("operation canceled")
  );
}
