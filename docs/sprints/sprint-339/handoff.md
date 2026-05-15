# Sprint 339 Handoff — U4 live wire (Server info)

## Status: ✅ Complete

## Changes

### Backend
- `src-tauri/src/models/query.rs` — `ServerInfoRow { version, host,
  uptime_sec, connections_active, extras: HashMap<String, Value> }`
  (camelCase wire).
- `src-tauri/src/models/mod.rs` — re-export `ServerInfoRow`.
- `src-tauri/src/db/traits.rs` —
  - `RdbAdapter::server_info` default `Unsupported`.
  - `DocumentAdapter::server_info` required.
- `src-tauri/src/db/postgres/schema.rs` — `server_info` runs `version()`,
  `inet_server_addr()::text`, `pg_postmaster_start_time()` uptime,
  `pg_stat_activity` active count, and a `pg_settings` whitelist
  (server_version, shared_buffers, work_mem, max_connections,
  effective_cache_size, timezone) collected into `extras`.
- `src-tauri/src/db/postgres.rs` — `server_info` trait dispatch.
- `src-tauri/src/db/mongodb/schema.rs` — `server_info_impl` runs
  `adminCommand({buildInfo: 1})` + `adminCommand({serverStatus: 1})`,
  maps `version` / `host` / `uptime` (f64/i64/i32 fallbacks) /
  `connections.active`, and surfaces `connections`, `opcounters`,
  `mem`, `repl`, `wiredTiger`, `process`, `pid`, `storageEngine`,
  `uptimeMillis`, `localTime` (status) + `gitVersion`, `modules`,
  `openssl`, `javascriptEngine` (build) into `extras`.
- `src-tauri/src/db/mongodb.rs` — `server_info` trait dispatch.
- `src-tauri/src/db/testing.rs` — `server_info_fn` slot on
  Stub{Rdb,Document}Adapter.
- `src-tauri/src/db/tests.rs` — `server_info` impl on DummyDocument /
  FakeCancellableDocument; new
  `test_rdb_default_server_info_returns_unsupported`.
- `src-tauri/src/commands/meta.rs` — paradigm-neutral `server_info`
  Tauri command (RDB / Document / Search-Unsupported / Kv-Unsupported)
  + 5 dispatch tests.
- `src-tauri/src/lib.rs` — registers `commands::meta::server_info`.

### Frontend
- `src/lib/api/serverInfo.ts` — `serverInfo(connectionId)` wrapper +
  `ServerInfoRow` TS type.
- `src/components/connection/ServerInfoPanel.tsx` — live grid (version,
  host, uptime, connections, extras) with Refresh button; replaces the
  Sprint 327 `BackendPendingPlaceholder`.
- `src/components/connection/ServerInfoPanel.test.tsx` — 4 cases (RDB
  happy + Mongo extras + error alert + refresh).

## Verification

- `cargo fmt`
- `cargo clippy --all-targets --all-features -- -D warnings`
- `cargo test --lib server_info` → 8 / 8 passed
- `pnpm vitest run` → 3798 passed
- `pnpm tsc --noEmit`
- `pnpm lint` (clean)

## Next Sprint

**Sprint 340** — Mongo `system.profile` + RDB `pg_stat_statements`
(U5 live wire). Replace `SlowQueryPanel` placeholder. Final sprint of
the U-lineup.
