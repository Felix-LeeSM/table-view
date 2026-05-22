---
review-profile: code
---

# Sprint 444 Contract: Result Envelope Compatibility Layer

## Goal

Define typed result envelopes and wrap current result shapes at the boundary
without changing rendering behavior.

## Dependencies

- Depends on: 440.
- Parallel lane: result boundary.
- Coordinate with: 443 for query state naming.

## Scope

- Define `ResultEnvelope` variants needed by current RDBMS and MongoDB paths.
- Wrap current RDBMS SQL output as `tabular`.
- Wrap existing MongoDB find/aggregate compatible outputs as `document` or
  compatible tabular projection where current UI already expects it.
- Keep result-grid rendering stable.

## Acceptance Criteria

- AC-444-01: Current RDBMS result tests remain green.
- AC-444-02: Current MongoDB result behavior remains green where covered.
- AC-444-03: `QueryResultGrid` does not become the required renderer for every
  future envelope kind.
- AC-444-04: Envelope conversion failures are visible and typed.

## Out of Scope

- New visual renderers.
- New query execution behavior.
- Search/KV/vector result kinds beyond type placeholders.

## Verification Plan

1. Result conversion tests.
2. Existing query result UI tests.
3. Typecheck.

### Required Checks

1. `pnpm exec tsc -b --pretty false`
2. `cargo check --manifest-path src-tauri/Cargo.toml`
3. `git diff --check`
