# Sprint 477 Handoff: Cross-Paradigm Fixture Harness

## What Landed

- Added `table_view_lib::db::fixtures`, an opt-in Rust harness for adapter tests.
- Adapter tests can request fixtures by:
  - `FixtureRequest::by_profile(DatabaseType::Elasticsearch)`
  - `FixtureRequest::by_family(DataSourceDialectFamily::Elasticsearch)`
  - `FixtureRequest::by_paradigm(Paradigm::Search)`
- Added a no-network Search pilot backed by the existing embedded
  `SearchEngineAdapter::fixture_elasticsearch()` and OpenSearch sibling fixture.
- Added local-first/privacy metadata, lifecycle metadata, seed labels, cleanup
  policy labels, and fixture capability labels.
- Added actionable missing-fixture diagnostics that print the requested selector,
  required capability filters, and available fixture candidates.

## Adapter Test Author Guide

Use the harness only from adapter-focused Rust tests. It is not wired into
frontend tests, global test setup, or CI startup.

```rust
use table_view_lib::{
    db::fixtures::{FixtureHarness, FixtureRequest},
    models::{DatabaseType, Paradigm},
};

let harness = FixtureHarness::local();
let fixture = harness
    .request(FixtureRequest::by_profile(DatabaseType::Elasticsearch).require_local_first())?;

let search = fixture.adapter.as_search()?;
let indexes = search.list_indexes().await?;
fixture.cleanup()?;
```

Selection rules:

- Prefer `by_profile` when a test targets one concrete data source.
- Use `by_family` when a shared adapter implementation must prove family
  behavior, for example MySQL/MariaDB or Elasticsearch/OpenSearch.
- Use `by_paradigm` only for broad contract tests that do not care which profile
  provides the representative fixture.
- Add `require_capability(...)` when a test needs a specific fixture surface
  such as catalog, query, safety-plan, no-network, or local-first behavior.
- Add `require_local_first()` when the test must prove it does not depend on
  cloud services, network access, or persisted secrets.

Failure diagnostics are intended to be pasted into the next fixture addition:
they include the selector, required capabilities, and the available fixture list.

## Current Fixtures

| Fixture ID | Selector Coverage | Lifecycle | Seed | Cleanup | Privacy |
|---|---|---|---|---|---|
| `search.elasticsearch.sample` | profile `Elasticsearch`, family `Elasticsearch`, paradigm `Search` | embedded static | `SearchCatalogFixture::sample(Elasticsearch)` | no-op | local-first, no network, no secrets |
| `search.opensearch.sample` | profile `Opensearch`, family `Opensearch`, paradigm `Search` | embedded static | `SearchCatalogFixture::sample(OpenSearch)` | no-op | local-first, no network, no secrets |

## Adding A Fixture

1. Add a `RegisteredFixture` entry in `src-tauri/src/db/fixtures.rs`.
2. Use an existing local fixture, embedded sample, local file, local container,
   or emulator/mock. Do not add paid cloud services.
3. Label lifecycle, seed source, cleanup policy, privacy assumptions, and
   capabilities.
4. Add or extend a focused test in `src-tauri/tests/fixture_harness.rs`.
5. If the fixture starts a container or touches a local file, keep startup behind
   `FixtureHarness::local().request(...)`; do not add global test setup.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml --test fixture_harness`
  passed for the Search pilot.

