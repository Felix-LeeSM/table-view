# Testing And Quality Follow-Ups

This page collects developer-facing verification gaps and quality follow-ups.
User-visible support boundaries live in
[`docs/product/known-limitations.md`](../product/known-limitations.md). Future
sequencing lives in [`docs/ROADMAP.md`](../ROADMAP.md). The retired risk register
is archived at
[`docs/archives/risks/active-risk-register-2026-05-27.md`](../archives/risks/active-risk-register-2026-05-27.md).

## Backend And Integration Coverage

| Area | Follow-up |
|---|---|
| Tauri commands | Add mock coverage for async connection commands such as connect, disconnect, and keep-alive behavior. |
| Integration skip policy | Normalize skip behavior between query and schema integration tests. |
| Docker-backed integration | Document or automate local DB service bootstrap for schema integration tests. |
| MariaDB fixture | Add a MariaDB engine fixture smoke, or keep public support claims narrowed. |

## Local Development And CI

| Area | Follow-up |
|---|---|
| Local DB ports | Make local DB service ports deterministic or self-allocating instead of relying on partial env override. |
| macOS smoke | Keep macOS E2E deferred until tauri-driver WKWebView support or an alternate mac smoke path exists. |
| Right-click E2E | Add an alternate context-menu trigger or wait for tauri-driver W3C Actions support. |
| E2E isolation | Reset fixtures before each smoke instead of relying on one reused app instance. |
| Link checker | Add an internal-doc link checker after archive routing settles. |
| Dependency security | Track `hickory-proto` advisory exposure through `mongodb 3.6.0`; remove deny ignore when MongoDB dependency updates make it possible. |

## H1 Data Source Smoke Matrix

This matrix records the current data-source architecture smoke boundary. It is
not a product support expansion; product-visible limits remain in
[`docs/product/known-limitations.md`](../product/known-limitations.md).

| Claim / journey | Current evidence | Gap routing |
|---|---|---|
| PostgreSQL connect -> browse/edit -> query result | `e2e/smoke/postgres.spec.ts`, `src-tauri/tests/schema_integration.rs`, `src-tauri/tests/query_integration.rs` | H2 one-DBMS parity hardening. |
| MongoDB connect -> collection edit/query -> document result | `e2e/smoke/mongodb.spec.ts`, `e2e/smoke/phase-28-slice-A.spec.ts`, `src-tauri/tests/mongo_integration.rs` | MongoDB whitelist/full-support lane after RDBMS parity. |
| Query history source labels across RDB/document journeys | `e2e/smoke/history-source-5.spec.ts` | Keep as regression guard for source attribution. |
| Profile/capability/adapter contract registry | `src/types/dataSource.test.ts`, `src/types/adapterConformance.test.ts`, `src-tauri/tests/backend_adapter_contract_profile.rs` | Extend same matrix when a DBMS capability is promoted. |
| Query language owner registry | `src/types/dataSource.test.ts`, `docs/product/query-language-support.md` | Add active owner metadata before any new runtime-active language. |
| Result envelope compatibility | `src/types/query.resultEnvelope.test.ts`, `src/lib/tauri/query.test.ts` | Backend-native RDBMS envelope wire format is future hardening; wrapper boundary is current SOT. |
| Redis key browser/value preview | `src-tauri/tests/redis_integration.rs`, `src/lib/tauri/kv.test.ts`, `src/components/workspace/KvSidebar.test.tsx` | Runtime E2E smoke remains future H5 Redis/Valkey work. |
| Elasticsearch/OpenSearch fixture-backed search | `src/lib/tauri/search.test.ts`, `src/components/search/SearchResultView.test.tsx` | Live HTTP smoke waits for Search promotion. |
| DuckDB file analytics | `src/lib/tauri/fileAnalytics.test.ts`, DuckDB unit/integration coverage near `src-tauri/src/db/duckdb*` | Runtime E2E smoke and broader file analytics query UI remain tracked by product limitations and H3. |
| MySQL/MariaDB/SQLite support claims | Unit/integration tests under `src-tauri/tests/*integration.rs`, `src/types/dataSource.test.ts`, dialect/parser tests | Add DBMS-specific runtime smoke when each parity lane becomes active. |

