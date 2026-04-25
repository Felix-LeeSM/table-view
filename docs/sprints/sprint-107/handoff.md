# Handoff: sprint-107 — SchemaTree F2 Rename (#TREE-1)

## Outcome

- Status: PASS
- Summary: F2 keyboard shortcut on a focused table button opens the existing
  Rename Dialog with the input auto-focused and the existing name fully
  selected. View / function buttons correctly ignore F2. Enter / Esc inside
  the dialog retain prior commit / cancel semantics. Five new tests added,
  full suite green.

## Verification Profile

- Profile: command
- Overall score: 9.0/10
- Final evaluator verdict: PASS

## Evidence Packet

### Checks Run

- `pnpm vitest run`: pass — 1787/1787 across 103 files (was 1782 before
  sprint; +5 new tests, 0 regressions). Duration ~16.8s.
- `pnpm tsc --noEmit`: pass (per Generator findings; no new types
  introduced — only an extra branch in an existing keydown closure and an
  inline onFocus handler).
- `pnpm lint`: pass (per Generator findings; no new lint surface).

### Acceptance Criteria Coverage

- `AC-01` (table F2 → Rename Dialog opens):
  - Code: `SchemaTree.tsx:736-751` — `e.key === "F2" && isTableView && !isView && !isFunc`
    triggers `e.preventDefault()` + `handleStartRename(item.name, schema.name)`.
  - Test: `SchemaTree.test.tsx:2686` — "opens rename dialog when F2 is pressed
    on a focused table button" asserts `Rename Table` heading,
    `public.users` description, and `New table name` input are present after
    `fireEvent.keyDown(tableButton, { key: "F2" })`.
- `AC-02` (input auto-focus + full-name selection):
  - Code: `SchemaTree.tsx:962-963` — input has both `autoFocus` and
    `onFocus={(e) => e.currentTarget.select()}`.
  - Test: `SchemaTree.test.tsx:2796` — "focuses rename input and selects full
    existing name when opened via F2" asserts
    `document.activeElement === input`, `input.value === "users"`,
    `input.selectionStart === 0`, `input.selectionEnd === "users".length`.
- `AC-03` (Enter commits, Esc closes):
  - Code: `SchemaTree.tsx:956-961` — Enter inside input triggers
    `handleConfirmRename()` (unchanged); Esc handled by Radix Dialog
    `onOpenChange`.
  - Test: `SchemaTree.test.tsx:2828` — "commits rename on Enter when dialog
    was opened via F2" stubs `useSchemaStore.setState({ renameTable })`,
    types `people`, fires `Enter`, asserts
    `renameTable("conn1", "users", "public", "people")`. Pre-existing Esc
    regression test ("closes rename dialog on Escape key") still green.
- `AC-04` (view / function F2 → no-op):
  - Code: gate `isTableView && !isView && !isFunc` excludes both. Note:
    `isTableView === isTableCat` so the triple-condition is equivalent to
    `isTableCat`; the verbose form is intentional defensiveness against
    future category additions and matches the contract verbatim.
  - Tests: `SchemaTree.test.tsx:2714` (view button) and
    `SchemaTree.test.tsx:2753` (function button) both assert
    `screen.queryByText("Rename Table")` is null after F2.
- `AC-05` (regression 0): full suite 1787/1787, 103 files; pre-existing
  context-menu Rename / Esc / commit / drop tests untouched and green.

### Screenshots / Links / Artifacts

- Implementation: `src/components/schema/SchemaTree.tsx` (lines 736-751,
  947-965).
- Tests: `src/components/schema/SchemaTree.test.tsx` (lines 2682-2867, five
  new cases in the existing top-level `describe("SchemaTree", ...)` block).
- Findings: `docs/sprints/sprint-107/findings.md`.
- Contract: `docs/sprints/sprint-107/contract.md`.

## Sprint Contract Status

- [x] table button F2 → Rename Dialog (AC-01)
- [x] view button F2 → no Rename Dialog (AC-04)
- [x] function button F2 → no Rename Dialog (AC-04)
- [x] Dialog input auto-focused with full existing-name selection (AC-02)
- [x] Enter inside input commits via `renameTable` (AC-03)
- [x] Esc closes (regression-guarded by pre-existing test) (AC-03)
- [x] No regressions: 1787/1787 tests pass (AC-05)

## Scorecard (System Rubric)

| Dimension | Score | Notes |
|-----------|-------|-------|
| Correctness | 9/10 | F2 branch correctly gated to real tables; `preventDefault` prevents browser default (rename in some shells / browser shortcut surface); Enter / Esc paths unchanged. Selection works for both context-menu and F2 entry points (onFocus on input itself, not gated to F2). |
| Completeness | 9/10 | All 5 ACs mapped to dedicated tests; no scope creep (no inline rename, no view rename, no schema-node F2). Verbose `isTableView && !isView && !isFunc` gate matches contract verbatim. |
| Reliability | 9/10 | New code is purely additive: one extra `else if` and one inline `onFocus`. JSDOM `fireEvent.keyDown` on the unfocused button is the only delta from real keyboard focus, but Radix Dialog + `autoFocus` + `select()` are well-trodden patterns. Suite-wide 0 regressions. |
| Verification Quality | 9/10 | Five tests cover happy path, two negative paths (view, function), focus+selection assertion (activeElement / selectionStart / selectionEnd), and Enter commit with mock signature check. Esc covered by pre-existing regression test. Only minor gap: no explicit JSDOM test for `e.preventDefault()` being called on F2, but behavior is observable through dialog opening. |
| **Overall** | **9/10** | Solid, contract-faithful, well-tested. |

## Changed Areas

- `src/components/schema/SchemaTree.tsx`: added F2 branch to row-button
  `onKeyDown`; added `onFocus={(e) => e.currentTarget.select()}` to rename
  Dialog input.
- `src/components/schema/SchemaTree.test.tsx`: 5 new tests covering AC-01..04
  (AC-05 is the suite-wide pass).

## Assumptions

- `isTableView && !isView && !isFunc` is equivalent to `isTableCat` given
  current category derivations (mutually exclusive `cat.key` checks); the
  triple form is kept verbatim from the contract for defensiveness.
- `setSchemaStoreState` preserves `renameTable` because it spreads overrides
  before re-pinning a fixed list of mocked actions, and `renameTable` is not
  in that fixed list — hence the AC-03 test re-applies it via
  `useSchemaStore.setState`. Same pattern as the pre-existing
  `AC-CM-12 Rename with Enter key` test.

## Residual Risk

- Real keyboard focus (vs `fireEvent.keyDown` on the unfocused button) is not
  exercised by JSDOM. A manual browser smoke (focus a table row in the
  schema tree via Tab, press F2, verify dialog + selection) is recommended
  before release. Risk is low: Radix Dialog `autoFocus` and HTMLInputElement
  `select()` are standard.
- F2 has no platform-specific gotchas in macOS / Windows / Linux Tauri shells
  for this app, but if a future global keyboard shortcut binds F2, this
  handler will still win because it's a row-level `onKeyDown` (no global
  listener conflict).

## Next Sprint Candidates

- F2 on schema row → "Rename schema" (currently out of scope; would need
  backend rename support per DBMS).
- F2 on view row → if/when view rename is supported by adapters, extend the
  same gate.
- Cmd/Ctrl+Backspace on focused table row → quick Drop confirmation (mirrors
  TablePlus shortcut surface).
- Up/Down arrow row navigation inside the schema tree (currently relies on
  Tab order); would pair naturally with F2 / Backspace shortcuts.
