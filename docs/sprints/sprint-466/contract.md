---
review-profile: code
---

# Sprint 466 Contract: Redis/Valkey Connection, Catalog, And Key Browser

## Goal

Implement the first Redis/Valkey slice: connect, inspect databases/keyspaces,
and browse keys safely.

## Dependencies

- Depends on: 465.
- Parallel lane: kv/redis.
- Blocks: 467 and 468.

## Scope

- Add Redis/Valkey profiles and server connection fields.
- Implement database/key browser using safe scan behavior, not blocking full key
  enumeration.
- Show key type, TTL, and size metadata where available.
- Add fixture-backed tests.

## Acceptance Criteria

- AC-466-01: Redis/Valkey can connect through the KV profile.
- AC-466-02: Key browsing uses bounded scan behavior.
- AC-466-03: TTL/type metadata is visible without mutating data.
- AC-466-04: Large keyspaces do not freeze the UI.

## Out of Scope

- Value editing.
- Streams UI.
- Cluster topology.

## Verification Plan

1. Redis fixture adapter tests.
2. Key browser UI tests.
3. Performance smoke for bounded scan behavior.

### Required Checks

1. `pnpm exec tsc -b --pretty false`
2. `cargo check --manifest-path src-tauri/Cargo.toml`
3. `git diff --check`
