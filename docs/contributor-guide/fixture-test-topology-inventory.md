---
title: Fixture And Test Topology Inventory
type: refactor-evidence
issue: 750
updated: 2026-06-11
---

# Fixture And Test Topology Inventory

Issue #750 captures the current fixture and test topology before later Refactor
04 work moves, shims, or deletes anything. This inventory does not move
fixtures, change runtime behavior, or widen product support claims.

Live GitHub state checked on 2026-06-11:

- #750 is open in milestone `09.40 - Refactor 04 - Fixtures And Test Topology`.
- Branch `codex/issue-750-fixture-topology-inventory` had no open PR and no
  configured upstream at inventory time.
- The only open repository PR found during this pass was #832 on unrelated
  branch `codex/issue-747-postgres-ddl-emitters`.

## Command Evidence

Required inventory commands:

| Command | Result |
|---|---|
| `rg --files fixtures tests/fixtures e2e/fixtures` | 20 tracked fixture-root paths. |
| `rg -n "FixtureHarness\|dbms-seeds\|seed\\." src-tauri tests scripts e2e` | 195 matches; includes expected tracked fixture/test hits plus local cache noise under `src-tauri/target/**`. Cache hits are excluded from topology decisions by the repository topology SOT. |
| `pnpm exec vitest run scripts/fixtures/*.test.ts` | PASS: 10 files, 65 tests. |

Supporting checks:

| Command | Result |
|---|---|
| `git ls-files fixtures tests/fixtures e2e/fixtures` | Same 20 tracked fixture-root paths. |
| `git check-ignore -v fixtures tests/fixtures e2e/fixtures tests/fixtures/data-source-profile-parity.report.json` | No ignored tracked fixture roots reported. |
| `rg -n "data-source-profile-parity\\.report\|PROFILE_PARITY_REPORT\|profile parity report\|reportVersion" . --glob '!src-tauri/target/**' --glob '!target/**' --glob '!node_modules/**'` | Report fixture is consumed by TS and Rust parity tests; no writer was found in the repo. |
| `rg -n "writeFile\|writeFileSync\|fixture.*report\|report\\.json" scripts src src-tauri tests package.json --glob '!src-tauri/target/**' --glob '!target/**' --glob '!node_modules/**'` | Fixture CLI writes runtime/app-storage state, not tracked fixture-root inventory files. |

## Classification Summary

| Classification | Current paths | Evidence |
|---|---:|---|
| consumed | 20 tracked fixture-root paths plus `src-tauri/src/db/fixtures.rs` harness source | Every tracked fixture-root path is read by a fixture CLI, loader test, smoke seed path, smoke spec, parity test, or product support matrix test. |
| dormant | 1 tracked fixture-root path | `fixtures/profiles/e2e.yaml` is explicitly documented as a compiled but currently dormant static contract. It is still loaded by fixture tests and pre-smoke gate checks. |
| generated | none in tracked fixture roots | No tracked fixture-root writer found. Generator/runtime outputs are DB rows, local SQLite/DuckDB files, or app-storage connection state outside these roots. |
| removal candidate | none | No unreferenced tracked fixture-root path found in this pass. Later #751/#752 work can reclassify only with fresh reference and smoke evidence. |

## Fixture Topology Table

