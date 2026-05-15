# Sprint 338 Contract — U3 live wire (Collection stats)

## Scope

Replace `BackendPendingPlaceholder` inside `CollectionStatsPanel` with
a live IPC wire that returns table / collection statistics:

- **RDB**: query `pg_stat_user_tables` + `pg_class` for the given
  `(schema, table)` and return a paradigm-neutral
  `CollectionStatsRow` (rows, sizeBytes, indexes, lastVacuum,
  lastAnalyze, seqScans, idxScans, nDead).
- **Mongo**: `runCommand({ collStats: <coll> })` and map a fixed
  subset (count, size, storageSize, totalIndexSize, avgObjSize,
  capped, nindexes) into the same `CollectionStatsRow` slots —
  Mongo-specific fields land in the unstructured `extras` slot
  (paradigm leakage explicit).

## Done Criteria

1. New model `CollectionStatsRow` (camelCase wire, `extras: HashMap<String, serde_json::Value>` for paradigm extras).
2. `RdbAdapter::collection_stats(namespace, table)` trait method with
   default `Unsupported`. PG overrides.
3. `DocumentAdapter::collection_stats(db, collection)` trait method
   (required).
4. Two Tauri commands:
   - `collection_stats_rdb(connection_id, schema, table)`
   - `collection_stats_mongo(connection_id, database, collection)`
5. Both registered in `lib.rs::invoke_handler`.
6. Frontend `@/lib/api/collectionStats` wrappers:
   - `collectionStatsRdb(connectionId, schema, table)`
   - `collectionStatsMongo(connectionId, database, collection)`
7. `CollectionStatsPanel` props extended to take a paradigm-aware
   `target` (RDB → `{schema, table}`, Mongo → `{database, collection}`)
   and renders the live stats. Placeholder removed.
8. Coverage: ≥4 PG schema unit case + ≥3 Mongo schema unit case
   + ≥4 command dispatch case per paradigm + ≥4 frontend vitest
   case (render success, RDB dispatch, Mongo dispatch, error).

## Out of Scope

- View / materialised-view stats (RDB only `tables`).
- DbStats / dbSize (deferred to U4).

## Invariants

- ExplainViewer / ServerActivityPanel must continue to render.
- coverage gate (regions ≥ 71 / fns ≥ 69 / lines ≥ 70).

## Verification Plan

Profile: `mixed`

- `cargo test --lib`
- `pnpm vitest run --no-coverage`
- `pnpm tsc --noEmit`
- `pnpm lint`
- lefthook `pre-commit`
