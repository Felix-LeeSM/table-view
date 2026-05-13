# Sprint Contract: sprint-271

## Summary

- **Goal**: Apply Sprint 266's opt-in `expected_database` guard pattern to every
  remaining RDB introspection / data / DDL Tauri command so a tab whose backend
  pool was swapped between user click and dispatch cannot return schema or data
  from the wrong database. Mismatch surfaces as `AppError::DbMismatch` and
  reuses the Sprint 267 sync helper plus (for user-initiated paths) the Sprint
  269 Retry toast surface.
- **Audience**: Generator (implementation), Evaluator (gate verification).
- **Owner**: harness Generator.
- **Verification Profile**: `mixed` — backend `cargo test` + frontend `vitest`
  + audit checklist accuracy + `tsc` + `lint` + `cargo clippy`.

## In Scope

Sprint 271 closes Sprint 266 Out-of-Scope #1 — propagate the `expected_database`
guard from the two already-instrumented `execute_query*` commands to every
remaining RDB command for which a sensible `(connId, db)` coordinate is
available at the caller layer.

### Audit Table — 25 candidate commands (fixed enumeration)

Layer abbreviations: `S` = `commands/rdb/schema.rs`, `Q` = `commands/rdb/query.rs`,
`D` = `commands/rdb/ddl.rs`. Slice = the sub-slice that lands the change.
Arg-shape = `positional` (new `expected_database: Option<String>` last param)
or `request` (new `expected_database: Option<String>` field with
`#[serde(default)]` inside the existing `*Request` struct). Caller-coord = is
a `(connId, db)` coordinate readily available where the wrapper is invoked?

| # | Command | File:line | Layer | Slice | Arg-shape | Caller has `(connId, db)`? | Status |
|---|---|---|---|---|---|---|---|
| 1 | `list_schemas` | schema.rs:36 | S | 271a | positional | Yes — `schemaStore` per-db routing | (b) add guard |
| 2 | `list_tables` | schema.rs:56 | S | 271a | positional | Yes | (b) add guard |
| 3 | `get_table_columns` | schema.rs:89 | S | 271a | positional | Yes | (b) add guard |
| 4 | `list_schema_columns` | schema.rs:121 | S | 271a | positional | Yes | (b) add guard |
| 5 | `get_table_indexes` | schema.rs:154 | S | 271a | positional | Yes | (b) add guard |
| 6 | `get_table_constraints` | schema.rs:197 | S | 271a | positional | Yes | (b) add guard |
| 7 | `list_views` | schema.rs:228 | S | 271a | positional | Yes | (b) add guard |
| 8 | `list_functions` | schema.rs:249 | S | 271a | positional | Yes | (b) add guard |
| 9 | `get_view_definition` | schema.rs:274 | S | 271a | positional | Yes | (b) add guard |
| 10 | `get_view_columns` | schema.rs:297 | S | 271a | positional | Yes | (b) add guard |
| 11 | `get_function_source` | schema.rs:323 | S | 271a | positional | Yes | (b) add guard |
| 12 | `list_postgres_types` | schema.rs:353 | S | 271a | positional | Partial — call site routes via `(connId, db)` even when payload is db-global; forward `db` so a swapped pool still rejects | (b) add guard |
| 13 | `execute_query` | query.rs:133 | Q | — | positional | Yes — already wired in `useQueryExecution` | (a) already guarded (Sprint 266); no change |
| 14 | `execute_query_batch` | query.rs:238 | Q | — | positional | Yes — already wired in `useQueryExecution` | (a) already guarded (Sprint 266); no change |
| 15 | `execute_query_dry_run` | query.rs:331 | Q | 271b | positional | Yes — `useQueryExecution` dry-run path | (b) add guard |
| 16 | `cancel_query` | query.rs:373 | Q | — | n/a | n/a — db-agnostic (operates on `query_id` registry, not adapter pool) | (c) skipped, rationale: db-agnostic |
| 17 | `query_table_data` | query.rs:428 | Q | 271b | positional | Yes — `DataGrid` row-fetch reads workspace `(connId, db)` | (b) add guard |
| 18 | `drop_table` | ddl.rs (`DropTableRequest`) | D | 271c | request | Yes — DDL drivers run from schema sidebar / dialogs already keyed by `(connId, db)` | (b) add guard |
| 19 | `rename_table` | ddl.rs (`RenameTableRequest`) | D | 271c | request | Yes | (b) add guard |
| 20 | `alter_table` | ddl.rs (`AlterTableRequest`) | D | 271c | request | Yes | (b) add guard |
| 21 | `add_column` | ddl.rs (`AddColumnRequest`) | D | 271c | request | Yes | (b) add guard |
| 22 | `drop_column` | ddl.rs (`DropColumnRequest`) | D | 271c | request | Yes | (b) add guard |
| 23 | `create_table` | ddl.rs (`CreateTableRequest`) | D | 271c | request | Yes | (b) add guard |
| 24 | `create_table_plan` | ddl.rs (`CreateTablePlanRequest`) | D | 271c | request | Yes | (b) add guard |
| 25 | `create_index` | ddl.rs (`CreateIndexRequest`) | D | 271c | request | Yes | (b) add guard |
| 26 | `drop_index` | ddl.rs (`DropIndexRequest`) | D | 271c | request | Yes | (b) add guard |
| 27 | `add_constraint` | ddl.rs (`AddConstraintRequest`) | D | 271c | request | Yes | (b) add guard |
| 28 | `drop_constraint` | ddl.rs (`DropConstraintRequest`) | D | 271c | request | Yes | (b) add guard |

