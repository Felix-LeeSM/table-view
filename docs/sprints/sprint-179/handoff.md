# Sprint 179 — Generator Handoff

## Changed Files

- `src/lib/strings/paradigm-vocabulary.ts` (new) — typed `Record<Paradigm, ParadigmVocabulary>` dictionary + `getParadigmVocabulary(paradigm?: Paradigm)` getter with `undefined → rdb` fallback.
- `src/lib/strings/paradigm-vocabulary.test.ts` (new) — completeness assertions across 4 paradigms × 7 keys (`[AC-179-01a..d]`) + getter fallback tests (`[AC-179-04a..c]`).
- `src/lib/strings/document.ts` — `DOCUMENT_LABELS` now derived from `PARADIGM_VOCABULARY.document`; literal output strings preserved byte-for-byte.
- `src/components/datagrid/DataGridToolbar.tsx` — default label-prop fallbacks read from `PARADIGM_VOCABULARY.rdb` instead of inline literals; behavior unchanged for both RDB callers and the document grid (which still spreads `DOCUMENT_LABELS`).
- `src/components/schema/StructurePanel.tsx` — accepts optional `paradigm?: Paradigm` prop; tab labels read from dictionary; forwards prop to `ColumnsEditor`.
- `src/components/structure/ColumnsEditor.tsx` — accepts optional `paradigm?: Paradigm` prop; "Add" button label + empty-state copy read from dictionary; aria-label uses sentence-case derivation to preserve existing test assertions.
- `src/components/datagrid/DataGridToolbar.test.tsx` — added Sprint 179 regression-guard suite (`[AC-179-03b]` × 3) for RDB defaults, `DOCUMENT_LABELS` spread, and literal preservation.
- `src/components/schema/StructurePanel.test.tsx` — added Sprint 179 paradigm-aware suite (`[AC-179-02a]`, `[AC-179-03a]`, `[AC-179-04a]`).
- `src/components/structure/ColumnsEditor.test.tsx` (new) — Sprint 179 paradigm-aware copy tests for ColumnsEditor in isolation (`[AC-179-02b]`, `[AC-179-02c]`, `[AC-179-03c]`, `[AC-179-04b]`).
- `docs/sprints/sprint-179/labels-audit.md` (new) — AC-179-05 audit table classifying all paradigm-vocabulary mentions in `src/components/**.tsx`. 15 paradigm-aware / 22 paradigm-fixed / 0 hardcoded RDB labels in paradigm-shared JSX.
- `docs/sprints/sprint-179/findings.md` (new) — Generator notes: dictionary location/name, getter rationale, `DOCUMENT_LABELS` derivation choice, audit totals, browser smoke fallback, evidence index.
- `docs/sprints/sprint-179/handoff.md` (this file) — sprint deliverable.

## Checks Run

| Command | Result |
| --- | --- |
| `pnpm vitest run src/lib/strings/paradigm-vocabulary.test.ts src/components/datagrid/DataGridToolbar.test.tsx src/components/schema/StructurePanel.test.tsx src/components/structure/ColumnsEditor.test.tsx` | pass (4 files / 105 tests) |
| `pnpm vitest run` (full) | pass (164 files / 2486 tests); 1 pre-existing failure in `src/__tests__/window-lifecycle.ac141.test.tsx:173` from Sprint 175 lazy-workspace ADR — left untouched per the execution brief. |
| `pnpm tsc --noEmit` | pass (zero errors) |
| `pnpm lint` | pass (zero errors) |
| `grep -nE 'rdb:|document:|search:|kv:|unit:|units:|record:|records:|container:|addUnit:|emptyUnits:' src/lib/strings/paradigm-vocabulary.ts` | pass (35 matches; 4 paradigms × 7 keys + 7 interface fields) |
| `grep -nE '>(Add Column\|No columns found\|Columns)<' src/components/structure/ColumnsEditor.tsx src/components/schema/StructurePanel.tsx` | pass (empty — zero hardcoded RDB labels in JSX of paradigm-shared components) |
| `grep -nE 'it\.(skip\|todo)\|xit\(' <touched-test-files>` | pass (empty — skip-zero gate) |
| `git diff src/types/connection.ts` | pass (no diff — Paradigm type unchanged) |
| `git diff src/lib/strings/document.ts` | pass (only derivation source changed; `DOCUMENT_LABELS` literal output strings preserved) |
| `grep -rn 'Add Column\|No columns found' e2e/` | pass (empty — no e2e selector relies on affected RDB strings) |

## Done Criteria Coverage

