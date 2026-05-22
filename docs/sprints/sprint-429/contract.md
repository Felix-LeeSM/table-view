# Sprint 429 Contract: Completion Reference Drift Tests

## Goal

Add official-reference smoke coverage around the Rust/WASM completion vocabulary
introduced in Sprint 428. This sprint does not expand UI behavior; it locks the
current "100% completion coverage" definition against representative official
MongoDB, MySQL/MariaDB, PostgreSQL psql, and SQLite CLI vocabulary groups.

## References

- MongoDB query predicates:
  https://www.mongodb.com/docs/manual/reference/mql/query-predicates/
- MongoDB aggregation stages:
  https://www.mongodb.com/docs/manual/reference/mql/aggregation-stages/
- MongoDB expressions:
  https://www.mongodb.com/docs/manual/reference/mql/expressions/
- MySQL 8.4 mysql client commands:
  https://dev.mysql.com/doc/refman/8.4/en/mysql-commands.html
- MySQL 8.4 JSON/regexp/misc function references:
  https://dev.mysql.com/doc/refman/8.4/en/json-table-functions.html,
  https://dev.mysql.com/doc/refman/8.4/en/json-function-reference.html,
  https://dev.mysql.com/doc/refman/8.4/en/regexp.html,
  https://dev.mysql.com/doc/refman/8.4/en/miscellaneous-functions.html
- PostgreSQL psql:
  https://www.postgresql.org/docs/current/app-psql.html
- SQLite CLI and date functions:
  https://www.sqlite.org/cli.html,
  https://www.sqlite.org/lang_datefunc.html

## Scope

- SQL Rust completion tests prove PostgreSQL, MySQL/MariaDB, and SQLite built-in
  vocabulary works with empty TypeScript request vocabulary arrays.
- Mongo Vitest coverage proves Rust/WASM vocabulary equals the TypeScript
  fallback mirror.
- Mongo official-reference sentinels cover query/projection/update operators,
  aggregation stages, accumulators, expressions, BSON tags, collection methods,
  db-level methods, and admin commands.
- No parser semantic expansion, version gating, or adapter behavior changes.

## Acceptance Criteria

- AC-429-01: SQL Rust tests cover PostgreSQL functions/keywords and psql
  commands from Rust SOT.
- AC-429-02: SQL Rust tests cover MySQL/MariaDB functions/keywords and mysql
  client commands from Rust SOT.
- AC-429-03: SQL Rust tests cover SQLite functions/keywords and sqlite-cli dot
  commands from Rust SOT.
- AC-429-04: Mongo tests fail if Rust/WASM vocabulary drifts from TypeScript
  fallback mirrors.
- AC-429-05: Mongo tests cover official-reference sentinel operators/stages.
- AC-429-06: `docs/PLAN.md`, `docs/phases/phase-31.md`, and
  `docs/query-language-support.md` retain the long-term Phase 31 plan.

## Out of Scope

- Server-version capability gates.
- Full SQL parser semantics for MySQL/MariaDB/SQLite.
- Arbitrary mongosh JavaScript completion or execution.
