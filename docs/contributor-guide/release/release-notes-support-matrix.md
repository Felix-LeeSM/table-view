# Release Notes And Support Matrix

This page is the release-note support boundary snapshot for the current release
readiness pass. Product support remains owned by
[`docs/product/README.md`](../../product/README.md), user-visible limitations by
[`docs/product/known-limitations.md`](../../product/known-limitations.md), query
boundaries by
[`docs/product/query-language-support.md`](../../product/query-language-support.md),
and verification gates by
[`docs/contributor-guide/testing-and-quality.md`](../testing-and-quality.md).

Release notes must not claim support beyond those SOTs. Fixture files, profile
rows, and compatibility inventories are release-note evidence only when the
matching runtime smoke, focused runtime test, or workflow path is wired and
green.

## Release Note Summary

Table View is a local-first desktop database client for connect -> browse ->
query -> edit -> review/commit workflows. Current user-visible support covers
PostgreSQL, MySQL, MariaDB, SQLite, DuckDB, MongoDB, Redis, Valkey,
Elasticsearch, OpenSearch, MSSQL, and Oracle within the bounded support
surfaces documented below.

Known limits to state in release notes:

- Full vendor-admin parity is not claimed. Backup/restore/import/export,
  role/user/permission management, server activity dashboards, and broad admin
  execution remain future gates unless a row below says otherwise.
- Completion is editor assistance. It does not widen runtime execution support.
- Fixture inventory is not live support evidence unless a smoke spec or focused
  runtime test exercises it.
- Desktop runtime smoke runs on Linux. In CI the `Runtime Happy Path` context
  runs the spec subset the PR's changed paths select, and the full suite on push
  to main, on the nightly schedule, and under the `e2e:full` label; anything
  outside that runs on a Linux host by hand. macOS and Windows desktop runtime
  smoke remain deferred.
- Search live index/settings admin execution, Redis/Valkey full CLI/admin
  parity, MongoDB arbitrary JavaScript shell behavior, MSSQL full
  T-SQL/SQLCMD/admin support, and Oracle SID/TNS/wallet/TLS/DDL/raw-admin/full
  PL/SQL support remain out of scope. Live `_delete_by_query` execution is not
  in this list — #1076 promoted it behind the Safe Mode confirm gate.
