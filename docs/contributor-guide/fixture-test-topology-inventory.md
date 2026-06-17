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
support claims still live in `docs/product/README.md`,
`docs/product/query-language-support.md`, and
`docs/product/known-limitations.md`.

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
| `rg --files fixtures tests/fixtures e2e/fixtures` | 23 tracked fixture-root paths. |
| `rg -n "FixtureHarness\|dbms-seeds\|seed\\." src-tauri tests scripts e2e --glob '!src-tauri/target/**' --glob '!target/**' --glob '!node_modules/**'` | 84 tracked-source matches; cache and dependency hits are excluded from topology decisions by the repository topology SOT. |
| `pnpm exec vitest run scripts/fixtures/*.test.ts tests/fixtures/*.test.ts` | PASS: 13 files, 98 tests. |

Supporting checks:

| Command | Result |
|---|---|
| `git ls-files fixtures tests/fixtures e2e/fixtures` | Same 23 tracked fixture-root paths. |
| `git check-ignore -v fixtures tests/fixtures e2e/fixtures tests/fixtures/data-source-profile-parity.report.json` | No ignored tracked fixture roots reported. |
| `rg -n "data-source-profile-parity\\.report\|PROFILE_PARITY_REPORT\|profile parity report\|reportVersion" . --glob '!src-tauri/target/**' --glob '!target/**' --glob '!node_modules/**'` | Report fixture is consumed by TS and Rust parity tests; no writer was found in the repo. |
| `rg -n "writeFile\|writeFileSync\|fixture.*report\|report\\.json" scripts src src-tauri tests package.json --glob '!src-tauri/target/**' --glob '!target/**' --glob '!node_modules/**'` | Fixture CLI writes runtime/app-storage state, not tracked fixture-root inventory files. |

## Classification Summary

| Classification | Current paths | Evidence |
|---|---:|---|
| consumed | 23 tracked fixture-root paths plus `src-tauri/src/db/fixtures.rs` harness source | Every tracked fixture-root path is read by a fixture CLI, loader test, smoke seed path, smoke spec, parity test, support-boundary test, or product support matrix test. |
| dormant | 1 tracked fixture-root path | `fixtures/profiles/e2e.yaml` is explicitly documented as a compiled but currently dormant static contract. It is still loaded by fixture tests and pre-smoke gate checks. |
| generated | none in tracked fixture roots | No tracked fixture-root writer found. Generator/runtime outputs are DB rows, local SQLite/DuckDB files, or app-storage connection state outside these roots. |
| removal candidate | none | No unreferenced tracked fixture-root path found in this pass. Later #751/#752 work can reclassify only with fresh reference and smoke evidence. |

## Fixture Topology Table

