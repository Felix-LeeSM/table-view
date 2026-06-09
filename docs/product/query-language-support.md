# Query Language Support

This page records the current user-visible query surface. Engineering ownership
rules live in `memory/engineering/architecture/query-language/memory.md`; future
widening work lives in `docs/ROADMAP.md`.

## Reading This Page

- Server execution is still judged by the database server.
- Completion, Safe Mode, and typed dispatch only cover the subset the client can
  structurally understand.
- "Completion coverage" means the app has vocabulary for the current UI surface;
  it does not mean full dialect semantic validation.
- MongoDB does not run arbitrary JavaScript. Only whitelisted `db...`
  expressions are parsed and dispatched.
- Redis `redis-command` is an active profile/dispatch identity with bounded
  TypeScript command-name completion plus current-DB/type-filtered key
  suggestions. It is not full language-core parser ownership or full Redis
  autocomplete parity.
- Valkey uses `redis-command` for bounded Redis-compatible command query
  dispatch and the active key browser/value-preview slice.
  `e2e/fixtures/valkey.redis-compatibility.json` records proven, candidate, and
  rejected command-family rows. Completion is limited to proven local-runtime
  rows and safe keyspace hints; it is not direct key mutation, full Redis
  compatibility, or broader command-family support.

## Ownership Snapshot

Runtime-active languages are the languages used by `DataSourceProfile` entries
with active query execution capability. Elasticsearch now has a live connection
test, live catalog, bounded live Search query dispatch, and a backend bounded
Search DSL validator for supported query/filter/aggs request clauses plus
delete-by-query safety planning. Its wired Runtime Happy Path smoke proves the
representative live connect/catalog/search/render/delete-plan path; static
Elasticsearch/OpenSearch fixtures remain contract evidence only unless a live
smoke or focused runtime test wires the path.
OpenSearch now has focused live connection/catalog/query tests, wired Runtime
Happy Path smoke, and product-scoped catalog/mapping completion for URL/auth/TLS
root probe, product/version/distribution detection, indexes, aliases, data
streams, mappings, settings/analyzers, composable/legacy templates, field paths,
bounded live `_search` dispatch, result rendering, sample documents, HTTP error
surfacing, cancellation, and shared Search DSL safety validation before live
dispatch. `search-dsl` full language-core parser/completion ownership stays
future; the current active safety surface is backend request validation plus
bounded TypeScript editor assistance. OpenSearch support closure stays separate
from Elasticsearch: shared validator/result-renderer evidence covers common
bounded Search behavior, but OpenSearch-specific product detection,
Elasticsearch endpoint rejection, composable/legacy templates, sample documents,
and product-scoped completion must remain named.

`sql` is active for connection-supported SQL/RDBMS profiles only. MSSQL now has
connection-test runtime evidence for SQL authentication and SQL Server version
probe, bounded SELECT/DML query runtime, catalog/workbench metadata browse, and
primary-key-scoped row edit/write workflow support, plus bounded structured
table/index/constraint DDL preview/execute. Catalog-aware T-SQL completion is
active as SQL editor assistance where live cached metadata is loaded. Bounded
static T-SQL parser/Safe Mode metadata covers supported `SELECT`/DML/DDL slices
plus rejected scripting/admin paths. Runtime Happy Path smoke now covers the
representative MSSQL connect/catalog browse/SELECT/DML/row-edit/Safe Mode
confirmation path. These slices do not create TLS-required workflow, broader SQL
Server instance/auth behavior, SQLCMD/admin/security/backup/jobs/users/roles
support, or full T-SQL semantic support claims.
Oracle has connection-test runtime evidence for service-name connections plus
bounded SELECT tabular result envelopes, transactional DML batch commit/dry-run,
cancellation/error surfacing, catalog/workbench metadata for schemas, tables,
views, columns, indexes, constraints/FKs, routines/packages, and read-only
sequences/synonyms, and catalog-aware SQL editor autocomplete for schemas,
tables/views, columns, packages, sequences, synonyms, Oracle sequence members,
selected keywords/functions, and bind placeholders. Oracle completion has no
extra server-version gate today; capability-sensitive package/sequence/synonym
suggestions appear only when live cached catalog metadata contains those kinds,
and empty or metadata-denied catalog state yields no catalog suggestions. Oracle
also has primary-key-scoped row edit and a bounded static parser/Safe Mode
boundary for common SELECT/DML/DDL safety classification, with PL/SQL
package/admin paths unsupported. Bounded structured table/index/constraint DDL
preview/execute is active through the Structure DDL path, while raw DDL/admin
execution remains blocked. Runtime Happy Path smoke now proves the representative
local Oracle service-name connect/catalog browse/SELECT/DML preview/readback/
row-edit/Safe Mode confirmation path. Those slices do not create Oracle
sequence/synonym DDL/admin workflows, SID/TNS alias/wallet/TLS behavior, raw
DDL/admin execution, or full Oracle SQL/PL/SQL executable-semantics claims.

`redis-command` is active because Redis and Valkey are connection-supported KV
profiles. Redis has key browser/value panel support plus focused backend
command allowlist and `useQueryExecution` dispatch tests. Valkey reuses the same
bounded command allowlist for query dispatch and owns a narrower completion
target for proven local Valkey runtime rows, while direct key mutation controls
remain unpromoted for Valkey. The Redis command editor owns allowlist
command-name vocabulary, arity hints, and snippets plus key suggestions from the
current KV DB scan cache. Empty, failed, or stale scan states fall back to no key
suggestions instead of blocking the editor.