**Totals**: 25 commands marked (b) in this sprint, 2 commands marked (a)
already guarded (Sprint 266), 1 command marked (c) skipped (`cancel_query`).
Mongo (`commands/rdb/../document.rs` and friends) is **untouched** — out of
scope.

### Sub-slicing (AC-271-08) — mandatory 3-slice ordering

Generator MUST split delivery into 3 ordered slices, **each landing as its own
commit** to keep diff reviewable and bisect-friendly. Each slice runs ALL gates
(`cargo fmt --check`, `cargo clippy`, `cargo test`, `pnpm tsc --noEmit`,
`pnpm lint`, `pnpm vitest run --no-file-parallelism`) BEFORE the next slice
begins. If any slice fails its gates, the Generator must fix it before
advancing — no carry-forward.

- **271a — schema introspection (12 commands)**: `list_schemas`, `list_tables`,
  `get_table_columns`, `list_schema_columns`, `get_table_indexes`,
  `get_table_constraints`, `list_views`, `list_functions`,
  `get_view_definition`, `get_view_columns`, `get_function_source`,
  `list_postgres_types`. Frontend wrappers in `src/lib/tauri/schema.ts`;
  caller layer in `src/stores/schemaStore.ts` forwarding the per-db routing
  key. Backend + frontend tests per AC-271-06 / AC-271-07.
- **271b — query data + dry-run (2 commands)**: `execute_query_dry_run`,
  `query_table_data`. Frontend wrappers in `src/lib/tauri/query.ts`. Callers:
  `useQueryExecution` dry-run path (forward `expectedDatabase` alongside the
  existing `execute_query` / `execute_query_batch` paths it already wires) +
  `DataGrid` table-data fetcher (read `(connId, db)` from workspace store).
  Backend + frontend tests.
- **271c — DDL (11 commands)**: 11 `*Request` structs in
  `src-tauri/src/commands/rdb/ddl.rs` each gain
  `#[serde(default)] expected_database: Option<String>`. Frontend wrappers in
  `src/lib/tauri/ddl.ts`. Callers: `AddColumnDialog`, `CreateTableDialog`, and
  every other DDL driver — each forwards the workspace `(connId, db)` already
  threaded for the operation. Backend + frontend tests.

## Out of Scope

- `cancel_query` (db-agnostic — operates on a `query_id` registry, not the
  adapter pool).
- `verify_active_db` (already the canonical probe).
- All Mongo / document-paradigm commands (separate adapter trait).
- New ADR — Sprint 266's ADR coverage extends; no fresh decision.
- Sprint 269's Retry toast reuse for **background / automatic** introspection.
  Only user-initiated DDL and the data-grid open are surfaced via the toast;
  silent introspection (schemaStore prefetch, autocomplete refresh) uses
  `syncMismatchedActiveDb` **sync-only**, no toast.
