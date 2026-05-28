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

| QueryLanguageId | Parser owner | Completion owner | Fallback policy | Safety analyzer |
|---|---|---|---|---|
| `sql` | `rust-wasm-language-core` | `rust-wasm-language-core` | `compatibility-mirror` | `rust-wasm-language-core` |
| `mongosh` | `rust-wasm-language-core` | `rust-wasm-language-core` | `compatibility-mirror` | `rust-wasm-language-core` |
| `redis-command` | `future-language-core-contract` | `future-language-core-contract` | `not-implemented` | `profile-safety-policy` |
| `search-dsl` | `future-language-core-contract` | `future-language-core-contract` | `deferred` | `profile-safety-policy` |

Deferred language ids stay in the registry so future active profiles cannot add
parser or completion vocabulary without an owner decision.

## Current Product Surface

| Surface | Current support | Current boundary |
|---|---|---|
| PostgreSQL SQL | Strongest SQL parser/Safe Mode surface. Completion covers common keywords, functions, tables, columns, shell/meta command vocabulary, selected extension-tolerant operators/types, and detected curated extension packs for `pgcrypto`, `uuid-ossp`, `postgis`, `pgvector`, `citext`, `hstore`, and `pg_trgm`. | Full PL/pgSQL bodies, arbitrary vendor extension semantics, broad MERGE variants, nested/arbitrary function expressions, and catalog-backed enumeration of every extension symbol are not modeled. |
| MySQL SQL | Runtime adapter is broad. Completion has MySQL-family keywords/functions and backtick identifiers. Parser/Safe Mode understands the common SQL subset plus `LIMIT offset, count`, `ON DUPLICATE KEY UPDATE`, and narrow `CALL proc(...)`. | Stored routine/event bodies, transaction/control-flow scripting, broad `CALL` argument expressions, `DELIMITER`, and `LOAD DATA` are unsupported or explicitly rejected. |
| MariaDB SQL | Reuses the MySQL adapter path with MariaDB identity/profile deltas. Completion exposes the MySQL-family surface plus MariaDB `RETURNING`. | MariaDB-engine fixture evidence is still pending; MariaDB-only syntax/version gates are narrow. |
| SQLite SQL | File connection, query, preview, and primary-key-scoped row edits are supported. Completion covers current SQLite vocabulary and cached schema objects. | DDL UI/runtime write parity, function source introspection, virtual table syntax, sqlite-cli dot command execution, and extension-specific semantics are unsupported. |
| DuckDB SQL | DuckDB file connection and local CSV/Parquet/JSON/NDJSON preview/query paths are supported. Completion covers current DuckDB vocabulary and cached schema objects. | DDL/write parity, shell commands, cloud/object-store access, and arbitrary external-file SQL functions are out of scope. |
| MongoDB Mongosh/MQL | Whitelisted `db...` collection/admin commands, JSON-like bodies, BSON literals, cursor chains, operator/stage/expression completion, and destructive admin Safe Mode gates are supported. | Arbitrary JavaScript, shell helpers such as `use`/`show`, multiple statements, unsupported cursor helpers, cross-db shell navigation, server-version gates, and native document-first result panels remain out of scope. |
| Redis command | Redis first-slice workflows exist for key browser/value/TTL/stream paths. | Query-language parser/completion ownership is future-contract only. Broader Redis/Valkey command coverage is not claimed. |
| Search DSL | Fixture-backed Search identities and bounded fixture DSL exist. | Live HTTP execution and full query-language support are deferred. |

## Current Unsupported Boundaries

Unsupported syntax can still execute on the database server when sent through a
raw SQL path. The client may only lose completion, typed dispatch, or Safe Mode
precision. Current product-facing boundaries are:

- SQL parser/Safe Mode is PostgreSQL/ANSI-centered and widens by tested slices.
- PostgreSQL installed extension inventory activates only curated completion
  packs for known extensions. It does not semantically validate extension
  usage or enumerate every extension-provided symbol.
- MySQL/MariaDB scripting and file import directives are not normalized into
  server SQL.
- SQLite and DuckDB extension-specific semantics are not validated client-side.
- MongoDB support is limited to the tested whitelist; arbitrary shell behavior is
  intentionally not supported.
- Redis and Search query language support is not yet a full active product
  claim.

## Related

- [`docs/product/known-limitations.md`](known-limitations.md) — product-visible limitations
- [`docs/ROADMAP.md`](../ROADMAP.md) — future query-language widening
- [`memory/engineering/architecture/query-language/memory.md`](../../memory/engineering/architecture/query-language/memory.md) — engineering ownership rules
