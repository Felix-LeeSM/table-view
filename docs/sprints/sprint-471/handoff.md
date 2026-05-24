# Sprint 471 Handoff: Search DSL Execution And Result Envelopes

## Gate Result

Sprint 471 adds bounded fixture-backed Search DSL execution for
Elasticsearch/OpenSearch adapters. `_search`-style requests now return typed
hit and aggregation envelopes through a Search adapter command path, while live
network adapters still fail clearly as unsupported.

## Closed By This Sprint

- Added bounded Search DSL fixture execution with `match_all`, `term`, `match`,
  `terms`, and `value_count` support.
- Added safety validation for empty targets, wildcard targets, raw/destructive
  path-shaped targets, unknown indexes/aliases, and unsupported top-level DSL
  features.
- Added `execute_search_query` Tauri command and frontend wrapper.
- Added a `searchHits` result-envelope boundary and `SearchResultView` renderer
  so search data is not coerced into the RDBMS grid projection.

## Acceptance Criteria

| AC | Evidence |
|---|---|
| AC-471-01 | Fixture search returns typed `SearchHitEnvelope` and `SearchAggregationEnvelope` results. |
| AC-471-02 | Wildcard and destructive path-shaped search targets are rejected; delete-by-query safety remains explicit. |
| AC-471-03 | `searchHits` envelopes fail QueryResult projection and render through `SearchResultView`. |
| AC-471-04 | Unsupported DSL features return `AppError::Unsupported` with the unsupported feature name. |

## Verification

- `pnpm exec tsc -b --pretty false`
- `cargo test --manifest-path src-tauri/Cargo.toml search::tests -- --nocapture`
- `pnpm vitest run src/types/query.resultEnvelope.test.ts src/lib/tauri/search.test.ts src/components/search/SearchResultView.test.tsx`

## Deferred

- Live Elasticsearch/OpenSearch HTTP execution, auth, TLS, and response parsing.
- Full Kibana DSL parity, query builder UI, and cluster admin APIs.