- Sprint 270 skeleton state — untouched.
- **Optional helper extraction**: contract permits but does not require
  extracting `syncMismatchedActiveDb` to a shared module. Recommended if used
  by 3+ caller sites; not required otherwise.

## Invariants

- Sprint 266 already-guarded commands (`execute_query`, `execute_query_batch`)
  remain byte-equivalent. No signature, behaviour, or test changes there.
- `cancel_query` is byte-equivalent (db-agnostic skip).
- All existing test files keep passing — extend with new mismatch cases,
  do not rewrite.
- The `None` (or `#[serde(default)]` omitted) path through every migrated
  handler is byte-equivalent to pre-sprint behaviour (no `current_database`
  probe overhead, no extra lock contention).
- Adapter trait surface is unchanged (Sprint 266 already added
  `current_database()`).
- Mongo / document commands untouched.
- Probe pattern is **byte-equivalent** to `execute_query_inner` (Sprint 266
  reference at `src-tauri/src/commands/rdb/query.rs:83–92`): probe runs under
  the same `active_connections.lock().await` acquisition; if
  `expected.is_some() && actual != expected` → return
  `AppError::DbMismatch { expected, actual }` BEFORE invoking the underlying
  trait method.
- Concurrent swap mid-introspection: Sprint 267 invariant
  (`active_connections` lock held across probe + dispatch) holds.
- Adapter `current_database()` reports `None` → coerced to `""` via
  `unwrap_or_default()` (matches Sprint 266 reference line 84).

## Acceptance Criteria

These directly mirror `docs/sprints/sprint-268/spec.md` § Sprint 271 and pin
the audit table above as the fixed enumeration.

- `AC-271-01` — **Audit checklist published**: the audit table above is the
  fixed enumeration. Every command listed is marked (a) already guarded
  (Sprint 266), (b) added in this sprint, or (c) skipped with rationale.
- `AC-271-02` — **Backend handler accepts `expected_database`**: every command
  in the table marked (b) gains an `Option<String>` parameter (positional for
  schema/query layers; `#[serde(default)]` struct field for DDL layer). When
  `None`, behaviour is byte-equivalent to pre-sprint. When `Some(expected)`,
  the handler probes `adapter.current_database().await.unwrap_or_default()`
  under the same `active_connections.lock()` acquisition that wraps the
  underlying trait call and returns `AppError::DbMismatch { expected, actual }`
  BEFORE invoking the underlying trait method.
- `AC-271-03` — **Tauri command + TS wrapper exposes the opt-in parameter**:
  for each migrated command, `#[tauri::command]` signature, the TS wrapper in
  `src/lib/tauri/{schema,query,ddl}.ts`, and the wrapper's JSDoc all carry the
  new parameter. Positional wrappers add it as an optional last-positional
  `expectedDatabase?: string`, forwarded as `expected_database: expectedDatabase ?? null`.
  Request-struct wrappers add it as an optional field on the request type
  passed in. JSDoc one-liner references Sprint 271. Existing call sites that
  omit the param compile unchanged.
- `AC-271-04` — **Callers forward the active db**: every store / hook that
  calls a migrated wrapper forwards the relevant `(connId, db)` coordinate as
  `expectedDatabase`. Specifically: `schemaStore.ts` forwards its per-db
  routing key; `useQueryExecution`'s dry-run path forwards the same workspace
  `(connId, db)` it already passes to `executeQuery`; `DataGrid` row-fetch
  reads `useWorkspaceStore` for `(connId, db)`; each DDL driver dialog
  forwards the workspace `(connId, db)` already threaded for the operation.
  When a call site has no obvious db (none expected, but if any arise during
  implementation), omit the param and record the rationale in the handoff.
- `AC-271-05` — **Mismatch surfaces reuse the Sprint 267 sync helper**: when
  any migrated command rejects with `AppError::DbMismatch`, callers route
  through `syncMismatchedActiveDb` (Sprint 267) — extracted to a shared
  module ONLY if used by 3+ caller sites; otherwise inlined. Sprint 269's
  Retry toast is reused where the call site is user-initiated (data-grid
  open, DDL dialog confirm); fully-automated calls (schemaStore prefetch,
  autocomplete refresh) are sync-only — they call the helper but DO NOT
  raise the toast.
