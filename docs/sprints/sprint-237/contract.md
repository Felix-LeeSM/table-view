# Sprint Contract: sprint-237

> **Note**: This sprint's directory previously held a different workload
> (fixture data workflow, dated 2026-05-10 — see legacy `findings.md` /
> `handoff.md`). The contract below supersedes that scope. The legacy
> files are preserved for archival reference; this contract governs the
> active Sprint 237 = **Column MODIFY (Phase 27 closure)**.

## Summary

- **Goal**: Close Phase 27 (TablePlus パリティ 7단계 마지막) by extending
  `ColumnChange::Modify` with a USING cast expression (PG `ALTER COLUMN …
  TYPE … USING …`), wiring a sub-clause input into `ColumnsEditor`, adding a
  pre-execution conflict check for `SET NOT NULL` (count of NULL rows
  visible to the user before commit), and recording the parity-milestone
  closure markers (lesson + `docs/PLAN.md` + `docs/archives/roadmaps/memory-roadmap/`).
- **Audience**: Generator (implementation), Evaluator (gate + closure
  marker verification).
- **Owner**: harness Generator.
- **Verification Profile**: `mixed` — backend `cargo test` + `cargo clippy`
  + `cargo fmt --check`; frontend `pnpm vitest run` + `pnpm tsc --noEmit`
  + `pnpm lint`; manual round-trip via vitest mock OK.

## In Scope

Sprint 237 closes the Column MODIFY surface (last remaining DDL action in
Phase 27) by:

1. Adding `using_expression: Option<String>` to `ColumnChange::Modify`
   (`#[serde(default)]` → existing callers byte-equivalent) and mirroring
   the field on the TS `ColumnChange` discriminated union.
2. Extending the PG SQL emitter so that `ALTER COLUMN "<name>" TYPE
   <new_type>` becomes `ALTER COLUMN "<name>" TYPE <new_type> USING <expr>`
   whenever both `new_data_type` and `using_expression` are present. The
   nullability and default sub-clauses are unaffected by USING.
3. Adding a USING input to the `ColumnsEditor` MODIFY editor that only
   appears when `new_data_type` is set (free-text input, no syntax check —
   PG returns its verbatim error if invalid).
4. Adding a `count_null_rows` Tauri command + a debounced (500 ms) probe
   from the MODIFY editor whenever the user toggles SET NOT NULL on a
   column that is currently nullable. If `count > 0`, surface an inline
   warning ("`N` rows have NULL — adding NOT NULL will fail"). Zero rows
   → no warning. The warning is informative only; it does NOT block
   preview / commit.
5. Recording the Phase 27 closure markers — `docs/archives/incidents/` 회고 1편,
   `docs/PLAN.md` Phase 27 status `진행 중` → `종료`, `docs/archives/roadmaps/memory-roadmap/`
   파리티 마일스톤 갱신.

## Out of Scope

- **Column reorder** (`ALTER TABLE … ALTER COLUMN … POSITION`) — PG has
  no native support (`phase-27.md` § Out of Scope).
- **Column rename** — not in Sprint 237 scope; candidate for a follow-up
  sprint.
- **TABLESPACE / PARTITION / MATERIALIZED VIEW / TEMP TABLE**.
- **MongoDB collection schema validation**.
- **USING expression syntax check** — free-text passthrough; the user
  owns PG's verbatim error.
- **Other pre-execution conflict checks** (e.g. type-change cast
  simulation, default-value validity check). Only the NULL-rows guard for
  SET NOT NULL is in this sprint.
- **Multi-statement DDL transactions** beyond what `alter_table` already
  emits — see Invariants.

## Invariants

- `alter_table` SQL emission remains a single `ALTER TABLE …
  <comma-joined-parts>` statement. PG treats comma-joined ALTER parts as
  atomic; no change to the multi-step transaction shape.
- `ColumnChange::Modify` callers that omit `using_expression` (i.e.
  `#[serde(default)]` → `None`) are **byte-equivalent** to pre-Sprint-237
  behaviour. No new probe, no new SQL clause, no observable wire change.
