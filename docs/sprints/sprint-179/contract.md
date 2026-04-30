# Sprint Contract: sprint-179

## Summary

- Goal: Match user-visible labels to the paradigm of the active connection. Today RDB-only vocabulary ("Add Column", "Columns", "No columns found", "Add row") leaks into Mongo contexts because (a) `StructurePanel` / `ColumnsEditor` hardcode RDB strings while being mounted only for RDB today, and (b) only `DataGridToolbar` consumes the partial-coverage `DOCUMENT_LABELS` pattern. This sprint introduces a single typed paradigm dictionary covering all four paradigms (`rdb`, `document`, `search`, `kv`), funnels the existing `DOCUMENT_LABELS` consumers through it, extends the structure-side surfaces (`StructurePanel`, `ColumnsEditor`) to honor a `paradigm` prop with an RDB fallback, and ships an audit report listing every user-visible "column"/"table"/"row" string under `src/components/**.tsx` with classification.
- Audience: Generator (single agent) — implements; Evaluator — verifies AC + evidence.
- Owner: harness orchestrator
- Verification Profile: `mixed` (browser + command + static). Browser smoke is operator-driven and limited to AC-179-02 (one Mongo-paradigm structure surface rendering Mongo vocabulary).

## In Scope

- `AC-179-01`: A single in-repo dictionary maps each supported paradigm (`rdb`, `document`, `search`, `kv`) to its user-visible vocabulary covering at minimum the keys `unit`, `units`, `record`, `records`, `container`, `addUnit`, `emptyUnits`. The dictionary is a typed constant exported from one module (one source of truth). Verifiable by file inspection of the new module AND by a Vitest test that asserts each `Paradigm` key has a complete entry across the required keys.
- `AC-179-02`: When a Mongo collection is the active table and a structure-or-fields surface is mounted with `paradigm="document"`, every user-visible mention of "column" / "columns" / "Add Column" / "No columns found" reads the equivalent Mongo vocabulary (field / fields / "Add Field" / "No fields found"). Today `StructurePanel` is RDB-only-mounted; the AC is satisfied by either (a) adding paradigm-aware copy through the dictionary so the surface can render Mongo wording when mounted with `paradigm="document"`, OR (b) a build-time / test-time assertion preventing a wrong-paradigm mount. Verifiable via a Vitest test that renders `StructurePanel` and `ColumnsEditor` with `paradigm="document"` and asserts the Mongo vocabulary appears in the DOM (and the RDB strings do NOT).
- `AC-179-03`: Existing RDB callers continue to render the existing RDB vocabulary unchanged. Verifiable by the existing `DataGridToolbar.test.tsx`, `StructurePanel.test.tsx`, and `ColumnsEditor.test.tsx` (or their nearest equivalents) passing without modification beyond optional explicit `paradigm="rdb"` props in newly-added test cases — existing assertion strings remain valid.
- `AC-179-04`: When the `paradigm` prop is missing or `undefined` at a label boundary (legacy callers in JS-only paths or test fixtures that omit the prop), the consumer falls back to the `rdb` entry of the dictionary so RDB callers do not surface "Field" labels in an SQL context. Verifiable via a Vitest test that renders the structure surfaces with `paradigm={undefined}` and asserts the RDB vocabulary appears.
- `AC-179-05`: An audit report committed at `docs/sprints/sprint-179/labels-audit.md` lists every user-visible "column" / "table" / "row" / "field" / "document" / "collection" string in `src/components/**.tsx` after the change, classifies each as paradigm-aware (sources its label from the dictionary) or paradigm-fixed (legitimately RDB-only or paradigm-only, with a one-line reason), and shows zero hardcoded paradigm-RDB labels in user-visible JSX of paradigm-shared components. Format: a Markdown table with columns `| Component | Line | String | Classification | Note |`.

Files allowed to modify (per spec "Components to Create/Modify"):