- `AC-271-06` — **Backend regression tests**: each migrated command's `tests`
  module gains at least one mismatch case: stub adapter with
  `current_database_fn` returning `"X"`; caller passes
  `expected_database = Some("Y")` → assert
  `AppError::DbMismatch { expected: "Y", actual: "X" }` AND assert the
  underlying trait method was NOT invoked (stub spy / counter).
- `AC-271-07` — **Frontend integration tests**: at least one vitest case per
  slice exercises the mismatch path end-to-end. The mocked IPC throws an
  error matching the Sprint 266 wire format; existing `parseDbMismatch`
  (Sprint 267) + `syncMismatchedActiveDb` (Sprint 267/269) fires; the caller
  state is asserted (e.g. `activeDb` synced, retry toast surfaces only for
  user-initiated paths).
- `AC-271-08` — **Sub-slicing pinned**: Generator splits delivery into the
  3 ordered slices (271a → 271b → 271c) listed above. Each slice individually
  passes all gates BEFORE the next slice begins. Each slice lands as its own
  commit (Conventional Commits, sprint-folder naming rule).
- `AC-271-09` — **Regression gate**: `pnpm vitest run --no-file-parallelism`
  (count monotonically non-decreasing per slice), `pnpm tsc --noEmit`,
  `pnpm lint`, `cargo clippy --all-targets --all-features -- -D warnings`,
  `cargo test` all pass on each slice individually and on the merged whole.

## Design Bar / Quality Bar

- **Probe block** must be byte-equivalent across all 25 migrated commands —
  same lock-acquisition order as `execute_query_inner:83–92`, same
  `unwrap_or_default()` coercion, same `AppError::DbMismatch` shape, same
  pre-trait-call ordering.
- **No `unwrap()` on adapter / probe paths** (Rust convention) — use `?` or
  `unwrap_or_default()`.
- **No `any` (TypeScript) on wrapper signatures** — use
  `expectedDatabase?: string`.