| QueryLanguageId | Lifecycle | Parser owner | Completion owner | Fallback policy | Safety analyzer |
|---|---|---|---|---|---|
| `sql` | `active` | `rust-wasm-language-core` | `rust-wasm-language-core` | `compatibility-mirror` | `rust-wasm-language-core` |
| `mongosh` | `active` | `rust-wasm-language-core` | `rust-wasm-language-core` | `compatibility-mirror` | `rust-wasm-language-core` |
| `redis-command` | `active` | `future-language-core-contract` | `typescript-runtime-adapter` | `none` | `profile-safety-policy` |
| `search-dsl` | `active` | `future-language-core-contract` | `typescript-runtime-adapter` | `none` | `profile-safety-policy` |

Declared or deferred language ids stay in the registry so future active profiles
cannot add parser or completion vocabulary without an owner decision.

| QueryLanguageId | Lifecycle | Parser owner | Completion owner | Fallback policy | Safety analyzer | Current boundary |
|---|---|---|---|---|---|---|
| `cql` | `deferred` | `future-language-core-contract` | `future-language-core-contract` | `not-implemented` | `profile-safety-policy` | Cassandra/Scylla profiles are not active. |
| `partiql` | `deferred` | `future-language-core-contract` | `future-language-core-contract` | `not-implemented` | `profile-safety-policy` | DynamoDB profiles are not active. |
| `cypher` | `deferred` | `future-language-core-contract` | `future-language-core-contract` | `not-implemented` | `profile-safety-policy` | Graph profiles are not active. |
| `gql` | `deferred` | `future-language-core-contract` | `future-language-core-contract` | `not-implemented` | `profile-safety-policy` | GraphQL profiles are not active. |
| `gremlin` | `deferred` | `future-language-core-contract` | `future-language-core-contract` | `not-implemented` | `profile-safety-policy` | Graph profiles are not active. |
| `vector-query` | `deferred` | `future-language-core-contract` | `future-language-core-contract` | `not-implemented` | `profile-safety-policy` | Vector profiles are not active. |
| `stream-command` | `deferred` | `future-language-core-contract` | `future-language-core-contract` | `not-implemented` | `profile-safety-policy` | Stream profiles are not active. |

## Current Product Surface

