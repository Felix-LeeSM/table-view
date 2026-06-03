import type { EditorView } from "@codemirror/view";

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
  });
  return true;
}
