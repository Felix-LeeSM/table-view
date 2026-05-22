# Sprint 475 Contract: Search DSL Execution And Result Envelopes

## Goal

Add bounded Elasticsearch/OpenSearch query execution with typed search-hit and
aggregation result envelopes.

## Dependencies

- Depends on: 474.
- Parallel lane: search/elastic.
- Blocks: 476.

## Scope

- Execute selected Search DSL requests through the Search adapter.
- Render hits and aggregations through search result envelopes.
- Gate destructive operations and broad wildcard requests.
- Add syntax/help/completion ownership notes for Search DSL.

## Acceptance Criteria

- AC-475-01: Search queries return typed hits/aggregation envelopes.
- AC-475-02: Dangerous requests are blocked or require explicit confirmation.
- AC-475-03: Result rendering does not force search data into RDBMS grid-only
  semantics.
- AC-475-04: Unsupported DSL features fail clearly.

## Out of Scope

- Full Kibana parity.
- Query builder UI.
- Cluster admin APIs.

## Verification Plan

1. Search execution fixture tests.
2. Safety policy tests.
3. Result renderer UI tests.
