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
  rows and safe keyspace hints; it is not direct UTF-8 string-key mutation UI
  evidence, full Redis compatibility, or broader command-family support.
- Deferred language ids for Cassandra/Scylla, DynamoDB, graph, vector, and stream
  sources are future inventory only. They do not create active `DatabaseType`,
  profile, runtime, parser/completion, fixture/live, or E2E support claims.

## Ownership Snapshot

Runtime-active languages are the languages used by `DataSourceProfile` entries
with active query execution capability. Elasticsearch now has a live connection
test, live catalog, bounded live Search query dispatch, and a backend bounded
Search DSL validator for supported query/filter/aggs request clauses plus
delete-by-query safety planning and live `_delete_by_query` execution behind a
Safe Mode confirmation. Its wired Runtime Happy Path smoke proves the
representative live connect/auth/TLS contract, catalog metadata, selected-index
detail, search render, delete-plan, live delete-execution, and error-surface
path; static
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
a bounded SQL Server catalog/query/cancel/tabular runtime slice plus
primary-key-projected row edit through the frontend SQL batch path:
source-specific SQL-auth/TDS connection test/connect/ping, catalog metadata,
multi-statement query execution, cancellation, and tabular result rendering with
explicit encryption and trust-server-certificate inputs. #907 adds
representative Runtime Happy Path smoke for connect, seeded catalog browse,
SELECT/DML, destructive Safe Mode confirmation, cancellation, and grid edit.
That slice does not promote SQL Server structured DDL, broad parser/completion
semantics, admin workflows, or SQLCMD/procedure-body scripting support. Oracle
has a bounded #905/#906 catalog/query/cancel/tabular/edit-row runtime slice:
source-specific service-name lifecycle, catalog metadata, SELECT/DML batch
execution, cooperative cancellation, tabular table-data query, and
primary-key-projected row edit are active through a wrapper that blocks
structured DDL/body-source surfaces. #907 adds representative Runtime Happy
Path smoke for service-name connect, seeded catalog/routine browse, SELECT/DML,
destructive Safe Mode confirmation, cancellation, and grid edit. SID, TNS,
wallet, TLS, advanced auth, raw DDL/admin, parser/completion promotion, PL/SQL
body/package authoring/source, trigger catalog beyond the bounded catalog smoke
path, and broader Oracle semantics remain unclaimed. Future promotion beyond
the MSSQL/Oracle bounded runtime and smoke slices must land matching
source-specific runtime, contract, docs, and smoke evidence before adding
broader SQL Server T-SQL or Oracle SQL/PLSQL parser/completion/runtime claims.

