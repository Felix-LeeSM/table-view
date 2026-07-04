import { EditorView } from "@codemirror/view";

/**
 * #1133 — Names the *real* editable surface (`.cm-content`) instead of a
 * decoy wrapper `<div role="textbox">`. CodeMirror renders `.cm-content`
 * as the `contenteditable` `role="textbox"` combobox and wires the
 * autocomplete combobox aria (`aria-expanded` / `aria-controls` /
 * `aria-activedescendant`) onto that same element. Putting the accessible
 * name here — via `EditorView.contentAttributes`, the CM6-native channel —
 * gives the field a name AND restores the autocomplete announcement in one
 * place, instead of on an unrelated wrapper the screen reader never lands on.
 *
 * `describedById` points at a visually-hidden element holding the
 * autocomplete usage hint (the `.cm-tooltip-autocomplete::after` CSS hint is
 * invisible to screen readers), so the popup navigation keys are announced
 * when the combobox gains focus.
 */
export function editorContentAria(label: string, describedById: string) {
  return EditorView.contentAttributes.of({
    "aria-label": label,
    "aria-describedby": describedById,
  });
}
