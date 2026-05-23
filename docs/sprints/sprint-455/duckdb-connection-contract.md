# DuckDB Connection/File Contract

Sprint 459 note: this is historical Sprint 455 evidence. DuckDB runtime connect,
catalog/query basics, and local CSV/Parquet/JSON/NDJSON file analytics preview
landed in Sprints 456-457. Current support claims live in
`docs/query-language-support.md` and Sprint 459 handoff.

Sprint 455 declares DuckDB as an RDBMS identity with a `file` connection kind.
This is metadata only: runtime connect, query execution, and file analytics
imports remain deferred.

## Connection Fields

- `database` stores the local `.duckdb` file path.
- `readOnly` stores the file open mode preference.
- `host`, `port`, `user`, and password remain blank/zero for DuckDB file
  drafts.
- DuckDB is not in the supported runtime connection list until an adapter
  lands.

## File Inputs

- Supported now: `.duckdb` database files.
- Deferred: `.csv`, `.parquet`, `.json`, `.ndjson` analytics inputs.
- Deferred analytics inputs use the same local-file privacy contract and do
  not introduce cloud/object-store access.

## SQLite Reuse Boundary

SQLite and DuckDB both use the shared file contract fields (`database`,
`readOnly`, local file permission scope), but their file input identities stay
separate: `sqlite-database` for `.sqlite`/`.sqlite3`/`.db`, and
`duckdb-database` for `.duckdb`.

## Fixture Strategy

DuckDB fixtures should be local `.duckdb` files under a DuckDB-specific fixture
directory. CSV/Parquet/JSON fixtures wait for the analytics import/preview
sprint so this slice does not imply runtime file ingestion.
