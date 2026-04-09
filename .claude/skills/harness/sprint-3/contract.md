# Sprint Contract: Sprint 3

## Summary

- Goal: Upgrade the 2-state (null/ASC) column sort to a 3-state toggle (null -> ASC -> DESC -> null) so users can sort data in both ascending and descending order, with visual indicators for each direction.
- Audience: Claude Code agent (Generator/Evaluator)
- Owner: Felix
- Verification Profile: `mixed` (command + static)

## In Scope

- `src/components/DataGrid.tsx`: Replace `sortColumn: string | null` state with `sort: { column: string; direction: "ASC" | "DESC" } | null`. Update `handleSort` to 3-state cycle logic (unsorted -> ASC -> DESC -> unsorted). Update column header rendering to show directional indicators. Update toolbar text to include direction.
- `src/lib/tauri.ts`: No signature change needed; `orderBy` parameter already accepts `string | undefined` and will now receive `"column_name ASC"` or `"column_name DESC"`.
- `src/stores/schemaStore.ts`: No signature change needed; pass-through of `orderBy` string already works.
- `src-tauri/src/db/postgres.rs`: Modify `query_table_data` ORDER BY clause to parse `"column_name ASC"` or `"column_name DESC"` from the `order_by` parameter instead of hardcoding ASC. Validate column name and direction token.
- `src-tauri/src/commands/schema.rs`: No change needed; `order_by: Option<String>` already passes through.

## Out of Scope

- Multi-column sorting (only single-column sort is supported)
- Persisting sort state across table switches (already resets)
- Changes to SQLite or MySQL adapters (only PostgreSQL is wired up)
- Filter-related changes
- Query editor or other UI components
- Adding new Tauri command parameters (use string-based approach in existing `order_by`)

## Invariants

1. `cargo clippy --all-targets --all-features -- -D warnings` passes with zero warnings
2. `cargo test` passes (currently 49 tests)
3. `pnpm test` passes (currently 29 tests)
4. `pnpm build` succeeds with no TypeScript errors
5. No `any` types in TypeScript code
6. SQL injection prevention maintained: column name validated against actual table columns in Rust; direction token validated against whitelist (`"ASC"` | `"DESC"`)
7. Page resets to 1 on sort change (existing behavior preserved)
8. Default sort direction when only a column name is passed remains ASC (backward compatible)

## Acceptance Criteria

- `AC-01`: Clicking a column header cycles through: unsorted -> ASC -> DESC -> unsorted. First click on any column sets ASC. Second click on same column sets DESC. Third click clears sort. Clicking a different column while sorted resets to ASC on the new column.
- `AC-02`: Column headers display a visual sort indicator: triangle-up (▲ / `&#9650;`) for ASC, triangle-down (▼ / `&#9660;`) for DESC. Unsorted columns show no indicator.
- `AC-03`: DataGrid toolbar shows active sort with direction, e.g., "Sorted by id ASC" or "Sorted by id DESC". No sort indicator shown when unsorted.
- `AC-04`: Rust backend `query_table_data` in `postgres.rs` parses `order_by` string as either `"column_name"` (defaults to ASC) or `"column_name ASC"` / `"column_name DESC"`. Invalid direction tokens are rejected (sort is not applied). Column name is validated against actual table columns (existing behavior).
- `AC-05`: All existing tests pass (`cargo test` + `pnpm test`) with no regressions.

## Design Bar / Quality Bar

- The `order_by` string is parsed in Rust by splitting on whitespace: first token is the column name (validated against table schema), second token (if present) is the direction (validated against `["ASC", "DESC"]` whitelist). No raw string interpolation into SQL for the direction token; it is matched against the whitelist.
- Frontend sort state uses a structured object `{ column: string; direction: "ASC" | "DESC" }` rather than encoding direction into a string, keeping TypeScript type safety.
- The `orderBy` value sent to Tauri is constructed as `"${column} ${direction}"` in `fetchData`, maintaining backward compatibility with the existing `Option<String>` parameter.

## Verification Plan

### Required Checks

1. `cargo clippy --all-targets --all-features -- -D warnings` -- zero warnings
2. `cargo test` -- all 49 tests pass
3. `pnpm test` -- all 29 tests pass
4. `pnpm build` -- succeeds with no errors

### Required Evidence

- Generator must provide:
  - changed files with purpose
  - checks run and outcomes (full command output)
  - acceptance criteria coverage with concrete evidence (code snippets showing each AC is met)
- Evaluator must cite:
  - concrete evidence for each pass/fail decision on every AC
  - any missing or weak evidence as a finding

## Test Script / Repro Script

1. Run `cd /Users/felix/Desktop/study/view-table/src-tauri && cargo clippy --all-targets --all-features -- -D warnings 2>&1` -- must exit 0
2. Run `cd /Users/felix/Desktop/study/view-table/src-tauri && cargo test 2>&1` -- must show 49 passed, 0 failed
3. Run `cd /Users/felix/Desktop/study/view-table && pnpm test 2>&1` -- must show 29 passed, 0 failed
4. Run `cd /Users/felix/Desktop/study/view-table && pnpm build 2>&1` -- must exit 0
5. Static verification: inspect `DataGrid.tsx` for 3-state cycle logic (`handleSort`), directional indicators (▲/▼), and toolbar text including direction
6. Static verification: inspect `postgres.rs` for direction parsing from `order_by` string with whitelist validation

## Ownership

- Generator: Claude Code agent
- Write scope: `src/components/DataGrid.tsx`, `src-tauri/src/db/postgres.rs`
- Merge order: Rust changes first (backend), then TypeScript changes (frontend)

## Exit Criteria

- Open P1/P2 findings: 0
- Required checks passing: yes
- All 5 acceptance criteria evidenced in implementation
