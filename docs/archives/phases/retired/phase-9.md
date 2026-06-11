# Phase 9: RDB DBMS Full PostgreSQL Parity

> **Archive status (2026-05-22)**: superseded legacy RDBMS split sketch. Current
> DBMS adapter planning lives in Phase 17-20 and active ordering lives in
> `../../../ROADMAP.md`.
>
> This replaces the older MySQL+SQLite sketch. The target is not an MVP subset:
> every PostgreSQL-supported feature must be extended feature-by-feature across
> MySQL, MariaDB, SQLite, Microsoft SQL Server, and Oracle.

## Decision

- Parity unit: one PostgreSQL feature at a time, implemented across every target
  DBMS that can support the feature.
- Fixtures are mandatory: every feature slice must add or update the DBMS-specific
  fixture for each touched DBMS before claiming support.
- Existing PostgreSQL behavior remains the reference contract unless a DBMS cannot
  express the feature. In that case the UI/API must surface an explicit disabled or
  unsupported state, backed by a test.
- MariaDB is a distinct `DatabaseType`; it may share the MySQL protocol adapter
  while keeping its own label, fixture, defaults, and tests.

## UI Shape Contract

| DBMS | Sidebar shape | Database switch |
|---|---|---|
| PostgreSQL | `database -> schema -> object` | yes |
| MySQL | `database -> object` | yes |
| MariaDB | `database -> object` | yes |
| SQLite | `object` under one file connection | no |
| Microsoft SQL Server | `database -> schema -> object` | yes |
| Oracle | `service/user -> schema -> object` | adapter-defined |

SQLite must not show an active database switcher: the database is the file chosen
by the connection. MySQL and MariaDB use the no-schema UI because their database
and schema concepts collapse for this app's browsing model.

## Feature Order

1. Connection / test connection / saved model.
2. Database list and switch policy.
3. Schema tree shape and object namespace mapping.
4. Table, view, function/procedure, trigger, index, and constraint introspection.
5. Table preview with pagination, filter, and sort.
6. Query execution, batch execution, cancellation, and dry-run behavior.
7. Autocomplete: keywords, functions, identifier quoting, and object completion.
8. Data editing: preview, safe mode, commit execution, and transaction semantics.
9. DDL: create/drop/rename table, columns, indexes, constraints, triggers.
10. Export, server activity, explain, and stats.

## Fixture Contract

Baseline smoke fixtures live in `e2e/fixtures/`:

| DBMS | Fixture |
|---|---|
| PostgreSQL | `seed.sql` |
| MySQL | `seed.mysql.sql` |
| MariaDB | `seed.mariadb.sql` |
| SQLite | `seed.sqlite.sql` |
| Microsoft SQL Server | `seed.mssql.sql` |
| Oracle | `seed.oracle.sql` |

Every fixture must be idempotent and include at least:

- `users`
- `orders`
- `products`
- one foreign-key relationship
- one unique key used for repeat-safe inserts

Feature-specific fixture expansion must be dialect-local. Do not add a PostgreSQL
object and infer other DBMS behavior from it. If a feature needs a trigger,
procedure, generated column, JSON type, or dialect-specific index, each target
DBMS gets its own fixture representation and test assertion.

## First Slice Boundary

The first slice establishes the contract only:

- widen frontend/backend `DatabaseType` to include MariaDB, SQLite, MSSQL, and
  Oracle as relational variants;
- expose MariaDB because it can share the MySQL adapter and connection test path;
- keep unwired DBMS types out of the "supported add connection" list until their
  adapters land;
- lock tree shape and database-switcher behavior with unit tests;
- add DBMS-specific baseline seed files.

Subsequent PRs should stay in the feature order above and avoid bundling unrelated
DBMS features into one large branch.

## SQLite Connection Slice

SQLite is the next feature-order slice for connection / test connection /
saved model:

- `DatabaseType::Sqlite` returns an RDB adapter and is exposed in the add
  connection dialog.
- The backend accepts SQLite saved connections without host/user/password,
  but still requires an explicit database file path.
- `test_connection` opens an existing SQLite file with `PRAGMA foreign_keys`
  enabled and must not silently create a missing file.
- The adapter provides the minimum catalog reads needed for the flat sidebar:
  one `main` namespace, table names, exact table row counts, columns, primary
  key flags, and foreign-key references.
- Batch execution, dry-run, DDL, export streaming, and richer SQLite
  introspection remain separate feature-order slices.

## SQLite File Creation Slice

SQLite file creation is an explicit user action layered on top of the
connection slice:

- Selecting SQLite in the add/edit connection dialog exposes a `Create` action
  next to the existing file picker.
- The create action uses a save-file picker, refuses to overwrite an existing
  file, requires an absolute path, and requires the parent directory to exist.
- `test_connection` and normal `connect` still must not create missing files;
  silent path typo creation remains forbidden.

## SQLite Query / Preview Slice

SQLite table preview and single-statement query execution follow the shared RDB
contract:

- Free-form `execute_query` supports SQLite `SELECT`/`WITH`/`PRAGMA`/`EXPLAIN`
  result sets plus single-statement DML/DDL result metadata.
- `query_table_data` supports pagination, validated `ORDER BY`, structured
  filters, raw `WHERE` validation, primary-key tiebreak ordering, and JSON cell
  projection.
- Native cancel, edit commit semantics, DDL builders, export streaming, and
  richer introspection remain separate parity slices.

## SQLite Batch / Dry-Run Slice

SQLite batch execution follows the shared RDB transaction contract:

- `execute_sql_batch` runs all statements inside one transaction and commits
  only after every statement succeeds.
- A failure on statement K rolls back statements 1..K-1 and returns the same
  statement-indexed error shape used by the PostgreSQL path.
- `dry_run_sql_batch` executes the same statements inside one transaction but
  rolls back on success, preserving per-statement rows-affected metadata for
  the destructive-change preview flow.
- Empty batches are no-ops, and a pre-cancelled token returns cancellation
  before requiring an active SQLite connection.
- Native driver cancellation, edit commit semantics, DDL builders, export
  streaming, and richer introspection remain separate parity slices.