- `src/lib/strings/paradigm-vocabulary.ts` (new) — exports the typed dictionary and (Generator's choice) a `useParadigmVocabulary(paradigm?: Paradigm)` hook OR a plain getter `getParadigmVocabulary(paradigm?: Paradigm)`. Either shape is acceptable; both must apply the `undefined → rdb` fallback documented in AC-179-04.
- `src/lib/strings/paradigm-vocabulary.test.ts` (new) — completeness tests for AC-179-01 (all four paradigms × all required keys present, no empty strings, no duplicates across `unit`/`record`/`container` axes within a paradigm) and the `undefined → rdb` fallback test for AC-179-04.
- `src/lib/strings/document.ts` — kept; the existing `DOCUMENT_LABELS` constant is sourced from the new dictionary so the toolbar consumers remain unchanged in shape. Reason comment retained; the constant becomes a thin re-export / derivation.
- `src/components/datagrid/DataGridToolbar.tsx` — existing label-prop overrides default to the dictionary's RDB vocabulary (no behavior change for RDB callers); the `DOCUMENT_LABELS` import path stays valid for the document-grid caller.
- `src/components/schema/StructurePanel.tsx` — accepts an optional `paradigm?: Paradigm` prop (defaults to `"rdb"`); tab labels (`"Columns"` etc.) and any empty-state copy read from the paradigm dictionary.
- `src/components/structure/ColumnsEditor.tsx` — accepts an optional `paradigm?: Paradigm` prop (defaults to `"rdb"`); the "Add Column" button label at line 504 and the "No columns found" empty-state copy at line 643 read from the dictionary.
- Test files for the touched components — extend existing `*.test.tsx` if present, or create siblings for the new AC-179-02/03/04 cases. The Generator confirms the existing test file paths during inventory and records them in `findings.md`.
- `docs/sprints/sprint-179/labels-audit.md` (new) — AC-179-05's audit report.
- `docs/sprints/sprint-179/findings.md` (new) — Generator notes: dictionary location/shape, fallback mechanism (prop default vs hook), paradigm-prop wiring decision (label-prop vs hook), audit-table totals, browser smoke summary, evidence index.
- `docs/sprints/sprint-179/handoff.md` (sprint deliverable; standard harness output).

## Out of Scope

- Sprint 180 (Doherty + Goal-Gradient cancel overlay). The cancel UI work is gated on this sprint shipping its dictionary so the cancel button copy can be paradigm-aware downstream, but the overlay itself is NOT this sprint.
- A capability adapter from ADR-0010 / cross-paradigm capability registry. Vocabulary is lexical; capability gating is structural — keep them separate.
- Introducing a new `Paradigm` type or expanding the existing one. The existing `Paradigm = "rdb" | "document" | "search" | "kv"` (defined at `src/types/connection.ts:15`) is reused verbatim. The dictionary's keys MUST be exactly those four values.
- Backend / Rust / Tauri changes. This is a frontend-only label refactor; no IPC, store, or schema changes.
- Adding Mongo data fetching to RDB-only surfaces. `StructurePanel` is currently RDB-only-mounted; this sprint adds paradigm-aware copy so the surface CAN render correctly under `paradigm="document"`, but does not change which surfaces mount for which paradigm. (No Mongo fetch path is introduced into `StructurePanel`'s effects.)
- E2E selector overhauls. AC-GLOBAL-06 requires updating any e2e selector that breaks because of the rename in the same sprint that breaks it; the Generator audits — if no e2e currently relies on the affected RDB strings, no e2e update is needed. Audit result is recorded in `findings.md`.
- Migrating other paradigm-aware copy modules (e.g. `COLLECTION_READONLY_BANNER_TEXT` at `src/lib/strings/document.ts:17`) into the dictionary. Banner copy is one-off, not part of the unit/record/container axis; left as a `paradigm-fixed` entry in the audit.
- Adding new Mongo / search / kv structure surfaces. The `search` and `kv` vocabulary entries are populated as best-effort dictionary entries (so AC-179-01 has full coverage) but no rendering surface is added for them in this sprint.
- ADR or `memory/decisions/` updates. No architecture decision is made; the dictionary is an implementation detail consistent with the existing `src/lib/strings/document.ts` pattern.

## Invariants

- **Existing `Paradigm` type unchanged**: `src/types/connection.ts:15` (`export type Paradigm = "rdb" | "document" | "search" | "kv"`) is read but not modified. Any new dictionary type uses `Paradigm` as its key constraint (`Record<Paradigm, …>`).
- **Existing `DOCUMENT_LABELS` consumers unchanged in signature**: `DataGridToolbar`'s prop names (`addRowLabel`, `rowCountLabel`, `deleteRowLabel`, `duplicateRowLabel`) and the document-grid spread `<DataGridToolbar {...DOCUMENT_LABELS} />` continue to work exactly as today. The constant's *source* changes (derived from the dictionary) but its shape stays a flat `{ rowCountLabel, addRowLabel, deleteRowLabel, duplicateRowLabel }` `as const`.
- **`paradigm` fallback is `rdb`**: at every label boundary (component prop, hook call, getter call), `undefined` resolves to the `rdb` dictionary entry. Callers that omit the prop see no behavior change.
- **No new untranslatable English strings in components**: every user-visible label that this sprint touches MUST flow through the dictionary. Inline `"Add Column"` JSX text in touched files is gone after this sprint (the audit at AC-179-05 confirms zero hardcoded RDB labels in paradigm-shared components).
- **Existing test suite passes**: `pnpm vitest run` is green at the end of the sprint. Existing assertions on RDB strings (`"Columns"`, `"Add Column"`, `"No columns found"`) continue to match because `paradigm` defaults to `"rdb"`.
- **Skip-zero gate holds** (AC-GLOBAL-05): no `it.skip` / `it.todo` / `xit` introduced in touched test files.
- **Strict TS** (AC-GLOBAL-01 lint gate): no `any`; the dictionary is typed `Record<Paradigm, ParadigmVocabulary>` where `ParadigmVocabulary` is an `interface` or a `type` exported from the same module.
- **No new runtime dependencies**; no `package.json` change.
- **Tab-label slot in `StructurePanel`**: the existing `{ key: "columns", label: "Columns" }` shape (line 94) keeps its `key: "columns"` (which is a stable identifier, not user-visible — it backs the `activeSubTab` state). Only the `label` value is sourced from the dictionary.
- **`ColumnsEditor`'s prop API remains additive**: the new `paradigm?: Paradigm` prop is optional with default `"rdb"`. Existing callers (currently `StructurePanel`) get no behavior change unless they explicitly opt in.

## Acceptance Criteria

- `AC-179-01` — Single typed paradigm dictionary at `src/lib/strings/paradigm-vocabulary.ts` (or equivalent) covering all four paradigms with the required key set (`unit`, `units`, `record`, `records`, `container`, `addUnit`, `emptyUnits`). Test asserts completeness.
- `AC-179-02` — `StructurePanel` and `ColumnsEditor` rendered with `paradigm="document"` show `Fields` (tab/empty-state), `Add Field` (button), `No fields found` (empty state). RDB strings `Columns` / `Add Column` / `No columns found` are absent under `paradigm="document"`.
- `AC-179-03` — Existing `paradigm`-omitted (or `paradigm="rdb"`) renders of touched components produce the existing RDB vocabulary; existing component test assertions match without text-string edits beyond optional explicit prop additions.
- `AC-179-04` — `paradigm={undefined}` at `StructurePanel` / `ColumnsEditor` / dictionary getter falls back to RDB vocabulary; test asserts.
- `AC-179-05` — `docs/sprints/sprint-179/labels-audit.md` exists with the prescribed table, every entry classified, and zero RDB-hardcoded labels in paradigm-shared components.

## Design Bar / Quality Bar

- **Dictionary location**: `src/lib/strings/paradigm-vocabulary.ts` (sibling to existing `document.ts`). The Generator MAY name the file differently (`paradigm-labels.ts`, `paradigm.ts`) but the location MUST be `src/lib/strings/`. The chosen name is recorded in `findings.md`.
- **Dictionary shape**: a typed constant of the form
  ```ts
  export interface ParadigmVocabulary {
    unit: string;       // "Column" / "Field"
    units: string;      // "Columns" / "Fields"
    record: string;     // "Row" / "Document"
    records: string;    // "Rows" / "Documents"
    container: string;  // "Table" / "Collection"
    addUnit: string;    // "Add Column" / "Add Field"
    emptyUnits: string; // "No columns found" / "No fields found"
  }
  export const PARADIGM_VOCABULARY: Record<Paradigm, ParadigmVocabulary> = {
    rdb:      { unit: "Column", units: "Columns", record: "Row",      records: "Rows",      container: "Table",      addUnit: "Add Column", emptyUnits: "No columns found" },
    document: { unit: "Field",  units: "Fields",  record: "Document", records: "Documents", container: "Collection", addUnit: "Add Field",  emptyUnits: "No fields found"  },
    search:   { unit: "Field",  units: "Fields",  record: "Document", records: "Documents", container: "Index",      addUnit: "Add Field",  emptyUnits: "No fields found"  },
    kv:       { unit: "Field",  units: "Fields",  record: "Entry",    records: "Entries",   container: "Keyspace",   addUnit: "Add Field",  emptyUnits: "No fields found"  },
  };
  ```
  The exact `search` and `kv` strings can be Generator-decided as best-effort, but each entry MUST have all required keys with non-empty strings.
- **Access pattern**: Generator picks one of:
  - **Hook**: `useParadigmVocabulary(paradigm?: Paradigm): ParadigmVocabulary` — returns the entry, `undefined → rdb` fallback. Hook is a pure derivation; no React state.
  - **Getter**: `getParadigmVocabulary(paradigm?: Paradigm): ParadigmVocabulary` — same shape, no React dependency. Friendlier for non-component consumers (e.g. potential test helpers).
  Both are acceptable. Whichever is chosen, `findings.md` records the rationale.
- **Fallback rule**: a single helper enforces `paradigm ?? "rdb"`. Do NOT duplicate the fallback ternary at every consumer call site — keep it inside the hook/getter so the audit can confirm one place enforces the rule.
- **`DOCUMENT_LABELS` derivation**: the existing constant becomes
  ```ts
  const doc = PARADIGM_VOCABULARY.document;
  export const DOCUMENT_LABELS = {
    rowCountLabel: doc.records,                  // "documents" — note the lowercase form
    addRowLabel: doc.addUnit.replace(/^Add /, "Add ").replace("Field", "document").trim(),
    // ...
  } as const;
  ```
  is unacceptable — the existing `DOCUMENT_LABELS` strings are user-facing copy with their own capitalization (`"documents"` lowercase, `"Add document"` capitalized differently from `"Add Field"`). The Generator MUST preserve the existing literal strings of `DOCUMENT_LABELS` while sourcing them through the dictionary mechanism — easiest path: the dictionary entry for `document` includes (or is paired with) a `toolbarLabels` derivation, OR the dictionary stays a separate concern from `DOCUMENT_LABELS` and the constant remains a flat object derived from `PARADIGM_VOCABULARY.document` explicitly. Generator decides; `findings.md` records the chosen path.
- **Audit gathering command** (Generator runs and records in `findings.md`):
  ```
  grep -rn -E "(Column|Row|Table|Field|Document|Collection)" src/components/ --include="*.tsx" | grep -v test
  ```
  Each candidate is triaged into the audit table. JSX text nodes (`>Add Column<`, `>No columns found<`, `>Columns<`, `>Rows<`) are the prime targets. Strings in props/labels that already flow through `DOCUMENT_LABELS` or another override are classified as `paradigm-aware`. Strings that reference a database structural concept by its formal name (e.g. `"This table has constraints"` in an SQL-only constraint editor) are classified as `paradigm-fixed` with reason.
- **Tests use user-visible queries** (`getByRole`, `getByLabelText`, `getByText`) first; `container.querySelector` only when class-level (none in this sprint — all assertions are on text content presence/absence).
- **Each new test gets a Reason + date comment** per the user's auto-memory `feedback_test_documentation.md` (2026-04-28), e.g. `// AC-179-02 — Mongo paradigm renders "Add Field" not "Add Column"; date 2026-04-30.`
- **Coverage**: ≥ 70% line coverage on the new dictionary module and the touched lines of the three components (project convention; AC-GLOBAL-04). The dictionary file is small; near-100% is the realistic target.
- **Visual direction**: labels remain in the existing typography and tone; the swap is purely lexical. No layout change is intended; if a label-length difference at 1024×600 (RISK-030) forces wrap or truncation, the truncation must be visually graceful (ellipsis, not clipped baseline) — Generator confirms by browser smoke at min window size and records in `findings.md`.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/lib/strings/paradigm-vocabulary.test.ts src/components/datagrid/DataGridToolbar.test.tsx src/components/schema/StructurePanel.test.tsx src/components/structure/ColumnsEditor.test.tsx` — runs the new dictionary completeness test plus the three component tests covering AC-179-02/03/04. Must be green; AC-179-0X covered by AC-tagged tests with `[AC-179-0X]` prefix in test names.
2. `pnpm vitest run` — full Vitest suite. Must be green (no regression). Watch for downstream consumers of `DOCUMENT_LABELS` (currently `DocumentDataGrid.tsx:273-276`) — derivation change must keep their text identical.
3. `pnpm tsc --noEmit` — strict-mode type check. Zero errors. The new `Record<Paradigm, ParadigmVocabulary>` typing is the load-bearing test.
4. `pnpm lint` — ESLint. Zero errors.
5. Static (Generator-recorded, Evaluator re-runs):
   - File inspection: `src/lib/strings/paradigm-vocabulary.ts` exists; exports a typed const indexed by `Paradigm`; all four paradigm keys present; all required vocabulary keys present per paradigm. Command: `grep -nE 'rdb:|document:|search:|kv:|unit:|units:|record:|records:|container:|addUnit:|emptyUnits:' src/lib/strings/paradigm-vocabulary.ts`.
   - File inspection: audit report exists. Command: `test -f docs/sprints/sprint-179/labels-audit.md && head -40 docs/sprints/sprint-179/labels-audit.md`. Must show the table header `| Component | Line | String | Classification | Note |` and at least one entry per touched component.
   - Audit completeness check: re-run `grep -rn -E "(Column|Row|Table|Field|Document|Collection)" src/components/ --include="*.tsx" | grep -v test` and spot-check that each "user-visible JSX text" hit appears in the audit (sample five at random; full coverage not required for the spot-check, but every miss is a P2 finding).
   - Hardcoded-RDB-label check on touched files: `grep -nE '>(Add Column|No columns found|Columns)<' src/components/structure/ColumnsEditor.tsx src/components/schema/StructurePanel.tsx` returns empty (zero hardcoded RDB strings in JSX of paradigm-shared components after the change).
6. Browser smoke (operator-driven step list — Generator records observation, Evaluator re-runs):
   1. `pnpm tauri dev`.
   2. Open a Mongo connection (or, if no Mongo connection is configured locally, render the structure surface in a Vitest test as documented). Open a collection. The browser smoke is best-effort — if `StructurePanel` is not yet mounted for Mongo in normal navigation (per spec), the smoke is satisfied by the Vitest test that mounts it with `paradigm="document"`.
   3. Confirm the structure tab labels and any "Add" / empty-state copy read Mongo vocabulary (`Fields`, `Add Field`, `No fields found`).
   4. Open an RDB (PG/MySQL/SQLite) connection. Open a table. Confirm the structure surface still shows `Columns`, `Add Column`, `No columns found`.
   5. At min window size 1024×600, confirm Mongo labels do not visually clip; record a screenshot or note the observation in `findings.md`.

### Required Evidence

- Generator must provide:
  - Changed files (full list with one-line purpose each — at minimum: `paradigm-vocabulary.ts`, `paradigm-vocabulary.test.ts`, `document.ts`, `DataGridToolbar.tsx`, `StructurePanel.tsx`, `ColumnsEditor.tsx`, the relevant `*.test.tsx` extensions, `labels-audit.md`, `findings.md`, `handoff.md`).
  - Vitest output for the new + touched tests, including AC IDs each test covers (a `[AC-179-0X]` prefix in the test name is acceptable).
  - For AC-179-01: explicit dictionary completeness test output covering all four paradigms × seven keys.
  - For AC-179-02: Vitest test that renders `StructurePanel` with `paradigm="document"` and asserts `screen.getByText("Fields")` (tab label) AND `screen.queryByText("Columns")` returns `null`. Same for `ColumnsEditor` rendered with `paradigm="document"` asserting `Add Field` and `No fields found` present, RDB strings absent.
  - For AC-179-03: existing tests pass without text-string edits (Evaluator confirms by reading the diff — touched test files do NOT change RDB-string assertions; only add new cases).
  - For AC-179-04: a Vitest test that renders `StructurePanel` and `ColumnsEditor` with `paradigm={undefined}` and asserts RDB vocabulary appears; AND a unit test on the dictionary getter/hook with `getParadigmVocabulary(undefined)` returning the `rdb` entry.
  - For AC-179-05: `labels-audit.md` exists with at minimum a 5-row sample shown in `findings.md`, and the audit's tail row count matches the `grep` candidate count (or has a justified-with-reason gap recorded in `findings.md`).
  - `findings.md` containing: dictionary location/name, access pattern (hook vs getter) + rationale, paradigm-prop wiring decision (label-prop vs hook), `DOCUMENT_LABELS` derivation choice, audit table totals (paradigm-aware count, paradigm-fixed count), browser smoke summary (Mongo + RDB structure surface visual confirmation), evidence index.
- Evaluator must cite:
  - Concrete evidence for each AC pass/fail (test name + assertion text or audit-report line range).
  - Re-run of `pnpm vitest run src/lib/strings/paradigm-vocabulary.test.ts src/components/datagrid/DataGridToolbar.test.tsx src/components/schema/StructurePanel.test.tsx src/components/structure/ColumnsEditor.test.tsx` showing AC-tagged cases pass.
  - Re-run of the static checks at Verification Plan §Required Checks #5.
  - Confirmation that no `it.skip` / `it.todo` / `xit` was introduced in the touched test files (`grep -nE 'it\.(skip|todo)|xit\(' <touched-test-files>` returns empty).
  - Confirmation that `Paradigm` type at `src/types/connection.ts:15` is unchanged (`git diff src/types/connection.ts` shows no edit).
  - Confirmation that `DOCUMENT_LABELS` literal strings (`"documents"`, `"Add document"`, `"Delete document"`, `"Duplicate document"`) at `src/lib/strings/document.ts` are unchanged (existing consumers see no string drift).
  - Any missing or weak evidence (e.g. AC-179-05 claimed without the audit table actually committed) flagged as a P2 finding.

## Test Requirements

### Unit Tests (필수)

Each AC gets at least one Vitest scenario. Tests live in:

- `src/lib/strings/paradigm-vocabulary.test.ts` (new) — completeness + fallback unit tests.
- `src/components/schema/StructurePanel.test.tsx` (extend) — paradigm-aware rendering, RDB unchanged, undefined fallback.
- `src/components/structure/ColumnsEditor.test.tsx` (extend or new) — paradigm-aware rendering, RDB unchanged, undefined fallback.
- `src/components/datagrid/DataGridToolbar.test.tsx` (extend) — RDB-default behavior unchanged, `DOCUMENT_LABELS` flow unchanged (regression guard for AC-179-03).

Each new test carries a Reason + date comment per the 2026-04-28 feedback rule.

- **`paradigm-vocabulary.test.ts` cases** (AC-179-01 + AC-179-04):
  - `[AC-179-01a] every Paradigm key has a complete entry` — iterate `["rdb","document","search","kv"] as Paradigm[]`, assert every required key (`unit`, `units`, `record`, `records`, `container`, `addUnit`, `emptyUnits`) exists and is a non-empty string.
  - `[AC-179-01b] each entry's strings are unique within the entry's axis` — within a paradigm's entry, `unit !== record` and `record !== container` (sanity check that no entry is filled with placeholders).
  - `[AC-179-01c] rdb entry contains the expected English defaults` — `PARADIGM_VOCABULARY.rdb.unit === "Column"`, `.records === "Rows"`, `.addUnit === "Add Column"`, etc. — anchors the "RDB stays the legacy English copy" invariant.
  - `[AC-179-01d] document entry contains the Mongo vocabulary` — `.unit === "Field"`, `.records === "Documents"`, `.addUnit === "Add Field"`, `.emptyUnits === "No fields found"`.
  - `[AC-179-04a] getter/hook with undefined returns rdb entry` — `getParadigmVocabulary(undefined)` (or `useParadigmVocabulary(undefined)` via `renderHook`) deep-equals `PARADIGM_VOCABULARY.rdb`.
  - `[AC-179-04b] getter/hook with explicit "document" returns document entry` — sanity inverse.

- **`StructurePanel.test.tsx` extensions** (AC-179-02 + AC-179-03 + AC-179-04 component layer):
  - `[AC-179-02a] StructurePanel paradigm="document" renders Mongo tab labels` — render with `paradigm="document"`, assert `screen.getByRole("tab", { name: "Fields" })` (or the equivalent text query), assert `screen.queryByText("Columns")` returns `null`.
  - `[AC-179-03a] StructurePanel paradigm="rdb" renders RDB tab labels` — render with explicit `paradigm="rdb"`, assert `screen.getByRole("tab", { name: "Columns" })` present.
  - `[AC-179-04a] StructurePanel paradigm undefined falls back to RDB` — render without the prop, assert `screen.getByRole("tab", { name: "Columns" })` present.

- **`ColumnsEditor.test.tsx` extensions** (AC-179-02 + AC-179-04):
  - `[AC-179-02b] ColumnsEditor paradigm="document" renders "Add Field" button` — render with `paradigm="document"` and a fixture that triggers the empty-state branch, assert `screen.getByRole("button", { name: "Add Field" })` AND `screen.getByText("No fields found")` AND `screen.queryByRole("button", { name: "Add Column" })` returns `null`.
  - `[AC-179-02c] ColumnsEditor paradigm="document" renders Mongo empty-state copy` — same fixture, assert `screen.queryByText("No columns found")` returns `null`, `screen.getByText("No fields found")` present.
  - `[AC-179-04b] ColumnsEditor paradigm undefined falls back to RDB` — render without prop, assert `screen.getByRole("button", { name: "Add Column" })` AND `screen.getByText("No columns found")`.

- **`DataGridToolbar.test.tsx` regression** (AC-179-03):
  - `[AC-179-03b] DataGridToolbar default props still produce RDB row vocabulary` — existing tests already cover this; the Generator confirms the suite is green without modifying the assertion strings. If a single new "spread DOCUMENT_LABELS still produces 'documents' and 'Add document'" assertion is missing, add it as a regression guard.

- **Existing-test impact**: the existing component test files cover RDB-default rendering. The Generator confirms by running the existing files unmodified first; if any test does break (e.g. a tab label changed because the dictionary's `rdb.units` differs from the literal `"Columns"`), the rationale and the rewrite go into `findings.md`. Expected: zero existing tests break (the dictionary's `rdb` entry exactly matches the current literal RDB strings).

### Coverage Target

- 신규/수정 코드: 라인 70% 이상 (AC-GLOBAL-04, project convention).
- CI 전체 기준: 라인 40%, 함수 40%, 브랜치 35%.

### Scenario Tests (필수)

- [x] Happy path — RDB connection (default `paradigm`) renders RDB vocabulary; Mongo connection with `paradigm="document"` renders Mongo vocabulary (AC-179-02 + AC-179-03).
- [x] 에러/예외 — `paradigm` prop missing/undefined falls back to RDB without throwing (AC-179-04).
- [x] 경계 조건 — dictionary completeness across all four paradigms × seven keys (AC-179-01); empty-state branch of `ColumnsEditor` exercised under both paradigms (AC-179-02 + AC-179-04).
- [x] 기존 기능 회귀 없음 — `DOCUMENT_LABELS` consumers (`DocumentDataGrid` toolbar) keep producing `"documents"` / `"Add document"` literally; existing `DataGridToolbar` / `StructurePanel` / `ColumnsEditor` tests pass without text-string edits.

## Test Script / Repro Script

Manual replay for the Evaluator:

1. `pnpm install` (if not already).
2. `pnpm vitest run src/lib/strings/paradigm-vocabulary.test.ts src/components/datagrid/DataGridToolbar.test.tsx src/components/schema/StructurePanel.test.tsx src/components/structure/ColumnsEditor.test.tsx` — confirm all `[AC-179-0X]` cases pass.
3. `pnpm vitest run` — confirm full suite still green.
4. `pnpm tsc --noEmit` — zero errors.
5. `pnpm lint` — zero errors.
6. `grep -nE 'rdb:|document:|search:|kv:|unit:|units:|record:|records:|container:|addUnit:|emptyUnits:' src/lib/strings/paradigm-vocabulary.ts` — confirm all four paradigm keys + all required vocabulary keys present.
7. `test -f docs/sprints/sprint-179/labels-audit.md && head -40 docs/sprints/sprint-179/labels-audit.md` — confirm audit table present with the prescribed header.
8. `grep -nE '>(Add Column|No columns found|Columns)<' src/components/structure/ColumnsEditor.tsx src/components/schema/StructurePanel.tsx` — confirm empty (zero hardcoded RDB strings in JSX).
9. `grep -nE 'it\.(skip|todo)|xit\(' src/lib/strings/paradigm-vocabulary.test.ts src/components/schema/StructurePanel.test.tsx src/components/structure/ColumnsEditor.test.tsx src/components/datagrid/DataGridToolbar.test.tsx` — confirm empty (skip-zero gate).
10. `git diff src/types/connection.ts` — confirm `Paradigm` type unchanged.
11. `git diff src/lib/strings/document.ts` — confirm `DOCUMENT_LABELS` literal output strings unchanged (only the derivation source may change).
12. `pnpm tauri dev`, follow the browser smoke step list in Verification Plan §Required Checks #6.
13. Open `docs/sprints/sprint-179/findings.md` — confirm sections: dictionary location/name, access pattern + rationale, `DOCUMENT_LABELS` derivation choice, audit totals, browser smoke summary, evidence index.

## Ownership

- Generator: single agent (one Generator role within the harness).
- Write scope:
  - `src/lib/strings/paradigm-vocabulary.ts` (new)
  - `src/lib/strings/paradigm-vocabulary.test.ts` (new)
  - `src/lib/strings/document.ts` (derive from dictionary; preserve literal strings)
  - `src/components/datagrid/DataGridToolbar.tsx` (defaults from dictionary)
  - `src/components/schema/StructurePanel.tsx` (paradigm prop + dictionary lookups)
  - `src/components/structure/ColumnsEditor.tsx` (paradigm prop + dictionary lookups)
  - Test extensions for the touched components (existing files extended in place; new sibling files only if no existing test file covers the surface).
  - `docs/sprints/sprint-179/labels-audit.md` (new)
  - `docs/sprints/sprint-179/findings.md` (new)
  - `docs/sprints/sprint-179/handoff.md` (sprint deliverable; standard harness output)
- Untouched: `memory/`, `CLAUDE.md`, `src-tauri/`, `src/types/connection.ts` (the `Paradigm` type is read, not modified), `src/stores/*`, `src/components/document/*` (the document grid keeps its existing `DOCUMENT_LABELS` spread), sprints 176 / 177 / 178 / 180 spec/contract/brief, any file outside the write scope above.
- Merge order: this sprint is independent of 176 / 177 / 178 (already merged or independent). Sprint 180 may consume the dictionary for paradigm-aware cancel-button copy; landing this sprint before 180 is preferred but not required.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes` (1–6 in Verification Plan)
- `docs/sprints/sprint-179/labels-audit.md` exists with the prescribed table and zero RDB-hardcoded labels in paradigm-shared components.
- `docs/sprints/sprint-179/findings.md` exists and includes the dictionary location/name + access pattern + audit totals + browser smoke evidence.
- Acceptance criteria evidence linked in `docs/sprints/sprint-179/handoff.md` (one row per AC pointing to the test or evidence file).
