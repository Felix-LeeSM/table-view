import { autocompletion, startCompletion } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { act, waitFor } from "@testing-library/react";
import { expect, type Mock } from "vitest";
import { getKeymapBindings } from "./editorHistoryHelpers";

// #2509 — in MongoQueryEditor and SearchQueryEditor the caller supplies the
// completion candidates as a prop (`useMongoAutocomplete` /
// `useSearchAutocomplete` pass `autocompletion({ override: [...] })`). The
// source below has that same shape but always has one candidate, so whether
// the popup opens does not depend on the syntax that differs per paradigm.
// SqlQueryEditor and RedisCommandEditor carry their own source, so they do
// not need this extension.
export const alwaysMatchingCompletion: Extension = autocompletion({
  override: [
    (context) => ({ from: context.pos, options: [{ label: "candidate" }] }),
  ],
});

const POPUP_SELECTOR = ".cm-tooltip-autocomplete";

/** Moves the cursor to doc end and asserts the completion popup opened. */
export async function openCompletionPopup(view: EditorView): Promise<void> {
  act(() => {
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    startCompletion(view);
  });
  await waitFor(() => {
    expect(view.dom.querySelectorAll(POPUP_SELECTOR)).toHaveLength(1);
  });
}

/** Asserts the popup element is gone. */
export async function expectCompletionPopupClosed(
  view: EditorView,
): Promise<void> {
  await waitFor(() => {
    expect(view.dom.querySelectorAll(POPUP_SELECTOR)).toHaveLength(0);
  });
}

/**
 * Reason: #2509 — running a query did not close the autocomplete popup, so
 * the popup covered the result grid at the moment the user went to read it,
 * and in E2E it hid the `.cm-content` click point
 * (`clearSqlEditorClickPoint` in `e2e/smoke/_helpers.ts`).
 *
 * The assertion is on the popup disappearing. Spying on CodeMirror's
 * close-popup command being called would stay green even if that command
 * changed to do nothing.
 *
 * RED (the execute trigger does not close the popup): the popup element
 * stays and the second `waitFor` times out.
 * GREEN: the execute trigger closes the popup and that element disappears.
 */
export async function expectExecuteClosesCompletionPopup(
  view: EditorView,
  onExecute: Mock,
): Promise<void> {
  await openCompletionPopup(view);

  // CodeMirror walks bindings in priority order and stops at the first one
  // that returns true. That is why the four editors put their own Mod-Enter
  // ahead of defaultKeymap: calling only that binding keeps a default one
  // out of the assertion, since a default binding would edit the doc and
  // close the popup by itself. The `onExecute` assertion below confirms the
  // editor's own binding really ran.
  const executeBinding = getKeymapBindings(view).find(
    (binding) => binding.key === "Mod-Enter",
  );
  act(() => {
    expect(executeBinding?.run?.(view)).toBe(true);
  });
  expect(onExecute).toHaveBeenCalledTimes(1);

  await expectCompletionPopupClosed(view);
}
