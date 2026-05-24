# Sprint 467 Handoff: Redis/Valkey Values, TTL, And Streams

## Gate Result

Sprint 467 adds practical Redis value reads, scoped string writes, explicit TTL
updates, delete plumbing, and bounded stream reads through the KV adapter
contract.

## Closed By This Sprint

- Added Redis readers for string, list, set, sorted set, hash, JSON, and stream
  value envelopes.
- Added UTF-8 vs binary Redis string handling.
- Added `set_string`, `delete_key`, `update_ttl`, and `read_stream` adapter and
  Tauri command paths.
- Added frontend KV wrappers and a key value preview in `KvSidebar`.
- Declared stream result support for Redis profiles.

## Acceptance Criteria

| AC | Evidence |
|---|---|
| AC-467-01 | `KvValue` read paths cover string/list/set/zset/hash/json/stream/missing/unsupported. |
| AC-467-02 | String writes use type-aware `SET` with overwrite safety. |
| AC-467-03 | TTL `expire` vs `persist` is explicit; `persist` and delete require exact key confirmation. |
| AC-467-04 | Stream support is bounded read-only; no consumer-group or pub/sub surface is claimed. |

## Verification

- `pnpm exec tsc -b --pretty false`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `git diff --check`
- Focused Redis and KV wrapper/UI tests.
