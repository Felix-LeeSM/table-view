import { executeSearchQuery } from "@lib/tauri";
import type { QueryState } from "@/types/query";
import type { SearchQueryRequest, SearchResultEnvelope } from "@/types/search";
import type { QueryTab } from "@stores/workspaceStore";
import { isRecord } from "./queryHelpers";

type SearchTabContext = Pick<QueryTab, "id" | "connectionId">;

interface SearchLifecycleActions {
  updateQueryState: (tabId: string, state: QueryState) => void;
  completeSearchQuery: (
    tabId: string,
    queryId: string,
    result: SearchResultEnvelope,
  ) => void;
  failQuery: (tabId: string, queryId: string, errorMessage: string) => void;
}

export interface ExecuteSearchDslQueryRequest extends SearchLifecycleActions {
  tab: SearchTabContext;
  sql: string;
}

export function parseSearchDslRequest(sql: string): SearchQueryRequest {
  const parsed: unknown = JSON.parse(sql);
  if (!isRecord(parsed)) {
    throw new Error("Search DSL request must be a JSON object.");
  }
  const index = parsed.index;
  const body = parsed.body;
  if (typeof index !== "string" || index.trim().length === 0) {
    throw new Error("Search DSL request requires a string index.");
  }
  if (!isRecord(body)) {
    throw new Error("Search DSL request requires an object body.");
  }
  return {
    index,
    body,
    from: numberField(parsed.from),
    size: numberField(parsed.size),
    trackTotalHits:
      typeof parsed.trackTotalHits === "boolean"
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
}: ExecuteSearchDslQueryRequest): Promise<void> {
  let request: SearchQueryRequest;
  try {
    request = parseSearchDslRequest(sql);
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
    failQuery(
      tab.id,
      queryId,
      err instanceof Error ? err.message : String(err),
    );
  }
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