- DuckDB COPY/ATTACH/DETACH, extension install/load, raw external-file SQL
  functions, automatic import/export workflow, and admin parity remain out of
  scope. Native structural DDL (table create/drop/rename, column
  add/drop/type, index create/drop) is in scope as ADR 0051 Stage 2 (#1070);
  constraint add/drop, identity/auto-increment columns (Stage 2b), and
  dry-run/multi-statement transactions (Stage 3) stay out of scope.

## Support Matrix

| Source | Release-note support summary | Boundary pointer |
|---|---|---|
| PostgreSQL | Strongest RDBMS lane. Runtime smoke covers connect, browse, edit/query, Explain plan inspection, installed-extension-gated completion, Safe Mode, raw DDL preview, grid-edit preview, and cancellation UI/history/retry. | [`docs/product/README.md`](../../product/README.md), [`known-limitations.md`](../../product/known-limitations.md) |
| MySQL | Runtime/query/edit/catalog/DDL adapter is active for the tested MySQL-family baseline: connect, browse, SELECT, DML batch, row edit, cancellation, history labels, bounded DDL, and catalog-aware completion assistance. A read-only users/roles listing from `mysql.user` is active (#1077 Stage 2); user/role write management (create/alter/drop), role membership, and MySQL 8 dynamic privileges stay unsupported. | [`docs/product/README.md`](../../product/README.md), [`query-language-support.md`](../../product/query-language-support.md) |
| MariaDB | Distinct MariaDB identity and engine smoke baseline. Shared MySQL-family adapter paths are intentional and bounded; MariaDB-only syntax/admin/import/export claims are not widened. The `mysql.user` read-only users/roles listing (#1077 Stage 2) shares MySQL's adapter but not its SQL — MariaDB 10.4 made `mysql.user` a view over `mysql.global_priv`, so the lock flag and roles are read from there and the adapter branches on the engine. MariaDB roles appear under their bare name as non-loginable, and MariaDB-specific role-graph coverage is not claimed. | [`docs/product/README.md`](../../product/README.md), [`known-limitations.md`](../../product/known-limitations.md) |
| SQLite | File-backed workflow for open/create, browse, read query, writable-file DML, primary-key row edit, read-only rejection, and internal app-state DB separation. Structured DDL parity and sqlite-cli execution remain unsupported. | [`docs/product/README.md`](../../product/README.md), [`known-limitations.md`](../../product/known-limitations.md) |
| DuckDB | `.duckdb` file smoke supports connect, catalog/table read, raw SELECT, history evidence, writable DML readback, and read-only rejection. Dedicated file analytics smoke proves registered deterministic CSV source -> global editor SELECT -> result grid -> `FILE` history/source evidence -> no absolute local path in visible UI. | [`docs/product/README.md`](../../product/README.md), [`known-limitations.md`](../../product/known-limitations.md) |
| MongoDB | Whitelisted document workflow supports collection browse, MQL query/edit preview, selected admin/destructive confirmations, autocomplete, bulk/index/validator focused paths, and cancellation. Arbitrary JavaScript shell and native document-first result parity remain future work. | [`docs/product/README.md`](../../product/README.md), [`query-language-support.md`](../../product/query-language-support.md) |
| Redis | KV profile supports connection, key scan, typed value preview/edit, guarded string write, TTL, exact-key delete, bounded command dispatch, and bounded command/key completion. Full CLI/admin/cluster/pubsub/modules/consumer-group parity remains out of scope. | [`docs/product/README.md`](../../product/README.md), [`known-limitations.md`](../../product/known-limitations.md) |
| Valkey | Active KV runtime slice for connection, key scan/value preview, selected stream reads, selected Redis-compatible command query rows, bounded SET/EXPIRE, destructive/unsupported guards, the same string plus hash/list/set/zset KvMutationPanel write controls as Redis (#1075), and proven-row command completion. Valkey collection-write smoke coverage and full Redis compatibility are not claimed. | [`docs/product/README.md`](../../product/README.md), [`query-language-support.md`](../../product/query-language-support.md) |
| Elasticsearch | Live URL/auth/TLS root probe, live catalog, bounded `_search`, Search DSL validation, hand-run smoke coverage, delete-by-query safety planning, and live `_delete_by_query` execution behind the Safe Mode confirm gate (#1076) are active. Actual live index/settings admin execution and broader observability/profile/explain workflows remain deferred. | [`docs/product/README.md`](../../product/README.md), [`known-limitations.md`](../../product/known-limitations.md) |
| OpenSearch | OpenSearch-specific live root probe, Elasticsearch endpoint rejection, live catalog, bounded `_search`, mapping-aware completion, hand-run smoke coverage, delete-by-query safety planning, and live `_delete_by_query` execution behind the Safe Mode confirm gate (#1076) are active. Actual live index/settings admin execution remains deferred. | [`docs/product/README.md`](../../product/README.md), [`query-language-support.md`](../../product/query-language-support.md) |
| MSSQL | Bounded SQL authentication, catalog/query/cancel/tabular runtime, primary-key row edit through frontend SQL batch, bounded T-SQL editor guardrails, and representative hand-run smoke coverage are active. A read-only users/roles listing from `sys.server_principals` behind a `VIEW ANY DEFINITION` probe is active (#1077 Stage 2). Structured DDL, SQLCMD/admin/security/backup/jobs and user/role write management (create/alter/drop), broad parser/completion semantics, and full T-SQL semantics remain unsupported. | [`docs/product/README.md`](../../product/README.md), [`known-limitations.md`](../../product/known-limitations.md) |
| Oracle | Service-name lifecycle, bounded catalog/query/cancel/tabular runtime, primary-key row edit through frontend SQL batch, bounded Safe Mode classification, bounded editor assistance, and representative hand-run smoke coverage are supported for `host:port/serviceName` with default fixture service `XEPDB1`. SID, TNS, wallet, advanced auth, structured DDL, raw DDL/admin, full parser/completion promotion, and PL/SQL body/package work remain unsupported until Oracle-specific evidence lands. | [`docs/product/README.md`](../../product/README.md), [`known-limitations.md`](../../product/known-limitations.md) |

## Fixture And Smoke Coverage

[`.github/workflows/e2e-smoke.yml`](../../../.github/workflows/e2e-smoke.yml)
runs these specs under the `Runtime Happy Path` context, but a PR only runs the
subset its changed paths select, so a green PR is evidence for the rows those
specs cover and for no other row. The full suite covers every row below, with
one exception: `postgres-multi-table-edit.spec.ts` matches the PostgreSQL row's
glob but is outside the suite (`UNMAPPED_SPECS` in `e2e/scope-map.mjs` — 27
spec files on disk, 26 in the suite), so JOIN-result editing is hand-run
evidence only. The full suite runs on push to main, on the nightly schedule,
and on a PR carrying `e2e:full` once a push follows the label. For a release
SHA, either take the main-push run or run the suite by hand — the sequence is
in README 「E2E Smoke」.

| Source | Runtime smoke | Fixture or seed evidence | Release-note wording |
|---|---|---|---|
| PostgreSQL | `e2e/smoke/postgres*.spec.ts` | `e2e/fixtures/postgresql/query/seed.sql` | Strongest RDBMS smoke lane, including Explain, extension completion, Safe Mode, and cancellation specs. |
| MySQL | `e2e/smoke/mysql.spec.ts` | `e2e/fixtures/mysql/query/seed.sql` | Wired baseline for connect/browse/query/edit/cancel/history/result-envelope. |
| MariaDB | `e2e/smoke/mariadb.spec.ts` | `e2e/fixtures/mariadb/query/seed.sql` | Distinct MariaDB engine smoke plus catalog/workbench probe objects. |
| SQLite | `e2e/smoke/sqlite.spec.ts` | `e2e/fixtures/sqlite/query/seed.sql` | Deterministic file create/open, browse, query, writable DML, row edit, read-only rejection, and internal app-state DB rejection. |
| DuckDB | `e2e/smoke/duckdb.spec.ts`, `e2e/smoke/duckdb-file-analytics.spec.ts` | `e2e/fixtures/duckdb/query/seed.sql`, deterministic CSV source fixture | `.duckdb` file smoke stays separate from file analytics smoke; file analytics covers registered deterministic CSV source -> global editor SELECT -> result grid -> `FILE` history/source evidence -> no absolute local path in visible UI, not COPY/ATTACH/DETACH, extension install/load, raw external-file SQL functions, automatic import/export workflow, structured DDL/write UI, or admin parity. |
| MongoDB | `e2e/smoke/mongodb.spec.ts` | `e2e/fixtures/mongodb/document/seed.json` | Whitelisted document browse/edit/query/safety/cancel representative smoke. |
| Redis | `e2e/smoke/redis.spec.ts` | `e2e/fixtures/redis/kv/seed.json` | DB 2 connect/scan/preview/GET/guarded-write/TTL/delete representative smoke. |
| Valkey | `e2e/smoke/valkey.spec.ts` | `e2e/fixtures/valkey/kv/seed.json`, `e2e/fixtures/valkey.redis-compatibility.json` | Proven bounded Valkey command rows only; compatibility inventory is not full Redis compatibility evidence. |
| Elasticsearch | `e2e/smoke/elasticsearch.spec.ts` | `e2e/fixtures/elasticsearch/search/seed.json` | Live connect/catalog/search/render/delete-plan smoke; fixture is embedded contract evidence. |
| OpenSearch | `e2e/smoke/opensearch.spec.ts` | `e2e/fixtures/opensearch/search/seed.json` | OpenSearch-specific live connect/catalog/search/render/delete-plan smoke with product-separated deltas. |
| MSSQL | `e2e/smoke/mssql.spec.ts` | `e2e/fixtures/seed.mssql.sql` | SQL Server connect/catalog/SELECT/DML/row-edit/Safe Mode representative smoke. |
| Oracle | `e2e/smoke/oracle.spec.ts` | `e2e/fixtures/seed.oracle.sql` | Oracle service-name connect/catalog/SELECT/DML/row-edit/Safe Mode representative smoke; no Oracle structured DDL/raw-admin/full-parser-completion/PLSQL claim. |

## Release Note Checklist

Before publishing release notes:

- Link the notes back to
  [`docs/product/README.md`](../../product/README.md) and
  [`docs/product/known-limitations.md`](../../product/known-limitations.md).
- Mention smoke coverage only for the specs listed above, and only when a run
  on the release SHA actually covered them — the `main` push run and the nightly
  cover every spec, a PR run covers only what its changed paths selected, and a
  hand run covers what you invoked.
- Mention changed fixture/smoke coverage only when the fixture is wired to a
  runtime or focused test path.
- Keep deferred support visible instead of turning limitations into omissions.
- Re-run the
  [Pre-Release Verification Gate](../testing-and-quality.md) on the exact
  release SHA.