| fixture path | dbms/profile | lifecycle | consumed by tests | evidence tier | product docs row | smoke routing | action |
|---|---|---|---|---|---|---|---|
| `fixtures/base.yaml` | shared fixture generator schema for PostgreSQL, MongoDB, MySQL, SQLite, DuckDB, MariaDB, MSSQL, Oracle, Redis | authored static generator spec | `scripts/fixtures/spec.test.ts`, `scripts/fixtures/generator.test.ts`, fixture CLI via `loadSpec()` | generator contract only; not product/runtime evidence | none | none directly; CLI fixture stack only | consumed; keep |
| `fixtures/profiles/development.yaml` | `development` profile | authored static generator profile | `scripts/fixtures/spec.test.ts`, `scripts/fixtures/index.ts`, `scripts/e2e-pre-smoke-release-gate.ts`, fixture stack tests | generator/profile contract only | none | none directly; `scripts/db/wait.sh` can seed Redis development fixture | consumed; keep |
| `fixtures/profiles/e2e.yaml` | `e2e` profile | authored static generator profile; file comment marks it dormant until WebDriver cold-start/OOM blocker is cleared | `scripts/fixtures/spec.test.ts`, `scripts/fixtures/generator.test.ts`, `scripts/fixtures/fixture-stack.test.ts`, `scripts/e2e-pre-smoke-release-gate.ts` | dormant static contract; not current Runtime Happy Path seed | none | none directly; current Runtime Happy Path uses DBMS/function topology paths under `e2e/fixtures/**` instead | dormant; keep |
| `tests/fixtures/data-source-profile-parity.report.json` | all `DatabaseType` profiles | authored static JSON report | `src/types/dataSourceProfileParity.test.ts`, `src-tauri/tests/data_source_profile_parity.rs` | TS/Rust strict profile parity contract; profile presence is not runtime support | none; product rows depend on profile/runtime evidence, not this report alone | none | consumed; keep |
| `tests/fixtures/fk_reference_samples.json` | RDB FK reference parser/serializer sample | authored static JSON fixture | `tests/fixtures/fk_reference_samples.test.ts`, `src-tauri/tests/fixture_loading.rs`, `src/components/datagrid/DataGridTable.parseFkReference.test.ts`, `src-tauri/src/db/postgres/schema.rs` tests | shared parser/serializer fixture; not product/runtime evidence | none | none | consumed; keep |
| `tests/fixtures/fk_reference_samples.test.ts` | RDB FK reference loader test | authored Vitest loader test colocated with fixture | `pnpm exec vitest run tests/fixtures/fk_reference_samples.test.ts` when selected by frontend tests | fixture loader evidence | none | none | consumed; keep as test source |
| `tests/fixtures/unsupported_boundary_contracts.json` | unsupported/partial-support support-boundary rows | authored static JSON fixture | `tests/fixtures/unsupported_boundary_contracts.test.ts` | negative support-boundary evidence only; not runtime support | known-limitations/query-language boundary rows | none | consumed; keep |
| `tests/fixtures/unsupported_boundary_contracts.test.ts` | unsupported-boundary loader/contract test | authored Vitest contract test colocated with fixture | `pnpm exec vitest run tests/fixtures/unsupported_boundary_contracts.test.ts` | support-boundary guard | none | none | consumed; keep as test source |
| `e2e/fixtures/seed-smoke.ts` | PostgreSQL, MongoDB, MySQL, MariaDB, Redis, Valkey, Elasticsearch, OpenSearch; MSSQL/Oracle only when explicitly selected | authored smoke seed orchestrator | `scripts/e2e-smoke-ci.sh`, `scripts/fixtures/dbms-seeds.test.ts` | Runtime Happy Path seed routing for wired external-service smoke targets; dormant seed inventory for MSSQL/Oracle | `docs/product/README.md` Current Support Snapshot and Fixture Coverage Snapshot rows for the routed DBMSs; MSSQL bounded runtime row; Oracle #905 bounded runtime row | invoked before `scripts/e2e-smoke-ci.sh` runs wired specs; maps SQLite/DuckDB to no external seed; MSSQL/Oracle are not in the default seed set | consumed; keep |
| `e2e/fixtures/smoke-routing-decisions.json` | all tracked fixture-root promotion decisions | authored machine-readable routing table | `scripts/e2e-smoke-routing-decisions.ts`, `scripts/e2e-smoke-ci.sh`, `scripts/fixtures/dbms-seeds.test.ts` | smoke promotion SOT; records unit/integration/dormant/blocking tier with cost/risk | supports product docs by preventing fixture-only claim widening | pre-smoke guard runs before script-wired smoke specs | consumed; keep |
| `e2e/fixtures/postgresql/query/seed.sql` | PostgreSQL | authored idempotent SQL seed | `e2e/fixtures/seed-smoke.ts`, `scripts/fixtures/dbms-seeds.test.ts` | wired Runtime Happy Path seed | PostgreSQL row; Fixture Coverage Snapshot PostgreSQL row | `postgres`, `postgres-safe-mode`, `postgres-explain`, `postgres-extension-completion`, `postgres-cancellation`, `postgres-structure-ddl` specs via seed target `postgres` | consumed; keep |
| `e2e/fixtures/mysql/query/seed.sql` | MySQL | authored idempotent SQL seed | `e2e/fixtures/seed-smoke.ts`, `scripts/fixtures/dbms-seeds.test.ts` | wired Runtime Happy Path seed | MySQL row; Fixture Coverage Snapshot MySQL row | `mysql` spec via seed target `mysql` | consumed; keep |
| `e2e/fixtures/mariadb/query/seed.sql` | MariaDB | authored idempotent SQL seed with catalog/workbench probes | `e2e/fixtures/seed-smoke.ts`, `scripts/fixtures/dbms-seeds.test.ts` | wired Runtime Happy Path seed plus catalog probe contract | MariaDB row; Fixture Coverage Snapshot MariaDB row | `mariadb` spec via seed target `mariadb` | consumed; keep |
| `e2e/fixtures/seed.mssql.sql` | MSSQL / SQL Server | authored SQL Server seed | `e2e/fixtures/seed-smoke.ts`, `scripts/fixtures/dbms-seeds.test.ts` | dormant E2E seed inventory; not product/runtime evidence | MSSQL declared-only row; Fixture Coverage Snapshot MSSQL row | explicit `mssql` seed target only; not wired into routine smoke | consumed; keep |
| `e2e/fixtures/seed.oracle.sql` | Oracle | authored Oracle seed | `e2e/fixtures/seed-smoke.ts`, `scripts/fixtures/dbms-seeds.test.ts`, `src-tauri/tests/oracle_smoke_boundary_probe.rs` ignored probes | dormant E2E seed inventory; not routine smoke, edit, DDL, parser/completion, or PL/SQL evidence | Oracle #905 bounded runtime row; Fixture Coverage Snapshot Oracle row | explicit `oracle` seed target only; not wired into routine smoke | consumed; keep |
| `e2e/fixtures/sqlite/query/seed.sql` | SQLite | authored local-file SQL seed | `e2e/smoke/sqlite.spec.ts`, `scripts/fixtures/dbms-seeds.test.ts` | wired Runtime Happy Path seed for file smoke | SQLite row; Fixture Coverage Snapshot SQLite row | `sqlite` spec reads file directly; `seed-smoke.ts` maps `sqlite` to no external seed | consumed; keep |
| `e2e/fixtures/duckdb/query/seed.sql` | DuckDB | authored local-file SQL seed | `e2e/smoke/duckdb.spec.ts`, `scripts/fixtures/dbms-seeds.test.ts` | wired Runtime Happy Path seed for `.duckdb` file smoke | DuckDB row; Fixture Coverage Snapshot DuckDB row | `duckdb` spec reads file directly; `seed-smoke.ts` maps `duckdb` to no external seed | consumed; keep |
| `e2e/fixtures/mongodb/document/seed.json` | MongoDB | authored idempotent document seed | `e2e/fixtures/seed-smoke.ts`, `scripts/fixtures/dbms-seeds.test.ts` | wired Runtime Happy Path seed | MongoDB row; Fixture Coverage Snapshot MongoDB row | `mongodb` spec and `phase-28-slice-A` seed target `mongodb`; only `mongodb` is routine script spec | consumed; keep |
| `e2e/fixtures/redis/kv/seed.json` | Redis | authored idempotent KV seed | `e2e/fixtures/seed-smoke.ts`, `scripts/fixtures/dbms-seeds.test.ts` | wired Runtime Happy Path seed | Redis row; Fixture Coverage Snapshot Redis row | `redis` spec via seed target `redis` | consumed; keep |
| `e2e/fixtures/valkey/kv/seed.json` | Valkey | authored Runtime Happy Path KV seed | `e2e/fixtures/seed-smoke.ts`, `scripts/fixtures/dbms-seeds.test.ts` | wired Runtime Happy Path seed | Valkey row; Fixture Coverage Snapshot Valkey row | `valkey` spec via seed target `valkey` | consumed; keep |
| `e2e/fixtures/valkey.redis-compatibility.json` | Valkey Redis compatibility matrix | authored static compatibility matrix | `scripts/fixtures/dbms-seeds.test.ts`, product/query-language docs | static matrix plus focused-runtime boundary; not full Redis compatibility evidence | Valkey row; Fixture Coverage Snapshot Valkey row; `docs/product/query-language-support.md` Valkey boundary row | no direct smoke execution; paired with `e2e/fixtures/valkey/kv/seed.json` evidence | consumed; keep |
| `e2e/fixtures/elasticsearch/search/seed.json` | Elasticsearch | authored Search seed JSON | `e2e/fixtures/seed-smoke.ts`, `scripts/fixtures/dbms-seeds.test.ts` | embedded Search fixture contract plus wired Runtime Happy Path seed | Elasticsearch/OpenSearch row; Fixture Coverage Snapshot Elasticsearch row | `elasticsearch` spec via seed target `elasticsearch` | consumed; keep |
| `e2e/fixtures/opensearch/search/seed.json` | OpenSearch | authored Search seed JSON | `e2e/fixtures/seed-smoke.ts`, `scripts/fixtures/dbms-seeds.test.ts` | embedded Search fixture contract plus wired Runtime Happy Path seed | Elasticsearch/OpenSearch row; Fixture Coverage Snapshot OpenSearch row | `opensearch` spec via seed target `opensearch` | consumed; keep |
| `src-tauri/src/db/fixtures.rs` | Elasticsearch/OpenSearch fixture harness | authored Rust fixture harness with embedded static Search fixtures | `src-tauri/tests/fixture_harness.rs`, internal `#[cfg(test)]` module | local-first embedded fixture harness; DBMS seed files are separate | Search DSL / Elasticsearch/OpenSearch rows; Fixture Coverage Snapshot Search rows | none directly; harness backs focused adapter fixture tests, not `scripts/e2e-smoke-ci.sh` | consumed; keep; do not infer MSSQL/Oracle fixture presence from DBMS seed files |

