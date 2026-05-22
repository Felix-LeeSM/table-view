# Sprint 474 Contract: Elasticsearch/OpenSearch Connection And Catalog

## Goal

Implement the first Search slice: connect, inspect cluster/index metadata, and
browse mappings safely.

## Dependencies

- Depends on: 473.
- Parallel lane: search/elastic.
- Blocks: 475 and 476.

## Scope

- Add Elasticsearch/OpenSearch profiles and URL/server connection fields.
- Browse indexes, aliases, mappings, and templates selected for the first slice.
- Preserve product identity and version/capability differences.
- Add fixture-backed tests.

## Acceptance Criteria

- AC-474-01: Elasticsearch and OpenSearch identities are distinct where needed.
- AC-474-02: Index/mapping browse works through the Search adapter.
- AC-474-03: Unsupported cluster/admin surfaces are not exposed as working.
- AC-474-04: Connection/auth failures are user-visible and safe.

## Out of Scope

- Search DSL execution.
- Document editing.
- Cluster admin.

## Verification Plan

1. Search fixture adapter tests.
2. Connection/catalog UI tests.
3. Version/capability tests.
