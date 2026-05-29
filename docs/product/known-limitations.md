# Known Limitations

This page records current product-visible support boundaries. Future work and
sequencing live in [`docs/ROADMAP.md`](../ROADMAP.md). Historical risk IDs live
in [`docs/archives/risks/active-risk-register-2026-05-27.md`](../archives/risks/active-risk-register-2026-05-27.md).

## Data Source Support

| Area | Current limitation |
|---|---|
| MySQL / MariaDB capabilities | Version-aware capability gates are typed and tested as metadata, but not fully routed through runtime/UI capability lookup. |
| MySQL export / DDL parity | MySQL supports bounded structured table/index/constraint DDL and generic grid exports. Structured trigger create/drop, DB-level backup/restore/import/export, and MySQL-restorable schema dumps are not claimed. |
| MariaDB | MariaDB currently reuses the MySQL-family runtime/parser/Safe Mode path while keeping a distinct MariaDB identity/profile. The MariaDB `RETURNING` delta is completion/profile evidence only; runtime support remains server-resolved rather than version-gated by the app. |
| MariaDB fixture evidence | MariaDB fixture scaffolding exists, including seed/profile wiring, but routine/default fixture coverage, CI gates, and live-engine evidence are still too thin before broader MariaDB-only support claims. |
| SQLite | SQLite user-DBMS files support connection, browsing, read queries, DML writes on writable files, and primary-key-scoped row edits. Structured DDL UI parity and raw SQL DDL execution are not implemented; unsupported `ALTER TABLE` actions are not auto-rebuilt; read-only file connections reject writes; sqlite-cli dot commands are completion vocabulary only; extension/capability-specific semantics are not validated client-side. |
| DuckDB | DuckDB is currently modeled as a file-backed RDBMS profile, not a separate file-SQL paradigm. Local `.duckdb` files support connection, catalog/table reads, and statement-level raw SQL through the RDBMS path, but structured DDL/write UI parity is not implemented. Read-only files reject writes; extension install/load, `COPY` import/export, cloud/object-store access, raw external-file functions, and string replacement scans are blocked. CSV/Parquet/JSON/NDJSON analytics has local registration/preview and source-scoped SELECT runtime evidence, while broader analytics query UI parity/history/import, privacy-doc hardening, and E2E smoke coverage remain tracked by #188, #210, and #246. |
| Adapter / workspace boundary | Backend commands regain typed adapters through `ActiveAdapter::as_rdb` / `as_document` / `as_search`; frontend query dispatch still lives in `useQueryExecution`, and query tab/result lifecycle lives in `workspaceStore`. Moving broad dispatch switches behind adapter/runtime contracts is roadmap follow-up work (#183, #184), not current behavior. |
| Query results | RDBMS IPC still returns the legacy `QueryResult` shape. Typed result envelopes coexist with that compatibility layer: `tabular` and `document` can project to `QueryResultGrid`, Search uses a separate typed renderer state, and KV/stream/metrics-style envelopes do not have a grid projection yet. |
| ERD | Table/column graph data is wired first. Constraint and index graph nodes are still fixture-covered rather than fully live-cache backed. |
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
- Desktop+narrow viewport screenshot smoke for dense ERD views.

## Related

- [`docs/product/README.md`](README.md) — current support snapshot
- [`docs/ROADMAP.md`](../ROADMAP.md) — follow-up queue and promotion order
- [`docs/contributor-guide/testing-and-quality.md`](../contributor-guide/testing-and-quality.md) — developer-facing verification gaps
