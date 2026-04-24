# Handoff: Sprint 75 — Empty-input Coercion and Type Validation on Commit

## Outcome

- **Status**: Generator implementation complete (attempt 2). All required checks green. Awaiting Evaluator re-pass.
- **Summary (attempt 2)**: Attempt 1 landed UPDATE-side coercion but left the INSERT path on the legacy `typeof v === "string" ? \`'${v}'\` : String(v)` short-circuit, which silently violated Contract Fidelity (contract "In Scope" bullet 1: UPDATE **+ INSERT** literal emission) and Invariant 3 (SQL preview = commit payload) — the preview for a new row used `coerceToSqlLiteral`'s output mentally but the emitted SQL didn't. Attempt 2 routes every new-row cell through the same helper after normalising typed primitives to `string | null`. When any cell in a row fails coercion, the row's INSERT is dropped atomically (no partially-valid emission) and each failing cell reports its own `onCoerceError` entry keyed `new-${newRowIdx}-${colIdx}`. The UPDATE-side key shape (`${rowIdx}-${colIdx}`) is unchanged, so existing hint wiring in `DataGridTable`/`useDataGridEdit` keeps working — the new-row namespace is additive.
- **Summary (attempt 1, for reference)**: Extracted SQL literal emission into a pure `coerceToSqlLiteral(value, dataType): CoerceResult` helper next to `generateSql`. The helper classifies a column's `data_type` into a SQL family (integer / numeric / boolean / date / timestamp / time / uuid / textual / unknown) and returns either `{ kind: "sql", sql }` or `{ kind: "error", message }`. `generateSql` now routes every UPDATE through the helper, emitting type-appropriate literals (unquoted integers/numerics, `TRUE`/`FALSE` booleans, quoted dates/timestamps/times/UUIDs, the legacy escape path for textual types) and reporting coercion failures via an optional `onCoerceError` callback instead of silently wrapping everything in single quotes. `useDataGridEdit` consumes those errors into a new `pendingEditErrors: Map<string, string>` state, exposes it from the hook, clears the entry for the active cell whenever the user modifies its value, and wipes the map wholesale on successful commit / discard. `DataGridTable` renders a `role="alert"` + `aria-live="polite"` + `text-destructive` hint beneath the active editor when the current cell has an error, and the hint disappears as soon as the hook clears that entry. ADR 0009 tri-state is preserved (textual `''` stays `''`, non-textual `''` coerces to `NULL`, `null` always `NULL`).

## Verification Profile

- **Profile**: mixed (command checks run; manual browser smoke not run — see Residual Risk)
- **Final evaluator verdict**: _pending_

## Evidence Packet

### Checks Run

