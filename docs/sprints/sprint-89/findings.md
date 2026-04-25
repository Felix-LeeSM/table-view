# Sprint 89 Scorecard

| Dimension | Score | Notes |
|---|---|---|
| Correctness | 9/10 | `format_fk_reference` (postgres.rs:33) is a single-source serializer matching `parseFkReference` (DataGridTable.tsx:54). Both FK queries now select 4 columns and synthesize the wire format in Rust (lines 728-751 and 833-875). 4 cargo unit tests + 1 fixture round-trip (lines 2935-2996) and a TS round-trip block (parseFkReference.test.ts:89-102) prove no drift. AC-04 integration test validates the exact 4-tuple `("public","users","id","42")` (fk-navigation.test.tsx:102). |
| Completeness | 9/10 | All 5 ACs satisfied with cited evidence (see AC Verification). 5 TS unit tests + 1 round-trip; 4 RTL integration tests; 4 Rust unit tests. `// TODO regression(sprint-89)` count is 0 in `src/`. |
| Reliability | 8/10 | docstring on `format_fk_reference` (postgres.rs:16-32) explicitly documents input assumptions (no `.`/`(`/`)` in identifiers) — escape policy is acknowledged as out-of-scope rather than silently broken. Negative tests cover `"users.id"` (no parens) and `""` (empty) → `null`. NULL-cell and non-FK column tests assert zero-button rendering. |
| Verification Quality | 9/10 | All 8 required checks executed and pass: vitest 1632/1632, tsc clean, lint clean, cargo test 0 failures (227 incl. 4 new), clippy 0 warnings, grep for `TODO regression(sprint-89)` returns 0, parseFkReference export present at line 54, fixture round-trip both directions pass. Sprint-88 invariants (fixture JSON, helper, catch-audit, mysql/sqlite, DataGrid.tsx) all show 0-line diff. |
| Sprint Hygiene | 9/10 | Scope respected: only the 4 in-scope files modified plus 1 new test file. No MySQL/SQLite/DataGrid.tsx writes. Sprint-88 fixture, expectNodeStable, catch-audit untouched. Pre-existing worktree mods (`memory/lessons/memory.md`, `.claude/rules/test-scenarios.md`, `ConnectionDialog.tsx`) are not Generator-attributable per F-1 / orchestrator note. |

**Overall**: 9/10
**Verdict**: PASS

## AC Verification

- **AC-01** PostgreSQL adapter emits `<schema>.<table>(<column>)` via a pure Rust function. Evidence:
  - `format_fk_reference(schema, table, column) -> String` defined at `src-tauri/src/db/postgres.rs:33-35` with docstring lines 16-32 documenting purpose, sprint-88 link, and input assumptions.
  - FK query #1 (single-table path) at lines 728-741 now selects 4 columns (`kcu.column_name, ccu.table_schema, ccu.table_name, ccu.column_name`); join updated to `tc.table_schema = ccu.table_schema` (line 734); mapping at lines 743-751 calls `format_fk_reference`.
  - FK query #2 (whole-schema path) at lines 833-848 mirrors the same restructuring; mapping at lines 867-875.
  - 3 unit tests (postgres.rs:2935-2959) cover happy path, underscored identifiers, and special chars; 1 fixture round-trip test (lines 2961-2996) iterates every sample and asserts `expected` equality, with explicit `samples.len() >= 3` guard.
  - Cargo run: 4 passed, 0 failed.

- **AC-02** `parseFkReference` exported from `DataGridTable.tsx`; round-trip vs. shared fixture in both CIs. Evidence:
  - Export at `src/components/datagrid/DataGridTable.tsx:54-60`, `export function parseFkReference(ref: string): { schema; table; column } | null`.
  - Test imports it: `parseFkReference.test.ts:24` `import { parseFkReference } from "@/components/datagrid/DataGridTable";`. Sprint-88 inline regex copy is gone.
  - Round-trip block at lines 89-102 iterates `fixture.samples`, asserts `>= 3` count, and verifies `parseFkReference(sample.expected)` equals `{schema, table, column}`.
  - Rust mirror lives at postgres.rs:2961-2996 reading the same `tests/fixtures/fk_reference_samples.json` via `include_str!` — both halves cover the same JSON.

- **AC-03** FK icon visible without hover, brightens on hover, hidden for non-FK / NULL cells. Evidence:
  - `DataGridTable.tsx:810` className: `"shrink-0 opacity-40 transition-opacity group-hover/cell:opacity-100 text-muted-foreground hover:text-foreground"`. Pre-sprint-89 `invisible group-hover/cell:visible` is gone.
  - Conditional render guard at lines 802 (`{fkRef && onNavigateToFk && (`) — gated by truthy `fkRef`, which itself is null when `col.fk_reference` is null (line 589 `parseFkReference(col.fk_reference)`); the `cell == null` branch at line 789 emits `<span>NULL</span>` and never reaches the icon block (line 793 `: (`).
  - RTL guard at `fk-navigation.test.tsx:152-156` asserts `className` contains `opacity-40` and `group-hover/cell:opacity-100` and does NOT contain `invisible`.

