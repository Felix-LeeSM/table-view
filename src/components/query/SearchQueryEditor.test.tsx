import { describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import SearchQueryEditor from "./SearchQueryEditor";
import { expectUndoRevertsEdit } from "./__tests__/editorHistoryHelpers";

// Purpose: SearchQueryEditor 회귀 커버리지 신설 — #1225 (2026-07-03).
// 검색(Elasticsearch/OpenSearch) 에디터도 다른 세 에디터와 동일하게
// CodeMirror history() 를 장착해야 Cmd+Z undo 가 동작한다.

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

  // Reason: #1225 — 전 쿼리 에디터 history() 미장착으로 Cmd+Z undo 불가
  // 사용자 보고 (2026-07-03).
  it("reverts an edit via undo (history extension installed) (#1225)", () => {
    render(
      <SearchQueryEditor sql="{}" onSqlChange={vi.fn()} onExecute={vi.fn()} />,
    );
    expectUndoRevertsEdit(getEditorView());
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
