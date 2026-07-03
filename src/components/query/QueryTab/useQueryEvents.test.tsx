import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { history, historyKeymap, undo } from "@codemirror/commands";
import { useQueryEvents } from "./useQueryEvents";
import { makeQueryTab } from "../__tests__/queryTabTestHelpers";

function makeView(doc: string): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [history(), keymap.of(historyKeymap)],
    }),
  });
}

describe("useQueryEvents — format", () => {
  // #1248 — a whole-doc format (Cmd+I / toolbar button) is a user-initiated
  // action, so it must stay on the editor's undo stack (standard UX). It must
  // therefore dispatch on the EditorView, not route through the passive
  // store→editor mirror. RED before the fix: the whole-doc branch calls
  // `updateQuerySql` and never touches the view, so nothing is formatted and
  // nothing is undoable.
  it("formats the whole doc on the editor so Cmd+Z restores the pre-format text (#1248)", () => {
    const tab = makeQueryTab({ sql: "select 1" });
    const updateQuerySql = vi.fn();
    const { result } = renderHook(() =>
      useQueryEvents({ tab, updateQuerySql, canCancelQuery: false }),
    );

    const view = makeView("select 1");
    result.current.editorRef.current = view;

    act(() => {
      result.current.handleFormat();
    });

    // Format applied on the view (formatSql upper-cases keywords).
    expect(view.state.doc.toString()).not.toBe("select 1");
    // Editor-first path: the store is updated via the editor's updateListener
    // in production, never by a direct updateQuerySql call from the handler.
    expect(updateQuerySql).not.toHaveBeenCalled();

    act(() => {
      undo(view);
    });
    expect(view.state.doc.toString()).toBe("select 1");

    view.destroy();
  });
});
