---
title: Fixture And Test Topology Inventory
type: refactor-evidence
issue: 750
closure_issue: 755
updated: 2026-06-12
---

# Fixture And Test Topology Inventory

Issue #750 captures the current fixture and test topology before later Refactor
04 work moves, shims, or deletes anything. This inventory does not move
fixtures, change runtime behavior, or widen product support claims.

Issue #755 keeps this page as the contributor-facing topology SOT after the
Refactor 04 fixture/test child issues landed. Durable workflow rules live in
`memory/engineering/conventions/testing-scenarios/fixtures/memory.md`; product
support claims still live in `docs/product/**` — the `README.md`,
`query-language-support.md`, and `known-limitations.md` indexes plus their child
pages.

Current GitHub closure state checked on 2026-06-12:

- #750/#751/#752/#753/#754/#755/#769/#770/#771/#772/#773 are closed as completed.
- Parent #575 is closed.
- Milestone `09.40 - Refactor 04 - Fixtures And Test Topology` is closed with
  0 open and 13 closed issues.
- The open repository PR observation before the #755 docs branch was historical
  delivery context, not a current repository-state claim.

## Command Evidence

Required inventory commands:

| Command | Result |
|---|---|
| `rg --files fixtures tests/fixtures e2e/fixtures` | 26 tracked fixture-root paths. |
| `rg -n "FixtureHarness\|dbms-seeds\|seed\\." src-tauri tests e2e --glob '!src-tauri/target/**' --glob '!target/**' --glob '!node_modules/**'` | 71 tracked-source matches; cache and dependency hits are excluded from topology decisions by the repository topology SOT. |
| `pnpm exec vitest run tests/fixtures/*.test.ts` | Fixture contract tests. |

Supporting checks:

| Command | Result |
|---|---|
| `git ls-files fixtures tests/fixtures e2e/fixtures` | Same 26 tracked fixture-root paths. |
| `git check-ignore -v fixtures tests/fixtures e2e/fixtures tests/fixtures/data-source-profile-parity.report.json` | No ignored tracked fixture roots reported. |
| `rg -n "data-source-profile-parity\\.report\|PROFILE_PARITY_REPORT\|profile parity report\|reportVersion" . --glob '!src-tauri/target/**' --glob '!target/**' --glob '!node_modules/**'` | Report fixture is consumed by TS and Rust parity tests; no writer was found in the repo. |
| `rg -n "writeFile\|writeFileSync\|fixture.*report\|report\\.json" src src-tauri tests package.json --glob '!src-tauri/target/**' --glob '!target/**' --glob '!node_modules/**'` | No `writeFile`/`writeFileSync` hit at all; the four matches are the parity report's own consumers and two unrelated Rust test names. Nothing in tracked source writes a fixture-root file. |

## Classification Summary

| Classification | Current paths | Evidence |
|---|---:|---|
| consumed | tracked paths under `tests/fixtures/**` and `e2e/fixtures/**`, plus `src-tauri/src/db/fixtures.rs` harness source | Each is read by a loader test, smoke seed path, smoke spec, parity test, support-boundary test, or product support matrix test. |
| dormant | `fixtures/profiles/e2e.yaml` | Documented in the file itself as a compiled but currently dormant static contract. |
| generated | none in tracked fixture roots | No tracked fixture-root writer found. Generator/runtime outputs are DB rows, local SQLite/DuckDB files, or app-storage connection state outside these roots. |
| unread | `fixtures/base.yaml`, `fixtures/profiles/development.yaml`, `fixtures/profiles/e2e.yaml` | Nothing in the repo loads the generator specs under `fixtures/**`. Keep or delete them through an owning issue, not as incidental cleanup. |

## Fixture Topology Table

