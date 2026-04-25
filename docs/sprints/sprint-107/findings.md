# Sprint 107 Findings — SchemaTree F2 Rename (#TREE-1)

## Implementation Summary

`src/components/schema/SchemaTree.tsx`:

1. Extended `onKeyDown` on the table/view/function row button (was Enter-only)
   to also handle `F2` — gated to *real tables* only by `isTableView && !isView
   && !isFunc`. View/function buttons remain unaffected (no rename support).

   ```tsx
   onKeyDown={(e) => {
     if (e.key === "Enter") {
       handleClick();
     } else if (
       e.key === "F2" &&
       isTableView &&
       !isView &&
       !isFunc
     ) {
       e.preventDefault();
       handleStartRename(item.name, schema.name);
     }
   }}
   ```

   Note on the gate: `isTableView` is `isTableCat` (line 686). `isView` /
   `isFunc` are mutually exclusive with `isTableCat`, so this triple-condition
   is equivalent to `isTableCat`. Kept as written in the brief to be explicit
   and defensive against future category additions.

2. Added `onFocus={(e) => e.currentTarget.select()}` on the rename Dialog
   input (line ~951). Combined with the existing `autoFocus`, the dialog now
   opens with the existing name fully selected so the user can immediately
   type a replacement. This works regardless of how the dialog was opened
   (context menu Rename or F2).

## Test Additions

`src/components/schema/SchemaTree.test.tsx` (5 new cases at the end of the
top-level `describe("SchemaTree", ...)` block):

- F2 on a focused **table** button opens the Rename Dialog (asserts
  `Rename Table` heading + `New table name` input visible).
- F2 on a focused **view** button does NOT open the Rename Dialog.
- F2 on a focused **function** button does NOT open the Rename Dialog.
- After opening via F2, `document.activeElement === input`,
  `input.selectionStart === 0`, `input.selectionEnd === "users".length`.
- F2 → type new name → Enter inside input commits via `renameTable` mock.

## Verification

| Check | Result |
| --- | --- |
| `pnpm vitest run` | 1787 passed (103 files); was 1782 before |
| `pnpm tsc --noEmit` | clean |
| `pnpm lint` | clean |

## Acceptance Criteria Mapping

| AC | Evidence |
| --- | --- |
| AC-01 (table F2 → dialog) | `opens rename dialog when F2 is pressed on a focused table button` |
| AC-02 (input focus + full selection) | `focuses rename input and selects full existing name when opened via F2` |
| AC-03 (Enter commit / Esc close) | `commits rename on Enter when dialog was opened via F2` (Enter); existing `closes rename dialog on Escape key` regression-guards Esc |
| AC-04 (view/function F2 ignored) | `does not open rename dialog when F2 is pressed on a focused view button` + `... function button` |
| AC-05 (regression 0) | All previous SchemaTree tests still pass; full suite 1787 pass |

## Out of Scope (explicitly skipped)

- Inline rename (mutating button to input in place).
- View / function rename feature.
- F2 on schema or category nodes.

## Assumptions

- `isTableView && !isView && !isFunc` is the contract-mandated gate; in
  practice it reduces to `isTableCat` because the three booleans are derived
  from mutually exclusive `cat.key` checks. Keeping the longer form matches
  the brief verbatim and is defensive.
- `setSchemaStoreState` preserves `renameTable` (it spreads overrides BEFORE
  re-pinning a fixed list of mocked actions, and `renameTable` is not in
  that fixed list). The Enter-commit test calls
  `useSchemaStore.setState({ renameTable: mockRename })` AFTER
  `setSchemaStoreState({...})` to ensure the mock survives — same pattern as
  existing `AC-CM-12 Rename with Enter key` test.

## Residual Risk

None for the contracted scope. Real keyboard focus (vs `fireEvent.keyDown` on
the unfocused button) is not exercised by JSDOM here, but Radix Dialog +
`autoFocus` + `onFocus={select()}` are well-trodden patterns and a manual
browser smoke is recommended in the Evaluator profile (`browser`) per
`spec.md`.