`redis-command` is active because Redis and Valkey are connection-supported KV
profiles. Redis has key browser/value panel support plus focused backend
command allowlist and `useQueryExecution` dispatch tests. Valkey reuses the same
bounded command allowlist for query dispatch and owns a narrower completion
target for proven local Valkey runtime rows, while direct mutation controls share
the same string plus hash/list/set/zset KvMutationPanel write surface as Redis
(#1075). The Redis command editor
owns allowlist command-name vocabulary, arity hints, and snippets plus key
suggestions from the current KV DB scan cache. Empty, failed, or stale scan
states fall back to no key suggestions instead of blocking the editor.

| QueryLanguageId | Lifecycle | Parser owner | Completion owner | Fallback policy | Safety analyzer |
|---|---|---|---|---|---|
| `sql` | `active` | `rust-wasm-language-core` | `rust-wasm-language-core` | `compatibility-mirror` | `rust-wasm-language-core` |
| `mongosh` | `active` | `rust-wasm-language-core` | `rust-wasm-language-core` | `compatibility-mirror` | `rust-wasm-language-core` |
| `redis-command` | `active` | `future-language-core-contract` | `typescript-runtime-adapter` | `none` | `profile-safety-policy` |
| `search-dsl` | `active` | `future-language-core-contract` | `typescript-runtime-adapter` | `none` | `profile-safety-policy` |

Declared or deferred language ids stay in the registry so future active profiles
cannot add parser or completion vocabulary without an owner decision. Deferred
ids are promotion prerequisites only; they are not active profile, runtime,
fixture/live, or E2E evidence.

| QueryLanguageId | Lifecycle | Parser owner | Completion owner | Fallback policy | Safety analyzer | Current boundary |
|---|---|---|---|---|---|---|
| `cql` | `deferred` | `future-language-core-contract` | `future-language-core-contract` | `not-implemented` | `profile-safety-policy` | Cassandra/Scylla profiles are not active; future promotion must assign CQL parser/completion to the Rust/WASM language-core owner. |
| `partiql` | `deferred` | `future-language-core-contract` | `future-language-core-contract` | `not-implemented` | `profile-safety-policy` | DynamoDB profiles are not active; DynamoDB's candidate contract is native API-first, so PartiQL remains deferred editor/query-language inventory until a later source-specific PR proves parser, completion, safety, runtime, fixture, and smoke evidence. |
| `cypher` | `deferred` | `future-language-core-contract` | `future-language-core-contract` | `not-implemented` | `profile-safety-policy` | Graph profiles are not active; future graph promotion is Cypher-first. |
| `gql` | `deferred` | `future-language-core-contract` | `future-language-core-contract` | `not-implemented` | `profile-safety-policy` | GraphQL profiles are not active; GQL is deferred behind the Cypher-first graph contract. |
| `gremlin` | `deferred` | `future-language-core-contract` | `future-language-core-contract` | `not-implemented` | `profile-safety-policy` | Graph profiles are not active; Gremlin is deferred behind the Cypher-first graph contract. |
| `vector-query` | `deferred` | `future-language-core-contract` | `future-language-core-contract` | `not-implemented` | `profile-safety-policy` | Vector profiles are not active; future promotion must choose `vector-query` or provider filter DSL, prove parser/completion/safety/runtime/fixture/smoke evidence, and keep cloud providers behind a separate `cloud-api` profile decision and threat-model handoff. |
| `stream-command` | `deferred` | `future-language-core-contract` | `future-language-core-contract` | `not-implemented` | `profile-safety-policy` | Stream profiles are not active; future promotion must choose bounded `stream-command` or typed API dispatch before language-core parser/completion ownership. |

## Current Product Surface

Split into child pages:

- [`query-language-support-surface-matrix.md`](query-language-support-surface-matrix.md) — per-source support/boundary matrix
- [`query-language-support-sql-breakdowns.md`](query-language-support-sql-breakdowns.md) — PostgreSQL, MySQL, MariaDB breakdowns
- [`query-language-support-kv-search-breakdowns.md`](query-language-support-kv-search-breakdowns.md) — Redis, Valkey, Search DSL breakdowns

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
- MySQL/MariaDB structured DDL is bounded to the implemented table/index/
  constraint requests and their preview/export or preview/execute lifecycle. Trigger metadata
  remains browse-only in Structure; the DML dump is now vendor-restorable
  (backtick + MySQL-escaped INSERTs, #1641), while trigger create/drop and
  DB-level dump/restore/import/export remain future work or raw-SQL/
  server-resolved behavior.
- SQLite read queries can run on readable files, while raw SQL writes are
  limited to DML on writable files. Transactional DML batch and dry-run paths
  exist, but raw DDL, structured DDL UI parity, unsupported `ALTER TABLE`
  rebuilds, nested JSON edits, virtual-table CRUD, broad extension semantics,
  and SQLite capability-specific parser/Safe Mode validation remain future work.
- SQLite completion can suggest built-in SQLite vocabulary, cached schema
  objects, sqlite-cli dot-command vocabulary, and detected-only JSON1/FTS5
  read-query assistance. Dot commands carry non-executable completion metadata;
  RTREE is inventory metadata only, loadable extensions are not enabled, and
  detected capabilities do not make extension-specific runtime or parser/Safe
  Mode claims.
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
- DuckDB file analytics has registered local source preview basics, modal
  source-scoped SELECT focused component/API/backend evidence, global query
  editor SELECT through the normal result surface/backend path, and dedicated
  Runtime Happy Path smoke for registered deterministic CSV source -> global
  editor SELECT -> result grid -> `FILE` history/source evidence -> no absolute
  local path in visible UI. Local paths remain active-session adapter state and
  clear on connect/disconnect; public source/preview/query payloads and backend
  error messages redact absolute paths. Automatic import/export workflows
  remain future promotion gates in the H3 smoke matrix.
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
  broader command coverage, consumer-group stream UI, cluster/pubsub/modules/
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
  completion. The shared Redis/Valkey string plus hash/list/set/zset
  KvMutationPanel write controls (#1075) have focused backend/component
  evidence; full Redis compatibility is not claimed.
- Search DSL has bounded live Elasticsearch/OpenSearch `_search` dispatch,
  backend request validation for the supported query/filter/aggs subset,
  response parsing, wired Runtime Happy Path smoke for representative live
  Elasticsearch/OpenSearch workflows, and Elasticsearch/OpenSearch fixture/live
  delete-by-query safety plans plus live `_delete_by_query` execution behind a
  Safe Mode confirmation (backend IPC chokepoint). Bounded
  TypeScript editor completion is active for product-scoped catalog/mapping
  suggestions, but full language-core parser/completion ownership, broader admin
  (index/settings create/delete), observability, and product-delta gates remain
  deferred.
- MSSQL is a bounded SQL Server catalog/query/cancel/tabular runtime identity.
  Its labels, defaults, URL parsing, dialect/profile ids, SQL-auth/TDS
  connection path, catalog/query runtime, and #907 Runtime Happy Path smoke do
  not create active parser, completion, structured DDL, admin, or full T-SQL
  support.
  Oracle is a bounded catalog/query/cancel/tabular/edit-row runtime identity,
  but does not add Oracle structured DDL, raw DDL/admin, full parser/completion
  promotion, PL/SQL body/package work, or trigger catalog beyond the bounded
  catalog smoke path.
  Promotion requires source-specific runtime, contract, docs, and smoke evidence
  before any SQL Server or Oracle support claim widens beyond those boundaries.
- Deferred language ids for CQL, PartiQL, Cypher, GQL, Gremlin, vector query,
  and stream commands do not create active profiles or support claims.
  Cassandra/Scylla, DynamoDB, graph, vector, and stream sources stay
  candidate-only until a source-specific promotion PR locks workflow value,
  profile target, language owner, catalog model, result envelope, safety policy,
  fixture strategy, and smoke evidence. There is no active `DatabaseType`,
  runtime, parser/completion, fixture/live, or E2E smoke claim for those sources.

## Related

- [`docs/product/known-limitations.md`](known-limitations.md) — product-visible limitations
- [`docs/ROADMAP.md`](../ROADMAP.md) — future query-language widening
- [`memory/engineering/architecture/query-language/memory.md`](../../memory/engineering/architecture/query-language/memory.md) — engineering ownership rules
