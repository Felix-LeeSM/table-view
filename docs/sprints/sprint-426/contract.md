# Sprint 426 Contract: Mongo Completion Alignment

## Goal

Keep Mongo autocomplete aligned with the executable mongosh whitelist and make
the context classifier a named boundary for later WASM-backed routing work.

## Acceptance Criteria

- AC-426-01: Collection method completion labels match
  `MONGOSH_METHOD_WHITELIST`.
- AC-426-02: `bulkWrite` is offered where the parser dispatch whitelist accepts
  it.
- AC-426-03: The MQL position classifier is exported as
  `classifyMongoCompletionPosition`.
- AC-426-04: Existing operator/stage/value routing behavior is covered by
  focused tests.

## Validation

```bash
pnpm vitest run src/lib/mongo/mongoAutocomplete.test.ts
```
