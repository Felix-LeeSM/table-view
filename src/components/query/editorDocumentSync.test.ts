import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { syncEditorDocument } from "./editorDocumentSync";

function makeView(doc: string): EditorView {
  return new EditorView({
    state: EditorState.create({ doc, extensions: [history()] }),
  });
}

describe("syncEditorDocument", () => {
  // #1248 — passive store→editor mirroring (favorite load, history load,
  // tab-switch remount) pushes a doc the user never typed. Cmd+Z must not
  // revert it — undo is for the user's own edits, not the app's. RED before
  // `addToHistory: false`: the mirror lands on the undo stack so undo reverts
  // to the pre-sync doc.
  it("mirrors an external doc change without polluting the undo stack (#1248)", () => {
    const view = makeView("SELECT 1");

    expect(syncEditorDocument(view, "SELECT 2")).toBe(true);
    expect(view.state.doc.toString()).toBe("SELECT 2");

    undo(view);
    expect(view.state.doc.toString()).toBe("SELECT 2");

    view.destroy();
  });

  it("skips the dispatch and returns false when the doc already matches", () => {
    const view = makeView("SELECT 1");
    expect(syncEditorDocument(view, "SELECT 1")).toBe(false);
    view.destroy();
  });
});
