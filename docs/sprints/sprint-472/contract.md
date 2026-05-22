---
review-profile: code
---

# Sprint 472 Contract: Elasticsearch/OpenSearch Integration Gate

## Goal

Verify Elasticsearch/OpenSearch support is coherent enough to become the
first-class Search paradigm baseline.

## Dependencies

- Depends on: 471.
- Parallel lane: search/join.
- Blocks: release-level non-RDBMS claims.

## Scope

- Review Search profile, adapter contract, connection, catalog, query execution,
  result envelopes, product/version deltas, and safety policy together.
- Verify unsupported admin surfaces remain hidden or disabled.
- Update risks/docs for deferred Search features.

## Acceptance Criteria

- AC-472-01: Elasticsearch/OpenSearch support claims match tested workflows.
- AC-472-02: Search UI does not rely on RDBMS table assumptions.
- AC-472-03: Destructive requests remain gated.
- AC-472-04: Deferred admin/observability gaps are documented.

## Out of Scope

- Redis/MongoDB work.
- Full observability dashboards.
- Cluster administration.

## Verification Plan

1. Full affected Search tests.
2. Cross-paradigm query/result regression tests.
3. Typecheck/lint/hook gate.

### Required Checks

1. `pnpm exec tsc -b --pretty false`
2. `cargo check --manifest-path src-tauri/Cargo.toml`
3. `git diff --check`
