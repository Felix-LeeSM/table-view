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
- Fixture inventory is not live support evidence unless wired by Runtime Happy
  Path or focused runtime tests.
- Runtime Happy Path is the Ubuntu/Linux CI desktop smoke surface. macOS and
  Windows desktop runtime smoke remain deferred.
- Search live admin execution, Redis/Valkey full CLI/admin parity, MongoDB
  arbitrary JavaScript shell behavior, MSSQL full T-SQL/SQLCMD/admin support,
  and Oracle SID/TNS/wallet/TLS/editRows/DDL/raw-admin/full PL/SQL/smoke support remain out of
  scope.
- DuckDB COPY/ATTACH/DETACH, extension install/load, raw external-file SQL
  functions, automatic import/export workflow, structured DDL/write UI, and
  admin parity remain out of scope.

## Support Matrix

| Source | Release-note support summary | Boundary pointer |
|---|---|---|
| PostgreSQL | Strongest RDBMS lane. Runtime smoke covers connect, browse, edit/query, Explain plan inspection, installed-extension-gated completion, Safe Mode, raw DDL preview, grid-edit preview, and cancellation UI/history/retry. | [`docs/product/README.md`](../../product/README.md), [`known-limitations.md`](../../product/known-limitations.md) |
| MySQL | Runtime/query/edit/catalog/DDL adapter is active for the tested MySQL-family baseline: connect, browse, SELECT, DML batch, row edit, cancellation, history labels, bounded DDL, and catalog-aware completion assistance. | [`docs/product/README.md`](../../product/README.md), [`query-language-support.md`](../../product/query-language-support.md) |
| MariaDB | Distinct MariaDB identity and engine smoke baseline. Shared MySQL-family adapter paths are intentional and bounded; MariaDB-only syntax/admin/import/export claims are not widened. | [`docs/product/README.md`](../../product/README.md), [`known-limitations.md`](../../product/known-limitations.md) |
| SQLite | File-backed workflow for open/create, browse, read query, writable-file DML, primary-key row edit, read-only rejection, and internal app-state DB separation. Structured DDL parity and sqlite-cli execution remain unsupported. | [`docs/product/README.md`](../../product/README.md), [`known-limitations.md`](../../product/known-limitations.md) |
| DuckDB | `.duckdb` file smoke supports connect, catalog/table read, raw SELECT, history evidence, writable DML readback, and read-only rejection. Dedicated file analytics smoke proves registered deterministic CSV source -> global editor SELECT -> result grid -> `FILE` history/source evidence -> no absolute local path in visible UI. | [`docs/product/README.md`](../../product/README.md), [`known-limitations.md`](../../product/known-limitations.md) |
| MongoDB | Whitelisted document workflow supports collection browse, MQL query/edit preview, selected admin/destructive confirmations, autocomplete, bulk/index/validator focused paths, and cancellation. Arbitrary JavaScript shell and native document-first result parity remain future work. | [`docs/product/README.md`](../../product/README.md), [`query-language-support.md`](../../product/query-language-support.md) |
| Redis | KV profile supports connection, key scan, typed value preview/edit, guarded string write, TTL, exact-key delete, bounded command dispatch, and bounded command/key completion. Full CLI/admin/cluster/pubsub/modules/consumer-group parity remains out of scope. | [`docs/product/README.md`](../../product/README.md), [`known-limitations.md`](../../product/known-limitations.md) |
| Valkey | Active KV runtime slice for connection, key scan/value preview, selected stream reads, selected Redis-compatible command query rows, bounded SET/EXPIRE, destructive/unsupported guards, direct UTF-8 string-key mutation controls, and proven-row command completion. Hash/list/set/zset writes and full Redis compatibility are not claimed. | [`docs/product/README.md`](../../product/README.md), [`query-language-support.md`](../../product/query-language-support.md) |
| Elasticsearch | Live URL/auth/TLS root probe, live catalog, bounded `_search`, Search DSL validation, Runtime Happy Path smoke, and delete-by-query safety planning are active. Actual live admin execution and broader observability/profile/explain workflows remain deferred. | [`docs/product/README.md`](../../product/README.md), [`known-limitations.md`](../../product/known-limitations.md) |
| OpenSearch | OpenSearch-specific live root probe, Elasticsearch endpoint rejection, live catalog, bounded `_search`, mapping-aware completion, Runtime Happy Path smoke, and delete-by-query safety planning are active. Actual live admin execution remains deferred. | [`docs/product/README.md`](../../product/README.md), [`query-language-support.md`](../../product/query-language-support.md) |
| MSSQL | Bounded SQL authentication, catalog/query/cancel/tabular runtime, primary-key row edit through frontend SQL batch, and bounded T-SQL editor guardrails are active. Structured DDL, SQLCMD/admin/security/backup/jobs/users/roles, broad parser/completion semantics, runtime smoke, and full T-SQL semantics remain unsupported. | [`docs/product/README.md`](../../product/README.md), [`known-limitations.md`](../../product/known-limitations.md) |
| Oracle | Service-name lifecycle plus bounded catalog/query/cancel/tabular runtime is supported for `host:port/serviceName` with default fixture service `XEPDB1`. SID, TNS, wallet, advanced auth, editRows, structured DDL, raw DDL/admin, parser/completion, PL/SQL body/package work, and representative Runtime Happy Path smoke remain unsupported until Oracle-specific evidence lands. | [`docs/product/README.md`](../../product/README.md), [`known-limitations.md`](../../product/known-limitations.md) |

## Fixture And Smoke Coverage

The current Runtime Happy Path workflow is
[`.github/workflows/e2e-smoke.yml`](../../../.github/workflows/e2e-smoke.yml).
The release gate requires the aggregate `Runtime Happy Path` check plus each
wired matrix leg to pass.

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
| Oracle | `e2e/smoke/oracle.spec.ts` | `e2e/fixtures/seed.oracle.sql` | Dormant inventory beyond #905 focused catalog/query/cancel/tabular runtime; no Oracle edit/DDL/Safe Mode/parser/completion/PLSQL/runtime smoke claim. |

## Release Note Checklist

Before publishing release notes:

- Link the notes back to
  [`docs/product/README.md`](../../product/README.md) and
  [`docs/product/known-limitations.md`](../../product/known-limitations.md).
- Mention the Runtime Happy Path matrix only for specs wired by the workflow.
- Mention changed fixture/smoke coverage only when the fixture is wired to a
  runtime or focused test path.
- Keep deferred support visible instead of turning limitations into omissions.
- Re-run the
  [Pre-Release Verification Gate](../testing-and-quality.md) on the exact
  release SHA.
