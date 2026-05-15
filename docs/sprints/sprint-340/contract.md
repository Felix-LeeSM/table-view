# Sprint 340 Contract — U5 live wire (Slow queries / Profiler)

## Scope

Replace `BackendPendingPlaceholder` inside `SlowQueryPanel` with a
live IPC wire returning a unified `SlowQueryRow` list:

- **RDB**: `SELECT query, calls, total_exec_time, mean_exec_time, rows
  FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT N`.
  `pg_stat_statements` is an optional extension — fast-fail with a
  clear "extension not enabled" message when the relation is missing.
- **Mongo**: `db.system.profile.find({}).sort({ts:-1}).limit(N)`.
  Mongo profiling is per-DB; the panel queries the currently-active DB
  (no admin-wide aggregation). Caller is responsible for enabling
  profiling via `db.setProfilingLevel(level, slowms)` beforehand.

## Done Criteria

1. New model `SlowQueryRow { query, calls, total_exec_time_ms,
   mean_exec_time_ms, rows, extras: HashMap<String, Value> }` (camelCase
   wire). `extras` carries paradigm-specific fields (Mongo `ts`, `ns`,
   `keysExamined`, `docsExamined`, ...).
2. `RdbAdapter::slow_queries(limit)` default `Unsupported`; PG override.
3. `DocumentAdapter::slow_queries(limit)` required; Mongo impl.
4. Single paradigm-neutral Tauri command `slow_queries(connection_id,
   limit)` in `commands/meta.rs`.
5. Registered in `lib.rs::invoke_handler`.
6. Frontend wrapper `slowQueries(connectionId, limit)` in
   `@/lib/api/slowQueries`.
7. `SlowQueryPanel` live wire (top-N table + Refresh + limit selector
   optional).
8. Coverage: ≥2 PG + ≥1 Mongo + ≥5 meta dispatch + ≥4 frontend vitest.

## Out of Scope

- Profiler level toggle (Mongo `setProfilingLevel`) UI — deferred.
- `pg_stat_statements_reset()` button — deferred.

## Invariants

- 이전 sprint (336-339) live wires 회귀 없음.
- coverage gate (70/69/71) 유지.

## Verification Plan

Profile: `mixed`
- `cargo test --lib`
- `pnpm vitest run`
- `pnpm tsc --noEmit`
- `pnpm lint`
- lefthook `pre-commit`
