# Sprint 472 Handoff: Elasticsearch/OpenSearch Integration Gate

## Gate Result

Elasticsearch/OpenSearch support is coherent as a fixture-backed Search slice:
typed identities/catalog fixtures, bounded fixture DSL execution, guarded
destructive planning, and `searchHits` rendering are verified together. Live
HTTP remains unsupported and is tracked as a follow-up risk.

## Closed By This Sprint

- Aligned Search support claims after Sprint 469-471 with the tested workflow:
  fixture identities/catalog, bounded fixture DSL execution, and typed result
  rendering.
- Fixed the bounded fixture executor to support the `terms` query claimed by
  the Sprint 471 handoff.
- Confirmed Search results render through `SearchResultView` and are not
  projected through the RDB grid compatibility path.
- Kept live HTTP, cluster administration, and observability explicitly deferred.

## Acceptance Criteria

| AC | Evidence |
|---|---|
| AC-472-01 | Fixture-backed identities/catalog and bounded DSL execution are verified; live HTTP remains `Unsupported`. |
| AC-472-02 | `searchHits` envelopes render through `SearchResultView`, with QueryResult projection rejecting the envelope kind. |
| AC-472-03 | Wildcard/raw-path search targets and delete-by-query planning remain gated by validation/confirmation. |
| AC-472-04 | `docs/PLAN.md`, `docs/RISKS.md`, and `docs/data-source-architecture.md` document live HTTP/admin/observability deferrals. |

## Verification

- RED evidence: `cargo test --manifest-path src-tauri/Cargo.toml search_executor::tests::fixture_search_supports_terms_query_claimed_by_contract` failed before implementation with `Search DSL query clause 'terms' is not supported`.
- `cargo test --manifest-path src-tauri/Cargo.toml search_executor::tests::fixture_search_supports_terms_query_claimed_by_contract`

## Deferred

- Live Elasticsearch/OpenSearch HTTP execution, auth, TLS, and response parsing.
- Cluster administration APIs and operational workflows.
- Observability dashboards, cluster metrics, and slow-search telemetry.
- Full Kibana/OpenSearch DSL parity and query builder UI.
