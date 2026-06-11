# Refactor 05 support-claim ledger

Issue: #759
Parent: #576
Milestone: 09.50 - Refactor 05 - Docs/Memory SOT Alignment
Base: `dd72cd9e40a29f17cfdd4a870b2161f73b37292c`

This audit maps product-visible support claims to contract tests and fixture
topology evidence after #756/#757/#758 closed. It does not widen product
support. The #758 compatibility ledger stays separate: compatibility paths can
preserve old behavior without becoming product support evidence.

Live GitHub state checked on 2026-06-12: #756, #757, and #758 are closed; PR
#847 merged #758 as `dd72cd9e40a29f17cfdd4a870b2161f73b37292c`; #759 is open;
the open repository PR list was empty before this branch was created.

## Scope inputs

| Source | Reason |
|---|---|
| `docs/product/README.md` | Product state, current support snapshot, fixture coverage, profile boundary. |
| `docs/product/query-language-support.md` | Runtime/parser/completion support boundaries. |
| `docs/product/known-limitations.md` | Product-visible unsupported boundaries. |
| `docs/contributor-guide/testing-and-quality.md` | Developer-facing smoke and verification matrix. |
| `docs/contributor-guide/fixture-test-topology-inventory.md` | Fixture/test topology inventory and smoke-promotion routing. |
| `e2e/fixtures/smoke-routing-decisions.json` | Machine-readable fixture promotion tiers. |
| `.github/workflows/e2e-smoke.yml`, `scripts/e2e-smoke-ci.sh` | Routine Runtime Happy Path wiring. |
| `scripts/fixtures/dbms-seeds.test.ts` | Static DBMS fixture inventory and proof-label checks. |
| `docs/archives/audits/refactor-05-compatibility-ledger-2026-06-12.md` | Compatibility ledger from #758; reference only, not a product support source. |

## Proof tiers

| Tier | Meaning |
|---|---|
| `blocking E2E` | Routine Runtime Happy Path evidence: the fixture/spec is wired by `scripts/e2e-smoke-ci.sh`, represented in `.github/workflows/e2e-smoke.yml`, and recorded as `blocking E2E` in `e2e/fixtures/smoke-routing-decisions.json`. |
| `focused runtime` | Backend/frontend/component/integration tests exercise a runtime path below the routine smoke tier. |
| `integration-backed` | Fixture harness or compatibility matrix evidence exists, but it is not direct Runtime Happy Path support. |
| `unit-only` | Static/parser/generator/profile evidence only; it can guard a contract or negative boundary but cannot promote runtime support. |
| `candidate-only` | Planned identity or future source category with no active profile/runtime/fixture/smoke support claim. |

## Claim ledger

