# Sprint Execution Brief: sprint-271

## Objective

Propagate Sprint 266's opt-in `expected_database` guard to the remaining 25 RDB
commands across schema introspection, query data, and DDL layers. Mismatch
surfaces as `AppError::DbMismatch` and reuses the Sprint 267 sync helper +
Sprint 269 Retry toast (user-initiated paths only).

## Task Why

Sprint 266 closed only `execute_query` + `execute_query_batch`. The remaining
25 RDB commands can still return data/schema from a swapped backend pool
between user click and dispatch — silent correctness gap for any DBMS with
stateful per-connection db semantics (MySQL `USE`, SQLite `ATTACH`). Closes
Sprint 266 Out-of-Scope #1.

## Scope Boundary

**In scope** — 25 commands across 3 files:

- `src-tauri/src/commands/rdb/schema.rs`: 12 introspection commands (slice 271a).
- `src-tauri/src/commands/rdb/query.rs`: `execute_query_dry_run`,
  `query_table_data` (slice 271b).
- `src-tauri/src/commands/rdb/ddl.rs`: 11 DDL commands via `*Request` struct
  field (slice 271c).
- Matching TS wrappers in `src/lib/tauri/{schema,query,ddl}.ts`.
- Callers: `schemaStore.ts`, `DataGrid.tsx`, `useQueryExecution` (dry-run
  path), DDL dialog drivers in `src/components/schema/*`.
- Backend + frontend tests per slice (AC-271-06, AC-271-07).

**Out of scope** — `cancel_query` (db-agnostic skip), `verify_active_db`
(already canonical), all Mongo / document commands, new ADR, Sprint 270
skeleton state. No Sprint 269 toast for silent introspection — sync-only.

## Invariants

- Probe block byte-equivalent to `execute_query_inner` reference at
  `src-tauri/src/commands/rdb/query.rs:83–92`: probe under same
  `active_connections.lock().await`, `unwrap_or_default()` coercion of
  `current_database`, mismatch returns `AppError::DbMismatch { expected,
  actual }` BEFORE invoking the underlying trait.
- Sprint 266 commands (`execute_query`, `execute_query_batch`) and
  `cancel_query` byte-equivalent — no changes.
- `None` (or omitted via `#[serde(default)]`) path is byte-equivalent to
  pre-sprint — no probe overhead.
- Adapter trait surface unchanged.
- All existing tests keep passing — extend, do not rewrite.
- Mongo untouched.

## Done Criteria

1. All 25 commands in the audit table (contract § In Scope) marked (b) accept
   `expected_database` (positional `Option<String>` for schema/query;
   `#[serde(default)]` field for DDL Request structs).
2. Probe block in each migrated command is byte-equivalent to the Sprint 266
   reference; verified by file:line evidence in handoff.
3. TS wrappers in `src/lib/tauri/{schema,query,ddl}.ts` expose
   `expectedDatabase?: string` (positional) or new optional field (DDL);
   JSDoc references Sprint 271.
4. Caller sites forward workspace `(connId, db)`: `schemaStore`, `DataGrid`,
   `useQueryExecution` dry-run, each DDL dialog.
5. Each migrated command gets a backend mismatch test (stub adapter
   `current_database = "X"`, caller passes `Some("Y")` → `AppError::DbMismatch`
   AND underlying trait not invoked).
6. At least 1 vitest case per slice exercises the mismatch path end-to-end
   (mocked IPC → `parseDbMismatch` → `syncMismatchedActiveDb`; toast only for
   user-initiated paths).
7. Each slice runs ALL 6 gates clean BEFORE next slice begins; lands as its
   own commit.

## Verification Plan

- **Profile**: `mixed` — backend cargo + frontend vitest + audit checklist.
- **Required checks (re-run per slice)**:
  1. `cargo fmt --check`
  2. `cargo clippy --all-targets --all-features -- -D warnings`
  3. `cargo test` (capture mismatch test count delta vs prior baseline)
  4. `pnpm tsc --noEmit`
  5. `pnpm lint`
  6. `pnpm vitest run --no-file-parallelism` (capture count delta;
     monotonically non-decreasing)