| Surface | Current support | Current boundary |
|---|---|---|
| PostgreSQL SQL | Strongest SQL parser/Safe Mode lane, but still a bounded client subset. Parser/Safe Mode covers tested SQL slices plus selected extension-tolerant syntax for symbolic operators and known extension-backed column types. Routine desktop smoke covers info/warn/destructive Safe Mode confirmation, raw DDL preview/confirm, grid-edit preview/confirm paths, and cancellation UI/history/retry behavior. Completion separately covers common keywords, functions, tables, columns, shell/meta command vocabulary, and installed extension inventory-gated curated packs for `pgcrypto`, `uuid-ossp`, `postgis`, `pgvector`, `citext`, `hstore`, and `pg_trgm`. Runtime smoke seeds `pgcrypto` and proves the installed-extension gate by surfacing `GEN_RANDOM_UUID` while withholding absent `uuid-ossp` candidates. Lightweight Explain has backend/API/component/parser/safety evidence plus routine desktop smoke for plan inspection from the query editor. | Full PL/pgSQL bodies, arbitrary vendor extension semantics, broad MERGE variants, nested/arbitrary function expressions, installed-extension semantic validation for parser/Safe Mode, catalog-backed enumeration of every extension symbol, server activity/session management UI, and profiler/activity dashboards are not modeled. |
| MySQL SQL | Runtime adapter supports connection, database/table browsing, catalog metadata for databases/schemas, tables, views, columns, indexes, constraints/FKs and live version-gated column CHECK hints, raw query execution, DML-oriented multi-statement batches, table data reads, row edits with MySQL backtick generated SQL/key projection, cancellation, and bounded structured DDL for tables/indexes/constraints. Routine desktop smoke covers connect, browse seeded table, SELECT result grid, DML batch per-statement result, row edit, cancellation/retry, history/source labels, and tabular result evidence. Completion uses the current connection/database catalog for schema, table/view, column, and routine suggestions, and covers MySQL-family keywords/functions plus backtick identifier contexts. Parser/Safe Mode understands the common SQL subset plus tested MySQL-family slices: `LIMIT offset, count`, `ON DUPLICATE KEY UPDATE`, and narrow `CALL proc(...)`. The adapter detects `SELECT VERSION()` context and gates CHECK/constraint catalog support at MySQL `>= 8.0.16`; older/unknown versions return empty CHECK hints. | Completion suggestions are editor assistance, not runtime support claims for stored routine body authoring or scripting. Stored routine/event bodies, routine control-flow scripting, broad `CALL` argument expressions, `DELIMITER`, and `LOAD DATA` are unsupported or explicitly rejected. Trigger metadata is browse-only in Structure; trigger create/drop is raw-SQL-only because structured trigger dialogs are not mapped to MySQL's inline trigger body model. Grid CSV/TSV export is generic; DB-level backup/restore/import/export and MySQL-restorable schema dumps are not claimed. |
| MariaDB SQL | Uses a distinct MariaDB `DatabaseType`, profile, and dialect identity while reusing the MySQL-family runtime adapter, CodeMirror dialect, parser/Safe Mode path, and capability family. Routine desktop smoke now runs against the MariaDB engine fixture for connect, seeded table browse, catalog/workbench metadata browse, SELECT, DML batch, row edit, cancellation/retry, history/source labels, and tabular result rendering. Row edit has hook evidence for the MySQL-family quoted, primary-key-projected preview/discard/commit path under MariaDB connection identity. Bounded table/index/constraint DDL has focused export/backend-preview evidence with MariaDB identity preserved in generated export headers. Catalog/workbench evidence covers tables, views, columns, indexes, constraints/FKs, and routine metadata browse; CHECK/constraint catalog support remains gated at MariaDB `>= 10.2.1`. Completion/profile vocabulary exposes the MySQL-family surface plus a MariaDB keyword-level `RETURNING` delta, suppressing that suggestion only when known server version context is below `10.0.5`. Parser/Safe Mode recognizes `RETURNING` as a structural clause on already-supported DML statement shapes and keeps the normal INSERT/UPDATE/DELETE safety tiers. | `RETURNING` is not a client-side version-gated runtime support guarantee in the app; raw execution is sent to MariaDB and the server remains the final judge. Broader MariaDB-only syntax, procedure body authoring/management, trigger create/drop, admin/import/export, and completion-runtime claims still need separate tests/docs before promotion. |
| SQLite SQL | File connection, table browsing, raw read queries, writable-file DML, transactional DML batches, dry-run rollback, and primary-key-scoped row edits are supported. Completion covers built-in SQLite keywords/functions, cached schema objects, and sqlite-cli dot-command vocabulary as suggestions with non-executable metadata. | Raw SQL DDL is rejected by the SQLite adapter, and structured DDL UI parity is not implemented. Unsupported `ALTER TABLE` actions are not auto-rebuilt, row edits require key/projected row identity, read-only file connections reject writes, nested JSON edits are deferred, sqlite-cli dot commands are not executed, and JSON1/FTS/RTREE/loadable-extension semantics are not detected, gated, dispatched, or validated client-side. SQLite completion does not consume extension inventory or enable extension-specific packs. |
| DuckDB SQL | DuckDB is a file-backed RDBMS profile (`rdb` + `file` connection kind). Local `.duckdb` files can be opened for catalog browsing, table reads, and statement-level raw SQL execution through the RDBMS tabular result path. GitHub Runtime Happy Path now wires a deterministic `.duckdb` desktop smoke for open, catalog/table browse, raw SELECT tabular result/history evidence, and read-only write rejection. Registered local CSV/Parquet/JSON/NDJSON analytics sources can be previewed from the DuckDB query toolbar and queried in the file-analytics dialog opened from that toolbar; the focused dialog/API evidence chooses a local file, registers an active-session source alias, exposes source alias/columns in workbench metadata, previews up to 100 rows, runs source-scoped SELECT against that alias, and records successful dialog queries with a distinct `FILE` history label. Public source/query payloads expose id, alias, file name, kind, size, columns, and preview SQL, not absolute local paths. Completion covers editor vocabulary, cached `.duckdb` schema objects, and active-session registered source aliases/columns after source metadata is loaded. | Structured DDL/write UI parity and file analytics global query editor/import/export parity are not implemented. Completion suggestions are editor assistance and do not override adapter blocklists. Extension install/load statements and helper functions, `COPY` file import/export, `ATTACH`/`DETACH`, sensitive external-file capability settings, shell commands, cloud/object-store access, and arbitrary external-file SQL functions or replacement scans are adapter-rejected; extension autoload is disabled. Read-only `.duckdb` files reject writes. |
| MongoDB Mongosh/MQL | Whitelisted `db...` collection/admin commands, JSON-like bodies, BSON literals, `find(filter, projection)`, cursor-chain `sort`/`skip`/`limit` dispatch, aggregate cursor-chain lowering, operator/stage/expression completion, cached collection and field-name suggestions, active-collection index-name suggestions for `dropIndex`, destructive collection/admin confirmations, and transaction-helper unsupported gates are supported. Routine desktop smoke proves seeded collection browse, row-edit MQL preview/execute, query-tab `find` projection/sort/limit, destructive `runCommand` confirmation, and cancel/no-mutation re-read. | Completion suggestions are editor assistance and stay aligned to the runtime whitelist. Smoke evidence is runtime evidence for the whitelisted paths above, while broader component/backend tests remain below-smoke focused evidence. Arbitrary JavaScript, shell helpers such as `use`/`show`, multiple statements, unsupported cursor helpers, cross-db shell navigation, server-version feature promotion gates, and native document-first result panels remain out of scope. |
| Redis command | Redis connection/profile, backend KV primitives, key browser, value preview/edit UI, bounded command editor vocabulary/key suggestions, and static KV/stream fixture inventory are active. Backend primitives are typed IPC calls for database/key scan, typed value reads, guarded string set, delete confirmation, TTL expire/persist, and bounded stream reads. The backend command allowlist classifies read/write/TTL/stream/destructive effects and only allows single-key destructive `DEL`/TTL-removal `PERSIST` when the request carries an exact `confirmKey`. The value panel promotes bounded string/hash/list/set/zset edits and expire/persist/delete preview/confirm controls; partial or unsupported key types fail visibly. The Redis command editor suggests selected read/write/TTL/stream/destructive allowlist commands with arity hints/snippets and suggests current-DB keys filtered by command key type when scan cache is available. Focused tests cover dispatch through `executeKvCommand`, tabular projection, and non-blocking scan-cache fallback. Valkey reuses the KV protocol for connection/key scan/value preview, bounded command query dispatch, and a narrower command completion target for proven Valkey rows. | Redis command parser is not owned by language-core yet, and the current backend parser is an allowlist, not arbitrary Redis CLI support. Completion is TypeScript allowlist vocabulary plus current scan-cache key suggestions; it is not an unsupported command-family surface or full Redis autocomplete implementation. Unsupported command families reject with explicit messages. Key suggestions are hints only and can be stale if Redis/Valkey keyspace changes after scan. Full Redis CLI/admin parity, stream consumer UI, broader command coverage, cluster/pubsub/modules/consumer-group management, multi-key destructive commands, and Valkey mutation support are not claimed. |
| Valkey `redis-command` target | Valkey has a KV runtime slice for connection, database/key scan, typed value preview, bounded Redis-compatible command query dispatch, and TypeScript command completion for proven local-runtime rows (`GET`, `HGETALL`, `XRANGE`, `TYPE`, `EXISTS`, `SET`, `EXPIRE`, `PERSIST`, `DEL`). Runtime Happy Path smoke covers connect/key scan/value preview, `GET`, `HGETALL`, `XRANGE`, bounded `SET`/`EXPIRE` DML summaries with readback/TTL verification, and destructive/unsupported command guards through the Valkey service and `e2e/fixtures/seed.valkey.json`. Focused local Valkey testcontainer evidence still owns exact-key `PERSIST`/`DEL` confirmation success and broader proven-row backend details below smoke. Completion key suggestions use the current DB scan cache and stay hidden for unpromoted command families. Static fixture inventory includes `e2e/fixtures/valkey.redis-compatibility.json`, which separates proven local runtime rows from candidate families and rejected Redis assumptions. | The matrix is not direct key mutation or full Redis compatibility evidence. Future support must prove Valkey identity with Valkey-specific server fields for broader compatibility claims and keep admin/server-control, broad destructive, cluster, pub/sub, modules/functions, scripting, and consumer-group commands rejected until separate workflow-specific safety/result-envelope decisions land. |
| Search DSL | Fixture-backed Search identities and bounded fixture DSL exist for Elasticsearch/OpenSearch fixture result paths. Elasticsearch connection/auth/TLS root probe is active, detects product/version/distribution, live catalog reads indexes, aliases, data streams, mappings, settings/analyzers, templates, and field paths, bounded live `_search` dispatch validates `match_all`, `term`, `terms`, `match`, `bool` filter clauses, `range`, `exists`, `terms`/`value_count` aggregations, pagination, `track_total_hits`, bounded field sort, and bounded `_source` filters before HTTP dispatch, and delete-by-query safety planning estimates matching documents through a safe `_search` request before requiring acknowledged risk plus exact target confirmation for execution intent. OpenSearch connection/auth/TLS root probe is active, detects OpenSearch product/version/distribution, rejects Elasticsearch endpoints, surfaces auth/network failures, reads live indexes, aliases, data streams, mappings, settings/analyzers, composable/legacy templates, and field paths, dispatches bounded live `_search` requests through the same validator/result renderer with sample documents, HTTP error handling, and cancellation, and uses the same safe `_search` estimate + exact-target confirmation gate for delete-by-query safety planning. Bounded TypeScript editor completion uses product-scoped catalog/mapping context for Elasticsearch/OpenSearch index, alias, data stream, field, type, `sort`, and `_source` suggestions plus shared query/aggs/sort/source snippets. The response parser renders hits/source/fields/highlights/sort, shard/timeout metadata, aggregations, and explain/profile payloads returned by Elasticsearch/OpenSearch live query or fixture paths. Runtime Happy Path smoke now proves representative live Elasticsearch/OpenSearch connect/catalog/search/render/delete-plan workflows on Ubuntu. | Full language-core parser/completion ownership, actual live `_delete_by_query` execution, broader admin APIs, profile/explain request workflow, observability, and full query-language support are deferred. Unsupported Search DSL body keys, unsupported aggregation kinds/options, raw/admin targets, unsupported delete-by-query body keys, script sort, broad source options, and destructive/admin APIs are rejected before live Search dispatch. Search fixture files mirror embedded adapter contracts only. |
| MSSQL SQL | SQL Server is an RDBMS identity with bounded connection/query/catalog/edit/DDL metadata runtime support, catalog-aware SQL editor completion, bounded static parser/Safe Mode metadata, and a wired Runtime Happy Path smoke. The active runtime slice is SQL authentication connection testing with TCP/TDS login, `SERVERPROPERTY('ProductVersion')` probe evidence, bounded SELECT tabular result envelopes, table data reads, DML/DDL execution, transactional DML batch commit/dry-run, cancellation, server error surfacing, primary-key-projected row edits, structured table/index/constraint DDL preview/execute, and catalog/workbench metadata for databases, schemas, tables, views, procedures/functions, columns, indexes, constraints, and FKs. Runtime smoke covers SQL Server connect, seeded `dbo` table/view/procedure browse, `SELECT TOP`, DML preview/execute/readback, destructive confirmation, and grid-edit SQL preview/commit. Row edit and generated structured DDL use bracket identifiers; row edit stays PK-only with no all-column WHERE fallback. Completion uses the live cached catalog for database, schema, table/view, procedure/function, and column suggestions where metadata is loaded, and keeps curated keyword/function plus bracket identifier quoting support for editor assistance only; procedure/function candidates are object suggestions, not procedure execution or body-authoring support. Static parser/Safe Mode recognizes bounded T-SQL slices: bracket identifiers, `N'...'` strings, `SELECT TOP`, common DML, bounded CREATE/ALTER/DROP/TRUNCATE DDL, and SQL Server type synonyms that map to existing AST types. Unsupported scripting/admin boundaries such as `EXEC`, `EXECUTE`, `GO`, `USE`, `DBCC`, `DENY`, `BACKUP`, and `RESTORE` classify as warn/danger safety metadata instead of active execution support. | MSSQL has Lifecycle, RelationalCatalog, RelationalQuery, and RelationalSchemaMutation backend capability plus primary-key-scoped row-edit profile/runtime support. TLS-required workflow, broader SQL Server instance/auth behavior, `TOP PERCENT`, `WITH TIES`, procedure bodies, batches, SQLCMD, SQL Server admin tooling, security/backup/jobs/users/roles support, and full T-SQL semantic completion remain unsupported. Completion suggestions and static parser/Safe Mode metadata do not widen runtime SQL Server support. |
| Oracle SQL | Oracle has service-name connection UI/runtime support, bounded SELECT tabular result envelopes, transactional DML batch commit/dry-run, cancellation/error surfacing, table-data browse, primary-key-scoped row edit, bounded structured table/index/constraint DDL preview/execute, live catalog/workbench metadata for current service/database, schemas, tables, views, columns, indexes, constraints/FKs, routines/packages, and read-only sequences/synonyms through the shared RDB model, catalog-aware Oracle SQL editor autocomplete for schemas, tables/views, columns, packages, sequences, synonyms, detected sequence members, selected keywords/functions, and bind placeholders, and bounded static parser/Safe Mode evidence for SELECT including `DUAL`, INSERT, bounded UPDATE/DELETE, WHERE-less UPDATE/DELETE destructive detection, narrow MERGE, CREATE TABLE/INDEX/VIEW, Oracle `NUMBER`/`VARCHAR2`/`CLOB`/`BLOB` column types, ALTER ADD/RENAME, and DROP/TRUNCATE/ALTER DROP destructive detection. Runtime Happy Path smoke covers local Oracle service-name connect, current-user catalog browse, SELECT, DML preview/readback, row-edit preview/commit, and Safe Mode destructive confirmation. | Oracle has Lifecycle, RelationalCatalog, RelationalQuery, and RelationalSchemaMutation runtime capability for the bounded Structure DDL path only. Row edit uses Oracle quoted identifiers and no all-column WHERE fallback; no-PK tables remain browse-only. Metadata-denied dictionary reads fail safe-empty where the adapter can identify Oracle metadata denial. Oracle completion has no extra server-version gate today; capability-sensitive package/sequence/synonym suggestions require detected catalog kinds, and empty catalog state stays safe-empty. Raw DDL/admin execution, sequence/synonym DDL/admin workflows, SID/TNS alias/wallet/TLS behavior, and full PL/SQL executable semantics remain unsupported. PL/SQL blocks, package/routine DDL, routine execution, users/roles/grants/session/storage/admin paths, and privilege paths are outside the runtime boundary. Completion suggestions and parser/Safe Mode metadata do not widen runtime Oracle support. |

