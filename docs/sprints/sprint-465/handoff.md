# Sprint 465 Handoff: KV Adapter Contract

## Gate Result

Sprint 465 promotes `KvAdapter` from marker to a real key-value contract. The
contract now has typed scan, value, TTL, mutation, and stream envelopes with
explicit unsupported defaults for adapters that do not implement KV behavior.

## Fixture Strategy

- Fixture source: live Redis/Valkey adapter tests must use a repo-owned,
  checked-in seed fixture loaded into an ephemeral Redis-compatible service; a
  developer workstation instance or manual `redis-cli` setup is not a valid
  source.
- Seed shape: the seed should target database 0 with deterministic colon-key
  names and cover string, hash, list, set, zset, stream, missing-key, persistent
  TTL, and expiring TTL cases so `KvKeyScanPage`, `KvValueEnvelope`, TTL, and
  stream envelopes are exercised together.
- Live-vs-mock boundary: sprint 465 only proves the contract surface and mock
  conformance defaults. Mock tests assert explicit `Unsupported` behavior and
  do not claim network-backed Redis/Valkey support.
- Deferral: fixture-backed live Redis/Valkey adapter tests are deferred to
  sprint 466+ when connection, catalog, key browsing, value, TTL, and stream
  adapter paths exist.

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
| AC-465-01 | `ActiveAdapter::Kv` targets `dyn KvAdapter`; adapters get a real contract surface before runtime wiring. |
| AC-465-02 | `KvKeyScanPage`, `KvValueEnvelope`, `KvValue`, `KvStreamReadResult`, and mutation envelopes exist in Rust/TS. |
| AC-465-03 | `KvWriteSafety`, `KvDeleteRequest.confirm_key`, and `KvTtlUpdate::Persist.confirm_key` model dangerous-operation gates. |
| AC-465-04 | `kv_trait` default tests assert marker methods return `Unsupported`. |

## Verification

- `pnpm exec tsc -b --pretty false`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml db::kv_`
