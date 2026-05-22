# Sprint 473 Contract: Search Adapter Contract

## Goal

Promote `SearchAdapter` from marker concept to a real contract before
Elasticsearch/OpenSearch implementation begins.

## Dependencies

- Depends on: 447.
- Parallel lane: search/foundation.
- Blocks: 474-476.

## Scope

- Define index browse, mapping retrieval, alias/template basics, search
  execution, aggregation result handling, document edit boundaries, and safety
  hooks.
- Define search hit and aggregation result envelopes.
- Define fixture/testcontainer strategy for Elasticsearch and OpenSearch.
- Add contract or mock conformance tests.

## Acceptance Criteria

- AC-473-01: Search implementation has a real adapter target.
- AC-473-02: Search result envelopes are typed.
- AC-473-03: Delete-by-query/wildcard destructive operations have safety hooks.
- AC-473-04: Elasticsearch/OpenSearch deltas can be represented.

## Out of Scope

- Search UI implementation.
- Cluster administration.
- Observability dashboards.

## Verification Plan

1. Adapter contract tests.
2. Mock conformance tests.
3. Typecheck/cargo check for touched surfaces.