- Sprint 236 `add_column` / `drop_column` modal paths are not touched.
- `useDdlPreviewExecution` (Sprint 214 hook) signature is **frozen** —
  no new params, no return-shape change. Conflict-check state lives
  alongside in `ColumnsEditor` (or a local sibling hook), not inside
  `useDdlPreviewExecution`.
- `validate_identifier` (existing helper) is reused for the `schema`,
  `table`, and `column` identifiers passed to `count_null_rows`. The
  USING expression is **free-text** and is NOT routed through
  `validate_identifier`.
- Sprint 271c `expected_database: Option<String>` guard pattern is
  honoured on `count_null_rows` (optional last positional param,
  `#[serde(default)]` semantics; `None` byte-equivalent).
- Phase 21–26 surface (constraints, indexes, row CRUD, structure dialogs,
  Safe Mode, etc.) sees zero behavioural change.
- DbMismatch wire format (Sprint 266+) is unchanged.

## Acceptance Criteria

- **`AC-237-01`** — **Backend type extension**:
  `ColumnChange::Modify` in `src-tauri/src/models/schema.rs` gains
  `using_expression: Option<String>` annotated `#[serde(default)]`. TS
  mirror in `src/types/schema.ts` updates the `Modify` variant of the
  `ColumnChange` discriminated union. Pre-existing serialized payloads
  that omit `using_expression` deserialize to `None` / `undefined`
  unchanged. Unit test asserts round-trip with and without the field.
- **`AC-237-02`** — **PG SQL emitter — USING branch**: in
  `src-tauri/src/db/postgres/mutations.rs::alter_table` (current lines
  `779-871`), when a `ColumnChange::Modify` carries both
  `new_data_type: Some(t)` and `using_expression: Some(expr)`, the
  emitted SQL part is `ALTER COLUMN "<name>" TYPE <t> USING <expr>`. When
  `using_expression` is `None`, the emitted SQL part is the pre-existing
  `ALTER COLUMN "<name>" TYPE <t>` (byte-equivalent). The `SET / DROP NOT
  NULL` and `SET / DROP DEFAULT` sub-parts are emitted as additional
  comma-joined parts unchanged — USING affects only the TYPE clause.
- **`AC-237-03`** — **`ColumnsEditor` USING input**: the MODIFY editor in
  `src/components/structure/ColumnsEditor.tsx` renders a free-text USING
  input **conditionally — only when `new_data_type` is set** (i.e. the
  user has chosen a new type). Placeholder: `e.g. col::int`. Tooltip:
  `Used when changing column type if PostgreSQL can't cast implicitly`.
  The value is forwarded into the `pendingChanges` entry's
  `usingExpression` field and lands in the `alterTable` request payload.
  When `new_data_type` is cleared, the USING input is hidden and any
  prior value is cleared.
- **`AC-237-04`** — **NULL-rows conflict probe**:
  - Backend: new Tauri command `count_null_rows(connection_id: String,
    schema: String, table: String, column: String,
    expected_database: Option<String>) -> Result<i64, AppError>` issues
    `SELECT COUNT(*) FROM "<schema>"."<table>" WHERE "<column>" IS NULL`
    against the active PG pool. Identifiers go through
    `validate_identifier` and are interpolated (column / table /
    schema). The Sprint 271c `expected_database` guard runs under the
    same `active_connections.lock()` acquisition before the trait call;
    `None` is byte-equivalent.
  - Frontend: in the MODIFY editor, when the user toggles SET NOT NULL
    on a column currently nullable (`current_nullable === true &&
    new_nullable === false`), debounce 500 ms, then call
    `count_null_rows` via a TS wrapper in `src/lib/tauri/ddl.ts`. If
    `count > 0`, render an inline warning element with the text "`N`
    rows have NULL — adding NOT NULL will fail" (substituting actual
    N). If `count === 0`, render nothing. The warning is purely visual —
    preview / commit are not blocked. Toggling back (or changing the
    column / value) cancels the in-flight debounce.