### PostgreSQL SQL Support Breakdown

- Runtime: connection, catalog/table data, raw SELECT/EXPLAIN row results,
  plan-only `EXPLAIN (FORMAT JSON)`, DML batches, query cancellation, and
  raw-query grid edit paths are active through the PostgreSQL adapter.
- Parser / safety: bounded SQL slices, destructive/warn/info classification,
  raw DDL preview, grid-edit preview, and EXPLAIN inner statement analysis are
  tested. Extension-tolerant syntax is structural, not full extension semantic
  validation.
- Completion / autocomplete: common SQL vocabulary, schema objects, shell/meta
  command suggestions, and curated installed-extension packs are available.
  Installed extension inventory gates known packs such as `pgcrypto`; the app
  does not enumerate every extension-provided symbol.
- Routine smoke: GitHub Runtime Happy Path covers connect/browse/edit/query,
  Explain, installed-extension-gated completion, Safe Mode, and cancellation
  for PostgreSQL on Ubuntu.

### MySQL SQL Support Breakdown

This breakdown keeps runtime, parser/safety, autocomplete, and routine smoke
claims separate for the MySQL docs recheck gate.

- Runtime: connection, database/table browse, table data reads, raw SELECT, DML
  batches, cancellation, and key-projected row edits are active through the
  MySQL adapter. Generated row-edit SQL uses MySQL backtick identifier quoting
  for schema/table/columns, primary-key row projection for UPDATE/DELETE, and
  covered JSON/scalar/null coercion in preview/commit/discard paths.
