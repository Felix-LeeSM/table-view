# Sprint Execution Brief: sprint-179

## Objective

- Match user-visible labels to the active connection's paradigm. Today RDB-only vocabulary ("Add Column", "Columns", "No columns found") leaks into Mongo contexts because (a) `StructurePanel` / `ColumnsEditor` hardcode RDB strings, and (b) only `DataGridToolbar` consumes the partial-coverage `DOCUMENT_LABELS` pattern. This sprint introduces a single typed paradigm dictionary covering all four paradigms (`rdb`, `document`, `search`, `kv`), routes `DOCUMENT_LABELS` through it, extends the structure-side surfaces (`StructurePanel`, `ColumnsEditor`) with a `paradigm?: Paradigm` prop and an RDB fallback, and ships an audit report listing every user-visible "column"/"table"/"row" string under `src/components/**.tsx` with classification.

## Task Why

- **UX law: Mental Model.** SQL users expect the database surface to speak SQL — "Column / Row / Table." Document-store users expect "Field / Document / Collection." Calling a Mongo field a "column" or a Mongo collection a "table" inside a UI that *does* know the paradigm (the connection metadata carries `paradigm`) creates a vocabulary mismatch that breaks the user's mental model and slows comprehension. The infrastructure for paradigm-aware copy already exists (`QuerySyntax` dispatcher, `DOCUMENT_LABELS` partial dictionary, `Paradigm` type), but the rest of the app doesn't yet consume it. This sprint closes the gap.

## Scope Boundary

- **HARD: no backend changes.** Frontend-only label refactor. No IPC, no Rust, no Tauri command edits. `src-tauri/` is untouched.
- **HARD: no new `Paradigm` type.** Reuse `Paradigm = "rdb" | "document" | "search" | "kv"` from `src/types/connection.ts:15` verbatim. Dictionary keys MUST be those four values.
- **HARD: no behavior change to existing RDB tests.** Existing component test files keep their RDB-string assertions (`"Columns"`, `"Add Column"`, `"No columns found"`, `"Add row"`, `"rows"`) and still pass. The dictionary's `rdb` entry MUST equal those literals.
- **HARD: no new untranslatable English in JSX.** Every label that this sprint touches flows through the dictionary (or through the existing `DOCUMENT_LABELS` indirection that is now derived from it). Inline `>Add Column<` text in touched files is gone after the sprint; the audit at AC-179-05 verifies.
- **SOFT (deferred): Sprint 180 cancel overlay.** The cancel button copy will be paradigm-aware later — out of scope here.
- **SOFT (deferred): capability adapter from ADR-0010.** Vocabulary is lexical; capability gating is structural — keep them separate.
- **SOFT (deferred): Mongo data fetching in RDB-only surfaces.** `StructurePanel` is RDB-mounted today; this sprint adds paradigm-aware copy so it CAN render Mongo wording correctly when mounted with `paradigm="document"`, but does not introduce a Mongo fetch path or change which surfaces mount for which paradigm.

## Invariants

- **`Paradigm` type unchanged**: `src/types/connection.ts:15` is read, not modified.
- **`DOCUMENT_LABELS` literal output unchanged**: the consumer flow in `DocumentDataGrid.tsx:273-276` keeps producing `"documents"`, `"Add document"`, `"Delete document"`, `"Duplicate document"` exactly as today. The constant's *source* may change (derive from dictionary) but the runtime string output is byte-equal.
- **`paradigm ?? "rdb"` fallback rule** lives in exactly one place (the dictionary getter/hook); consumers don't ternary at every call site.
- **Existing test suite passes**: `pnpm vitest run` green at sprint end; existing assertions on RDB strings continue to match because `paradigm` defaults to `"rdb"`.
- **No `it.skip` / `it.todo` / `xit` introduced** in touched test files (project skip-zero gate, Phase 13+).
- **Strict TS**: dictionary typed `Record<Paradigm, ParadigmVocabulary>`; no `any`.
- **No new runtime dependencies**; no `package.json` change.
- **Tab-label `key`** in `StructurePanel` (`{ key: "columns", label: "Columns" }` at line 94) keeps `key: "columns"` (stable identifier); only the `label` value is sourced from the dictionary.

## Done Criteria

1. `src/lib/strings/paradigm-vocabulary.ts` (or equivalent name in `src/lib/strings/`) exists. It exports a typed `Record<Paradigm, ParadigmVocabulary>` constant `PARADIGM_VOCABULARY` covering all four paradigms with the keys `unit`, `units`, `record`, `records`, `container`, `addUnit`, `emptyUnits` — non-empty strings each. Test asserts completeness. (AC-179-01)
2. `StructurePanel` and `ColumnsEditor` rendered with `paradigm="document"` show Mongo vocabulary (`Fields`, `Add Field`, `No fields found`); RDB strings (`Columns`, `Add Column`, `No columns found`) are absent. Vitest tests assert both directions. (AC-179-02)
3. Existing component tests pass without text-string edits to assertions; existing RDB-default behavior preserved. (AC-179-03)
4. Rendering with `paradigm={undefined}` falls back to the `rdb` dictionary entry — RDB vocabulary appears, no throw, no warning. Vitest tests assert at the dictionary level (getter/hook) AND at the component level. (AC-179-04)
5. `docs/sprints/sprint-179/labels-audit.md` exists with the table header `| Component | Line | String | Classification | Note |`, every "column"/"table"/"row"/"field"/"document"/"collection" string under `src/components/**.tsx` (excluding test files) is classified, and zero hardcoded paradigm-RDB labels remain in paradigm-shared components. (AC-179-05)
6. Required checks pass: `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint`, the static checks at Verification Plan §Required Checks #5, the browser smoke at #6.
7. `findings.md` records: dictionary location/name, access pattern (hook vs getter) + rationale, `DOCUMENT_LABELS` derivation choice, audit totals, browser smoke summary, evidence index.

