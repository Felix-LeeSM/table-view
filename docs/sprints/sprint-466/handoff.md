# Sprint 466 Handoff: Redis/Valkey Connection, Catalog, And Key Browser

## Gate Result

Sprint 466 wires Redis as the first KV runtime slice. The connection factory
creates `RedisAdapter`, the frontend exposes Redis, and workspace sidebar
routing uses a KV sidebar instead of RDB tree assumptions.

## Closed By This Sprint

- Added `redis` Rust dependency and `RedisAdapter`.
- Added Redis connection URL construction with auth/database handling.
- Added database/keyspace listing and bounded `SCAN` based key browsing.
- Added metadata read for key type, TTL, logical size, and memory usage where
  available.
- Added `KvSidebar` and `kv.ts` IPC wrappers.

## Acceptance Criteria

| AC | Evidence |
|---|---|
| AC-466-01 | Redis is in supported DB types and `make_adapter(redis)` returns KV adapter. |
| AC-466-02 | `bounded_limit` clamps `SCAN COUNT`; pure test covers max/zero/default. |
| AC-466-03 | `KvKeyMetadata` includes `keyType`, `ttl`, `logicalSize`, `memoryBytes`. |
| AC-466-04 | UI path calls paged `scanKeys` and does not enumerate keys in RDB tree. |

## Verification

- `pnpm exec vitest run src/components/workspace/KvSidebar.test.tsx src/types/dataSource.test.ts src/types/connection.test.ts`
- `cargo check --manifest-path src-tauri/Cargo.toml`
