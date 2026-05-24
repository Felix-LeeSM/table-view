# Sprint 465 Handoff: KV Adapter Contract

## Gate Result

Sprint 465 promotes `KvAdapter` from marker to a real key-value contract. Redis
now has typed scan, value, TTL, mutation, and stream envelopes with explicit
unsupported defaults for adapters that do not implement KV behavior.

## Closed By This Sprint

- Added `src-tauri/src/db/kv_trait.rs` with KV catalog/scan/value/edit/TTL/stream
  methods.
- Added `src-tauri/src/db/kv_types.rs` Rust wire envelopes.
- Added `src/types/kv.ts` frontend mirrors.
- Re-exported KV contract types through `src-tauri/src/db/mod.rs`.
- Added mock conformance tests proving marker defaults return explicit
  `Unsupported`.

## Acceptance Criteria

| AC | Evidence |
|---|---|
| AC-465-01 | `RedisAdapter` implements `KvAdapter`; `make_adapter(redis)` returns `ActiveAdapter::Kv`. |
| AC-465-02 | `KvKeyScanPage`, `KvValueEnvelope`, `KvValue`, `KvStreamReadResult`, and mutation envelopes exist in Rust/TS. |
| AC-465-03 | `KvWriteSafety`, `KvDeleteRequest.confirm_key`, and `KvTtlUpdate::Persist.confirm_key` model dangerous-operation gates. |
| AC-465-04 | `kv_trait` default tests assert marker methods return `Unsupported`. |

## Verification

- `pnpm exec tsc -b --pretty false`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `pnpm exec vitest run src/components/workspace/KvSidebar.test.tsx src/types/dataSource.test.ts src/types/connection.test.ts`
