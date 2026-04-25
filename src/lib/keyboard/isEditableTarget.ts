// ---------------------------------------------------------------------------
// Sprint-104 — Shared focus guard for global keyboard shortcuts.
//
// Returns `true` when the supplied event target is an editable surface
// (INPUT/TEXTAREA/SELECT or any element with `contenteditable`). Global
// shortcut handlers in `App.tsx` use this to short-circuit their `keydown`
// callbacks so the keystroke is preserved as a regular character entry
// (e.g. typing "w" inside a SQL editor must not close the active tab).
//
// Centralising this policy in one helper means new shortcuts are
// automatically protected as soon as their handler calls
// `isEditableTarget(e.target)` — see Sprint Contract AC-01..06.
//
// This file is a pure utility — no React imports.
// ---------------------------------------------------------------------------

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