- Parser / safety: common SQL plus targeted MySQL-family slices are tested;
  stored routine/event bodies, routine control-flow fragments, `DELIMITER`, and
  `LOAD DATA` are explicit unsupported editor/backend boundaries.
- Completion / autocomplete: MySQL uses the Rust/WASM catalog path for current
  connection/database schema, table/view, column, and routine suggestions.
  Schema-qualified object/routine prefixes and MySQL backtick identifier
  contexts are covered. Suggestions do not imply parser/Safe Mode or backend
  runtime support for unsupported routine bodies or scripting.
- Routine smoke: GitHub Runtime Happy Path covers connect, seeded table browse,
  SELECT, DML batch, row edit, cancellation/retry, history/source labels, and
  tabular result rendering for MySQL on Ubuntu. It is a baseline smoke claim,
  not broader procedure-management, completion-runtime, admin, import/export, or
  MySQL Workbench parity.

### MariaDB SQL Support Breakdown

- Runtime: MariaDB uses a distinct `mariadb` connection/profile identity and a
  MariaDB engine fixture while reusing the MySQL-family adapter path for the
  current baseline. Catalog/workbench metadata browse covers tables, views,
  columns, indexes, constraints/FKs, and routine metadata through the shared
  adapter with MariaDB-specific smoke seed/category evidence. Key-projected row
  edits and bounded table/index/constraint DDL use the MySQL-family SQL emitter
  path with MariaDB-specific test evidence.
