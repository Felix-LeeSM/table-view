---
review-profile: code
---

# Sprint 468 Contract: Redis/Valkey Integration Gate

## Goal

Verify Redis/Valkey support is coherent enough to become the first-class KV
paradigm baseline.

## Dependencies

- Depends on: 467.
- Parallel lane: kv/join.
- Blocks: release-level non-RDBMS claims.

## Scope

- Review KV profile, adapter contract, connection, key browser, result
  envelopes, value editing, TTL, streams, and safety policy together.
- Verify large-keyspace behavior and read-only safety assumptions.
- Update risks/docs for deferred KV features.

## Acceptance Criteria

- AC-468-01: Redis/Valkey support claims match tested workflows.
- AC-468-02: KV UI does not rely on RDBMS table assumptions.
- AC-468-03: Large keyspaces remain bounded.
- AC-468-04: Deferred cluster/pubsub/module gaps are documented.

## Out of Scope

- Search/Elasticsearch work.
- Cluster administration.
- Pub/sub console.

## Verification Plan

1. Full affected Redis/Valkey tests.
2. Cross-paradigm query/result regression tests.
3. Typecheck/lint/hook gate.

### Required Checks

1. `pnpm exec tsc -b --pretty false`
2. `cargo check --manifest-path src-tauri/Cargo.toml`
3. `git diff --check`
