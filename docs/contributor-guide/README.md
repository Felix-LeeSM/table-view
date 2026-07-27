# Contributor Guide

Contributor-facing docs explain how to change the project safely. They should
describe current procedures and verification expectations, not historical
decision logs.

## Entries

- [`testing-and-quality.md`](testing-and-quality.md) — developer-facing
  verification gaps, quality follow-ups, the pre-release verification gate, and
  the index of the smoke matrix bands below.
- [`smoke-matrix/h1-data-source.md`](smoke-matrix/h1-data-source.md) —
  cross-adapter architecture boundary: profile/capability/adapter-contract
  registry, query-language and result-envelope ownership, per-DBMS
  connect-to-query journeys.
- [`smoke-matrix/h2-rdbms-parity.md`](smoke-matrix/h2-rdbms-parity.md) — RDBMS
  parity lanes and closure audits for PostgreSQL, MySQL, MariaDB, SQLite, and
  DuckDB `.duckdb` runtime smoke.
- [`smoke-matrix/postgresql-query-workbench.md`](smoke-matrix/postgresql-query-workbench.md) —
  PostgreSQL lane detail: query, catalog, parser/Safe Mode, completion, edit,
  Explain, cancellation.
- [`smoke-matrix/sqlite-file-dbms.md`](smoke-matrix/sqlite-file-dbms.md) —
  SQLite lane detail: file lifecycle, writable-file DML, catalog, row edit, DDL
  and unsupported `ALTER` behavior.
- [`smoke-matrix/h3-duckdb-file-analytics.md`](smoke-matrix/h3-duckdb-file-analytics.md) —
  DuckDB `.duckdb` runtime, registered CSV/Parquet/JSON/NDJSON analytics, and
  the local-file privacy/export and extension/`COPY` gates.
- [`smoke-matrix/h4-rdbms-intelligence.md`](smoke-matrix/h4-rdbms-intelligence.md) —
  schema metadata cache, ERD graph and renderer, dependency view, migration
  impact, schema diff, FK row navigation.
- [`smoke-matrix/h5-non-rdbms.md`](smoke-matrix/h5-non-rdbms.md) — non-RDBMS
  paradigms: MongoDB, Redis/Valkey, Elasticsearch/OpenSearch Search.
- [`smoke-matrix/h6-wider-source-candidates.md`](smoke-matrix/h6-wider-source-candidates.md) —
  MSSQL and Oracle runtime/smoke guardrails plus unpromoted wide-column,
  cloud-document, graph, vector, and stream candidates.
- [`smoke-matrix/h7-ops-security-reliability.md`](smoke-matrix/h7-ops-security-reliability.md) —
  CI/hook gate surface, destructive-operation safety, credential privacy,
  dependency security, a11y, performance, platform smoke, E2E isolation.
- [`repository-topology-inventory.md`](repository-topology-inventory.md) —
  Refactor 01 final repository root ownership, lifecycle, cleanup, hook-routing,
  and migration SOT.
- [`fixture-test-topology-inventory.md`](fixture-test-topology-inventory.md) —
  Refactor 04 fixture/test topology baseline and evidence classification.
- [`source-root-migration-constraints.md`](source-root-migration-constraints.md) —
  Refactor 02/03 source-root movement, compatibility export, test, fixture, and
  committed-generated-input constraints.
- [`pr-review.md`](pr-review.md) — reviewer output contract and red/green
  threshold.
- [`release/release-notes-support-matrix.md`](release/release-notes-support-matrix.md) —
  release-note support summary, support matrix, and fixture/smoke coverage.
- [`release/versioning-and-artifacts.md`](release/versioning-and-artifacts.md) —
  version/tag decision, artifact expectations, post-release verification, and
  rollback notes.
- [`release/homebrew-cask.md`](release/homebrew-cask.md) — Homebrew cask automation.
- [`release/updater-signing-key.md`](release/updater-signing-key.md) — minisign
  updater signing key: backup/escrow, rotation (with the bridge release for
  old installs), and loss/compromise response.
- [`memory/engineering/architecture/data-source/adding/memory.md`](../../memory/engineering/architecture/data-source/adding/memory.md) — checklist for adding or promoting a data source.

## Boundary

- Product-visible limitations live in
  [`docs/product/known-limitations.md`](../product/known-limitations.md) and its
  `known-limitations-{rdbms,non-rdbms,cross-cutting}.md` children, which own the
  per-source boundary entries.
- Future sequencing lives in [`docs/ROADMAP.md`](../ROADMAP.md).
- Historical records live under [`docs/archives/`](../archives/).
- Active engineering rules live under [`memory/engineering/`](../../memory/engineering/memory.md).
