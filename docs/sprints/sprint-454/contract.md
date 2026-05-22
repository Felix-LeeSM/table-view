---
review-profile: code
---

# Sprint 454 Contract: SQLite Write-Parity Guardrails

## Goal

Define and implement safe SQLite write/edit guardrails before claiming SQLite
parity.

## Dependencies

- Depends on: 453.
- Parallel lane: rdbms/sqlite.
- Blocks: 459.

## Scope

- Audit current row edit, DDL, transaction, and constraint assumptions against
  SQLite behavior.
- Enable only safe write paths with explicit tests.
- Disable or explain unsupported ALTER/rebuild behavior until a future ADR
  chooses an implementation.
- Preserve read-only file mode.

## Acceptance Criteria

- AC-454-01: Read-only SQLite files cannot be edited.
- AC-454-02: Enabled edits honor primary key/row identity assumptions.
- AC-454-03: Unsupported DDL is blocked with clear UI/runtime behavior.
- AC-454-04: SQLite parity claim remains scoped to tested workflows.

## Out of Scope

- Automatic ALTER TABLE rebuild strategy.
- Full SQLite pragma management.
- Cross-file attach workflow.

## Verification Plan

1. SQLite write fixture tests.
2. Read-only mode tests.
3. Focused row edit UI tests.

### Required Checks

1. `pnpm exec tsc -b --pretty false`
2. `cargo check --manifest-path src-tauri/Cargo.toml`
3. `git diff --check`
