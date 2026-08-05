# Current Product Surface

Child page of
[`docs/product/query-language-support.md`](query-language-support.md).

- [PostgreSQL SQL](#postgresql-sql)
- [MySQL SQL](#mysql-sql)
- [MariaDB SQL](#mariadb-sql)
- [SQLite SQL](#sqlite-sql)
- [DuckDB SQL](#duckdb-sql)
- [MongoDB Mongosh/MQL](#mongodb-mongoshmql)
- [Redis command](#redis-command)
- [Valkey `redis-command` target](#valkey-redis-command-target)
- [Search DSL](#search-dsl)
- [MSSQL SQL](#mssql-sql)
- [Oracle SQL](#oracle-sql)

## PostgreSQL SQL

**Current support**: Strongest SQL parser/Safe Mode lane, but still a bounded
client subset. Parser/Safe Mode covers tested SQL slices plus selected
extension-tolerant syntax for symbolic operators and known extension-backed
column types. Routine desktop smoke covers info/warn/destructive Safe Mode
confirmation, raw DDL preview/confirm, grid-edit preview/confirm paths,
cancellation UI/history/retry behavior, and bounded Structure table-plus-index
DDL preview/execute/history/schema-refresh behavior. Completion separately
covers common keywords, functions, tables, columns, shell/meta command
vocabulary, and installed extension inventory-gated curated packs for
`pgcrypto`, `uuid-ossp`, `postgis`, `pgvector`, `citext`, `hstore`, `pg_trgm`,
and `fuzzystrmatch`. Runtime smoke seeds `pgcrypto` and `fuzzystrmatch` and
proves the installed-extension gate by surfacing `GEN_RANDOM_UUID` and
`LEVENSHTEIN` while withholding absent `uuid-ossp` candidates. Lightweight
Explain has backend/API/component/parser/safety evidence plus routine desktop
smoke for plan inspection from the query editor.

**Current boundary**: Full PL/pgSQL bodies, arbitrary vendor extension
semantics, broad MERGE variants, nested/arbitrary function expressions,
installed-extension semantic validation for parser/Safe Mode, catalog-backed
enumeration of every extension symbol, server activity/session management UI,
profiler/activity dashboards, roles/users, extension management, import/export,
and broader structured DDL parity are not modeled.

## MySQL SQL

**Current support**: Runtime adapter supports connection, database/table
browsing, catalog metadata for databases/schemas, tables, views, columns,
indexes, constraints/FKs and live version-gated column CHECK hints, raw query
execution, DML-oriented multi-statement batches, table data reads, row edits
with MySQL backtick generated SQL/key projection, cancellation, and bounded
structured DDL for tables/indexes/constraints. Routine desktop smoke covers
connect, browse seeded table, SELECT result grid, DML batch per-statement
result, narrow seeded `CALL proc(scalar)` result rendering, row edit,
cancellation/retry, history/source labels, tabular result evidence, and bounded
Structure table/index/FK DDL preview/execute/catalog readback. Completion uses
the current connection/database catalog for schema, table/view, column, and
routine suggestions, and covers MySQL-family keywords/functions plus backtick
identifier contexts. Parser/Safe Mode understands the common SQL subset plus
tested MySQL-family slices: `LIMIT offset, count`, `ON DUPLICATE KEY UPDATE`,
and narrow `CALL proc(scalar)`, where scalar means literal, `DEFAULT`, `NULL`,
boolean, or user-variable arguments. The adapter detects `SELECT VERSION()`
context and gates CHECK/constraint catalog support at MySQL `>= 8.0.16`;
older/unknown versions return empty CHECK hints.

**Current boundary**: Completion suggestions are editor assistance, not runtime
support claims for stored routine body authoring or scripting. Stored
routine/event bodies, routine control-flow scripting, broad `CALL` argument
expressions such as function calls, arithmetic, subqueries, bare identifiers,
and system variables, `DELIMITER`, and `LOAD DATA` are unsupported or explicitly
rejected. Trigger metadata is browse-only in Structure; trigger create/drop is
raw-SQL-only because structured trigger dialogs are not mapped to MySQL's inline
trigger body model. Grid CSV/TSV export is generic; MySQL-family schema dumps
are now restorable (backtick identifiers + MySQL-escaped INSERTs, #1641), while
DB-level backup/restore/import/export and byte-faithful binary/BLOB dump
round-trip are not claimed.

## MariaDB SQL

**Current support**: Uses a distinct MariaDB `DatabaseType`, profile, and
dialect identity while reusing the MySQL-family runtime adapter, CodeMirror
dialect, parser/Safe Mode path, and capability family. Routine desktop smoke now
runs against the MariaDB engine fixture for connect, seeded table browse,
catalog/workbench metadata browse, SELECT, DML batch, narrow seeded
`CALL proc(scalar)` result rendering, row edit, cancellation/retry,
history/source labels, tabular result rendering, and bounded Structure
table/index/FK DDL preview/execute/catalog readback. Row edit has hook evidence
for the MySQL-family quoted, primary-key-projected preview/discard/commit path
under MariaDB connection identity. Bounded table/index/constraint DDL has
export/backend-preview evidence with MariaDB identity preserved in generated
export headers and routine smoke evidence for the intentional MySQL-family SQL
path. Catalog/workbench evidence covers tables, views, columns, indexes,
constraints/FKs, and routine metadata browse; CHECK/constraint catalog support
remains gated at MariaDB `>= 10.2.1`. Completion/profile vocabulary exposes the
MySQL-family surface plus a MariaDB keyword-level `RETURNING` delta, suppressing
that suggestion only when known server version context is below `10.0.5`.
Parser/Safe Mode recognizes `RETURNING` as a structural clause on
already-supported DML statement shapes and keeps the normal INSERT/UPDATE/DELETE
safety tiers. Focused `mariadb:11` integration evidence verifies the live server
version, then characterizes `DELETE ... RETURNING` as server-accepted but
projected by the shared adapter as a DML envelope with no returned rows and no
affected-row count.

**Current boundary**: `RETURNING` is not a client-side version-gated
returned-row support guarantee in the app; raw execution is sent to MariaDB and
the server remains the final judge. Broader MariaDB-only syntax, routine
execution beyond the seeded narrow CALL probe, broad CALL expressions, procedure
body authoring/management, trigger create/drop, admin/import/export, and
completion-runtime claims still need separate tests/docs before promotion.

## SQLite SQL

**Current support**: File connection, table browsing, raw read queries,
writable-file DML, transactional DML batches, dry-run rollback,
primary-key-scoped row edits, and the structured DDL SQLite runs natively on a
writable file (`CREATE TABLE`, `DROP TABLE`, `ALTER TABLE … RENAME TO`,
`ADD COLUMN`, `DROP COLUMN`, `CREATE INDEX`, `DROP INDEX`) are supported. A
multi-change `ALTER TABLE` runs in one transaction, so a failure part-way leaves
the table as it was. Opening a SQLite file probes a bounded JSON1/FTS5/RTREE
capability inventory without enabling loadable extensions. Completion covers
built-in SQLite keywords/functions, cached schema objects, sqlite-cli
dot-command vocabulary as non-executable suggestions, and detected-only
JSON1/FTS5 read-query assistance.

**Current boundary**: Raw SQL DDL is rejected by the SQLite adapter, and
structured DDL stops where SQLite would need to rewrite the whole table:
changing a column's type, NOT NULL or DEFAULT, and adding or dropping a
constraint after `CREATE TABLE`, are not implemented. In the Structure UI the
column change keeps its per-row Edit on screen, disabled, with the reason on
hover; constraints have no tab at all for SQLite, because the adapter has no
structured constraint listing, so nothing is rendered to disable. `ADD COLUMN`
and
`DROP COLUMN` carry SQLite's own row-dependent conditions and report them after
the attempt with the blocking object named. Row edits require key/projected row identity, read-only file
connections reject writes and every structured DDL entry point, nested JSON edits are deferred,
sqlite-cli dot commands and `load_extension()` are not executed, virtual-table
CRUD and broad extension semantics are unsupported, and RTREE inventory is
exposed only as capability metadata. Capability inventory does not imply
parser/Safe Mode semantic validation.

## DuckDB SQL

**Current support**: DuckDB is a file-backed RDBMS profile (`rdb` + `file`
connection kind). Local `.duckdb` files can be opened for catalog browsing,
table reads, and statement-level raw SQL execution through the RDBMS tabular
result path. GitHub Runtime Happy Path now wires separate deterministic DuckDB
desktop smokes: `.duckdb` open, catalog/table browse, raw SELECT tabular
result/history evidence, writable DML readback, and read-only write rejection;
and registered deterministic CSV source -> global editor SELECT -> result grid
-> `FILE` history/source evidence -> no absolute local path in visible UI.
Registered local CSV/Parquet/JSON/NDJSON analytics sources can be previewed from
the DuckDB query toolbar and queried in the file-analytics dialog opened from
that toolbar; the focused dialog/API/editor evidence chooses a local file,
registers an active-session source alias, exposes source alias/columns in
workbench metadata, previews up to 100 rows, runs source-scoped SELECT against
that alias, routes global query editor SELECT statements through the normal
result surface/backend path against registered aliases without source-id
plumbing, and records successful dialog and global-editor source queries with a
distinct `FILE` history label. Public source/query payloads expose id, alias,
file name, kind, size, columns, and preview SQL, not absolute local paths.
Completion covers editor vocabulary, cached `.duckdb` schema objects, and
active-session registered source aliases/columns after source metadata is
loaded.

**Current boundary**: Structured grid row edits (INSERT/UPDATE/DELETE) are
exposed on writable connections via the transactional `execute_sql_batch` path
(ADR 0051 Stage 1, #1070). Native structural DDL is exposed on writable
connections (ADR 0051 Stage 2, #1070): table create/drop/rename, column
add/drop/type, and index create/drop run as native DuckDB `ALTER TABLE` /
`CREATE|DROP TABLE|INDEX`. Constraint add/drop (Stage 2b rebuild-swap),
identity/auto-increment columns, and dry-run/multi-statement transactions (Stage
3) are not implemented; those controls stay hidden per the `ddl.alterConstraint`
/ `ddl.identityColumn` capability claims rather than click-then-error. Automatic
file analytics import/export workflows are not implemented. Completion
suggestions are editor assistance and do not override adapter blocklists.
Extension install/load statements and helper functions, `COPY` file
import/export, `ATTACH`/`DETACH`, sensitive external-file capability settings,
shell commands, cloud/object-store access, and arbitrary external-file SQL
functions or replacement scans are adapter-rejected; extension autoload is
disabled. Read-only `.duckdb` files reject writes.

## MongoDB Mongosh/MQL

**Current support**: Whitelisted `db...` collection/admin commands, JSON-like
bodies, BSON literals, `find(filter, projection)`, cursor-chain
`sort`/`skip`/`limit` dispatch, aggregate cursor-chain lowering,
operator/stage/expression completion, cached collection and field-name
suggestions, active-collection index-name suggestions for `dropIndex`,
destructive collection/admin confirmations, and transaction-helper unsupported
gates are supported. Routine desktop smoke proves seeded collection browse,
row-edit MQL preview/execute, query-tab `find` projection/sort/limit,
destructive `runCommand` confirmation, and cancel/no-mutation re-read.

**Current boundary**: Completion suggestions are editor assistance and stay
aligned to the runtime whitelist. Smoke evidence is runtime evidence for the
whitelisted paths above, while broader component/backend tests remain
below-smoke focused evidence. Arbitrary JavaScript, shell helpers such as
`use`/`show`, multiple statements, unsupported cursor helpers, cross-db shell
navigation, server-version feature promotion gates, and native document-first
result panels remain out of scope.

## Redis command

**Current support**: Redis connection/profile, backend KV primitives, key
browser, value preview/edit UI, selected-key bounded stream reader, bounded
command editor vocabulary/key suggestions, and static KV/stream fixture
inventory are active. Backend primitives are typed IPC calls for database/key
scan, typed value reads, guarded string set, delete confirmation, TTL
expire/persist, and bounded stream reads. The backend command allowlist
classifies read/write/TTL/stream/destructive effects and only allows single-key
destructive `DEL`/TTL-removal `PERSIST` when the request carries an exact
`confirmKey`. The value panel promotes bounded string/hash/list/set/zset edits,
selected stream start/end/count reads through `read_kv_stream`, and
expire/persist/delete preview/confirm controls; partial or unsupported key types
fail visibly. The Redis command editor suggests selected
read/write/TTL/stream/destructive allowlist commands with arity hints/snippets
and suggests current-DB keys filtered by command key type when scan cache is
available. Focused tests cover dispatch through `executeKvCommand`, tabular
projection, selected-key stream reader refresh/error behavior, and non-blocking
scan-cache fallback. Valkey reuses the KV protocol for connection/key scan/value
preview, selected-key stream reads, bounded command query dispatch, a narrower
command completion target for proven Valkey rows, and the same string plus
hash/list/set/zset KvMutationPanel write controls as Redis (#1075).

**Current boundary**: Redis command parser is not owned by language-core yet,
and the current backend parser is an allowlist, not arbitrary Redis CLI support.
Completion is TypeScript allowlist vocabulary plus current scan-cache key
suggestions; it is not an unsupported command-family surface or full Redis
autocomplete implementation. Unsupported command families reject with explicit
messages. Key suggestions are hints only and can be stale if Redis/Valkey
keyspace changes after scan. Full Redis CLI/admin parity, consumer-group stream
UI, broader command coverage, cluster/pubsub/modules/consumer-group management,
multi-key destructive commands, and full Valkey compatibility are not claimed.

## Valkey `redis-command` target

**Current support**: Valkey has a KV runtime slice for connection, database/key
scan, typed value preview, selected-key bounded stream reads, bounded
Redis-compatible command query dispatch, the same string plus hash/list/set/zset
KvMutationPanel write controls as Redis (#1075), and TypeScript command
completion for proven local-runtime rows (`GET`, `HGETALL`, `XRANGE`, `TYPE`,
`EXISTS`, `SET`, `EXPIRE`, `PERSIST`, `DEL`). Runtime Happy Path smoke covers
connect/key scan/value preview, `GET`, `HGETALL`, `XRANGE`, bounded
`SET`/`EXPIRE` DML summaries with readback/TTL verification, and
destructive/unsupported command guards through the Valkey service and
`e2e/fixtures/valkey/kv/seed.json`. Focused local Valkey testcontainer evidence
owns direct string set, expire, persist, exact-key delete, exact-key
`PERSIST`/`DEL` confirmation success, and broader proven-row backend details
below smoke. Completion key suggestions use the current DB scan cache and stay
hidden for unpromoted command families. Static fixture inventory includes
`e2e/fixtures/valkey.redis-compatibility.json`, which separates proven local
runtime rows from candidate families and rejected Redis assumptions.

**Current boundary**: The matrix and Redis evidence are not full Redis
compatibility evidence. Binary string editing, admin/server-control, broad
destructive, cluster, pub/sub, modules/functions, scripting, and consumer-group
commands stay rejected until separate workflow-specific safety/result-envelope
decisions land.

## Search DSL

**Current support**: Fixture-backed Search identities and bounded fixture DSL
exist for Elasticsearch/OpenSearch fixture result paths. Elasticsearch
connection/auth/TLS root probe is active, detects product/version/distribution,
live catalog reads indexes, aliases, data streams, mappings, settings/analyzers,
templates, and field paths, bounded live `_search` dispatch validates
`match_all`, `term`, `terms`, `match`, `bool` filter clauses, `range`, `exists`,
`terms`/`value_count` aggregations, pagination, `track_total_hits`, bounded
field sort, and bounded `_source` filters before HTTP dispatch, and
delete-by-query safety planning estimates matching documents through a safe
`_search` request as a preview plan, then executes a live `_delete_by_query`
behind a Safe Mode confirmation (backend IPC chokepoint). OpenSearch
connection/auth/TLS root probe is active, detects OpenSearch
product/version/distribution, rejects Elasticsearch endpoints, surfaces
auth/network failures, reads live indexes, aliases, data streams, mappings,
settings/analyzers, composable/legacy templates, and field paths, dispatches
bounded live `_search` requests through the same validator/result renderer with
sample documents, HTTP error handling, and cancellation, and uses the same safe
`_search` estimate for delete-by-query preview plans plus the same live
`_delete_by_query` execution behind a Safe Mode confirmation. Bounded TypeScript
editor completion uses product-scoped catalog/mapping context for
Elasticsearch/OpenSearch index, alias, data stream, field, type, `sort`, and
`_source` suggestions plus shared query/aggs/sort/source snippets. The response
parser renders hits/source/fields/highlights/sort, shard/timeout metadata,
aggregations, and explain/profile payloads returned by Elasticsearch/OpenSearch
live query or fixture paths. Runtime Happy Path smoke now proves representative
live Elasticsearch/OpenSearch connect/auth/TLS, catalog metadata, selected-index
detail, search/render, delete-plan, live delete-execution, and error-surface
workflows on Ubuntu.

**Current boundary**: Full language-core parser/completion ownership, broader
admin APIs (index/settings create/delete), profile/explain request workflow,
observability, and full query-language support are deferred. Unsupported Search
DSL body keys, unsupported aggregation kinds/options, raw/admin targets,
wildcard targets, unsupported delete-by-query body keys, script sort, broad
source options, and destructive/admin APIs are rejected before live Search
dispatch or destructive planning. Search fixture files mirror embedded adapter
contracts only.

## MSSQL SQL

**Current support**: Bounded SQL Server catalog/query/cancel/tabular runtime
plus primary-key-projected row edit through the frontend SQL batch path. `mssql`
exposes SQL-auth connection test/connect/ping, catalog
browse/schema/indexes/constraints/relationships, query, multi-statement
execution, cancellation, tabular result rendering, and key-projected editRows
with host, port, database, user, password, encryption, and
trust-server-certificate inputs.
#907 Runtime Happy Path smoke covers representative connect, seeded catalog browse, SELECT/DML, destructive Safe Mode confirmation, cancellation, and grid edit.
Parser/Safe Mode and completion own bounded editor assistance plus
unsupported-boundary recognition for tested T-SQL scripting/admin heads.

**Current boundary**: SQL Server structured DDL,
admin/security/backup/jobs/users/roles, broad parser/completion semantics,
SQLCMD/batch scripting, procedure-body scripting, import/export,
profiler/activity, full workbench parity, and full T-SQL semantics remain out of
scope.

## Oracle SQL

**Current support**: Bounded #905/#906 Oracle catalog/query/cancel/tabular
runtime plus primary-key-projected row edit through the frontend SQL batch path.
`oracle` keeps Oracle profile/dialect metadata, labels, service-name defaults,
URL parsing, and seed/spec inventory while enabling service-name lifecycle,
catalog metadata, SELECT/DML batch execution, cooperative cancellation, tabular
table-data query, key-projected editRows, Oracle identifier/literal SQL
generation, tested SELECT/DML/DDL Safe Mode classification, and bounded editor
assistance.
#907 Runtime Happy Path smoke covers representative service-name connect, seeded catalog/routine browse, SELECT/DML, destructive Safe Mode confirmation, cancellation, and grid edit.

**Current boundary**: Full Oracle SQL parser/completion promotion remains unclaimed.
#906 enables key-projected editRows and bounded static Safe Mode/editor
assistance; it does not enable switch database, structured DDL, raw DDL/admin,
PL/SQL body/package authoring/source, trigger catalog beyond the bounded catalog
smoke path, SID/TNS/wallet/TLS, advanced auth,
users/roles/grants/session/storage/admin paths, import/export,
profiler/activity, or full Oracle semantics.
