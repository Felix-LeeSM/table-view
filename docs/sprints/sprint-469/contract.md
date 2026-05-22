---
review-profile: code
---

# Sprint 469 Contract: Search Adapter Contract

## Goal

Promote `SearchAdapter` from marker concept to a real contract before
Elasticsearch/OpenSearch implementation begins.

## Dependencies

- Depends on: 447.
- Parallel lane: search/foundation.
- Blocks: 470-472.

## Scope

- Define index browse, mapping retrieval, alias/template basics, search
  execution, aggregation result handling, document edit boundaries, and safety
  hooks.
- Define search hit and aggregation result envelopes.
- Define fixture/testcontainer strategy for Elasticsearch and OpenSearch.
- Add contract or mock conformance tests.

## Acceptance Criteria

- AC-469-01: Search implementation has a real adapter target.
- AC-469-02: Search result envelopes are typed.
- AC-469-03: Delete-by-query/wildcard destructive operations have safety hooks.
- AC-469-04: Elasticsearch/OpenSearch deltas can be represented.

## Out of Scope

- Search UI implementation.
- Cluster administration.
- Observability dashboards.

## Verification Plan

1. Adapter contract tests.
2. Mock conformance tests.
3. Typecheck/cargo check for touched surfaces.

### Required Checks

1. `pnpm exec tsc -b --pretty false`
2. `cargo check --manifest-path src-tauri/Cargo.toml`
3. `git diff --check`
