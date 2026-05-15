// Sprint 340 (U5 live wire) — paradigm-neutral slow query / profiler.
// RDB → pg_stat_statements. Mongo → system.profile.find(). Caller passes
// `limit`; backend clamps to [1, 500].

import { invoke } from "@tauri-apps/api/core";

export interface SlowQueryRow {
  query: string;
  calls: number;
  totalExecTimeMs: number;
  meanExecTimeMs: number;
  rows: number;
  extras: Record<string, unknown>;
}

export async function slowQueries(
  connectionId: string,
  limit: number,
): Promise<SlowQueryRow[]> {
  return invoke<SlowQueryRow[]>("slow_queries", { connectionId, limit });
}