| fixture path | dbms/profile | lifecycle | consumed by tests | evidence tier | product docs row | smoke routing | action |
|---|---|---|---|---|---|---|---|
| `fixtures/base.yaml` | shared fixture generator schema for PostgreSQL, MongoDB, MySQL, SQLite, DuckDB, MariaDB, MSSQL, Oracle, Redis | authored static generator spec | nothing reads it | generator contract only; not product/runtime evidence | none | none | unread; keep pending an owning issue |
| `fixtures/profiles/development.yaml` | `development` profile | authored static generator profile | nothing reads it | generator/profile contract only | none | none | unread; keep pending an owning issue |
| `fixtures/profiles/e2e.yaml` | `e2e` profile | authored static generator profile; file comment marks it dormant until WebDriver cold-start/OOM blocker is cleared | nothing reads it | dormant static contract; not a Runtime Happy Path seed | none | none; the DBMS/function topology paths under `e2e/fixtures/**` carry the seeds instead | dormant and unread; keep pending an owning issue |
| `tests/fixtures/data-source-profile-parity.report.json` | all `DatabaseType` profiles | authored static JSON report | `src/types/dataSourceProfileParity.test.ts`, `src-tauri/tests/data_source_profile_parity.rs` | TS/Rust strict profile parity contract; profile presence is not runtime support | none; product rows depend on profile/runtime evidence, not this report alone | none | consumed; keep |
| `tests/fixtures/fk_reference_samples.json` | RDB FK reference parser/serializer sample | authored static JSON fixture | `tests/fixtures/fk_reference_samples.test.ts`, `src-tauri/tests/fixture_loading.rs`, `src/components/datagrid/DataGridTable.parseFkReference.test.ts`, `src-tauri/src/db/postgres/schema.rs` tests | shared parser/serializer fixture; not product/runtime evidence | none | none | consumed; keep |
| `tests/fixtures/fk_reference_samples.test.ts` | RDB FK reference loader test | authored Vitest loader test colocated with fixture | `pnpm exec vitest run tests/fixtures/fk_reference_samples.test.ts` when selected by frontend tests | fixture loader evidence | none | none | consumed; keep as test source |
| `tests/fixtures/unsupported_boundary_contracts.json` | unsupported/partial-support support-boundary rows | authored static JSON fixture | `tests/fixtures/unsupported_boundary_contracts.test.ts` | negative support-boundary evidence only; not runtime support | known-limitations/query-language boundary rows | none | consumed; keep |
| `tests/fixtures/unsupported_boundary_contracts.test.ts` | unsupported-boundary loader/contract test | authored Vitest contract test colocated with fixture | `pnpm exec vitest run tests/fixtures/unsupported_boundary_contracts.test.ts` | support-boundary guard | none | none | consumed; keep as test source |
| `e2e/fixtures/seed-smoke.ts` | PostgreSQL, MongoDB, MySQL, MariaDB, Redis, Valkey, Elasticsearch, OpenSearch, MSSQL, Oracle | authored smoke seed orchestrator | run by hand as `E2E_SPEC_KEY=<spec> tsx e2e/fixtures/seed-smoke.ts` | Runtime Happy Path seed routing for external-service smoke targets | `docs/product/current-support-snapshot.md` and `docs/product/fixture-coverage-snapshot.md` rows for the routed DBMSs; MSSQL/Oracle bounded runtime and #907 smoke rows | run before the specs; maps SQLite/DuckDB to no external seed | consumed; keep |
| `e2e/fixtures/postgresql/query/seed.sql` | PostgreSQL | authored idempotent SQL seed | `e2e/fixtures/seed-smoke.ts` | wired Runtime Happy Path seed | PostgreSQL row; Fixture Coverage Snapshot PostgreSQL row | `postgres`, `postgres-safe-mode`, `postgres-explain`, `postgres-extension-completion`, `postgres-cancellation`, `postgres-structure-ddl` specs via seed target `postgres` | consumed; keep |
| `e2e/fixtures/mysql/query/seed.sql` | MySQL | authored idempotent SQL seed | `e2e/fixtures/seed-smoke.ts` | wired Runtime Happy Path seed | MySQL row; Fixture Coverage Snapshot MySQL row | `mysql` spec via seed target `mysql` | consumed; keep |
| `e2e/fixtures/mariadb/query/seed.sql` | MariaDB | authored idempotent SQL seed with catalog/workbench probes | `e2e/fixtures/seed-smoke.ts` | wired Runtime Happy Path seed plus catalog probe contract | MariaDB row; Fixture Coverage Snapshot MariaDB row | `mariadb` spec via seed target `mariadb` | consumed; keep |
| `e2e/fixtures/seed.mssql.sql` | MSSQL / SQL Server | authored SQL Server seed | `e2e/fixtures/seed-smoke.ts`, `e2e/smoke/mssql.spec.ts` | wired Runtime Happy Path seed for bounded SQL Server smoke | MSSQL #907 bounded runtime/smoke row; Fixture Coverage Snapshot MSSQL row | `mssql` spec, run with the SQL Server / Oracle service up | consumed; keep |
| `e2e/fixtures/seed.oracle.sql` | Oracle | authored Oracle seed | `e2e/fixtures/seed-smoke.ts`, `e2e/smoke/oracle.spec.ts`, `src-tauri/tests/oracle_smoke_boundary_probe.rs` ignored probes | wired Runtime Happy Path seed for bounded Oracle smoke; not structured DDL, full parser/completion promotion, or PL/SQL evidence | Oracle #905/#906/#907 bounded runtime/edit/smoke row; Fixture Coverage Snapshot Oracle row | `oracle` spec, run with the SQL Server / Oracle service up | consumed; keep |
| `e2e/fixtures/sqlite/query/seed.sql` | SQLite | authored local-file SQL seed | `e2e/smoke/sqlite.spec.ts` | wired Runtime Happy Path seed for file smoke | SQLite row; Fixture Coverage Snapshot SQLite row | `sqlite` spec reads file directly; `seed-smoke.ts` maps `sqlite` to no external seed | consumed; keep |
| `e2e/fixtures/duckdb/query/seed.sql` | DuckDB | authored local-file SQL seed | `e2e/smoke/duckdb.spec.ts` | wired Runtime Happy Path seed for `.duckdb` file smoke | DuckDB row; Fixture Coverage Snapshot DuckDB row | `duckdb` spec reads file directly; `seed-smoke.ts` maps `duckdb` to no external seed | consumed; keep |
| `e2e/fixtures/mongodb/document/seed.json` | MongoDB | authored idempotent document seed | `e2e/fixtures/seed-smoke.ts` | wired Runtime Happy Path seed | MongoDB row; Fixture Coverage Snapshot MongoDB row | `mongodb` spec and `phase-28-slice-A` seed target `mongodb` | consumed; keep |
| `e2e/fixtures/redis/kv/seed.json` | Redis | authored idempotent KV seed | `e2e/fixtures/seed-smoke.ts` | wired Runtime Happy Path seed | Redis row; Fixture Coverage Snapshot Redis row | `redis` spec via seed target `redis` | consumed; keep |
| `e2e/fixtures/valkey/kv/seed.json` | Valkey | authored Runtime Happy Path KV seed | `e2e/fixtures/seed-smoke.ts` | wired Runtime Happy Path seed | Valkey row; Fixture Coverage Snapshot Valkey row | `valkey` spec via seed target `valkey` | consumed; keep |
| `e2e/fixtures/valkey.redis-compatibility.json` | Valkey Redis compatibility matrix | authored static compatibility matrix | product/query-language docs | static matrix plus focused-runtime boundary; not full Redis compatibility evidence | Valkey row; Fixture Coverage Snapshot Valkey row; `docs/product/query-language-support.md` Valkey boundary row | no direct smoke execution; paired with `e2e/fixtures/valkey/kv/seed.json` evidence | consumed; keep |
| `e2e/fixtures/elasticsearch/search/seed.json` | Elasticsearch | authored Search seed JSON | `e2e/fixtures/seed-smoke.ts` | embedded Search fixture contract plus wired Runtime Happy Path seed | Elasticsearch/OpenSearch row; Fixture Coverage Snapshot Elasticsearch row | `elasticsearch` spec via seed target `elasticsearch` | consumed; keep |
| `e2e/fixtures/opensearch/search/seed.json` | OpenSearch | authored Search seed JSON | `e2e/fixtures/seed-smoke.ts` | embedded Search fixture contract plus wired Runtime Happy Path seed | Elasticsearch/OpenSearch row; Fixture Coverage Snapshot OpenSearch row | `opensearch` spec via seed target `opensearch` | consumed; keep |
| `src-tauri/src/db/fixtures.rs` | Elasticsearch/OpenSearch fixture harness | authored Rust fixture harness with embedded static Search fixtures | `src-tauri/tests/fixture_harness.rs`, internal `#[cfg(test)]` module | local-first embedded fixture harness; DBMS seed files are separate | Search DSL / Elasticsearch/OpenSearch rows; Fixture Coverage Snapshot Search rows | none directly; the harness backs focused adapter fixture tests, not smoke specs | consumed; keep; do not infer MSSQL/Oracle fixture presence from DBMS seed files |

