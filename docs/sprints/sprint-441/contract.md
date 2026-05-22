---
review-profile: code
---

# Sprint 441 Contract: Existing Data Source Profiles

## Goal

Populate real profile data for the existing source set before any capability
gate migration begins.

## Dependencies

- Depends on: 440.
- Parallel lane: profile.
- Blocks: 442, 446, 458.

## Scope

- Declare PostgreSQL, MySQL, MariaDB, SQLite, and MongoDB profiles.
- Mark capabilities as current-state descriptive values, not aspirational
  roadmap promises.
- Represent MariaDB as a MySQL-family profile unless implementation evidence
  requires a separate adapter decision.
- Represent SQLite as user DBMS/file source separately from internal app state.

## Acceptance Criteria

- AC-441-01: Profile data distinguishes identity, paradigm, connection kind,
  languages, catalog model, result kinds, capabilities, and safety policy.
- AC-441-02: Capability values explain current behavior without enabling new
  UI paths.
- AC-441-03: PostgreSQL remains the RDBMS baseline profile.
- AC-441-04: MongoDB remains document paradigm and does not revive `queryMode`
  as the long-term execution source of truth.

## Out of Scope

- Capability-gated UI migration.
- Adapter implementation.
- Parser/completion expansion.

## Verification Plan

1. Profile fixture tests.
2. Snapshot or table-driven tests for each current source.
3. Typecheck.

### Required Checks

1. `pnpm exec tsc -b --pretty false`
2. `cargo check --manifest-path src-tauri/Cargo.toml`
3. `git diff --check`
