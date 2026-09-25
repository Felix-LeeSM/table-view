import { EditorView } from "@codemirror/view";
import { render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  alwaysMatchingCompletion,
  expectExecuteClosesCompletionPopup,
} from "./__tests__/editorCompletionHelpers";
import { expectUndoRevertsEdit } from "./__tests__/editorHistoryHelpers";
import SearchQueryEditor from "./SearchQueryEditor";

// Purpose: regression coverage for SearchQueryEditor — #1225.
// The search (Elasticsearch/OpenSearch) editor has to install CodeMirror
// history() like the other three editors for Cmd+Z undo to work.

// #1133 — the accessible name now lives on CodeMirror's real `.cm-content`;
// walk up to the editor wrapper (carries data-paradigm) for DOM queries.
function getWrapper(): HTMLElement {
  return screen
    .getByLabelText("Search Query Editor")
    .closest("[data-paradigm]") as HTMLElement;
}

function getEditorView(): EditorView {
  const cmEditor = getWrapper().querySelector(".cm-editor") as HTMLElement;
  const view = EditorView.findFromDOM(cmEditor);
  if (!view) throw new Error("EditorView not found");
  return view;
}

describe("SearchQueryEditor", () => {
  // #1336 follow-up — every query editor mounts with a unified `view.focus()`
  // so a freshly opened tab is immediately typeable on the real `.cm-content`.
  it("auto-focuses the .cm-content surface on mount (#1336)", async () => {
    const { container } = render(
      <SearchQueryEditor sql="" onSqlChange={vi.fn()} onExecute={vi.fn()} />,
    );
    const cmContent = container.querySelector(".cm-content");
    expect(cmContent).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(cmContent));
  });

  it("renders the search query editor surface", () => {
    render(
      <SearchQueryEditor
        sql='{ "query": { "match_all": {} } }'
        onSqlChange={vi.fn()}
        onExecute={vi.fn()}
      />,
    );

    // #1133 — role/aria on the real `.cm-content`; wrapper keeps data hooks.
    const content = screen.getByLabelText("Search Query Editor");
    expect(content).toHaveClass("cm-content");
    expect(content).toHaveAttribute("role", "textbox");
    const container = getWrapper();
    expect(container).not.toHaveAttribute("role");
    expect(container).toHaveAttribute("data-paradigm", "search");
    expect(container.querySelector(".cm-content")?.textContent).toContain(
      "match_all",
    );
  });

  // Reason: #1225 — user report that Cmd+Z undo does not work, because no
  // query editor installs history().
  it("reverts an edit via undo (history extension installed) (#1225)", () => {
    render(
      <SearchQueryEditor sql="{}" onSqlChange={vi.fn()} onExecute={vi.fn()} />,
    );
    expectUndoRevertsEdit(getEditorView());
  });

  // #2509 — executing must close the autocomplete popup. User sequence:
  // type in the editor → the autocomplete popup stays open → run the query
  // → **the popup disappears and does not hide the result** ← what is
  // locked here.
  it("closes the autocomplete popup when the query executes (#2509)", async () => {
    const onExecute = vi.fn();
    render(
      <SearchQueryEditor
        sql='{ "query": '
        onSqlChange={vi.fn()}
        onExecute={onExecute}
        searchExtensions={[alwaysMatchingCompletion]}
      />,
    );
    await expectExecuteClosesCompletionPopup(getEditorView(), onExecute);
  });

  // #1248 — the forwarded ref must resolve to the live EditorView.
  it("forwards a live EditorView to the parent ref (#1248)", () => {
    const ref = createRef<EditorView | null>();
    render(
      <SearchQueryEditor
        ref={ref}
        sql="{}"
        onSqlChange={vi.fn()}
        onExecute={vi.fn()}
      />,
    );
    expect(ref.current).toBe(getEditorView());
  });
});
