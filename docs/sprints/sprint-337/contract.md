# Sprint 337 Contract — U2 live wire (Explain viewer)

## Scope

Replace the `BackendPendingPlaceholder` inside `ExplainViewer` with a
live IPC wire that returns the query plan for both paradigms:

- **RDB**: `EXPLAIN (ANALYZE, FORMAT JSON) <query>` against the
  active connection. Returns the PG explain tree (top-level array
  with a single `Plan` object).
- **Mongo**: `db.runCommand({ explain: { find: <coll>, filter,
  ...optionals }, verbosity })` against the target DB. Returns the
  raw explain Document.

Both paradigms emit a `serde_json::Value` (raw plan tree) so the
frontend renders the same JSON tree viewer without paradigm-specific
shape coercion.

## Done Criteria

1. `RdbAdapter::explain_query(sql)` trait method exists with default
   `AppError::Unsupported`; PG overrides it to run
   `EXPLAIN (ANALYZE, FORMAT JSON) <sql>` and parse the first cell as
   JSON.
2. `DocumentAdapter::explain_query(db, collection, filter, verbosity)`
   trait method exists; Mongo impl runs the `explain` admin-ish command
   on the target DB and returns the raw response as
   `serde_json::Value`.
3. Two Tauri commands:
   - `explain_rdb_query(connection_id, sql) -> serde_json::Value`
   - `explain_mongo_find(connection_id, db, collection, filter,
     verbosity) -> serde_json::Value`
4. Both commands are registered in `lib.rs::invoke_handler`.
5. Frontend `@/lib/api/explain` wrappers exist:
   - `explainRdbQuery(connectionId, sql)`
   - `explainMongoFind(connectionId, db, collection, filter,
     verbosity)`
6. `ExplainViewer` props extended to take either a `rdbSql` or a
   `mongoSpec` shape; `paradigm` resolves the dispatch. Placeholder
   removed.
7. Test coverage:
   - PG schema: ≥2 connection-error unit case for
     `explain_query`.
   - Mongo schema: ≥3 connection-error / empty-args unit case for
     `explain_query`.
   - `db/testing.rs`: 2 new stub slots (`rdb_explain_query_fn`,
     `document_explain_query_fn`).
   - Tauri command dispatch: ≥6 unit case (wiring + paradigm-mismatch +
     unknown-connection + happy-path for each command).
   - Frontend: ≥4 vitest case (render success + render error + RDB
     fetch dispatches with sql + Mongo fetch dispatches with the
     spec).

## Out of Scope

- Tree viewer beyond raw JSON pretty-print (deferred).
- Caching / re-explain on input change.
- Aggregate pipeline explain (only `find` for v1).

## Invariants

- ServerActivityPanel from Sprint 336 must continue to render
  (regression guard).
- `cargo clippy -D warnings`, `pnpm tsc --noEmit`, `pnpm lint`
  remain clean.
- coverage gate (regions ≥ 71 / fns ≥ 69 / lines ≥ 70).

## Verification Plan

Profile: `mixed`

- `cargo test --lib` (Rust unit cases)
- `pnpm vitest run --no-coverage` (frontend cases)
- `pnpm tsc --noEmit`
- `pnpm lint`
- lefthook `pre-commit` (covers clippy + coverage gate)
