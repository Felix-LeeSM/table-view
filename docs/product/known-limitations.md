# Known Limitations

This page records current product-visible support boundaries. Future work and
sequencing live in [`docs/ROADMAP.md`](../ROADMAP.md). Historical risk IDs live
in [`docs/archives/risks/active-risk-register-2026-05-27.md`](../archives/risks/active-risk-register-2026-05-27.md).

## Data Source Support

| Area | Current limitation |
|---|---|
| PostgreSQL query/workbench parity | PostgreSQL is the strongest active RDBMS lane, but current routine desktop smoke covers only connect, browse seeded data, edit a row, and query the changed result. Full PostgreSQL dialect/admin parity is not claimed: PL/pgSQL body authoring, broad MERGE variants, arbitrary nested/function-expression semantics, arbitrary extension semantics, catalog-backed enumeration of every extension symbol, DB-level backup/restore/import/export, role/user/permission UI, extension management UI, server activity/profiler dashboards, and routine E2E for Explain, installed-extension completion, Safe Mode confirmations, DDL structure flows, cancellation, ERD, and admin scenarios remain future promotion gates. |
| MySQL / MariaDB capabilities | Version-aware capability gates are typed and tested. Adapter conformance can evaluate MySQL-family server version context, but operation-level UI/runtime consumers must still pass explicit version evidence before claiming gated behavior. |
| MySQL export / DDL parity | MySQL supports bounded structured table/index/constraint DDL and generic grid exports. Structured trigger create/drop, DB-level backup/restore/import/export, and MySQL-restorable schema dumps are not claimed. |
| MariaDB | MariaDB currently reuses the MySQL-family runtime/parser/Safe Mode path while keeping a distinct MariaDB identity/profile. The MariaDB `RETURNING` delta is completion/profile evidence only; runtime support remains server-resolved rather than a client-side version-gated app claim. |
| MariaDB fixture evidence | MariaDB fixture scaffolding exists, including seed/profile wiring, but routine/default fixture coverage, CI gates, and live-engine evidence are still too thin before broader MariaDB-only support claims. |
| SQLite | SQLite user-DBMS files support absolute-path connection, create-new-file, browsing, read queries, writable-file DML, transactional DML batch/dry-run, cancellation, read-only mode, and primary-key-scoped row edits. The user DBMS file is explicitly separated from internal app SQLite state. Structured DDL UI parity and raw SQL DDL execution are not implemented; unsupported `ALTER TABLE` actions are explicit adapter rejections, not auto-rebuilt migrations. Read-only file connections reject writes; nested JSON edits are deferred; sqlite-cli dot commands are completion vocabulary only; JSON1/FTS/RTREE/loadable-extension semantics are not detected, gated, dispatched, or validated client-side. No SQLite desktop E2E smoke is wired into GitHub Runtime Happy Path today. |
| DuckDB | DuckDB is currently modeled as a file-backed RDBMS profile, not a separate file-SQL paradigm. Local `.duckdb` files support connection, catalog/table reads, and statement-level raw SQL through the RDBMS path, but structured DDL/write UI parity is not implemented. Read-only files reject writes; extension install/load statements and helper functions, `COPY` import/export, `ATTACH`/`DETACH`, sensitive external-file capability settings, cloud/object-store access, raw external-file functions, and string replacement scans are blocked, and extension autoload is disabled. Registered local CSV/Parquet/JSON/NDJSON analytics has preview basics and source-scoped SELECT backend evidence, while broader analytics query UI parity/history/import and E2E smoke coverage remain future promotion gates in the H3 smoke matrix. |
| DuckDB file privacy / export | File analytics source paths stay in active-session adapter state and clear on connect/disconnect. Public source, preview, and query payloads expose id, alias, file name, kind, and size only; backend errors redact local paths. Export behavior is the existing explicit save-dialog grid export for current rows, not an automatic export of a registered local file source. |
| Connection import/export privacy | The Import / Export Connections dialog uses an encrypted JSON envelope for selected connections. Connection passwords are not embedded in the export payload; imported connections require password re-entry. |
| Security / admin surface | Destructive and admin safeguards are source-specific rather than universal. Existing coverage includes RDB DDL preview/confirm, RDB Safe Mode confirmations, MongoDB safety confirmations, Redis typed confirmation keys, and fixture-backed Search destructive plans. Global audit logs, role/user/permission UI, credential rotation UI, keyring diagnostics, and a general security dashboard are not implemented. |
| Runtime E2E smoke coverage | GitHub Runtime Happy Path currently builds the app on Ubuntu and runs PostgreSQL and MongoDB smoke specs. Other specs under `e2e/smoke/**`, reset-to-default audits, Redis/Search/DuckDB/ERD scenarios, and macOS/Windows runtime smoke are future promotion gates unless the CI script wires them. |
| Adapter / workspace boundary | Backend commands regain typed adapters through `ActiveAdapter::as_rdb` / `as_document` / `as_search`, and profile/conformance metadata declares adapter families. Frontend query dispatch still lives in `useQueryExecution`, and query tab/result lifecycle lives in `workspaceStore`; further decomposition is refactor/quality work, not a support claim. |
| Query results | RDBMS IPC is normalized to a `tabular` result envelope at the Tauri wrapper while legacy `QueryResult` remains the renderer compatibility projection. `tabular` and `document` can project to `QueryResultGrid`, Search uses a separate typed renderer state, and KV/stream/metrics-style envelopes do not have a grid projection yet. |
| ERD / SchemaGraph | schemaStore owns cached schemas/tables/views/functions/postgresExtensions/tableColumnsCache/tableIndexesCache/tableConstraintsCache/triggers. Production ERD/SchemaGraph input comes from schema/table/column cache plus cached/fetched explicit indexes/constraints for visible tables; `ColumnInfo` still supplies synthetic PK/FK/CHECK fallback metadata. Dependency view, migration-impact analysis, schema diff, data compare, and dense-view smoke remain future promotion gates in the H4 smoke matrix. |
| FK navigation | Current FK navigation is the DataGrid foreign-key cell/icon path that opens the referenced row with filters. ERD selection, search, zoom, fit, focus, and relationship highlighting are local diagram interactions, not FK row navigation claims. |
| Redis | Redis connection/profile, backend KV primitives, key browser, and value preview exist. Backend evidence covers database/key scan, typed value reads, guarded string set, delete confirmation, TTL expire/persist, and bounded stream reads. The product UI claim is still key browser/value preview only; full value editing, TTL/write controls, stream consumer UI, Redis command query editor, cluster, pub/sub, modules, and consumer-group management remain out of scope. |
| Valkey | Valkey has no active profile/runtime identity, fixture evidence, or live evidence. Redis compatibility is a future hypothesis, not a support claim. |
| MongoDB | MongoDB support is limited to tested whitelisted document workflows. Arbitrary JavaScript shell execution, shell helpers, multiple statements, cross-db shell navigation, version/deployment gates, and native document-first panels remain out of scope. Transaction-style workflows must fail clearly on unsupported standalone deployments; silent partial commit behavior is not allowed. |
| Elasticsearch / OpenSearch | Search support is fixture-backed only. Fixture evidence covers typed identity/catalog/mapping/template/search result envelopes and bounded destructive-operation planning. Live connection UI, HTTP auth/TLS, response parsing, catalog/search execution, admin APIs, observability, and product-specific live deltas are not implemented. |
| MSSQL | MSSQL is a planned RDBMS identity only. The `mssql` profile/dialect exists as capability-empty `declared-rdb`, but SQL Server connection UI, runtime adapter, query/catalog/edit support, T-SQL parser/completion, auth/TLS/encryption/instance behavior, fixture evidence, live evidence, and desktop E2E smoke are not implemented. |
| Oracle | Oracle is a planned RDBMS identity only. The `oracle` profile/dialect exists as capability-empty `declared-rdb`, but Oracle connection UI, runtime adapter, query/catalog/edit support, Oracle SQL/PL/SQL parser/completion, service/SID/wallet/TNS behavior, fixture evidence, live evidence, and desktop E2E smoke are not implemented. |
| Wider source candidates | Cassandra/Scylla, DynamoDB, graph, vector, and stream sources have no active `DatabaseType`, profile, runtime, parser/completion, fixture/live evidence, or E2E smoke. They remain candidate-only until workflow value, profile target, connection kind, language owner, catalog model, result envelope, safety policy, fixture strategy, and smoke evidence are defined in a source-specific promotion PR. |
| CHECK constraints | CHECK constraint expressions are shown as raw SQL by design, matching database-tool behavior. |

