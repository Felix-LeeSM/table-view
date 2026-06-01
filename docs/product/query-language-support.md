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

## Ownership Snapshot

Runtime-active languages are the languages used by connection-supported
`DataSourceProfile` entries.

`sql` is active for connection-supported SQL/RDBMS profiles only. MSSQL and
Oracle carry planned `sql` profile metadata, but their capabilities are empty;
that metadata does not create T-SQL, Oracle SQL/PL/SQL, runtime query, catalog,
edit, parser, completion, or E2E smoke claims.

| QueryLanguageId | Lifecycle | Parser owner | Completion owner | Fallback policy | Safety analyzer |
|---|---|---|---|---|---|
| `sql` | `active` | `rust-wasm-language-core` | `rust-wasm-language-core` | `compatibility-mirror` | `rust-wasm-language-core` |
| `mongosh` | `active` | `rust-wasm-language-core` | `rust-wasm-language-core` | `compatibility-mirror` | `rust-wasm-language-core` |
| `redis-command` | `active` | `future-language-core-contract` | `future-language-core-contract` | `not-implemented` | `profile-safety-policy` |

Declared or deferred language ids stay in the registry so future active profiles
cannot add parser or completion vocabulary without an owner decision.

| QueryLanguageId | Lifecycle | Parser owner | Completion owner | Fallback policy | Safety analyzer | Current boundary |
|---|---|---|---|---|---|---|
| `search-dsl` | `deferred` | `future-language-core-contract` | `future-language-core-contract` | `not-implemented` | `profile-safety-policy` | Search profiles are fixture-backed until live HTTP lands. |
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
| MariaDB SQL | Uses a distinct MariaDB `DatabaseType`, profile, and dialect identity while reusing the MySQL-family runtime adapter, CodeMirror dialect, parser/Safe Mode path, and capability family. Completion/profile vocabulary exposes the MySQL-family surface plus a current MariaDB `RETURNING` delta. The shared adapter detects server version context and gates CHECK/constraint catalog support at MariaDB `>= 10.2.1`. | `RETURNING` is a completion/profile delta, not a version-gated runtime support guarantee; the server remains the final judge. MariaDB-engine routine/default fixture, CI, and live-engine evidence is still too thin for broader MariaDB-only syntax or runtime claims. |
| SQLite SQL | File connection, table browsing, raw read queries, writable-file DML, transactional DML batches, dry-run rollback, and primary-key-scoped row edits are supported. Completion covers built-in SQLite keywords/functions, cached schema objects, and sqlite-cli dot-command vocabulary as suggestions. | Raw SQL DDL is rejected by the SQLite adapter, and structured DDL UI parity is not implemented. Unsupported `ALTER TABLE` actions are not auto-rebuilt, row edits require key/projected row identity, read-only file connections reject writes, nested JSON edits are deferred, sqlite-cli dot commands are not executed, and JSON1/FTS/RTREE/loadable-extension semantics are not detected, gated, dispatched, or validated client-side. |
| DuckDB SQL | DuckDB is a file-backed RDBMS profile (`rdb` + `file` connection kind). Local `.duckdb` files can be opened for catalog browsing, table reads, and statement-level raw SQL execution through the RDBMS tabular result path. Registered local CSV/Parquet/JSON/NDJSON analytics sources can be previewed from the DuckDB query toolbar; the dialog chooses a local file, registers an active-session source alias, and previews up to 100 rows. A source-scoped SELECT backend wrapper exists, while the product UI is still preview-first. Public source payloads expose id, alias, file name, kind, and size, not absolute local paths. Completion covers current DuckDB vocabulary and cached schema objects. | Structured DDL/write UI parity and file analytics query UI parity/history/import are not implemented. Extension install/load statements and helper functions, `COPY` file import/export, `ATTACH`/`DETACH`, sensitive external-file capability settings, shell commands, cloud/object-store access, and arbitrary external-file SQL functions or replacement scans are adapter-rejected; extension autoload is disabled. Read-only `.duckdb` files reject writes. |
| MongoDB Mongosh/MQL | Whitelisted `db...` collection/admin commands, JSON-like bodies, BSON literals, cursor chains, operator/stage/expression completion, and destructive admin Safe Mode gates are supported. | Arbitrary JavaScript, shell helpers such as `use`/`show`, multiple statements, unsupported cursor helpers, cross-db shell navigation, server-version gates, and native document-first result panels remain out of scope. |
| Redis command | Redis connection/profile, backend KV primitives, key browser, value preview, and static KV/stream fixture inventory exist. Backend primitives are typed IPC calls for database/key scan, typed value reads, guarded string set, delete confirmation, TTL expire/persist, and bounded stream reads. | Redis command query editor/parser/completion is not active. The static Redis fixture does not make arbitrary Redis command execution a product claim. Full value editing, TTL/write controls, stream consumer UI, broader command coverage, cluster/pubsub/modules/consumer-group management, and Valkey support are not claimed. |
| Search DSL | Fixture-backed Search identities and bounded fixture DSL exist for Elasticsearch/OpenSearch fixture catalog/search result paths. | Live HTTP execution, connection/auth/TLS handling, response parsing, admin APIs, observability, and full query-language support are deferred. Search fixture files mirror embedded adapter contracts only. |
| MSSQL SQL | Planned profile metadata and a static SQL seed contract declare SQL Server as a future RDBMS identity with `sql`, `rdb`, `tabular`, and `rdb-default` contract shape. | Capabilities are empty. There is no SQL Server connection UI, runtime query/catalog/edit path, T-SQL parser/completion claim, auth/TLS/encryption/instance contract, runtime fixture/live evidence, or desktop E2E smoke. |
| Oracle SQL | Planned profile metadata and a static SQL seed contract declare Oracle as a future RDBMS identity with `sql`, `rdb`, `tabular`, and `rdb-default` contract shape. | Capabilities are empty. There is no Oracle connection UI, runtime query/catalog/edit path, Oracle SQL/PL/SQL parser/completion claim, service/SID/wallet/TNS contract, runtime fixture/live evidence, or desktop E2E smoke. |

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
- MariaDB shares the MySQL-family parser/Safe Mode path today. MariaDB
  `RETURNING` is tracked as a dialect profile and completion vocabulary delta;
  it is not yet a separate runtime/version-gated support claim. Constraint
  catalog conformance is version-gated separately from this completion delta.
