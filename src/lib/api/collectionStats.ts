// Sprint 338 (U3 live wire) — paradigm-aware collection/table stats.
// RDB → pg_stat_user_tables + pg_total_relation_size + pg_indexes.
// Mongo → runCommand({collStats}). Both flatten into CollectionStatsRow.

import { invoke } from "@tauri-apps/api/core";

export interface CollectionStatsRow {
  rows: number;
  sizeBytes: number;
  indexes: number;
  lastVacuum: string | null;
  lastAnalyze: string | null;
  seqScans: number | null;
  idxScans: number | null;
  nDead: number | null;
  extras: Record<string, unknown>;
}

export async function collectionStatsRdb(
  connectionId: string,
  schema: string,
  table: string,
): Promise<CollectionStatsRow> {
  return invoke<CollectionStatsRow>("collection_stats_rdb", {
    connectionId,
    schema,
    table,
  });
}

export async function collectionStatsMongo(
  connectionId: string,
  database: string,
  collection: string,
): Promise<CollectionStatsRow> {
  return invoke<CollectionStatsRow>("collection_stats_mongo", {
    connectionId,
    database,
    collection,
  });
}
