---
review-profile: code
---

# Sprint 477 Contract: Cross-Paradigm Fixture Harness

## Goal

Create a reusable fixture harness so RDBMS, document, KV, and Search adapters
can be tested consistently without bespoke one-off setup.

## Dependencies

- Depends on: 447.
- Parallel lane: quality/foundation.
- Can run alongside later adapter work.

## Scope

- Define fixture lifecycle, seed data, cleanup, and capability labels.
- Support local fixtures, testcontainers, embedded files, and mocks where
  appropriate.
- Keep cloud-only services out unless a local emulator/mock exists.
- Add documentation for new adapter test authors.

## Acceptance Criteria

- AC-477-01: Adapter tests can request fixtures by data-source profile.
- AC-477-02: Fixture failures produce actionable diagnostics.
- AC-477-03: Local-first/privacy assumptions are testable.
- AC-477-04: Harness does not slow every ordinary frontend test by default.

## Out of Scope

- CI infrastructure overhaul.
- Paid cloud test services.
- Full E2E suite rewrite.

## Verification Plan

1. Harness unit tests.
2. One RDBMS fixture migration pilot.
3. Documentation review.

### Required Checks

1. `pnpm exec tsc -b --pretty false`
2. `cargo check --manifest-path src-tauri/Cargo.toml`
3. `git diff --check`
