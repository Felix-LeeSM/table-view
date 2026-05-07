# Sprint 229 — Evaluator Scorecard

Sprint: `sprint-229` (feature — Foreign Keys + CHECK + UNIQUE constraints
tab functional in `CreateTableDialog`).
Date: 2026-05-07.
Evaluator: harness Phase 4 (independent verification).

## Verdict: **PASS**

| Dimension          | Score | Weight | Notes |
|--------------------|-------|--------|-------|
| Correctness        | **9/10** | 35% | All 4 baseline checks (vitest, tsc, lint, cargo build/clippy) PASS. FK + CHECK + UNIQUE chain executes in correct order with correct atomic policy C semantics (`CreateTableDialog.tsx:792-815`). Re-throws as `Constraint "<name>" failed: <pg error>` (line 812), no rollback, no `dropConstraint` (`CreateTableDialog.test.tsx:2030`). |
| Completeness       | **9/10** | 25% | All 12 ACs covered. 14 new vitest cases + 10 new ForeignKeysTabBody cases (≥9+5 contract minimum). Backend Path A landed cleanly: `mutations.rs:560-604` FK arm extension + 3 new fixtures (`mutations.rs:1394-1470`). |
| Reliability        | **9/10** | 20% | Sprint 226+227+228 byte-equivalent fixtures intact: `composite_pk_byte_equivalent` PASS (verified). `add_constraint_preview_foreign_key` SQL string at `mutations.rs:1388` is byte-identical to Sprint 228 baseline; only the struct literal added 2 lines (`on_delete: None, on_update: None` at lines 1379-1380), exactly as the contract anticipated. Full vitest 218/218 files / 2819/2819 tests PASS. No silent catches, no `any`, no skipped tests, no eslint-disable. |
| Verification Quality | **9/10** | 20% | TDD red-state log credible (`tdd-evidence/red-state.log` shows 14+10 cases failed before implementation). Tests exercise behavior, not implementation: IPC sequence assertions (`mockAddConstraint.mock.calls[i][0].constraint_name`), preview-substring assertions (`previewPane.textContent.toContain('FOREIGN KEY ("order_id", "user_id") REFERENCES "orders" ("id", "line_no")')` at `CreateTableDialog.test.tsx:1612`), failure-surface assertions (line 2009), no-rollback assertion (line 2030). |
| **Overall**        | **9/10** | | All quality gates passed. |

## Independent Verification — 38 Contract Checks

