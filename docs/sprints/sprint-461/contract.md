---
review-profile: code
---

# Sprint 461 Contract: SchemaGraph Relationship Normalizer

## Goal

Normalize foreign key and constraint relationships across RDBMS dialects so
SchemaGraph consumers do not need DBMS-specific relationship logic.

## Dependencies

- Depends on: 460.
- Parallel lane: erd/schema.
- Blocks: 462.

## Scope

- Normalize FK direction, composite key identity, constraint names, and missing
  metadata behavior.
- Preserve dialect-specific raw metadata where useful for debugging.
- Add fixtures for composite keys and partial metadata.
- Document unresolved relationship gaps.

## Acceptance Criteria

- AC-461-01: Composite and single-column FKs are represented consistently.
- AC-461-02: Relationship direction is stable for renderer/navigation use.
- AC-461-03: Dialect-specific quirks do not leak into ERD UI contracts.
- AC-461-04: Unknown relationships fail soft with diagnostics.

## Out of Scope

- Layout algorithm.
- ERD canvas.
- Migration impact analysis.

## Verification Plan

1. Relationship normalizer tests.
2. Dialect fixture tests.
3. Typecheck.

### Required Checks

1. `pnpm exec tsc -b --pretty false`
2. `cargo check --manifest-path src-tauri/Cargo.toml`
3. `git diff --check`
