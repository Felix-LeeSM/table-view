// Sprint 337 (U2 live wire) — paradigm-aware explain wrappers.
// RDB → EXPLAIN (FORMAT JSON), Mongo → runCommand({explain: …}).
// Both return the raw plan tree as `unknown` (JSON value) so the
// `ExplainViewer` can render a paradigm-neutral tree.

import { invoke } from "@tauri-apps/api/core";

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
  filter?: Record<string, unknown>;
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
    filter: args.filter ?? {},
    verbosity: args.verbosity ?? "queryPlanner",
    queryId: queryId ?? null,
  });
}
