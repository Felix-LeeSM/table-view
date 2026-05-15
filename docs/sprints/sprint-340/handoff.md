# Sprint 340 Handoff — U5 live wire (Slow queries / Profiler)

## Status: ✅ Complete (final sprint of the U-lineup)

## Changes

### Backend
- `src-tauri/src/models/query.rs` — `SlowQueryRow { query, calls,
  total_exec_time_ms, mean_exec_time_ms, rows, extras: HashMap<String,
  Value> }` (camelCase wire).
- `src-tauri/src/models/mod.rs` — re-export `SlowQueryRow`.
- `src-tauri/src/db/traits.rs` —
  - `RdbAdapter::slow_queries(limit)` default `Unsupported`.
  - `DocumentAdapter::slow_queries(limit)` required.
- `src-tauri/src/db/postgres/schema.rs` — `slow_queries(limit)` runs
  `SELECT query, calls, total_exec_time, mean_exec_time, rows FROM
  pg_stat_statements ORDER BY mean_exec_time DESC NULLS LAST LIMIT $1`
  with a friendly error wrap when the extension is missing
  (`CREATE EXTENSION pg_stat_statements` hint).
- `src-tauri/src/db/postgres.rs` — `slow_queries` trait dispatch + new
  no-connection wrapper test.
- `src-tauri/src/db/mongodb/schema.rs` — `slow_queries_impl(limit)`
  inspects `system.profile` of the active DB. Short-circuits to
  `Ok(Vec::new())` when the collection is missing (profiling OFF).
  Maps `millis`, `nreturned`, and surfaces ts/ns/op/keysExamined/
  docsExamined/planSummary/user/client/appName into `extras`.
- `src-tauri/src/db/mongodb.rs` — `slow_queries` trait dispatch.
- `src-tauri/src/db/testing.rs` — `slow_queries_fn` slot on
  Stub{Rdb,Document}Adapter.
- `src-tauri/src/db/tests.rs` — `slow_queries` impl on DummyDocument /
  FakeCancellableDocument; new
  `test_rdb_default_slow_queries_returns_unsupported`.
- `src-tauri/src/commands/meta.rs` — paradigm-neutral `slow_queries`
  Tauri command (RDB / Document / Search-Unsupported / Kv-Unsupported)
  + clamps `limit` to `[1, 500]` + 6 dispatch tests.
- `src-tauri/src/lib.rs` — registers `commands::meta::slow_queries`.

### Frontend
- `src/lib/api/slowQueries.ts` — `slowQueries(connectionId, limit)`
  wrapper + `SlowQueryRow` TS type.
- `src/components/query/SlowQueryPanel.tsx` — top-25 table (query,
  calls, mean, total, rows) + empty state + raw extras drawer +
  Refresh button; replaces the Sprint 327 `BackendPendingPlaceholder`.
- `src/components/query/SlowQueryPanel.test.tsx` — 5 cases (RDB table /
  Mongo extras / empty profile / error / refresh).

## Verification

- `cargo fmt`
- `cargo clippy --all-targets --all-features -- -D warnings`
- `cargo test --lib slow_queries` → 10 / 10 passed
- `pnpm vitest run` → 3801 passed
- `pnpm tsc --noEmit`
- `pnpm lint` (clean)

## Next

Sprint 340 closes out the U1–U5 live-wire lineup that backfilled the
Sprint 327 placeholders. Open follow-ups from the unified backlog:
profiler-level toggle (Mongo `setProfilingLevel`),
`pg_stat_statements_reset()` button, and limit-selector UX on the slow
query panel.
