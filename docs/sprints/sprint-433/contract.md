# Sprint 433 Contract: RDB Pending Edit Database Key

## Goal

Resolve RISK-039 by making RDB pending edit state database-aware. Pending edits
for the same connection, schema, and table name must stay isolated when the
active database differs.

## Scope

- Extend the data grid pending edit key from `(connectionId, schema, table)` to
  `(connectionId, database, schema, table)`.
- Thread database identity through the RDB data grid edit hook path.
- Thread database identity into the RDB batch commit path as
  `expectedDatabase`, so a backend active-db mismatch cannot commit pending
  edits to the wrong database.
- Preserve the instance fallback key when any required identity segment is
  missing.
- Keep `purgeForConnection(connectionId)` broad enough to remove all pending
  edit entries for that connection.
- Update tab removal purge logic so closing one database tab purges only that
  database's pending edit key and does not purge a same-name table in another
  database.
- Backfill missing `tab.database` from the workspace `(connId, db)` key during
  legacy workspace rehydration.

## Acceptance Criteria

- AC-433-01: `entryKey(connId, database, schema, table)` composes a four-part
  key.
- AC-433-02: Same connection/schema/table in different databases have isolated
  pending edit entries.
- AC-433-03: `useDataGridEdit` remounting the same table in a different
  database starts from empty pending state.
- AC-433-04: `removeTab` purges the closing database's pending edit key.
- AC-433-05: `removeTab` preserves a sibling pending edit key for the same
  connection/schema/table in another database.
- AC-433-06: `purgeForConnection` still removes every pending edit entry for
  the connection across databases.
- AC-433-07: RDB grid edit commit calls `executeQueryBatch` with the same
  database identity used for the pending-edit key.
- AC-433-08: The shared edit hook type requires `database`, so new callers
  cannot silently fall back to the old three-part key shape.
- AC-433-09: Legacy persisted RDB table tabs without `database` rehydrate with
  the workspace db, including closed-tab history.

## Out Of Scope

- Changing parser, query-language, or docs query-language surfaces.
- Replacing pending edit keys with tab IDs.
- Adding localStorage or cross-window persistence for pending edits.
- Refactoring existing large data grid/document files beyond the required
  database parameter thread.

## Verification Plan

1. Add failing regression tests for the RISK-039 leak.
2. Implement the database-aware key and caller migration.
3. Run focused Vitest suites for the pending edit store, edit hook persistence,
   workspace tab lifecycle, workspace rehydration, and RDB commit
   expected-database threading.
4. Run TypeScript and lint checks for signature fallout.
