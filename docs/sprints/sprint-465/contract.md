# Sprint 465 Contract: MongoDB Profile And Capability Normalization

## Goal

Resume MongoDB work by aligning it to the data-source architecture rather than
expanding the old `queryMode` path.

## Dependencies

- Depends on: 447.
- Parallel lane: document/mongo.
- Can run after RDBMS-first work only with user approval.

## Scope

- Normalize MongoDB profile, capabilities, query language, catalog model, result
  kinds, and safety policy.
- Preserve existing subagent/Phase 28 findings as input without auto-merging
  unrelated code.
- Identify old RDBMS assumptions still leaking into MongoDB UI.
- Add focused tests for profile/capability behavior.

## Acceptance Criteria

- AC-465-01: MongoDB is a document source with explicit capabilities.
- AC-465-02: `queryLanguage` owns future routing; `queryMode` remains legacy.
- AC-465-03: Existing MongoDB behavior does not regress.
- AC-465-04: Remaining MongoDB gaps are tracked.

## Out of Scope

- Arbitrary JavaScript shell execution.
- Broad document editor changes.
- Automatic integration of earlier subagent work.

## Verification Plan

1. Mongo profile/capability tests.
2. Focused query tab compatibility tests.
3. Documentation gap review.