## Smoke Routing Notes

- Routine remote Runtime Happy Path routing is owned by
  `.github/workflows/e2e-smoke.yml` and `scripts/e2e-smoke-ci.sh`.
- `scripts/e2e-smoke-ci.sh` runs PostgreSQL, MySQL, MariaDB, SQLite, DuckDB,
  DuckDB file analytics, MongoDB, Redis, Valkey, Elasticsearch, and OpenSearch
  specs. MSSQL specs are dormant inventory until source-specific promotion
  re-wires them; Oracle specs are dormant inventory until #907 wires routine
  Oracle smoke.
- `e2e/fixtures/seed-smoke.ts` seeds external-service targets. SQLite and DuckDB
  smoke specs create local files and read their SQL seeds directly.
- `wdio.smoke.conf.ts` can discover more specs, but a fixture is routine smoke
  evidence only when the CI/script route wires the matching spec.
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
| #753 smoke routing | #843 | Added `e2e/fixtures/smoke-routing-decisions.json` and routing checks. |
| #754 unsupported boundaries | #838 | Added negative support-boundary fixture contracts. |
| #769 SQL fixtures | #837 | Moved SQL static seeds into DBMS/function topology. |
| #770 Document/KV/Search fixtures | #839 | Moved JSON seeds with capability/proof labels. |
| #771 loader shim | #842 | Added moved-seed compatibility guard and stale-path failure. |
| #772 SQL core tests | #840 | Split SQL generator contracts below smoke. |
| #773 UI/DDL tests | #841 | Split CreateTable and DDL scenario suites below smoke. |