## Smoke Routing Notes

- No CI job runs a smoke spec. `.github/workflows/e2e-smoke.yml` reports the
  `Runtime Happy Path` context and executes nothing behind it.
- `TABLE_VIEW_TEST_DATA_DIR=/tmp/table-view-smoke pnpm test:e2e:smoke` runs the
  specs by hand through `wdio.smoke.conf.ts`, whose `specs` glob is
  `e2e/smoke/**/*.spec.ts` — it picks up every spec file present. MSSQL and
  Oracle need their service up first. Dropping the variable points the app at
  your real connection store.
- `e2e/fixtures/seed-smoke.ts` seeds external-service targets. SQLite and DuckDB
  smoke specs create local files and read their SQL seeds directly.
- A fixture is runtime evidence only when someone runs the matching spec green
  and records it; fixture presence alone proves nothing.
- `src-tauri/src/db/fixtures.rs` currently registers embedded Search fixtures
  for Elasticsearch and OpenSearch only. Missing RDBMS fixture diagnostics are
  intentional and tested.

## Refactor 04 Closure Evidence

Parent #575 closed after #755 landed and live GitHub showed no open child issues
in milestone `09.40 - Refactor 04 - Fixtures And Test Topology`. Do not infer
future closure state from this table without a fresh issue/milestone check.

