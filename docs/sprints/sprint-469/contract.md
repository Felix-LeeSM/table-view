# Sprint 469 Contract: KV Adapter Contract

## Goal

Promote `KvAdapter` from marker concept to a real contract before Redis/Valkey
implementation begins.

## Dependencies

- Depends on: 447.
- Parallel lane: kv/foundation.
- Blocks: 470-472.

## Scope

- Define key scan, get/set, delete, TTL, type inspection, stream basics, and
  safety boundaries as contract methods or explicit deferred gaps.
- Define key-value and stream result envelopes.
- Define fixture strategy for Redis/Valkey.
- Add contract tests or mock conformance tests.

## Acceptance Criteria

- AC-469-01: Redis/Valkey implementation has a real adapter target.
- AC-469-02: KV result envelopes are typed.
- AC-469-03: Dangerous operations have safety policy hooks.
- AC-469-04: Marker-only traits do not pretend to be support.

## Out of Scope

- Redis UI implementation.
- Cluster support.
- Pub/sub UI.

## Verification Plan

1. Adapter contract tests.
2. Mock conformance tests.
3. Typecheck/cargo check for touched surfaces.
