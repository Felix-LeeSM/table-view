# Sprint 451 MariaDB Semantic Delta

## Selected Delta

Expose MariaDB `RETURNING` as a MariaDB-only SQL profile/completion delta while
leaving MySQL unchanged.

Why this slice:

- It is user-visible in the editor through keyword completion and request
  capability metadata.
- It uses the existing `returning` dialect capability and the existing common
  DML `RETURNING` parser surface, so runtime blast radius stays narrow.
- MariaDB documents `INSERT ... RETURNING`, `DELETE ... RETURNING`, and
  `REPLACE ... RETURNING`; MySQL keeps no `RETURNING` keyword/profile exposure.

Reference:

- https://mariadb.com/kb/en/insertreturning/
- https://mariadb.com/docs/server/reference/sql-statements/data-manipulation/changing-deleting-data/delete
- https://mariadb.com/docs/server/reference/sql-statements/data-manipulation/changing-deleting-data/replace

## Audit Notes

- Query parsing: the Rust SQL AST already parses optional `RETURNING` for
  INSERT/UPDATE/DELETE. Adding dialect-aware parser rejection would be larger
  than this sprint and could perturb existing Safe Mode behavior.
- Capability/profile gating: `SqlDialectCapabilities.returning` already exists.
  MariaDB can now set it to true while MySQL remains false.
- Metadata display: MariaDB sequence/object display requires catalog model and
  sidebar changes, so it is not the first delta.

## Deferred MariaDB Gaps

- Version/statement-specific `RETURNING` gate. Current profile exposes a
  dialect-level capability and lets the server be final judge.
- MariaDB sequence catalog display and completion beyond basic keyword exposure.
- MariaDB JSON alias display: `JSON` may introspect as text plus a validation
  constraint, so column category/display needs a separate adapter slice.
- MariaDB stored routine, event, package, and SQL mode syntax beyond the shared
  MySQL-family parser subset.
