# Sprint 469 Handoff: Search Adapter Contract

## Gate Result

Sprint 469 promotes Search from marker-only to a typed adapter contract.
`SearchAdapter` now declares cluster identity, index/alias/template catalog,
mapping lookup, Search DSL result envelopes, and delete-by-query safety
planning.

## Closed By This Sprint

- Added typed Rust search models in `src-tauri/src/models/search.rs`.
- Added typed frontend search envelopes in `src/types/search.ts`.
- Extended `SearchAdapter` with explicit catalog/query/safety methods and safe
  default `Unsupported` behavior.
- Added delete-by-query safety validation for wildcard and execution paths.
- Added product delta model for Elasticsearch vs OpenSearch capability
  differences.

## Acceptance Criteria

| AC | Evidence |
|---|---|
| AC-469-01 | `SearchEngineAdapter` implements the expanded `SearchAdapter` contract. |
| AC-469-02 | `SearchResultEnvelope`, `SearchHitEnvelope`, and aggregation envelopes exist in Rust and TS. |
| AC-469-03 | `SearchDeleteByQueryRequest` requires preview or explicit risk acknowledgement + expected target. |
| AC-469-04 | `SearchProductDelta` captures Elastic license API vs OpenSearch plugins API differences. |

## Verification

- `pnpm exec tsc -b --pretty false`
- `cargo check --manifest-path src-tauri/Cargo.toml`

## Deferred

- Search DSL execution UI remains Sprint 471 scope.
- Live HTTP client/network parsing is deferred; Sprint 470 fixture adapter pins
  catalog shape and safe unsupported failures.
