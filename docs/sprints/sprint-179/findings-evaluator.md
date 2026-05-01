# Sprint 179 — Evaluator Scorecard (Attempt 1)

Evaluator: Opus 4.7
Date: 2026-04-30
Verification Profile: `mixed` (command + static; browser smoke fallback to Vitest per contract)

---

## Sprint 179 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Correctness** (35%) | **9/10** | Dictionary is `Record<Paradigm, ParadigmVocabulary>` with all 4 paradigms × all 7 keys; `getParadigmVocabulary(undefined)` correctly resolves to `rdb`; `StructurePanel` and `ColumnsEditor` both honor `paradigm` prop; `DOCUMENT_LABELS` derivation preserves literal output byte-for-byte. RDB callers see no behavior change (test diff is purely additive). Aria-label sentence-case derivation correctly preserves the legacy `name: "Add column"` accessibility-name match. |
| **Completeness** (25%) | **8/10** | All five AC-179-0X covered with `[AC-179-0X]`-tagged tests (17 total). `findings.md` records dictionary location, getter rationale, prop-wiring decision, derivation choice, audit totals, browser-smoke fallback, evidence index. `labels-audit.md` exists with the prescribed table header + 37 classified rows. Minor gap: audit-table line numbers are stale (off by 3-19 lines vs current source) — strings/classifications are correct, but a Generator-side `git grep -n` snapshot at audit time would have eliminated this drift. |
| **Reliability** (20%) | **8/10** | `paradigm ?? "rdb"` fallback is centralized in one place (the getter) — no duplicated ternary at call sites, audit-friendly. Skip-zero gate holds (zero `it.skip`/`it.todo`/`xit` introduced). Strict TS — no `any` in any of the touched files. No backend changes (clean `git diff src-tauri/`). The full Vitest run shows only the known pre-existing `window-lifecycle.ac141` failure (Sprint 175 lazy-workspace ADR), as the orchestrator's pre-evaluation note documents. |
| **Verification Quality** (20%) | **8/10** | All required checks executed and reproduced (vitest 4 files / 105 tests pass; full vitest 2486/2487 pass with only the pre-existing unrelated failure; `tsc --noEmit` clean; `pnpm lint` clean). Static checks reproduced: hard PASS gate `grep -nE '>(Add Column|No columns found|Columns)<'` returns empty for both touched JSX files; broader `grep ">(Column|Row|Table|Add Column|No columns)"` filter on paradigm-shared components also returns empty. Audit spot-checks confirm the 5 sample rows: vocab.units (StructurePanel:112 — cited 99), addUnit/aria-label/emptyUnits (ColumnsEditor:520/523/662 — cited 514/517/643). Line numbers stale but classifications correct. |
| **Overall** | **8.4/10** | Weighted: 0.35×9 + 0.25×8 + 0.20×8 + 0.20×8 = 8.35. |

## Verdict: PASS

All four dimensions ≥ 7/10. Required checks all green. Hard PASS gate (zero hardcoded RDB labels in paradigm-shared JSX) holds. The implementation is production-grade and the contract is fully satisfied.

---

## Per-AC Verdict Table

| AC | Verdict | Evidence |
|---|---|---|
| AC-179-01 | PASS | `src/lib/strings/paradigm-vocabulary.ts` exports a typed `Record<Paradigm, ParadigmVocabulary>` constant with all 4 paradigms × all 7 keys; `Paradigm` type imported from `@/types/connection.ts:15` (verified — no new type introduced). Tests `[AC-179-01a..d]` in `paradigm-vocabulary.test.ts` enumerate keys at runtime via `ALL_PARADIGMS` and `REQUIRED_KEYS` constants. `[AC-179-01a]` iterates 4×7=28 cells. |
| AC-179-02 | PASS | `[AC-179-02a]` (StructurePanel.test.tsx:2081) renders `paradigm="document"` and asserts `getByRole("tab", { name: "Fields" })` + `getByText("No fields found")` present, `Columns` + `No columns found` absent. `[AC-179-02b]` + `[AC-179-02c]` (ColumnsEditor.test.tsx:34/51) assert `Add Field` + `No fields found` + sentence-case aria-label `"Add field"` present, RDB equivalents absent. |
| AC-179-03 | PASS | Test diffs are purely additive (DataGridToolbar.test.tsx: +63 lines, 0 deletions; StructurePanel.test.tsx: +80 insertions, 0 deletions). No existing RDB-string assertions modified. `[AC-179-03a]`, `[AC-179-03b]`×3, `[AC-179-03c]` anchor RDB-default behavior preserved. `DOCUMENT_LABELS` literal output unchanged (anchored by `[AC-179-03b] DOCUMENT_LABELS literal output is unchanged byte-for-byte`). |
| AC-179-04 | PASS | Dictionary-level fence: `[AC-179-04a]` `getParadigmVocabulary(undefined)` returns `PARADIGM_VOCABULARY.rdb`; `[AC-179-04c]` round-trips every concrete paradigm. Component-level fence: `[AC-179-04a]` (StructurePanel) renders without prop and asserts `tab name: "Columns"`; `[AC-179-04b]` (ColumnsEditor) renders without prop and asserts `Add Column` + `No columns found`. Single fallback site in `paradigm-vocabulary.ts:109` (`PARADIGM_VOCABULARY[paradigm ?? "rdb"]`). |
| AC-179-05 | PASS (with one minor accuracy issue) | `docs/sprints/sprint-179/labels-audit.md` exists with the prescribed table header `\| Component \| Line \| String \| Classification \| Note \|`. 37 rows classified (15 paradigm-aware + 22 paradigm-fixed); zero hardcoded RDB labels in paradigm-shared JSX (verified). **Issue**: audit-table line numbers are stale by 3-19 lines (StructurePanel cites 99/100/101 but actual subTabs are at 111/112/113/114; ColumnsEditor cites 514/517/643 but actual targets are at 520/523/662). Strings exist and classifications are correct, but the line numbers should match the post-edit source. Recorded as a P3 (cosmetic) finding — no impact on the substantive verdict. |