- **AC-04** Click dispatches `onNavigateToFk(schema, table, column, cellValue)` with correct 4-tuple. Evidence:
  - `fk-navigation.test.tsx:101-102`: `expect(onNavigateToFk).toHaveBeenCalledTimes(1); expect(onNavigateToFk).toHaveBeenCalledWith("public", "users", "id", "42");`. The fixture row uses `user_id = 42` and column `fk_reference = "public.users(id)"`.
  - NULL cell zero-button case at lines 105-115 (only 1 button across 2 rows because row 2 has `null`).
  - Non-FK column zero-button case at lines 117-139 (`screen.queryByRole(...) → null`).
  - Wiring in production: `DataGridTable.tsx:813-821` calls `onNavigateToFk(fkRef.schema, fkRef.table, fkRef.column, String(cell))`.

- **AC-05** Sprint-88 regression-first test flipped, `// TODO regression(sprint-89)` retired, fixture passes both sides. Evidence:
  - `Grep "TODO regression\(sprint-89\)" src/` → no matches.
  - `parseFkReference.test.ts` rewritten in place: header comment lines 1-21 explicitly narrates the flip from "returns null" pinning to live assertions; the 5 unit tests assert real parse results (lines 51-86) plus 2 negative cases. Round-trip block (lines 89-102) consumes the fixture.
  - Rust round-trip test at `postgres.rs:2961-2996` consumes the same fixture (line 2967 `include_str!("../../../tests/fixtures/fk_reference_samples.json")`).
  - Both sides green: vitest 1632/1632; cargo test 4/4 in `format_fk_reference_*`.

## Findings

- **F-89-1 (info)** Pre-existing worktree modifications outside sprint-89 scope are present (`memory/lessons/memory.md`, `.claude/rules/test-scenarios.md`, `src/components/connection/ConnectionDialog.tsx`). These predate the sprint and were already accounted for in sprint-88 finding F-1; `git diff` shows none of them were touched by the Generator's sprint-89 changes (they're modified-but-unstaged from earlier work). Not a regression for this sprint.

- **F-89-2 (info)** `format_fk_reference`'s docstring (postgres.rs:26-32) correctly notes that identifiers containing `.`, `(`, or `)` are not escaped. The TS regex `^(.+)\.(.+)\((.+)\)$` is greedy on each segment and would mis-split such identifiers, but the fixture deliberately exercises only safe charsets (hyphens, underscores, spaces). Escape policy is documented as out-of-scope per the contract's Edge Cases note — a follow-up sprint can quote/escape on both sides if real-world identifiers demand it.

- **F-89-3 (info)** `cargo test` showed an `i` (ignored) line in one suite — confirmed pre-existing (unrelated to sprint-89). Not a regression.

## Required Checks Summary

| # | Check | Result |
|---|---|---|
| 1 | `pnpm vitest run` | 89 files / 1632 tests passed (sprint-88 1625 + 7) |
| 2 | `pnpm tsc --noEmit` | exit 0 |
| 3 | `pnpm lint` | exit 0 |
| 4 | `cargo test` | 0 failures across all suites; `format_fk_reference_*` 4/4 pass |
| 5 | `cargo clippy --all-targets --all-features -- -D warnings` | exit 0 |
| 6 | `grep -rn "TODO regression(sprint-89)" src/` | 0 matches |
| 7 | `grep -n "export.*parseFkReference" DataGridTable.tsx` | line 54 |
| 8 | Fixture round-trip both directions | TS (parseFkReference.test.ts:89-102) + Rust (postgres.rs:2961-2996) both green |

## Invariant Verification

| Invariant | Status |
|---|---|
| `tests/fixtures/fk_reference_samples.json` unchanged | git diff = 0 |
| `src/__tests__/utils/expectNodeStable.ts` unchanged | git diff = 0 |
| `.claude/rules/test-scenarios.md` unchanged by sprint-89 | pre-existing sprint-88 mod (F-89-1) |
| `docs/sprints/sprint-88/` unchanged | git diff = 0 |
| `src-tauri/src/db/mysql.rs` unchanged | git diff = 0 |
| `src-tauri/src/db/sqlite.rs` unchanged | git diff = 0 |
| `src/components/DataGrid.tsx` unchanged | git diff = 0 |
| `CLAUDE.md` unchanged | git diff = 0 |
| `memory/` unchanged by sprint-89 | only pre-existing F-89-1 mod |

All sprint-88 invariants satisfied.
