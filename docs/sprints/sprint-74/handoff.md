# Handoff: Sprint 74 — Type-Aware Editing and NULL Re-entry

## Outcome

- **Status**: Generator implementation complete; all required checks green. Awaiting Evaluator pass.
- **Summary**: Added a pure `deriveEditorSeed(dataType, key)` helper in `useDataGridEdit.ts` that classifies a column's type family and decides (a) whether a printable keystroke from the NULL chip is a legal first character and (b) what seed to flip the editor to. Wired the helper into the NULL-chip `onKeyDown` branch in `DataGridTable.tsx`, replacing the blind `onSetEditValue(e.key)` call. Normal input branch still uses the existing `getInputTypeForColumn`; no new `autoFocus`, no new editor components. ADR 0009 tri-state (`string | null`) preserved — `seed: ""` is a tri-state empty string, not SQL NULL.

## Verification Profile

- **Profile**: mixed (command checks run; manual browser check not run — see Residual Risk)
- **Overall score**: Generator self-assessment: all Done Criteria met.
- **Final evaluator verdict**: _pending_

## Evidence Packet

### Checks Run

- `pnpm tsc --noEmit`: **pass** (exit 0, no errors)
- `pnpm lint`: **pass** (exit 0, no errors; initial `no-useless-escape` on `[0-9.\-]` regex fixed by dropping the redundant `\-`)
- `pnpm vitest run`: **pass** (70 files, 1288 tests, 0 failed — previous total 1236 + 52 new type-aware cases across two files)

### Acceptance Criteria Coverage

- **AC-01** (`(dataType, key)` → `{ inputType, seed }` derivation exists):
  - `src/components/datagrid/useDataGridEdit.ts:45-48` — `EditorSeed` interface exported.
  - `src/components/datagrid/useDataGridEdit.ts:118-147` — `deriveEditorSeed` exported.
  - `getInputTypeForColumn` at `useDataGridEdit.ts:24-30` remains the source of truth for the HTML `<input type>`; `deriveEditorSeed` covers the seed half of the contract. Test cross-check in `useDataGridEdit.cellToEditValue.test.ts:306-326`.

- **AC-02** (NULL + printable key → type-appropriate empty/seeded editor):
  - date + "a" → `seed: ""`: `DataGridTable.editing-visual.test.tsx` "date column: 'a' from NULL chip flips with empty seed" (~L459).
  - date `<input type='date'>` renders: "date column renders <input type='date'> once editValue is a string" (~L480).
  - timestamp + "a" → `seed: ""`: "timestamp column: printable key flips to empty typed editor" (~L560).
  - timestamp `<input type='datetime-local'>` renders: "timestamp column renders <input type='datetime-local'>" (~L548).
  - boolean + "t" → `seed: ""`: "boolean column: 't' flips with empty seed" (~L534).
  - integer + "5" → `seed: "5"`: "integer column: digit ('5') seeds the editor with '5'" (~L517).
  - text + "a" → `seed: "a"` (regression): "printable key in NULL mode on a text column seeds the character" (~L184).
  - Helper-level coverage for uuid/numeric/json/char/varchar/citext/string/bigint/smallint/serial/float/double/real/unknown in `useDataGridEdit.cellToEditValue.test.ts:62-289`.

- **AC-03** (illegal key on typed editor is swallowed):
  - integer + "x" → no state change: `DataGridTable.editing-visual.test.tsx` "integer column: non-numeric key ('x') is swallowed" (~L499).
  - integer + "." → `{ seed: "", accept: false }`: `useDataGridEdit.cellToEditValue.test.ts` "integer + '.' → reject" (~L106).
  - numeric + "a" → reject: `useDataGridEdit.cellToEditValue.test.ts` (~L161).
  - Full rejection matrix (letters, punctuation) covered in helper tests (~L100-170).

- **AC-04** (Cmd/Ctrl+Backspace returns to NULL chip across typed editors):
  - date editor + Cmd+Backspace → `onSetEditNull` fires: "Cmd+Backspace from typed (date) editor returns to NULL chip" (~L572).
  - Existing text-editor coverage preserved at `DataGridTable.editing-visual.test.tsx:161-178`.
  - No changes to the `<input>` branch onKeyDown; ADR 0009 path unchanged.

- **AC-05** (NULL → text path regression):
  - "printable key in NULL mode on a text column seeds the character" (~L184). Existing fixture's `name` column is `data_type: "text"`.

