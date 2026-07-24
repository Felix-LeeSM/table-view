// Issue #1739 — shared inline-edit visual tokens.
//
// Three edit surfaces (datagrid cell, Quick Look FieldRow, structure
// ColumnsEditor) each hand-rolled a raw <input>/<textarea> with ad-hoc
// Tailwind: only FieldRow drew an always-on `border` box (it read as a
// "floating card"), the focus ring mixed color and width
// (ring-2 primary / ring-1 primary / ring-1 ring), and the editor padding
// didn't match the static cell so the value jumped on edit-entry. These two
// tokens are the single source of truth for the "dissolve into the cell"
// editor look.

/**
 * Borderless inline editor <input>/<textarea>. No border and NO horizontal
 * padding — the surrounding cell already pads (px-3), so the editing value
 * sits exactly where the static value did (no left/right jump). Transparent
 * background + one unified focus ring (ring-1, primary; the old ring-2 read as
 * heavy) so the editor dissolves into the cell instead of floating over it.
 * Font family is left to the caller (FieldRow adds `font-mono`; ColumnsEditor
 * does not).
 */
export const INLINE_EDIT_INPUT =
  "w-full bg-transparent px-0 py-0.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary";

/**
 * The unified edit ring as an always-on cell highlight (datagrid). The editing
 * datagrid cell owns the highlight for BOTH its <input> and its Set-NULL
 * textbox branch, so the ring lives on the cell rather than the input — same
 * width/color as INLINE_EDIT_INPUT's focus ring (ring-1, primary), just
 * inset and unconditional while an editor is mounted.
 */
export const INLINE_EDIT_CELL_RING = "ring-1 ring-inset ring-primary";
