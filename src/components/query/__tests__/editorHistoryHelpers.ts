import { act } from "@testing-library/react";
import { undo } from "@codemirror/commands";
import { keymap, type EditorView, type KeyBinding } from "@codemirror/view";
import { expect } from "vitest";

// #1248 — hoisted from the six editor test files (query 4 + document 2) so the
// keymap-binding assertion has one source of truth. Collects every KeyBinding
// registered in the editor's `keymap` facet.
export function getKeymapBindings(view: EditorView): KeyBinding[] {
  const bindings: KeyBinding[] = [];
  for (const set of view.state.facet(keymap)) {
    if (Array.isArray(set)) bindings.push(...set);
  }
  return bindings;
}

// Reason: #1225 / #1247 — every editor (sql/mongo/redis/search + the two
// document editors) must install CodeMirror `history()` AND bind
// `historyKeymap` so Cmd+Z undo works. This helper is the shared undo contract.
//
// #1248 — the earlier revert tests called `undo()` directly, so a missing
// `historyKeymap` binding was a silent regression (the command still ran). We
// now assert the Mod-z binding exists first, then exercise the revert:
// RED (history / keymap absent): undo is a no-op → doc unchanged → revert fails,
//   or the binding assert fails outright.
// GREEN: the appended insert is reverted back to `before`.
export function expectUndoRevertsEdit(view: EditorView): void {
  expect(getKeymapBindings(view).some((b) => b.key === "Mod-z")).toBe(true);

  const before = view.state.doc.toString();
  const appended = `${before} X`;

  act(() => {
    view.dispatch({ changes: { from: view.state.doc.length, insert: " X" } });
  });
  expect(view.state.doc.toString()).toBe(appended);

  act(() => {
    undo(view);
  });
  expect(view.state.doc.toString()).toBe(before);
}