- **No `console.log`** shipped.
- **JSDoc**: each migrated wrapper gets a one-line comment naming the param
  and referencing Sprint 271 (mirroring Sprint 266's wrapper docs).
- **Tests**: rust tests use stub adapter with explicit `current_database_fn`
  override; vitest cases reuse existing IPC mocks and extend (don't rewrite).
- **Commit hygiene**: 3 commits — one per slice — Conventional Commits style.
  No `--no-verify`. No hook skipping (project rule).

## Verification Plan

### Required Checks (per-slice — re-run all six before advancing)

1. `cargo fmt --check` — passes.
2. `cargo clippy --all-targets --all-features -- -D warnings` — clean.
3. `cargo test` — passes; capture new mismatch test count delta vs prior
   slice's baseline.
4. `pnpm tsc --noEmit` — clean.
5. `pnpm lint` — clean.
6. `pnpm vitest run --no-file-parallelism` — passes; capture vitest test count
   delta vs prior slice's baseline (must be monotonically non-decreasing).

### Required Evidence

- Generator must provide:
  - The audit table above re-stated in `handoff.md` with per-row status
    confirmed against the actual implementation (file:line evidence for the
    probe block in each migrated command).
  - Per-slice file diffs (or list of changed files with one-line purpose).
  - New cargo test count delta per slice (e.g. `271a: +12 new mismatch tests,
    cargo test 184 → 196`).
  - New vitest count delta per slice (must be monotonic non-decreasing).
  - Full tail (final ~40 lines) of each of the 6 gates' output per slice.
  - List of caller sites updated per slice with file:line citations.
- Evaluator must cite:
  - Actual line numbers of the probe block in **at least 2 commands per
    slice** (sample audit) and verify byte-equivalence to the Sprint 266
    reference at `src-tauri/src/commands/rdb/query.rs:83–92`.
  - Per-slice cargo test + vitest deltas (numbers reported and reconciled).
  - The audit table's (a)/(b)/(c) marking accuracy — sample-verify at least 3
    rows per slice against the actual code.
  - For each slice's commit message: Conventional Commits format and
    sprint-folder naming rule.
  - At least one frontend integration test per slice asserting the mismatch
    end-to-end path (mocked IPC → `parseDbMismatch` → `syncMismatchedActiveDb`).

## Test Requirements

### Unit Tests (필수)

- **Backend (Rust)** — each of the 25 migrated commands gets at least one
  mismatch-case test in its file's `#[cfg(test)] mod tests {}`:
  - Stub adapter returns `current_database = Some("X")`.
  - Caller passes `expected_database = Some("Y")` (or struct field).
  - Assert `Err(AppError::DbMismatch { expected: "Y", actual: "X" })`.
  - Assert the stubbed underlying trait method was NOT called (counter / spy).
- **Frontend (vitest)** — at least 1 vitest case per slice for the caller
  layer wires the mismatch IPC mock end-to-end:
  - 271a: `schemaStore.test.ts` (or equivalent) — at least one introspection
    command's mismatch path.
  - 271b: `useQueryExecution` dry-run mismatch + `DataGrid` data-fetch
    mismatch (1 case each minimum).
  - 271c: at least one DDL driver dialog (e.g. `AddColumnDialog`) mismatch
    case end-to-end.

### Coverage Target

- 신규/수정 코드: 라인 70% 이상 권장.
- CI 전체 기준: 라인 40%, 함수 40%, 브랜치 35%.

### Scenario Tests (필수)

- [x] Happy path — `None` / omitted `expected_database` → byte-equivalent
      pre-sprint behaviour (existing tests assert this implicitly; spot-check
      at least one per slice).
- [x] 에러/예외 — mismatch case per migrated command (AC-271-06).
- [x] 경계 조건 — `current_database = None` coerces to `""`; covered by
      at least one slice test.
- [x] 기존 기능 회귀 없음 — `cargo test` + `pnpm vitest` monotonic
      non-decreasing across slices (AC-271-09).
- [x] 동시성 — Sprint 267 lock invariant holds (probe under
      `active_connections.lock()`); spot-check one schema + one DDL case
      asserts the probe sees the swapped pool.

## Test Script / Repro Script

1. Stand up sprint-271 branch from `main` (`e1f4689`).
2. Implement slice 271a (schema introspection): backend probe, TS wrappers,
   `schemaStore` caller forwarding, backend tests, one frontend test.
3. Run all 6 gates (cargo fmt/clippy/test, pnpm tsc/lint/vitest); fix any
   failure before advancing. Commit as `feat(sprint-271): slice 271a — ...`.
4. Implement slice 271b (query data + dry-run): backend probe, TS wrappers,
   `useQueryExecution` dry-run forwarding, `DataGrid` data-fetch forwarding,
   backend tests, one frontend test per caller layer.
5. Run all 6 gates; fix; commit as `feat(sprint-271): slice 271b — ...`.
6. Implement slice 271c (DDL): add `expected_database: Option<String>` with
   `#[serde(default)]` to each of 11 Request structs, backend probe, TS
   wrappers, DDL dialog caller forwarding, backend tests, one frontend test.
7. Run all 6 gates; fix; commit as `feat(sprint-271): slice 271c — ...`.
8. Write `handoff.md` with per-slice evidence (audit reconciliation, deltas,
   gate tails, caller-site lists).

## Ownership

- **Generator**: harness Generator agent.
- **Write scope**:
  - `src-tauri/src/commands/rdb/schema.rs` (slice 271a)
  - `src-tauri/src/commands/rdb/query.rs` (slice 271b — `execute_query_dry_run`,
    `query_table_data` only; `execute_query`, `execute_query_batch`,
    `cancel_query` byte-equivalent)
  - `src-tauri/src/commands/rdb/ddl.rs` (slice 271c)
  - `src/lib/tauri/schema.ts`, `src/lib/tauri/query.ts`, `src/lib/tauri/ddl.ts`
  - `src/stores/schemaStore.ts`, `src/components/rdb/DataGrid.tsx`,
    `src/components/query/QueryTab/useQueryExecution.ts`, DDL dialog drivers
    in `src/components/schema/*`
  - Test files alongside each of the above
  - `docs/sprints/sprint-271/handoff.md` (created by Generator at end)
- **Merge order**: 271a → 271b → 271c, each as its own commit, fast-forward
  merge to `main` only after all 3 land in order.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing on each slice: `yes`
- Acceptance criteria evidence linked in `handoff.md`: `yes`
- All 25 commands (b) confirmed in audit reconciliation with file:line of the
  probe block: `yes`
- Sprint 266 already-guarded commands and `cancel_query` byte-equivalent
  verified: `yes`