- Shared MySQL-family paths: MariaDB intentionally routes through
  `MysqlAdapter::new_mariadb()` from `make_adapter`, the runtime
  `src-tauri/src/db/mysql/**` catalog/query/edit/cancel implementation, the
  shared `src-tauri/src/commands/connection/crud.rs` connection-test path, the
  MySQL CodeMirror dialect, the MySQL-family parser/Safe Mode scripting
  boundary, the `mysql-client` completion shell family, and the
  `MYSQL_FAMILY_CAPABILITIES` / adapter-conformance family.
- Parser / safety: MariaDB shares the tested MySQL-family parser/Safe Mode
  boundary today, including explicit unsupported scripting/file-import
  guardrails. For `RETURNING`, the parser/Safe Mode decision is structural:
  `INSERT ... RETURNING` stays additive info-tier, bounded `UPDATE`/`DELETE ...
  RETURNING` stays warn-tier, and WHERE-less `UPDATE`/`DELETE ... RETURNING`
  stays danger-tier. This is not a runtime/version gate.
- Completion / autocomplete: MariaDB shares MySQL-family vocabulary and exposes
  the keyword-level profile/completion `RETURNING` delta for unknown server
  versions and known MariaDB versions at `>= 10.0.5`; known older versions
  suppress the suggestion. That delta is not a runtime support guarantee.
- MariaDB-specific deltas: the active adapter still reports `mariadb`, the
  profile/dialect id remains `mariadb`, CHECK/constraint catalog promotion
  requires MariaDB version evidence at `>= 10.2.1`, and `RETURNING` remains
  profile/completion plus structural parser/Safe Mode evidence only. The app
  only uses MariaDB `>= 10.0.5` as a keyword completion-suggestion gate and
  does not add a MariaDB `RETURNING` runtime/version support claim.
- Support-claim closure: MariaDB docs and the testing matrix now separate live
  engine smoke, focused shared-path tests, parser/Safe Mode structure, and
  autocomplete evidence from future MariaDB-only runtime/admin/import/export
  promotion slices.
- Routine smoke: GitHub Runtime Happy Path covers connect, seeded table browse,
  catalog metadata browse, SELECT, DML batch, row edit, cancellation/retry,
  history/source labels, and tabular result rendering for MariaDB on Ubuntu. It
  is a bounded workbench smoke claim, not broader MariaDB-only syntax, procedure
  body authoring/management, trigger CRUD, completion-runtime, admin,
  import/export, or full vendor CLI/admin parity.

### Redis Command Support Breakdown

- Runtime: Redis connection/profile, database/key scan, key browser, typed value
  preview, bounded value mutation panel, and Redis command editor are the
  shipped product surface. Focused frontend/backend tests cover the
  `useQueryExecution` -> `executeKvCommand` dispatch path for selected commands.
- Parser / safety: Redis command handling is a backend allowlist, not
  language-core parser ownership. It classifies selected read/write/TTL/stream/
  destructive commands, requires exact-key confirmation for single-key
  `DEL`/`PERSIST`, and rejects unsupported command families.
- Completion / autocomplete: `redis-command` has TypeScript-owned command-name
  vocabulary for the backend allowlist plus current-DB key suggestions from a
  bounded first-page key scan. Key suggestions are filtered by command key type
  where available and fall back to no key suggestions when the scan cache is
  empty, loading, failed, or unavailable.
- Evidence: `e2e/fixtures/seed.redis.json` is fixture/contract inventory, not a
  live runtime or desktop E2E smoke claim by itself. The wired Runtime Happy
  Path Redis smoke uses that deterministic DB 2 fixture for connect, scan,
  preview, `GET`, guarded string write, TTL, and exact-key delete coverage.
  Broader Redis command dispatch remains focused component/backend/core evidence
  below full CLI parity.

### Valkey Redis Compatibility Boundary

- Current status: Valkey has a KV runtime slice for connection test/connect,
  database/key scan, typed value preview, bounded Redis-compatible command query
  dispatch, and command completion for proven local-runtime rows. Direct key
  mutation controls and full Redis compatibility are not claimed.
- Compatibility matrix: `e2e/fixtures/valkey.redis-compatibility.json` separates
  proven local Valkey runtime rows from candidate families and rejected
  assumptions. Redis Runtime Happy Path smoke does not count as Valkey evidence;
  the wired Valkey smoke is the Runtime Happy Path evidence for the promoted
  slice. Unsupported Redis families cannot widen for Valkey without separate
  safety and result-envelope decisions.
- Detection delta: future Valkey promotion must prove Valkey-specific server
  identity instead of relying on Redis-compatible identity fields alone.
- Proven command rows: database/keyspace browse, string value preview plus
  `SET EX` dispatch, `HGETALL`, `EXPIRE`/`PERSIST` confirmation, bounded
  `XRANGE`, unsupported-family rejection, and exact-key `DEL` confirmation run
  against a local Valkey runtime.
- Rejected families: admin/server-control, broad destructive commands, cluster,
  pub/sub, modules/functions, arbitrary scripting, and consumer-group workflows
  remain out of scope even if a Valkey server accepts Redis-compatible command
  names.

### Search DSL Support Breakdown

- Runtime: Elasticsearch and OpenSearch live connection test, catalog/index
  detail fetch, bounded `_search` dispatch, Search-native result rendering,
  delete-by-query safety planning, and query cancellation/error surfacing are
  active. Runtime Happy Path smoke covers representative Elasticsearch and
  OpenSearch connect/catalog/search/render/delete-plan paths on Ubuntu.