- **`AC-237-05`** — **Multi-step transaction shape preserved**:
  `alter_table` continues to emit a single `ALTER TABLE …
  <comma-joined-parts>` SQL statement. No new statement boundaries are
  introduced. Existing fixture tests for `alter_table` SQL emission stay
  green (zero regressions in their string-compare assertions).
- **`AC-237-06`** — **Tests**:
  - **Backend SQL emission fixtures (3 new cases)** in the existing
    `mutations.rs` test module:
    1. type-only Modify with `using_expression = None` → SQL byte-equal
       to pre-sprint output for the same input (regression guard).
    2. type + USING (`new_data_type = Some("int")`, `using_expression =
       Some("col::int")`) → emits `ALTER COLUMN "col" TYPE int USING
       col::int`.
    3. type + USING + nullability + default (composite) → emits one
       part per sub-clause, comma-joined, USING on the TYPE part only.
  - **Backend `count_null_rows` unit tests** in its file's `tests`
    module:
    - 3× `validate_identifier` cases (good schema, bad table with `;`,
      bad column with quote → reject).
    - 1× happy-path query-interpolation assertion (the SQL string
      contains the quoted identifiers in the expected order).
    - 1× **DbMismatch panic-closure** test mirroring the Sprint 271c
      pattern: stub adapter returns `current_database = Some("X")`,
      caller passes `expected_database = Some("Y")` → asserts
      `AppError::DbMismatch { expected: "Y", actual: "X" }` AND that
      the stub's underlying `query_one` (or equivalent) was NOT
      called.
  - **Frontend USING input vitest**: assert that the USING input is
    hidden when `new_data_type` is empty / unset and visible when set;
    when filled, the preview payload received by the mocked `alterTable`
    contains `using_expression` (snake_case wire) / the wrapper passes
    `usingExpression` through.
  - **Frontend conflict-probe vitest**: 2 cases.
    1. User toggles SET NOT NULL on a nullable column → after 500 ms
       debounce, mocked `count_null_rows` resolves `7` → warning text
       "`7 rows have NULL — adding NOT NULL will fail`" appears.
    2. Same flow, mocked `count_null_rows` resolves `0` → no warning
       element rendered.
- **`AC-237-07`** — **Phase 27 closure markers**:
  - New `docs/archives/incidents/parity-milestone/2026-05-13-tableplus-parity-phase-27-closure/memory.md`
    (or equivalent path under `docs/archives/incidents/`) — 회고 1편 recording the
    TablePlus 패리티 7단계 종료, key trade-offs, and the trigger for
    Phase 17–20 (MySQL / MariaDB / SQLite / Oracle) re-evaluation.
  - `docs/PLAN.md` Phase 27 status updated from `진행 중` to `종료`.
  - `docs/archives/roadmaps/memory-roadmap/memory.md` 패리티 마일스톤 row updated to reflect
    Sprint 237 closure.
- **`AC-237-08`** — **Regression gate**: `cargo test` (full suite),
  `cargo clippy --all-targets --all-features -- -D warnings`,
  `cargo fmt --check`, `pnpm tsc --noEmit`, `pnpm lint`, `pnpm vitest
  run` all pass on the merged change. New test counts are monotonically
  non-decreasing.

## Design Bar / Quality Bar

- `using_expression` field uses `#[serde(default)]` so callers that omit
  it remain wire-byte-equivalent; an explicit test pins this.
- USING is **free-text**. No identifier validation, no AST parse, no
  client-side syntax assist. PG's error surface is the source of truth.
- The conflict probe is **debounced** at 500 ms with cancellation on
  unmount / re-toggle to avoid hammering the backend during typing.
- Probe failure (e.g. table dropped underneath, network error) is
  **swallowed silently** — no warning is shown, no error toast fires.
  The probe is advisory; the user can still commit and PG will surface
  the real error on execute. A one-line comment in the catch block
  records this rationale.
