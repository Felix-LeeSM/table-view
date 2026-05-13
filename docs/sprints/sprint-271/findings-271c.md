# Sprint 271c Evaluator Findings — DDL (11 commands) DbMismatch guard

## Verdict: **PASS**

| Dimension | Score | Justification |
|-----------|-------|--------------|
| Correctness | 9/10 | All 11 `_inner` fns probe via `ensure_expected_db` BEFORE trait dispatch under the same `active_connections.lock()` scope; verified `drop_table_inner` (ddl.rs:36–43) + `create_table_inner` (ddl.rs:149–161). Probe body byte-equivalent to Sprint 266 reference (`query.rs:83–92`) — same `unwrap_or_default()` coercion, same `AppError::DbMismatch { expected, actual }` shape. `create_table_plan` default trait impl sets `expected_database: None` on chained children (traits.rs:267, 285, 306) so parent probe is authoritative without double-checking. `query.rs` correctly kept inline (271b decision); diff vs 0369b30 = 0 lines for query.rs. |
| Completeness | 9/10 | All 11 contract rows landed: drop_table / rename_table / alter_table / add_column / drop_column / create_table / create_table_plan / create_index / drop_index / add_constraint / drop_constraint each gained `Option<String>` field + `_inner` probe + frontend wrapper JSDoc. Helper hoisted to `mod.rs` per the natural extraction trigger (23 call sites — schema 12 + ddl 11). Caller forwarding wired in DropTableDialog / RenameTableDialog / AddColumnDialog / DropColumnDialog / CreateTableDialog / StructurePanel + ColumnsEditor / IndexesEditor / ConstraintsEditor. `useDdlPreviewExecution` catches in both `loadPreview` and `runCommit` route through `parseDbMismatch` + `syncMismatchedActiveDb` + `toast.warning`. |
| Code Quality | 9/10 | `cargo fmt --check` clean. `cargo clippy --all-targets --all-features -- -D warnings` clean. No `unwrap()` outside `#[cfg(test)]` blocks. No `console.log` in new files. No `any` in production TS wrappers (the only `any` in new test files is `as any` for fixture coercion, eslint-disable'd with comment). JSDoc on every wrapper references Sprint 271c. `String(e) → e instanceof Error ? e.message : String(e)` switch is justified inline (needed for `parseDbMismatch` anchor) and existing test assertions updated with sprint-tagged explanation comments. |
| Testing | 9/10 | 13 new cargo tests: 11 mismatch (one per command) + 1 match-happy (`drop_table_expected_db_match_executes_normally`) + 1 None fast-path (`drop_table_expected_db_none_skips_current_database_probe` — panics if `current_database` probed). Mismatch tests stub `current_database = Some("dbA")`, request `Some("dbB")` → asserts `DbMismatch { expected: "dbB", actual: "dbA" }` AND panic-stub trait closure proves trait method NOT invoked. `create_table_plan_expected_db_mismatch` stubs all 3 chained children's trait methods to panic — proves probe halts the plan before any child. 2 new vitest files (4 cases): `DropTableDialog.dbMismatch.test.tsx` + `CreateTableDialog.dbMismatch.test.tsx`, each covering mismatch end-to-end (verifyActiveDb + setActiveDb + toast.warning) AND non-mismatch silent-regression guard. Every new test carries the Sprint 271c tag + 작성 이유 comment. |
| Contract Compliance | 9/10 | AC-271-01 audit pinned: 11 (b) rows match contract enumeration. AC-271-02: probe BEFORE trait dispatch under lock, byte-equivalent. AC-271-03: every TS wrapper has Sprint 271c JSDoc. AC-271-04: schemaStore.dropTable/renameTable forward `db`, every dialog forwards workspace `(connId, db)`. AC-271-05: `useDdlPreviewExecution` reuses extracted `syncMismatchedActiveDb` + raises Sprint 269 passive toast (DDL is user-initiated). AC-271-06: 11 backend mismatch tests with panic-stub witnesses. AC-271-07: 2 frontend test files exercising end-to-end mismatch. AC-271-08: 271c land as separate slice (currently uncommitted working tree on top of `0369b30 feat(sprint-271b)`). AC-271-09: all 6 gates pass. |
| **Overall** | **9.0/10** | All gates pass; helper hoisting decision is well-justified; tests are thorough with fail-loud panic-stubs. |

## Sprint Contract Status (Done Criteria)

- [x] **AC-271-01 audit pinned** — 11 (b) rows match contract; 271a (12 schema) + 271b (2 query) + 271c (11 DDL) = 25 total (b) commands.
- [x] **AC-271-02 backend handler accepts `expected_database`** — All 11 `_inner` fns in `src-tauri/src/commands/rdb/ddl.rs` call `ensure_expected_db(adapter, request.expected_database.as_deref()).await?` after `as_rdb()?` and before the trait dispatch (lines 41, 67, 90, 111, 135, 158, 179, 203, 224, 245, 266). `None` path is byte-equivalent — early `if let Some` short-circuit means `current_database` never probed.
- [x] **AC-271-03 Tauri command + TS wrapper exposes opt-in parameter** — `src-tauri/src/models/schema.rs` has 11 `#[serde(default)] pub expected_database: Option<String>` fields on each Request struct. `src/lib/tauri/ddl.ts` 11 wrappers with Sprint 271c JSDoc. `src/types/schema.ts` has 11 TS Request interface fields (mixture of `expected_database?: string` and `expectedDatabase?: string` to match the consumer style at each site).
- [x] **AC-271-04 callers forward active db** — `schemaStore.dropTable` / `renameTable` forward workspace `db` (`src/stores/schemaStore.ts:427, 442`). DDL dialogs (DropTable / RenameTable / AddColumn / DropColumn / CreateTable / StructurePanel) and editors (ColumnsEditor / IndexesEditor / ConstraintsEditor) thread workspace `(connId, db)`.
- [x] **AC-271-05 sync helper reuse** — `useDdlPreviewExecution` (`src/components/structure/useDdlPreviewExecution.ts:127–139, 165–182, 204–211`) calls `parseDbMismatch` + `syncMismatchedActiveDb` + `toast.warning` in both `runCommit` and `loadPreview` catches. DDL is user-initiated → Sprint 269 passive Retry toast surfaces.
- [x] **AC-271-06 backend regression tests** — 11 `_expected_db_mismatch_returns_dbmismatch_and_skips_trait` tests with panic-stub witnesses + `create_table_plan` triple-child panic guard. `cargo test --lib commands::rdb::ddl::tests` shows 45 passed, 0 failed.
- [x] **AC-271-07 frontend integration tests** — `DropTableDialog.dbMismatch.test.tsx` + `CreateTableDialog.dbMismatch.test.tsx` (2 cases each = 4 total). Mismatch path asserts `verifyActiveDbMock` called with `"conn-1"` + `toastWarningMock` called with `"db-2"`. Non-mismatch silent-regression guards assert neither is invoked.
- [x] **AC-271-08 sub-slicing** — 271a committed (`13c11ed`), 271b committed (`0369b30`), 271c uncommitted on working tree. Each slice individually gated.
- [x] **AC-271-09 regression gate** — All 6 gates green: cargo fmt clean / clippy clean / cargo test lib 708 (+13 vs 695) / pnpm tsc exit 0 / pnpm lint clean / vitest 266 files 3247 tests (+4 vs 3243).

## Invariant Verification

- **Sprint 266 commands UNCHANGED** — `git diff 0369b30 -- src-tauri/src/commands/rdb/query.rs` = 0 lines. `execute_query` + `execute_query_batch` byte-equivalent.
- **`cancel_query` UNCHANGED** — covered by query.rs 0-diff above.
- **Mongo UNCHANGED** — `git diff 0369b30 -- src-tauri/src/commands/document/` = 0 lines.
- **271a 12 schema commands probe behavior byte-equivalent** — `schema.rs` diff vs 271a commit shows only the helper hoisting import path change + 1 module-level doc comment addition; the 12 `ensure_expected_db(adapter, expected_database).await?` call sites are unchanged in shape/behavior. Helper body in `mod.rs:50–64` is verbatim from the removed `schema.rs:33–47` block (verified line-by-line).
- **Probe pattern byte-equivalent to Sprint 266 reference** — `mod.rs:54–62` `if let Some(expected) = expected_database { let actual = adapter.current_database().await?.unwrap_or_default(); if actual != expected { return Err(AppError::DbMismatch { expected: expected.to_string(), actual }); } }` matches `query.rs:83–91` token-for-token (only the surrounding lock-release branch differs, justified by 271b's inline-keep decision).

## Sample Audit — Probe Locations (2+ DDL handlers)

- **`drop_table_inner`** (ddl.rs:32–43): `let connections = state.active_connections.lock().await; let active = connections.get(&request.connection_id).ok_or_else(...)?; let adapter = active.as_rdb()?; ensure_expected_db(adapter, request.expected_database.as_deref()).await?; adapter.drop_table(request).await` — probe sits between `as_rdb()?` and `adapter.drop_table()`, under the same lock guard. ✓
- **`create_table_inner`** (ddl.rs:149–161): same shape — probe at line 158 before `adapter.create_table(request)`. ✓
- **`create_table_plan_inner`** (ddl.rs:170–183): same shape — probe at line 179 before `adapter.create_table_plan(request).await`. The trait default impl in `db/traits.rs:264–315` sets `expected_database: None` on the 3 chained child Requests (parent_req, ireq, creq) so children don't re-probe.

## Test Sample Audit (3 of 11 mismatch tests)

- **`drop_table_expected_db_mismatch_returns_dbmismatch_and_skips_trait`** (ddl.rs:767–780): stub `current_database = Some("dbA")`, `drop_table_fn = panic!("drop_table must not run on mismatch")`, request `expected_database = Some("dbB")` → asserts `DbMismatch { expected: "dbB", actual: "dbA" }`. ✓
- **`create_table_plan_expected_db_mismatch_returns_dbmismatch_and_skips_trait`** (ddl.rs:865–899): stubs all 3 chained children (`create_table_fn`, `create_index_fn`, `add_constraint_fn`) to panic — proves probe halts BEFORE any chained child is invoked. ✓
- **`drop_table_expected_db_none_skips_current_database_probe`** (ddl.rs:995–1015): stubs `current_database_fn = panic!("current_database must not be probed when expected_database is None")` and request defaults to `expected_database = None` → assertion that probe is fully skipped on the None path (byte-equivalence proof). ✓

## Quality Bar Spot Checks

- **No `unwrap()` on production paths** — only inside `#[cfg(test)]` blocks (test helper code, idiomatic).
- **No `any` on wrapper signatures** — `src/lib/tauri/ddl.ts` uses `expectedDatabase?: string` (positional) or `request.expectedDatabase?: string` (struct field). New test files have `as any` cast for fixture connection mock with eslint-disable-next-line comment.
- **No `console.log`** — `grep` confirms 0 instances in `useDdlPreviewExecution.ts`, new test files, and `ddl.ts`.
- **Sprint 271c JSDoc** — every TS wrapper has a one-liner referencing Sprint 271c.
- **Test sprint annotation** — all 11 mismatch + 2 happy/none tests carry "Sprint 271c (2026-05-13)" + 작성 이유 comment block. Both new vitest files lead with sprint-tagged docstring.

## Feedback for Generator

None blocking. Minor observations (not required for PASS):

1. **JSDoc consistency drift** — `dropTable` compat wrapper says "Sprint 271c — optional `expectedDatabase` last-positional propagates..." but `renameTable` compat wrapper just says "see `dropTable`". Acceptable shorthand but `alterTable` then says "request.expectedDatabase opt-in DbMismatch guard" — three slightly different phrasings within 80 lines. Suggestion: pick one canonical phrasing for the 9 request-shape wrappers and one for the 2 compat positional wrappers.
   - Current: 3 phrasing variants.
   - Expected: 2 canonical phrasings (1 per wrapper shape).
   - Suggestion: Cosmetic; not a blocker.

2. **TS interface field-name inconsistency** — `src/types/schema.ts` uses both `expected_database?: string` (snake_case) and `expectedDatabase?: string` (camelCase) across 11 Request interfaces. Tauri's auto-conversion handles either at runtime, but the inconsistency is a small papercut for future readers.
   - Current: mixed naming.
   - Expected: pick camelCase (matches the wrapper-level parameter name `expectedDatabase`) consistently.
   - Suggestion: A follow-up sprint cleanup; not in 271c scope.

## Final Gate Tails

```
cargo fmt --check        → exit 0 (no diff)
cargo clippy --all-...    → "Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.60s"
cargo test --lib         → "test result: ok. 708 passed; 0 failed; 2 ignored"
pnpm tsc --noEmit        → exit 0
pnpm lint                → clean (no errors)
pnpm vitest run --no-file-parallelism → "Test Files  266 passed (266) / Tests  3247 passed (3247)"
```

## Conclusion

Sprint 271c lands all 11 DDL commands cleanly. Probe pattern byte-equivalent to Sprint 266 reference. Helper hoisting from schema.rs → mod.rs is well-justified (23 call sites, identical body). Sprint 266 + cancel_query + Mongo + 271a + 271b invariants verified by 0-line diffs against parent commits. Tests are fail-loud (panic-stub trait closures, panic-stub `current_database` for None path). All 6 gates green with monotonically non-decreasing test counts.

**PASS.**
