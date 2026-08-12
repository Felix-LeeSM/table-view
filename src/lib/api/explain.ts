// Sprint 337 (U2 live wire) — paradigm-aware explain wrappers.
// RDB → EXPLAIN (FORMAT JSON), Mongo → runCommand({explain: …}).
// Both return the raw plan tree as `unknown` (JSON value) so the
// `ExplainViewer` can render a paradigm-neutral tree.

import { invoke } from "@tauri-apps/api/core";
import { executeSearchQuery } from "@/lib/tauri/search";
import type { FindBody } from "@/types/document";
import type { SearchQueryRequest } from "@/types/search";

export async function explainRdbQuery(
  connectionId: string,
  sql: string,
  expectedDatabase?: string,
  // #1269 — cooperative cancel id; `cancelQuery(queryId)` aborts a slow plan.
  queryId?: string,
): Promise<unknown> {
  return invoke<unknown>("explain_rdb_query", {
    connectionId,
    sql,
    expectedDatabase: expectedDatabase ?? null,
    queryId: queryId ?? null,
  });
}

export interface ExplainMongoFindArgs {
  database: string;
  collection: string;
  // #1210 — the same find body (filter/sort/projection/skip/limit) the real
  // find executes, so the plan reflects sort/limit/projection instead of a
  // silently filter-only plan that diverges from actual execution.
  body?: FindBody;
  verbosity?: "queryPlanner" | "executionStats" | "allPlansExecution";
}

export async function explainMongoFind(
  connectionId: string,
  args: ExplainMongoFindArgs,
  // #1269 — cooperative cancel id; `cancelQuery(queryId)` aborts a slow plan.
  queryId?: string,
): Promise<unknown> {
  return invoke<unknown>("explain_mongo_find", {
    connectionId,
    database: args.database,
    collection: args.collection,
    body: args.body ?? {},
    verbosity: args.verbosity ?? "queryPlanner",
    queryId: queryId ?? null,
  });
}

/**
 * #2153 — Elasticsearch/OpenSearch have no plan endpoint the way rdb and
 * document do: `_search`'s own `profile` boolean is what decomposes the
 * execution time (#1818), and #2198 unlocked that flag in the bounded DSL
 * validator. So an explain here is the same request re-run with
 * `profile: true`, keeping only the response's `profile` section.
 *
 * Returns null when the cluster answered without one — the built-in fixture
 * source does exactly that, since there is no Lucene behind it.
 */
export async function explainSearchQuery(
  connectionId: string,
  request: SearchQueryRequest,
  // #1269 — cooperative cancel id; `cancelQuery(queryId)` aborts a slow plan.
  queryId?: string,
): Promise<unknown> {
  const body =
    typeof request.body === "object" &&
    request.body !== null &&
    !Array.isArray(request.body)
      ? (request.body as Record<string, unknown>)
      : {};
  const result = await executeSearchQuery(
    connectionId,
    { ...request, body: { ...body, profile: true } },
    queryId,
  );
  return result.profile ?? null;
}