- No `unwrap()` on adapter / probe paths (Rust convention). Use `?` or
  `unwrap_or_default()`.
- No `any` on the TS wrapper for `count_null_rows`. Returns `Promise<number>`.
- JSDoc on `count_null_rows` wrapper one-lines the Sprint 237 reference.
- Commit hygiene: a small number of commits is acceptable (this is the
  Phase closure — 1–3 commits, Conventional Commits style, e.g.
  `feat(sprint-237): column MODIFY USING + null-conflict probe`,
  `docs(sprint-237): phase 27 closure markers`). No `--no-verify`.

## Verification Plan

### Required Checks

1. `cd src-tauri && cargo test alter_table && cargo test count_null_rows`
   — focused smoke that the new tests are wired and pass.
2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
   — clean.
3. `cd src-tauri && cargo fmt --check` — clean.
4. `cd src-tauri && cargo test --lib` — full backend suite green.
5. `pnpm tsc --noEmit` — clean.
6. `pnpm vitest run` — full frontend suite green; new tests included
   (count monotonically non-decreasing vs prior `main` baseline).
7. `pnpm lint` — clean.
8. **Manual round-trip (vitest-mocked is sufficient)**:
   - Open `ColumnsEditor`, edit pencil a column, change type to `int`,
     enter `col::int` into the USING input → Review SQL →
     preview displays `ALTER COLUMN "col" TYPE int USING col::int` (and
     the rest of any comma-joined parts unchanged) → Execute → success.

### Required Evidence

- Generator must provide:
  - Per-changed-file purpose (one line each).
  - Tail of each of the 7 gates listed above (≈40 final lines each).
  - SQL emission fixture snapshots (the 3 new cases) with the expected
    SQL strings inlined in `handoff.md`.
  - vitest test names for the USING-input case + the two conflict-probe
    cases.
  - Quote of the diff line(s) in `docs/PLAN.md` flipping Phase 27 status,
    quote of the diff line in `docs/archives/roadmaps/memory-roadmap/memory.md`, and the
    relative path of the new `docs/archives/incidents/` retro file.
- Evaluator must cite:
  - File:line of `using_expression` added to `ColumnChange::Modify`.
  - File:line of the emitter branch in `mutations.rs`.
  - File:line of the USING input element in `ColumnsEditor.tsx` and its
    conditional render guard.
  - File:line of the new `count_null_rows` command + its
    `validate_identifier` reuse + its `expected_database` probe block.
  - The 3 closure marker artifacts (lesson file path, PLAN diff line,
    roadmap diff line).

## Test Requirements

### Unit Tests (필수)

- **Backend (Rust)** — extends `mutations.rs` test module with 3 SQL
  emission cases per AC-237-06; new `count_null_rows` file/module
  ships its own `#[cfg(test)] mod tests {}` covering 3 identifier
  validation cases + 1 happy-path interpolation + 1 DbMismatch
  panic-closure (Sprint 271c pattern).
- **Frontend (vitest)** — new cases in `ColumnsEditor.test.tsx` (or a
  sibling test file) for: USING input visibility toggle, USING payload
  forwarding, debounced NULL-rows warning at `count > 0`, no warning at
  `count === 0`.

### Coverage Target

- 신규/수정 코드: 라인 70% 이상 권장.
- CI 전체 기준: 라인 40%, 함수 40%, 브랜치 35%.

### Scenario Tests (필수)

- [x] Happy path — type change + USING + execute success path covered by
      vitest mock round-trip.
- [x] 에러 / 예외 — `count_null_rows` mismatch panic-closure; probe
      failure swallowed silently (no warning, no toast).
- [x] 경계 조건 — `using_expression = None` byte-equivalent (regression
      fixture); `count = 0` → no warning; type cleared → USING input
      hidden and stale value dropped.
- [x] 동시성 — debounced probe cancels in-flight call on re-toggle /
      column change; covered by vitest fake timers.