| Issue | Merged PR | SOT impact |
|---|---|---|
| #750 inventory baseline | #833 | Captured tracked fixture roots and large scenario-test risks. |
| #751 first fixture slice | #835 | Moved representative MySQL seed into DBMS/function topology. |
| #752 first test suite split | #836 | Split SQL safety contracts into fixture-backed suites. |
| #753 smoke routing | #843 | Added the smoke promotion decision table below. |
| #754 unsupported boundaries | #838 | Added negative support-boundary fixture contracts. |
| #769 SQL fixtures | #837 | Moved SQL static seeds into DBMS/function topology. |
| #770 Document/KV/Search fixtures | #839 | Moved JSON seeds with capability/proof labels. |
| #771 loader shim | #842 | Added moved-seed compatibility guard and stale-path failure. |
| #772 SQL core tests | #840 | Split SQL generator contracts below smoke. |
| #773 UI/DDL tests | #841 | Split CreateTable and DDL scenario suites below smoke. |

## Issue #753 Smoke Promotion Decision Table

This table is the promotion SOT. Nothing checks it against
`.github/workflows/e2e-smoke.yml` or `e2e/fixtures/seed-smoke.ts` — keep it
current by hand when a spec or seed target changes.

Allowed tiers: `unit-only`, `integration-backed`, `dormant E2E`, `blocking E2E`.
The `blocking E2E` tier records the intended promotion level, not a merge gate:
no smoke spec blocks a merge today.

