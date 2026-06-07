# Sprint 459 Handoff: RDBMS Integration Gate

## Gate Result

Sprint 459 keeps PostgreSQL, MySQL, MariaDB, SQLite, and DuckDB in one runtime
RDBMS matrix before SchemaGraph/ERD work starts.

## Closed By This Sprint

- TypeScript and Rust RDBMS matrices now identify declared RDBMS sources,
  runtime-backed RDBMS sources, server-backed RDBMS sources, and file-backed
  RDBMS sources.
- Runtime-backed RDBMS profiles must expose `rdb` paradigm, SQL language, RDB
  catalog model, tabular result envelopes, RDB safety policy, and RDB backend
  contract/capabilities.
- MSSQL now has SQL authentication connection plus bounded query runtime
  support. Oracle now has service-name connection lifecycle support. Neither
  source claims catalog/edit/parser/Safe Mode or runtime smoke parity.
- DuckDB participates in the legacy result renderer compatibility test through
  the shared runtime RDBMS matrix.
- DuckDB file analytics UI exposure is profile/capability-derived from
  supported local analytics file inputs, not a raw `dbType` switch.

## Support Claims

- PostgreSQL remains the baseline RDBMS path.
- MySQL remains adapter-complete with ongoing semantic widening work.
- MariaDB support is MySQL-adapter reuse with MariaDB identity/dialect metadata;
  MariaDB-engine integration fixture coverage is still an active risk.
- SQLite supports file connection, catalog/query basics, view/view-column
  browsing, and scoped row edits; DDL UI/runtime family remains unsupported.
- DuckDB supports `.duckdb` file connection, catalog/query basics, and local
  CSV/Parquet/JSON/NDJSON preview/query; DDL/write parity, file import,
  history/favorites integration, and arbitrary external file reads remain out of
  scope.

## Follow-Up Risks

- `RISK-042`: MySQL/MariaDB version-aware capability gates are not yet wired
  through runtime/UI feature gates.
- `RISK-043`: MariaDB needs a MariaDB-engine fixture smoke or narrowed support
  wording.
- `RISK-044`: typed result envelopes have a compatibility layer, but query IPC
  still returns legacy `QueryResult`.