## UI, Accessibility, And Performance

The following areas are product-visible but not yet backed by routine automated
smoke or measurement gates:

- Full 72-theme light/dark WCAG AA measurement.
- SchemaTree 1k/10k table scroll FPS.
- DataGrid page-size 1000 wheel-to-paint latency.
- VoiceOver/NVDA paths for Quick Open, DataGrid, and SchemaTree.
- 1024x600 minimum viewport with max sidebar and dialog overlap.
- Tauri production shortcut audit for `Cmd+Shift+I`.
- `MainArea` empty-state MRU policy.
- Narrow-column display for `pendingEditErrors`.
- ERD desktop+narrow screenshot smoke. Dense-view smoke evidence is a future H4
  matrix gate; there is no current dense-view smoke claim.
- Internal-doc link checking and dependency-security CI. Local Rust/full
  pre-push routes run `cargo deny check`, but PR/main CI does not currently
  make dependency security a separate blocking job.
- Per-spec database fixture reset for broad E2E expansion. The current runtime
  smoke seeds once and gives each wired spec a separate app data directory.

## Related

- [`docs/product/README.md`](README.md) — current support snapshot
- [`docs/ROADMAP.md`](../ROADMAP.md) — follow-up queue and promotion order
- [`docs/contributor-guide/testing-and-quality.md`](../contributor-guide/testing-and-quality.md) — developer-facing verification gaps
