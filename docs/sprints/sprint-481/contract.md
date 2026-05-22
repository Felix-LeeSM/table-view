---
review-profile: code
---

# Sprint 481 Contract: Cross-Paradigm Release Gate

## Goal

Run the release-level integration gate for the broadened data-source platform
after the RDBMS, ERD, MongoDB, Redis/Valkey, Search, quality, language, and docs
lanes have landed.

## Dependencies

- Depends on: 459, 464, 468, 472, 476, 478, 479, 480.
- Parallel lane: release/join.
- Blocks: promotion of broader paradigms such as Cassandra, DynamoDB, graph,
  vector, and stream sources.

## Scope

- Verify all active data-source profiles, adapter contracts, query languages,
  result envelopes, safety policies, and conformance tests agree.
- Confirm user-facing support claims match tested behavior.
- Update `docs/PLAN.md`, `docs/ROADMAP.md`, `docs/RISKS.md`, and archive/index
  docs as needed.
- Decide which broader paradigm can be promoted next, if any.

## Acceptance Criteria

- AC-481-01: RDBMS, document, KV, and Search paths pass their declared gates.
- AC-481-02: ERD/SchemaGraph remains RDBMS-focused and reusable.
- AC-481-03: Capability gates avoid scattered `dbType` growth.
- AC-481-04: Next-paradigm promotion is a documented decision, not drift.

## Out of Scope

- Starting Cassandra/DynamoDB/graph/vector/stream implementation.
- Large state-management migration.
- New product promises beyond tested support.

## Verification Plan

1. Full affected test suite.
2. Adapter conformance matrix.
3. Manual release checklist for support claims.
4. Documentation and risk register review.

### Required Checks

1. `pnpm exec tsc -b --pretty false`
2. `cargo check --manifest-path src-tauri/Cargo.toml`
3. `git diff --check`