| AC | Evidence |
| --- | --- |
| AC-179-01 | `src/lib/strings/paradigm-vocabulary.ts` exports the typed `PARADIGM_VOCABULARY` constant covering all four paradigms × seven keys. Tests `[AC-179-01a]`..`[AC-179-01d]` in `src/lib/strings/paradigm-vocabulary.test.ts` assert completeness, distinct axes, RDB literal anchor, document literal anchor. |
| AC-179-02 | `[AC-179-02a]` in `src/components/schema/StructurePanel.test.tsx` renders `<StructurePanel paradigm="document" />` against an empty-collection mock and asserts `Fields` tab label + `No fields found` empty-state present, `Columns` + `No columns found` absent. `[AC-179-02b]` and `[AC-179-02c]` in `src/components/structure/ColumnsEditor.test.tsx` assert `Add Field` button (visible text + sentence-case aria-label `"Add field"`) + `No fields found` present, RDB strings absent. |
| AC-179-03 | Existing 95 tests in `DataGridToolbar.test.tsx` + `StructurePanel.test.tsx` pass without text-string edits. New `[AC-179-03a]` (StructurePanel `paradigm="rdb"` → `Columns` tab), `[AC-179-03b]` × 3 (DataGridToolbar RDB defaults / `DOCUMENT_LABELS` spread / literal preservation), `[AC-179-03c]` (ColumnsEditor `paradigm="rdb"` → `Add Column` + `No columns found`) anchor the RDB regression-guard. |
| AC-179-04 | `[AC-179-04a]`..`[AC-179-04c]` in `paradigm-vocabulary.test.ts` assert `getParadigmVocabulary(undefined)` returns the rdb entry (and round-trips concrete paradigms). `[AC-179-04a]` in `StructurePanel.test.tsx` and `[AC-179-04b]` in `ColumnsEditor.test.tsx` assert the component-level fallback (rendering without the prop yields `Columns` / `Add Column` / `No columns found`). |
| AC-179-05 | `docs/sprints/sprint-179/labels-audit.md` exists with the prescribed table header (`\| Component \| Line \| String \| Classification \| Note \|`), classifies 37 user-visible paradigm-vocabulary rows (15 paradigm-aware + 22 paradigm-fixed), documents the methodology, and includes the verifying grep that returns zero hardcoded RDB labels in paradigm-shared JSX. |

## Assumptions

- Chose **plain getter** (`getParadigmVocabulary`) over `useParadigmVocabulary` hook because the dictionary is a pure value derivation with no React state; the getter is consumable from non-component code paths and avoids unnecessary `react-hooks/rules-of-hooks` overhead.
- Chose to **derive `DOCUMENT_LABELS` from the dictionary inline** in `document.ts` (string concatenation + `.toLowerCase()`) rather than embedding `toolbarLabels` in the dictionary axis. Keeps the dictionary's `unit`/`record`/`container` axis clean and avoids contaminating it with toolbar-tone concerns. The byte-for-byte preservation is anchored by a Sprint 179 regression test.
- Chose `kv.container = "Namespace"` (the brief mentioned `"Keyspace"` as an example; `"Namespace"` is more idiomatic for Redis-style key-value stores in modern APIs). Documented as a best-effort entry per the contract's "Generator-decided" allowance.
- Chose the **aria-label sentence-case derivation** (`Add ${vocab.unit.toLowerCase()}`) in `ColumnsEditor` to preserve the existing test assertion `name: "Add column"` (lowercase 'c') without modifying the existing test file's text strings — required by the AC-179-03 invariant ("existing assertion strings remain valid").

## Residual Risk

- **Min-window-size visual confirmation (1024×600) not performed** because the Tauri shell does not run in this sandbox. Risk is low: new labels (`Fields`, `Add Field`, `No fields found`) are similar lengths to the legacy ones (`Columns`, `Add Column`, `No columns found`). Operator can re-run the smoke step list at Verification Plan §Required Checks #6 if needed.
- **`StructurePanel` is RDB-only-mounted in normal navigation today** — Sprint 179 makes the surface paradigm-aware so it CAN render Mongo wording when mounted with `paradigm="document"`, but does not change which surfaces actually mount for which paradigm. AC-179-02 is satisfied by the Vitest-test path (the contract permits this in lieu of a real Mongo navigation). Future sprints that extend `StructurePanel` to mount under document paradigm will inherit the paradigm-aware copy without further changes.
- **`search` / `kv` vocabulary entries are populated for completeness** but no surface renders them in this sprint. They are best-effort English defaults; a future sprint that ships a search/kv structure surface should review and confirm the wording.