| Claim | Docs row/path | Evidence paths | Proof tier | Action |
|---|---|---|---|---|
| Current support requires active connection profile, runtime adapter, parser/safety boundary, and fixture/live evidence together. | `docs/product/README.md` -> Supported Workflow Summary; Profile Registry Boundary | `src/types/dataSource.ts`; `src/types/adapterConformance.test.ts`; `src-tauri/tests/backend_adapter_contract_profile.rs`; `docs/contributor-guide/fixture-test-topology-inventory.md`; `e2e/fixtures/smoke-routing-decisions.json` | mixed: blocking E2E plus focused runtime | Preserve. This is the controlling product-support contract for every row below. |
| PostgreSQL is the strongest active lane, including routine connect/browse/edit/query, Explain, installed-extension completion gate, Safe Mode, raw DDL preview, grid edit, and cancellation slices. | `docs/product/README.md` -> Current Support Snapshot: PostgreSQL; `docs/product/query-language-support.md` -> PostgreSQL SQL | `e2e/smoke/postgres.spec.ts`; `e2e/smoke/postgres-safe-mode.spec.ts`; `e2e/smoke/postgres-explain.spec.ts`; `e2e/smoke/postgres-extension-completion.spec.ts`; `e2e/smoke/postgres-cancellation.spec.ts`; `e2e/fixtures/postgresql/query/seed.sql`; `src-tauri/tests/schema_integration.rs`; `src-tauri/tests/query_integration.rs` | blocking E2E plus focused runtime | Preserve bounded claim. Full dialect/admin/arbitrary extension/server activity parity remains unsupported. |
| MySQL supports bounded connection/catalog/query/edit/cancel/history/result-envelope and bounded DDL/catalog/completion slices, not stored-routine/admin/import/export parity. | `docs/product/README.md` -> Current Support Snapshot: MySQL; `docs/product/known-limitations.md` -> MySQL / MariaDB capabilities | `e2e/smoke/mysql.spec.ts`; `e2e/fixtures/mysql/query/seed.sql`; `src-tauri/tests/mysql_integration.rs`; `src-tauri/tests/cancel_mysql.rs`; `src/components/datagrid/sqlGenerator.test.ts`; `src/components/query/QueryTab/useQueryExecution.test.tsx`; `src/features/completion/sql/sqlCompletionContext.test.ts` | blocking E2E plus focused runtime | Preserve bounded claim. Completion and parser evidence stay editor/safety assistance unless runtime tests prove a path. |
| MariaDB has a distinct MariaDB identity and engine smoke baseline while intentionally reusing MySQL-family runtime/parser/completion paths. | `docs/product/README.md` -> Current Support Snapshot: MariaDB; `docs/product/query-language-support.md` -> MariaDB SQL Support Breakdown | `e2e/smoke/mariadb.spec.ts`; `e2e/fixtures/mariadb/query/seed.sql`; `src-tauri/tests/mariadb_ddl_preview.rs`; `src/components/datagrid/useDataGridEdit.mixed-batch.test.ts`; `src/lib/sql/ddlGenerator.test.ts` | blocking E2E plus focused runtime | Preserve split claim. Do not infer MariaDB-only `RETURNING`, routine/default, trigger CRUD, admin, import/export, or full vendor parity from shared MySQL-family evidence. |
| SQLite support is a file workflow with read/writable-file DML and PK-scoped row edit; DDL, sqlite-cli execution, and extension semantics are unsupported. | `docs/product/README.md` -> Current Support Snapshot: SQLite; `docs/product/known-limitations.md` -> SQLite | `e2e/smoke/sqlite.spec.ts`; `e2e/fixtures/sqlite/query/seed.sql`; `scripts/fixtures/dbms-seeds.test.ts`; `src-tauri/tests/data_source_profile_parity.rs` | blocking E2E plus focused contract | Preserve bounded file-workflow claim. Fixture and profile evidence do not widen DDL or extension support. |
| DuckDB support is `.duckdb` file open/browse/query/history/read-only smoke plus focused registered local file analytics preview/query/history/privacy evidence. | `docs/product/README.md` -> Current Support Snapshot: DuckDB; `docs/product/known-limitations.md` -> DuckDB | `e2e/smoke/duckdb.spec.ts`; `e2e/fixtures/duckdb/query/seed.sql`; `src-tauri/tests/duckdb_browse_query_adapter.rs`; `src-tauri/tests/duckdb_file_analytics.rs`; `src/components/query/DuckdbFileAnalyticsDialog.test.tsx`; `src/lib/tauri/fileAnalytics.test.ts` | blocking E2E plus focused runtime | Preserve narrow split. Do not promote file analytics to Runtime Happy Path, global query editor, import/export, or structured DDL/write parity. |
| MongoDB support is limited to whitelisted document workflow slices and destructive Safe Mode paths; arbitrary JavaScript shell behavior is not supported. | `docs/product/README.md` -> Current Support Snapshot: MongoDB; `docs/product/query-language-support.md` -> MongoDB Mongosh/MQL | `e2e/smoke/mongodb.spec.ts`; `e2e/fixtures/mongodb/document/seed.json`; `src-tauri/tests/mongo_integration.rs`; `src-tauri/tests/cancel_mongo.rs`; `src/lib/mongo/mongoshParser.test.ts`; `src/features/completion/mongo/mongoAutocomplete.test.ts`; `src/components/document/DocumentDataGrid.test.tsx`; `src/components/document/MqlPreviewModal.test.tsx`; `src/components/document/ValidatorPanel.test.tsx` | blocking E2E plus focused runtime | Preserve whitelist claim. Broader JavaScript, shell helper, cross-db navigation, and native document-first parity remain future gates. |
| Redis support is bounded KV workflow plus selected command allowlist, key suggestions, and value mutation controls; full CLI/admin/cluster/pubsub/modules parity is not claimed. | `docs/product/README.md` -> Current Support Snapshot: Redis; `docs/product/query-language-support.md` -> Redis Command Support Breakdown | `e2e/smoke/redis.spec.ts`; `e2e/fixtures/redis/kv/seed.json`; `src-tauri/tests/redis_integration.rs`; `src-tauri/src/db/redis/command_parser.rs`; `src-tauri/src/db/redis/command.rs`; `src/hooks/useRedisKeySuggestions.test.ts`; `src/features/completion/redis/redisCommandCompletion.test.ts`; `src/components/workspace/KvSidebar.mutations.test.tsx` | blocking E2E plus focused runtime | Preserve bounded KV/command claim. Command completion is editor assistance and does not promote unsupported families. |
| Valkey support is a bounded Redis-compatible runtime slice for proven local-runtime rows and wired smoke; it is not full Redis compatibility or direct mutation controls. | `docs/product/README.md` -> Current Support Snapshot: Valkey; `docs/product/query-language-support.md` -> Valkey Redis Compatibility Boundary | `e2e/smoke/valkey.spec.ts`; `e2e/fixtures/valkey/kv/seed.json`; `e2e/fixtures/valkey.redis-compatibility.json`; `scripts/fixtures/dbms-seeds.test.ts`; `src-tauri/tests/redis_integration.rs`; `src/features/completion/redis/redisCommandCompletion.test.ts` | blocking E2E plus integration-backed matrix | Preserve Valkey-specific boundary. Do not reuse Redis smoke as Valkey evidence and keep candidate/rejected command families unpromoted. |
| Elasticsearch and OpenSearch support bounded live connection/catalog/search/render/delete-plan workflows, with product-specific probe/catalog/completion deltas kept separate. | `docs/product/README.md` -> Current Support Snapshot: Elasticsearch/OpenSearch; `docs/product/query-language-support.md` -> Search DSL Support Breakdown | `e2e/smoke/elasticsearch.spec.ts`; `e2e/smoke/opensearch.spec.ts`; `e2e/smoke/search-runtime-smoke.ts`; `e2e/fixtures/elasticsearch/search/seed.json`; `e2e/fixtures/opensearch/search/seed.json`; `src-tauri/src/db/search_dsl.rs`; `src-tauri/src/db/search_live_query.rs`; `src-tauri/src/db/search_live_destructive.rs`; `src/lib/search/searchDslCompletion.test.ts`; `src/components/search/SearchResultView.test.tsx` | blocking E2E plus focused runtime | Preserve bounded Search claim. Actual live `_delete_by_query`, admin execution, observability, profile/explain workflow, and full language-core ownership remain deferred. |
| MSSQL supports SQL authentication, version probe, bounded query/catalog/edit/DDL/parser/completion slices, and wired representative smoke; TLS/admin/full T-SQL parity remains deferred. | `docs/product/README.md` -> Current Support Snapshot: MSSQL; `docs/product/query-language-support.md` -> MSSQL SQL | `e2e/smoke/mssql.spec.ts`; `e2e/fixtures/seed.mssql.sql`; `src-tauri/tests/mssql_connection_routing.rs`; `src-tauri/src/db/mssql/tests.rs`; `src-tauri/src/db/mssql/ddl_tests.rs`; `src-tauri/tests/backend_adapter_contract_profile.rs`; `src-tauri/sql-parser-core/src/completion/mssql_completion_tests.rs` | blocking E2E plus focused runtime | Preserve bounded SQL Server claim. Do not widen from seed fixture or completion/static parser evidence to TLS/admin/security/jobs/full semantic support. |
| Oracle supports service-name connection, bounded query/catalog/edit/DDL/parser/completion slices, and wired representative smoke; SID/TNS/wallet/TLS/raw admin/full PL/SQL remain deferred. | `docs/product/README.md` -> Current Support Snapshot: Oracle; `docs/product/query-language-support.md` -> Oracle SQL | `e2e/smoke/oracle.spec.ts`; `e2e/fixtures/seed.oracle.sql`; `src-tauri/src/db/oracle/tests.rs`; `src-tauri/src/db/oracle/ddl_tests.rs`; `src-tauri/tests/backend_adapter_contract_profile.rs`; `src/lib/sql/oracleSafety.test.ts`; `src-tauri/sql-parser-core/src/completion/completion_tests.rs` | blocking E2E plus focused runtime | Preserve bounded Oracle claim. Keep completion/static parser evidence as editor/safety assistance unless runtime support is separately proven. |
| Fixture Coverage Snapshot rows describe current evidence meaning; fixture existence alone never widens support. | `docs/product/README.md` -> Fixture Coverage Snapshot; `docs/contributor-guide/testing-and-quality.md` -> Fixture And Test Topology SOT | `docs/contributor-guide/fixture-test-topology-inventory.md`; `e2e/fixtures/smoke-routing-decisions.json`; `scripts/fixtures/dbms-seeds.test.ts`; `memory/engineering/conventions/testing-scenarios/fixtures/memory.md` | mixed: blocking E2E, integration-backed, unit-only | Preserve. New fixture roots need a consuming test, smoke-routing tier, and product/known-limitation review before support claims widen. |
| Profile or language identity presence does not equal runtime support, especially for Cassandra/Scylla, DynamoDB, graph, vector, and stream candidates. | `docs/product/README.md` -> Profile Registry Boundary; `docs/product/query-language-support.md` -> deferred language rows; `docs/contributor-guide/testing-and-quality.md` -> H6 Wider Source Candidate Smoke Matrix | `tests/fixtures/data-source-profile-parity.report.json`; `src/types/dataSourceProfileParity.test.ts`; `src-tauri/tests/data_source_profile_parity.rs`; `src/types/adapterContractTestMatrix.ts`; `docs/ROADMAP.md` | unit-only to candidate-only | Preserve candidate-only status. Promotion requires source-specific runtime, fixture, smoke, safety, result-envelope, and docs decisions. |
| Completion-only evidence is editor assistance and cannot widen runtime support. | `docs/product/query-language-support.md` -> Reading This Page; Redis/Valkey/Search/MSSQL/Oracle support rows | `src/features/completion/**`; `src/lib/search/searchDslCompletion.test.ts`; `src/hooks/useSearchAutocomplete.test.ts`; `src-tauri/sql-parser-core/src/completion/**`; `e2e/fixtures/valkey.redis-compatibility.json` | focused runtime or unit-only depending on row | Preserve boundary. Runtime claims require live or smoke evidence, not suggestion vocabulary alone. |
| Negative unsupported-boundary fixtures protect limitations and do not soften confirmations or promote unsupported support. | `docs/product/known-limitations.md`; `docs/contributor-guide/fixture-test-topology-inventory.md` -> unsupported-boundary rows | `tests/fixtures/unsupported_boundary_contracts.json`; `tests/fixtures/unsupported_boundary_contracts.test.ts`; `src/types/adapterContractTestMatrix.ts`; `src-tauri/tests/backend_safety_capability_contract.rs` | unit-only negative evidence | Preserve limitations. Unsupported-boundary evidence is a guardrail, not support promotion. |
| Non-routine E2E files do not expand the Runtime Happy Path claim unless the script/workflow wires them. | `docs/contributor-guide/testing-and-quality.md` -> H7 Ops, Security, And Reliability Smoke Matrix; `docs/contributor-guide/fixture-test-topology-inventory.md` -> Scenario Test Topology | `scripts/e2e-smoke-ci.sh`; `.github/workflows/e2e-smoke.yml`; `wdio.smoke.conf.ts`; `e2e/smoke/history-source-5.spec.ts`; `e2e/smoke/phase-28-slice-A.spec.ts` | dormant/manual until wired | Preserve. Keep non-routine specs as inventory/manual regression assets unless a promotion PR updates routing decisions and product docs. |
| Compatibility/fallback paths from #758 are not product support claims by themselves. | `docs/archives/audits/refactor-05-compatibility-ledger-2026-06-12.md` | `docs/archives/audits/refactor-05-compatibility-ledger-2026-06-12.md`; PR #847 evidence; #758 | compatibility ledger only | Reference only. Do not reopen #758 fields or convert compatibility rows into product support evidence. |

## Audit result

- No product support wording needed narrowing in this PR. Current product docs
  already separate runtime support, editor assistance, fixture-only evidence,
  compatibility paths, and planned/candidate identities.
- The durable action is this ledger plus links from product/contributor SOT
  pages so future support-claim edits have a single audit map.
- Any future support-claim widening must update the product row, fixture/test
  topology inventory, smoke-routing decision when fixtures are involved, and the
  relevant known-limitation or roadmap boundary.

## Verification commands

```bash
rg -n "fixture-only|completion-only|Runtime Happy Path|candidate|profile presence|does not widen|not claimed|unsupported" docs/product docs/contributor-guide e2e/fixtures scripts/fixtures src/types
pnpm exec tsx scripts/e2e-smoke-routing-decisions.ts
pnpm exec vitest run scripts/fixtures/dbms-seeds.test.ts tests/fixtures/unsupported_boundary_contracts.test.ts src/types/dataSourceProfileParity.test.ts
pnpm exec prettier --check docs/archives/audits/refactor-05-support-claims-ledger-2026-06-12.md docs/product/README.md docs/contributor-guide/testing-and-quality.md
git diff --check
```
