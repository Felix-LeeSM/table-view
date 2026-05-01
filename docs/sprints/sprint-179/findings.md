# Sprint 179 — Generator Findings

Generated: 2026-04-30 (commit timeline carry-over).

## Dictionary location and name

- File: `src/lib/strings/paradigm-vocabulary.ts`.
- Exported names: `ParadigmVocabulary` (interface), `PARADIGM_VOCABULARY` (typed `Record<Paradigm, ParadigmVocabulary>` constant), `getParadigmVocabulary` (getter with `undefined → rdb` fallback).
- Sibling to the existing `src/lib/strings/document.ts`; same module pattern.

## Access pattern: getter vs hook + rationale

- Chose **plain getter** (`getParadigmVocabulary(paradigm?: Paradigm): ParadigmVocabulary`) instead of `useParadigmVocabulary` hook.
- Rationale:
  - The vocabulary is a pure value derivation — there is no React state, no context dependency, no subscription.
  - A plain getter is safe to call from non-React code paths (e.g. potential test helpers, future Rust→TS adapters that read paradigm metadata).
  - It avoids the `react-hooks/rules-of-hooks` lint rule chain that a hook would impose on consumers.
  - The two consumers in this sprint (`StructurePanel`, `ColumnsEditor`) are both function components and call it once at render time — no observable difference vs. a hook.
  - The dictionary stays a leaf-level utility, mirroring how `document.ts` has historically been a constant module not a hook.

## `paradigm` prop wiring decision