---

## Audit-Report Spot-Check Log

| Audit Row | Cited Line | Actual Line | String/Classification Verified | Verdict |
|---|---|---|---|---|
| StructurePanel `vocab.units` ("Columns" / "Fields") | 99 | 112 | `{ key: "columns", label: vocab.units }` paradigm-aware | string + classification correct; line stale |
| StructurePanel `"Indexes"` | 100 | 113 | `{ key: "indexes", label: "Indexes" }` paradigm-fixed | string + classification correct; line stale |
| ColumnsEditor `aria-label={ariaAddUnit}` | 514 | 520 | `aria-label={ariaAddUnit}` paradigm-aware (sentence-case derivation `Add ${vocab.unit.toLowerCase()}` at line 344) | string + classification correct; line stale |
| ColumnsEditor `{vocab.addUnit}` visible button text | 517 | 523 | `{vocab.addUnit}` rendered via `<Plus />{vocab.addUnit}` paradigm-aware | string + classification correct; line stale |
| ColumnsEditor `{vocab.emptyUnits}` empty-state | 643 | 662 | `{vocab.emptyUnits}` empty-state copy paradigm-aware | string + classification correct; line stale |

Spot-check verdict: 5/5 substantive correctness; 5/5 line-number drift (P3 finding).

---

## File-Level Diff Verification

| File | Status | Verification |
|---|---|---|
| `src/lib/strings/paradigm-vocabulary.ts` | NEW | Typed `Record<Paradigm, ParadigmVocabulary>` const + `getParadigmVocabulary(paradigm?: Paradigm)` getter. 4 paradigms × 7 keys = 28 vocabulary entries. `Paradigm` imported from `@/types/connection`. |
| `src/lib/strings/paradigm-vocabulary.test.ts` | NEW | 7 tests (`[AC-179-01a..d]`, `[AC-179-04a..c]`); each carries Reason + 2026-04-30 date comment. Iterates `ALL_PARADIGMS` × `REQUIRED_KEYS` at runtime (not hardcoded enumeration). |
| `src/lib/strings/document.ts` | MODIFIED | `git diff` shows only derivation source change; literal output strings (`"documents"`, `"Add document"`, `"Delete document"`, `"Duplicate document"`) preserved. |
| `src/components/datagrid/DataGridToolbar.tsx` | MODIFIED | `RDB_TOOLBAR_LABELS` derived from `PARADIGM_VOCABULARY.rdb`; existing label-prop overrides keep working unchanged. |
| `src/components/schema/StructurePanel.tsx` | MODIFIED | Adds `paradigm?: Paradigm` prop (default `undefined` → falls back to `rdb` via getter). Tab labels: only `vocab.units` for "Columns/Fields"; "Indexes" + "Constraints" stay paradigm-fixed (legitimate per audit). Forwards `paradigm` to `ColumnsEditor`. |
| `src/components/structure/ColumnsEditor.tsx` | MODIFIED | Adds `paradigm?: Paradigm` prop. `vocab.addUnit` (visible button text), `ariaAddUnit` (sentence-case aria-label), `vocab.emptyUnits` (empty-state) sourced from dictionary. |
| `src/components/datagrid/DataGridToolbar.test.tsx` | MODIFIED | +63 additive lines for `[AC-179-03b]`×3 regression-guard tests. No existing assertions modified. |
| `src/components/schema/StructurePanel.test.tsx` | MODIFIED | +80 additive lines for `[AC-179-02a]`/`[AC-179-03a]`/`[AC-179-04a]` paradigm tests. No existing assertions modified. |
| `src/components/structure/ColumnsEditor.test.tsx` | NEW | Sibling test for ColumnsEditor in isolation; 4 tests (`[AC-179-02b]`, `[AC-179-02c]`, `[AC-179-03c]`, `[AC-179-04b]`). |
| `docs/sprints/sprint-179/labels-audit.md` | NEW | Audit report with prescribed table header; 37 classified rows; zero hardcoded RDB labels in paradigm-shared JSX. |
| `docs/sprints/sprint-179/findings.md` | NEW | Generator notes with all required sections per contract. |
| `docs/sprints/sprint-179/handoff.md` | NEW | Sprint deliverable. |