- Parser / safety: Search DSL handling is a backend request validator plus
  source-specific safety policy, not language-core parser ownership. The live
  validator allows only the documented query/filter/aggs subset and rejects
  unsupported body keys, unsupported aggregations, raw/admin targets, and
  unsupported delete-by-query request shapes before dispatch.
- Completion / autocomplete: bounded TypeScript editor completion is active for
  Elasticsearch/OpenSearch catalog and mapping context. It suggests
  product-scoped indexes, aliases, data streams, fields, field types, `sort`,
  `_source`, and shared bounded query/aggs/sort/source snippets. This is editor
  assistance only; full language-core parser/completion ownership remains
  deferred, and backend request validation is runtime safety evidence rather
  than autocomplete evidence.
- Fixture / live evidence: `seed.search.elasticsearch.json` and
  `seed.search.opensearch.json` mirror embedded fixture contracts. The wired
  Elasticsearch/OpenSearch smoke specs are live runtime evidence for their
  representative product paths. OpenSearch has focused live
  connection/catalog/query/destructive-plan evidence for indexes, aliases, data
  streams, mappings, settings/analyzers, templates, field paths, bounded
  `_search` dispatch/rendering, sample documents, error handling, cancellation,
  and safe `_search` delete-by-query estimates.
- Remaining unsupported work: actual live `_delete_by_query` execution,
  profile/explain request workflow, broader admin APIs, and
  observability/error-surface smoke remain future gates.

## Result Boundary

RDBMS query IPC is normalized into a `tabular` result envelope at
`src/lib/tauri/query.ts`. Existing grid consumers still receive the legacy
`QueryResult` projection, but new source work must choose an explicit
`ResultEnvelopeKind` instead of assuming every result can render through
`QueryResultGrid`.

## Current Unsupported Boundaries

For server-backed SQL adapters, unsupported syntax can still execute on the
database server when sent through a raw SQL path. The client may only lose
completion, typed dispatch, or Safe Mode precision. File-backed adapters may also
block specific runtime slices before dispatch. Current product-facing boundaries
are:

- SQL parser/Safe Mode is PostgreSQL/ANSI-centered and widens by tested slices;
  selected extension-tolerant syntax is accepted only as structure, not as full
  extension semantics.
- PostgreSQL installed extension inventory activates only curated completion
  packs for known extensions. It does not semantically validate extension usage,
  make parser/Safe Mode dependent on installed extensions, or enumerate every
  extension-provided symbol.
- PostgreSQL Lightweight Explain is a plan-inspection path. Routine desktop
  smoke covers opening a plan from the query editor and recording an Explain
  history source label; it is not a profiler or activity dashboard claim.
- PostgreSQL query cancellation is a query toolbar/API path. Routine desktop
  smoke covers cancelling a long query, rendering cancelled state/history,
  clearing stale result grids, and retrying a fast query; it is not server
  activity/session management UI.
- Destructive-operation protection is source-specific. PostgreSQL routine smoke
  covers the implemented info/warn/destructive Safe Mode, raw DDL preview, and
  grid-edit preview paths; other claims remain limited to implemented preview,
  confirmation, Safe Mode, typed confirmation, and fixture-backed destructive-plan
  paths. This page does not claim a universal dry-run engine, admin audit log,
  or role/user/permission workflow.
- MySQL/MariaDB scripting and file import directives are not normalized into
  server SQL. Stored routine/event bodies, routine control-flow fragments,
  `DELIMITER`, and `LOAD DATA` are explicit unsupported boundaries.
- MySQL catalog-aware completion can suggest routines from the current catalog,
  but a routine suggestion is not a stored routine body authoring or execution
  support claim. Unsupported scripting remains unsupported even when names are
  available as autocomplete candidates.
- MariaDB shares the MySQL-family parser/Safe Mode path today and now has a
  MariaDB-engine routine smoke baseline. MariaDB `RETURNING` is tracked as a
  dialect profile and completion vocabulary delta; it is not yet a separate
  runtime/version-gated support claim. Constraint catalog conformance is
  version-gated separately from this completion delta.
- MySQL/MariaDB/MSSQL structured DDL is bounded to the implemented table/index/
  constraint requests and their preview/export or preview/execute lifecycle. Trigger metadata
  remains browse-only in Structure; trigger create/drop, DB-level dump/restore/
  import/export, and vendor-restorable SQL export remain future work or raw-SQL/
  server-resolved behavior.
- SQLite read queries can run on readable files, while raw SQL writes are
  limited to DML on writable files. Transactional DML batch and dry-run paths
  exist, but raw DDL, structured DDL UI parity, unsupported `ALTER TABLE`
  rebuilds, nested JSON edits, and SQLite extension/capability-specific
  validation remain future work.
- SQLite completion can suggest built-in SQLite vocabulary, cached schema
  objects, and sqlite-cli dot-command vocabulary. Dot commands carry
  non-executable completion metadata; extension-specific candidates are not
  dispatched, detected, consumed from inventory, or gated by installed
  capabilities.
- DuckDB remains an RDBMS + `file` connection kind unless future evidence
  requires a separate file-SQL paradigm.
- DuckDB `.duckdb` raw SQL uses the RDBMS adapter path for statement-level
  execution. The adapter rejects extension install/load statements and helper
  functions, `COPY` import/export, `ATTACH`/`DETACH`, sensitive external-file
  capability settings, raw external-file functions, and string replacement
  scans; extension autoload is disabled. Read-only files reject writes.
