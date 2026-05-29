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
| MySQL SQL | Runtime adapter supports connection, database/table browsing, raw query execution, DML-oriented multi-statement batches, table data reads, row edits, cancellation, and bounded structured DDL for tables/indexes/constraints. Completion has MySQL-family keywords/functions and backtick identifiers. Parser/Safe Mode understands the common SQL subset plus tested MySQL-family slices: `LIMIT offset, count`, `ON DUPLICATE KEY UPDATE`, and narrow `CALL proc(...)`. | Stored routine/event bodies, transaction/control-flow scripting, broad `CALL` argument expressions, `DELIMITER`, and `LOAD DATA` are unsupported or explicitly rejected. Trigger create/drop is raw-SQL-only; structured trigger dialogs are not mapped to MySQL's inline trigger body model. MySQL version-aware capability metadata exists, but server-version gates are not fully routed through runtime/UI lookup. Grid CSV/TSV export is generic; DB-level backup/restore/import/export and MySQL-restorable schema dumps are not claimed. |
| MariaDB SQL | Uses a distinct MariaDB `DatabaseType`, profile, and dialect identity while reusing the MySQL-family runtime adapter, CodeMirror dialect, parser/Safe Mode path, and capability family. Completion/profile vocabulary exposes the MySQL-family surface plus a current MariaDB `RETURNING` delta. | `RETURNING` is a completion/profile delta, not a version-gated runtime support guarantee; the server remains the final judge. MariaDB-engine routine/default fixture, CI, and live-engine evidence is still too thin for broader MariaDB-only syntax or runtime claims. |
| SQLite SQL | File connection, table browsing, raw SELECT execution, and multi-statement batches are supported. Raw DML execution and primary-key-scoped row edits are supported only for writable SQLite files. Completion covers built-in SQLite keywords/functions, cached schema objects, and sqlite-cli dot-command vocabulary as suggestions. | Raw SQL DDL is rejected by the SQLite adapter, and structured DDL UI parity is not implemented. Unsupported `ALTER TABLE` actions are not auto-rebuilt, row edits require a single-table result with all primary-key columns projected, read-only file connections reject writes, sqlite-cli dot commands are not executed, and extension/capability-specific semantics are not validated client-side. |
| DuckDB SQL | DuckDB file connection, local CSV/Parquet/JSON/NDJSON preview, and raw SQL execution are supported. Completion covers current DuckDB vocabulary and cached schema objects. | Structured DDL/write UI parity, file analytics query UI parity, shell commands, cloud/object-store access, and arbitrary external-file SQL functions are out of scope. |
| MongoDB Mongosh/MQL | Whitelisted `db...` collection/admin commands, JSON-like bodies, BSON literals, cursor chains, operator/stage/expression completion, and destructive admin Safe Mode gates are supported. | Arbitrary JavaScript, shell helpers such as `use`/`show`, multiple statements, unsupported cursor helpers, cross-db shell navigation, server-version gates, and native document-first result panels remain out of scope. |
| Redis command | Connection/profile, backend KV primitives, key browser, and value preview exist. | Query-language parser/completion ownership is future-contract only. Value edit, TTL/write, stream UI, and broader Redis/Valkey command coverage are not claimed. |
| Search DSL | Fixture-backed Search identities and bounded fixture DSL exist. | Live HTTP execution and full query-language support are deferred. |

## Current Unsupported Boundaries

Unsupported syntax can still execute on the database server when sent through a
raw SQL path. The client may only lose completion, typed dispatch, or Safe Mode
precision. Current product-facing boundaries are:

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
  it is not yet a separate runtime/version-gated support claim.
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
- DuckDB extension-specific semantics are not validated client-side.
- MongoDB support is limited to the tested whitelist; arbitrary shell behavior is
  intentionally not supported.
- Redis and Search query language support is not yet a full active product
  claim.

## Related

- [`docs/product/known-limitations.md`](known-limitations.md) — product-visible limitations
- [`docs/ROADMAP.md`](../ROADMAP.md) — future query-language widening
- [`memory/engineering/architecture/query-language/memory.md`](../../memory/engineering/architecture/query-language/memory.md) — engineering ownership rules