| fixture path | dbms/profile | lifecycle | consumed by tests | evidence tier | product docs row | smoke routing | action |
|---|---|---|---|---|---|---|---|
| `fixtures/base.yaml` | shared fixture generator schema for PostgreSQL, MongoDB, MySQL, SQLite, DuckDB, MariaDB, MSSQL, Oracle, Redis | authored static generator spec | `scripts/fixtures/spec.test.ts`, `scripts/fixtures/generator.test.ts`, fixture CLI via `loadSpec()` | generator contract only; not product/runtime evidence | none | none directly; CLI fixture stack only | consumed; keep |
| `fixtures/profiles/development.yaml` | `development` profile | authored static generator profile | `scripts/fixtures/spec.test.ts`, `scripts/fixtures/index.ts`, `scripts/e2e-pre-smoke-release-gate.ts`, fixture stack tests | generator/profile contract only | none | none directly; `scripts/db/wait.sh` can seed Redis development fixture | consumed; keep |
| `fixtures/profiles/e2e.yaml` | `e2e` profile | authored static generator profile; file comment marks it dormant until WebDriver cold-start/OOM blocker is cleared | `scripts/fixtures/spec.test.ts`, `scripts/fixtures/generator.test.ts`, `scripts/fixtures/fixture-stack.test.ts`, `scripts/e2e-pre-smoke-release-gate.ts` | dormant static contract; not current Runtime Happy Path seed | none | none directly; current Runtime Happy Path uses `e2e/fixtures/seed.*` paths instead | dormant; keep |
| `tests/fixtures/data-source-profile-parity.report.json` | all `DatabaseType` profiles | authored static JSON report | `src/types/dataSourceProfileParity.test.ts`, `src-tauri/tests/data_source_profile_parity.rs` | TS/Rust strict profile parity contract; profile presence is not runtime support | none; product rows depend on profile/runtime evidence, not this report alone | none | consumed; keep |
| `tests/fixtures/fk_reference_samples.json` | RDB FK reference parser/serializer sample | authored static JSON fixture | `tests/fixtures/fk_reference_samples.test.ts`, `src-tauri/tests/fixture_loading.rs`, `src/components/datagrid/DataGridTable.parseFkReference.test.ts`, `src-tauri/src/db/postgres/schema.rs` tests | shared parser/serializer fixture; not product/runtime evidence | none | none | consumed; keep |
| `tests/fixtures/fk_reference_samples.test.ts` | RDB FK reference loader test | authored Vitest loader test colocated with fixture | `pnpm exec vitest run tests/fixtures/fk_reference_samples.test.ts` when selected by frontend tests | fixture loader evidence | none | none | consumed; keep as test source |
| `e2e/fixtures/seed-smoke.ts` | PostgreSQL, MongoDB, MySQL, MariaDB, MSSQL, Oracle, Redis, Valkey, Elasticsearch, OpenSearch | authored smoke seed orchestrator | `scripts/e2e-smoke-ci.sh`, `scripts/fixtures/dbms-seeds.test.ts` | Runtime Happy Path seed routing for external-service smoke targets | `docs/product/README.md` Current Support Snapshot and Fixture Coverage Snapshot rows for the routed DBMSs | invoked before `scripts/e2e-smoke-ci.sh` runs wired specs; maps SQLite/DuckDB to no external seed | consumed; keep |
| `e2e/fixtures/seed.sql` | PostgreSQL | authored idempotent SQL seed | `e2e/fixtures/seed-smoke.ts`, `scripts/fixtures/dbms-seeds.test.ts` | wired Runtime Happy Path seed | PostgreSQL row; Fixture Coverage Snapshot PostgreSQL row | `postgres`, `postgres-safe-mode`, `postgres-explain`, `postgres-extension-completion`, `postgres-cancellation` specs via seed target `postgres` | consumed; keep |
| `e2e/fixtures/seed.mysql.sql` | MySQL | authored idempotent SQL seed | `e2e/fixtures/seed-smoke.ts`, `scripts/fixtures/dbms-seeds.test.ts` | wired Runtime Happy Path seed | MySQL row; Fixture Coverage Snapshot MySQL row | `mysql` spec via seed target `mysql` | consumed; keep |
| `e2e/fixtures/seed.mariadb.sql` | MariaDB | authored idempotent SQL seed with catalog/workbench probes | `e2e/fixtures/seed-smoke.ts`, `scripts/fixtures/dbms-seeds.test.ts` | wired Runtime Happy Path seed plus catalog probe contract | MariaDB row; Fixture Coverage Snapshot MariaDB row | `mariadb` spec via seed target `mariadb` | consumed; keep |
| `e2e/fixtures/seed.mssql.sql` | MSSQL / SQL Server | authored SQL Server seed | `e2e/fixtures/seed-smoke.ts`, `scripts/fixtures/dbms-seeds.test.ts` | wired Runtime Happy Path seed | MSSQL row; Fixture Coverage Snapshot MSSQL row | `mssql` spec via seed target `mssql` | consumed; keep |
| `e2e/fixtures/seed.oracle.sql` | Oracle | authored Oracle seed | `e2e/fixtures/seed-smoke.ts`, `scripts/fixtures/dbms-seeds.test.ts`, `src-tauri/tests/oracle_smoke_boundary_probe.rs` ignored probes | wired Runtime Happy Path seed | Oracle row; Fixture Coverage Snapshot Oracle row | `oracle` spec via seed target `oracle` | consumed; keep |
| `e2e/fixtures/seed.sqlite.sql` | SQLite | authored local-file SQL seed | `e2e/smoke/sqlite.spec.ts`, `scripts/fixtures/dbms-seeds.test.ts` | wired Runtime Happy Path seed for file smoke | SQLite row; Fixture Coverage Snapshot SQLite row | `sqlite` spec reads file directly; `seed-smoke.ts` maps `sqlite` to no external seed | consumed; keep |
| `e2e/fixtures/seed.duckdb.sql` | DuckDB | authored local-file SQL seed | `e2e/smoke/duckdb.spec.ts`, `scripts/fixtures/dbms-seeds.test.ts` | wired Runtime Happy Path seed for `.duckdb` file smoke | DuckDB row; Fixture Coverage Snapshot DuckDB row | `duckdb` spec reads file directly; `seed-smoke.ts` maps `duckdb` to no external seed | consumed; keep |
| `e2e/fixtures/seed.mongodb.json` | MongoDB | authored idempotent document seed | `e2e/fixtures/seed-smoke.ts`, `scripts/fixtures/dbms-seeds.test.ts` | wired Runtime Happy Path seed | MongoDB row; Fixture Coverage Snapshot MongoDB row | `mongodb` spec and `phase-28-slice-A` seed target `mongodb`; only `mongodb` is routine script spec | consumed; keep |
| `e2e/fixtures/seed.redis.json` | Redis | authored idempotent KV seed | `e2e/fixtures/seed-smoke.ts`, `scripts/fixtures/dbms-seeds.test.ts` | wired Runtime Happy Path seed | Redis row; Fixture Coverage Snapshot Redis row | `redis` spec via seed target `redis` | consumed; keep |
| `e2e/fixtures/seed.valkey.json` | Valkey | authored Runtime Happy Path KV seed | `e2e/fixtures/seed-smoke.ts`, `scripts/fixtures/dbms-seeds.test.ts` | wired Runtime Happy Path seed | Valkey row; Fixture Coverage Snapshot Valkey row | `valkey` spec via seed target `valkey` | consumed; keep |
| `e2e/fixtures/valkey.redis-compatibility.json` | Valkey Redis compatibility matrix | authored static compatibility matrix | `scripts/fixtures/dbms-seeds.test.ts`, product/query-language docs | static matrix plus focused-runtime boundary; not full Redis compatibility evidence | Valkey row; Fixture Coverage Snapshot Valkey row; `docs/product/query-language-support.md` Valkey boundary row | no direct smoke execution; paired with `seed.valkey.json` evidence | consumed; keep |
| `e2e/fixtures/seed.search.elasticsearch.json` | Elasticsearch | authored Search seed JSON | `e2e/fixtures/seed-smoke.ts`, `scripts/fixtures/dbms-seeds.test.ts` | embedded Search fixture contract plus wired Runtime Happy Path seed | Elasticsearch/OpenSearch row; Fixture Coverage Snapshot Elasticsearch row | `elasticsearch` spec via seed target `elasticsearch` | consumed; keep |
| `e2e/fixtures/seed.search.opensearch.json` | OpenSearch | authored Search seed JSON | `e2e/fixtures/seed-smoke.ts`, `scripts/fixtures/dbms-seeds.test.ts` | embedded Search fixture contract plus wired Runtime Happy Path seed | Elasticsearch/OpenSearch row; Fixture Coverage Snapshot OpenSearch row | `opensearch` spec via seed target `opensearch` | consumed; keep |
| `src-tauri/src/db/fixtures.rs` | Elasticsearch/OpenSearch fixture harness | authored Rust fixture harness with embedded static Search fixtures | `src-tauri/tests/fixture_harness.rs`, internal `#[cfg(test)]` module | local-first embedded fixture harness; DBMS seed files are separate | Search DSL / Elasticsearch/OpenSearch rows; Fixture Coverage Snapshot Search rows | none directly; harness backs focused adapter fixture tests, not `scripts/e2e-smoke-ci.sh` | consumed; keep; do not infer MSSQL/Oracle fixture presence from DBMS seed files |