- `pnpm tsc --noEmit`: **pass** (exit 0, no output — zero errors).
- `pnpm lint`: **pass** (exit 0, zero errors, zero warnings across the entire tree).
- `pnpm vitest run`: **pass** — last lines (attempt 2):

  ```
   Test Files  72 passed (72)
        Tests  1389 passed (1389)
     Start at  17:52:15
     Duration  12.53s (transform 3.12s, setup 4.41s, import 20.02s, tests 30.72s, environment 45.50s)
  ```

  The attempt 1 handoff reported 1352 tests at that time. Between attempts, unrelated in-flight work in the working tree (Sprint 73's QueryEditor / QueryTab refactor and adjacent changes visible in `git status`) raised the baseline before attempt 2 began. Attempt 2's contribution is isolated: **+8 tests in `sqlGenerator.test.ts`** for the new "Sprint 75 attempt 2 INSERT coercion" block (57 tests total in that file, was 49). `Test Files` count stays at 72 — attempt 2 adds no new test files. Every pre-existing test remains green; no regression introduced. Stashing attempt 2's sqlGenerator.test.ts additions alone drops the count from 1389 to 1381, confirming the +8 delta.

- `pnpm vitest run src/components/datagrid/sqlGenerator.test.ts`: **pass** — 57 tests pass (was 49 after attempt 1; +8 for the INSERT coercion block). Output includes explicit per-type branch names (integer / numeric / boolean / date / timestamp / time / uuid / textual / unknown / empty-string tri-state / valid+invalid batch) plus the new INSERT block's named cases (`integer column + "" → row uses NULL`, `integer column + "42" → row uses 42 unquoted`, `boolean column + "true" → row uses TRUE`, `date column + "2026-04-24" → row uses '2026-04-24'`, `integer column + "abc" → no INSERT for that row`, `mixed-batch INSERT`, `multiple invalid cells in a single new row`, `raw number/boolean primitives in new-row cells are normalised`).

### Acceptance Criteria Coverage

- **AC-01** — `sqlGenerator.generateSql` emits literals based on column `data_type` for **both UPDATE and INSERT**:
  - Source (shared helper): `src/components/datagrid/sqlGenerator.ts:139-215` — `coerceToSqlLiteral` pure function.
  - Source (INSERT wiring, attempt 2): `src/components/datagrid/sqlGenerator.ts:373-403` — the `pendingNewRows.forEach` block routes each new-row cell through `normalizeNewRowCell` (lines 276-284) then `coerceToSqlLiteral`, skipping the row's INSERT atomically on any cell failure (line 398) and emitting `onCoerceError` per failing cell (lines 388-393).
  - Non-textual `""` → `NULL` on UPDATE: `sqlGenerator.test.ts:191-260` + integration `sqlGenerator.test.ts:693-712`.
  - Non-textual `""` → `NULL` on **INSERT** (attempt 2): `sqlGenerator.test.ts:803-819` ("integer column + \"\" → row uses NULL, not ''").
  - Textual `""` → `''` preserved on UPDATE: `sqlGenerator.test.ts:166-190` + integration `sqlGenerator.test.ts:714-726`.
  - Textual `""` → `''` preserved on **INSERT**: `sqlGenerator.test.ts:117-140` (original "emits NULL for null cells and '' for empty-string cells in new rows") — still passes, confirms attempt 2 did not regress the textual-empty invariant.
  - `null` always → `NULL`: `sqlGenerator.test.ts:147-165` + `sqlGenerator.test.ts:776-789` + INSERT-side `sqlGenerator.test.ts:838-850` ("boolean column + \"true\" → row uses TRUE" — co-tests `null` on integer and text columns inside the same row).

- **AC-02** — Per-type literal format:
  - integer unquoted `"42"` → `42`: `sqlGenerator.test.ts:263-269, 277-291` + UPDATE integration `sqlGenerator.test.ts:662-676` + **INSERT** integration (attempt 2) `sqlGenerator.test.ts:821-836` ("integer column + \"42\" → row uses 42 unquoted").
  - numeric unquoted (`"3.14"`, `".5"`, `"-1"`): `sqlGenerator.test.ts:312-351`.
  - boolean `TRUE/FALSE` (case-insensitive `true/t/1` and `false/f/0`): `sqlGenerator.test.ts:370-435` + UPDATE integration `sqlGenerator.test.ts:677-692` + **INSERT** integration (attempt 2) `sqlGenerator.test.ts:838-850` ("boolean column + \"true\" → row uses TRUE").
  - date quoted `'YYYY-MM-DD'`: `sqlGenerator.test.ts:437-458` + **INSERT** integration (attempt 2) `sqlGenerator.test.ts:852-893` ("date column + \"2026-04-24\" → row uses '2026-04-24'").
  - timestamp/timestamptz/datetime quoted: `sqlGenerator.test.ts:461-505`.
  - time quoted: `sqlGenerator.test.ts:507-527`.
  - uuid quoted, case-insensitive: `sqlGenerator.test.ts:530-561`.
  - textual O''Brien escape preserved: `sqlGenerator.test.ts:564-597`.
  - **INSERT** raw-primitive normalisation (number / boolean → string → coerce) (attempt 2): `sqlGenerator.test.ts:971-987` ("raw number/boolean primitives in new-row cells are normalised before coercion").

- **AC-03** — Coercion failures excluded from SQL, error entries recorded — for **both UPDATE and INSERT**:
  - Generator-side UPDATE behaviour: `sqlGenerator.test.ts:728-775` — `coercion failure is excluded from SQL and reported via onCoerceError`, `valid + invalid edits in same batch: valid ones still emit, invalid ones report errors`.
  - Generator-side **INSERT** behaviour (attempt 2): `sqlGenerator.test.ts:895-916` ("integer column + \"abc\" → no INSERT for that row, onCoerceError fires with a correlatable key") — verifies the failing row drops out of `statements` entirely and the error is reported with key `new-0-1`.
  - **INSERT mixed-batch independence** (attempt 2): `sqlGenerator.test.ts:918-949` ("mixed-batch INSERT: valid rows keep INSERT, invalid row is skipped with error") — rows A and C still emit; row B is dropped; exactly one `onCoerceError` fires with key `new-1-1`.
  - **INSERT multi-cell errors in one row** (attempt 2): `sqlGenerator.test.ts:951-969` ("multiple invalid cells in a single new row report one error per cell, row still skipped") — two errors fire for one dropped row so the UI can show two hints simultaneously.
  - Hook-side UPDATE error map population: `useDataGridEdit.validation.test.ts:128-192`.
  - UPDATE independent-batch behaviour: `sqlGenerator.test.ts:748-774`.

- **AC-04** — Inline hint rendered on error; cleared on input change:
  - Hint renders with `role="alert"` + `aria-live="polite"` + `text-destructive`: `DataGridTable.validation-hint.test.tsx:80-107` ("renders a hint with text-destructive token when active cell has an error", "hint has aria-live=polite").
  - Hint disappears when errors clear (simulating the hook's `clearActiveEditorError` behaviour): `DataGridTable.validation-hint.test.tsx:138-162`.
  - Hook side — `setEditValue`/`setEditNull` clears the error entry: `useDataGridEdit.validation.test.ts:194-250` ("setEditValue clears the error for the currently editing cell", "setEditNull clears the error for the currently editing cell").
  - Hint tied to the *active* editing cell only (not to arbitrary cells): `DataGridTable.validation-hint.test.tsx:108-122`.
  - Editor stays open alongside hint: `DataGridTable.validation-hint.test.tsx:123-137`.
  - ADR 0008 compliance (`text-destructive` token, no raw `text-red-*`): `DataGridTable.validation-hint.test.tsx:204-218`.

- **AC-05** — Unit-test coverage:
  - `sqlGenerator.test.ts` — **57 tests total after attempt 2** (was 5 before Sprint 75, 49 after attempt 1; attempt 2 adds an 8-test "Sprint 75 attempt 2 INSERT coercion" block at `sqlGenerator.test.ts:801-988`). Covers every UPDATE type branch + invalid-literal error + textual-empty-preserve + non-textual-empty-NULL + onCoerceError integration, AND every INSERT equivalent (AC-01, AC-02, AC-03 for new rows), including mixed-batch atomicity and raw-primitive normalisation.
  - `useDataGridEdit.validation.test.ts` — 11 tests total (new in attempt 1) covering initial state, valid commit, invalid commit, mixed batch, `setEditValue`/`setEditNull` clears, `handleDiscard` wipes, `handleExecuteCommit` clears, Cmd+S valid and invalid paths, re-commit after fix. Unchanged by attempt 2 because the UPDATE-side error key shape (`${rowIdx}-${colIdx}`) is unchanged — INSERT errors use the new `new-${newRowIdx}-${colIdx}` namespace, and the hook surfaces the same `pendingEditErrors: Map<string, string>` so downstream consumers (tests + UI) work on both key shapes via the same `Map.has/get` contract.
  - `DataGridTable.validation-hint.test.tsx` — 9 tests total (new in attempt 1) covering empty state, hint render, aria attributes, scope to active cell, editor-plus-hint coexistence, hint dismissal on error-map clear, onChange wiring, NULL-chip state with hint, ADR 0008 token check. Unchanged by attempt 2 because new-row cells currently render as read-only `NULL` / `String(cell)` text in `DataGridTable.tsx:823-845` (no active editor lives on the new-row grid in Sprint 75's scope), so there is no editor-adjacent hint surface to test there yet. The generator-side tests guard the INSERT coercion contract; the UI hint rendering for new rows is an additive future UX sprint. See "Residual Risk" for the exact hand-off.

### Helper Signatures

```ts
// src/components/datagrid/sqlGenerator.ts

// Discriminated union for per-edit coercion result.
export type CoerceResult =
  | { kind: "sql"; sql: string }
  | { kind: "error"; message: string };

// Per-edit error reported to consumers via onCoerceError.
export interface CoerceError {
  key: string;       // "rowIdx-colIdx" — mirrors pendingEdits
  rowIdx: number;
  colIdx: number;
  message: string;   // user-readable validation reason
}

// Options bag for generateSql.
export interface GenerateSqlOptions {
  onCoerceError?: (err: CoerceError) => void;
}

// Pure function — testable in isolation.
export function coerceToSqlLiteral(
  value: string | null,
  dataType: string,
): CoerceResult;

// generateSql now accepts an options bag (non-breaking — optional).
export function generateSql(
  data: TableData,
  schema: string,
  table: string,
  pendingEdits: Map<string, string | null>,
  pendingDeletedRowKeys: Set<string>,
  pendingNewRows: unknown[][],
  options?: GenerateSqlOptions,
): string[];
```

```ts
// src/components/datagrid/useDataGridEdit.ts — new fields on the returned state.
interface DataGridEditState {
  // existing fields ...
  pendingEditErrors: Map<string, string>;
  // setEditValue is now the error-clearing wrapper (setter signature unchanged).
  setEditValue: (v: string | null) => void;
}
```

## Changed Areas

### Attempt 1 (UPDATE coercion + inline hint)

- `src/components/datagrid/sqlGenerator.ts` — added `classifySqlType` (internal), `coerceToSqlLiteral` (exported pure function returning `CoerceResult`), `CoerceError` / `GenerateSqlOptions` / `CoerceResult` exports; refactored the UPDATE emission loop to delegate to `coerceToSqlLiteral` and call `options.onCoerceError` for failures.
- `src/components/datagrid/useDataGridEdit.ts` — added `pendingEditErrors: Map<string, string>` state + exposed via `DataGridEditState`; added `clearActiveEditorError` + wrapped `setEditValue`/`setEditNull` so modifying the active cell clears its hint; populated the error map from `generateSql({ onCoerceError })` in both `handleCommit` and the Cmd+S `commit-changes` listener; clear errors wholesale in `handleExecuteCommit` and `handleDiscard`. The Cmd+S path also preserves a failing pending edit via `setPendingEdits(merged)` so the user sees the invalid value + hint rather than losing it.
- `src/components/datagrid/DataGridTable.tsx` — added optional `pendingEditErrors?: Map<string, string>` prop; wrapped the active-cell editor branch in a small IIFE that reads the error for the active cell's key and renders a `<span role="alert" aria-live="polite" className="mt-0.5 text-2xs text-destructive">` beneath either the `<input>` or the NULL chip when an error is present. All existing editor logic (including the Sprint 74 typed-editor routing and focus management) is unchanged.
- `src/components/DataGrid.tsx` — pass `editState.pendingEditErrors` into the existing `<DataGridTable …>` prop list.
- `src/components/datagrid/sqlGenerator.test.ts` — extended from 5 tests to 49. Adds `coerceToSqlLiteral` coverage per family, `generateSql` integration with typed columns + onCoerceError + mixed valid/invalid batches.
- `src/components/datagrid/useDataGridEdit.validation.test.ts` — **new file**, 11 tests covering the validation gate contract end-to-end (initial state, valid commit, invalid commit, mixed batch, entry clear on edit, discard wipe, executeCommit wipe, Cmd+S valid/invalid, re-commit-after-fix).
- `src/components/datagrid/DataGridTable.validation-hint.test.tsx` — **new file**, 9 tests covering hint render contract (token compliance, aria attributes, scope to active cell, dismissal on empty error map, NULL-chip compatibility).

### Attempt 2 — INSERT coercion

Evaluator flagged attempt 1 at **Contract Fidelity 6/10** because the INSERT path (`sqlGenerator.ts` lines ~333-343 at the time) still used the legacy `typeof v === "string" ? \`'${v}'\` : String(v)` short-circuit, bypassing `coerceToSqlLiteral`. This violated:

- Contract "In Scope" bullet 1 (`contract.md:12`) which explicitly names UPDATE **and INSERT** literal emission as sprint scope.
- Invariant 3 (`contract.md:34`) — "SQL preview = commit payload" — because INSERT for new rows could diverge between what the user saw in the preview and what actually executed.

Attempt 2 closes both gaps:

- `src/components/datagrid/sqlGenerator.ts:266-284` — new internal `normalizeNewRowCell(value: unknown): string | null` helper that stringifies raw primitives (number / boolean / bigint / symbol) and passes `null`/`undefined` through as `null`. Objects are JSON-encoded so accidental object routing lands in a recoverable shape. This keeps `pendingNewRows: unknown[][]` (where cells may be typed primitives if a future new-row editor stores them as such) compatible with `coerceToSqlLiteral`'s `string | null` signature without widening the coerce helper's surface.
- `src/components/datagrid/sqlGenerator.ts:373-400` — rewrites the INSERT emission block. Each new-row cell is normalised via `normalizeNewRowCell` and routed through `coerceToSqlLiteral` using the column's `data_type`. If any cell fails, the row's INSERT is dropped **atomically** (no partially-valid emission) and each failing cell fires `onCoerceError` with a `new-${newRowIdx}-${colIdx}` key — the `new-` prefix disambiguates the new-row namespace from UPDATE's existing `${rowIdx}-${colIdx}` keys so an existing-row cell at `(0, 1)` and a new-row cell at `(0, 1)` can coexist in `pendingEditErrors` without collision.
- `src/components/datagrid/sqlGenerator.ts:243-264` — widened `CoerceError` jsdoc to document both key shapes.
- `src/components/datagrid/sqlGenerator.test.ts:801-988` — **new `describe` block** "generateSql — Sprint 75 attempt 2 INSERT coercion" with 8 tests:
  1. `integer column + "" → row uses NULL, not ''` (AC-01 for INSERT)
  2. `integer column + "42" → row uses 42 unquoted` (AC-02 for INSERT)
  3. `boolean column + "true" → row uses TRUE` (AC-02 for INSERT)
  4. `date column + "2026-04-24" → row uses '2026-04-24'` (AC-02 for INSERT)
  5. `integer column + "abc" → no INSERT for that row, onCoerceError fires with a correlatable key` (AC-03 for INSERT, key `new-0-1`)
  6. `mixed-batch INSERT: valid rows keep INSERT, invalid row is skipped with error` (AC-03 independence, 3 rows in, 2 out, 1 error)
  7. `multiple invalid cells in a single new row report one error per cell, row still skipped` (UI affordance: multiple hints possible)
  8. `raw number/boolean primitives in new-row cells are normalised before coercion` (AC-02: number `3` and boolean `true` both stringify and coerce correctly)

No change to `useDataGridEdit.ts`, `DataGridTable.tsx`, `DataGrid.tsx`, `useDataGridEdit.validation.test.ts`, or `DataGridTable.validation-hint.test.tsx` was required in attempt 2. The hook's `pendingEditErrors` map treats the new `new-${newRowIdx}-${colIdx}` keys transparently (it's a `Map<string, string>` — key shape is opaque to the state container). The UPDATE error-key scheme and hint UI are unchanged, so the existing 20 tests in those two files continue to pass without modification. A UI surface that shows new-row hints next to the inline new-row cells is explicitly deferred (new rows currently render as read-only text in `DataGridTable.tsx:823-845` — Sprint 75 scope does not include a new-row inline editor), documented under Residual Risk.

## Scenario Tests (from contract)

- [x] Happy path (UPDATE): textual `''` preserved + non-textual `''` → `NULL` + `"1"` → integer literal — `sqlGenerator.test.ts` coverage across AC-01 / AC-02 test blocks.
- [x] Happy path (INSERT, attempt 2): non-textual `""` → NULL, integer `"42"` → `42`, boolean `"true"` → `TRUE`, date ISO → quoted — `sqlGenerator.test.ts:803-893`.
- [x] Error (UPDATE): invalid literal → no SQL + error entry — `sqlGenerator.test.ts:728-747` + `useDataGridEdit.validation.test.ts:128-152`.
- [x] Error (INSERT, attempt 2): invalid literal → row skipped + error keyed `new-${i}-${c}` — `sqlGenerator.test.ts:895-916`.
- [x] Boundary (UPDATE): mixed valid/invalid in one batch, valid ones still emit — `sqlGenerator.test.ts:748-774` + `useDataGridEdit.validation.test.ts:153-192`.
- [x] Boundary (INSERT, attempt 2): 3-row mixed batch — valid / invalid / valid — emits 2 INSERTs and fires 1 error — `sqlGenerator.test.ts:918-949`. Multi-cell errors in one row fire 1 error per cell, row still skipped atomically — `sqlGenerator.test.ts:951-969`.
- [x] Regression: Sprint 74 NULL-chip paths still work (all `useDataGridEdit.cellToEditValue.test.ts` and existing `DataGridTable.editing-visual.test.tsx` cases still pass — included in the 1389 total), ADR 0009 tri-state preserved (`sqlGenerator.test.ts` original 5 tests still green including original INSERT-`''`-preserve at `sqlGenerator.test.ts:117-140` + new `coerceToSqlLiteral` tests + new INSERT coercion tests), `O''Brien` escape preserved (`sqlGenerator.test.ts:571-577`).

## Assumptions

1. **Numeric literal regex is conservative**. Scientific notation (`1e3`), trailing `e`, `+` prefix are all rejected. PostgreSQL accepts them in some contexts, but the TablePlus-style editor is unlikely to see them in practice and broadening the regex risks false positives. If an Evaluator flags this as too strict, widening to `/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/` is a one-line change.
2. **Boolean accept set is English-only**. `true/t/1` and `false/f/0` (case-insensitive) are accepted. No Korean/localized aliases (`참/거짓`) — those would belong in a later i18n pass. Aligned with PostgreSQL's native accept set for boolean literal parsing.
3. **Date/Time regexes enforce *shape* only, not semantic validity**. `"25:00"` as a time and `"2026-02-31"` as a date both pass shape checks because HH is two digits and MM-DD follow the same pattern. Range validation is delegated to the database engine (which returns a clear error — and, unlike Sprint 75's silent coercion, that would surface on commit-execute, not commit-preview). This matches the helper's stated invariant: *coerceable to a SQL literal*, not *valid in the target DB*.
4. **`unknown` type family falls back to the legacy single-quote escape path**. Types outside the classifier (e.g. `money`, `bytea`, `interval`, `inet`, PostgreSQL range types) keep pre-Sprint-75 behaviour. This is the safest default — silently coercing empty string to `NULL` for an unknown type could change the semantics of existing commits.
5. **`setSqlPreview` side effect is unchanged when the current batch has no valid SQL in the non-in-flight `handleCommit` path**. If every pending edit fails coercion, the preview stays closed (matches the pre-Sprint-75 "empty statements list → no preview" behaviour), but `pendingEditErrors` is populated so the user sees hints on the grid.
6. **In-flight Cmd+S with a failing edit still shows valid sibling edits**. When the user has some saved valid edits and one in-flight invalid edit, Cmd+S opens the preview with the valid SQL *and* sets the error map. The invalid pending entry is preserved via `setPendingEdits(merged)` so the user can go fix it after the modal closes.
7. **`pendingEditErrors` is keyed identically to `pendingEdits`** (`"rowIdx-colIdx"`) — the `DataGridTable` lookup just calls `pendingEditErrors?.get(key)` where `key` is already computed per cell. No cross-map translation needed.
8. **DataGridTable's `pendingEditErrors` prop is optional** to keep the prop surface backwards-compatible with any future callers (currently only `DataGrid.tsx`) that haven't adopted the error map. Internal default is `undefined`, which silently disables the hint.
9. **ADR 0009 textual-family classification** includes `text`, `varchar` (and `character varying`), `char`, `bpchar`, `citext`, `string`, `json`, `jsonb`. I treated `character` and `character varying` both as textual via an `includes("character")` check so the PostgreSQL long-form names work too.
10. **INSERT error-key namespace (attempt 2)**: `new-${newRowIdx}-${colIdx}` was chosen instead of reusing the UPDATE shape `${rowIdx}-${colIdx}` because the two row-namespaces are logically independent (new-row index is into `pendingNewRows`, not a DB row) and keeping them separate prevents collision in `pendingEditErrors` — e.g. an existing row at DB index 0, column 1 and a new-row at index 0, column 1 can both hold errors simultaneously. The `new-` prefix matches the existing row-key convention in `DataGridTable.tsx:823` (`key={`new-row-${newIdx}`}`), so if a future UI sprint adds a new-row inline editor, the lookup will feel natural. No consumer today treats the key shape as opaque beyond `Map.has/get`, so the additive namespace does not require any hook or UI changes.
11. **INSERT atomicity on cell failure (attempt 2)**: when any cell in a new row fails coercion, the entire row's INSERT is skipped — not "emit the row with `NULL` for the failing cells" or "emit a partial row". Rationale: INSERT does not have UPDATE's "one SET per statement" escape hatch; a partial-row emission would silently drop user intent, and a NULL-on-fail emission would silently change semantics (e.g. a typo'd integer would get inserted as NULL instead of triggering a visible hint). Dropping the row matches the UPDATE contract's "failed cells excluded from SQL" intent.
12. **INSERT multi-cell errors report all failures (attempt 2)**: even though the row is skipped once the first cell fails, the loop still reports `onCoerceError` for every failing cell rather than short-circuiting on the first one. Rationale: once we add a new-row inline editor UI (a future sprint), the user should see all their mistakes at once rather than fixing one cell, re-committing, seeing the next one, etc.

## Residual Risk

Attempt 2 closes the INSERT-bypass gap flagged by the Evaluator. The following risks remain and are **knowingly deferred** — none of them block the Sprint 75 contract.

- **No inline hint UI for new-row cells yet.** Generator-side contract is satisfied — an invalid new-row cell drops its row's INSERT and fires `onCoerceError` with key `new-${newRowIdx}-${colIdx}`. But `DataGridTable.tsx:823-845` still renders new-row cells as read-only italic text (no active editor lives there in Sprint 75), so there is no per-cell editor surface to paint a `text-destructive` hint on. A failing new-row INSERT therefore surfaces only via the Commit button's disabled/silent state and the missing INSERT statement in the preview — not via a per-cell in-grid hint. Closing this completely requires a new-row inline editor (a dedicated UI sprint) that would reuse the same `pendingEditErrors?.get('new-${i}-${c}')` lookup already exposed by the hook. Until then, users hit this gap via: add row → Commit → preview is missing the row → they notice the statement count is off. Acceptable for Sprint 75's AC-04 (which names "활성 편집 셀" — active editing cell — as the hint target) but documented here so the Sprint 75 follow-up / new-row UX sprint inherits it cleanly.
- **Manual browser smoke not run** (contract's optional #5 verification step). The unit evidence is thorough — every AC, including the new INSERT contract, has per-file test coverage and the three command gates are green — but the first end-to-end confirmation (Postgres integer column → `abc` → Cmd+S → inline hint → re-edit → hint disappears) should happen when the Evaluator or user runs `pnpm tauri dev`. The state machine is exercised by hook tests using the real store transitions, so the residual risk is limited to DOM layout edge cases (e.g. hint wrapping on a narrow column).
- **Time-family regex does not enforce ranges**. A user typing `25:00:00` into a time cell will pass the shape check, be emitted as `'25:00:00'`, and fail at the DB. Acceptable for Sprint 75 — database-level validation is the authoritative gate and the user will see the failure on execute. A future sprint could tighten the regex (`/^(0\d|1\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?$/`) without breaking compatibility. Applies to both UPDATE and INSERT paths now.
- **`datetime` vs `timestamp` HTML input-type asymmetry persists from Sprint 74** — a literal `"datetime"` column still renders as `<input type="time">` (because `getInputTypeForColumn`'s `includes("time")` fires first), but the SQL-side coercion treats it as timestamp. In practice no backend in the supported list emits `"datetime"` — MySQL returns `"datetime"` but the connection layer normalizes; Postgres uses `"timestamp"` — so this is dormant. A future HTML-type overhaul should unify the two.
- **Numeric accept surface is conservative**. If real-world users report legitimate inputs being rejected (e.g. `1.5e2`, `+3`, thousands separators), the `NUMERIC_RE` can be widened in isolation — the `coerceToSqlLiteral` branch is a single switch arm. Applies to both UPDATE and INSERT paths now.
- **No backend (Rust) validation layer added** — per contract this is intentionally out of scope, but it means a hostile IPC caller bypassing the UI could still send a miscoerced SQL payload. Not a regression — pre-Sprint-75 already had this property.

## Next Sprint Candidates (unchanged from the plan)

- Sprint 76 — Per-tab sort state.
- Sprint 77 — Compact + ephemeral tabs.
- Optional Sprint 75.5: replace boolean `<input>` with a segmented control / select. Sprint 75's coercion already handles free-form boolean input (`t/f/true/false/1/0`) so a UI swap would be additive, not disruptive.