### Screenshots / Links / Artifacts

- N/A (no screenshots generated; vitest RTL assertions stand in for DOM snapshots).

## Changed Areas

- `src/components/datagrid/useDataGridEdit.ts`: exported `EditorSeed` + `deriveEditorSeed`; added internal `classifyDataType`. `getInputTypeForColumn` and all existing hook state/contract untouched.
- `src/components/datagrid/DataGridTable.tsx`: imported `deriveEditorSeed`; rewrote the NULL-chip `onKeyDown` printable-key branch to compute `{ seed, accept }` and call `onSetEditValue(seed)` only when `accept === true`. `preventDefault()` preserved. No other structural changes; `editorFocusRef` focus management intact.
- `src/components/datagrid/useDataGridEdit.cellToEditValue.test.ts`: added 33 new helper cases across text/varchar/char/citext/string/json/jsonb/integer (int/bigint/smallint/serial)/numeric (decimal/float/double/real)/date/datetime/timestamp/timestamptz/time/boolean/bool/uuid/unknown/case-insensitivity + 4 cross-check cases against `getInputTypeForColumn`.
- `src/components/datagrid/DataGridTable.editing-visual.test.tsx`: added `DATE_DATA`, `INT_DATA`, `BOOL_DATA`, `TS_DATA` fixtures and a new describe block covering: date NULL+'a' → empty seed, date type=date, integer NULL+'x' swallowed, integer NULL+'5' seeded, boolean NULL+'t' empty seed, timestamp type=datetime-local, timestamp NULL+'a' empty seed, Cmd+Backspace from date editor, integer editor type=text (render contract). Renamed the existing text-path test to clarify its scope.

## Assumptions

1. **Boolean remains a `<input type="text">` for Sprint 74.** The contract explicitly marks "new editor components (boolean as select)" as optional / Sprint 75+. I kept the existing text `<input>` render so no visual component churn lands here; `deriveEditorSeed` returns `seed: ""` for any boolean keystroke so the flip out of NULL still works and Sprint 75's coercion can interpret `""`, `"t"`, `"true"`, etc. as the user types.
2. **`datetime` is routed to the datetime family for seeding** even though the existing `getInputTypeForColumn` returns `"time"` for `"datetime"` (substring matching rule). In practice MySQL uses `"datetime"` and Postgres uses `"timestamp"`, so the HTML type for a `"datetime"` column is a Sprint 75-era gap — not touched here. Seeding behavior is consistent (empty seed) for both, so the bug (seeding a raw letter) is fixed for both.
3. **`getInputTypeForColumn` stays untouched** per brief. No widening of the HTML-type map; that's Sprint 75 territory.
4. **Integer columns still render `<input type="text">`** because native `<input type="number">` interacts with the tri-state `string | null` pipeline in ways that would pull in Sprint 75 scope (value coercion, empty → NULL semantics). The NULL → typed-editor flip is what Sprint 74 owns; end-to-end numeric UX polish is Sprint 75.
5. **JSON/JSONB columns seed with the keystroke** (text-family) — consistent with prior behaviour and the fact that the existing `<input>` is plain text.

## Residual Risk

- **Manual browser validation not run**: The contract's optional manual check (Postgres date column → Cmd+Backspace → 'a' shows blank date picker instead of text) was not executed because this run is command-only. Unit-level evidence is strong (onSetEditValue arg + input.type assertions), but the first end-to-end confirm should happen when the Evaluator or user runs `pnpm tauri dev`.
- **`datetime` vs `timestamp` HTML type asymmetry**: As noted in Assumption 2, a literal `"datetime"` data_type column renders with `<input type="time">`. No known backend currently emits `"datetime"` as a column type for Table View's supported DBMS list, but this is a latent bug that Sprint 75 (which touches the HTML-type map alongside SQL coercion) should clean up.
- **Integer rendering**: Non-numeric keystrokes after the initial flip are not filtered at the `<input>` level — only the NULL-chip first-keystroke gate is tight. Sprint 75's `<input type="number">` adoption (or JS-level validation) closes the gap.

## Next Sprint Candidates

- Sprint 75 — Empty-input coercion + commit-time type validation (already planned; depends on `deriveEditorSeed`).
- Optional: replace boolean `<input>` with a select or segmented control once Sprint 75's coerce logic is in.