## Smoke Routing Notes

- Routine remote Runtime Happy Path routing is owned by
  `.github/workflows/e2e-smoke.yml` and `scripts/e2e-smoke-ci.sh`.
- `scripts/e2e-smoke-ci.sh` runs PostgreSQL, MySQL, MariaDB, MSSQL, Oracle,
  SQLite, DuckDB, MongoDB, Redis, Valkey, Elasticsearch, and OpenSearch specs.
- `e2e/fixtures/seed-smoke.ts` seeds external-service targets. SQLite and DuckDB
  smoke specs create local files and read their SQL seeds directly.
- `wdio.smoke.conf.ts` can discover more specs, but a fixture is routine smoke
  evidence only when the CI/script route wires the matching spec.
- `src-tauri/src/db/fixtures.rs` currently registers embedded Search fixtures
  for Elasticsearch and OpenSearch only. Missing RDBMS fixture diagnostics are
  intentional and tested.

## Scenario Test Topology

Routine remote smoke is the script-wired subset, not every file under
`e2e/smoke/**`.

| scenario surface | current files | fixture dependency | action |
|---|---|---|---|
| Routine Runtime Happy Path smoke | `postgres.spec.ts`, `postgres-safe-mode.spec.ts`, `postgres-explain.spec.ts`, `postgres-extension-completion.spec.ts`, `postgres-cancellation.spec.ts`, `mysql.spec.ts`, `mariadb.spec.ts`, `mssql.spec.ts`, `oracle.spec.ts`, `sqlite.spec.ts`, `duckdb.spec.ts`, `mongodb.spec.ts`, `redis.spec.ts`, `valkey.spec.ts`, `elasticsearch.spec.ts`, `opensearch.spec.ts` | Wired by `scripts/e2e-smoke-ci.sh`; service-backed specs seed through `e2e/fixtures/seed-smoke.ts`, while SQLite and DuckDB read local SQL seeds directly. | consumed; keep as routine gate |
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
