import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import SearchQueryEditor from "./SearchQueryEditor";
import { expectUndoRevertsEdit } from "./__tests__/editorHistoryHelpers";

// Purpose: SearchQueryEditor 회귀 커버리지 신설 — #1225 (2026-07-03).
// 검색(Elasticsearch/OpenSearch) 에디터도 다른 세 에디터와 동일하게
// CodeMirror history() 를 장착해야 Cmd+Z undo 가 동작한다.

function getEditorView(): EditorView {
  const container = screen.getByLabelText("Search Query Editor");
  const cmEditor = container.querySelector(".cm-editor") as HTMLElement;
  const view = EditorView.findFromDOM(cmEditor);
  if (!view) throw new Error("EditorView not found");
  return view;
}

describe("SearchQueryEditor", () => {
  it("renders the search query editor surface", () => {
    render(
      <SearchQueryEditor
        sql='{ "query": { "match_all": {} } }'
        onSqlChange={vi.fn()}
        onExecute={vi.fn()}
      />,
    );

    const container = screen.getByLabelText("Search Query Editor");
    expect(container).toHaveAttribute("role", "textbox");
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
});
