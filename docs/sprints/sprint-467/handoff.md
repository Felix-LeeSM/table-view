# Sprint 467 Handoff: Redis/Valkey Values, TTL, And Streams

## Gate Result

Sprint 467 adds practical Redis value and TTL surfaces through typed KV
envelopes. Common Redis value types map to explicit variants, edits are scoped
to string values, TTL operations require explicit intent, and stream reads are
bounded.

## Closed By This Sprint

- Added value readers for string, list, set, sorted set, hash, JSON, and stream.
- Added `set_string`, `delete_key`, `update_ttl`, and `read_stream` adapter
  methods.
- Added UTF-8/binary string encoding detection.
- Added Redis type mapping tests, including stream and ReJSON names.
- Added exact-key confirmation for delete and TTL persist.

## Acceptance Criteria

| AC | Evidence |
|---|---|
| AC-467-01 | `KvValue` variants cover string/list/set/zset/hash/json/stream/missing/unsupported. |
| AC-467-02 | String edit path has overwrite safety and typed mutation result. |
| AC-467-03 | `expire` vs `persist` is explicit; `persist` requires exact key confirmation. |
| AC-467-04 | Stream support is bounded read only; no consumer-group/pubsub claim. |

## Verification

- `pnpm exec tsc -b --pretty false`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- Focused `cargo test ... kv` attempted.
