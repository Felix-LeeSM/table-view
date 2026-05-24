# Sprint 470 Handoff: Elasticsearch/OpenSearch Connection And Catalog

## Gate Result

Sprint 470 adds Elasticsearch and OpenSearch as distinct Search data-source
types with factory-backed backend adapter targets and fixture catalog coverage.
Live network connection returns a clear `Unsupported` error until the HTTP
client slice lands.

## Closed By This Sprint

- Added `DatabaseType::Elasticsearch` and `DatabaseType::Opensearch`.
- Added frontend database type labels, defaults, URL schemes, metadata, and
  connection-dialog entries with connection-only capabilities until live HTTP
  lands.
- Wired `make_adapter` to `ActiveAdapter::Search(SearchEngineAdapter)`.
- Added `SearchCatalogFixture` for Elasticsearch/OpenSearch identity, indexes,
  aliases, mappings, templates, and a typed search-hit envelope.
- Added safe network failure behavior: non-fixture Search adapters return
  `Unsupported` rather than pretending catalog/network support is live.

## Acceptance Criteria

| AC | Evidence |
|---|---|
| AC-470-01 | Separate `elasticsearch` and `opensearch` DB types, labels, defaults, dialect metadata, and fixture identities. |
| AC-470-02 | Fixture adapter returns index catalog, aliases, mappings, templates through `SearchAdapter`; frontend profile does not advertise live catalog/query support yet. |
| AC-470-03 | Cluster/admin surfaces beyond catalog/search safety planning are not exposed. |
| AC-470-04 | Network paths fail with explicit `Unsupported` messages; dialog profiles can surface the failure. |

## Verification

- `pnpm exec tsc -b --pretty false`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- Focused cargo test for `db::search::tests` attempted after cargo check.

## Deferred

- Live HTTP auth/TLS/client behavior.
- Live frontend catalog/search-document capabilities.
- Search DSL execution and result UI.
- Document editing and cluster administration.