- DuckDB completion is deliberately separate from runtime permission: cached
  schema objects and generic editor vocabulary do not make blocked extension,
  external-file, `COPY`, or attached-database statements supported.
- DuckDB file analytics has registered local source preview basics and modal
  source-scoped SELECT focused component/API/backend evidence. Local paths
  remain active-session adapter state and clear on connect/disconnect; public
  source/preview/query payloads and backend error messages redact absolute
  paths. Global query editor/import/export parity and E2E smoke coverage remain
  future promotion gates in the H3 smoke matrix.
- Export remains the generic explicit save-dialog grid export for current grid
  rows. It is not an automatic export path for registered DuckDB local file
  sources.
- Redis command execution is limited to the backend allowlist. Selected read,
  write, TTL, and stream commands have focused typed Redis adapter dispatch and
  tabular projection evidence; unsupported command families fail clearly. The
  value panel is limited to bounded string/hash/list/set/zset edits plus
  expire/persist/delete preview/confirm controls. The shipped Redis command
  editor adds bounded allowlist command vocabulary with arity hints/snippets and
  current-DB/type-filtered key suggestions. This is not full Redis CLI/admin
  parity, language-core parser ownership, broader Redis completion ownership,
  broader command coverage, stream consumer UI, cluster/pubsub/modules/
  consumer-group management, multi-key destructive command support, or Valkey
  command compatibility claim.
- MongoDB support is limited to the tested whitelist. Arbitrary JavaScript,
  shell helpers, multiple statements, and cross-db shell navigation are
  intentionally unsupported and are not suggested as supported completions.
  Completion can use cached collection names, inferred fields, and active
  collection index names where available; those suggestions do not widen
  runtime support. Runtime smoke covers a representative connect/browse/edit/
  query/safety path only; it does not promote full vendor shell/admin parity.
  Destructive collection/admin commands require a confirmation before the
  backend safety acknowledgement is sent. Transaction helpers
  (`startSession`, `startTransaction`, `withTransaction`,
  `commitTransaction`, `abortTransaction`) fail at parse time with an explicit
  standalone-deployment unsupported message rather than attempting partial
  transaction emulation.
- Redis has backend KV primitives, key browser/value preview/edit UI, bounded
  command dispatch/completion, current-DB/type-filtered key suggestions, and a
  wired representative Runtime Happy Path smoke. Fixture inventory is runtime
  evidence only for paths wired into that smoke. Redis completion remains a
  TypeScript allowlist/key-suggestion surface, not language-core parser or full
  Redis completion ownership. Valkey now has focused local testcontainer
  evidence for connection, key scan, value preview, and bounded command query
  dispatch plus wired Runtime Happy Path smoke and proven-row command
  completion. Direct key mutation controls and full Redis compatibility are not
  claimed.
- Search DSL has bounded live Elasticsearch/OpenSearch `_search` dispatch,
  backend request validation for the supported query/filter/aggs subset,
  response parsing, wired Runtime Happy Path smoke for representative live
  Elasticsearch/OpenSearch workflows, and Elasticsearch/OpenSearch fixture/live
  delete-by-query safety plans with estimate + confirmation gates. Bounded
  TypeScript editor completion is active for product-scoped catalog/mapping
  suggestions, but actual live `_delete_by_query` execution, full language-core
  parser/completion ownership, broader admin, observability, and product-delta
  gates remain deferred.
- MSSQL runtime is limited to SQL authentication connection test, SQL Server
  version probe, bounded SELECT tabular envelopes, DML/DDL execution,
  transactional DML batch commit/dry-run, cancellation, server error surfacing,
  table data browse, primary-key-projected row edit, bounded structured
  table/index/constraint DDL, and catalog/workbench metadata
  browse for databases/schemas/tables/views/procedures/functions/columns/indexes/constraints/FKs.
  Runtime Happy Path smoke covers representative connect/catalog browse/SELECT/DML/row-edit/Safe
  Mode confirmation paths, and completion uses that
  live cached catalog for database/schema/table/view/procedure/column
  suggestions where metadata is loaded, plus curated T-SQL vocabulary and
  bracket identifier quoting. These do not imply TLS-required workflow,
  SQLCMD/admin/security/backup/jobs/users/roles/full T-SQL semantics, or runtime
  support for every suggested object. Oracle has a bounded runtime slice for
  service-name connection, SELECT tabular envelopes, transactional DML batches,
  cancellation, error surfacing, and catalog/workbench metadata for the shared
  RDB model, primary-key-scoped row edit, bounded static SQL editor autocomplete
  vocabulary, bounded static parser/Safe Mode metadata, and representative
  Runtime Happy Path smoke; this does not imply Oracle sequence/synonym
  DDL/admin workflows, raw DDL/admin execution, SID/TNS/wallet/TLS behavior, or
  full Oracle SQL/PL/SQL executable semantics. Bounded table/index/constraint
  structured DDL is the explicit exception.
- Deferred language ids for CQL, PartiQL, Cypher, GQL, Gremlin, vector query,
  and stream commands do not create active profiles or support claims.
  Cassandra/Scylla, DynamoDB, graph, vector, and stream sources stay
  candidate-only until a source-specific promotion PR locks workflow value,
  profile target, language owner, catalog model, result envelope, safety policy,
  fixture strategy, and smoke evidence.

## Related

- [`docs/product/known-limitations.md`](known-limitations.md) — product-visible limitations
- [`docs/ROADMAP.md`](../ROADMAP.md) — future query-language widening
- [`memory/engineering/architecture/query-language/memory.md`](../../memory/engineering/architecture/query-language/memory.md) — engineering ownership rules
