# Sprint 339 Contract — U4 live wire (Server info)

## Scope

Replace `BackendPendingPlaceholder` inside `ServerInfoPanel` with a
live IPC wire returning paradigm-aware server identity + key tuning
flags:

- **RDB**: `SELECT version() AS version`,
  `SELECT name, setting, category FROM pg_settings WHERE name IN
  ('server_version', 'shared_buffers', 'work_mem', 'max_connections',
  'effective_cache_size', 'timezone')` → flat row + `extras` for raw
  setting list.
- **Mongo**: `runCommand({buildInfo: 1})` + `runCommand({serverStatus:
  1})` merged into the same `ServerInfoRow` shape (version, host,
  uptimeSec, connectionsActive, replication).

## Done Criteria

1. New model `ServerInfoRow` (camelCase wire — `version`, `host`,
   `uptimeSec`, `connectionsActive`, `extras: HashMap<String,
   serde_json::Value>`).
2. `RdbAdapter::server_info()` trait method default `Unsupported`;
   PG override.
3. `DocumentAdapter::server_info()` trait method (required); Mongo
   impl.
4. Single paradigm-neutral Tauri command `server_info(connection_id)`
   in `commands/meta.rs`.
5. Registered in `lib.rs::invoke_handler`.
6. Frontend wrapper `serverInfo(connectionId)` in
   `@/lib/api/serverInfo`.
7. `ServerInfoPanel` live wire (key facts grid + extras block).
8. Coverage: ≥3 PG + ≥2 Mongo + ≥6 meta dispatch + ≥4 frontend
   vitest.

## Out of Scope

- `serverStatus` 의 모든 sub-section (mem, opcounters, repl, wiredTiger)
  raw 직접 노출 — extras 에 그대로 dump.
- live polling / charting.

## Invariants

- 이전 sprint live wires 회귀 없음.
- coverage gate 유지.

## Verification Plan

Profile: `mixed`
- `cargo test --lib`
- `pnpm vitest run --no-coverage`
- `pnpm tsc --noEmit`
- `pnpm lint`
- lefthook `pre-commit`
