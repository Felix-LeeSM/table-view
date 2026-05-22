---
review-profile: code
---

# Sprint 442 Contract: Capability Gating Compatibility

## Goal

Move low-risk frontend feature enablement from `dbType`/`paradigm` checks to
profile capability lookup without changing user-visible behavior.

## Dependencies

- Depends on: 441.
- Parallel lane: frontend capability.
- Can run with: 443, 444, 445, 446 after dependency is met.

## Scope

- Pick a narrow set of read-only feature gates already expressible by
  `DataSourceCapabilities`.
- Replace local switch checks with profile/capability helpers.
- Keep fallback behavior identical for unknown or deferred sources.
- Add tests for one RDBMS and one document source gate.

## Acceptance Criteria

- AC-442-01: Migrated gates return the same enabled/disabled state as before.
- AC-442-02: Capability lookup is centralized enough for future DBMS additions.
- AC-442-03: Missing capability defaults to disabled or explicit fallback.
- AC-442-04: No broad UI behavior changes are bundled into this sprint.

## Out of Scope

- New capabilities.
- New source support.
- Backend capability negotiation.

## Verification Plan

1. Focused UI/helper tests.
2. Existing affected component tests.
3. Typecheck.

### Required Checks

1. `pnpm exec tsc -b --pretty false`
2. `cargo check --manifest-path src-tauri/Cargo.toml`
3. `git diff --check`
