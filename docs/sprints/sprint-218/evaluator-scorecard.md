# Sprint 218 — Evaluator Scorecard

## Verdict: PASS

`QueryTab.test.tsx` (2,308 lines / 80 cases) → 6 axis test files + 1 shared
helper. All 18 contract checks pass; all 5 acceptance criteria met; all 24
verbatim AC strings preserved with exactly 1 match each; behaviour change 0
(`QueryTab.tsx` + 6 sub-files + 11 sibling tests + `MainArea.tsx` all
diff-stat 0). The implementation faithfully follows Sprint 216 (P11 step 1)
model — option 1 (entry removal) + option B (Sprint 188 nested preserved).

## Dimensions

- **Correctness: 9/10** — Behaviour-preserving split is byte-equivalent at
  the case-text level (all 80 `it("...")` strings sort-diff to empty against
  HEAD entry). 7 `vi.mock` factories inlined module-level in each axis file
  (not hoisted via helper, respecting the documented ES-hoisting constraint).
  Sprint 188 nested describe preserved verbatim with `localStorage.removeItem(SAFE_MODE_STORAGE_KEY)`
  + `useSafeModeStore.setState({ mode: "strict" })` setup. Helper file is
  pure named exports (12), no `vi.mock` calls, no default export. Minor
  deduction (-1) only because helper export count (12) exceeds spec.md
  AC-03 headline range "8-10" — though the breakdown explicitly enumerates
  all 12 items, so this is a spec ambiguity, not a defect (see F-001 below).

- **Completeness: 9/10** — All 5 AC pass with concrete evidence. All 10
  Global AC cleared. The 6 axis files cover every Sprint section: 25 / 34
  / 36 / 53 / 73 / 82 / 83 / 84 / 85 / 132 / 188. Case totals match per-axis
  recommendations exactly except `execution: 17` (recommended 13-16, +1 over
  upper bound) — Generator's residual-risk note correctly flags this as a
  semantic-cohesion choice (Format-SQL + Uglify both window-event SQL
  transforms), and 17 ⊂ AC-02's hard cap [5, 25].

- **Reliability: 10/10** — `pnpm vitest run src/components/query/QueryTab*.test.tsx`
  exit 0 / 6 files / 80 passed. `pnpm vitest run` (full project) exit 0 /
  199 files (∈ [197, 200]) / 2720 tests. `pnpm tsc --noEmit` exit 0.
  `pnpm lint` exit 0. No `it.only` / `it.skip` (0 matches across all 6 axis
  files). No silent `catch{}` (0 matches in axis files + helper). No new
  `eslint-disable*` (0 matches in `git diff src/components/query/`).
  `mockReset()` pattern preserved in `resetQueryTabStores`; worker-isolation
  + module-level `vi.fn()` instances → no cross-axis leakage.

- **Verification Quality: 9/10** — `findings.md` cites every contract check
  with concrete numbers and per-string match counts. Generator's
  self-reported numbers all matched independent re-execution exactly: 6
  files, 80 cases, 199 / 2720 / 12 exports / 6 imports / 7 factories per
  axis / 2 describe blocks in document axis. The single `findings.md`
  ambiguity (helper count vs "8-10") is correctly flagged as residual risk
  with a documented mitigation path. Minor deduction (-1) because Generator
  did not call out an alternative reading of the spec range upfront in the
  brief; it surfaced only in residual-risk after the fact.

## Findings

- **F-001 (P3)** — Helper export count is **12**, while spec.md AC-03
  headline says "named export 8-10". The breakdown immediately below the
  headline enumerates 5 mocks + 1 prop snapshot + 2-3 fixture builders + 2
  fixture constants + 1 reset = 11-12, so 12 actually matches the
  breakdown's upper bound. The spec is internally inconsistent. Generator
  chose the maximum breakdown sum (5 + 1 + 3 + 2 + 1 = 12), elevating
  `MOCK_DOC_RESULT` and `makeDocTab` from inline to helper because they are
  shared by 3 axis files (history / dialect / document). Code-duplication
  argument is sound; this is a spec-defect, not an implementation defect.
  No action needed — recommend updating spec template for future sprints.

- **F-002 (P3)** — `execution` axis carries 17 cases vs spec recommendation
  13-16 (+1 over the upper bound). 17 ⊂ AC-02 hard cap [5, 25]; spec.md
  also explicitly grants generator ±2 case discretion. Generator's
  rationale (Format-SQL + Uglify are both window-event SQL transforms,
  splitting them creates a 5-case orphan axis) is sound. No action needed.

## AC Pass/Fail

- **AC-01: PASS** — `pnpm vitest run src/components/query/QueryTab*.test.tsx`
  exit 0 / 6 test files / 80 passed (verified by independent re-run, 2.08s
  duration). Pre-sprint `git show HEAD:.../QueryTab.test.tsx | grep -cE '^\s+it\('`
  = 80 confirms baseline; option 1 (entry removed) means post = exactly 80
  via 8 + 5 + 17 + 16 + 11 + 23 = 80.

- **AC-02: PASS** — 6 axis files (∈ [4, 6]). Per-axis case counts
  lifecycle 8 / toolbar 5 / execution 17 / history 16 / dialect 11 /
  document 23 — each ∈ [5, 25]. 11 sibling tests + `MainArea.tsx` all
  `git diff --stat` = 0 (silent output verified).