| fixture | spec/test | tier | in the smoke suite | runtime cost | flake risk | support claim impact | action |
|---|---|---|---|---|---|---|---|
| `fixtures/base.yaml` | none | unit-only | no | none | low static parser risk | no runtime support claim | keep static generator contract |
| `fixtures/profiles/development.yaml` | none | unit-only | no | none | low temp-dir profile risk | no runtime support claim | keep profile contract |
| `fixtures/profiles/e2e.yaml` | none | dormant E2E | no | none until promoted | promotion needs fresh cold-start/OOM evidence | not Runtime Happy Path evidence | keep dormant |
| `tests/fixtures/data-source-profile-parity.report.json` | TS/Rust parity tests | unit-only | no | none | low static JSON risk | profile presence is not runtime support | keep parity contract |
| `tests/fixtures/fk_reference_samples.json` | FK parser/serializer tests | unit-only | no | none | low static JSON risk | parser wire-format evidence only | keep parser fixture |
| `tests/fixtures/unsupported_boundary_contracts.json` | unsupported-boundary contract test | unit-only | no | none | low static JSON/parser risk | negative evidence only | keep boundary guard |
| `e2e/fixtures/postgresql/query/seed.sql` | `postgres`, `postgres-safe-mode`, `postgres-explain`, `postgres-extension-completion`, `postgres-cancellation` | blocking E2E | yes | existing service-backed matrix route; no new #753 cost | existing Postgres runtime risk, isolated app data per spec | PostgreSQL documented slices only | keep blocking |
| `e2e/fixtures/mysql/query/seed.sql` | `mysql` | blocking E2E | yes | existing service-backed matrix route; no new #753 cost | existing MySQL container/runtime risk | bounded MySQL query/edit/cancel/history only | keep blocking |
| `e2e/fixtures/mariadb/query/seed.sql` | `mariadb` | blocking E2E | yes | existing service-backed matrix route; no new #753 cost | existing MariaDB container/runtime risk | MariaDB baseline slices, not full vendor parity | keep blocking |
| `e2e/fixtures/seed.mssql.sql` | `mssql` | blocking E2E | yes | enterprise RDBMS matrix starts SQL Server 2022 only for the MSSQL leg; shared prepared binary; max-parallel 1 | isolated SQL Server container/runtime risk | bounded SQL Server connect/catalog/query/edit/safety/cancel only | keep blocking |
| `e2e/fixtures/seed.oracle.sql` | `oracle` | blocking E2E | yes | enterprise RDBMS matrix starts Oracle XE 21 only for the Oracle leg; shared prepared binary; max-parallel 1 | isolated Oracle container/runtime risk | bounded Oracle service-name connect/catalog/query/edit/safety/cancel only; no structured DDL/PLSQL claim | keep blocking |
| `e2e/fixtures/sqlite/query/seed.sql` | `sqlite` | blocking E2E | yes | existing file-backed matrix route; no service cost | lower file-local risk | SQLite file workflow/query/edit/guardrails only | keep blocking |
| `e2e/fixtures/duckdb/query/seed.sql` | `duckdb` | blocking E2E | yes | existing file-backed-style route; no external service cost | lower file-local risk | DuckDB file open/browse/query/history/read-only only | keep blocking |
| `e2e/fixtures/mongodb/document/seed.json` | `mongodb` | blocking E2E | yes | existing service-backed matrix route; no new #753 cost | existing MongoDB container/runtime risk | whitelisted MongoDB document workflows only | keep blocking |
| `e2e/fixtures/redis/kv/seed.json` | `redis` | blocking E2E | yes | existing service-backed matrix route; no new #753 cost | low isolated DB 2 seed risk | bounded Redis KV workflow only | keep blocking |
| `e2e/fixtures/valkey/kv/seed.json` | `valkey` | blocking E2E | yes | existing service-backed matrix route; no new #753 cost | low isolated DB 2 seed risk | bounded Valkey KV workflow only | keep blocking |
| `e2e/fixtures/elasticsearch/search/seed.json` | `elasticsearch` | blocking E2E | yes | existing service-backed matrix route; no new #753 cost | existing Elasticsearch JVM/runtime risk | bounded Search connect/catalog/query/delete-plan only | keep blocking |
| `e2e/fixtures/opensearch/search/seed.json` | `opensearch` | blocking E2E | yes | existing on-demand OpenSearch route; no new #753 cost | higher cold-start JVM risk | bounded OpenSearch connect/catalog/query/delete-plan only | keep blocking |
| `e2e/fixtures/valkey.redis-compatibility.json` | Valkey compatibility fixture test | integration-backed | no | no routine WDIO cost | low static matrix risk | separates proven/candidate/rejected Redis compatibility rows | keep below blocking E2E |
| `src-tauri/src/db/fixtures.rs` | Search fixture harness tests | integration-backed | no | no routine WDIO cost | low embedded fixture risk | focused integration-backed Search fixture harness only | keep below blocking E2E |

