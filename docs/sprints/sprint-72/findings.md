# Findings: sprint-72 (Phase 6 plan E-1 — `MongoAdapter::aggregate` + `aggregate_documents` command)

## Verification Summary

- Profile: `command` (6 generator-scope checks + orchestrator-level `cargo test --lib` / `pnpm vitest run`)
- Checks run:
  - `cd src-tauri && cargo fmt --all -- --check` — PASS (no output).
  - `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings` — PASS (`Finished dev profile`, 0 warnings).
  - `cd src-tauri && cargo test --lib db::mongodb` — PASS (`25 passed; 0 failed; 191 filtered out`). Sprint 71 baseline 23 → +2 (new `test_aggregate_without_connection_returns_connection_error`, `test_aggregate_rejects_empty_namespace`), and the removed `aggregate_returns_unsupported` confirms the stub test is gone.
  - `cd src-tauri && cargo test --test mongo_integration` — PASS (`5 passed`). Docker MongoDB container is live, so the two new aggregate integration tests actually executed against the driver (not skipped).
  - `cd src-tauri && cargo test --lib` — PASS (`216 passed; 0 failed`). Orchestrator baseline 215 → +1 (+2 new unit tests − 1 deleted `aggregate_returns_unsupported` = +1). Math checks out.
  - `pnpm tsc --noEmit` — PASS (no output → 0 type errors).
  - `pnpm lint` — PASS (ESLint exited with 0).
  - `git diff --stat HEAD -- src/` — empty output; Frontend invariant holds. (No Sprint 74 parallel diff exists in this working tree — handoff's "병렬 Sprint 74 agent" note appears to have been a claim about a different environment; here diff is cleanly empty.)
- Evidence reviewed:
  - `src-tauri/src/db/mongodb.rs` lines 395-450 — aggregate implementation mirrors `find` structure (validate_ns → Instant::now → current_client → coll.aggregate(pipeline) → cursor loop → columns_from_docs → project_row → rows.len() as i64).
  - `src-tauri/src/commands/document/query.rs` lines 64-80 — new `aggregate_documents` Tauri command with identical dispatch pattern to `find_documents`.
  - `src-tauri/src/commands/document/mod.rs` lines 1-22 — doc-comment updated to list both commands.
  - `src-tauri/src/lib.rs` line 52 — `commands::document::query::aggregate_documents` present in `tauri::generate_handler![]`.
  - `src-tauri/tests/mongo_integration.rs` lines 314-495 — two new `#[serial_test::serial]` integration tests: `test_mongo_adapter_aggregate_match_sort`, `test_mongo_adapter_aggregate_group_count`.
  - `grep "aggregate_returns_unsupported" src-tauri/src/db/mongodb.rs` → 0 matches (stub test deleted).
  - `grep -n "estimated_document_count" src-tauri/src/db/mongodb.rs` → hits only in module doc-comment and `find` body (lines 20, 27, 372, 377, 379) plus line 433 which is the comment in `aggregate` explaining why it's NOT used. AC-03 confirmed.

## Findings

### F-001 Stale doc-comment ("remaining four stubs" vs. actual three)

- Severity: P3 (nit — doc-comment drift only, no runtime impact)
- Repro: `src-tauri/src/db/mongodb.rs:863-867`.
- Expected: After Sprint 72 lifts the `aggregate` stub, only three Unsupported stubs remain (`insert_document`, `update_document`, `delete_document`). The comment block that introduces the Unsupported-stub test coverage should read "remaining three stubs".
- Actual: Line 866 still says `the remaining four stubs keep their regression guard`, carrying Sprint 66's count forward. The module-level doc-comment at lines 30-33 was updated correctly ("still-stubbed methods (`insert_document`, `update_document`, `delete_document`)"), so this is an inconsistency between the two doc blocks.
- Evidence: `src-tauri/src/db/mongodb.rs:863-867`.
- Broken Contract Line: None (contract does not mandate this specific wording). Design Bar / Quality Bar only demands symmetry with `find`; this is a documentation nit.
- Suggestion: Update line 866 from `remaining four stubs` → `remaining three stubs` so the test-section doc-comment matches the module-level header.
- Status: open

### F-002 Empty-pipeline pass-through is not explicitly exercised by a test

- Severity: P3 (AC-04 is still demonstrated, but only indirectly)
- Repro: There is no integration test (or unit test against a live connection) that runs `adapter.aggregate("db", "coll", vec![])` against a real collection and asserts that all documents are returned.
- Expected: A stronger AC-04 proof would add a short integration test that seeds a fixture and verifies the empty-pipeline path returns the full set with matching `total_count` and `rows.len()`.
- Actual: The generator relies on (a) driver-level behaviour of `coll.aggregate(Vec::new())` and (b) the unit test `test_aggregate_without_connection_returns_connection_error` using an empty `Vec::new()` pipeline, which only proves that the vector is accepted up to the connection-error boundary. Contract text for AC-04 does say the test is "필수가 아니다" (not required), so this is a judgment call, not a contract violation.
- Evidence: `src-tauri/src/db/mongodb.rs:1042-1050`; `src-tauri/tests/mongo_integration.rs:314-495` (no empty-pipeline case among the two new tests).
- Broken Contract Line: None (contract line 132 marks `빈 pipeline (통합 테스트에서 선택적으로 — 필수는 아님)`).
- Suggestion: Optional — for Sprint 73 / Sprint 80 hardening, add a third integration test (`test_mongo_adapter_aggregate_empty_pipeline_returns_full_collection`) that executes `aggregate("table_view_test", "users", vec![])` and checks `result.rows.len() == 3`.
- Status: open (informational — not blocking)

### F-003 Handoff file:line ranges are off by a few lines

- Severity: P4 (documentation only; reviewer convenience)
- Repro: `handoff.md` claims `MongoAdapter::aggregate` is at `mongodb.rs:395-448` (actual end is 450), `aggregate_documents` at `query.rs:58-76` (actual 64-80), `test_aggregate_without_connection_returns_connection_error` at `mongodb.rs:1042` (actual 1041).
- Expected: Line-range citations in `handoff.md` should match the final file as persisted.
- Actual: Off by 2-6 lines in the cited ranges. The code itself is unambiguous; the drift seems to come from last-second edits after the handoff was drafted.
- Evidence: Compare `docs/sprints/sprint-72/handoff.md` L60-68 with the real files.
- Broken Contract Line: None directly; Evidence-To-Return does ask for `file:line-range` but not for strict accuracy.
- Suggestion: A final `rg -n "fn aggregate\|pub async fn aggregate_documents\|test_aggregate_without\|test_aggregate_rejects"` pass before handoff submission would fix this.
- Status: open (nit)

## Pass Checklist

- `AC-01` PASS — `Unsupported` stub is gone from the aggregate body. `src-tauri/src/db/mongodb.rs:395-450` implements `coll.aggregate(pipeline).await` followed by a cursor `while let Some(next)` loop. `grep "Unsupported" mongodb.rs` only matches the three surviving stubs + their tests + the doc-comment narrative.
- `AC-02` PASS — L412-422 collects cursor results into `raw_documents: Vec<Document>`; L426-430 derives `columns = columns_from_docs(&raw_documents)` and projects rows via `project_row` — identical helper reuse as `find` (L350-370).
- `AC-03` PASS — `let total_count = rows.len() as i64;` at `mongodb.rs:437`. `grep -n "estimated_document_count" src-tauri/src/db/mongodb.rs` has 0 hits inside the aggregate body region (395-450); the only occurrence inside that span is the explanatory comment at L433 stating the call is "deliberately NOT called here". 
- `AC-04` WEAK PASS — Empty pipeline is forwarded verbatim to the driver; the driver's documented pass-through behaviour is the backstop. No direct test, but contract explicitly exempts a dedicated test (line 132). See F-002 for optional hardening.
- `AC-05` PASS — `validate_ns(db, collection)?;` is the first statement in the async block (`mongodb.rs:402`). Unit test `test_aggregate_rejects_empty_namespace` (L1052-1067) exercises both empty-db and empty-collection branches.
- `AC-06` PASS — `self.current_client().await?` at L404 returns `AppError::Connection("MongoDB connection is not established")` when no client is set (helper at L158-164). Unit test `test_aggregate_without_connection_returns_connection_error` (L1041-1050) verifies the error variant and message substring.
- `AC-07` PASS — `commands/document/query.rs:64-80` implements `aggregate_documents` with the exact dispatch shape from `find_documents`:
  1. `state.active_connections.lock().await`
  2. `.get(&connection_id).ok_or_else(|| not_connected(&connection_id))?` → `AppError::NotFound`.
  3. `.as_document()?` → bubbles `AppError::Unsupported` for non-Document adapters (handled in `ActiveAdapter::as_document`).
  4. `.aggregate(&database, &collection, pipeline).await`.
- `AC-08` PASS — `src-tauri/src/lib.rs:52` registers `commands::document::query::aggregate_documents`, placed directly after `find_documents` as required.
- `AC-09` PASS — New unit tests `test_aggregate_without_connection_returns_connection_error` (L1041-1050) and `test_aggregate_rejects_empty_namespace` (L1052-1067) are present; `grep aggregate_returns_unsupported src-tauri/src/db/mongodb.rs` → 0 matches (stub test deleted). Both new tests green in `cargo test --lib db::mongodb` output.
- `AC-10` PASS — `tests/mongo_integration.rs:314-394` adds `test_mongo_adapter_aggregate_match_sort` (fixture seeded, `$match + $sort` pipeline, `rows.len() == 2`, `_id asc` checked via `raw_documents.get_i32("_id")`), and L402-495 adds `test_mongo_adapter_aggregate_group_count` (`$group` → single row, robust `total`-cell parsing that accepts Int32/`$numberInt`/`$numberLong`/bare integer). Both tests are annotated `#[serial_test::serial]` and follow the seed→assert→drop→disconnect pattern. Docker container is live so these actually executed (5 passed; 0 filtered).
- `AC-11` PASS — `git diff --stat HEAD -- src/` is empty in this working tree. `pnpm tsc --noEmit` 0 errors, `pnpm lint` 0 errors.
- `AC-12` PASS — All six Verification-Plan checks above returned clean status.

## Missing Evidence

- None of the required evidence fields (changed files list, 6-check results, AC→test mapping, file:line ranges, invoke_handler line, diff invariant) are missing; only minor inaccuracies (F-003). The generator exceeded the contract on verification quality by running Docker MongoDB and actually executing the integration tests rather than skipping them.

## Residual Risk

- Large-aggregate-result memory pressure: `raw_documents: Vec<Document>` collects the full cursor into memory. Out of scope per contract Out-of-Scope line 45, but Sprint 73 frontend must surface a `$limit`-encouraging hint to the user.
- Side-effect stages (`$out`, `$merge`, `$indexStats`): driver will run them server-side and the cursor yields nothing, so the grid lands empty. No client-side guard yet — Sprint 80 MQL Preview is the planned owner.
- Cursor iteration error message changed tense ("aggregate cursor iteration failed" vs. find's "cursor iteration failed"). Contract design bar (line 75) suggested wrapping errors as `"aggregate failed: {e}"`; the builder call at L410 uses exactly that, and the cursor-iteration wrapper is a more descriptive superset — fine, but if a consumer later grep-matches on the exact string, they need to know this branch exists.

## Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Correctness | 9/10 | Implementation mirrors `find` down to the `Instant::now()` placement, helper reuse, and error-wrapping tense; `validate_ns` is the first line; `current_client` returns Connection error; `total_count = rows.len() as i64`; no hidden `estimated_document_count` call; `rows.len()` read happens before `rows` is moved into the result struct (no borrow/move issue). Minor doc-comment drift (F-001) keeps this from a perfect 10. |
| Completeness | 9/10 | All 12 AC satisfied with concrete code evidence. Two unit tests + two integration tests added; stub test removed; Tauri command registered. Only gap is the lack of a direct empty-pipeline integration test (F-002), which the contract itself marks optional. |
| Reliability | 8/10 | Error paths are uniform: Validation on empty ns, Connection on no client, Database for driver failures, and a distinct "aggregate cursor iteration failed" wrapper for per-document cursor errors. No `unwrap()` leaked outside tests; helpers reused verbatim so no divergence between find and aggregate flattening rules. Slightly below 9 because none of the tests cover driver-side aggregate errors (e.g. malformed `$match` doc producing a server error) — those would strengthen the reliability story but are not required by contract. |
| Verification Quality | 9/10 | Ran the full 6-check profile plus orchestrator `cargo test --lib` (216) and live Docker integration (5 integration tests, 2 new ones actually hitting the pipeline). Evidence packet in `handoff.md` has minor line-range drift (F-003) and the "병렬 Sprint 74 diff" warning is stale in this working tree, but the substantive evidence matches the files. |
| **Overall** | **8.75/10** | Every dimension ≥ 7 → rubric PASS threshold met. |

## Verdict: PASS

## Feedback for Generator

1. **Doc-comment hygiene**: Update `mongodb.rs:866` "remaining four stubs" → "remaining three stubs" in the same commit that lifted the fourth stub. Sprint 66 introduced the four-count comment, Sprint 72 lifts `aggregate` and should decrement the counter.
   - Current: `// Unsupported path; the remaining four stubs keep their regression`
   - Expected: `// Unsupported path; the remaining three stubs keep their regression`
   - Suggestion: Whenever a stub is promoted to a real implementation, grep the module for the arithmetic phrase (`remaining N stubs`, `N still-stubbed`) and decrement.

2. **AC-04 empty-pipeline test** (optional hardening, not blocking):
   - Current: Empty pipeline is only exercised indirectly through the connection-error unit test.
   - Expected: A single integration test `test_mongo_adapter_aggregate_empty_pipeline_returns_full_collection` would directly prove pass-through.
   - Suggestion: Copy the seed block from `test_mongo_adapter_aggregate_match_sort`, replace pipeline with `Vec::new()`, assert `result.rows.len() == 3` and `result.total_count == 3`. Estimated 20 lines; would raise AC-04 from WEAK PASS to PASS.

3. **Handoff line-range drift**:
   - Current: `handoff.md` cites `mongodb.rs:395-448`, `query.rs:58-76`, etc. — all off by 2-6 lines.
   - Expected: Line ranges should match the file as persisted.
   - Suggestion: After the final `cargo fmt --check` pass, re-run `rg -n "fn aggregate|pub async fn aggregate_documents|test_aggregate_"` and paste the output ranges into the handoff.

4. **Residual stale note in handoff** (minor):
   - Current: Handoff mentions a "병렬 Sprint 74 agent" diff in `src/components/datagrid/**` that could confuse the evaluator.
   - Expected: If no such diff exists on the reviewed working tree, the note should be struck.
   - Suggestion: Either (a) actually show the `git diff --stat HEAD -- src/` output at handoff time, or (b) remove the paragraph when the parallel agent's diff is not present.
