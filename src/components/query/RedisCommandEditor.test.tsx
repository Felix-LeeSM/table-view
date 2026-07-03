import { describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { render, screen, act } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import RedisCommandEditor from "./RedisCommandEditor";
import {
  expectUndoRevertsEdit,
  getKeymapBindings,
} from "./__tests__/editorHistoryHelpers";

function getEditorView(): EditorView {
  const container = screen.getByLabelText("Redis Command Editor");
  const cmEditor = container.querySelector(".cm-editor") as HTMLElement;
  const view = EditorView.findFromDOM(cmEditor);
  if (!view) throw new Error("EditorView not found");
  return view;
}

describe("RedisCommandEditor", () => {
  it("renders the Redis command editor surface", () => {
    render(
      <RedisCommandEditor
        sql="GET session:1"
        onSqlChange={vi.fn()}
        onExecute={vi.fn()}
      />,
    );

    const container = screen.getByLabelText("Redis Command Editor");
    expect(container).toHaveAttribute("role", "textbox");
    expect(container).toHaveAttribute("aria-multiline", "true");
    expect(container).toHaveAttribute("data-paradigm", "kv");
    expect(container).toHaveAttribute("data-command-target", "redis");
    expect(container.querySelector(".cm-content")?.textContent).toContain(
      "GET session:1",
    );
  });

  it("labels the Valkey command editor target", () => {
    render(
      <RedisCommandEditor
        sql="GET session:1"
        onSqlChange={vi.fn()}
        onExecute={vi.fn()}
        redisCommandTarget="valkey"
      />,
    );

    const container = screen.getByLabelText("Valkey Command Editor");
    expect(container).toHaveAttribute("role", "textbox");
    expect(container).toHaveAttribute("data-command-target", "valkey");
  });

  it("calls onSqlChange when command text changes", () => {
    const onSqlChange = vi.fn();
    render(
      <RedisCommandEditor
        sql="GET session:1"
        onSqlChange={onSqlChange}
        onExecute={vi.fn()}
      />,
    );

    act(() => {
      getEditorView().dispatch({
        changes: { from: 0, to: 3, insert: "TTL" },
      });
    });

    expect(onSqlChange).toHaveBeenCalledWith("TTL session:1");
  });

  it("preserves cursor position across external command text sync", () => {
    const { rerender } = render(
      <RedisCommandEditor
        sql="GET profile:1"
        onSqlChange={vi.fn()}
        onExecute={vi.fn()}
      />,
    );
    const view = getEditorView();
    const cursorAfterDeletedChar = "GET profil".length;
    act(() => {
      view.dispatch({
        selection: { anchor: cursorAfterDeletedChar },
      });
    });

    rerender(
      <RedisCommandEditor
        sql="GET profie:1"
        onSqlChange={vi.fn()}
        onExecute={vi.fn()}
      />,
    );

    expect(getEditorView().state.doc.toString()).toBe("GET profie:1");
    expect(getEditorView().state.selection.main.head).toBe(
      cursorAfterDeletedChar - 1,
    );
  });

  // Reason: #1225 — 전 쿼리 에디터 history() 미장착으로 Cmd+Z undo 불가
  // 사용자 보고 (2026-07-03).
  it("reverts an edit via undo (history extension installed) (#1225)", () => {
    render(
      <RedisCommandEditor
        sql="GET k"
        onSqlChange={vi.fn()}
        onExecute={vi.fn()}
      />,
    );
    expectUndoRevertsEdit(getEditorView());
  });

  // #1248 — the forwarded ref must resolve to the live EditorView.
  it("forwards a live EditorView to the parent ref (#1248)", () => {
    const ref = createRef<EditorView | null>();
    render(
      <RedisCommandEditor
        ref={ref}
        sql="GET session:1"
        onSqlChange={vi.fn()}
        onExecute={vi.fn()}
      />,
    );
    expect(ref.current).toBe(getEditorView());
  });

  it("binds Mod-Enter to execute and Cmd-Shift-Enter to unsupported dry-run", () => {
    const onExecute = vi.fn();
    const onDryRun = vi.fn();
    render(
      <RedisCommandEditor
        sql="TTL session:1"
        onSqlChange={vi.fn()}
        onExecute={onExecute}
        onDryRun={onDryRun}
      />,
    );

    const view = getEditorView();
    const bindings = getKeymapBindings(view);
    for (const binding of bindings.filter(
      (entry) => entry.key === "Mod-Enter",
    )) {
      binding.run?.(view);
    }

    expect(onExecute).toHaveBeenCalled();
    const dryRunBindings = bindings.filter(
      (entry) => entry.key === "Cmd-Shift-Enter",
    );
    expect(dryRunBindings.length).toBeGreaterThanOrEqual(1);
    for (const binding of dryRunBindings) {
      binding.run?.(view);
    }
    expect(onDryRun).toHaveBeenCalled();
  });
});