## Issue #753 Smoke Promotion Decision Table

Machine-readable SOT: `e2e/fixtures/smoke-routing-decisions.json`.
`scripts/e2e-smoke-routing-decisions.ts` checks this table against
`scripts/e2e-smoke-ci.sh`, `.github/workflows/e2e-smoke.yml`, and
`e2e/fixtures/seed-smoke.ts` before the smoke script runs. Full cache-impact and
failure-artifact fields live in the JSON table; the summary below keeps the
required routing decision visible in docs.

Allowed tiers: `unit-only`, `integration-backed`, `dormant E2E`, `blocking E2E`.

| fixture | spec/test | tier | wired in `scripts/e2e-smoke-ci.sh`? | runtime cost | flake risk | support claim impact | action |
|---|---|---|---|---|---|---|---|
| `fixtures/base.yaml` | fixture generator tests | unit-only | no | none | low static parser risk | no runtime support claim | keep static generator contract |
| `fixtures/profiles/development.yaml` | fixture profile tests and pre-smoke gate | unit-only | no | none | low temp-dir profile risk | no runtime support claim | keep profile contract |
| `fixtures/profiles/e2e.yaml` | fixture profile tests and pre-smoke gate | dormant E2E | no | none until promoted | promotion needs fresh cold-start/OOM evidence | not Runtime Happy Path evidence | keep dormant |
| `tests/fixtures/data-source-profile-parity.report.json` | TS/Rust parity tests | unit-only | no | none | low static JSON risk | profile presence is not runtime support | keep parity contract |
| `tests/fixtures/fk_reference_samples.json` | FK parser/serializer tests | unit-only | no | none | low static JSON risk | parser wire-format evidence only | keep parser fixture |
| `tests/fixtures/unsupported_boundary_contracts.json` | unsupported-boundary contract test | unit-only | no | none | low static JSON/parser risk | negative evidence only | keep boundary guard |
| `e2e/fixtures/postgresql/query/seed.sql` | `postgres`, `postgres-safe-mode`, `postgres-explain`, `postgres-extension-completion`, `postgres-cancellation` | blocking E2E | yes | existing service-backed matrix route; no new #753 cost | existing Postgres runtime risk, isolated app data per spec | PostgreSQL documented slices only | keep blocking |
| `e2e/fixtures/mysql/query/seed.sql` | `mysql` | blocking E2E | yes | existing service-backed matrix route; no new #753 cost | existing MySQL container/runtime risk | bounded MySQL query/edit/cancel/history only | keep blocking |
| `e2e/fixtures/mariadb/query/seed.sql` | `mariadb` | blocking E2E | yes | existing service-backed matrix route; no new #753 cost | existing MariaDB container/runtime risk | MariaDB baseline slices, not full vendor parity | keep blocking |
| `e2e/fixtures/seed.mssql.sql` | `mssql` | dormant E2E | no | no routine runtime cost while declared-only | dormant until source-specific connection.test promotion | seed/spec inventory only; no SQL Server support claim | keep dormant |
| `e2e/fixtures/seed.oracle.sql` | `oracle` | dormant E2E | no | no routine runtime cost beyond #905 focused runtime evidence | dormant until #907 routine Oracle smoke promotion | seed/spec inventory only; no Oracle edit/DDL/PLSQL/runtime-smoke claim | keep dormant |
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

