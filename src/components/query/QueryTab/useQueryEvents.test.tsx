import { describe, it, expect, vi } from "vitest";
import { useMemo } from "react";
import { render, act } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { useQueryEvents } from "./useQueryEvents";
import { makeQueryTab } from "../__tests__/queryTabTestHelpers";
import SqlQueryEditor from "../SqlQueryEditor";

// #1248 review — the original test manually injected `editorRef.current = view`,
// which hid a production seam: the query editors exposed the view via
// `useImperativeHandle(ref, () => viewRef.current, [])`, whose layout-phase
// empty-deps snapshot captured `null` before the view was created — so
// `editorRef.current` was permanently null and whole-doc format silently fell
// back to the store (passive, non-undoable). This test mounts a real editor and
// drives format through the actual forwarded ref.
describe("useQueryEvents — format (real editor mount)", () => {
  it("formats the whole doc through the forwarded ref so Cmd+Z restores it (#1248)", () => {
    const captured: {
      format?: () => void;
      getRef?: () => EditorView | null;
    } = {};
    const updateQuerySql = vi.fn();

    function Harness() {
      const tab = useMemo(() => makeQueryTab({ sql: "select 1" }), []);
      const { editorRef, handleFormat } = useQueryEvents({
        tab,
        updateQuerySql,
        canCancelQuery: false,
      });
      captured.format = handleFormat;
      captured.getRef = () => editorRef.current;
      return (
        <SqlQueryEditor
          ref={editorRef}
          sql={tab.sql}
          onSqlChange={vi.fn()}
          onExecute={vi.fn()}
        />
      );
    }

    const { container } = render(<Harness />);
    const domView = EditorView.findFromDOM(
      container.querySelector(".cm-editor") as HTMLElement,
    );
    if (!domView) throw new Error("EditorView not mounted");

    // The forwarded ref must resolve to the live view (null before the fix).
    expect(captured.getRef!()).toBe(domView);

    act(() => {
      captured.format!();
    });
    // Format applied on the editor (formatSql upper-cases keywords) → undoable.
    expect(domView.state.doc.toString()).not.toBe("select 1");

    act(() => {
      undo(domView);
    });
    expect(domView.state.doc.toString()).toBe("select 1");
  });
});
