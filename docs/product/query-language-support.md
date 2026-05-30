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
| PostgreSQL SQL | Strongest SQL parser/Safe Mode lane, but still a bounded client subset. Parser/Safe Mode covers tested SQL slices plus selected extension-tolerant syntax for symbolic operators and known extension-backed column types. Completion separately covers common keywords, functions, tables, columns, shell/meta command vocabulary, and installed extension inventory-gated curated packs for `pgcrypto`, `uuid-ossp`, `postgis`, `pgvector`, `citext`, `hstore`, and `pg_trgm`. | Full PL/pgSQL bodies, arbitrary vendor extension semantics, broad MERGE variants, nested/arbitrary function expressions, installed-extension semantic validation for parser/Safe Mode, and catalog-backed enumeration of every extension symbol are not modeled. |
| MySQL SQL | Runtime adapter supports connection, database/table browsing, raw query execution, DML-oriented multi-statement batches, table data reads, row edits, cancellation, and bounded structured DDL for tables/indexes/constraints. Completion has MySQL-family keywords/functions and backtick identifiers. Parser/Safe Mode understands the common SQL subset plus tested MySQL-family slices: `LIMIT offset, count`, `ON DUPLICATE KEY UPDATE`, and narrow `CALL proc(...)`. Server-version-aware conformance gates CHECK/constraint catalog support at MySQL `>= 8.0.16`. | Stored routine/event bodies, transaction/control-flow scripting, broad `CALL` argument expressions, `DELIMITER`, and `LOAD DATA` are unsupported or explicitly rejected. Trigger create/drop is raw-SQL-only; structured trigger dialogs are not mapped to MySQL's inline trigger body model. Operation-level UI/runtime consumers must pass explicit server version evidence before claiming gated behavior. Grid CSV/TSV export is generic; DB-level backup/restore/import/export and MySQL-restorable schema dumps are not claimed. |
| MariaDB SQL | Uses a distinct MariaDB `DatabaseType`, profile, and dialect identity while reusing the MySQL-family runtime adapter, CodeMirror dialect, parser/Safe Mode path, and capability family. Completion/profile vocabulary exposes the MySQL-family surface plus a current MariaDB `RETURNING` delta. Server-version-aware conformance gates CHECK/constraint catalog support at MariaDB `>= 10.2.1`. | `RETURNING` is a completion/profile delta, not a version-gated runtime support guarantee; the server remains the final judge. MariaDB-engine routine/default fixture, CI, and live-engine evidence is still too thin for broader MariaDB-only syntax or runtime claims. |
| SQLite SQL | File connection, table browsing, raw SELECT execution, and multi-statement batches are supported. Raw DML execution and primary-key-scoped row edits are supported only for writable SQLite files. Completion covers built-in SQLite keywords/functions, cached schema objects, and sqlite-cli dot-command vocabulary as suggestions. | Raw SQL DDL is rejected by the SQLite adapter, and structured DDL UI parity is not implemented. Unsupported `ALTER TABLE` actions are not auto-rebuilt, row edits require a single-table result with all primary-key columns projected, read-only file connections reject writes, sqlite-cli dot commands are not executed, and extension/capability-specific semantics are not validated client-side. |
| DuckDB SQL | DuckDB is a file-backed RDBMS profile (`rdb` + `file` connection kind). Local `.duckdb` files can be opened for catalog browsing, table reads, and statement-level raw SQL execution through the RDBMS tabular result path. Registered local CSV/Parquet/JSON/NDJSON analytics sources can be previewed from the DuckDB query toolbar; the dialog chooses a local file, registers an active-session source alias, and previews up to 100 rows. A source-scoped SELECT backend wrapper exists, while the product UI is still preview-first. Public source payloads expose id, alias, file name, kind, and size, not absolute local paths. Completion covers current DuckDB vocabulary and cached schema objects. | Structured DDL/write UI parity and file analytics query UI parity/history/import are not implemented. Extension install/load statements and helper functions, `COPY` file import/export, `ATTACH`/`DETACH`, sensitive external-file capability settings, shell commands, cloud/object-store access, and arbitrary external-file SQL functions or replacement scans are adapter-rejected; extension autoload is disabled. Read-only `.duckdb` files reject writes. |
| MongoDB Mongosh/MQL | Whitelisted `db...` collection/admin commands, JSON-like bodies, BSON literals, cursor chains, operator/stage/expression completion, and destructive admin Safe Mode gates are supported. | Arbitrary JavaScript, shell helpers such as `use`/`show`, multiple statements, unsupported cursor helpers, cross-db shell navigation, server-version gates, and native document-first result panels remain out of scope. |
| Redis command | Redis connection/profile, backend KV primitives, key browser, and value preview exist. Backend primitives are typed IPC calls for database/key scan, typed value reads, guarded string set, delete confirmation, TTL expire/persist, and bounded stream reads. | Redis command query editor/parser/completion is not active. Full value editing, TTL/write controls, stream consumer UI, broader command coverage, cluster/pubsub/modules/consumer-group management, and Valkey support are not claimed. |
| Search DSL | Fixture-backed Search identities and bounded fixture DSL exist for Elasticsearch/OpenSearch fixture catalog/search result paths. | Live HTTP execution, connection/auth/TLS handling, response parsing, admin APIs, observability, and full query-language support are deferred. |
| MSSQL SQL | Planned profile metadata declares SQL Server as a future RDBMS identity with `sql`, `rdb`, `tabular`, and `rdb-default` contract shape. | Capabilities are empty. There is no SQL Server connection UI, runtime query/catalog/edit path, T-SQL parser/completion claim, auth/TLS/encryption/instance contract, fixture/live evidence, or desktop E2E smoke. |
| Oracle SQL | Planned profile metadata declares Oracle as a future RDBMS identity with `sql`, `rdb`, `tabular`, and `rdb-default` contract shape. | Capabilities are empty. There is no Oracle connection UI, runtime query/catalog/edit path, Oracle SQL/PL/SQL parser/completion claim, service/SID/wallet/TNS contract, fixture/live evidence, or desktop E2E smoke. |

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
- MySQL/MariaDB scripting and file import directives are not normalized into
  server SQL. `DELIMITER` and `LOAD DATA` are explicit unsupported boundaries.
