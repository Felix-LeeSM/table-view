# SQL Source Support Breakdowns

Child page of
[`docs/product/query-language-support.md`](query-language-support.md).

## PostgreSQL SQL Support Breakdown

- Runtime: connection, catalog/table data, raw SELECT/EXPLAIN row results,
  plan-only `EXPLAIN (FORMAT JSON)`, DML batches, query cancellation, and
  raw-query grid edit paths are active through the PostgreSQL adapter.
- Parser / safety: bounded SQL slices, destructive/warn/info classification,
  raw DDL preview, grid-edit preview, and EXPLAIN inner statement analysis are
  tested. Extension-tolerant syntax is structural, not full extension semantic
  validation.
- Completion / autocomplete: common SQL vocabulary, schema objects, shell/meta
  command suggestions, and curated installed-extension packs are available.
  Installed extension inventory gates known packs such as `pgcrypto` and
  `fuzzystrmatch`; the app does not enumerate every extension-provided symbol.
- Routine smoke: GitHub Runtime Happy Path covers connect/browse/edit/query,
  Explain, installed-extension-gated completion, Safe Mode, and cancellation
  for PostgreSQL on Ubuntu.

## MySQL SQL Support Breakdown

This breakdown keeps runtime, parser/safety, autocomplete, and routine smoke
claims separate.

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
  SELECT, DML batch, row edit, cancellation/retry, history/source labels,
  tabular result rendering, and bounded Structure table/index/FK DDL
  preview/execute/catalog readback for MySQL on Ubuntu. It is a baseline smoke
  claim, not broader procedure-management, trigger CRUD, completion-runtime,
  admin, import/export, or MySQL Workbench parity.

## MariaDB SQL Support Breakdown

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
  profile/completion plus structural parser/Safe Mode evidence only. Focused
  `mariadb:11` integration characterizes the current server-resolved runtime
  boundary: `DELETE ... RETURNING` deletes the targeted row, but the shared
  adapter exposes no returned rows and no affected-row count. The app only uses
  MariaDB `>= 10.0.5` as a keyword completion-suggestion gate and does not add
  a MariaDB `RETURNING` runtime/version support claim.
- Current boundary: MariaDB docs and the testing matrix separate live
  engine smoke, focused shared-path tests, parser/Safe Mode structure, and
  autocomplete evidence from future MariaDB-only runtime/admin/import/export
  promotion slices.
- Routine smoke: GitHub Runtime Happy Path covers connect, seeded table browse,
  catalog metadata browse, SELECT, DML batch, row edit, cancellation/retry,
  history/source labels, tabular result rendering, and bounded Structure
  table/index/FK DDL preview/execute/catalog readback for MariaDB on Ubuntu.
  It is a bounded workbench smoke claim for the intentional MySQL-family SQL
  path under MariaDB identity, not broader MariaDB-only syntax, procedure body
  authoring/management, trigger CRUD, completion-runtime, admin, import/export,
  or full vendor CLI/admin parity.