- Both `StructurePanel` and `ColumnsEditor` accept `paradigm?: Paradigm` as an additive optional prop with default `undefined` (which the getter resolves to `"rdb"`).
- Wiring uses the simplest possible form: `const vocab = getParadigmVocabulary(paradigm)` near the top of the component, followed by `vocab.units` / `vocab.addUnit` / `vocab.emptyUnits` references in JSX.
- `StructurePanel` forwards its `paradigm` prop to `ColumnsEditor` so the two surfaces stay in sync when the parent is mounted with `paradigm="document"`.
- `DataGridToolbar` keeps its existing label-prop override pattern (per the contract's "preserve existing behavior" invariant); only the prop **defaults** are sourced from `PARADIGM_VOCABULARY.rdb` instead of inline literals. The `DOCUMENT_LABELS` spread at `DocumentDataGrid.tsx:273-276` continues to override those defaults exactly as before.

## `DOCUMENT_LABELS` derivation choice

- Chose to **derive `DOCUMENT_LABELS` from `PARADIGM_VOCABULARY.document` inline in `document.ts`** rather than embedding a `toolbarLabels` field in the dictionary.
- Concretely:
  ```ts
  const docVocab = PARADIGM_VOCABULARY.document;
  export const DOCUMENT_LABELS = {
    rowCountLabel: docVocab.records.toLowerCase(),
    addRowLabel: `Add ${docVocab.record.toLowerCase()}`,
    deleteRowLabel: `Delete ${docVocab.record.toLowerCase()}`,
    duplicateRowLabel: `Duplicate ${docVocab.record.toLowerCase()}`,
  } as const;
  ```
- Rationale:
  - The dictionary's `document` entry uses **title-case schema vocabulary** (`"Documents"`, `"Add Field"`) consistent with the `rdb` entry's pattern (`"Rows"`, `"Add Column"`).
  - The toolbar's user-facing **action copy** uses **sentence case** (`"Add document"`, `"Delete document"`) — that's a legacy tone choice from Sprint 118 and the current `DOCUMENT_LABELS` literal. Embedding both tones in the dictionary would either duplicate axes (`addUnit` + `addRecord`) or contaminate the dictionary with toolbar-specific concerns.
  - Hand-rolling the four toolbar labels in `document.ts` keeps the toolbar tone exactly equal to the legacy literal output, and preserves the clean axis split in the dictionary (`unit`/`record`/`container` only, no toolbar-flavor axes).
  - The byte-for-byte preservation of `DOCUMENT_LABELS` is anchored by a Sprint 179 regression test: `DataGridToolbar.test.tsx` `[AC-179-03b] DOCUMENT_LABELS literal output is unchanged byte-for-byte`.
- Same pattern applied in `DataGridToolbar.tsx` for the RDB defaults (`RDB_TOOLBAR_LABELS` derived from `PARADIGM_VOCABULARY.rdb` inline) so the dictionary remains the single source of truth without coupling toolbar-tone concerns into it.

## aria-label vs visible text policy in `ColumnsEditor`

- Visible button text uses the dictionary's title-case `vocab.addUnit` (`"Add Column"` / `"Add Field"`).
- Button `aria-label` uses a sentence-case derivation `Add ${vocab.unit.toLowerCase()}` (`"Add column"` / `"Add field"`).
- Rationale:
  - The legacy RDB code had `aria-label="Add column"` (lowercase 'c') and visible text `"Add Column"` — the existing `StructurePanel.test.tsx` queries with `name: "Add column"` (sentence case) which becomes the accessible name (aria-label wins over visible text in Accessible Name Computation).
  - To preserve the existing test assertions byte-for-byte (per AC-179-03 invariant: "existing assertion strings remain valid"), the aria-label needs to remain sentence case for RDB.
  - The sentence-case derivation `Add ${vocab.unit.toLowerCase()}` flows the same way through the document paradigm — yielding `"Add field"` aria-label + `"Add Field"` visible text. This is consistent with the legacy pattern.
  - The Sprint 179 component-level tests query both: `getByRole("button", { name: "Add field" })` for aria-label and `getByText("Add Field")` for visible text. AC-179-02 asserts the visible text mention.

## Audit table totals

- Total raw `grep -rn -E "(Column|Row|Table|Field|Document|Collection)" src/components/ --include="*.tsx" | grep -v test` candidate lines: **722**.
- Of those, the user-visible paradigm-vocabulary rows that warrant classification: **37** (the rest are field names, type names, identifiers, comments, or per-column-name aria-labels like `Edit column ${col.name}`).
- Paradigm-aware after Sprint 179: **15** rows.
- Paradigm-fixed (legitimate RDB-only or document-only or per-element aria-label): **22** rows.
- Hardcoded paradigm-RDB labels remaining in paradigm-shared JSX: **0** — verified by `grep -nE '>(Add Column|No columns found|Columns)<' src/components/structure/ColumnsEditor.tsx src/components/schema/StructurePanel.tsx` returning empty.

### Audit sample (5 rows, see `labels-audit.md` for the full table)

| Component | Line | String | Classification | Note |
| --- | --- | --- | --- | --- |
| `src/components/structure/ColumnsEditor.tsx` | 514 | Button `aria-label={ariaAddUnit}` ("Add column" / "Add field") | paradigm-aware | Sentence-case derivation from `vocab.unit`. |
| `src/components/structure/ColumnsEditor.tsx` | 517 | Button visible text `{vocab.addUnit}` ("Add Column" / "Add Field") | paradigm-aware | Title-case action copy sourced from dictionary. |
| `src/components/structure/ColumnsEditor.tsx` | 643 | Empty-state `{vocab.emptyUnits}` ("No columns found" / "No fields found") | paradigm-aware | Sourced from dictionary. |
| `src/components/schema/StructurePanel.tsx` | 99 | Sub-tab `vocab.units` ("Columns" / "Fields") | paradigm-aware | Previously inline `"Columns"` literal. |
| `src/components/schema/StructurePanel.tsx` | 100 | Sub-tab `"Indexes"` | paradigm-fixed | RDB-only structural concept; out of Sprint 179 scope. |

## E2E selector audit

- Searched for any e2e selector that relies on the affected RDB strings (`"Add Column"`, `"No columns found"`, `"Columns"` tab):
  ```
  $ grep -rn 'Add Column\|No columns found' e2e/
  ```
- Result: **No e2e currently relies on the affected RDB strings** (the e2e suite under `e2e/` does not reference the structure tab's button or empty state). No e2e update needed (per AC-GLOBAL-06).

## Browser smoke summary

- Operator-driven `pnpm tauri dev` smoke is best-effort per the contract's verification plan (Required Checks #6).
- No Mongo connection is configured locally in the harness sandbox, so the contract's documented fallback applies: the **Vitest test that mounts `StructurePanel` with `paradigm="document"` is sufficient** as smoke evidence (per Verification Plan #6.2).
- The Vitest fallback test (`StructurePanel.test.tsx` `[AC-179-02a]`) renders `<StructurePanel paradigm="document" />` against an empty-collection mock, asserts the tab label is `"Fields"`, and asserts the empty-state copy is `"No fields found"` — the same vocabulary swap a real Mongo navigation would produce.
- Min-window-size graceful-truncation (1024×600) was not visually verified in this attempt because the Tauri shell is not launched in this sandbox; the labels are short (`"Fields"`, `"Add Field"`, `"No fields found"`) and the legacy RDB labels (`"Columns"`, `"Add Column"`, `"No columns found"`) are similar lengths, so no layout regression is anticipated. **Risk recorded** in handoff.md.

## Evidence index

- AC-179-01:
  - Dictionary file: `src/lib/strings/paradigm-vocabulary.ts`
  - Tests: `src/lib/strings/paradigm-vocabulary.test.ts` cases `[AC-179-01a]` through `[AC-179-01d]`
- AC-179-02:
  - `src/components/schema/StructurePanel.test.tsx` `[AC-179-02a] paradigm="document" renders Mongo tab label + empty-state copy`
  - `src/components/structure/ColumnsEditor.test.tsx` `[AC-179-02b]` and `[AC-179-02c]`
- AC-179-03:
  - `src/components/schema/StructurePanel.test.tsx` `[AC-179-03a] paradigm="rdb" renders the legacy 'Columns' tab`
  - `src/components/structure/ColumnsEditor.test.tsx` `[AC-179-03c] paradigm="rdb" renders 'Add Column' + 'No columns found'`
  - `src/components/datagrid/DataGridToolbar.test.tsx` `[AC-179-03b]` × 3 cases (RDB defaults; DOCUMENT_LABELS spread; literal preservation)
  - **Existing 95 tests pass without text-string edits** (Vitest run before any test-file edit; verified via `pnpm vitest run` for the four targeted test files).
- AC-179-04:
  - `src/lib/strings/paradigm-vocabulary.test.ts` `[AC-179-04a]` `getParadigmVocabulary(undefined)` returns `rdb` entry
  - `src/lib/strings/paradigm-vocabulary.test.ts` `[AC-179-04b]` `getParadigmVocabulary("document")` round-trip
  - `src/lib/strings/paradigm-vocabulary.test.ts` `[AC-179-04c]` every concrete paradigm round-trips
  - `src/components/schema/StructurePanel.test.tsx` `[AC-179-04a] paradigm undefined falls back to 'Columns' tab`
  - `src/components/structure/ColumnsEditor.test.tsx` `[AC-179-04b] paradigm undefined falls back to RDB vocabulary`
- AC-179-05:
  - Audit report: `docs/sprints/sprint-179/labels-audit.md`

## Verification commands run + outcomes

| Command | Outcome |
| --- | --- |
| `pnpm vitest run src/lib/strings/paradigm-vocabulary.test.ts src/components/datagrid/DataGridToolbar.test.tsx src/components/schema/StructurePanel.test.tsx src/components/structure/ColumnsEditor.test.tsx` | ✅ 4 files / 105 tests pass |
| `pnpm vitest run` (full) | ✅ 164 files pass / 1 file fails (the known pre-existing `window-lifecycle.ac141.test.tsx:173` Sprint 175 lazy-workspace failure — left alone per execution brief). 2486/2487 tests pass. |
| `pnpm tsc --noEmit` | ✅ Zero errors |
| `pnpm lint` | ✅ Zero errors |
| `grep -nE '>(Add Column\|No columns found\|Columns)<' src/components/structure/ColumnsEditor.tsx src/components/schema/StructurePanel.tsx` | ✅ Empty (zero hardcoded RDB labels in JSX of paradigm-shared components) |
| `grep -nE 'it\.(skip\|todo)\|xit\(' src/lib/strings/paradigm-vocabulary.test.ts src/components/schema/StructurePanel.test.tsx src/components/structure/ColumnsEditor.test.tsx src/components/datagrid/DataGridToolbar.test.tsx` | ✅ Empty (skip-zero gate holds) |
| `git diff src/types/connection.ts` | ✅ No edit (Paradigm type unchanged invariant) |
| `git diff src/lib/strings/document.ts` | ✅ Only the derivation source changed; literal `DOCUMENT_LABELS` strings preserved (`"documents"`, `"Add document"`, `"Delete document"`, `"Duplicate document"`) |

## Assumptions / risks

- **Browser smoke fallback used** (Vitest) since no Mongo connection is configured locally; the contract's verification plan §6.2 explicitly permits this fallback.
- **`search` and `kv` vocabulary entries are best-effort** per the contract's Quality Bar — no rendering surface mounts them in this sprint, but AC-179-01 requires complete coverage. Chosen entries: `search.container = "Index"`, `kv.container = "Namespace"` (both reasonable English defaults). The `kv.records = "Entries"` choice diverges slightly from the brief's hint of `"Entries"` and matches it.
- **`DOCUMENT_LABELS` derivation** uses string concatenation against the dictionary's lowercase forms instead of pulling pre-baked toolbar fields from the dictionary, to avoid contaminating the dictionary's clean axis split. Documented in the `document.ts` comment for future readers.
- **No e2e selector breakage**; verified by `grep -rn 'Add Column\|No columns found' e2e/` returning empty.
- **Min-window-size visual confirmation** is not in this attempt's evidence because the Tauri shell does not run in the sandbox. Risk is low because the new labels are not longer than the legacy ones; recorded as residual risk in `handoff.md`.
