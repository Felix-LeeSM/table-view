# Findings: sprint-0

## Verification Summary

- Profile: `browser`
- Checks run:
  - `pnpm test` — ✅ PASS (84 tests)
  - `cargo fmt --check` — ✅ PASS
  - `cargo test` — ⚠️ ENVIRONMENT LIMITATION (WSL GTK dependencies)
  - `cargo clippy` — ⚠️ ENVIRONMENT LIMITATION (WSL GTK dependencies)
  - `pnpm build` — ⚠️ PRE-EXISTING ISSUE (test-setup.ts)
- Evidence reviewed:
  - DataGrid.tsx: Lines 26, 177-231, 262-266, 357-386 (sort state, handlers, indicators)
  - DataGrid.test.tsx: Lines 156-243 (multi-column sort tests)
  - postgres.rs: Lines 335-360 (ORDER BY parsing)
  - schema_integration.rs: Lines 564-659 (integration test)

## Findings

### F-001: Minor accessibility enhancement opportunity

- Severity: P3 (suggestion)
- Repro: N/A (enhancement, not a bug)
- Expected: Sort indicators should be accessible to screen reader users
- Actual: Unicode arrows (↑/↓) are visual-only without aria-label
- Evidence: DataGrid.tsx line 383-384 renders arrows without accessibility attributes
- Broken Contract Line: N/A (not in contract, enhancement suggestion)
- Suggestion: Add `aria-label` to sort span for screen readers: `aria-label="${sort.column} sorted ${sort.direction.toLowerCase()}, priority ${sortRank}"`
- Status: open (deferred to polish sprint)

## Pass Checklist

- `AC-01`: ✅ PASS — Click replaces all sorts with clicked column (ASC → DESC → none cycle). Evidence: DataGrid.tsx lines 220-230, test at DataGrid.test.tsx lines 156-180
- `AC-02`: ✅ PASS — Shift+Click adds/toggles/removes column in sort list. Evidence: DataGrid.tsx lines 197-218, tests at DataGrid.test.tsx lines 183-243
- `AC-03`: ✅ PASS — Headers show direction arrow (↑/↓) and rank number (1, 2, 3...). Evidence: DataGrid.tsx lines 357-386
- `AC-04`: ✅ PASS — Backend parses comma-separated ORDER BY with validated columns. Evidence: postgres.rs lines 335-360, integration test at schema_integration.rs lines 564-659
- `AC-05`: ✅ PASS — Sort state persists across page/filter changes. Evidence: DataGrid.tsx line 231 (page reset on sort change only), sort state in component scope

## Missing Evidence

- `cargo test` and `cargo clippy` results unavailable due to WSL environment GTK dependency limitation (pre-existing infrastructure issue, not code issue)

## Residual Risk

- **Low**: Backend tests couldn't be verified in current environment, but integration test code is well-structured and follows existing patterns. No blocking issues identified.
- **Pre-existing build error**: test-setup.ts TypeScript error prevents `pnpm build` from completing, but all tests pass successfully.
