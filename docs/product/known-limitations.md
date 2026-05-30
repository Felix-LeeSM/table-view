# Known Limitations

This page records current product-visible support boundaries. Future work and
sequencing live in [`docs/ROADMAP.md`](../ROADMAP.md). Historical risk IDs live
in [`docs/archives/risks/active-risk-register-2026-05-27.md`](../archives/risks/active-risk-register-2026-05-27.md).

## Data Source Support

| Area | Current limitation |
|---|---|
| MySQL / MariaDB capabilities | Version-aware capability gates are typed and tested. Adapter conformance can evaluate MySQL-family server version context, but operation-level UI/runtime consumers must still pass explicit version evidence before claiming gated behavior. |
| MySQL export / DDL parity | MySQL supports bounded structured table/index/constraint DDL and generic grid exports. Structured trigger create/drop, DB-level backup/restore/import/export, and MySQL-restorable schema dumps are not claimed. |
| MariaDB | MariaDB currently reuses the MySQL-family runtime/parser/Safe Mode path while keeping a distinct MariaDB identity/profile. The MariaDB `RETURNING` delta is completion/profile evidence only; runtime support remains server-resolved rather than a client-side version-gated app claim. |
| MariaDB fixture evidence | MariaDB fixture scaffolding exists, including seed/profile wiring, but routine/default fixture coverage, CI gates, and live-engine evidence are still too thin before broader MariaDB-only support claims. |
| SQLite | SQLite user-DBMS files support connection, browsing, read queries, DML writes on writable files, and primary-key-scoped row edits. Structured DDL UI parity and raw SQL DDL execution are not implemented; unsupported `ALTER TABLE` actions are not auto-rebuilt; read-only file connections reject writes; sqlite-cli dot commands are completion vocabulary only; extension/capability-specific semantics are not validated client-side. |
| DuckDB | DuckDB is currently modeled as a file-backed RDBMS profile, not a separate file-SQL paradigm. Local `.duckdb` files support connection, catalog/table reads, and statement-level raw SQL through the RDBMS path, but structured DDL/write UI parity is not implemented. Read-only files reject writes; extension install/load, `COPY` import/export, cloud/object-store access, raw external-file functions, and string replacement scans are blocked, and extension autoload is disabled. Registered local CSV/Parquet/JSON/NDJSON analytics has preview basics and source-scoped SELECT backend evidence, while broader analytics query UI parity/history/import and E2E smoke coverage remain tracked by #188 and #246. |
| DuckDB file privacy / export | File analytics source paths stay in active-session adapter state and clear on connect/disconnect. Public source, preview, and query payloads expose id, alias, file name, kind, and size only; backend errors redact local paths. Export behavior is the existing explicit save-dialog grid export for current rows, not an automatic export of a registered local file source. |
| Connection import/export privacy | The Import / Export Connections dialog uses an encrypted JSON envelope for selected connections. Connection passwords are not embedded in the export payload; imported connections require password re-entry. |
| Adapter / workspace boundary | Backend commands regain typed adapters through `ActiveAdapter::as_rdb` / `as_document` / `as_search`, and profile/conformance metadata declares adapter families. Frontend query dispatch still lives in `useQueryExecution`, and query tab/result lifecycle lives in `workspaceStore`; further decomposition is refactor/quality work, not a support claim. |
| Query results | RDBMS IPC is normalized to a `tabular` result envelope at the Tauri wrapper while legacy `QueryResult` remains the renderer compatibility projection. `tabular` and `document` can project to `QueryResultGrid`, Search uses a separate typed renderer state, and KV/stream/metrics-style envelopes do not have a grid projection yet. |
| ERD / SchemaGraph | schemaStore owns cached schemas/tables/views/functions/postgresExtensions/tableColumnsCache/tableIndexesCache/tableConstraintsCache/triggers. Production ERD/SchemaGraph input comes from schema/table/column cache plus cached/fetched explicit indexes/constraints for visible tables; `ColumnInfo` still supplies synthetic PK/FK/CHECK fallback metadata. Dependency view, migration-impact analysis, and dense-view smoke remain roadmap follow-ups (#189, #200, #247). #211 is documentation-only and does not change runtime behavior. |
| FK navigation | Current FK navigation is the DataGrid foreign-key cell/icon path that opens the referenced row with filters. ERD selection, search, zoom, fit, focus, and relationship highlighting are local diagram interactions, not FK row navigation claims. |
| Redis / Valkey | Redis connection/profile, backend KV primitives, key browser, and value preview exist. Value editing, TTL/write, stream UI, Valkey parity, cluster, pub/sub, modules, and consumer-group management remain out of scope. |
| MongoDB | MongoDB support is limited to tested whitelisted document workflows. Arbitrary JavaScript shell execution, version/deployment gates, and native document-first panels remain out of scope. |
| Elasticsearch / OpenSearch | Search support is fixture-backed only. Live connection UI, HTTP auth/TLS, response parsing, admin APIs, and observability are not implemented. |
| MSSQL / Oracle | These are planned identities only. Runtime support is not implemented. |
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
- ERD desktop+narrow screenshot smoke. Dense-view smoke evidence is future work
  tracked by #247; there is no current dense-view smoke claim.

## Related

- [`docs/product/README.md`](README.md) — current support snapshot
- [`docs/ROADMAP.md`](../ROADMAP.md) — follow-up queue and promotion order
- [`docs/contributor-guide/testing-and-quality.md`](../contributor-guide/testing-and-quality.md) — developer-facing verification gaps
