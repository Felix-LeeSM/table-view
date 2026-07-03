import { Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/**
 * Passive store→editor mirror. Applies the minimal diff so the cursor and
 * selection survive, and marks the transaction `addToHistory: false` so
 * programmatic doc swaps (favorite load, query-history load, tab-switch
 * remount, Structured→Raw prefill) never land on the undo stack — Cmd+Z is
 * for the user's own edits, not the app's. User-initiated whole-doc replaces
 * (format / uglify) deliberately bypass this and dispatch on the view so they
 * stay undoable (#1248).
 */
export function syncEditorDocument(view: EditorView, nextDoc: string): boolean {
  const currentDoc = view.state.doc.toString();
  if (currentDoc === nextDoc) return false;

  let from = 0;
  while (
    from < currentDoc.length &&
    from < nextDoc.length &&
    currentDoc[from] === nextDoc[from]
  ) {
    from += 1;
  }

  let currentEnd = currentDoc.length;
  let nextEnd = nextDoc.length;
  while (
    currentEnd > from &&
    nextEnd > from &&
    currentDoc[currentEnd - 1] === nextDoc[nextEnd - 1]
  ) {
    currentEnd -= 1;
    nextEnd -= 1;
  }

  view.dispatch({
    changes: { from, to: currentEnd, insert: nextDoc.slice(from, nextEnd) },
    annotations: Transaction.addToHistory.of(false),
  });
  return true;
}