## Verification Plan

- **Profile**: `mixed` (browser + command + static). Browser smoke is operator-driven and limited to AC-179-02 (one Mongo-paradigm structure surface rendering Mongo vocabulary at min window size for visual graceful-truncation confirmation).
- **Required checks**:
  1. `pnpm vitest run src/lib/strings/paradigm-vocabulary.test.ts src/components/datagrid/DataGridToolbar.test.tsx src/components/schema/StructurePanel.test.tsx src/components/structure/ColumnsEditor.test.tsx` — green. AC-179-0X covered by `[AC-179-0X]`-prefixed test names.
  2. `pnpm vitest run` — full suite green (no regression).
  3. `pnpm tsc --noEmit` — zero errors.
  4. `pnpm lint` — zero errors.
  5. Static — `grep -nE 'rdb:|document:|search:|kv:|unit:|units:|record:|records:|container:|addUnit:|emptyUnits:' src/lib/strings/paradigm-vocabulary.ts` confirms full coverage; `grep -nE '>(Add Column|No columns found|Columns)<' src/components/structure/ColumnsEditor.tsx src/components/schema/StructurePanel.tsx` returns empty; `test -f docs/sprints/sprint-179/labels-audit.md`; spot-check audit covers `grep -rn -E "(Column|Row|Table|Field|Document|Collection)" src/components/ --include="*.tsx" | grep -v test` candidates.
  6. Browser smoke — `pnpm tauri dev`, render Mongo + RDB structure surfaces, confirm vocabulary swap and graceful truncation at 1024×600. Best-effort fallback: Vitest test that mounts `StructurePanel` with `paradigm="document"` is sufficient if no Mongo connection is configured locally.
- **Required evidence**:
  - Changed files list with one-line purpose each (paradigm-vocabulary.ts, paradigm-vocabulary.test.ts, document.ts, DataGridToolbar.tsx, StructurePanel.tsx, ColumnsEditor.tsx, the test extensions, labels-audit.md, findings.md, handoff.md).
  - Vitest output for the four targeted test files; `[AC-179-0X]`-tagged cases visible.
  - `paradigm-vocabulary.test.ts` shows the completeness assertion iterating all four paradigms × seven keys (AC-179-01).
  - `StructurePanel.test.tsx` and `ColumnsEditor.test.tsx` show the `paradigm="document"` cases asserting Mongo vocabulary present AND RDB vocabulary absent (AC-179-02), and the `paradigm={undefined}` cases asserting RDB fallback (AC-179-04).
  - Existing test files' diffs show NO text-string edits to RDB assertions — only optional new test cases added (AC-179-03 evidence).
  - `labels-audit.md` table with at minimum a 5-row sample shown in `findings.md`; total audit row count vs `grep` candidate count matches (or has a justified gap recorded in `findings.md`) (AC-179-05).
  - `findings.md` records dictionary location/name, access pattern + rationale, `DOCUMENT_LABELS` derivation choice, audit totals (paradigm-aware count vs paradigm-fixed count), browser smoke summary.
  - `git diff src/types/connection.ts` shows no edit (Paradigm type unchanged invariant).
  - `git diff src/lib/strings/document.ts` shows literal `DOCUMENT_LABELS` strings unchanged (only the derivation source may change).
  - `grep -nE 'it\.(skip|todo)|xit\(' <touched-test-files>` returns empty (skip-zero gate).

## Evidence To Return

- Changed files and one-line purpose per file.
- Checks run and outcomes (Vitest stdout summary, tsc result, lint result, static-check stdouts).
- Done criteria coverage: AC-179-01..05 with concrete test names and the line ranges of the audit-report sample.
- Assumptions made during implementation (e.g. chosen access pattern hook-vs-getter, chosen `search`/`kv` vocabulary strings since spec leaves them best-effort, chosen audit-table sort order, chosen `DOCUMENT_LABELS` derivation path).
- Residual risk or verification gaps (e.g. browser smoke deferred to Vitest because no Mongo connection was configured locally; any e2e selector that the audit flagged but couldn't be confirmed broken without running the e2e suite).

## References

- Contract: `docs/sprints/sprint-179/contract.md`
- Master spec: `docs/sprints/sprint-176/spec.md` (Sprint 179 section, Discrepancies §D.1–§D.2)
- Findings (Generator output): `docs/sprints/sprint-179/findings.md`
- Audit report (Generator output): `docs/sprints/sprint-179/labels-audit.md`
- Handoff (Generator output): `docs/sprints/sprint-179/handoff.md`
- Relevant source files:
  - `src/types/connection.ts:15` — `Paradigm` type (read-only invariant).
  - `src/lib/strings/document.ts` — existing `DOCUMENT_LABELS`; preserve literal strings, derive from dictionary.
  - `src/components/datagrid/DataGridToolbar.tsx` — existing prop-override pattern for label flow.
  - `src/components/schema/StructurePanel.tsx` — RDB-only mounted today; needs paradigm prop + dictionary lookups for tab labels and empty-state copy.
  - `src/components/structure/ColumnsEditor.tsx` — `"Add Column"` button at line 504, `"No columns found"` at line 643; needs paradigm prop + dictionary lookups.
  - `src/components/document/DocumentDataGrid.tsx:273-276` — existing `DOCUMENT_LABELS` consumer; verify byte-equal output post-derivation.
- Reference style: `docs/sprints/sprint-178/contract.md`.
- Project conventions: `memory/conventions/memory.md`; testing rule: `.claude/rules/testing.md`; React rule: `.claude/rules/react-conventions.md`; test-scenarios rule: `.claude/rules/test-scenarios.md`.