---

## Verification Commands Re-Run by Evaluator

| Command | Outcome |
|---|---|
| `pnpm vitest run src/lib/strings/paradigm-vocabulary.test.ts src/components/datagrid/DataGridToolbar.test.tsx src/components/schema/StructurePanel.test.tsx src/components/structure/ColumnsEditor.test.tsx` | PASS — 4 files / 105 tests; 17 `[AC-179-0X]`-tagged tests visible in verbose output |
| `pnpm vitest run` (full suite) | 164 files pass / 1 file fails (pre-existing `window-lifecycle.ac141.test.tsx:173` from Sprint 175); 2486/2487 tests pass — unrelated to Sprint 179 |
| `pnpm tsc --noEmit` | PASS (zero output / zero errors) |
| `pnpm lint` | PASS (zero output / zero errors) |
| `grep -nE 'rdb:\|document:\|search:\|kv:\|unit:\|units:\|record:\|records:\|container:\|addUnit:\|emptyUnits:' src/lib/strings/paradigm-vocabulary.ts \| wc -l` | 39 (4 paradigms × 7 vocabulary keys + 7 interface fields + 4 paradigm-key declarations = 39 grep hits — all keys present per paradigm) |
| `grep -nE '>(Add Column\|No columns found\|Columns)<' src/components/structure/ColumnsEditor.tsx src/components/schema/StructurePanel.tsx` | EMPTY (zero hardcoded RDB labels in JSX of paradigm-shared components) |
| `grep -rn -E ">(Column\|Row\|Table\|Add Column\|No columns)" src/components/ --include="*.tsx" \| grep -v test` | EMPTY (broader hard-PASS gate for paradigm-shared components also passes) |
| `grep -nE 'it\.(skip\|todo)\|xit\(' <touched-test-files>` | EMPTY (skip-zero gate holds) |
| `grep -n "type Paradigm\|Paradigm =" src/types/` | Single declaration at `src/types/connection.ts:15` — no new `Paradigm` type added by Sprint 179 |
| `git diff src/types/connection.ts` | No diff — Paradigm type unchanged |
| `git diff src-tauri/` | No diff — no backend changes |
| `git diff src/lib/strings/document.ts` | Only derivation source changed; literal `DOCUMENT_LABELS` strings preserved (`"documents"`, `"Add document"`, `"Delete document"`, `"Duplicate document"`) |

---

## Findings (any P0/P1/P2/P3)

### P3 (cosmetic, non-blocking)

1. **Audit-table line-number drift**
   - Current: `labels-audit.md` cites StructurePanel lines 99/100/101 but the post-edit source has the relevant subTabs at 111/112/113/114. ColumnsEditor cites 514/517/643 but actual lines are 520/523/662. document.ts cites 50-53 but actual lines are 45-48. DataGridToolbar cites 39-42 but actual lines are 38-42.
   - Expected: post-edit line numbers in the committed audit table.
   - Suggestion: re-run `grep -n` after the final edit pass and update the audit table's `Line` column. Substantive correctness is intact (every cited string + classification is verified to exist at the cited file with the cited classification), so this is a polish issue only.

### P0/P1/P2

None. All required checks pass. The hard PASS gate (`>(Add Column|No columns found|Columns)<` empty in paradigm-shared JSX) is satisfied. Implementation is production-grade.

---

## Feedback for Generator

The implementation is solid and meets every Sprint Contract Done Criterion. One minor improvement opportunity:

1. **Audit-table line-number freshness (P3)**:
   - Current: Audit cites pre-edit line numbers in some rows.
   - Expected: Line numbers reflect the post-edit source state.
   - Suggestion: After the final edit pass, regenerate the line columns by running `grep -n` against each cited target and replace stale numbers. Add a Sprint convention: "audit tables are committed AFTER all source edits, with a freshly-grepped `Line` column."

This is a polish-level observation, not a blocker. Sprint 179 attempt 1 is approved.

---

## Verdict: PASS

Open `P1`/`P2` findings: 0
Open `P3` findings: 1 (audit-table line-number drift; cosmetic only)
Required checks passing: yes (1–6 in Verification Plan)
`labels-audit.md` exists with prescribed table and zero RDB-hardcoded labels in paradigm-shared components: yes
`findings.md` exists and includes all required sections: yes
Acceptance criteria evidence linked in `handoff.md`: yes (one row per AC)

Sprint 179 attempt 1: PASS.