## H2 RDBMS Parity Smoke Matrix

This matrix is the H2 RDBMS parity gate. It separates current remote smoke
evidence from fixture/unit/integration evidence so support claims do not imply
full desktop-client parity for every RDBMS.

| Claim / journey | Current evidence | Current gap / routing |
|---|---|---|
| Active parity lane selection | `docs/ROADMAP.md` H2 진행 기준 | PostgreSQL is the active lane; MySQL/MariaDB/SQLite/DuckDB wait until the lane gate passes. |
| PostgreSQL connect -> browse/edit -> query -> history | `e2e/smoke/postgres.spec.ts`, `src-tauri/tests/schema_integration.rs`, `src-tauri/tests/query_integration.rs` | This is the only RDBMS remote E2E smoke-backed lane today. Broader Explain/parity hardening stays in the PostgreSQL milestone. |
| RDBMS common history/source attribution | `e2e/smoke/history-source-5.spec.ts` | Cross-source history label regression guard only; it is not DBMS parity proof. |
| MySQL runtime/query/edit/cancel adapter | `src-tauri/tests/mysql_integration.rs`, `src-tauri/tests/cancel_mysql.rs`, `src/lib/sql/mysqlScriptingBoundary.test.ts`, `e2e/fixtures/seed.mysql.sql` | No MySQL runtime E2E smoke yet. Version-aware CHECK/constraint catalog support is gated by server version context. |
| MySQL smoke scenario inventory | `docs/product/query-language-support.md`, `docs/product/known-limitations.md`, this matrix | Required smoke before promotion: connect, browse tables/views/functions/procedures, SELECT/DML batch, row edit, cancellation, unsupported `DELIMITER`/`LOAD DATA`, bounded DDL, version-gated constraints. |
| MariaDB identity/delta evidence | `src/types/dataSource.test.ts`, `src-tauri/tests/backend_adapter_contract_profile.rs`, `src/lib/sql/sqlDialectProfile.test.ts`, `src/lib/sql/sqlCompletionRequest.test.ts`, `e2e/fixtures/seed.mariadb.sql` | MariaDB keeps distinct identity/profile and completion-only `RETURNING` delta. No MariaDB live-engine CI gate yet. |
| MariaDB smoke scenario inventory | `docs/product/query-language-support.md`, `docs/product/known-limitations.md`, this matrix | Required smoke before promotion: MySQL-family baseline plus MariaDB engine fixture, routine/default evidence, version-gated CHECK/constraint behavior, and explicit `RETURNING` runtime decision. |
| SQLite file DBMS read/write boundary | `src-tauri/tests/sqlite_connection_command.rs`, `src-tauri/tests/sqlite_browse_query_adapter.rs`, `src-tauri/tests/workspace_sqlite_only.rs`, `e2e/fixtures/seed.sqlite.sql` | No SQLite runtime E2E smoke yet. DDL UI parity, raw DDL, ALTER rebuild, and extension semantics remain unsupported. |
| RDBMS conformance/capability gate | `src/types/adapterConformance.test.ts`, `src/types/dataSourceVersionCapabilities.test.ts`, `src-tauri/tests/backend_adapter_contract_profile.rs` | Version-aware capability checks must be supplied with server version context before product claims use gated behavior. |

## Frontend Test Quality

| Area | Follow-up |
|---|---|
| CSS assertions | Prefer role, label, or behavior assertions over class-name assertions. |
| Shortcut tests | Move Mod-Enter coverage toward browser/smoke coverage or a stable keymap seam. |
| Over-mocking | Reduce `MainArea` child over-mocking so prop contract drift is visible. |
| Theme icons | Use accessible labels or visual smoke for icon distinction instead of SVG-shape assertions. |
| Test data shape | Reuse production types/builders rather than duplicating `ConnectionConfigLike` shapes. |
| Drag and drop | Add behavior-level DnD coverage for dragged connection state. |

## Refactor Follow-Up

The code smell audit Part A candidates remain archived at
[`docs/archives/audits/code-smell-audit-2026-05-15.md`](../archives/audits/code-smell-audit-2026-05-15.md).
Promote candidates into sprint contracts only when they intersect current
feature work or remove active maintenance cost.