## Scenario Test Topology

Every spec under `e2e/smoke/**` is manual. Nothing runs them for you.

| scenario surface | current files | fixture dependency | action |
|---|---|---|---|
| Runtime Happy Path smoke | `postgres.spec.ts`, `postgres-safe-mode.spec.ts`, `postgres-explain.spec.ts`, `postgres-extension-completion.spec.ts`, `postgres-cancellation.spec.ts`, `postgres-structure-ddl.spec.ts`, `erd-dense.spec.ts`, `mysql.spec.ts`, `mariadb.spec.ts`, `sqlite.spec.ts`, `duckdb.spec.ts`, `duckdb-file-analytics.spec.ts`, `mongodb.spec.ts`, `redis.spec.ts`, `valkey.spec.ts`, `elasticsearch.spec.ts`, `opensearch.spec.ts`, `mssql.spec.ts`, `oracle.spec.ts` | Service-backed specs seed through `e2e/fixtures/seed-smoke.ts`, while SQLite, DuckDB, and DuckDB file analytics read local file fixtures directly. MSSQL and Oracle need their service started first. | consumed; keep as the manual runtime evidence set |
| Other E2E smoke assets | `history-source-5.spec.ts`, `phase-28-slice-A.spec.ts`, helper modules under `e2e/smoke/*.ts` | May reuse smoke helpers or fixture data. | consumed/manual; keep out of support-claim expansion |
| Frontend fixture loader tests | `tests/fixtures/fk_reference_samples.test.ts`, `src/types/dataSourceProfileParity.test.ts` | Read tracked fixtures under `tests/fixtures/**`. | consumed; keep |

Large scenario-style tests are not fixture roots, but later topology work should
treat them as refactor risk because they couple multiple support claims in one
file:

| current large scenario/test file | observed line count | reason to track |
|---|---:|---|
| `src-tauri/tests/mysql_integration.rs` | 4977 | MySQL runtime/query/catalog/cancel evidence shares one large integration file. |
| `src-tauri/tests/schema_integration.rs` | 2512 | PostgreSQL schema/catalog evidence is broad and smoke-adjacent. |
| `src-tauri/tests/query_integration.rs` | 2249 | PostgreSQL query/edit/runtime evidence is broad and smoke-adjacent. |
| `src/lib/sql/sqlAst.test.ts` | 2171 | SQL AST/parser fixture-style examples are concentrated in one frontend test. |
| `src-tauri/tests/mongo_integration.rs` | 1978 | MongoDB runtime/query/edit/cancel evidence is broad and fixture-adjacent. |
| `src/hooks/useSqlAutocomplete.test.ts` | 1470 | Completion evidence spans dialect/context behavior below smoke. |

These files remain action `keep` in #750. Splitting, deleting, or moving them is
out of scope until later Refactor 04 children establish replacement evidence.