- **AC-03: PASS** — `src/components/query/__tests__/queryTabTestHelpers.ts`
  exists (167 lines), 12 named exports verified by
  `grep -nE '^export (function|const)'` = 12. Default export 0. `vi.mock`
  call count in helper 0 (independently verified). External imports 6,
  matching axis-file count exactly. (See F-001 for spec ambiguity on
  the "8-10" vs "12" headline discrepancy.)

- **AC-04: PASS** — `test ! -f src/components/query/QueryTab.test.tsx` →
  REMOVED (option 1, recommended). `git diff --stat` shows the entry
  deleted (-2308 lines).

- **AC-05: PASS** — All 24 verbatim AC strings matched exactly 1 occurrence
  each (independent re-grep). Bracket-prefix strings 22-24 verified with
  `grep -F` and proper escape handling (`\\c` in source code preserved as
  `\\c`). Global AC 1-10 all met: behavior 0; 80 cases pre = post; 7 mock
  factories per axis; ARIA / data-* / mock-editor preserved; fixture data
  shape preserved; store seed pattern preserved; `QueryTabProps` frozen;
  no new `eslint-disable*` / silent catch / `it.only` / `it.skip`; vitest
  file count 199 ∈ [197, 200]; 11 sibling test + `MainArea.tsx` drift 0.

## 18 Check Results

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | `pnpm vitest run src/components/query/QueryTab*.test.tsx` exit 0 + 80 cases | PASS | exit 0 / 6 files / 80 passed (2.08s) |
| 2 | `pnpm vitest run` full + 199 files / 2720 tests | PASS | exit 0 / 199 files (∈ [197, 200]) / 2720 passed (39.76s) |
| 3 | `pnpm tsc --noEmit` exit 0 | PASS | exit 0 |
| 4 | `pnpm lint` exit 0 | PASS | exit 0 |
| 5 | Axis file count ∈ [4, 6] | PASS | `find -maxdepth 1 -name "QueryTab.*.test.tsx"` = 6 |
| 6 | Per-axis case ∈ [5, 25] + sum ∈ [75, 80] | PASS | 8 / 5 / 17 / 16 / 11 / 23 = 80 |
| 7 | `git diff --stat src/components/query/QueryTab.tsx` 0 | PASS | empty output |
| 8 | `git diff --stat src/components/query/QueryTab/` 0 | PASS | empty output |
| 9 | 11 sibling test diff 0 | PASS | empty output for all 11 paths |
| 10 | `git diff --stat src/components/layout/MainArea.tsx` 0 | PASS | empty output |
| 11 | New `eslint-disable*` 0 | PASS | `grep "^+.*eslint-disable"` = 0 |
| 12 | 24 verbatim strings ≥ 1 match each | PASS | All 24 strings = 1 match (3 bracket-prefix included; `\\c` escape preserved) |
| 13 | Entry option 1 — file removed | PASS | `test ! -f` true |
| 14 | Helper named export 8-10 | PASS* | 12 exports — F-001 (matches breakdown upper bound 5+1+3+2+1=12; spec headline "8-10" inconsistent with breakdown) |
| 15 | Helper external import ≤ axis count | PASS | 6 imports = 6 axis files |
| 16 | Axis `it.only` / `it.skip` 0 | PASS | 0 matches |
| 17 | Root describe per axis (document allows 2 for option B) | PASS | 1 / 1 / 1 / 1 / 1 / 2 — document.test.tsx Sprint 188 nested preserved |
| 18 | Each axis vi.mock factory ≥ 7 | PASS | 7 / 7 / 7 / 7 / 7 / 7 (sub-modules: `@lib/tauri`, `@lib/api/verifyActiveDb`, `./SqlQueryEditor`, `./MongoQueryEditor`, `./QueryResultGrid`, `@hooks/useSqlAutocomplete`, `@lib/sql/sqlUtils`) |

## Recommendations (PASS)

1. **Spec template fix for next P11 step (P11 step 3 / `tabStore.test.ts`)**: The
   "named export 8-10" headline + 5+1+(2-3)+2+1 breakdown are internally
   inconsistent. Update Planner template to either (a) drop the headline
   range and leave only the breakdown, or (b) state the headline as
   "named export 8-12" matching the breakdown sum range.

2. **Helper extraction pattern is reusable**: The Sprint 218 helper
   approach (5 mock + `mockEditorProps` snapshot + 3 fixture builders + 2
   constants + 1 reset; module-level inline `vi.mock` factories per axis;
   worker-isolation for shared `vi.fn()` instances) is a clean template.
   Consider documenting this in `memory/engineering/conventions/refactoring/memory.md`
   alongside Sprint 216's pattern for future test-axis splits.

3. **Residual risk acknowledgment**: The vitest worker-per-file isolation
   pattern + module-level `vi.fn()` shared instances depend on vitest pool
   config; if `vitest.config.ts` changes pool to `threads` with shared
   workers, this could break. No action needed today (config unchanged),
   but flag in `docs/archives/incidents/` for future config migrations.

4. **Sprint 218 commit message draft**: Mirror Sprint 216's commit message
   style — `refactor(QueryTab.test): 2308-line god file → 6 axis + 1 helper (Sprint 218)`
   ending with the Co-Authored-By line per project policy.

5. **Follow-up sprints**: P11 step 3 (`tabStore.test.ts` 2,234 lines), step
   4 (`StructurePanel.test.tsx` 2,156), step 5 (`DataGrid.test.tsx` 1,906)
   are the remaining candidates per `docs/archives/backlogs/refactoring-candidates-2026-05-06.md` §P11.
   Apply the same Sprint 216 / Sprint 218 model.