| #  | Check | Result | Evidence |
|----|-------|--------|----------|
| 1  | `pnpm vitest run CreateTableDialog.test.tsx` | **PASS** | 52/52 (Sprint 228 baseline 38 + 14 new) — verified locally |
| 2  | `pnpm vitest run ForeignKeysTabBody.test.tsx` | **PASS** | 10/10 (≥5 required) — verified locally |
| 3  | `pnpm vitest run` (full suite) | **PASS** | 218 files / 2819 tests pass — verified locally |
| 4  | `pnpm tsc --noEmit` | **PASS** | exit 0 — verified locally |
| 5  | `pnpm lint` | **PASS** | exit 0 — verified locally |
| 6  | `cargo build` | **PASS** | exit 0 — verified locally |
| 7  | `cargo clippy -- -D warnings` | **PASS** | exit 0 — verified locally |
| 8  | `cargo test create_table` | **PASS** | mutations:: tests 89 passed (composite_pk_byte_equivalent intact at line 1689) |
| 9  | `cargo test create_index` | **PASS** | (covered in 89 mutations:: tests) |
| 10 | `cargo test add_constraint` | **PASS** | 12/12 (9 baseline + 3 new ON DELETE/UPDATE; existing FK fixture's emitted SQL byte-identical at line 1388) |
| 11 | freeze: `useDdlPreviewExecution.ts` | **= 0** | `git diff --stat` empty |
| 12 | freeze: `SqlPreviewDialog.tsx` | **= 0** | `git diff --stat` empty |
| 13 | freeze: cross-window suites | **= 0** | `git diff --stat` empty |
| 14 | freeze: `connectionStore.ts` / `schemaStore.ts` | **= 0** | `git diff --stat` empty |
| 15 | freeze: `tauri/ddl.ts` | **= 0** | `git diff --stat` empty |
| 16 | freeze: `src/components/ui/` | **= 0** | `git diff --stat` empty |
| 17 | freeze: `CreateTableTypeCombobox.tsx` | **NOT GENERATOR — 16 LOC orchestrator wheel-scroll hot-fix** | NOT scored — see "Hot-fix observation" below |
| 18 | freeze: `Header.tsx` | **= 0** | `git diff --stat` empty |
| 19 | freeze: `IndexesTabBody.tsx` | **= 0** | `git diff --stat` empty |
| 20 | `grep '"Available in Sprint 229"'` | **= 0 hits** | verified via grep |
| 21 | `grep '"Available in Sprint 228"'` | **= 0 hits** | verified via grep |
| 22 | `grep 'addConstraint' CreateTableDialog.tsx` | **2 hits** (lines 776 + 807) | verified |
| 23 | `grep 'addConstraint\|add_constraint' lib.rs` | **≥1 hit** | verified |
| 24 | `grep 'FOREIGN KEY\|REFERENCES' mutations.rs` | **5 hits** | verified |
| 25 | `grep 'ON DELETE\|ON UPDATE' mutations.rs` | **12 hits** (Path A landed) | verified |
| 26 | `grep 'SqlPreviewDialog' CreateTableDialog.tsx` | **0 hits** | (Generator handoff line 71 noted "1 jsdoc hit" but verified hit-count = 0 in current file. Resolution: PASS) |
| 27 | `grep 'it.only\|it.skip\|...'` test files | **= 0** | verified |
| 28 | `git diff \| grep '+.*eslint-disable'` | **= 0** | verified |
| 29 | `git diff \| grep '+.*\bany\b'` | **= 0** | verified |
| 30 | mongo path untouched | **= 0** | verified |
| 31 | vitest 0-constraint IPC byte-equivalent | **PASS** | `0-constraint IPC sequence is byte-equivalent to Sprint 228 (AC-229-10)` at CreateTableDialog.test.tsx (within Sprint 229 describe) |
| 32 | vitest happy-path IPC sequence | **PASS** | `Execute chains createTable + addConstraint × 3 sequentially with one history entry (AC-229-07)` at line 1830-1912 |
| 33 | vitest composite FK preview substring | **PASS** | line 1612 `expect(...).toContain('FOREIGN KEY ("order_id", "user_id") REFERENCES "orders" ("id", "line_no")')` |
| 34 | vitest CHECK preview substring | **PASS** | (AC-229-04 case) |
| 35 | vitest UNIQUE preview substring | **PASS** | (AC-229-05 case) |
| 36 | vitest constraint-failure-mid-chain abort | **PASS** | line 1916-2031 — 2nd commitConstraint rejects → 3rd not called → modal stays open → `chk_age` in preview pane → no `dropConstraint` |
| 37 | vitest reference table picker + lazy load | **PASS** | (AC-229-09 cases) |
| 38 | vitest canonical Safe Mode warn-cancel survives | **PASS** | (Sprint 227+228 invariant carry-over) |

**38/38 contract checks PASS** (excluding check 17 which is the orchestrator's hot-fix outside Generator scope).

## Spot-Checked ACs (5 deep reads)

### AC-229-01 — FK tab placeholder removed
- `grep '"Available in Sprint 229"' CreateTableDialog.tsx` = 0 hits (verified locally).
- `CreateTableDialog.test.tsx:502` rewritten test asserts `panel.textContent).not.toContain("Available in Sprint 229")` and 3 add buttons present.
- New AC-229-01 case at line 1448 redundantly asserts the same.
- Form interaction case at lines 1466-1502 (FK row renders all 7 inputs with correct aria-labels).

### AC-229-02 — Composite FK preview
- Substring assertion at `CreateTableDialog.test.tsx:1612` matches the contract verbatim: `'FOREIGN KEY ("order_id", "user_id") REFERENCES "orders" ("id", "line_no")'`.
- Payload assertion at lines 1604-1607 (`columns: ["order_id", "user_id"]` + `reference_columns: ["id", "line_no"]`) ensures the chain emits the columns in row-toggle order.

### AC-229-04 — Table-level UNIQUE preview
- AC-229-05 case (`table-level UNIQUE row preview shows ADD CONSTRAINT "<name>" UNIQUE ("col") (AC-229-05)`) at line 1683 asserts the substring.
- UNIQUE row inputs found in `ForeignKeysTabBody.test.tsx:151-157` (`Unique name`, `Unique column: id`, `Unique column: user_id` aria-labels).

### AC-229-07 — Chain executes table → indexes → constraints
- Closure at `CreateTableDialog.tsx:784-815` shows the exact contract sequence:
  ```ts
  await tauri.createTable(buildRequest(false));
  for (const idx of chainIndexes) { ... await tauri.createIndex(...) ... }
  for (const c of chainConstraints) { ... await tauri.addConstraint(...) ... }
  ```
- Sequence assertion at `CreateTableDialog.test.tsx:1815-1826` uses `inflight` counter to assert `maxConcurrent ≤ 1` (sequential, not parallel) at line 1901.
- 1 history entry assertion at lines 1903-1905. `onRefresh` once + `onClose` once at lines 1897-1898.

### AC-229-08 — Failure handling (no rollback)
- try/catch at `CreateTableDialog.tsx:805-813`:
  ```ts
  for (const c of chainConstraints) {
    try { await tauri.addConstraint(buildConstraintRequest(c, false)); }
    catch (e) { throw new Error(`Constraint "${c.name}" failed: ${String(e)}`); }
  }
  ```
- Test at `CreateTableDialog.test.tsx:1916-2031` asserts:
  - 2nd commit-time `addConstraint` rejects (line 1935) → 3rd not called (commitCalls.length === 2 at line 2017).
  - Modal stays open (`onClose).not.toHaveBeenCalled()` at line 2029).
  - No rollback (`mockDropConstraint).not.toHaveBeenCalled()` at line 2030).
  - Failing constraint name `chk_age` surfaces in preview pane (line 2009).
  - `createTable` was not re-run / rolled back (`toHaveBeenCalledTimes(2)` = 1 preview + 1 commit, line 2026).

## Sprint 226+227+228 Byte-Equivalent Verification

- **Sprint 226 `composite_pk_byte_equivalent`**: PASS (verified via `cargo test composite_pk_byte_equivalent` — 1 passed, mutations.rs:1689).
- **Sprint 227 comment fixtures** (`*_zero_comment_byte_equivalent_to_sprint_226`, `*_two_columns_one_comment_byte_equivalent`, `*_single_quote_escape_byte_equivalent`, `*_whitespace_comment_emits_no_statement`, `*_comment_with_semicolon_does_not_split`): PASS (lines 1893-2016, all in 89-pass mutations:: run).
- **Sprint 228 `create_index_*_byte_equivalent` fixtures** (gin, gist, btree, hash_non_unique, multi_column, all_types, invalid_*): PASS (lines 1060-1276).
- **Sprint 228 `add_constraint_preview_foreign_key`**: PASS — emitted SQL string at `mutations.rs:1388` is byte-identical to Sprint 228; struct literal at lines 1379-1380 added exactly 2 lines (`on_delete: None, on_update: None`), as the contract design-bar at lines 152 anticipated.

## Generator Scope Addition: `useFkReferencePicker.ts` — Justified

The Generator added a new file `src/hooks/useFkReferencePicker.ts` (61 LOC) that was NOT in the contract's "In Scope" list.

**Justification verified:**
1. `eslint.config.js:81-104` enforces `no-restricted-syntax` against `getState()` calls in `src/**/*.tsx` files (rule added 2026-05-05). The rule explicitly tells callers to extract such calls into `src/hooks/* lifecycle hook`.
2. The contract pre-flight (Design Bar lines 129-130) says the FK reference table picker reads `useSchemaStore.getState().tables[<conn>:<refSchema>]` and may call `loadTables` on demand.
3. Two rules conflict; the only legal resolution is exactly what the Generator did — extract a tiny lifecycle hook in `src/hooks/`.
4. Sprint 219+223+224 hook-extraction precedents make this a recognized pattern.
5. The hook is 61 LOC, has no state, exposes only the existing schema-store API surface, and the schema store body itself stays unchanged (Sprint 224 freeze preserved — verified `git diff --stat src/stores/schemaStore.ts` = 0).

**Verdict: justified scope addition, not scope creep.**

## Hot-Fix Observation: `CreateTableTypeCombobox.tsx`

The orchestrator made a 16-line wheel-scroll hot-fix to `CreateTableTypeCombobox.tsx` (`+9/-7`) AFTER Generator completion. This is OUTSIDE Sprint 229 contract scope and NOT scored against Sprint 229.

**Regression risk assessment (informational):**
- The change adds `onWheel={(e) => e.stopPropagation()}` on the PopoverContent + mirrors `style={{ maxHeight: 240, overflowY: "auto" }}` on BOTH PopoverContent and the inner `<ul>` + restructures padding (PopoverContent `p-0` + ul `p-1`).
- **Risk: LOW.** The change is purely a presentational/event-bubbling fix. It does not alter component contract (props, aria-labels, callbacks). Sprint 227 `CreateTableTypeCombobox.test.tsx` cases pass (covered in the 218/218 file count from `pnpm vitest run`).
- **Concern: P3.** The duplicate `style={{ maxHeight: 240, overflowY: "auto" }}` on both layers is defensive — if a future Tailwind cn-merge changes, only one layer might break. Document as known design tradeoff (see Concerns below).

## Top 3 Concerns

### P2 — `ForeignKeysTabBody.tsx` is 608 LOC vs contract estimate 280 LOC
- **Current**: file is 2.2× larger than the contract's "~280 LOC" estimate.
- **Reasoning**: 3 sub-sections × per-row JSX (FK row alone has 7 inputs) inflated the file.
- **Risk**: maintainability — Sprint 230 reorder polish will need to touch this file. If reorder buttons land per-sub-section, the file may further grow toward 800-900 LOC.
- **Suggestion**: Sprint 230 should consider extracting `ForeignKeyRow.tsx` / `CheckRow.tsx` / `UniqueRow.tsx` per-row sub-components if it grows further.

### P3 — Constraint name auto-suggest only at chain-assembly time, not as placeholder
- **Current**: empty input → chain uses `fk_<table>_<cols>` / `chk_<table>_<n>` / `uq_<table>_<cols>` at assembly time. The user sees an empty `<input>`.
- **Risk**: UX — user is unsure what name will be used until they Show DDL.
- **Suggestion**: Sprint 230 polish — surface the auto-name as `placeholder` text on the `<input>`. The Generator considered this (findings.md §1) and chose chain-assembly-time fallback to keep single source of truth; placeholder would duplicate logic.

### P3 — Wheel-scroll hot-fix duplicates `maxHeight/overflowY` style on two layers (NOT GENERATOR'S SCOPE)
- **Current**: orchestrator's hot-fix mirrors `style={{ maxHeight: 240, overflowY: "auto" }}` on both `<PopoverContent>` and inner `<ul>` (CreateTableTypeCombobox.tsx:200, 214).
- **Risk**: LOW — defensive duplication. If tailwind cn-merge breaks one layer, the other still scrolls. But it muddies "single source of truth" for the scroll surface.
- **Suggestion**: Track in `docs/RISKS.md` as `deferred`. Re-evaluate after a Sprint 230 e2e smoke if e2e is revived.

## Feedback for Generator: NONE (PASS)

All 12 ACs covered with concrete evidence. All 38 contract checks PASS (excluding check 17, which the orchestrator handled outside Sprint 229 scope). Sprint 226+227+228 byte-equivalence preserved exactly as the contract anticipated. TDD evidence credible. Tests exercise behavior, not implementation details.

## Ready to Commit: **YES**

The implementation is production-grade and meets all Sprint 229 acceptance criteria.