- MySQL structured DDL is bounded to the implemented table/index/constraint
  requests and their preview/confirmation lifecycle. Trigger metadata remains
  browse-only in Structure; trigger create/drop, DB-level dump/restore/import/
  export, and dialect-restorable SQL export remain future work or raw-SQL/
  server-resolved behavior.
- SQLite read queries can run on readable files, while raw SQL writes are
  limited to DML on writable files. Transactional DML batch and dry-run paths
  exist, but raw DDL, structured DDL UI parity, unsupported `ALTER TABLE`
  rebuilds, nested JSON edits, and SQLite extension/capability-specific
  validation remain future work.
- SQLite completion can suggest built-in SQLite vocabulary, cached schema
  objects, and sqlite-cli dot-command vocabulary, but dot commands and
  extension-specific candidates are not dispatched, detected, or gated by
  installed capabilities.
- DuckDB remains an RDBMS + `file` connection kind unless future evidence
  requires a separate file-SQL paradigm.
- DuckDB `.duckdb` raw SQL uses the RDBMS adapter path for statement-level
  execution. The adapter rejects extension install/load statements and helper
  functions, `COPY` import/export, `ATTACH`/`DETACH`, sensitive external-file
  capability settings, raw external-file functions, and string replacement
  scans; extension autoload is disabled. Read-only files reject writes.
- DuckDB file analytics has registered local source preview basics and
  source-scoped SELECT backend evidence. Local paths remain active-session
  adapter state and clear on connect/disconnect; public source/preview/query
  payloads and backend error messages redact absolute paths. Broader query UI
  parity/history/import and E2E smoke coverage remain future promotion gates in
  the H3 smoke matrix.
- Export remains the generic explicit save-dialog grid export for current grid
  rows. It is not an automatic export path for registered DuckDB local file
  sources.
- MongoDB support is limited to the tested whitelist. Arbitrary JavaScript,
  shell helpers, multiple statements, and cross-db shell navigation are
  intentionally unsupported. Standalone deployments must produce friendly
  unsupported/fallback behavior for transaction-style workflows rather than
  silent partial commits.
- Redis has backend KV primitives, key browser/value preview UI, and a static
  fixture inventory, but Redis command query parsing/completion/execution is not
  a full active product claim. Valkey has no active profile/runtime evidence.
- Search DSL is fixture-backed for Elasticsearch/OpenSearch result rendering and
  adapter contracts only. Live HTTP Search support waits for explicit
  connection/auth/TLS, catalog/search execution, admin, observability, and
  product-delta gates.
- MSSQL and Oracle are planned SQL/RDBMS identities only. Declared profile
  metadata and static seed contracts do not imply active T-SQL, Oracle
  SQL/PL/SQL, connection, query, catalog, edit, parser/completion, runtime
  fixture/live, or E2E smoke support.
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
