---
review-profile: code
---

# Sprint 474 Contract: MongoDB Catalog And Result Envelope

## Goal

Make MongoDB collection browse and query results flow through document-aware
catalog and result envelope contracts.

## Dependencies

- Depends on: 473.
- Parallel lane: document/mongo.
- Blocks: 475 and 476.

## Scope

- Represent databases, collections, indexes, validators, and views through the
  document catalog model.
- Return find/aggregate results through document envelopes with compatible
  tabular projection where the current UI needs it.
- Preserve current whitelisted mongosh/MQL safety boundary.

## Acceptance Criteria

- AC-474-01: Collection catalog data does not masquerade as RDBMS schema data.
- AC-474-02: MongoDB query results have typed document envelopes.
- AC-474-03: Current table-like rendering remains available where supported.
- AC-474-04: Unsupported result shapes fail visibly.

## Out of Scope

- Document edit parity.
- Transaction UX.
- Arbitrary shell.

## Verification Plan

1. Document catalog tests.
2. Result envelope conversion tests.
3. Focused MongoDB query UI tests.

### Required Checks

1. `pnpm exec tsc -b --pretty false`
2. `cargo check --manifest-path src-tauri/Cargo.toml`
3. `git diff --check`