- [x] 기존 기능 회귀 없음 — `cargo test` + `pnpm vitest` monotonically
      non-decreasing; Sprint 236 add/drop modal flow unchanged (manual
      spot check via existing tests).

## Test Script / Repro Script

1. Branch from `main` (`e1f4689`).
2. Edit `src-tauri/src/models/schema.rs` — add `using_expression:
   Option<String>` with `#[serde(default)]` to `ColumnChange::Modify`.
   Update TS mirror in `src/types/schema.ts`.
3. Edit `src-tauri/src/db/postgres/mutations.rs::alter_table` — branch
   on `using_expression.is_some()` to append ` USING <expr>` to the
   TYPE part. Add 3 SQL emission fixture tests.
4. Add `count_null_rows` command (new file or extend an existing schema
   command file). Add 5 unit tests (3 identifier validation + 1
   interpolation + 1 mismatch panic-closure).
5. Add `countNullRows` TS wrapper in `src/lib/tauri/ddl.ts`.
6. Edit `src/components/structure/ColumnsEditor.tsx` — render USING
   input conditionally on `new_data_type`; thread `usingExpression`
   into the `pendingChanges` row; wire 500 ms debounced
   `count_null_rows` probe + inline warning element.
7. Add vitest cases in `src/components/structure/ColumnsEditor.test.tsx`
   (or sibling).
8. Run all 7 gates; fix; commit `feat(sprint-237): column MODIFY USING
   + null-conflict probe`.
9. Add closure markers — `docs/archives/incidents/parity-milestone/...
   /memory.md`, flip `docs/PLAN.md` Phase 27 status to `종료`, update
   `docs/archives/roadmaps/memory-roadmap/memory.md`. Commit `docs(sprint-237): phase 27
   closure markers`.
10. Write `handoff.md` with all gate tails + AC coverage table + closure
    marker citations.

## Ownership

- **Generator**: harness Generator agent.
- **Write scope**:
  - `src-tauri/src/models/schema.rs`
  - `src-tauri/src/db/postgres/mutations.rs`
  - `src-tauri/src/commands/rdb/<schema or new file>.rs`
    (`count_null_rows`)
  - `src-tauri/src/commands/mod.rs` (registration)
  - `src/types/schema.ts`
  - `src/lib/tauri/ddl.ts`
  - `src/components/structure/ColumnsEditor.tsx`
  - `src/components/structure/ColumnsEditor.test.tsx` (or sibling)
  - `docs/PLAN.md` (Phase 27 status flip)
  - `docs/archives/roadmaps/memory-roadmap/memory.md` (parity milestone row)
  - `docs/archives/incidents/parity-milestone/2026-05-13-tableplus-parity-phase-27-closure/memory.md`
    (new retro)
  - `docs/sprints/sprint-237/handoff.md` (new — appends or replaces
    legacy stub; recommended: replace, since legacy was a different
    sprint scope inadvertently filed under 237)
- **Merge order**: single feature commit + closure-marker commit, both
  fast-forwarded to `main` after all gates pass.

## Exit Criteria

- Open `P1` findings: `0`.
- Open `P2` findings: **`0`** (see §Carryover policy below).
- Required checks passing: `yes`.
- AC-237-01 through AC-237-08 evidence linked in `handoff.md`.
- Phase 27 closure markers present in all 3 locations (lesson file +
  `docs/PLAN.md` + `docs/archives/roadmaps/memory-roadmap/memory.md`).

## Carryover policy (Sprint 237 — strict)

Sprint 237 is the **Phase 27 closure** sprint. **P2 carryover is
minimised**:

- If the Evaluator surfaces any P2 that is ≤ 5 minutes of work, the
  Evaluator re-invokes the Generator to fix it in the same sprint.
- `MAX_ATTEMPTS_PER_SPRINT = 5`. Iterate until P2 = 0.
- A P2 may be **deferred** only if it represents ≥ 10 minutes of
  architectural change that legitimately belongs in a follow-up sprint.
  The deferral rationale must be recorded in `findings.md` with an
  explicit `deferred-to: sprint-NNN` tag.
