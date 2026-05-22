# Sprint 443 Contract: Query Language Compatibility Layer

## Goal

Introduce `queryLanguage` as the forward routing key while preserving legacy
`queryMode` compatibility for existing tabs, history, and hydration.

## Dependencies

- Depends on: 440.
- Parallel lane: query boundary.
- Can run with: 442, 444, 445, 446.

## Scope

- Add `queryLanguage` to the query/editor boundary where it can be carried
  without changing execution.
- Map existing RDBMS queries to SQL and MongoDB queries to mongosh/MQL according
  to the profile.
- Keep `queryMode` as compatibility metadata only.
- Add hydration/new-tab tests for legacy and new state.

## Acceptance Criteria

- AC-443-01: Existing tabs and history still load.
- AC-443-02: New tabs have a deterministic `queryLanguage`.
- AC-443-03: Execution behavior is unchanged.
- AC-443-04: Code comments/docs do not describe `queryMode` as the future SOT.

## Out of Scope

- Parser changes.
- Completion changes.
- MongoDB execution expansion.

## Verification Plan

1. Query tab state tests.
2. Legacy hydration tests.
3. Typecheck.
