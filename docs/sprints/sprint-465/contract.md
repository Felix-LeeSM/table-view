---
review-profile: code
---

# Sprint 465 Contract: KV Adapter Contract

## Goal

Promote `KvAdapter` from marker concept to a real contract before Redis/Valkey
implementation begins.

## Dependencies

- Depends on: 447.
- Parallel lane: kv/foundation.
- Blocks: 466-468.

## Scope

- Define key scan, get/set, delete, TTL, type inspection, stream basics, and
  safety boundaries as contract methods or explicit deferred gaps.
- Define key-value and stream result envelopes.
- Define fixture strategy for Redis/Valkey.
- Add contract tests or mock conformance tests.

## Acceptance Criteria

- AC-465-01: Redis/Valkey implementation has a real adapter target.
- AC-465-02: KV result envelopes are typed.
- AC-465-03: Dangerous operations have safety policy hooks.
- AC-465-04: Marker-only traits do not pretend to be support.

## Out of Scope

- Redis UI implementation.
- Cluster support.
- Pub/sub UI.

## Verification Plan

1. Adapter contract tests.
2. Mock conformance tests.
3. Typecheck/cargo check for touched surfaces.

### Required Checks

1. `pnpm exec tsc -b --pretty false`
2. `cargo check --manifest-path src-tauri/Cargo.toml`
3. `git diff --check`