- MariaDB shares the MySQL-family parser/Safe Mode path today. MariaDB
  `RETURNING` is tracked as a dialect profile and completion vocabulary delta;
  it is not yet a separate runtime/version-gated support claim. Constraint
  catalog conformance is version-gated separately from this completion delta.
- MySQL structured DDL is bounded to the implemented table/index/constraint
  requests. Trigger create/drop, version-sensitive CHECK behavior, DB-level
  dump/restore/import/export, and dialect-restorable SQL export remain future
  work or raw-SQL/server-resolved behavior.
- SQLite read queries can run on readable files, while raw SQL writes are
  limited to DML on writable files. Raw DDL, structured DDL UI parity,
  unsupported `ALTER TABLE` rebuilds, and SQLite extension/capability-specific
  validation remain future work.
- SQLite completion can suggest built-in SQLite vocabulary, cached schema
  objects, and sqlite-cli dot-command vocabulary, but dot commands and
  extension-specific candidates are not dispatched or gated by installed
  capabilities.
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
- Redis has backend KV primitives and key browser/value preview UI, but Redis
  command query parsing/completion/execution is not a full active product claim.
  Valkey has no active profile/runtime evidence.
- Search DSL is fixture-backed for Elasticsearch/OpenSearch result rendering and
  adapter contracts only. Live HTTP Search support waits for explicit
  connection/auth/TLS, catalog/search execution, admin, observability, and
  product-delta gates.
- MSSQL and Oracle are planned SQL/RDBMS identities only. Declared profile
  metadata does not imply active T-SQL, Oracle SQL/PL/SQL, connection, query,
  catalog, edit, parser/completion, fixture/live, or E2E smoke support.
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
