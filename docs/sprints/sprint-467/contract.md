---
review-profile: code
---

# Sprint 467 Contract: Redis/Valkey Values, TTL, And Streams

## Goal

Add practical Redis/Valkey value inspection/editing and the first stream
workflows under the KV adapter contract.

## Dependencies

- Depends on: 466.
- Parallel lane: kv/redis.
- Blocks: 468.

## Scope

- Render common Redis value types: string, hash, list, set, sorted set, JSON if
  supported by capability, and stream entries.
- Implement safe edit paths for selected types.
- Support TTL update/delete with explicit confirmation where destructive.
- Add stream read basics without claiming full consumer-group management.

## Acceptance Criteria

- AC-467-01: Common value types render through typed KV envelopes.
- AC-467-02: Enabled edits are type-aware and tested.
- AC-467-03: TTL changes are explicit and reversible where possible.
- AC-467-04: Stream support is scoped and documented.

## Out of Scope

- Full Redis module ecosystem.
- Cluster resharding/topology UI.
- Pub/sub live console.

## Verification Plan

1. Redis value fixture tests.
2. TTL/edit safety tests.
3. Focused key browser UI tests.

### Required Checks

1. `pnpm exec tsc -b --pretty false`
2. `cargo check --manifest-path src-tauri/Cargo.toml`
3. `git diff --check`
