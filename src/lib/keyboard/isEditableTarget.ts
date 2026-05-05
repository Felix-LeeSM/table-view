// Shared focus guard for global keyboard shortcuts. Returns `true` when the
// event target is an editable surface (INPUT/TEXTAREA/SELECT or any element
// with `contenteditable`). Global shortcut handlers short-circuit their
// `keydown` callbacks so the keystroke stays a regular character entry
// (e.g. typing "w" inside a SQL editor must not close the active tab).
//
// Pure utility — no React imports.

/**
 * Returns true when `target` is a text-entry element where keystrokes
 * should remain typable characters (so global shortcuts must not fire).
 *
 * Recognised editable surfaces:
 *   - `<input>` (every type — including `type="text"`, `"search"`, etc.)
 *   - `<textarea>`
 *   - `<select>`
 *   - any element with `isContentEditable === true`
 *
 * Returns `false` for non-editable elements (e.g. `<div>`, `<button>`)
 * and for `null` (a `KeyboardEvent.target` may legitimately be `null`
 * when fired against the document itself).
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target) return false;
  // The runtime check via `instanceof` would be ideal, but jsdom-built
  // tests sometimes synthesise events whose target is a plain HTMLElement
  // from a different realm. Tag-name + `isContentEditable` lookup is
  // robust across realms and matches the inline guards we are replacing.
  const el = target as HTMLElement;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable === true
  );
}