Routine remote smoke is the script-wired subset, not every file under
`e2e/smoke/**`.

| scenario surface | current files | fixture dependency | action |
|---|---|---|---|
| Routine Runtime Happy Path smoke | `postgres.spec.ts`, `postgres-safe-mode.spec.ts`, `postgres-explain.spec.ts`, `postgres-extension-completion.spec.ts`, `postgres-cancellation.spec.ts`, `postgres-structure-ddl.spec.ts`, `erd-dense.spec.ts`, `mysql.spec.ts`, `mariadb.spec.ts`, `sqlite.spec.ts`, `duckdb.spec.ts`, `duckdb-file-analytics.spec.ts`, `mongodb.spec.ts`, `redis.spec.ts`, `valkey.spec.ts`, `elasticsearch.spec.ts`, `opensearch.spec.ts` | Wired by `scripts/e2e-smoke-ci.sh`; service-backed specs seed through `e2e/fixtures/seed-smoke.ts`, while SQLite, DuckDB, and DuckDB file analytics read local file fixtures directly. MSSQL/Oracle specs are dormant inventory. | consumed; keep as routine gate |
| Non-routine E2E smoke assets | `history-source-5.spec.ts`, `phase-28-slice-A.spec.ts`, helper modules under `e2e/smoke/*.ts` | May reuse smoke helpers or fixture data, but not script-wired into the routine gate. | consumed/manual; keep out of support-claim expansion |
| Frontend fixture loader tests | `tests/fixtures/fk_reference_samples.test.ts`, `src/types/dataSourceProfileParity.test.ts` | Read tracked fixtures under `tests/fixtures/**`. | consumed; keep |
| Fixture CLI tests | `scripts/fixtures/*.test.ts` | Read `fixtures/**`, `e2e/fixtures/**`, workflow/script routing, and DBMS seed files. | consumed; keep |

Large scenario-style tests are not fixture roots, but later topology work should
treat them as refactor risk because they couple multiple support claims in one
file:

| current large scenario/test file | observed line count | reason to track |
|---|---:|---|
| `src-tauri/tests/mysql_integration.rs` | 3590 | MySQL runtime/query/catalog/cancel evidence shares one large integration file. |
| `src/components/datagrid/sqlGenerator.test.ts` | 2447 | Cross-DB row-edit SQL generation evidence is broad and fixture-adjacent. |
| `src/lib/sql/sqlSafety.test.ts` | 2179 | Parser/Safe Mode evidence spans many dialect and destructive-query paths. |
| `src/lib/sql/sqlAst.test.ts` | 2171 | SQL AST/parser fixture-style examples are concentrated in one frontend test. |
| `src-tauri/tests/schema_integration.rs` | 2136 | PostgreSQL schema/catalog evidence is broad and smoke-adjacent. |
| `src-tauri/tests/mongo_integration.rs` | 1954 | MongoDB runtime/query/edit/cancel evidence is broad and fixture-adjacent. |
| `src/hooks/useSqlAutocomplete.test.ts` | 1470 | Completion evidence spans dialect/context behavior below smoke. |
| `src-tauri/tests/query_integration.rs` | 1360 | PostgreSQL query/edit/runtime evidence is broad and smoke-adjacent. |

These files remain action `keep` in #750. Splitting, deleting, or moving them is
out of scope until later Refactor 04 children establish replacement evidence.