- **Required evidence**:
  - Audit table reconciled with file:line of probe block in each migrated
    command.
  - Per-slice file diffs and changed-files list.
  - cargo test + vitest count deltas per slice.
  - Final ~40 lines of each gate's output per slice.
  - List of caller sites updated per slice with file:line citations.
- **Evaluator citations**:
  - Probe block line numbers in ≥2 commands per slice; byte-equivalence to
    Sprint 266 reference.
  - cargo test + vitest deltas reconciled.
  - Audit table (a)/(b)/(c) markings sample-verified ≥3 rows per slice.
  - Conventional Commits + sprint-folder naming rule per slice commit.

## Execution Discipline — 3-Slice Ordering (PRIMARY)

Generator MUST execute in this order. Each slice lands as its own commit
AFTER passing all 6 gates. No carry-forward of failures.

1. **271a — schema introspection** (12 commands in `schema.rs`)
   - Lowest blast radius; read-only; surfaces `schemaStore` per-db routing.
   - Caller: `src/stores/schemaStore.ts` forwards per-db routing key.
   - Test gate baseline anchors deltas for 271b/271c.

2. **271b — query data + dry-run** (2 commands in `query.rs`)
   - Medium blast radius; user-visible row fetches and EXPLAIN.
   - Callers: `useQueryExecution` dry-run path (extends existing
     `expectedDatabase` forwarding) + `DataGrid` data fetcher.
   - User-initiated → Sprint 269 Retry toast reused.

3. **271c — DDL** (11 commands in `ddl.rs`)
   - Highest blast radius; side-effecting writes — mismatch most
     consequential to surface.
   - Pattern shift: 11 `*Request` structs each gain
     `#[serde(default)] expected_database: Option<String>`. Frontend wrappers
     thread the field via the request payload.
   - Callers: `AddColumnDialog`, `CreateTableDialog`, and all other DDL
     drivers — each user-initiated, Retry toast on mismatch.

## Evidence To Return

- **Changed files and purpose** — grouped per slice (271a/271b/271c).
- **Checks run and outcomes** — per slice, all 6 gates with tails.
- **Done criteria coverage with evidence** — audit table reconciliation
  + cargo test count deltas + vitest count deltas + probe-block file:line per
  command.
- **Assumptions made during implementation** — e.g. helper extraction or
  inline choice for `syncMismatchedActiveDb` (extract only if 3+ caller
  sites; document the count).
- **Residual risk or verification gaps** — any caller site that legitimately
  lacks a `(connId, db)` coordinate (none expected; document if any arise).

## References

- **Contract**: `docs/sprints/sprint-271/contract.md`
- **Master spec**: `docs/sprints/sprint-268/spec.md` § Sprint 271
- **Probe reference**: `src-tauri/src/commands/rdb/query.rs:83–92`
  (Sprint 266 `execute_query_inner` mismatch guard)
- **Sprint 266 wrapper reference**: `src-tauri/src/commands/rdb/query.rs:127–148`
  (JSDoc + `#[tauri::command]` shape for `execute_query`)
- **Sync helper**: `parseDbMismatch` + `syncMismatchedActiveDb`
  (Sprint 267 / 269 — locate before slice 271a starts to confirm import path)
- **Relevant files**:
  - `src-tauri/src/commands/rdb/schema.rs`
  - `src-tauri/src/commands/rdb/query.rs`
  - `src-tauri/src/commands/rdb/ddl.rs`
  - `src/lib/tauri/{schema,query,ddl}.ts`
  - `src/stores/schemaStore.ts`
  - `src/components/rdb/DataGrid.tsx`
  - `src/components/query/QueryTab/useQueryExecution.ts`
  - `src/components/schema/*` (DDL dialog drivers)
